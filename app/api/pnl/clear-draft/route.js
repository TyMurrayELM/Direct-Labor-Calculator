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
    const { branchId, department, year } = await request.json();

    if (!branchId || !department || !year) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: branchId, department, year' },
        { status: 400 }
      );
    }

    // Delete all draft line items (version_id IS NULL)
    const { error: delLines } = await supabase
      .from('pnl_line_items')
      .delete()
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year)
      .is('version_id', null);

    if (delLines) throw delLines;

    // Also clear the import record so the UI resets cleanly
    const { error: delImport } = await supabase
      .from('pnl_imports')
      .delete()
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year);

    if (delImport) throw delImport;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Clear draft error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
