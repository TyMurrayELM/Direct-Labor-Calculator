import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function GET() {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('pnl_versions')
      .select('version_name');

    if (error) throw error;

    const names = [...new Set((data || []).map(r => r.version_name))].sort();

    return NextResponse.json({ success: true, names });
  } catch (error) {
    console.error('version-names GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
