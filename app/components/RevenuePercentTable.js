'use client';

import React, { useMemo } from 'react';

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function normalizeTotalName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/^total\s*-\s*/, 'total ').trim();
}

function getRowClasses(rowType) {
  switch (rowType) {
    case 'section_header': return 'bg-blue-100';
    case 'account_header': return 'bg-gray-50';
    case 'total': return 'border-t border-gray-300';
    case 'calculated': return 'bg-slate-100';
    case 'percent': return 'bg-slate-100';
    default: return '';
  }
}

function getRowBg(rowType) {
  switch (rowType) {
    case 'section_header': return 'bg-blue-100';
    case 'account_header': return 'bg-gray-50';
    case 'calculated': return 'bg-slate-100';
    case 'percent': return 'bg-slate-100';
    default: return 'bg-white';
  }
}

function getTextWeight(rowType) {
  switch (rowType) {
    case 'section_header':
    case 'total':
    case 'calculated':
    case 'percent':
      return 'font-bold';
    case 'account_header':
      return 'font-semibold';
    default:
      return '';
  }
}

/**
 * Read-only table showing every P&L line as a % of Total Income (revenue) for that month.
 *
 * Props:
 *   lineItems      — raw pnl_line_items from DB
 *   importedMonths — array of month keys that are actuals
 *   isAdmin        — controls admin_only row visibility
 *   loading        — show loading state
 *   referenceItems — optional reference version line items for comparison
 */
export default function RevenuePercentTable({ lineItems, importedMonths = [], isAdmin = false, loading = false, referenceItems = null }) {

  // Process a set of line items: recalculate totals, find revenue
  const processItems = (rawItems, recalcTotals = true) => {
    if (!rawItems?.length) return { items: [], revenueByMonth: {}, revenueTotal: 0 };

    const sorted = [...rawItems].sort((a, b) => (a.row_order || 0) - (b.row_order || 0));
    const filtered = sorted.filter(li => {
      if (li.row_type === 'sub_line') return false;
      if (!isAdmin && li.admin_only) return false;
      return true;
    });
    const items = filtered.map(li => ({ ...li }));

    // Recalculate totals from detail rows (skip for reference/saved versions — stored values are authoritative)
    if (recalcTotals) for (let i = 0; i < items.length; i++) {
      if (items[i].row_type !== 'total') continue;
      const sectionName = normalizeTotalName(items[i].account_name).replace(/^total\s*/, '').trim();
      if (!sectionName) continue;
      let headerIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if ((items[j].row_type === 'section_header' || items[j].row_type === 'account_header') &&
            items[j].account_name?.toLowerCase().trim() === sectionName) { headerIdx = j; break; }
      }
      if (headerIdx < 0) {
        for (let j = 0; j < items.length; j++) {
          if ((items[j].row_type === 'section_header' || items[j].row_type === 'account_header') &&
              items[j].account_name?.toLowerCase().trim() === sectionName) { headerIdx = j; break; }
        }
      }
      if (headerIdx < 0) continue;
      const sumEnd = i > headerIdx ? i : items.length;
      for (const mk of MONTH_KEYS) {
        let sum = 0;
        for (let j = headerIdx + 1; j < sumEnd; j++) {
          if (items[j].row_type === 'detail') sum += parseFloat(items[j][mk]) || 0;
        }
        items[i][mk] = Math.round(sum * 100) / 100;
      }
    }

    // Recalculate NOI
    if (recalcTotals) for (let i = 0; i < items.length; i++) {
      const name = items[i].account_name?.toLowerCase().trim();
      if (name !== 'net ordinary income' && name !== 'net operating income' && name !== 'net income') continue;
      if (items[i].row_type !== 'total' && items[i].row_type !== 'calculated' && items[i].row_type !== 'section_header') continue;
      for (const mk of MONTH_KEYS) {
        let sum = 0;
        for (let j = 0; j < i; j++) {
          if (items[j].row_type !== 'total' || (items[j].indent_level || 0) > 0) continue;
          const tn = normalizeTotalName(items[j].account_name);
          if (!tn.startsWith('total ')) continue;
          const sn = tn.replace(/^total\s*/, '');
          const isIncome = sn === 'income' || sn.startsWith('other income');
          sum += isIncome ? (parseFloat(items[j][mk]) || 0) : -(parseFloat(items[j][mk]) || 0);
        }
        items[i][mk] = Math.round(sum * 100) / 100;
      }
    }

    const incomeRow = items.find(li =>
      li.row_type === 'total' && normalizeTotalName(li.account_name) === 'total income'
    );
    const revByMonth = {};
    let revTotal = 0;
    for (const mk of MONTH_KEYS) {
      revByMonth[mk] = incomeRow ? (parseFloat(incomeRow[mk]) || 0) : 0;
      revTotal += revByMonth[mk];
    }

    const displayRows = items.filter(li =>
      li.row_type !== 'percent' && li.row_type !== 'headcount'
    );

    return { items: displayRows, revenueByMonth: revByMonth, revenueTotal: revTotal };
  };

  // Process current line items
  const { rows, revenueByMonth, revenueTotal } = useMemo(() => {
    const result = processItems(lineItems);
    return { rows: result.items, revenueByMonth: result.revenueByMonth, revenueTotal: result.revenueTotal };
  }, [lineItems, isAdmin]);

  // Process reference items (for comparison) — recalculate totals so sub-totals are populated
  const refData = useMemo(() => {
    if (!referenceItems?.length) return null;
    const result = processItems(referenceItems, true);
    return result;
  }, [referenceItems, isAdmin]);

  // Build ref lookup: account_code for details, name+row_type for totals/structural
  const refLookup = useMemo(() => {
    if (!refData) return null;
    const byCode = new Map();
    const byNameAndType = new Map();
    for (const item of refData.items) {
      if (item.account_code) byCode.set(item.account_code, item);
      const normName = (item.account_name || '').toLowerCase().replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
      if (normName) {
        // Key by name + row_type so "Income" (header) doesn't collide with "Total Income" (total)
        byNameAndType.set(`${normName}|${item.row_type}`, item);
        // Also store by name only as fallback (first occurrence wins)
        if (!byNameAndType.has(normName)) byNameAndType.set(normName, item);
      }
    }
    return { byCode, byNameAndType };
  }, [refData]);

  const showComparison = refData !== null;



  const importedMonthKeys = useMemo(() => new Set(importedMonths), [importedMonths]);
  const actualCount = importedMonthKeys.size;

  // Format a percentage value
  const fmtPct = (val) => {
    if (val === null || val === undefined || isNaN(val)) return '\u2014';
    if (val === 0) return '\u2014';
    return val.toFixed(1) + '%';
  };

  // Compute % of revenue for a value given a month
  const pctOfRevenue = (value, monthKey) => {
    const rev = revenueByMonth[monthKey];
    if (!rev || rev === 0) return null;
    return (value / rev) * 100;
  };

  // Compute annual % (total value / total revenue)
  const annualPctOfRevenue = (item, revTotal) => {
    let totalVal = 0;
    for (const mk of MONTH_KEYS) totalVal += parseFloat(item[mk]) || 0;
    if (!revTotal || revTotal === 0) return null;
    return (totalVal / revTotal) * 100;
  };

  // Compute ref % of revenue for a value given a month
  const refPctOfRevenue = (value, monthKey) => {
    if (!refData) return null;
    const rev = refData.revenueByMonth[monthKey];
    if (!rev || rev === 0) return null;
    return (value / rev) * 100;
  };

  // For total/calculated rows, compute ref annual total by summing matched ref detail rows
  // (ref version may not have sub-total rows stored)
  const refTotalAnnuals = useMemo(() => {
    if (!refLookup) return new Map();
    const map = new Map(); // row index -> annual ref total

    for (let i = 0; i < rows.length; i++) {
      const item = rows[i];
      if (item.row_type !== 'total' && item.row_type !== 'calculated') continue;

      // Walk backward to find this total's section header
      const sectionName = normalizeTotalName(item.account_name).replace(/^total\s*/, '').trim();
      let headerIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if ((rows[j].row_type === 'section_header' || rows[j].row_type === 'account_header') &&
            rows[j].account_name?.toLowerCase().trim() === sectionName) {
          headerIdx = j; break;
        }
      }
      if (headerIdx < 0) continue;

      // Sum ref values for each detail row between header and this total
      let refAnnual = 0;
      let foundAny = false;
      for (let j = headerIdx + 1; j < i; j++) {
        if (rows[j].row_type !== 'detail') continue;
        // Find matching ref detail by account_code
        const refDetail = rows[j].account_code ? refLookup.byCode.get(rows[j].account_code) : null;
        if (refDetail) {
          for (const mk of MONTH_KEYS) refAnnual += parseFloat(refDetail[mk]) || 0;
          foundAny = true;
        }
      }
      if (foundAny) map.set(i, refAnnual);
    }
    return map;
  }, [rows, refLookup, refData]);

  // Get matching reference item (detail rows only — totals use refTotalAnnuals)
  const getRefItem = (item) => {
    if (!refLookup) return null;
    if (item.row_type === 'detail' && item.account_code && refLookup.byCode.has(item.account_code)) {
      return refLookup.byCode.get(item.account_code);
    }
    const normName = (item.account_name || '').toLowerCase().replace(/[-–—]/g, ' ').replace(/\s+/g, ' ').trim();
    return refLookup.byNameAndType.get(`${normName}|${item.row_type}`)
      || refLookup.byNameAndType.get(normName)
      || null;
  };

  if (loading) {
    return (
      <div className="p-4 text-center text-gray-500 text-sm">Loading...</div>
    );
  }

  if (!rows.length) return null;

  const isHeaderRow = (item) =>
    item.row_type === 'section_header' || item.row_type === 'account_header';

  return (
    <div className="mt-6 px-6 pb-6">
      <h3 className="text-md font-bold text-gray-700 mb-2">% of Revenue</h3>
      <div className="overflow-x-auto overflow-y-auto max-h-[70vh] border border-gray-400 rounded-lg" style={{ scrollbarGutter: 'stable' }}>
        <table className="text-xs w-full" style={{ tableLayout: 'fixed' }}>
          <thead className="sticky top-0 z-20">
            <tr className="bg-gray-700 text-white">
              <th className="px-1.5 py-1 text-left font-semibold sticky left-0 bg-gray-700 z-30" style={{ width: 300, minWidth: 120 }}>
                Account
              </th>
              {MONTH_KEYS.map((mk, i) => {
                const isActual = importedMonthKeys.has(mk);
                const isBoundary = actualCount > 0 && actualCount < 12 && i === actualCount;
                return (
                  <th key={mk}
                    className={`text-right py-1 px-0.5 font-medium ${isActual ? 'bg-gray-800' : ''} ${isBoundary ? 'border-l-2 border-l-blue-300' : ''}`}
                    style={{ width: 52, minWidth: 36 }}
                  >{MONTH_LABELS[i]}</th>
                );
              })}
              <th className="text-right py-1 px-1.5 font-semibold bg-gray-800 min-w-[55px] border-l-2 border-r-2 border-gray-600">Total</th>
              {showComparison && (
                <>
                  <th className="text-right py-1 px-1.5 font-semibold min-w-[55px] border-l border-gray-500">Ref</th>
                  <th className="text-right py-1 px-1 font-semibold min-w-[50px]">Var</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.map((item, idx) => {
              const isHeader = isHeaderRow(item);
              const rowBg = getRowBg(item.row_type);

              // Account name with indent
              const indent = (item.indent_level || 0) * 16;
              const displayName = item.account_name || '';

              return (
                <tr key={idx} className={`${getRowClasses(item.row_type)} ${idx % 2 === 0 && !isHeader && item.row_type === 'detail' ? '' : ''}`}>
                  <td
                    className={`py-0.5 px-1.5 sticky left-0 z-10 truncate ${rowBg} ${getTextWeight(item.row_type)}`}
                    style={{ width: 300, maxWidth: 300, paddingLeft: 6 + indent }}
                    title={displayName}
                  >
                    {displayName}
                  </td>

                  {MONTH_KEYS.map((mk, mi) => {
                    const isImported = importedMonthKeys.has(mk);
                    const isBoundary = actualCount > 0 && actualCount < 12 && mi === actualCount;

                    if (isHeader) {
                      return (
                        <td key={mk}
                          className={`py-0.5 px-0.5 ${rowBg} ${isBoundary ? 'border-l-2 border-l-blue-300' : ''}`}
                          style={{ width: 52, minWidth: 36 }}
                        />
                      );
                    }

                    const rawVal = parseFloat(item[mk]) || 0;
                    const pct = pctOfRevenue(rawVal, mk);
                    const isNeg = pct !== null && pct < 0;

                    return (
                      <td key={mk}
                        className={`py-0.5 px-0.5 text-right tabular-nums ${getTextWeight(item.row_type)} ${
                          isNeg ? 'text-red-600' : ''
                        } ${isImported ? 'bg-blue-50/70' : ''} ${isBoundary ? 'border-l-2 border-l-blue-300' : ''}`}
                        style={{ width: 52, minWidth: 36 }}
                      >
                        {fmtPct(pct)}
                      </td>
                    );
                  })}

                  {/* Annual total column */}
                  {(() => {
                    const annualPct = isHeader ? null : annualPctOfRevenue(item, revenueTotal);
                    // For totals, use computed ref annual from summed detail rows; for details, use matched ref item
                    let refAnnualPct = null;
                    if (!isHeader && refData) {
                      if ((item.row_type === 'total' || item.row_type === 'calculated') && refTotalAnnuals.has(idx)) {
                        const refAnnual = refTotalAnnuals.get(idx);
                        refAnnualPct = refData.revenueTotal ? (refAnnual / refData.revenueTotal) * 100 : null;
                      } else {
                        const refItem = getRefItem(item);
                        refAnnualPct = refItem ? annualPctOfRevenue(refItem, refData.revenueTotal) : null;
                      }
                    }
                    const variance = annualPct !== null && refAnnualPct !== null ? annualPct - refAnnualPct : null;
                    // For income rows, higher % is good. For expense rows, lower % is good.
                    const isIncomeSection = normalizeTotalName(item.account_name).includes('income') ||
                      item.row_type === 'calculated';
                    const varColor = variance !== null && Math.abs(variance) >= 0.1
                      ? ((isIncomeSection ? variance > 0 : variance < 0) ? 'text-green-600' : 'text-red-600')
                      : '';

                    return (
                      <>
                        <td className={`py-0.5 px-1.5 text-right tabular-nums border-l-2 border-r-2 border-gray-400 font-semibold min-w-[55px] ${
                          isHeader ? rowBg : ''
                        }`}>
                          {fmtPct(annualPct)}
                        </td>
                        {showComparison && (
                          <>
                            <td className="py-0.5 px-1.5 text-right tabular-nums text-amber-700 border-l border-gray-200 min-w-[55px]">
                              {fmtPct(refAnnualPct)}
                            </td>
                            <td className={`py-0.5 px-1 text-right tabular-nums min-w-[50px] ${varColor}`}>
                              {variance !== null && Math.abs(variance) >= 0.1
                                ? (variance > 0 ? '+' : '') + variance.toFixed(1) + '%'
                                : '\u2014'}
                            </td>
                          </>
                        )}
                      </>
                    );
                  })()}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
