import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole, isEditor } from '../../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

function parseKeys(searchParams) {
  const branchId = Number(searchParams.get('branchId'));
  const department = searchParams.get('department');
  const year = Number(searchParams.get('year'));
  const versionIdRaw = searchParams.get('versionId');
  const versionId = versionIdRaw && versionIdRaw !== 'null' ? Number(versionIdRaw) : null;
  return { branchId, department, year, versionId };
}

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const { branchId, department, year, versionId } = parseKeys(searchParams);

    if (!branchId || !department || !year) {
      return NextResponse.json({ success: false, error: 'Missing keys' }, { status: 400 });
    }

    const supabase = getSupabase();
    let query = supabase
      .from('pnl_summary_notes')
      .select('notes')
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year);
    query = versionId == null ? query.is('version_id', null) : query.eq('version_id', versionId);

    const { data, error } = await query.limit(1);
    if (error) throw error;

    return NextResponse.json({ success: true, notes: data?.[0]?.notes || '' });
  } catch (error) {
    console.error('Get summary note error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!role || !isEditor(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const body = await request.json();
    const branchId = Number(body.branchId);
    const department = body.department;
    const year = Number(body.year);
    const versionId = body.versionId == null ? null : Number(body.versionId);
    const notes = body.notes && body.notes.trim() ? body.notes : null;

    if (!branchId || !department || !year) {
      return NextResponse.json({ success: false, error: 'Missing keys' }, { status: 400 });
    }

    const supabase = getSupabase();

    // If a saved version, refuse when locked.
    if (versionId != null) {
      const { data: ver, error: vErr } = await supabase
        .from('pnl_versions')
        .select('id, is_locked')
        .eq('id', versionId)
        .limit(1);
      if (vErr) throw vErr;
      if (!ver?.length) {
        return NextResponse.json({ success: false, error: 'Version not found' }, { status: 404 });
      }
      if (ver[0].is_locked) {
        return NextResponse.json({ success: false, error: 'Cannot edit a locked version' }, { status: 403 });
      }
    }

    // Find existing row
    let findQuery = supabase
      .from('pnl_summary_notes')
      .select('id')
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year);
    findQuery = versionId == null ? findQuery.is('version_id', null) : findQuery.eq('version_id', versionId);
    const { data: existing, error: findError } = await findQuery.limit(1);
    if (findError) throw findError;

    if (existing?.length) {
      const { error: updateError } = await supabase
        .from('pnl_summary_notes')
        .update({ notes, updated_at: new Date().toISOString() })
        .eq('id', existing[0].id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase
        .from('pnl_summary_notes')
        .insert({ branch_id: branchId, department, year, version_id: versionId, notes });
      if (insertError) throw insertError;
    }

    return NextResponse.json({ success: true, notes: notes || '' });
  } catch (error) {
    console.error('Update summary note error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
