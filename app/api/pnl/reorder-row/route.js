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
    const { lineItemId, newOrder } = await request.json();

    if (!lineItemId || !Array.isArray(newOrder) || newOrder.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing lineItemId or newOrder array' },
        { status: 400 }
      );
    }

    // Fetch the moved row to get its context (branch, dept, year, version)
    const { data: row, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('id, branch_id, department, year, version_id')
      .eq('id', lineItemId)
      .limit(1);

    if (fetchError) throw fetchError;
    if (!row?.length) {
      return NextResponse.json(
        { success: false, error: 'Line item not found' },
        { status: 404 }
      );
    }

    // If it belongs to a version, check lock status
    if (row[0].version_id !== null) {
      const { data: version, error: vError } = await supabase
        .from('pnl_versions')
        .select('is_locked')
        .eq('id', row[0].version_id)
        .limit(1);

      if (vError) throw vError;
      if (version?.[0]?.is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot reorder rows in a locked version' },
          { status: 403 }
        );
      }
    }

    // Update row_order for each item in the new order
    const CONCURRENT = 10;
    for (let i = 0; i < newOrder.length; i += CONCURRENT) {
      const batch = newOrder.slice(i, i + CONCURRENT);
      const results = await Promise.all(
        batch.map((id, batchIdx) =>
          supabase
            .from('pnl_line_items')
            .update({ row_order: i + batchIdx + 1 })
            .eq('id', id)
        )
      );
      for (const { error } of results) {
        if (error) throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reorder row error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
