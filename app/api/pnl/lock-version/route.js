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
    const { versionId, isLocked } = await request.json();

    if (!versionId || typeof isLocked !== 'boolean') {
      return NextResponse.json(
        { success: false, error: 'Missing versionId or isLocked' },
        { status: 400 }
      );
    }

    const { data, error } = await supabase
      .from('pnl_versions')
      .update({
        is_locked: isLocked,
        locked_at: isLocked ? new Date().toISOString() : null,
        updated_at: new Date().toISOString()
      })
      .eq('id', versionId)
      .select();

    if (error) throw error;

    if (!data?.length) {
      return NextResponse.json(
        { success: false, error: 'Version not found' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      version: data[0]
    });
  } catch (error) {
    console.error('Lock version error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
