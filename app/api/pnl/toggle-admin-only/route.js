import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole, isAdminRole } from '../../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!role || !isAdminRole(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { lineItemId, adminOnly } = await request.json();

    if (lineItemId == null || typeof adminOnly !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Missing lineItemId or adminOnly (boolean)' },
        { status: 400 }
      );
    }

    // Check the row exists and whether it's locked
    const { data: existing, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('id, version_id')
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

    // Update the admin_only flag
    const { error: updateError } = await supabase
      .from('pnl_line_items')
      .update({ admin_only: adminOnly })
      .eq('id', lineItemId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Toggle admin_only error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
