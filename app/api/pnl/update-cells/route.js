import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole, isEditor } from '../../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const VALID_MONTHS = new Set([
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec'
]);

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!role || !isEditor(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { lineItemId, updates } = await request.json();

    if (!lineItemId || !updates || typeof updates !== 'object') {
      return NextResponse.json(
        { success: false, error: 'Missing lineItemId or updates' },
        { status: 400 }
      );
    }

    // Validate month keys
    const cleanUpdates = {};
    for (const [key, value] of Object.entries(updates)) {
      if (!VALID_MONTHS.has(key)) {
        return NextResponse.json(
          { success: false, error: `Invalid month key: ${key}` },
          { status: 400 }
        );
      }
      cleanUpdates[key] = parseFloat(value) || 0;
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

    // Update the row
    const { data: updated, error: updateError } = await supabase
      .from('pnl_line_items')
      .update(cleanUpdates)
      .eq('id', lineItemId)
      .select();

    if (updateError) throw updateError;

    return NextResponse.json({
      success: true,
      lineItem: updated?.[0]
    });
  } catch (error) {
    console.error('Update cells error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
