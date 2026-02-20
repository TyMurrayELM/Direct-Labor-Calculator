import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole } from '../../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!role) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { lineItemId, monthKey, noteText } = await request.json();

    if (lineItemId == null || !monthKey) {
      return NextResponse.json(
        { success: false, error: 'Missing lineItemId or monthKey' },
        { status: 400 }
      );
    }

    const validKeys = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec','_row'];
    if (!validKeys.includes(monthKey)) {
      return NextResponse.json(
        { success: false, error: 'Invalid monthKey' },
        { status: 400 }
      );
    }

    // Fetch the row
    const { data: existing, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('id, version_id, cell_notes')
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

    // Check version lock status
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

    // Merge the note into cell_notes
    const notes = row.cell_notes || {};
    if (noteText && noteText.trim()) {
      notes[monthKey] = noteText.trim();
    } else {
      delete notes[monthKey];
    }

    const { error: updateError } = await supabase
      .from('pnl_line_items')
      .update({ cell_notes: notes })
      .eq('id', lineItemId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, cell_notes: notes });
  } catch (error) {
    console.error('Update cell note error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
