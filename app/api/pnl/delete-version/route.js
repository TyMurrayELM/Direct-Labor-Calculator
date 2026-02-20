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
    const { versionId } = await request.json();

    if (!versionId) {
      return NextResponse.json(
        { success: false, error: 'Missing versionId' },
        { status: 400 }
      );
    }

    // Check the version exists and is not locked
    const { data: version, error: fetchError } = await supabase
      .from('pnl_versions')
      .select('id, is_locked, version_name')
      .eq('id', versionId)
      .limit(1);

    if (fetchError) throw fetchError;

    if (!version?.length) {
      return NextResponse.json(
        { success: false, error: 'Version not found' },
        { status: 404 }
      );
    }

    if (version[0].is_locked) {
      return NextResponse.json(
        { success: false, error: `Version "${version[0].version_name}" is locked and cannot be deleted` },
        { status: 403 }
      );
    }

    // Delete line items first, then the version record
    const { error: delLines } = await supabase
      .from('pnl_line_items')
      .delete()
      .eq('version_id', versionId);

    if (delLines) throw delLines;

    const { error: delVersion } = await supabase
      .from('pnl_versions')
      .delete()
      .eq('id', versionId);

    if (delVersion) throw delVersion;

    return NextResponse.json({
      success: true,
      deletedVersionName: version[0].version_name
    });
  } catch (error) {
    console.error('Delete version error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
