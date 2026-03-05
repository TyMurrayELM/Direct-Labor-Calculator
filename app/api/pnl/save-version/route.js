import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole, isEditor } from '../../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!role || !isEditor(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { branchId, department, year, versionName, actualMonths } = await request.json();

    if (!branchId || !department || !year || !versionName) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // 1. Check if version name already exists — overwrite if unlocked
    const { data: existing, error: existCheck } = await supabase
      .from('pnl_versions')
      .select('id, is_locked')
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year)
      .eq('version_name', versionName)
      .limit(1);

    if (existCheck) throw existCheck;

    if (existing?.length) {
      if (existing[0].is_locked) {
        return NextResponse.json(
          { success: false, error: `Version "${versionName}" is locked and cannot be overwritten` },
          { status: 403 }
        );
      }
      // Delete old line items and version record
      const oldId = existing[0].id;
      const { error: delLines } = await supabase
        .from('pnl_line_items')
        .delete()
        .eq('version_id', oldId);
      if (delLines) throw delLines;

      const { error: delVersion } = await supabase
        .from('pnl_versions')
        .delete()
        .eq('id', oldId);
      if (delVersion) throw delVersion;
    }

    // 2. Create the version record
    const { data: version, error: versionError } = await supabase
      .from('pnl_versions')
      .insert({
        branch_id: branchId,
        department,
        year,
        version_name: versionName,
        actual_months: actualMonths || 0,
        is_locked: false
      })
      .select()
      .single();

    if (versionError) throw versionError;

    // 2. Fetch all draft rows
    const { data: draftRows, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('*')
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year)
      .is('version_id', null)
      .order('row_order');

    if (fetchError) throw fetchError;

    if (!draftRows?.length) {
      return NextResponse.json(
        { success: false, error: 'No draft data to save' },
        { status: 400 }
      );
    }

    // 3. Copy draft rows with the new version_id
    // Two-pass insert: parent rows first, then sub-lines with remapped parent_id
    const BATCH_SIZE = 100;

    const parentRows = draftRows.filter(r => !r.parent_id);
    const subLineRows = draftRows.filter(r => r.parent_id);

    function buildCopy(row) {
      return {
        branch_id: row.branch_id,
        department: row.department,
        year: row.year,
        row_order: row.row_order,
        account_code: row.account_code,
        account_name: row.account_name,
        full_label: row.full_label,
        row_type: row.row_type,
        indent_level: row.indent_level,
        jan: row.jan,
        feb: row.feb,
        mar: row.mar,
        apr: row.apr,
        may: row.may,
        jun: row.jun,
        jul: row.jul,
        aug: row.aug,
        sep: row.sep,
        oct: row.oct,
        nov: row.nov,
        dec: row.dec,
        admin_only: row.admin_only || false,
        pct_of_total: row.pct_of_total ?? null,
        pct_source: row.pct_source ?? null,
        monthly_increment: row.monthly_increment ?? null,
        increment_base_month: row.increment_base_month ?? null,
        cell_notes: row.cell_notes ?? {},
        version_id: version.id
      };
    }

    // Pass 1: Insert parent rows (no parent_id) and collect new IDs
    const parentCopies = parentRows.map(buildCopy);
    const oldParentIds = parentRows.map(r => r.id);
    const oldToNewId = {};

    for (let i = 0; i < parentCopies.length; i += BATCH_SIZE) {
      const batch = parentCopies.slice(i, i + BATCH_SIZE);
      const { data: inserted, error: insertError } = await supabase
        .from('pnl_line_items')
        .insert(batch)
        .select('id');

      if (insertError) throw insertError;

      // Map old IDs to new IDs by insert order
      for (let j = 0; j < inserted.length; j++) {
        oldToNewId[oldParentIds[i + j]] = inserted[j].id;
      }
    }

    // Pass 2: Insert sub-lines with remapped parent_id
    if (subLineRows.length > 0) {
      const subCopies = subLineRows.map(row => ({
        ...buildCopy(row),
        parent_id: oldToNewId[row.parent_id] || null
      }));

      for (let i = 0; i < subCopies.length; i += BATCH_SIZE) {
        const batch = subCopies.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase
          .from('pnl_line_items')
          .insert(batch);

        if (insertError) throw insertError;
      }
    }

    return NextResponse.json({
      success: true,
      version
    });
  } catch (error) {
    console.error('Save version error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
