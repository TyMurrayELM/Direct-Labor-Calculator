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
    const { lineItemId, newOrder } = await request.json();

    if (!lineItemId || !Array.isArray(newOrder) || newOrder.length === 0) {
      return NextResponse.json(
        { success: false, error: 'Missing lineItemId or newOrder array' },
        { status: 400 }
      );
    }

    // Fetch the moved row to get its context (branch, dept, year, version)
    const { data: row, error: fetchError } = await supabase
      .from('pnl_line_items')
      .select('id, branch_id, department, year, version_id')
      .eq('id', lineItemId)
      .limit(1);

    if (fetchError) throw fetchError;
    if (!row?.length) {
      return NextResponse.json(
        { success: false, error: 'Line item not found' },
        { status: 404 }
      );
    }

    // If it belongs to a version, check lock status
    if (row[0].version_id !== null) {
      const { data: version, error: vError } = await supabase
        .from('pnl_versions')
        .select('is_locked')
        .eq('id', row[0].version_id)
        .limit(1);

      if (vError) throw vError;
      if (version?.[0]?.is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot reorder rows in a locked version' },
          { status: 403 }
        );
      }
    }

    // The client sends only the rows it can SEE (admin_only rows are hidden
    // from finance editors; collapsed sections and sub-lines are excluded),
    // so blindly renumbering newOrder to 1..N collides with the omitted rows'
    // stale orders and scatters them across sections. Instead, permute the
    // sent rows among the row_order slots they already occupy: the visible
    // drop order is honored exactly and unseen rows are never touched.
    let allRowsQuery = supabase
      .from('pnl_line_items')
      .select('id, row_order')
      .eq('branch_id', row[0].branch_id)
      .eq('department', row[0].department)
      .eq('year', row[0].year);
    allRowsQuery = row[0].version_id !== null
      ? allRowsQuery.eq('version_id', row[0].version_id)
      : allRowsQuery.is('version_id', null);
    const { data: allRows, error: allError } = await allRowsQuery
      .order('row_order', { ascending: true });

    if (allError) throw allError;

    const orderById = new Map((allRows || []).map(r => [r.id, r.row_order]));

    // Reject ids that don't belong to the dragged row's P&L (stale client
    // state or a forged request must not renumber another version's rows)
    const uniqueIds = new Set(newOrder);
    if (uniqueIds.size !== newOrder.length || newOrder.some(id => !orderById.has(id))) {
      return NextResponse.json(
        { success: false, error: 'newOrder contains duplicate or out-of-scope row ids' },
        { status: 400 }
      );
    }

    // Slots currently occupied by the sent rows, in ascending order
    const slots = (allRows || [])
      .filter(r => uniqueIds.has(r.id))
      .map(r => r.row_order);

    const updates = [];
    newOrder.forEach((id, i) => {
      if (orderById.get(id) !== slots[i]) {
        updates.push({ id, row_order: slots[i] });
      }
    });

    const CONCURRENT = 10;
    for (let i = 0; i < updates.length; i += CONCURRENT) {
      const batch = updates.slice(i, i + CONCURRENT);
      const results = await Promise.all(
        batch.map(u =>
          supabase
            .from('pnl_line_items')
            .update({ row_order: u.row_order })
            .eq('id', u.id)
        )
      );
      for (const { error } of results) {
        if (error) throw error;
      }
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Reorder row error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
