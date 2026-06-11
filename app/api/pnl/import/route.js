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

    // Reject imports targeting a locked saved version (mirrors every other mutation endpoint)
    if (versionId) {
      const { data: targetVersion, error: lockErr } = await supabase
        .from('pnl_versions')
        .select('is_locked')
        .eq('id', versionId)
        .limit(1);
      if (lockErr) throw lockErr;
      if (targetVersion?.[0]?.is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot import into a locked version' },
          { status: 403 }
        );
      }
    }

    // 1a. Save ALL existing detail rows before deleting — preserves forecast values,
    // admin_only flags, pct modes, cell notes, AND full row data for forecast-only rows
    // (rows that exist in forecast but not in the actuals import)
    const allMonths = ['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'];
    const forecastMonths = allMonths.filter(m => !(months || []).includes(m));
    const savedForecast = new Map();
    const adminOnlyFlags = new Map();
    const pctModeFlags = new Map();
    const cellNotesMap = new Map();
    const savedFullRows = new Map(); // account_code -> full row data (for forecast-only rows)
    const savedRowOrder = new Map(); // `${row_type}:${account_code||full_label}` -> row_order
    const savedRowOrderByCode = new Map(); // bare account_code -> row_order (detail/header rows only)

    {
      // Fetch ALL existing rows to preserve row_order for every row type
      let allRowsQuery = supabase
        .from('pnl_line_items')
        .select('*')
        .eq('branch_id', branchId)
        .eq('department', department)
        .eq('year', year);
      allRowsQuery = versionId
        ? allRowsQuery.eq('version_id', versionId)
        : allRowsQuery.is('version_id', null);
      const { data: allExistingRows } = await allRowsQuery;

      if (allExistingRows) {
        // Save row_order for all rows. The key must include row_type: an
        // account_header and its "Total - ..." row share the same account_code,
        // so a bare-code key collapses both to one position and displaces the
        // header next to the total (or vice versa) on every re-import.
        for (const row of allExistingRows) {
          const codeOrLabel = row.account_code || row.full_label;
          if (codeOrLabel) {
            savedRowOrder.set(`${row.row_type}:${codeOrLabel}`, row.row_order);
            // Fallback for rows whose type changes between imports (an
            // account_header becomes a detail once it has postings, and back).
            // Totals are excluded so they can never claim a header/detail slot.
            if (
              row.account_code &&
              (row.row_type === 'detail' || row.row_type === 'account_header')
            ) {
              savedRowOrderByCode.set(row.account_code, row.row_order);
            }
          }
        }

        // Save detail-row-specific data (forecast, flags, etc.)
        for (const row of allExistingRows) {
          if (row.row_type !== 'detail' || !row.account_code) continue;

          // Save the full row (for re-inserting forecast-only rows later)
          savedFullRows.set(row.account_code, row);

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
    // Preserve existing row_order when updating actuals (only for actuals imports, not budget)
    const isActualsImport = months?.length > 0 && savedRowOrder.size > 0;
    const BATCH_SIZE = 100;
    const rows = lineItems.map(item => {
      const row = {
        branch_id: branchId,
        department: department,
        year: year,
        version_id: versionId || null,
        row_order: item.row_order, // temporary — will be fixed up below for actuals imports
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

    // 3a. Fold forecast-only rows (existed before but not in this import) into the same
    // rows list so they get sorted/renumbered alongside main rows — placed at their saved
    // row_order, not pushed to the bottom of the P&L.
    if (months?.length > 0 && savedFullRows.size > 0) {
      const importedCodes = new Set(lineItems.map(i => i.account_code).filter(Boolean));
      for (const [code, fullRow] of savedFullRows) {
        if (importedCodes.has(code)) continue;
        // Only restore rows that have non-zero forecast values worth keeping
        const hasForecastValues = forecastMonths.some(m => fullRow[m] !== 0 && fullRow[m] != null);
        if (!hasForecastValues) continue;

        const { id, created_at, ...rest } = fullRow;
        const restored = {
          ...rest,
          branch_id: branchId,
          department: department,
          year: year,
          version_id: versionId || null,
          // row_order kept from saved state; sort/renumber below will place it
        };
        // Zero out actual months (not in this import)
        for (const m of (months || [])) {
          restored[m] = 0;
        }
        rows.push(restored);
      }
    }

    // For actuals imports, preserve the user's manual row ordering.
    // Matched rows keep their saved position; new rows are interleaved
    // at the position indicated by their neighbors in the import file.
    // Finally, renumber sequentially to eliminate gaps and collisions.
    if (isActualsImport) {
      // Tag each row with its preserved order (if any) and original parser index
      const tagged = rows.map((row, parserIdx) => {
        const codeOrLabel = row.account_code || row.full_label;
        let preserved = codeOrLabel
          ? savedRowOrder.get(`${row.row_type}:${codeOrLabel}`)
          : undefined;
        // Type-transition fallback: a header that gained postings arrives as a
        // detail row (and vice versa) — match by bare code against non-total rows.
        if (
          preserved == null &&
          row.account_code &&
          (row.row_type === 'detail' || row.row_type === 'account_header')
        ) {
          preserved = savedRowOrderByCode.get(row.account_code);
        }
        return { row, parserIdx, preserved };
      });

      // For new rows (no preserved order), assign a synthetic order based on
      // the nearest preceding row that DOES have a preserved order.
      // This keeps new rows near where the import file placed them relative
      // to existing rows, without colliding with preserved positions.
      for (let i = 0; i < tagged.length; i++) {
        if (tagged[i].preserved != null) continue;
        // Find the nearest preceding row with a preserved order
        let precOrder = -1;
        let newAfterPrev = 0; // how many new rows since last preserved
        for (let j = i - 1; j >= 0; j--) {
          if (tagged[j].preserved != null) {
            precOrder = tagged[j].preserved;
            // Count how many unmatched rows are between j and i
            for (let k = j + 1; k <= i; k++) {
              if (tagged[k].preserved == null) newAfterPrev++;
            }
            break;
          }
          // Keep looking further back
        }
        // Place new row just after the preceding preserved row (with fractional offset)
        tagged[i].sortKey = precOrder + newAfterPrev * 0.001;
      }

      // Assign sortKey for preserved rows
      for (const t of tagged) {
        if (t.preserved != null) t.sortKey = t.preserved;
      }

      // Sort by sortKey (stable: parser order breaks ties)
      tagged.sort((a, b) => a.sortKey - b.sortKey || a.parserIdx - b.parserIdx);

      // Renumber sequentially
      for (let i = 0; i < tagged.length; i++) {
        tagged[i].row.row_order = i + 1;
      }

      // Put rows back in the renumbered order
      rows.length = 0;
      rows.push(...tagged.map(t => t.row));
    }

    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
      const batch = rows.slice(i, i + BATCH_SIZE);
      const { error: insertError } = await supabase
        .from('pnl_line_items')
        .insert(batch);

      if (insertError) throw insertError;
    }

    // Forecast-only rows are now folded into the main `rows` insert above, so they
    // land in their saved position via the sort/renumber pass — no separate restore step.
    const forecastOnlyRestored = rows.length - lineItems.length;

    // 4. Re-insert preserved sub-lines with updated parent_id and a row_order that
    //    places them immediately after the new parent's position.
    let subLinesRestored = 0;
    if (savedSubLines.size > 0) {
      // Look up new parent IDs + row_orders by account_code
      const parentCodes = [...savedSubLines.keys()];
      let lookupQuery = supabase
        .from('pnl_line_items')
        .select('id, account_code, row_order')
        .eq('branch_id', branchId)
        .eq('department', department)
        .eq('year', year)
        .eq('row_type', 'detail')
        .in('account_code', parentCodes);
      lookupQuery = versionId
        ? lookupQuery.eq('version_id', versionId)
        : lookupQuery.is('version_id', null);
      const { data: newParents } = await lookupQuery;

      const newParentByCode = new Map();
      for (const p of (newParents || [])) {
        if (p.account_code) newParentByCode.set(p.account_code, { id: p.id, row_order: p.row_order });
      }

      const subRows = [];
      for (const [parentCode, subs] of savedSubLines) {
        const newParent = newParentByCode.get(parentCode);
        if (!newParent) continue;
        // Synthetic row_order: parent.row_order * 1000 + (sub index). After all inserts
        // the final renumber pass collapses these inflated values into sequential integers
        // while keeping sub-lines adjacent to their parent.
        subs.forEach((sub, subIdx) => {
          const { id, parent_id, created_at, row_order, ...rest } = sub;
          subRows.push({
            ...rest,
            parent_id: newParent.id,
            row_order: newParent.row_order * 1000 + subIdx + 1,
          });
        });
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

    // 5. Final renumber pass: collapse any inflated row_orders (from sub-line placement)
    //    into a clean 1..N sequence so the table renders without gaps or holes.
    if (isActualsImport && subLinesRestored > 0) {
      let finalRowsQuery = supabase
        .from('pnl_line_items')
        .select('id, row_order')
        .eq('branch_id', branchId)
        .eq('department', department)
        .eq('year', year);
      finalRowsQuery = versionId
        ? finalRowsQuery.eq('version_id', versionId)
        : finalRowsQuery.is('version_id', null);

      // Paginate to avoid Supabase 1000-row cap on the read
      const allFinalRows = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data: page, error: pageErr } = await finalRowsQuery
          .order('row_order', { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (pageErr) {
          console.error('[import] Final renumber fetch error:', pageErr);
          break;
        }
        if (!page || page.length === 0) break;
        allFinalRows.push(...page);
        if (page.length < PAGE) break;
        offset += PAGE;
      }

      // Update row_order to sequential 1..N, only where it changed
      const RENUMBER_BATCH = 50;
      for (let i = 0; i < allFinalRows.length; i += RENUMBER_BATCH) {
        const slice = allFinalRows.slice(i, i + RENUMBER_BATCH);
        await Promise.all(
          slice.map((row, idxInSlice) => {
            const newOrder = i + idxInSlice + 1;
            if (row.row_order === newOrder) return Promise.resolve();
            return supabase
              .from('pnl_line_items')
              .update({ row_order: newOrder })
              .eq('id', row.id);
          })
        );
      }
      console.log(`[import] Final renumber: ${allFinalRows.length} rows`);
    }

    return NextResponse.json({
      success: true,
      rowCount: rows.length,
      months: months,
      forecastPreserved: savedForecast.size,
      forecastOnlyRestored,
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
