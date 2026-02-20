import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getUserRole, isEditor } from '../../../lib/getUserRole';

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
}

const ALL_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Normalize total-row names so "Total - Income" and "Total Income" both become "total income" */
function normalizeTotalName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/^total\s*-\s*/, 'total ').trim();
}

/** Walk backwards from a total row to find its matching section/account header by name */
function findMatchingHeader(totalRow, sortedRows, totalIdx) {
  const sectionName = normalizeTotalName(totalRow.account_name).replace(/^total\s*/, '').trim();
  if (!sectionName) return -1;

  for (let i = totalIdx - 1; i >= 0; i--) {
    const r = sortedRows[i];
    if (r.row_type === 'section_header' || r.row_type === 'account_header') {
      if (r.account_name && r.account_name.toLowerCase().trim() === sectionName) {
        return i;
      }
    }
  }
  return -1;
}

export async function POST(request) {
  try {
    const role = await getUserRole();
    if (!role || !isEditor(role)) {
      return NextResponse.json({ success: false, error: 'Forbidden' }, { status: 403 });
    }

    const supabase = getSupabase();
    const { branchId, department, year, sourceVersionId, targetVersionId } = await request.json();

    if (!branchId || !department || !year || !sourceVersionId) {
      return NextResponse.json(
        { success: false, error: 'Missing required fields: branchId, department, year, sourceVersionId' },
        { status: 400 }
      );
    }

    // 1. Determine actual months based on target (draft vs saved version)
    let actualMonthCount = 0;

    if (targetVersionId) {
      const { data: version, error: vError } = await supabase
        .from('pnl_versions')
        .select('actual_months, is_locked')
        .eq('id', targetVersionId)
        .limit(1);

      if (vError) throw vError;
      if (!version?.length) {
        return NextResponse.json(
          { success: false, error: 'Target version not found' },
          { status: 404 }
        );
      }
      if (version[0].is_locked) {
        return NextResponse.json(
          { success: false, error: 'Cannot modify a locked version' },
          { status: 403 }
        );
      }
      actualMonthCount = version[0].actual_months || 0;
    } else {
      const { data: importRecord, error: importError } = await supabase
        .from('pnl_imports')
        .select('months_included')
        .eq('branch_id', branchId)
        .eq('department', department)
        .eq('year', year)
        .limit(1);

      if (importError) throw importError;
      actualMonthCount = importRecord?.[0]?.months_included?.length || 0;
    }

    // 2. Compute forecast months
    const forecastMonths = ALL_MONTHS.slice(actualMonthCount);

    if (forecastMonths.length === 0) {
      return NextResponse.json({
        success: true,
        updatedCount: 0,
        message: 'All 12 months are actuals — nothing to fill'
      });
    }

    // 3. Fetch target line items
    let targetQuery = supabase
      .from('pnl_line_items')
      .select('*')
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year);

    if (targetVersionId) {
      targetQuery = targetQuery.eq('version_id', targetVersionId);
    } else {
      targetQuery = targetQuery.is('version_id', null);
    }

    const { data: targetRows, error: targetError } = await targetQuery;
    if (targetError) throw targetError;

    // 4. Fetch source version line items
    const { data: sourceRows, error: sourceError } = await supabase
      .from('pnl_line_items')
      .select('*')
      .eq('branch_id', branchId)
      .eq('department', department)
      .eq('year', year)
      .eq('version_id', sourceVersionId);

    if (sourceError) throw sourceError;

    if (!sourceRows?.length) {
      return NextResponse.json(
        { success: false, error: 'Source version has no line items' },
        { status: 404 }
      );
    }

    // 5. Build source lookups: by account_code, exact name, and normalized name
    const sourceByCode = {};
    const sourceByName = {};
    const sourceByNormName = {};

    for (const row of sourceRows) {
      if (row.account_code) {
        sourceByCode[row.account_code] = row;
      }
      if (row.account_name) {
        sourceByName[row.account_name.toLowerCase()] = row;
        const norm = normalizeTotalName(row.account_name);
        if (!sourceByNormName[norm]) {
          sourceByNormName[norm] = row;
        }
      }
    }

    // 6. Build in-memory working copies with forecast months filled from source
    const workingRows = targetRows.map(row => ({ ...row }));
    const matchedSourceIds = new Set();

    for (const row of workingRows) {
      const sourceRow =
        (row.account_code && sourceByCode[row.account_code]) ||
        (row.account_name && sourceByName[row.account_name.toLowerCase()]) ||
        (row.account_name && sourceByNormName[normalizeTotalName(row.account_name)]) ||
        null;

      if (!sourceRow) continue;
      matchedSourceIds.add(sourceRow.id);

      for (const month of forecastMonths) {
        row[month] = sourceRow[month] ?? 0;
      }

      // Copy pct_of_total mode from source if target doesn't have it set
      if (sourceRow.pct_of_total != null && row.pct_of_total == null) {
        row.pct_of_total = sourceRow.pct_of_total;
        row.pct_source = sourceRow.pct_source;
      }
    }

    // 7. Recalculate intermediate totals (bottom-up)
    workingRows.sort((a, b) => (a.row_order || 0) - (b.row_order || 0));

    const totalIndices = [];
    for (let i = 0; i < workingRows.length; i++) {
      if (workingRows[i].row_type === 'total') totalIndices.push(i);
    }

    for (let t = totalIndices.length - 1; t >= 0; t--) {
      const totalIdx = totalIndices[t];
      const totalRow = workingRows[totalIdx];
      const headerIdx = findMatchingHeader(totalRow, workingRows, totalIdx);
      if (headerIdx < 0) continue;

      for (const month of forecastMonths) {
        let sum = 0;
        for (let i = headerIdx + 1; i < totalIdx; i++) {
          if (workingRows[i].row_type === 'detail') {
            sum += parseFloat(workingRows[i][month]) || 0;
          }
        }
        totalRow[month] = Math.round(sum * 100) / 100;
      }
    }

    // 8. Diff against originals and batch-write only changed rows
    const originalById = {};
    for (const row of targetRows) {
      originalById[row.id] = row;
    }

    const dbUpdates = [];
    for (const row of workingRows) {
      const orig = originalById[row.id];
      if (!orig) continue;

      const changed = {};
      let hasChanges = false;
      for (const month of forecastMonths) {
        const newVal = row[month] ?? 0;
        const oldVal = orig[month] ?? 0;
        if (newVal !== oldVal) {
          changed[month] = newVal;
          hasChanges = true;
        }
      }
      // Include pct_of_total/pct_source changes
      if ((row.pct_of_total ?? null) !== (orig.pct_of_total ?? null)) {
        changed.pct_of_total = row.pct_of_total ?? null;
        changed.pct_source = row.pct_source ?? null;
        hasChanges = true;
      }
      if (hasChanges) {
        dbUpdates.push({ id: row.id, changes: changed });
      }
    }

    const CONCURRENT = 10;
    for (let i = 0; i < dbUpdates.length; i += CONCURRENT) {
      const batch = dbUpdates.slice(i, i + CONCURRENT);
      const results = await Promise.all(
        batch.map(({ id, changes }) =>
          supabase.from('pnl_line_items').update(changes).eq('id', id)
        )
      );
      for (const { error } of results) {
        if (error) throw error;
      }
    }

    const updatedCount = dbUpdates.length;

    // 9. Insert unmatched source DETAIL rows only into the correct position
    const unmatchedRows = sourceRows.filter(
      r => !matchedSourceIds.has(r.id) && r.row_type === 'detail'
    );
    let insertedCount = 0;

    if (unmatchedRows.length > 0) {
      const forecastSet = new Set(forecastMonths);

      // Build target lookups using working rows (up-to-date state)
      const targetByCode = {};
      const targetByName = {};
      const targetByNormName = {};
      for (const row of workingRows) {
        if (row.account_code) targetByCode[row.account_code] = row;
        if (row.account_name) {
          targetByName[row.account_name.toLowerCase()] = row;
          const norm = normalizeTotalName(row.account_name);
          if (!targetByNormName[norm]) targetByNormName[norm] = row;
        }
      }

      // Source rows in P&L order
      const sourceSorted = [...sourceRows].sort((a, b) => (a.row_order || 0) - (b.row_order || 0));

      // Find the section a budget row belongs to, then locate the matching
      // section total in the target so we can insert just before it.
      const findSectionTotalId = (unmatchedSrc) => {
        const idx = sourceSorted.findIndex(r => r.id === unmatchedSrc.id);
        // Walk backwards in the budget to find the nearest section_header
        let sectionName = null;
        for (let i = idx - 1; i >= 0; i--) {
          if (sourceSorted[i].row_type === 'section_header') {
            sectionName = sourceSorted[i].account_name?.toLowerCase().trim();
            break;
          }
        }
        if (!sectionName) return null;

        // Find the matching section total in the target (e.g., "Total - Cost of Goods Sold")
        for (const row of workingRows) {
          if (row.row_type === 'total') {
            const totalSection = normalizeTotalName(row.account_name).replace(/^total\s*/, '').trim();
            if (totalSection === sectionName) return row.id;
          }
        }
        return null;
      };

      const unmatchedSet = new Set(unmatchedRows.map(r => r.id));
      // Group unmatched rows by the section total they should appear before
      const newRowsBeforeId = {}; // sectionTotalId → [newRowData, ...]
      for (const src of sourceSorted) {
        if (!unmatchedSet.has(src.id)) continue;

        const sectionTotalId = findSectionTotalId(src);
        const key = sectionTotalId ?? '_end';
        if (!newRowsBeforeId[key]) newRowsBeforeId[key] = [];

        const row = {
          branch_id: branchId,
          department,
          year,
          version_id: targetVersionId || null,
          account_code: src.account_code || null,
          account_name: src.account_name,
          full_label: src.full_label,
          row_type: src.row_type,
          indent_level: src.indent_level || 0,
          pct_of_total: src.pct_of_total ?? null,
          pct_source: src.pct_source ?? null,
          cell_notes: src.cell_notes ?? {},
        };
        for (const m of ALL_MONTHS) {
          row[m] = forecastSet.has(m) ? (src[m] ?? 0) : 0;
        }
        newRowsBeforeId[key].push(row);
      }

      // Build final ordered list — insert new rows before their section total
      const finalOrder = [];

      for (const existing of workingRows) {
        // Insert any new rows that belong before this row (section total)
        const before = newRowsBeforeId[existing.id];
        if (before) {
          for (const nr of before) {
            finalOrder.push({ newRow: nr });
          }
        }
        finalOrder.push({ existingId: existing.id });
      }

      // Append any rows whose section wasn't found at the end
      if (newRowsBeforeId['_end']) {
        for (const nr of newRowsBeforeId['_end']) {
          finalOrder.push({ newRow: nr });
        }
      }

      // Write to DB: update existing rows with new row_order, insert new rows
      const BATCH_SIZE = 100;
      const toInsert = [];

      for (let i = 0; i < finalOrder.length; i++) {
        const entry = finalOrder[i];
        const newOrder = i + 1;

        if (entry.existingId) {
          const existing = targetRows.find(r => r.id === entry.existingId);
          if (existing && existing.row_order !== newOrder) {
            const { error } = await supabase
              .from('pnl_line_items')
              .update({ row_order: newOrder })
              .eq('id', entry.existingId);
            if (error) throw error;
          }
        } else {
          toInsert.push({ ...entry.newRow, row_order: newOrder });
        }
      }

      for (let i = 0; i < toInsert.length; i += BATCH_SIZE) {
        const batch = toInsert.slice(i, i + BATCH_SIZE);
        const { error: insertError } = await supabase
          .from('pnl_line_items')
          .insert(batch);
        if (insertError) throw insertError;
      }
      insertedCount = toInsert.length;
    }

    return NextResponse.json({
      success: true,
      updatedCount,
      insertedCount,
      forecastMonths
    });
  } catch (error) {
    console.error('Fill forecast error:', error);
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
  }
}
