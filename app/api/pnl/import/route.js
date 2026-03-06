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
    const { branchId, department, year, fileName, months, lineItems, versionId } = await request.json();

    if (!branchId || !department || !year || !lineItems?.length) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: branchId, department, year, lineItems' },
        { status: 400 }
      );
    }

    // 1a. Save existing draft forecast values and admin_only flags before deleting
    const allMonths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const forecastMonths = allMonths.filter(m => !(months || []).includes(m));
    const savedForecast = new Map();
    const adminOnlyFlags = new Map();
    const pctModeFlags = new Map();
    const cellNotesMap = new Map();

    {
      let fetchQuery = supabase
        .from('pnl_line_items')
        .select(`account_code, admin_only, pct_of_total, pct_source, cell_notes${forecastMonths.length > 0 ? ', ' + forecastMonths.join(', ') : ''}`)
        .eq('branch_id', branchId)
        .eq('department', department)
        .eq('year', year)
        .eq('row_type', 'detail')
        .not('account_code', 'is', null);
      fetchQuery = versionId
        ? fetchQuery.eq('version_id', versionId)
        : fetchQuery.is('version_id', null);
      const { data: existingRows } = await fetchQuery;

      if (existingRows) {
        for (const row of existingRows) {
          // Preserve admin_only flags
          if (row.admin_only) {
            adminOnlyFlags.set(row.account_code, true);
          }
          // Preserve pct_of_total mode
          if (row.pct_of_total != null) {
            pctModeFlags.set(row.account_code, {
              pct_of_total: row.pct_of_total,
              pct_source: row.pct_source
            });
          }
          // Preserve cell notes
          if (row.cell_notes && Object.keys(row.cell_notes).length > 0) {
            cellNotesMap.set(row.account_code, row.cell_notes);
          }
          // Preserve forecast values
          if (forecastMonths.length > 0) {
            const vals = {};
            for (const m of forecastMonths) {
              if (row[m] !== 0 && row[m] != null) vals[m] = row[m];
            }
            if (Object.keys(vals).length > 0) {
              savedForecast.set(row.account_code, vals);
            }
          }
        }
      }
    }

    // 1c. Save existing sub-lines (keyed by parent account_code) before deleting
    const savedSubLines = new Map(); // parentAccountCode -> subLine rows[]
    {
      let subQuery = supabase
        .from('pnl_line_items')
        .select('*')
        .eq('branch_id', branchId)
        .eq('department', department)
        .eq('year', year)
        .eq('row_type', 'sub_line')
        .not('parent_id', 'is', null);
      subQuery = versionId
        ? subQuery.eq('version_id', versionId)
        : subQuery.is('version_id', null);
      const { data: subRows } = await subQuery;

      if (subRows?.length) {
        // Look up parent account_codes for each sub-line
        const parentIds = [...new Set(subRows.map(s => s.parent_id))];
        let parentQuery = supabase
          .from('pnl_line_items')
          .select('id, account_code')
          .in('id', parentIds);
        const { data: parentRows } = await parentQuery;
        const parentCodeById = new Map();
        for (const p of (parentRows || [])) {
          if (p.account_code) parentCodeById.set(p.id, p.account_code);
        }

        for (const sub of subRows) {
          const parentCode = parentCodeById.get(sub.parent_id);
          if (!parentCode) continue;
          if (!savedSubLines.has(parentCode)) savedSubLines.set(parentCode, []);
          savedSubLines.get(parentCode).push(sub);
        }
        console.log(`[import] Preserved ${subRows.length} sub-lines across ${savedSubLines.size} parent rows`);
      }
    }

    // 1d. Delete existing line items for the target version
    let deleteQuery = supabase
      .from('pnl_line_items')
      .delete()
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year);
    deleteQuery = versionId
      ? deleteQuery.eq('version_id', versionId)
      : deleteQuery.is('version_id', null);
    const { error: deleteError } = await deleteQuery;

    if (deleteError) throw deleteError;

    // 2. Upsert the import record
    // Budget imports (months=[]) reset months_included so the UI doesn't
    // carry over "actual" month styling from a prior actuals import.
    // Actuals imports set months_included to their specific months.
    const upsertData = {
      branch_id: branchId,
      department: department,
      year: year,
      file_name: fileName,
      imported_at: new Date().toISOString(),
      months_included: months || []
    };

    const { error: importError } = await supabase
      .from('pnl_imports')
      .upsert(upsertData, {
        onConflict: 'branch_id,department,year'
      });

    if (importError) throw importError;

    // 3. Insert line items in batches (Supabase has row limits per insert)
    const BATCH_SIZE = 100;
    const rows = lineItems.map(item => {
      const row = {
        branch_id: branchId,
        department: department,
        year: year,
        version_id: versionId || null,
        row_order: item.row_order,
        account_code: item.account_code || null,
        account_name: item.account_name,
        full_label: item.full_label,
        row_type: item.row_type,
        indent_level: item.indent_level || 0,
        admin_only: false,
        jan: item.jan || 0,
        feb: item.feb || 0,
        mar: item.mar || 0,
        apr: item.apr || 0,
        may: item.may || 0,
        jun: item.jun || 0,
        jul: item.jul || 0,
        aug: item.aug || 0,
        sep: item.sep || 0,
        oct: item.oct || 0,
        nov: item.nov || 0,
        dec: item.dec || 0
      };

      // Merge saved forecast values for matching accounts (only when there are actual months;
      // budget imports send months=[] meaning all data is new and should not be overwritten)
      if (months?.length > 0 && item.account_code && savedForecast.has(item.account_code)) {
        const saved = savedForecast.get(item.account_code);
        for (const m of forecastMonths) {
          if (saved[m] != null) row[m] = saved[m];
        }
      }

      // Preserve admin_only flag for matching accounts
      if (item.account_code && adminOnlyFlags.has(item.account_code)) {
        row.admin_only = true;
      }

      // Preserve pct_of_total mode for matching accounts
      if (item.account_code && pctModeFlags.has(item.account_code)) {
        const pctData = pctModeFlags.get(item.account_code);
        row.pct_of_total = pctData.pct_of_total;
        row.pct_source = pctData.pct_source;
      }

      // Preserve cell notes for matching accounts
      if (item.account_code && cellNotesMap.has(item.account_code)) {
        row.cell_notes = cellNotesMap.get(item.account_code);
      }

      return row;
    });

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('pnl_line_items')
        .insert(batch);

      if (insertError) throw insertError;
    }

    // 4. Re-insert preserved sub-lines with updated parent_id references
    let subLinesRestored = 0;
    if (savedSubLines.size > 0) {
      // Look up new parent IDs by account_code
      const parentCodes = [...savedSubLines.keys()];
      let lookupQuery = supabase
        .from('pnl_line_items')
        .select('id, account_code')
        .eq('branch_id', branchId)
        .eq('department', department)
        .eq('year', year)
        .eq('row_type', 'detail')
        .in('account_code', parentCodes);
      lookupQuery = versionId
        ? lookupQuery.eq('version_id', versionId)
        : lookupQuery.is('version_id', null);
      const { data: newParents } = await lookupQuery;

      const newParentIdByCode = new Map();
      for (const p of (newParents || [])) {
        if (p.account_code) newParentIdByCode.set(p.account_code, p.id);
      }

      const subRows = [];
      for (const [parentCode, subs] of savedSubLines) {
        const newParentId = newParentIdByCode.get(parentCode);
        if (!newParentId) continue;
        for (const sub of subs) {
          const { id, parent_id, created_at, ...rest } = sub;
          subRows.push({ ...rest, parent_id: newParentId });
        }
      }

      if (subRows.length > 0) {
        for (let i = 0; i < subRows.length; i += BATCH_SIZE) {
          const batch = subRows.slice(i, i + BATCH_SIZE);
          const { error: subErr } = await supabase
            .from('pnl_line_items')
            .insert(batch);
          if (subErr) {
            console.error('[import] Sub-line restore error:', subErr);
          } else {
            subLinesRestored += batch.length;
          }
        }
        console.log(`[import] Restored ${subLinesRestored} sub-lines`);
      }
    }

    return NextResponse.json({
      success: true,
      rowCount: rows.length,
      months: months,
      forecastPreserved: savedForecast.size,
      subLinesRestored
    });
  } catch (error) {
    console.error('P&L import error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
