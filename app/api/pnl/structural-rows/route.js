import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole } from '../../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

export async function GET(request) {
  try {
    const role = await getUserRole();
    if (!role) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const search = searchParams.get('search') || '';

    let query = supabase
      .from('pnl_line_items')
      .select('account_code, account_name, full_label, row_type, indent_level')
      .in('row_type', ['total', 'section_header', 'account_header', 'calculated'])
      .order('row_type')
      .order('account_name')
      .limit(1000);

    if (search) {
      query = query.ilike('account_name', `%${search}%`);
    }

    const { data, error } = await query;
    if (error) throw error;

    // Deduplicate by (row_type, account_name lowercase)
    const seen = new Set();
    const deduplicated = [];
    for (const row of data || []) {
      const key = `${row.row_type}:${(row.account_name || '').toLowerCase().trim()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      deduplicated.push(row);
    }

    return NextResponse.json({ success: true, rows: deduplicated.slice(0, 500) });
  } catch (error) {
    console.error('Structural rows error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
