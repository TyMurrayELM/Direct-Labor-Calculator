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

/** Sum detail rows between "Direct Labor" account_header and "Total - Direct Labor" total.
 *  Falls back to reading the total row directly if it has non-zero values. */
function computeDirectLaborTotals(rows) {
  const sorted = [...rows].sort((a, b) => (a.row_order || 0) - (b.row_order || 0));

  // Find the Direct Labor header (can be section_header or account_header)
  let headerIdx = -1;
  for (let i = 0; i < sorted.length; i++) {
    if ((sorted[i].row_type === 'account_header' || sorted[i].row_type === 'section_header') &&
        sorted[i].account_name?.toLowerCase().trim() === 'direct labor') {
      headerIdx = i;
      break;
    }
  }

  // Find the Total - Direct Labor row
  const dlTotalIdx = sorted.findIndex(r =>
    r.row_type === 'total' && normalizeTotalName(r.account_name) === 'total direct labor'
  );

  // If we found both header and total, sum detail rows between them
  if (headerIdx >= 0 && dlTotalIdx > headerIdx) {
    const totals = {};
    for (const mk of MONTH_KEYS) {
      let sum = 0;
      for (let i = headerIdx + 1; i < dlTotalIdx; i++) {
        if (sorted[i].row_type === 'detail') {
          sum += parseFloat(sorted[i][mk]) || 0;
        }
      }
      totals[mk] = Math.round(sum * 100) / 100;
    }
    return totals;
  }

  // Fallback: read the total row directly (if it has values)
  if (dlTotalIdx >= 0) {
    const dlRow = sorted[dlTotalIdx];
    const totals = {};
    for (const mk of MONTH_KEYS) {
      totals[mk] = Math.round((parseFloat(dlRow[mk]) || 0) * 100) / 100;
    }
    return totals;
  }

  const empty = {};
  for (const mk of MONTH_KEYS) empty[mk] = 0;
  return empty;
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
    const callingDepartment = searchParams.get('department'); // e.g. 'irrigation'
    const branchIdInt = parseInt(branchId);

    // For Phoenix parent branch, aggregate maintenance data across sub-branches
    // Exception: irrigation only uses the current branch's own maintenance data
    let targetBranchIds = [branchIdInt];
    if (callingDepartment !== 'irrigation') {
      const { data: branchRecord } = await supabase
        .from('branches')
        .select('name')
        .eq('id', branchIdInt)
        .single();

      if (branchRecord?.name === 'Phoenix' || branchRecord?.name === 'Corporate') {
        // Find all Phoenix sub-branches (Phx - North, etc.)
        const { data: subBranches } = await supabase
          .from('branches')
          .select('id, name')
          .neq('id', branchIdInt);

        const phxSubs = (subBranches || []).filter(b =>
          b.name.toLowerCase().includes('phx') ||
          (b.name.toLowerCase().includes('phoenix') && b.id !== branchIdInt)
        );
        if (phxSubs.length > 0) {
          targetBranchIds = phxSubs.map(b => b.id);
        }
      }
    }

    // If a version name is provided, look up matching version IDs for maintenance depts
    const versionIdsByBranchDept = {};
    if (versionName) {
      // Look for versions at both sub-branch and parent level
      const lookupBranchIds = [...targetBranchIds];
      if (!lookupBranchIds.includes(branchIdInt)) lookupBranchIds.push(branchIdInt);

      const { data: versions, error: vErr } = await supabase
        .from('pnl_versions')
        .select('id, branch_id, department')
        .in('branch_id', lookupBranchIds)
        .eq('year', parseInt(year))
        .eq('version_name', versionName)
        .in('department', ['maintenance', 'maintenance_onsite']);

      if (vErr) throw vErr;
      console.log(`[cross-dept] version lookup for "${versionName}" at branches [${lookupBranchIds}]:`, (versions || []).map(v => `${v.branch_id}-${v.department}=${v.id}`));
      for (const v of (versions || [])) {
        const key = `${v.branch_id}-${v.department}`;
        versionIdsByBranchDept[key] = v.id;
      }
    }

    // Fetch line items for both maintenance departments across all target branches
    const departments = ['maintenance', 'maintenance_onsite'];
    const result = {};

    for (const dept of departments) {
      let allRows = [];

      for (const bid of targetBranchIds) {
        let q = supabase
          .from('pnl_line_items')
          .select('*')
          .eq('branch_id', bid)
          .eq('department', dept)
          .eq('year', parseInt(year))
          .order('row_order');

        const vKey = `${bid}-${dept}`;
        if (versionName && versionIdsByBranchDept[vKey]) {
          q = q.eq('version_id', versionIdsByBranchDept[vKey]);
        } else {
          q = q.is('version_id', null);
        }

        const { data, error } = await q;
        if (error) throw error;
        let rows = data || [];
        const usedVersionId = versionIdsByBranchDept[vKey] || 'draft';
        console.log(`[cross-dept] ${dept} branch=${bid} version=${usedVersionId}: ${rows.length} rows`);

        // Fallback: if draft returned 0 rows, try the latest version for this branch+dept
        if (rows.length === 0 && !versionIdsByBranchDept[vKey]) {
          const { data: latestVersion } = await supabase
            .from('pnl_versions')
            .select('id, version_name')
            .eq('branch_id', bid)
            .eq('department', dept)
            .eq('year', parseInt(year))
            .order('created_at', { ascending: false })
            .limit(1);

          if (latestVersion?.length) {
            const { data: fallbackData, error: fbErr } = await supabase
              .from('pnl_line_items')
              .select('*')
              .eq('branch_id', bid)
              .eq('department', dept)
              .eq('year', parseInt(year))
              .eq('version_id', latestVersion[0].id)
              .order('row_order');
            if (fbErr) throw fbErr;
            rows = fallbackData || [];
            console.log(`[cross-dept] ${dept} branch=${bid} fallback to version "${latestVersion[0].version_name}" (${latestVersion[0].id}): ${rows.length} rows`);
          }
        }

        allRows = allRows.concat(rows);
      }

      console.log(`[cross-dept] ${dept} (version: ${versionName || 'draft'}, branches: ${targetBranchIds.join(',')}): ${allRows.length} total rows`);

      if (targetBranchIds.length > 1 && allRows.length > 0) {
        // Multiple branches: sum revenue/labor totals across branches
        const branchResults = {};
        for (const bid of targetBranchIds) {
          const branchRows = allRows.filter(r => r.branch_id === bid);
          if (branchRows.length > 0) {
            branchResults[bid] = {
              revenue: computeRevenueTotals(branchRows),
              directLabor: computeDirectLaborTotals(branchRows)
            };
          }
        }
        // Log per-branch revenue for debugging
        for (const [bid, br] of Object.entries(branchResults)) {
          const revTotal = MONTH_KEYS.reduce((s, mk) => s + (br.revenue[mk] || 0), 0);
          console.log(`[cross-dept] ${dept} branch=${bid} revenue total=$${Math.round(revTotal).toLocaleString()}`);
        }
        // Sum across branches
        const summed = { revenue: {}, directLabor: {}, byBranch: {} };
        for (const mk of MONTH_KEYS) {
          summed.revenue[mk] = 0;
          summed.directLabor[mk] = 0;
          for (const bid of targetBranchIds) {
            if (branchResults[bid]) {
              summed.revenue[mk] += branchResults[bid].revenue[mk] || 0;
              summed.directLabor[mk] += branchResults[bid].directLabor[mk] || 0;
            }
          }
          summed.revenue[mk] = Math.round(summed.revenue[mk] * 100) / 100;
          summed.directLabor[mk] = Math.round(summed.directLabor[mk] * 100) / 100;
        }
        // Include per-branch breakdown
        for (const bid of targetBranchIds) {
          if (branchResults[bid]) {
            summed.byBranch[bid] = branchResults[bid];
          }
        }
        result[dept] = summed;
      } else {
        result[dept] = {
          revenue: computeRevenueTotals(allRows),
          directLabor: computeDirectLaborTotals(allRows)
        };
      }
    }

    // Include branch name map for multi-branch results
    let branchNames = null;
    if (targetBranchIds.length > 1) {
      const { data: branchData } = await supabase
        .from('branches')
        .select('id, name')
        .in('id', targetBranchIds);
      branchNames = {};
      for (const b of (branchData || [])) {
        branchNames[b.id] = b.name;
      }
    }

    return NextResponse.json({ success: true, departments: result, branchNames });
  } catch (error) {
    console.error('Cross-dept revenue error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
