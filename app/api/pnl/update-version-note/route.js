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
    const { versionId, noteText } = await request.json();

    if (versionId == null) {
      return NextResponse.json(
        { success: false, error: 'Missing versionId' },
        { status: 400 }
      );
    }

    // Fetch version and check lock
    const { data: existing, error: fetchError } = await supabase
      .from('pnl_versions')
      .select('id, is_locked')
      .eq('id', versionId)
      .limit(1);

    if (fetchError) throw fetchError;
    if (!existing?.length) {
      return NextResponse.json(
        { success: false, error: 'Version not found' },
        { status: 404 }
      );
    }

    if (existing[0].is_locked) {
      return NextResponse.json(
        { success: false, error: 'Cannot edit a locked version' },
        { status: 403 }
      );
    }

    const notes = noteText && noteText.trim() ? noteText.trim() : null;

    const { error: updateError } = await supabase
      .from('pnl_versions')
      .update({ notes })
      .eq('id', versionId);

    if (updateError) throw updateError;

    return NextResponse.json({ success: true, notes });
  } catch (error) {
    console.error('Update version note error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
