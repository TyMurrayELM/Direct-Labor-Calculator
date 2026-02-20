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
    const { lineItemId } = await request.json();

    if (!lineItemId) {
      return NextResponse.json(
        { success: false, error: 'Missing required field: lineItemId' },
        { status: 400 }
      );
    }

    // Fetch the row to validate it exists and check version lock
    const { data: row, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('id, version_id')
      .eq('id', lineItemId)
      .limit(1);

    if (fetchError) throw fetchError;
    if (!row?.length) {
      return NextResponse.json(
        { success: false, error: 'Line item not found' },
        { status: 404 }
      );
    }

    // If it belongs to a saved version, check lock status
    const versionId = row[0].version_id;
    if (versionId) {
      const { data: version, error: vError } = await supabase
        .from('pnl_versions')
        .select('is_locked')
        .eq('id', versionId)
        .limit(1);

      if (vError) throw vError;
      if (version?.[0]?.is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot delete rows from a locked version' },
          { status: 403 }
        );
      }
    }

    // Delete the row
    const { error: deleteError } = await supabase
      .from('pnl_line_items')
      .delete()
      .eq('id', lineItemId);

    if (deleteError) throw deleteError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Delete line item error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
