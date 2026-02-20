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
    const {
      branchId, department, year, versionId,
      accountCode, accountName, fullLabel, rowType, indentLevel,
      insertBeforeId
    } = await request.json();

    if (!branchId || !department || !year || !accountName) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // If targeting a version, check lock status
    if (versionId) {
      const { data: version, error: vError } = await supabase
        .from('pnl_versions')
        .select('is_locked')
        .eq('id', versionId)
        .limit(1);

      if (vError) throw vError;
      if (version?.[0]?.is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot add rows to a locked version' },
          { status: 403 }
        );
      }
    }

    // Fetch all rows to determine insertion position
    let query = supabase
      .from('pnl_line_items')
      .select('id, row_order')
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year)
      .order('row_order');

    query = versionId
      ? query.eq('version_id', versionId)
      : query.is('version_id', null);

    const { data: existingRows, error: fetchError } = await query;
    if (fetchError) throw fetchError;

    // Determine row_order: insert before the specified row, or at the end
    let newRowOrder;
    if (insertBeforeId && existingRows?.length) {
      const beforeRow = existingRows.find(r => r.id === insertBeforeId);
      newRowOrder = beforeRow ? beforeRow.row_order : (existingRows.length + 1);

      // Shift all rows at or after the insertion point
      if (beforeRow) {
        const toShift = existingRows.filter(r => r.row_order >= newRowOrder);
        for (const row of toShift) {
          const { error } = await supabase
            .from('pnl_line_items')
            .update({ row_order: row.row_order + 1 })
            .eq('id', row.id);
          if (error) throw error;
        }
      }
    } else {
      newRowOrder = (existingRows?.length || 0) + 1;
    }

    // Insert the new row with zero values
    const { data: newRow, error: insertError } = await supabase
      .from('pnl_line_items')
      .insert({
        branch_id: branchId,
        department,
        year,
        version_id: versionId || null,
        row_order: newRowOrder,
        account_code: accountCode || null,
        account_name: accountName,
        full_label: fullLabel || accountName,
        row_type: rowType || 'detail',
        indent_level: indentLevel || 0,
        jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0,
        jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ success: true, lineItem: newRow });
  } catch (error) {
    console.error('Add line item error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
