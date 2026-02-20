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
    const { lineItemId, pctOfTotal, pctSource } = await request.json();

    if (lineItemId == null) {
      return NextResponse.json(
        { success: false, error: 'Missing lineItemId' },
        { status: 400 }
      );
    }

    // Check the row exists and whether it's locked
    const { data: existing, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('id, version_id, row_type')
      .eq('id', lineItemId)
      .limit(1);

    if (fetchError) throw fetchError;
    if (!existing?.length) {
      return NextResponse.json(
        { success: false, error: 'Line item not found' },
        { status: 404 }
      );
    }

    const row = existing[0];

    if (row.row_type !== 'detail') {
      return NextResponse.json(
        { success: false, error: 'Only detail rows can use percentage mode' },
        { status: 400 }
      );
    }

    // If it belongs to a version, check lock status
    if (row.version_id !== null) {
      const { data: version, error: vError } = await supabase
        .from('pnl_versions')
        .select('is_locked')
        .eq('id', row.version_id)
        .limit(1);

      if (vError) throw vError;
      if (version?.[0]?.is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot edit a locked version' },
          { status: 403 }
        );
      }
    }

    // Update pct_of_total and pct_source (null to clear)
    const { error: updateError } = await supabase
      .from('pnl_line_items')
      .update({
        pct_of_total: pctOfTotal ?? null,
        pct_source: pctSource ?? null
      })
      .eq('id', lineItemId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Toggle pct mode error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
