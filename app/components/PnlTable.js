'use client';

import React, { useMemo, useState, useCallback, useRef, useEffect } from 'react';

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function formatCurrency(val) {
  if (val === 0 || val === null || val === undefined) return '\u2014';
  const num = parseFloat(val);
  if (isNaN(num)) return '\u2014';
  const isNeg = num < 0;
  const formatted = Math.abs(num).toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  });
  if (isNeg) return `(${formatted})`;
  return formatted;
}

function formatPercent(val) {
  if (val === null || val === undefined || isNaN(val) || !isFinite(val)) return '\u2014';
  const num = parseFloat(val);
  const isNeg = num < 0;
  const formatted = Math.abs(num).toFixed(1) + '%';
  if (isNeg) return `(${formatted})`;
  return formatted;
}

/** Normalize total-row names so "Total - Income" and "Total Income" both become "total income" */
function normalizeTotalName(name) {
  if (!name) return '';
  return name.toLowerCase().replace(/^total\s*-\s*/, 'total ').trim();
}

/** Match "Net Ordinary Income" or "Net Operating Income" (legacy vs current naming) */
function isNOI(name) {
  const n = name?.toLowerCase().trim();
  return n === 'net ordinary income' || n === 'net operating income';
}

function isNOIPct(name) {
  const n = name?.toLowerCase().trim();
  return n === 'net ordinary income %' || n === 'net operating income %';
}

/** Parse pct_source: handles both plain string (legacy) and JSON array */
function parsePctSources(val) {
  if (!val) return [];
  if (val.startsWith('[')) {
    try { return JSON.parse(val); } catch { return []; }
  }
  return [val];
}

/** Format pct_source array for display */
function formatPctSources(sources, computedItems) {
  if (!sources?.length) return '';
  return sources.map(s => {
    if (s === 'xdept:maintenance:total income') return 'Maint Revenue';
    if (s === 'xdept:maintenance_onsite:total income') return 'Onsite Revenue';
    if (s.startsWith('detail:')) {
      // Look up account name by code if computedItems available
      if (computedItems) {
        const row = computedItems.find(r => r.account_code === s.substring(7));
        if (row) return row.account_name;
      }
      return s.substring(7);
    }
    // "total direct labor" → "Direct Labor"
    return s.replace(/^total\s*/i, '').replace(/\b\w/g, c => c.toUpperCase());
  }).join(' + ');
}

/** Heat-map color based on variance from reference: green = favorable, red = unfavorable */
function getVariancePercentBg(current, reference, maxDelta) {
  if (reference === null || reference === undefined || isNaN(current) || current === 0) return null;
  const diff = current - reference;
  if (diff === 0) return null;
  if (diff > 0) {
    const t = Math.min(diff / maxDelta, 1);
    return `rgba(22, 163, 74, ${(0.05 + t * 0.35).toFixed(2)})`;
  }
  const t = Math.min(-diff / maxDelta, 1);
  return `rgba(220, 38, 38, ${(0.05 + t * 0.35).toFixed(2)})`;
}

/** Heat-map color for Direct Labor % cells: green ≤40%, red 40–55%+ */
function getDLPercentBg(value) {
  if (value === 0 || isNaN(value)) return null;
  if (value <= 30) return 'rgba(22, 163, 74, 0.4)';
  if (value < 40) {
    const t = (40 - value) / 10; // 1 at 30%, 0 at 40%
    return `rgba(22, 163, 74, ${(0.05 + t * 0.35).toFixed(2)})`;
  }
  if (value >= 55) return 'rgba(220, 38, 38, 0.4)';
  if (value > 40) {
    const t = (value - 40) / 15; // 0 at 40%, 1 at 55%
    return `rgba(220, 38, 38, ${(0.05 + t * 0.35).toFixed(2)})`;
  }
  return null;
}

/**
 * P&L Table with editable cells and comparison columns
 *
 * @param {{
 *   lineItems: object[],
 *   importInfo: object|null,
 *   loading: boolean,
 *   year: number,
 *   importedMonths: string[],
 *   onCellChange: (lineItemId: number, monthKey: string, value: number) => void,
 *   isEditable: boolean,
 *   isLocked: boolean,
 *   referenceItems: object[]|null
 * }} props
 */
export default function PnlTable({
  lineItems,
  importInfo,
  loading,
  year,
  importedMonths = [],
  onCellChange,
  onRowReorder,
  isEditable = false,
  isLocked = false,
  referenceItems = null,
  isAdmin = false,
  onToggleAdminOnly,
  onTogglePctMode,
  onAddRefRow,
  onAddStructuralRow,
  onDeleteLineItem,
  onUpdateCellNote,
  crossDeptConfig = null
}) {
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [accountColWidth, setAccountColWidth] = useState(360);
  const [monthColWidth, setMonthColWidth] = useState(52);
  const [notePopover, setNotePopover] = useState(null); // { id, monthKey, noteText, x, y }
  const [pctPopover, setPctPopover] = useState(null); // { id, pctOfTotal, pctSources: string[] }
  const [crossDeptData, setCrossDeptData] = useState(null); // { maintenance: {revenue:{jan,...}, directLabor:{jan,...}}, ... }

  // Multi-cell selection state
  const [selectedCells, setSelectedCells] = useState(new Set());
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectionAnchor, setSelectionAnchor] = useState(null);
  const [selectionEnd, setSelectionEnd] = useState(null);
  const [bulkEditValue, setBulkEditValue] = useState('');
  const [showBulkInput, setShowBulkInput] = useState(false);

  // Drag-and-drop state
  const [dragRowId, setDragRowId] = useState(null);
  const [dropTargetIdx, setDropTargetIdx] = useState(null);
  const canDrag = isEditable && !isLocked;
  const resizeRef = useRef(null);
  const prevPctSourceSums = useRef({}); // { [rowId]: { [monthKey]: sourceSum } }

  // Structural row catalog popover
  const [structuralPopover, setStructuralPopover] = useState(null); // { x, y }
  const [structuralSearch, setStructuralSearch] = useState('');
  const [structuralRows, setStructuralRows] = useState([]);
  const [structuralLoading, setStructuralLoading] = useState(false);
  const structuralDebounceRef = useRef(null);

  const handleResizeStart = useCallback((e, colType) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = colType === 'account' ? accountColWidth : monthColWidth;
    resizeRef.current = { colType, startX, startWidth };

    const onMouseMove = (ev) => {
      const delta = ev.clientX - startX;
      const newWidth = Math.max(colType === 'account' ? 120 : 36, startWidth + delta);
      if (colType === 'account') {
        setAccountColWidth(newWidth);
      } else {
        setMonthColWidth(newWidth);
      }
    };
    const onMouseUp = () => {
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      resizeRef.current = null;
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
  }, [accountColWidth, monthColWidth]);

  // Fetch structural rows when popover is open (with debounce on search)
  useEffect(() => {
    if (!structuralPopover) return;
    if (structuralDebounceRef.current) clearTimeout(structuralDebounceRef.current);
    structuralDebounceRef.current = setTimeout(async () => {
      setStructuralLoading(true);
      try {
        const params = structuralSearch ? `?search=${encodeURIComponent(structuralSearch)}` : '';
        const res = await fetch(`/api/pnl/structural-rows${params}`);
        const result = await res.json();
        if (result.success) setStructuralRows(result.rows);
      } catch (err) {
        console.error('Failed to fetch structural rows:', err);
      } finally {
        setStructuralLoading(false);
      }
    }, 200);
    return () => { if (structuralDebounceRef.current) clearTimeout(structuralDebounceRef.current); };
  }, [structuralPopover, structuralSearch]);

  // Fetch cross-dept data eagerly when any line items use xdept: sources,
  // and clear/re-fetch when config changes (branch/year/version switch)
  const hasXdeptSources = useMemo(() => {
    if (!lineItems?.length || !crossDeptConfig) return false;
    return lineItems.some(li =>
      li.pct_source && li.pct_source.includes('xdept:')
    );
  }, [lineItems, crossDeptConfig]);

  useEffect(() => {
    setCrossDeptData(null);
    if (!crossDeptConfig) return;
    if (!hasXdeptSources) return;

    let cancelled = false;
    (async () => {
      try {
        const vParam = crossDeptConfig.versionName ? `&versionName=${encodeURIComponent(crossDeptConfig.versionName)}` : '';
        const res = await fetch(`/api/pnl/cross-dept-revenue?branchId=${crossDeptConfig.branchId}&year=${crossDeptConfig.year}${vParam}`);
        const result = await res.json();
        if (!cancelled && result.success) setCrossDeptData(result.departments);
      } catch (err) {
        console.error('Failed to fetch cross-dept revenue:', err);
      }
    })();
    return () => { cancelled = true; };
  }, [crossDeptConfig?.branchId, crossDeptConfig?.year, crossDeptConfig?.versionName, hasXdeptSources]);

  // Normalize imported month keys to lowercase 3-letter keys
  const importedMonthKeys = useMemo(() => {
    if (!importedMonths?.length) return new Set();
    return new Set(
      importedMonths.map(m => {
        const lower = m.toLowerCase().substring(0, 3);
        return MONTH_KEYS.find(k => k === lower) || lower;
      })
    );
  }, [importedMonths]);

  // Recompute Gross Profit and Gross Profit % dynamically from Income and COGS totals.
  // Injects missing GP/GP% rows if they don't exist in the data.
  const computedLineItems = useMemo(() => {
    if (!lineItems?.length) return lineItems;

    // Work on sorted copies so totals see current detail values
    const sorted = [...lineItems].sort((a, b) => (a.row_order || 0) - (b.row_order || 0));
    // Filter out admin-only rows for non-admin users (before computing totals)
    const filtered = !isAdmin
      ? sorted.filter(li => !li.admin_only)
      : sorted;
    const items = filtered.map(li => ({ ...li }));

    // --- Recalculate intermediate totals from detail rows ---
    for (let i = 0; i < items.length; i++) {
      if (items[i].row_type !== 'total') continue;

      const sectionName = normalizeTotalName(items[i].account_name).replace(/^total\s*/, '').trim();
      if (!sectionName) continue;

      // Search backwards first (normal case: total is right after its section)
      let headerIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        if ((items[j].row_type === 'section_header' || items[j].row_type === 'account_header') &&
            items[j].account_name?.toLowerCase().trim() === sectionName) {
          headerIdx = j;
          break;
        }
      }

      // Fallback: search the entire list (total may be mispositioned, e.g. added via catalog)
      if (headerIdx < 0) {
        for (let j = 0; j < items.length; j++) {
          if ((items[j].row_type === 'section_header' || items[j].row_type === 'account_header') &&
              items[j].account_name?.toLowerCase().trim() === sectionName) {
            headerIdx = j;
            break;
          }
        }
      }
      if (headerIdx < 0) continue;

      // Determine the range of detail rows to sum.
      // If total is after header (normal ordering), sum between header and total position.
      // Otherwise (mispositioned total), find the section end from the header's structure.
      let sumEnd;
      if (i > headerIdx) {
        sumEnd = i;
      } else {
        sumEnd = items.length;
        for (let j = headerIdx + 1; j < items.length; j++) {
          if (j === i) continue;
          if ((items[j].row_type === 'section_header' || items[j].row_type === 'account_header' || items[j].row_type === 'total') &&
              (items[j].indent_level || 0) <= (items[headerIdx].indent_level || 0)) {
            sumEnd = j;
            break;
          }
        }
      }

      for (const mk of MONTH_KEYS) {
        let sum = 0;
        for (let j = headerIdx + 1; j < sumEnd; j++) {
          if (items[j].row_type === 'detail') {
            sum += parseFloat(items[j][mk]) || 0;
          }
        }
        items[i][mk] = Math.round(sum * 100) / 100;
      }
    }

    // --- Recalculate Net Operating Income / Net Income from section totals ---
    for (let i = 0; i < items.length; i++) {
      const name = items[i].account_name?.toLowerCase().trim();
      if (!isNOI(name) && name !== 'net income') continue;
      // Accept total, calculated, or section_header (legacy imports misclassified NOI)
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

    // --- Compute GP and GP% ---
    const incomeRow = items.find(li =>
      li.row_type === 'total' && normalizeTotalName(li.account_name) === 'total income'
    );
    const cogsRow = items.find(li =>
      li.row_type === 'total' && normalizeTotalName(li.account_name).startsWith('total cost of')
    );

    const gpValues = {};
    const gpPctValues = {};
    for (const mk of MONTH_KEYS) {
      const income = incomeRow?.[mk] || 0;
      const cogs = cogsRow?.[mk] || 0;
      gpValues[mk] = Math.round((income - cogs) * 100) / 100;
      gpPctValues[mk] = income !== 0 ? Math.round(((income - cogs) / income) * 1000) / 10 : 0;
    }

    const hasGP = items.some(li => li.row_type === 'calculated' && li.account_name?.toLowerCase() === 'gross profit');
    const hasGPPct = items.some(li => li.row_type === 'percent' && li.account_name?.toLowerCase() === 'gross profit %');
    const cogsIdx = cogsRow ? items.indexOf(cogsRow) : -1;

    const result = [];
    for (let i = 0; i < items.length; i++) {
      const li = items[i];

      if (li.row_type === 'calculated' && li.account_name?.toLowerCase() === 'gross profit') {
        result.push({ ...li, ...gpValues });
        if (!hasGPPct) {
          result.push({
            account_code: null, account_name: 'Gross Profit %', full_label: 'Gross Profit %',
            row_type: 'percent', indent_level: 0, admin_only: li.admin_only, ...gpPctValues
          });
        }
        continue;
      }

      if (li.row_type === 'percent' && li.account_name?.toLowerCase() === 'gross profit %') {
        result.push({ ...li, ...gpPctValues });
        continue;
      }

      // Skip dynamically-injected percent rows if they somehow exist in the source data
      if (li.row_type === 'percent') {
        const pn = li.account_name?.toLowerCase().trim();
        if (isNOIPct(pn) || pn === 'net income %' || pn === 'direct labor %') continue;
      }

      const liName = li.account_name?.toLowerCase().trim();

      // Hide Net Income row from non-admins
      if (!isAdmin && liName === 'net income' &&
          (li.row_type === 'total' || li.row_type === 'calculated' || li.row_type === 'section_header')) {
        continue;
      }

      // Rename legacy "Net Ordinary Income" to "Net Operating Income"
      if (isNOI(liName)) {
        result.push({ ...li, account_name: 'Net Operating Income', full_label: 'Net Operating Income' });
      } else {
        result.push(li);
      }

      if (!hasGP && i === cogsIdx) {
        result.push({
          account_code: null, account_name: 'Gross Profit', full_label: 'Gross Profit',
          row_type: 'calculated', indent_level: 0, admin_only: li.admin_only, ...gpValues
        });
        result.push({
          account_code: null, account_name: 'Gross Profit %', full_label: 'Gross Profit %',
          row_type: 'percent', indent_level: 0, admin_only: li.admin_only, ...gpPctValues
        });
      }

      // Inject Direct Labor % after Total - Direct Labor
      if (li.row_type === 'total' && normalizeTotalName(li.account_name) === 'total direct labor') {
        const dlPctValues = {};
        for (const mk of MONTH_KEYS) {
          const income = parseFloat(incomeRow?.[mk]) || 0;
          const dl = parseFloat(li[mk]) || 0;
          dlPctValues[mk] = income !== 0 ? Math.round((dl / income) * 1000) / 10 : 0;
        }
        result.push({
          account_code: null, account_name: 'Direct Labor %', full_label: 'Direct Labor %',
          row_type: 'percent', indent_level: 0, admin_only: li.admin_only, ...dlPctValues
        });
      }

      // Inject Net Operating Income % after Net Operating Income
      if ((li.row_type === 'total' || li.row_type === 'calculated' || li.row_type === 'section_header') && isNOI(liName)) {
        const noiPctValues = {};
        for (const mk of MONTH_KEYS) {
          const income = parseFloat(incomeRow?.[mk]) || 0;
          const noi = parseFloat(li[mk]) || 0;
          noiPctValues[mk] = income !== 0 ? Math.round((noi / income) * 1000) / 10 : 0;
        }
        result.push({
          account_code: null, account_name: 'Net Operating Income %', full_label: 'Net Operating Income %',
          row_type: 'percent', indent_level: 0, admin_only: li.admin_only, ...noiPctValues
        });
      }

      // Inject Net Income % after Net Income (admin only)
      if (isAdmin && (li.row_type === 'total' || li.row_type === 'calculated' || li.row_type === 'section_header') && liName === 'net income') {
        const niPctValues = {};
        for (const mk of MONTH_KEYS) {
          const income = parseFloat(incomeRow?.[mk]) || 0;
          const ni = parseFloat(li[mk]) || 0;
          niPctValues[mk] = income !== 0 ? Math.round((ni / income) * 1000) / 10 : 0;
        }
        result.push({
          account_code: null, account_name: 'Net Income %', full_label: 'Net Income %',
          row_type: 'percent', indent_level: 0, admin_only: li.admin_only, ...niPctValues
        });
      }
    }

    return result;
  }, [lineItems, isAdmin]);

  // Merge primary line items with reference items.
  // Each display row has: { item, refItem, isRefOnly }
  // Reference-only rows (accounts in the ref but not the primary) get inserted
  // into the correct section, just before the section total.
  const displayRows = useMemo(() => {
    if (!referenceItems?.length) {
      return computedLineItems.map(item => ({ item, refItem: null, isRefOnly: false }));
    }

    // Filter admin-only detail rows from reference items for non-admin users
    const effectiveRefItems = !isAdmin
      ? referenceItems.filter(ri => ri.row_type !== 'detail' || !ri.admin_only)
      : referenceItems;

    // Build reference lookups
    const refByCode = new Map();
    const refByName = new Map();
    for (const ri of effectiveRefItems) {
      if (ri.account_code) refByCode.set(ri.account_code, ri);
      if (ri.account_name && (ri.row_type === 'total' || ri.row_type === 'calculated' || ri.row_type === 'percent' || ri.row_type === 'section_header')) {
        refByName.set(normalizeTotalName(ri.account_name), ri);
      }
    }

    // Match a primary item to its reference counterpart
    function findRef(item) {
      if (item.account_code && refByCode.has(item.account_code)) {
        return refByCode.get(item.account_code);
      }
      if (item.account_name && (item.row_type === 'total' || item.row_type === 'calculated' || item.row_type === 'percent' || item.row_type === 'section_header')) {
        return refByName.get(normalizeTotalName(item.account_name)) || null;
      }
      return null;
    }

    // Pass 1: Collect ALL matched ref codes up front so we know the full
    // set before inserting any ref-only rows.
    const matchedRefCodes = new Set();
    for (const item of computedLineItems) {
      const ref = findRef(item);
      if (ref?.account_code) matchedRefCodes.add(ref.account_code);
    }

    // Group reference detail items by section (case-insensitive keys)
    const refSections = new Map(); // lowerSectionName -> detail items[]
    let currentRefSection = null;
    for (const ri of effectiveRefItems) {
      if (ri.row_type === 'section_header') {
        currentRefSection = ri.account_name.toLowerCase();
        if (!refSections.has(currentRefSection)) refSections.set(currentRefSection, []);
      } else if (ri.row_type === 'detail' && currentRefSection) {
        refSections.get(currentRefSection).push(ri);
      }
    }

    // Pass 2: Build merged display list.
    // Insert ref-only rows only before section-level totals (those without
    // an account_code), not before sub-totals like "Total 5050 - Subcontractors".
    const merged = [];
    let currentPrimarySection = null;

    for (const item of computedLineItems) {
      if (item.row_type === 'section_header') {
        currentPrimarySection = item.account_name.toLowerCase();
      }

      // Before a section-level total, insert unmatched ref detail rows
      if (item.row_type === 'total' && !item.account_code && currentPrimarySection) {
        const refDetails = refSections.get(currentPrimarySection) || [];
        for (const rd of refDetails) {
          if (rd.account_code && !matchedRefCodes.has(rd.account_code)) {
            merged.push({ item: rd, refItem: rd, isRefOnly: true });
          }
        }
      }

      const refItem = findRef(item);
      merged.push({ item, refItem, isRefOnly: false });
    }

    // Add entire ref-only sections (sections not in the primary at all)
    const primarySections = new Set(
      computedLineItems
        .filter(li => li.row_type === 'section_header')
        .map(li => li.account_name.toLowerCase())
    );

    for (const [sectionKey, refDetails] of refSections) {
      if (primarySections.has(sectionKey)) continue; // handled above

      const unmatched = refDetails.filter(rd => rd.account_code && !matchedRefCodes.has(rd.account_code));
      if (unmatched.length === 0) continue;

      // Add section header
      const refHeader = effectiveRefItems.find(
        ri => ri.row_type === 'section_header' && ri.account_name.toLowerCase() === sectionKey
      );
      if (refHeader) {
        merged.push({ item: refHeader, refItem: refHeader, isRefOnly: true });
      }
      // Add detail rows
      for (const rd of unmatched) {
        merged.push({ item: rd, refItem: rd, isRefOnly: true });
      }
      // Add total row
      const refTotal = effectiveRefItems.find(
        ri => ri.row_type === 'total' && normalizeTotalName(ri.account_name) === `total ${sectionKey}`
      );
      if (refTotal) {
        merged.push({ item: refTotal, refItem: refTotal, isRefOnly: true });
      }
    }

    // Recalculate reference totals from visible reference detail data.
    // Budget versions may not have intermediate totals at all, so compute
    // each total by summing detail refItems between its header and itself.
    for (let i = 0; i < merged.length; i++) {
      const { item } = merged[i];
      if (item.row_type !== 'total') continue;

      const sectionName = normalizeTotalName(item.account_name).replace(/^total\s*/, '').trim();
      if (!sectionName) continue;

      let headerIdx = -1;
      for (let j = i - 1; j >= 0; j--) {
        const r = merged[j].item;
        if ((r.row_type === 'section_header' || r.row_type === 'account_header') &&
            r.account_name?.toLowerCase().trim() === sectionName) {
          headerIdx = j;
          break;
        }
      }
      if (headerIdx < 0) continue;

      const recalcRef = {};
      let hasAnyRef = false;
      for (const mk of MONTH_KEYS) {
        let sum = 0;
        for (let j = headerIdx + 1; j < i; j++) {
          if (merged[j].item.row_type === 'detail' && merged[j].refItem) {
            sum += parseFloat(merged[j].refItem[mk]) || 0;
            hasAnyRef = true;
          }
        }
        recalcRef[mk] = Math.round(sum * 100) / 100;
      }
      if (hasAnyRef) {
        merged[i] = { ...merged[i], refItem: recalcRef };
      }
    }

    // Second pass: compute Net Operating Income / Net Income reference from
    // recalculated section totals. These summary rows don't have a matching
    // section header, so the first pass skips them.
    for (let i = 0; i < merged.length; i++) {
      const { item } = merged[i];
      const name = item.account_name?.toLowerCase().trim();
      if (!isNOI(name) && name !== 'net income') continue;
      if (item.row_type !== 'total' && item.row_type !== 'calculated' && item.row_type !== 'section_header') continue;
      if (merged[i].refItem) continue; // already has reference data

      const recalcRef = {};
      let hasAnyRef = false;

      for (const mk of MONTH_KEYS) {
        let sum = 0;
        for (let j = 0; j < i; j++) {
          const m = merged[j];
          // Only use top-level section totals (indent 0) to avoid double-counting sub-totals
          if (m.item.row_type !== 'total' || !m.refItem || (m.item.indent_level || 0) > 0) continue;
          const tn = normalizeTotalName(m.item.account_name);
          if (!tn.startsWith('total ')) continue;

          const sn = tn.replace(/^total\s*/, '');
          // Income sections contribute positively, cost/expense sections negatively
          const isIncome = sn === 'income' || sn.startsWith('other income');
          const val = parseFloat(m.refItem[mk]) || 0;
          sum += isIncome ? val : -val;
          hasAnyRef = true;
        }
        recalcRef[mk] = Math.round(sum * 100) / 100;
      }

      if (hasAnyRef) {
        merged[i] = { ...merged[i], refItem: recalcRef };
      }
    }

    return merged;
  }, [computedLineItems, referenceItems, isAdmin]);

  // Collect available source rows for the pct-of-total picker, grouped by section
  const availableSources = useMemo(() => {
    if (!computedLineItems?.length) return [];
    const groups = [];
    let currentSection = null;
    let currentItems = [];
    const seenValues = new Set();
    for (const li of computedLineItems) {
      if (li.row_type === 'section_header') {
        if (currentSection && currentItems.length) {
          groups.push({ section: currentSection, items: currentItems });
        }
        currentSection = li.account_name;
        currentItems = [];
      } else if (li.row_type === 'total') {
        const value = normalizeTotalName(li.account_name);
        if (!seenValues.has(value)) {
          seenValues.add(value);
          currentItems.push({ label: li.account_name, value, type: 'total' });
        }
      } else if (li.row_type === 'detail' && li.account_code) {
        const value = `detail:${li.account_code}`;
        if (!seenValues.has(value)) {
          seenValues.add(value);
          currentItems.push({ label: li.account_name, value, type: 'detail' });
        }
      }
    }
    if (currentSection && currentItems.length) {
      groups.push({ section: currentSection, items: currentItems });
    }
    return groups;
  }, [computedLineItems]);

  // Look up a source row by key: "detail:XXXX" → match by account_code,
  // "xdept:DEPT:total income" → cross-dept revenue from crossDeptData,
  // otherwise by normalized total name
  const findSourceRow = useCallback((key) => {
    if (key.startsWith('xdept:')) {
      if (!crossDeptData) return null;
      const parts = key.split(':');
      const dept = parts[1]; // 'maintenance' or 'maintenance_onsite'
      return crossDeptData[dept]?.revenue || null;
    }
    if (key.startsWith('detail:')) {
      const code = key.substring(7);
      return computedLineItems.find(r => r.row_type === 'detail' && r.account_code === code);
    }
    return computedLineItems.find(r => r.row_type === 'total' && normalizeTotalName(r.account_name) === key);
  }, [computedLineItems, crossDeptData]);

  // Apply pct-of-total seed: compute values and write to cells
  const handlePctApply = useCallback(() => {
    if (!pctPopover) return;
    const pct = parseFloat(pctPopover.pctOfTotal);
    if (isNaN(pct) || pct <= 0 || !pctPopover.pctSources.length) return;
    const forecastKeys = MONTH_KEYS.filter(m => !importedMonthKeys.has(m));
    for (const mk of forecastKeys) {
      let sourceSum = 0;
      for (const src of pctPopover.pctSources) {
        const srcRow = findSourceRow(src);
        if (srcRow) sourceSum += parseFloat(srcRow[mk]) || 0;
      }
      const seeded = Math.round(sourceSum * (pct / 100) * 100) / 100;
      onCellChange(pctPopover.id, mk, seeded);
    }
    onTogglePctMode(pctPopover.id, pct, JSON.stringify(pctPopover.pctSources));
    setPctPopover(null);
  }, [pctPopover, importedMonthKeys, findSourceRow, onCellChange, onTogglePctMode]);

  // Auto-recalculate pct-of-total rows when their SOURCE values change.
  // Respects manual overrides: only updates cells whose current value matches
  // the old expected value (i.e., user hasn't manually edited them).
  useEffect(() => {
    if (!onCellChange || !computedLineItems?.length || !lineItems?.length) return;

    const forecastKeys = MONTH_KEYS.filter(m => !importedMonthKeys.has(m));
    if (!forecastKeys.length) return;

    const prev = prevPctSourceSums.current;
    const next = {};
    const updates = [];

    for (const item of lineItems) {
      if (item.pct_of_total == null || !item.pct_source || !item.id || item._deleted) continue;

      const sources = parsePctSources(item.pct_source);
      const pct = parseFloat(item.pct_of_total) / 100;
      if (!sources.length || isNaN(pct)) continue;

      // Skip if any source is cross-dept and data isn't loaded yet
      if (sources.some(s => s.startsWith('xdept:')) && !crossDeptData) continue;

      const key = item.id;
      next[key] = {};

      for (const mk of forecastKeys) {
        let sourceSum = 0;
        for (const src of sources) {
          const srcRow = findSourceRow(src);
          if (srcRow) sourceSum += parseFloat(srcRow[mk]) || 0;
        }
        sourceSum = Math.round(sourceSum * 100) / 100;
        next[key][mk] = sourceSum;

        const prevSum = prev[key]?.[mk];
        // Only act when the source sum actually changed (skip initial load)
        if (prevSum === undefined || sourceSum === prevSum) continue;

        // Only update if the cell still holds the old expected value
        // (i.e., user hasn't manually overridden it)
        const oldExpected = Math.round(prevSum * pct * 100) / 100;
        const current = Math.round((parseFloat(item[mk]) || 0) * 100) / 100;
        if (current === oldExpected) {
          const newExpected = Math.round(sourceSum * pct * 100) / 100;
          updates.push({ id: item.id, mk, expected: newExpected });
        }
      }
    }

    // Always update the ref to track latest source sums
    prevPctSourceSums.current = next;

    if (updates.length > 0) {
      for (const { id, mk, expected } of updates) {
        onCellChange(id, mk, expected);
      }
    }
  }, [computedLineItems, lineItems, importedMonthKeys, findSourceRow, onCellChange, crossDeptData]);

  // Cell/row note right-click handler (monthKey '_row' for row-level notes)
  const handleCellContextMenu = useCallback((e, item, monthKey) => {
    if (!item.id || item.row_type === 'section_header' || item.row_type === 'account_header' || item.row_type === 'percent') return;
    if (!onUpdateCellNote) return;
    e.preventDefault();
    const notes = item.cell_notes || {};
    setNotePopover({
      id: item.id,
      monthKey,
      noteText: notes[monthKey] || '',
      x: Math.min(e.clientX, window.innerWidth - 280),
      y: Math.min(e.clientY, window.innerHeight - 200)
    });
  }, [onUpdateCellNote]);

  const handleNoteSave = useCallback(() => {
    if (!notePopover || !onUpdateCellNote) return;
    onUpdateCellNote(notePopover.id, notePopover.monthKey, notePopover.noteText || null);
    setNotePopover(null);
  }, [notePopover, onUpdateCellNote]);

  const showComparison = referenceItems?.length > 0;

  const isCellEditable = useCallback((item, monthKey) => {
    if (!isEditable || isLocked) return false;
    if (item.row_type === 'section_header' || item.row_type === 'account_header' || item.row_type === 'percent') return false;
    if (importedMonthKeys.has(monthKey)) return false;
    return true;
  }, [isEditable, isLocked, importedMonthKeys]);

  const handleStartEdit = useCallback((id, monthKey, currentValue, rowIdx) => {
    setEditingCell({ id, monthKey, rowIdx: rowIdx ?? null });
    const num = parseFloat(currentValue);
    setEditValue(isNaN(num) || num === 0 ? '' : num.toString());
  }, []);

  const handleFinishEdit = useCallback(() => {
    if (editingCell && onCellChange) {
      const val = parseFloat(editValue) || 0;
      onCellChange(editingCell.id, editingCell.monthKey, val);
    }
    setEditingCell(null);
    setEditValue('');
  }, [editingCell, editValue, onCellChange]);

  // Find next/prev editable cell for Tab navigation
  const findNextEditableCell = useCallback((fromRowIdx, fromMonthIdx, direction) => {
    if (fromRowIdx == null) return null;
    let r = fromRowIdx;
    let m = fromMonthIdx + direction;
    const totalRows = displayRows.length;
    // Walk through cells in direction, wrapping rows
    for (let steps = 0; steps < totalRows * 12; steps++) {
      if (m > 11) { m = 0; r++; }
      if (m < 0) { m = 11; r--; }
      if (r < 0 || r >= totalRows) return null;
      const row = displayRows[r];
      if (row && !row.isRefOnly && row.item.id && isCellEditable(row.item, MONTH_KEYS[m])) {
        return { rowIdx: r, monthIdx: m, item: row.item };
      }
      m += direction;
    }
    return null;
  }, [displayRows, isCellEditable]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      // Save current cell
      if (editingCell && onCellChange) {
        const val = parseFloat(editValue) || 0;
        onCellChange(editingCell.id, editingCell.monthKey, val);
      }
      // Navigate to next/prev editable cell
      const currentMonthIdx = MONTH_KEYS.indexOf(editingCell?.monthKey);
      const currentRowIdx = editingCell?.rowIdx;
      if (currentRowIdx != null && currentMonthIdx !== -1) {
        const direction = e.shiftKey ? -1 : 1;
        const next = findNextEditableCell(currentRowIdx, currentMonthIdx, direction);
        if (next) {
          setEditingCell({ id: next.item.id, monthKey: MONTH_KEYS[next.monthIdx], rowIdx: next.rowIdx });
          const num = parseFloat(next.item[MONTH_KEYS[next.monthIdx]]);
          setEditValue(isNaN(num) || num === 0 ? '' : num.toString());
          return;
        }
      }
      // Fallback: just exit edit mode
      setEditingCell(null);
      setEditValue('');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
      setEditValue('');
    }
  }, [editingCell, editValue, onCellChange, findNextEditableCell, handleFinishEdit]);

  // --- Multi-cell selection ---
  const computeSelectedCells = useCallback((anchor, end) => {
    if (!anchor || !end) return new Set();
    const minRow = Math.min(anchor.rowIdx, end.rowIdx);
    const maxRow = Math.max(anchor.rowIdx, end.rowIdx);
    const minMonth = Math.min(anchor.monthIdx, end.monthIdx);
    const maxMonth = Math.max(anchor.monthIdx, end.monthIdx);
    const cells = new Set();
    for (let r = minRow; r <= maxRow; r++) {
      const row = displayRows[r];
      if (!row || row.isRefOnly || !row.item.id) continue;
      for (let m = minMonth; m <= maxMonth; m++) {
        if (isCellEditable(row.item, MONTH_KEYS[m])) {
          cells.add(`${row.item.id}:${MONTH_KEYS[m]}`);
        }
      }
    }
    return cells;
  }, [displayRows, isCellEditable]);

  const handleCellMouseDown = useCallback((e, rowIdx, monthIdx) => {
    if (e.button === 2) return; // Skip right-click (context menu for notes)
    if (!isEditable || isLocked) return;
    // Don't interfere with active editing on the clicked cell
    const row = displayRows[rowIdx];
    if (row && !row.isRefOnly && editingCell?.id === row.item.id && editingCell?.monthKey === MONTH_KEYS[monthIdx]) {
      return;
    }
    e.preventDefault();
    if (editingCell) handleFinishEdit();
    const anchor = { rowIdx, monthIdx };
    if (e.shiftKey && selectionAnchor) {
      const newEnd = { rowIdx, monthIdx };
      setSelectionEnd(newEnd);
      setSelectedCells(computeSelectedCells(selectionAnchor, newEnd));
    } else {
      setSelectionAnchor(anchor);
      setSelectionEnd(anchor);
      setSelectedCells(computeSelectedCells(anchor, anchor));
      setIsSelecting(true);
    }
    setShowBulkInput(false);
    setBulkEditValue('');
  }, [isEditable, isLocked, displayRows, editingCell, handleFinishEdit, selectionAnchor, computeSelectedCells]);

  const handleCellMouseEnter = useCallback((rowIdx, monthIdx) => {
    if (!isSelecting || !selectionAnchor) return;
    const newEnd = { rowIdx, monthIdx };
    setSelectionEnd(newEnd);
    setSelectedCells(computeSelectedCells(selectionAnchor, newEnd));
  }, [isSelecting, selectionAnchor, computeSelectedCells]);

  const handleBulkApply = useCallback(() => {
    if (bulkEditValue === '') return;
    const val = parseFloat(bulkEditValue) || 0;
    for (const cellKey of selectedCells) {
      const colonIdx = cellKey.indexOf(':');
      const id = parseInt(cellKey.substring(0, colonIdx));
      const monthKey = cellKey.substring(colonIdx + 1);
      onCellChange(id, monthKey, val);
    }
    setSelectedCells(new Set());
    setSelectionAnchor(null);
    setSelectionEnd(null);
    setShowBulkInput(false);
    setBulkEditValue('');
  }, [selectedCells, bulkEditValue, onCellChange]);

  const handleBulkCancel = useCallback(() => {
    setSelectedCells(new Set());
    setSelectionAnchor(null);
    setSelectionEnd(null);
    setShowBulkInput(false);
    setBulkEditValue('');
  }, []);

  // Document-level mouseup: finalize selection
  useEffect(() => {
    const onMouseUp = () => {
      if (!isSelecting) return;
      setIsSelecting(false);
      if (selectedCells.size === 1) {
        const cellKey = [...selectedCells][0];
        const colonIdx = cellKey.indexOf(':');
        const id = parseInt(cellKey.substring(0, colonIdx));
        const monthKey = cellKey.substring(colonIdx + 1);
        const rowIdx = displayRows.findIndex(r => r.item.id === id);
        const row = rowIdx !== -1 ? displayRows[rowIdx] : null;
        if (row) handleStartEdit(id, monthKey, row.item[monthKey], rowIdx);
        setSelectedCells(new Set());
        setSelectionAnchor(null);
        setSelectionEnd(null);
      } else if (selectedCells.size > 1) {
        setShowBulkInput(true);
      }
    };
    document.addEventListener('mouseup', onMouseUp);
    return () => document.removeEventListener('mouseup', onMouseUp);
  }, [isSelecting, selectedCells, displayRows, handleStartEdit]);

  // Document-level Escape: clear selection
  useEffect(() => {
    const onKeyDown = (e) => {
      if (e.key === 'Escape' && (selectedCells.size > 0 || showBulkInput)) {
        handleBulkCancel();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [selectedCells.size, showBulkInput, handleBulkCancel]);

  const computeRowTotal = useCallback((item) => {
    return MONTH_KEYS.reduce((sum, key) => sum + (parseFloat(item[key]) || 0), 0);
  }, []);

  // Drag-and-drop handlers
  // Allow dragging detail rows, account headers, and sub-totals (totals with account_code).
  // Top-level section headers and section totals (no account_code) stay fixed.
  const isDraggableRow = useCallback((item, isRefOnly) => {
    if (!canDrag || isRefOnly || !item.id) return false;
    if (item.row_type === 'detail') return true;
    if (item.row_type === 'account_header') return true;
    if (item.row_type === 'total' && item.account_code) return true;
    return false;
  }, [canDrag]);

  const handleDragStart = useCallback((e, item) => {
    setDragRowId(item.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', String(item.id));
    // Make the drag ghost slightly transparent
    if (e.target?.closest?.('tr')) {
      e.target.closest('tr').style.opacity = '0.4';
    }
  }, []);

  const handleDragEnd = useCallback((e) => {
    if (e.target?.closest?.('tr')) {
      e.target.closest('tr').style.opacity = '';
    }
    setDragRowId(null);
    setDropTargetIdx(null);
  }, []);

  const handleDragOver = useCallback((e, idx) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetIdx(idx);
  }, []);

  const handleDrop = useCallback((e, dropIdx) => {
    e.preventDefault();
    setDropTargetIdx(null);

    if (!dragRowId || !onRowReorder) return;

    // Build ordered list of IDs from displayRows (only real rows with IDs)
    const orderedIds = [];
    const displayItems = [];
    for (const { item, isRefOnly } of displayRows) {
      if (!isRefOnly && item.id) {
        orderedIds.push(item.id);
        displayItems.push(item);
      }
    }

    const fromIdx = orderedIds.indexOf(dragRowId);
    if (fromIdx < 0) return;

    // Compute the target position in orderedIds from the displayRows drop index
    let toIdx = 0;
    let realCount = 0;
    for (let i = 0; i < displayRows.length && i <= dropIdx; i++) {
      const { item: di, isRefOnly: ro } = displayRows[i];
      if (!ro && di.id) {
        toIdx = realCount;
        realCount++;
      }
    }
    if (fromIdx === toIdx) return;

    // Reorder
    const newOrder = [...orderedIds];
    const [moved] = newOrder.splice(fromIdx, 1);
    newOrder.splice(toIdx > fromIdx ? toIdx - 1 : toIdx, 0, moved);

    onRowReorder(moved, newOrder);
    setDragRowId(null);
  }, [dragRowId, onRowReorder, displayRows]);

  if (loading) {
    return (
      <div className="py-8 px-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-5 w-5 rounded-full border-[3px] border-emerald-600 border-t-transparent animate-spin" />
          <span className="text-sm font-semibold text-black">Loading P&L data...</span>
        </div>
        <div className="space-y-2">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex gap-3 animate-pulse">
              <div className="h-4 bg-emerald-100 rounded w-48" />
              <div className="h-4 bg-emerald-50 rounded w-20" />
              <div className="h-4 bg-emerald-100 rounded w-20" />
              <div className="h-4 bg-emerald-50 rounded w-20" />
              <div className="h-4 bg-emerald-100 rounded w-20" />
            </div>
          ))}
        </div>
      </div>
    );
  }

  const actualCount = importedMonthKeys.size;
  const forecastCount = 12 - actualCount;
  const forecastLabel = actualCount > 0 && forecastCount > 0
    ? `${actualCount}+${forecastCount} Forecast`
    : actualCount === 12 ? 'Full Year Actuals' : forecastCount === 12 ? 'Full Forecast' : '';

  if (!lineItems?.length) return null;

  // Pre-compute which P&L section each row belongs to (for variance sign).
  // Income sections: higher current = favorable (positive variance).
  // Expense/COGS sections: higher current = unfavorable (negative variance).
  let _sect = '';
  const rowSectionNames = displayRows.map(({ item }) => {
    if (item.row_type === 'section_header') {
      _sect = item.account_name?.toLowerCase().trim() || '';
    }
    return _sect;
  });

  return (
    <div className="mt-4">
      {forecastLabel && (
        <div className="mb-1.5 flex items-center gap-3 text-xs text-gray-500">
          <span className="font-semibold text-gray-700">{forecastLabel}</span>
          {actualCount > 0 && forecastCount > 0 && (
            <>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-blue-50 border border-blue-200"></span> Actual</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-white border border-gray-200"></span> Forecast</span>
            </>
          )}
        </div>
      )}
      <div className="overflow-x-auto overflow-y-auto max-h-[85vh] border border-gray-200 rounded-lg">
        {showBulkInput && (
          <div className="flex items-center gap-2 px-3 py-1.5 bg-blue-50 border-b border-blue-200 text-xs">
            <span className="text-blue-700 font-medium">{selectedCells.size} cells selected</span>
            <input
              type="text"
              inputMode="decimal"
              value={bulkEditValue}
              onChange={(e) => {
                const v = e.target.value;
                if (v === '' || v === '-' || /^-?\d*\.?\d*$/.test(v)) setBulkEditValue(v);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleBulkApply();
                if (e.key === 'Escape') handleBulkCancel();
              }}
              autoFocus
              placeholder="Enter value"
              className="w-28 px-2 py-0.5 border border-blue-300 rounded bg-white text-right focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
            <button
              onClick={handleBulkApply}
              className="px-2 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
            >
              Fill
            </button>
            <button
              onClick={handleBulkCancel}
              className="px-2 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
            >
              Cancel
            </button>
          </div>
        )}
        <table className={`text-xs ${isSelecting ? 'select-none' : ''}`} style={{ tableLayout: 'fixed' }}>
          <thead>
            <tr className="bg-blue-900 border-b border-blue-800 sticky top-0 z-20">
              <th
                className="text-left py-1 px-1.5 font-semibold text-white sticky left-0 bg-blue-900 z-30 relative select-none"
                style={{ width: accountColWidth, minWidth: 120 }}
              >
                Account
                <span
                  onMouseDown={(e) => handleResizeStart(e, 'account')}
                  className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 active:bg-blue-300"
                />
              </th>
              {MONTH_KEYS.map((key, idx) => {
                const isActual = importedMonthKeys.has(key);
                const isBoundary = actualCount > 0 && actualCount < 12 && idx === actualCount;
                return (
                  <th
                    key={key}
                    className={`text-right py-1 px-1 font-semibold relative select-none ${
                      isActual ? 'bg-blue-950 text-white' : 'text-white'
                    } ${isBoundary ? 'border-l-2 border-l-blue-300' : ''}`}
                    style={{ width: monthColWidth, minWidth: 36 }}
                  >
                    {MONTH_LABELS[idx]}
                    {idx === 11 && (
                      <span
                        onMouseDown={(e) => handleResizeStart(e, 'month')}
                        className="absolute right-0 top-0 bottom-0 w-1.5 cursor-col-resize hover:bg-blue-400 active:bg-blue-300"
                      />
                    )}
                  </th>
                );
              })}
              <th className="text-right py-1 px-1.5 font-semibold text-white min-w-[65px] border-l-2 border-r-2 border-blue-900">
                Total
              </th>
              {showComparison && (
                <>
                  <th className="text-right py-1 px-1.5 font-semibold text-white min-w-[65px] border-l border-blue-700">
                    Ref
                  </th>
                  <th className="text-right py-1 px-1 font-semibold text-white min-w-[58px]">
                    $ Var
                  </th>
                  <th className="text-right py-1 px-1 font-semibold text-white min-w-[42px]">
                    %
                  </th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {displayRows.map(({ item, refItem, isRefOnly }, idx) => {
              const total = isRefOnly ? 0 : computeRowTotal(item);
              const refTotal = refItem ? computeRowTotal(refItem) : (showComparison && !isRefOnly ? 0 : null);

              // Determine variance sign: expense/COGS rows invert (spending more = unfavorable)
              const sectionName = rowSectionNames[idx];
              const isIncomeSection = sectionName === 'income' || sectionName.startsWith('other income');
              const accountName = item.account_name?.toLowerCase().trim() || '';
              const isSummaryRow = item.row_type === 'calculated' || item.row_type === 'percent' ||
                isNOI(accountName) || accountName === 'net income';
              const invertVariance = !isIncomeSection && !isSummaryRow && sectionName !== '';

              const rawVar = refTotal !== null ? total - refTotal : null;
              const dollarVar = rawVar !== null ? (invertVariance ? -rawVar : rawVar) : null;
              const pctVar = refTotal !== null && refTotal !== 0
                ? ((invertVariance ? -rawVar : rawVar) / Math.abs(refTotal)) * 100
                : null;

              // For percent rows, compute annual % from dollar rows
              let percentAnnual = null;
              let refPercentAnnual = null;
              if (item.row_type === 'percent' && !isRefOnly) {
                const percentName = item.account_name?.toLowerCase().trim();
                const incItem = computedLineItems.find(li =>
                  (li.row_type === 'total' || li.row_type === 'calculated') &&
                  normalizeTotalName(li.account_name) === 'total income'
                );
                const incAnnual = incItem ? computeRowTotal(incItem) : 0;

                if (percentName === 'gross profit %') {
                  const gpItem = computedLineItems.find(li => li.row_type === 'calculated' && li.account_name?.toLowerCase() === 'gross profit');
                  if (gpItem && incAnnual !== 0) {
                    percentAnnual = (computeRowTotal(gpItem) / incAnnual) * 100;
                  } else { percentAnnual = 0; }
                } else if (percentName === 'direct labor %') {
                  const dlItem = computedLineItems.find(li =>
                    li.row_type === 'total' && normalizeTotalName(li.account_name) === 'total direct labor'
                  );
                  if (dlItem && incAnnual !== 0) {
                    percentAnnual = (computeRowTotal(dlItem) / incAnnual) * 100;
                  } else { percentAnnual = 0; }
                } else if (isNOIPct(percentName)) {
                  const noiItem = computedLineItems.find(li =>
                    (li.row_type === 'total' || li.row_type === 'calculated' || li.row_type === 'section_header') &&
                    isNOI(li.account_name)
                  );
                  if (noiItem && incAnnual !== 0) {
                    percentAnnual = (computeRowTotal(noiItem) / incAnnual) * 100;
                  } else { percentAnnual = 0; }
                } else if (percentName === 'net income %') {
                  const niItem = computedLineItems.find(li =>
                    (li.row_type === 'total' || li.row_type === 'calculated' || li.row_type === 'section_header') &&
                    li.account_name?.toLowerCase().trim() === 'net income'
                  );
                  if (niItem && incAnnual !== 0) {
                    percentAnnual = (computeRowTotal(niItem) / incAnnual) * 100;
                  } else { percentAnnual = 0; }
                }

                // Compute reference percent from recalculated displayRows ref totals
                if (referenceItems?.length) {
                  const refIncRow = displayRows.find(dr =>
                    !dr.isRefOnly && dr.refItem &&
                    dr.item.row_type === 'total' &&
                    normalizeTotalName(dr.item.account_name) === 'total income'
                  );
                  const refIncAnnual = refIncRow?.refItem ? computeRowTotal(refIncRow.refItem) : 0;

                  if (percentName === 'gross profit %') {
                    const refCogsRow = displayRows.find(dr =>
                      !dr.isRefOnly && dr.refItem &&
                      dr.item.row_type === 'total' &&
                      normalizeTotalName(dr.item.account_name).startsWith('total cost of')
                    );
                    if (refIncRow?.refItem && refCogsRow?.refItem && refIncAnnual !== 0) {
                      const refGpAnnual = refIncAnnual - computeRowTotal(refCogsRow.refItem);
                      refPercentAnnual = (refGpAnnual / refIncAnnual) * 100;
                    } else { refPercentAnnual = 0; }
                  } else if (percentName === 'direct labor %') {
                    const refDlRow = displayRows.find(dr =>
                      !dr.isRefOnly && dr.refItem &&
                      dr.item.row_type === 'total' &&
                      normalizeTotalName(dr.item.account_name) === 'total direct labor'
                    );
                    if (refDlRow?.refItem && refIncAnnual !== 0) {
                      refPercentAnnual = (computeRowTotal(refDlRow.refItem) / refIncAnnual) * 100;
                    } else { refPercentAnnual = 0; }
                  } else if (isNOIPct(percentName) || percentName === 'net income %') {
                    // Find the reference dollar row from displayRows
                    const dollarRow = displayRows.find(dr => {
                      if (dr.isRefOnly) return false;
                      const rt = dr.item.row_type;
                      if (rt !== 'total' && rt !== 'calculated' && rt !== 'section_header') return false;
                      if (isNOIPct(percentName)) return isNOI(dr.item.account_name);
                      return dr.item.account_name?.toLowerCase().trim() === 'net income';
                    });
                    if (dollarRow?.refItem && refIncAnnual !== 0) {
                      refPercentAnnual = (computeRowTotal(dollarRow.refItem) / refIncAnnual) * 100;
                    } else { refPercentAnnual = 0; }
                  }
                }
              }

              const draggable = isDraggableRow(item, isRefOnly);
              const isDragging = dragRowId === item.id;
              const isDropTarget = dropTargetIdx === idx;

              const isAdminOnly = item.admin_only && isAdmin;
              const isDLPercent = item.row_type === 'percent' && item.account_name?.toLowerCase().trim() === 'direct labor %';

              // Compute per-month reference percents for GP% and NOI% heat-map
              const pctName = item.row_type === 'percent' ? item.account_name?.toLowerCase().trim() : '';
              const isGPPercent = pctName === 'gross profit %';
              const isNOIPercent = isNOIPct(pctName);
              let refMonthPcts = null;
              if ((isGPPercent || isNOIPercent) && showComparison && !isRefOnly) {
                const refIncRow = displayRows.find(dr =>
                  !dr.isRefOnly && dr.refItem &&
                  dr.item.row_type === 'total' &&
                  normalizeTotalName(dr.item.account_name) === 'total income'
                );
                if (refIncRow?.refItem) {
                  refMonthPcts = {};
                  if (isGPPercent) {
                    const refCogsRow = displayRows.find(dr =>
                      !dr.isRefOnly && dr.refItem &&
                      dr.item.row_type === 'total' &&
                      normalizeTotalName(dr.item.account_name).startsWith('total cost of')
                    );
                    for (const mk of MONTH_KEYS) {
                      const refInc = parseFloat(refIncRow.refItem[mk]) || 0;
                      const refCogs = refCogsRow ? (parseFloat(refCogsRow.refItem[mk]) || 0) : 0;
                      refMonthPcts[mk] = refInc !== 0 ? ((refInc - refCogs) / refInc) * 100 : null;
                    }
                  } else {
                    const refNoiRow = displayRows.find(dr =>
                      !dr.isRefOnly && dr.refItem &&
                      (dr.item.row_type === 'total' || dr.item.row_type === 'calculated' || dr.item.row_type === 'section_header') &&
                      isNOI(dr.item.account_name)
                    );
                    for (const mk of MONTH_KEYS) {
                      const refInc = parseFloat(refIncRow.refItem[mk]) || 0;
                      const refNoi = refNoiRow ? (parseFloat(refNoiRow.refItem[mk]) || 0) : 0;
                      refMonthPcts[mk] = refInc !== 0 ? (refNoi / refInc) * 100 : null;
                    }
                  }
                }
              }

              // Compute expected seeded values for pct_of_total rows (for purple tint on matching cells)
              let pctExpected = null;
              if (!isRefOnly && item.pct_of_total != null && item.pct_source) {
                const sources = parsePctSources(item.pct_source);
                const pct = parseFloat(item.pct_of_total) / 100;
                if (sources.length > 0 && !isNaN(pct)) {
                  pctExpected = {};
                  for (const mk of MONTH_KEYS) {
                    if (importedMonthKeys.has(mk)) continue;
                    let sourceSum = 0;
                    for (const src of sources) {
                      const srcRow = findSourceRow(src);
                      if (srcRow) sourceSum += parseFloat(srcRow[mk]) || 0;
                    }
                    pctExpected[mk] = Math.round(sourceSum * pct * 100) / 100;
                  }
                }
              }

              return (
                <tr
                  key={isRefOnly ? `ref-${item.account_code || idx}` : (item.id || item.row_order || `computed-${idx}`)}
                  className={`${getRowClasses(item.row_type)} ${isRefOnly ? 'opacity-60' : ''} ${
                    isDragging ? 'opacity-40' : ''
                  } ${isDropTarget && dragRowId ? 'border-t-2 border-t-blue-500' : ''} ${
                    isAdminOnly ? 'bg-red-50/60' : ''
                  }`}
                  draggable={draggable}
                  onDragStart={draggable ? (e) => handleDragStart(e, item) : undefined}
                  onDragEnd={draggable ? handleDragEnd : undefined}
                  onDragOver={dragRowId ? (e) => handleDragOver(e, idx) : undefined}
                  onDrop={dragRowId ? (e) => handleDrop(e, idx) : undefined}
                >
                  <td
                    className={`py-0.5 px-1.5 sticky left-0 z-10 truncate ${isAdminOnly ? 'bg-red-50/60' : getRowBg(item.row_type)} ${getTextWeight(item.row_type)} ${isRefOnly ? 'italic' : ''} group`}
                    style={{ paddingLeft: `${(draggable ? 0 : 6) + (item.indent_level || 0) * 10}px`, width: accountColWidth, maxWidth: accountColWidth }}
                    title={item.cell_notes?._row ? `${item.account_name}\n📝 ${item.cell_notes._row}` : item.account_name}
                    onContextMenu={(e) => handleCellContextMenu(e, item, '_row')}
                  >
                    {draggable && (
                      <span className="inline-block w-5 text-center cursor-grab active:cursor-grabbing text-gray-300 hover:text-gray-500 select-none" style={{ marginRight: '2px' }}>
                        ⠿
                      </span>
                    )}
                    {onToggleAdminOnly && (item.row_type === 'detail' || item.row_type === 'total' || item.row_type === 'calculated' || item.row_type === 'section_header') && !isRefOnly && item.id && (
                      <span
                        className={`inline-block w-4 text-center cursor-pointer select-none ${
                          item.admin_only
                            ? 'text-red-400 hover:text-red-600'
                            : 'text-transparent group-hover:text-gray-300 hover:!text-gray-500'
                        }`}
                        style={{ marginRight: '2px', fontSize: '11px' }}
                        title={item.admin_only ? 'Visible to admins only — click to make visible to all' : 'Click to hide from non-admins'}
                        onClick={(e) => { e.stopPropagation(); onToggleAdminOnly(item.id, item.admin_only); }}
                      >
                        {item.admin_only ? '🔒' : '👁'}
                      </span>
                    )}
                    {onTogglePctMode && item.row_type === 'detail' && !isRefOnly && item.id && (
                      <span
                        className={`inline-block w-4 text-center cursor-pointer select-none ${
                          item.pct_of_total != null
                            ? 'text-purple-500 hover:text-purple-700 font-bold'
                            : 'text-gray-300 hover:text-purple-500'
                        }`}
                        style={{ marginRight: '2px', fontSize: '11px' }}
                        title={item.pct_of_total != null
                          ? `${item.pct_of_total}% of ${formatPctSources(parsePctSources(item.pct_source), computedLineItems)} — click to re-seed`
                          : 'Seed forecast as % of total rows'}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const rect = e.currentTarget.getBoundingClientRect();
                          const existingSources = parsePctSources(item.pct_source);
                          const isIncomeRow = sectionName === 'income';
                          if (pctPopover?.id === item.id) {
                            setPctPopover(null);
                            return;
                          }
                          // Fetch cross-dept data if this is a revenue row and crossDeptConfig is available
                          if (isIncomeRow && crossDeptConfig && !crossDeptData) {
                            try {
                              const vParam = crossDeptConfig.versionName ? `&versionName=${encodeURIComponent(crossDeptConfig.versionName)}` : '';
                              const res = await fetch(`/api/pnl/cross-dept-revenue?branchId=${crossDeptConfig.branchId}&year=${crossDeptConfig.year}${vParam}`);
                              const result = await res.json();
                              console.log('[cross-dept] API response:', result);
                              if (result.success) setCrossDeptData(result.departments);
                            } catch (err) {
                              console.error('Failed to fetch cross-dept revenue:', err);
                            }
                          }
                          setPctPopover({
                            id: item.id,
                            pctOfTotal: item.pct_of_total != null ? String(item.pct_of_total) : '',
                            pctSources: existingSources.length ? existingSources : [],
                            x: rect.left,
                            y: rect.bottom + 4,
                            hasExisting: item.pct_of_total != null,
                            isIncomeRow
                          });
                        }}
                      >
                        %
                      </span>
                    )}
                    {isRefOnly && item.row_type === 'detail' && onAddRefRow && (
                      <span
                        className="inline-block w-4 text-center cursor-pointer select-none text-green-400 hover:text-green-600 font-bold"
                        style={{ marginRight: '2px', fontSize: '13px' }}
                        title="Add this row to the current version"
                        onClick={(e) => {
                          e.stopPropagation();
                          // Find the next non-ref-only row to insert before
                          let insertBeforeId = null;
                          for (let j = idx + 1; j < displayRows.length; j++) {
                            if (!displayRows[j].isRefOnly && displayRows[j].item.id) {
                              insertBeforeId = displayRows[j].item.id;
                              break;
                            }
                          }
                          onAddRefRow(item, insertBeforeId);
                        }}
                      >
                        +
                      </span>
                    )}
                    {onDeleteLineItem && item.row_type === 'detail' && !isRefOnly && item.id && (
                      <span
                        className="inline-block w-4 text-center cursor-pointer select-none text-transparent group-hover:text-gray-300 hover:!text-red-500"
                        style={{ marginRight: '2px', fontSize: '11px' }}
                        title="Delete this row"
                        onClick={(e) => { e.stopPropagation(); onDeleteLineItem(item.id); }}
                      >
                        ✕
                      </span>
                    )}
                    {item.cell_notes?._row && (
                      <span className="text-amber-500 mr-0.5" style={{ fontSize: '9px' }} title={item.cell_notes._row}>●</span>
                    )}
                    {item.account_name}
                    {item.pct_of_total != null && (
                      <span className="ml-1 text-purple-400 text-[10px] font-normal"
                        title={`${item.pct_of_total}% of ${formatPctSources(parsePctSources(item.pct_source), computedLineItems)}`}
                      >
                        ({item.pct_of_total}% of {formatPctSources(parsePctSources(item.pct_source), computedLineItems)})
                      </span>
                    )}
                  </td>

                  {MONTH_KEYS.map((key, keyIdx) => {
                    const val = isRefOnly ? 0 : (parseFloat(item[key]) || 0);
                    const isImported = importedMonthKeys.has(key);
                    const canEdit = !isRefOnly && isCellEditable(item, key);
                    const isEditing = !isRefOnly && editingCell?.id === item.id && editingCell?.monthKey === key;
                    const isBoundary = actualCount > 0 && actualCount < 12 && keyIdx === actualCount;
                    const isSelected = !isRefOnly && selectedCells.has(`${item.id}:${key}`);
                    const isPctMatch = pctExpected && key in pctExpected && val === pctExpected[key];
                    const dlBg = isDLPercent && !isRefOnly ? getDLPercentBg(val) : null;
                    const varBg = !dlBg && refMonthPcts ? getVariancePercentBg(val, refMonthPcts[key], 10) : null;
                    const cellBg = dlBg || varBg || (isPctMatch ? 'rgba(147, 51, 234, 0.08)' : null);
                    const cellNote = !isRefOnly && item.cell_notes?.[key];
                    const deptBreakdown = item._deptBreakdown?.[key];
                    const cellTitle = (() => {
                      const parts = [];
                      if (deptBreakdown) {
                        const DEPT_SHORT = { maintenance: 'Maint', maintenance_onsite: 'Onsite', maintenance_wo: 'WO' };
                        for (const [dk, dv] of Object.entries(deptBreakdown)) {
                          if (dv !== 0) parts.push(`${DEPT_SHORT[dk] || dk}: ${formatCurrency(dv)}`);
                        }
                      }
                      if (cellNote) parts.push(cellNote);
                      return parts.length ? parts.join('\n') : undefined;
                    })();

                    return (
                      <td
                        key={key}
                        className={`py-0.5 px-0.5 text-right tabular-nums relative ${
                          val < 0 ? 'text-red-600' : ''
                        } ${getTextWeight(item.row_type)} ${
                          isSelected ? 'bg-blue-100' :
                          !cellBg && isImported && !isRefOnly ? 'bg-blue-50/70' : ''
                        } ${canEdit && !isEditing ? 'cursor-pointer hover:bg-yellow-50' : ''
                        } ${isBoundary ? 'border-l-2 border-l-blue-300' : ''}`}
                        style={cellBg ? { backgroundColor: cellBg } : undefined}
                        title={cellTitle}
                        onMouseDown={(e) => handleCellMouseDown(e, idx, keyIdx)}
                        onMouseEnter={() => handleCellMouseEnter(idx, keyIdx)}
                        onContextMenu={(e) => handleCellContextMenu(e, item, key)}
                      >
                        {cellNote && (
                          <div className="absolute top-0 right-0 w-0 h-0"
                            style={{ borderLeft: '6px solid transparent', borderTop: '6px solid #f59e0b' }} />
                        )}
                        {isEditing ? (
                          <input
                            type="text"
                            inputMode="decimal"
                            value={editValue}
                            onChange={(e) => {
                              const v = e.target.value;
                              if (v === '' || v === '-' || /^-?\d*\.?\d*$/.test(v)) setEditValue(v);
                            }}
                            onBlur={handleFinishEdit}
                            onKeyDown={handleKeyDown}
                            autoFocus
                            onFocus={(e) => e.target.select()}
                            className="w-full text-right text-xs px-0.5 py-0 border border-blue-400 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                          />
                        ) : (
                          <span className={canEdit && val === 0 ? 'text-gray-300' : ''}>
                            {item.row_type === 'percent' ? formatPercent(val) : formatCurrency(val)}
                          </span>
                        )}
                      </td>
                    );
                  })}

                  <td
                    className={`py-0.5 px-1.5 text-right tabular-nums border-l-2 border-r-2 border-gray-400 font-semibold ${
                      total < 0 ? 'text-red-600' : ''
                    } ${getTextWeight(item.row_type)}`}
                    style={
                      isDLPercent && percentAnnual !== null
                        ? { backgroundColor: getDLPercentBg(percentAnnual) || undefined }
                        : (isGPPercent || isNOIPercent) && percentAnnual !== null && refPercentAnnual !== null
                          ? { backgroundColor: getVariancePercentBg(percentAnnual, refPercentAnnual, 10) || undefined }
                          : undefined
                    }
                    title={item._deptBreakdown ? (() => {
                      const DEPT_SHORT = { maintenance: 'Maint', maintenance_onsite: 'Onsite', maintenance_wo: 'WO' };
                      const totals = {};
                      for (const mk of MONTH_KEYS) {
                        const bd = item._deptBreakdown[mk];
                        if (!bd) continue;
                        for (const [dk, dv] of Object.entries(bd)) {
                          totals[dk] = (totals[dk] || 0) + (parseFloat(dv) || 0);
                        }
                      }
                      return Object.entries(totals)
                        .filter(([, v]) => v !== 0)
                        .map(([dk, v]) => `${DEPT_SHORT[dk] || dk}: ${formatCurrency(v)}`)
                        .join('\n') || undefined;
                    })() : undefined}
                  >
                    {item.row_type === 'percent'
                      ? (percentAnnual !== null ? formatPercent(percentAnnual) : '\u2014')
                      : formatCurrency(total)}
                  </td>

                  {showComparison && (
                    item.row_type === 'percent' ? (
                      <>
                        <td className="py-0.5 px-1.5 text-right tabular-nums border-l border-gray-300 bg-amber-50 font-bold">
                          {refPercentAnnual !== null ? formatPercent(refPercentAnnual) : '\u2014'}
                        </td>
                        <td className={`py-0.5 px-1 text-right tabular-nums bg-amber-50 font-bold ${
                          percentAnnual !== null && refPercentAnnual !== null && (percentAnnual - refPercentAnnual) > 0 ? 'text-green-600' :
                          percentAnnual !== null && refPercentAnnual !== null && (percentAnnual - refPercentAnnual) < 0 ? 'text-red-600' : ''
                        }`}>
                          {percentAnnual !== null && refPercentAnnual !== null
                            ? formatPercent(percentAnnual - refPercentAnnual)
                            : '\u2014'}
                        </td>
                        <td className="py-0.5 px-1 text-right tabular-nums bg-amber-50 font-bold">{'\u2014'}</td>
                      </>
                    ) : (
                      <>
                        <td className={`py-0.5 px-1.5 text-right tabular-nums border-l border-gray-300 bg-amber-50 ${
                          refTotal !== null && refTotal < 0 ? 'text-red-600' : ''
                        } ${getTextWeight(item.row_type)}`}>
                          {refTotal !== null ? formatCurrency(refTotal) : '\u2014'}
                        </td>
                        <td className={`py-0.5 px-1 text-right tabular-nums bg-amber-50 ${
                          dollarVar !== null && dollarVar > 0 ? 'text-green-600' : dollarVar !== null && dollarVar < 0 ? 'text-red-600' : ''
                        } ${getTextWeight(item.row_type)}`}>
                          {dollarVar !== null ? formatCurrency(dollarVar) : '\u2014'}
                        </td>
                        <td className={`py-0.5 px-1 text-right tabular-nums bg-amber-50 ${
                          pctVar !== null && pctVar > 0 ? 'text-green-600' : pctVar !== null && pctVar < 0 ? 'text-red-600' : ''
                        } ${getTextWeight(item.row_type)}`}>
                          {pctVar !== null ? formatPercent(pctVar) : '\u2014'}
                        </td>
                      </>
                    )
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Add Structural Row button — visible when editable & unlocked */}
      {onAddStructuralRow && isEditable && !isLocked && (
        <div className="mt-1 ml-1">
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const popoverHeight = 420;
              const spaceBelow = window.innerHeight - rect.bottom;
              const openAbove = spaceBelow < popoverHeight && rect.top > popoverHeight;
              setStructuralPopover({
                x: rect.left,
                y: openAbove ? rect.top - popoverHeight - 4 : rect.bottom + 4
              });
              setStructuralSearch('');
              setStructuralRows([]);
            }}
            className="text-xs text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-2 py-1 rounded font-medium"
          >
            + Add Row
          </button>
        </div>
      )}

      {/* Structural row catalog popover — rendered outside the overflow wrapper */}
      {structuralPopover && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setStructuralPopover(null)} />
          <div
            className="fixed z-[100] bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs"
            style={{ left: structuralPopover.x, top: structuralPopover.y, width: '340px', maxHeight: '420px', display: 'flex', flexDirection: 'column' }}
          >
            <div className="mb-2 font-semibold text-gray-700 text-sm">Add Structural Row</div>
            <input
              type="text"
              value={structuralSearch}
              onChange={(e) => setStructuralSearch(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') setStructuralPopover(null); }}
              autoFocus
              placeholder="Search rows..."
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs mb-2 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
            />
            <div className="overflow-y-auto flex-1" style={{ maxHeight: '320px' }}>
              {structuralLoading ? (
                <div className="text-center py-4 text-black text-sm font-medium">Loading...</div>
              ) : structuralRows.length === 0 ? (
                <div className="text-center py-4 text-gray-400">{structuralSearch ? 'No matches' : 'Type to search or browse all'}</div>
              ) : (
                ['section_header', 'account_header', 'total', 'calculated'].map(type => {
                  const rows = structuralRows.filter(r => r.row_type === type);
                  if (!rows.length) return null;
                  const label = type === 'section_header' ? 'Section Headers'
                    : type === 'account_header' ? 'Account Headers'
                    : type === 'total' ? 'Totals'
                    : 'Calculated';
                  return (
                    <div key={type} className="mb-1.5">
                      <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1 pt-1.5 pb-0.5">{label}</div>
                      {rows.map((row, i) => (
                        <button
                          key={`${type}-${i}`}
                          onClick={() => {
                            onAddStructuralRow(row, null);
                            setStructuralPopover(null);
                          }}
                          className="w-full text-left px-2 py-1 hover:bg-blue-50 rounded cursor-pointer flex items-center gap-2"
                        >
                          <span className={`truncate ${type === 'total' || type === 'calculated' ? 'font-semibold' : type === 'account_header' ? 'font-medium' : ''}`}>
                            {row.account_name}
                          </span>
                          <span className="text-[10px] text-gray-400 flex-shrink-0">{row.row_type.replace('_', ' ')}</span>
                        </button>
                      ))}
                    </div>
                  );
                })
              )}
            </div>
            <div className="flex justify-end mt-2 pt-2 border-t border-gray-200">
              <button
                onClick={() => setStructuralPopover(null)}
                className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-xs"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Pct-of-total popover — rendered outside the overflow wrapper */}
      {pctPopover && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setPctPopover(null)} />
          <div
            className="fixed z-[100] bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs"
            style={{ left: pctPopover.x, top: pctPopover.y, width: '260px' }}
          >
            <div className="mb-2 font-semibold text-gray-700 text-sm">Seed as % of Source Rows</div>
            <div className="mb-2">
              <label className="text-gray-500 block mb-1 font-medium">Source rows:</label>
              <div className="max-h-48 overflow-y-auto border border-gray-200 rounded p-1">
                {availableSources.map(group => (
                  <div key={group.section}>
                    <div className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide px-1 pt-1.5 pb-0.5">{group.section}</div>
                    {group.items
                      .filter(t => t.value !== `detail:${computedLineItems.find(li => li.id === pctPopover.id)?.account_code}`)
                      .map(t => (
                      <label key={t.value} className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-gray-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pctPopover.pctSources.includes(t.value)}
                          onChange={(e) => {
                            setPctPopover(p => ({
                              ...p,
                              pctSources: e.target.checked
                                ? [...p.pctSources, t.value]
                                : p.pctSources.filter(s => s !== t.value)
                            }));
                          }}
                          className="rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                        />
                        <span className={`truncate ${t.type === 'total' ? 'font-semibold' : ''}`}>{t.label}</span>
                      </label>
                    ))}
                  </div>
                ))}
                {pctPopover.isIncomeRow && crossDeptConfig && (
                  <div>
                    <div className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide px-1 pt-2 pb-0.5 border-t border-gray-200 mt-1">Cross-Department Revenue</div>
                    {[
                      { label: 'Maintenance — Revenue', value: 'xdept:maintenance:total income' },
                      { label: 'Maintenance Onsite — Revenue', value: 'xdept:maintenance_onsite:total income' }
                    ].map(t => (
                      <label key={t.value} className="flex items-center gap-1.5 py-0.5 px-1 hover:bg-blue-50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pctPopover.pctSources.includes(t.value)}
                          onChange={(e) => {
                            setPctPopover(p => ({
                              ...p,
                              pctSources: e.target.checked
                                ? [...p.pctSources, t.value]
                                : p.pctSources.filter(s => s !== t.value)
                            }));
                          }}
                          className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="truncate font-semibold">{t.label}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="mb-3">
              <label className="text-gray-500 block mb-1 font-medium">Percentage:</label>
              <div className="flex items-center gap-1">
                <input
                  type="text"
                  inputMode="decimal"
                  value={pctPopover.pctOfTotal}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || /^\d*\.?\d*$/.test(v)) setPctPopover(p => ({ ...p, pctOfTotal: v }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handlePctApply();
                    if (e.key === 'Escape') setPctPopover(null);
                  }}
                  autoFocus
                  placeholder="e.g. 2.5"
                  className="w-24 px-2 py-1 border border-gray-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-purple-500"
                />
                <span className="text-gray-500">%</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handlePctApply}
                className="flex-1 px-3 py-1.5 bg-purple-600 text-white rounded hover:bg-purple-700 font-medium"
              >
                Apply
              </button>
              {pctPopover.hasExisting && (
                <button
                  onClick={() => {
                    onTogglePctMode(pctPopover.id, null, null);
                    setPctPopover(null);
                  }}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setPctPopover(null)}
                className="px-3 py-1.5 text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}

      {/* Cell note popover — rendered outside the overflow wrapper */}
      {notePopover && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setNotePopover(null)} />
          <div
            className="fixed z-[100] bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs"
            style={{ left: notePopover.x, top: notePopover.y, width: '260px' }}
          >
            <div className="mb-2 font-semibold text-gray-700 text-sm">{notePopover.monthKey === '_row' ? 'Row Note' : 'Cell Note'}</div>
            <textarea
              value={notePopover.noteText}
              onChange={(e) => setNotePopover(p => ({ ...p, noteText: e.target.value }))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleNoteSave(); }
                if (e.key === 'Escape') setNotePopover(null);
              }}
              autoFocus
              placeholder="Add a note..."
              rows={3}
              disabled={isLocked}
              className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs resize-none focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 disabled:bg-gray-100"
            />
            <div className="flex gap-2 mt-2">
              {!isLocked && (
                <button
                  onClick={handleNoteSave}
                  className="flex-1 px-3 py-1.5 bg-amber-500 text-white rounded hover:bg-amber-600 font-medium"
                >
                  Save
                </button>
              )}
              {!isLocked && notePopover.noteText && (
                <button
                  onClick={() => {
                    onUpdateCellNote(notePopover.id, notePopover.monthKey, null);
                    setNotePopover(null);
                  }}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setNotePopover(null)}
                className="px-3 py-1.5 text-gray-500 hover:text-gray-700"
              >
                {isLocked ? 'Close' : 'Cancel'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
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
