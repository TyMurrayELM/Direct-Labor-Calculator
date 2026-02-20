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
    const { branchId, sourceDepartment, targetDepartment, year } = await request.json();

    if (!branchId || !sourceDepartment || !targetDepartment || !year) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: branchId, sourceDepartment, targetDepartment, year' },
        { status: 400 }
      );
    }

    if (sourceDepartment === targetDepartment) {
      return NextResponse.json(
        { success: false, error: 'Source and target departments must be different' },
        { status: 400 }
      );
    }

    // Fetch draft line items from the source department
    const { data: sourceRows, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('account_code, account_name, full_label, row_type, indent_level, row_order')
      .eq('branch_id', branchId)
      .eq('department', sourceDepartment)
      .eq('year', year)
      .is('version_id', null)
      .order('row_order');

    if (fetchError) throw fetchError;

    if (!sourceRows?.length) {
      return NextResponse.json(
        { success: false, error: `No draft line items found in source department "${sourceDepartment}"` },
        { status: 404 }
      );
    }

    // Delete any existing draft rows in the target department
    const { error: deleteError } = await supabase
      .from('pnl_line_items')
      .delete()
      .eq('branch_id', branchId)
      .eq('department', targetDepartment)
      .eq('year', year)
      .is('version_id', null);

    if (deleteError) throw deleteError;

    // Insert rows into target department with zero month values
    const BATCH_SIZE = 100;
    const rows = sourceRows.map(item => ({
      branch_id: branchId,
      department: targetDepartment,
      year: year,
      version_id: null,
      row_order: item.row_order,
      account_code: item.account_code || null,
      account_name: item.account_name,
      full_label: item.full_label,
      row_type: item.row_type,
      indent_level: item.indent_level || 0,
      jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0,
      jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0
    }));

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('pnl_line_items')
        .insert(batch);

      if (insertError) throw insertError;
    }

    // Create a pnl_imports record for the target department
    const { error: importError } = await supabase
      .from('pnl_imports')
      .upsert({
        branch_id: branchId,
        department: targetDepartment,
        year: year,
        file_name: `Copied from ${sourceDepartment}`,
        months_included: [],
        imported_at: new Date().toISOString()
      }, {
        onConflict: 'branch_id,department,year'
      });

    if (importError) throw importError;

    return NextResponse.json({
      success: true,
      rowCount: rows.length
    });
  } catch (error) {
    console.error('Copy structure error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
