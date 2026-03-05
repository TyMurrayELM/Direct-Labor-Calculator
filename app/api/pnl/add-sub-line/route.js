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
    const { parentLineItemId, label } = await request.json();

    if (!parentLineItemId || !label) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: parentLineItemId, label' },
        { status: 400 }
      );
    }

    // Validate parent exists and is a detail row
    const { data: parent, error: parentError } = await supabase
      .from('pnl_line_items')
      .select('*')
      .eq('id', parentLineItemId)
      .single();

    if (parentError || !parent) {
      return NextResponse.json(
        { success: false, error: 'Parent line item not found' },
        { status: 404 }
      );
    }

    if (parent.row_type !== 'detail') {
      return NextResponse.json(
        { success: false, error: 'Sub-lines can only be added to detail rows' },
        { status: 400 }
      );
    }

    // If targeting a version, check lock status
    if (parent.version_id) {
      const { data: version, error: vError } = await supabase
        .from('pnl_versions')
        .select('is_locked')
        .eq('id', parent.version_id)
        .limit(1);

      if (vError) throw vError;
      if (version?.[0]?.is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot add sub-lines to a locked version' },
          { status: 403 }
        );
      }
    }

    // Count existing sub-lines for this parent to determine row_order
    const { data: existingSubs, error: subsError } = await supabase
      .from('pnl_line_items')
      .select('id')
      .eq('parent_id', parentLineItemId)
      .eq('row_type', 'sub_line');

    if (subsError) throw subsError;

    const newRowOrder = (existingSubs?.length || 0) + 1;

    // Insert with row_type 'sub_line', parent_id, and indent_level = parent + 1
    const { data: newRow, error: insertError } = await supabase
      .from('pnl_line_items')
      .insert({
        branch_id: parent.branch_id,
        department: parent.department,
        year: parent.year,
        version_id: parent.version_id,
        row_order: newRowOrder,
        account_code: null,
        account_name: label,
        full_label: label,
        row_type: 'sub_line',
        indent_level: (parent.indent_level || 0) + 1,
        parent_id: parentLineItemId,
        jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0,
        jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0
      })
      .select()
      .single();

    if (insertError) throw insertError;

    return NextResponse.json({ success: true, lineItem: newRow });
  } catch (error) {
    console.error('Add sub-line error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
