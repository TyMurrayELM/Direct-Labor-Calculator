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
    const { lineItemId, label } = await request.json();

    if (!lineItemId || !label) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: lineItemId, label' },
        { status: 400 }
      );
    }

    // Fetch the row to verify it's a sub_line and check version lock
    const { data: row, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('id, row_type, version_id')
      .eq('id', lineItemId)
      .single();

    if (fetchError || !row) {
      return NextResponse.json(
        { success: false, error: 'Line item not found' },
        { status: 404 }
      );
    }

    if (row.row_type !== 'sub_line') {
      return NextResponse.json(
        { success: false, error: 'Can only rename sub-line rows' },
        { status: 400 }
      );
    }

    if (row.version_id) {
      const { data: version, error: vError } = await supabase
        .from('pnl_versions')
        .select('is_locked')
        .eq('id', row.version_id)
        .limit(1);

      if (vError) throw vError;
      if (version?.[0]?.is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot rename sub-lines in a locked version' },
          { status: 403 }
        );
      }
    }

    const { error: updateError } = await supabase
      .from('pnl_line_items')
      .update({ account_name: label, full_label: label })
      .eq('id', lineItemId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Rename sub-line error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
