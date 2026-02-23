import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole, isAdminRole } from '../../lib/getUserRole';

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
      .from('pnl_defaults')
      .select('default_version_name, compare_version_name')
      .eq('id', 1)
      .limit(1);

    if (error) throw error;

    return NextResponse.json({
      success: true,
      defaults: data?.[0] || { default_version_name: null, compare_version_name: null }
    });
  } catch (error) {
    console.error('pnl-defaults GET error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!role || !isAdminRole(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const { default_version_name, compare_version_name } = await request.json();

    const supabase = getSupabase();
    const { error } = await supabase
      .from('pnl_defaults')
      .upsert({
        id: 1,
        default_version_name: default_version_name || null,
        compare_version_name: compare_version_name || null,
        updated_at: new Date().toISOString()
      }, { onConflict: 'id' });

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('pnl-defaults POST error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
