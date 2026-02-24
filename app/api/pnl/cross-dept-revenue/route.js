import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole } from '../../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function normalizeTotalName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/^total\s*-\s*/, 'total ').trim();
}

/** Compute revenue totals from detail rows between Income header and Total Income */
function computeRevenueTotals(rows) {
  const sorted = [...rows].sort((a, b) => (a.row_order || 0) - (b.row_order || 0));

  // Find Income section header
  let headerIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].row_type === 'section_header' &&
        sorted[i].account_name?.toLowerCase().trim() === 'income') {
      headerIdx = i;
      break;
    }
  }
  if (headerIdx < 0) {
    const empty = {};
    for (const mk of MONTH_KEYS) empty[mk] = 0;
    return empty;
  }

  // Find Total Income row (first total after header)
  let totalIdx = sorted.length;
  for (let i = headerIdx + 1; i < sorted.length; i++) {
    if (sorted[i].row_type === 'total' &&
        normalizeTotalName(sorted[i].account_name) === 'total income') {
      totalIdx = i;
      break;
    }
    // Stop at next section header too
    if (sorted[i].row_type === 'section_header') {
      totalIdx = i;
      break;
    }
  }

  // Sum detail rows between header and total
  const totals = {};
  for (const mk of MONTH_KEYS) {
    let sum = 0;
    for (let i = headerIdx + 1; i < totalIdx; i++) {
      if (sorted[i].row_type === 'detail') {
        sum += parseFloat(sorted[i][mk]) || 0;
      }
    }
    totals[mk] = Math.round(sum * 100) / 100;
  }
  return totals;
}

/** Read values from the "Total - Direct Labor" row directly */
function computeDirectLaborTotals(rows) {
  const dlRow = rows.find(r =>
    r.row_type === 'total' &&
    normalizeTotalName(r.account_name) === 'total direct labor'
  );
  const totals = {};
  for (const mk of MONTH_KEYS) {
    totals[mk] = dlRow ? (Math.round((parseFloat(dlRow[mk]) || 0) * 100) / 100) : 0;
  }
  return totals;
}

export async function GET(request) {
  try {
    const role = await getUserRole();
    if (!role) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { searchParams } = new URL(request.url);
    const branchId = searchParams.get('branchId');
    const year = searchParams.get('year');

    if (!branchId || !year) {
      return NextResponse.json(
        { success: false, error: 'Missing branchId or year' },
        { status: 400 }
      );
    }

    const versionName = searchParams.get('versionName');

    // If a version name is provided, look up matching version IDs for maintenance depts
    const versionIdsByDept = {};
    if (versionName) {
      const { data: versions, error: vErr } = await supabase
        .from('pnl_versions')
        .select('id, department')
        .eq('branch_id', parseInt(branchId))
        .eq('year', parseInt(year))
        .eq('version_name', versionName)
        .in('department', ['maintenance', 'maintenance_onsite']);

      if (vErr) throw vErr;
      for (const v of (versions || [])) {
        versionIdsByDept[v.department] = v.id;
      }
    }

    // Fetch line items for both maintenance departments
    const departments = ['maintenance', 'maintenance_onsite'];
    const result = {};

    for (const dept of departments) {
      let q = supabase
        .from('pnl_line_items')
        .select('*')
        .eq('branch_id', parseInt(branchId))
        .eq('department', dept)
        .eq('year', parseInt(year))
        .order('row_order');

      if (versionName && versionIdsByDept[dept]) {
        q = q.eq('version_id', versionIdsByDept[dept]);
      } else {
        q = q.is('version_id', null);
      }

      const { data, error } = await q;
      if (error) throw error;

      const rows = data || [];
      console.log(`[cross-dept] ${dept} (version: ${versionName || 'draft'}): ${rows.length} rows`);

      result[dept] = {
        revenue: computeRevenueTotals(rows),
        directLabor: computeDirectLaborTotals(rows)
      };
    }

    return NextResponse.json({ success: true, departments: result });
  } catch (error) {
    console.error('Cross-dept revenue error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
