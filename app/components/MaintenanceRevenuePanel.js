'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { createBrowserClient } from '@supabase/ssr';

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const MAINT_DEPARTMENTS = ['maintenance', 'maintenance_onsite'];
const DEPT_LABELS = { maintenance: 'Maintenance', maintenance_onsite: 'Maintenance Onsite' };

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

function getBranchBg(branchName) {
  const n = branchName?.toLowerCase() || '';
  if (n.includes('north')) return 'rgba(34, 197, 94, 0.15)';
  if (n.includes('southeast')) return 'rgba(239, 68, 68, 0.12)';
  if (n.includes('southwest')) return 'rgba(59, 130, 246, 0.12)';
  if (n.includes('las vegas') || n === 'las vegas') return 'rgba(217, 176, 56, 0.18)';
  return null;
}

export default function MaintenanceRevenuePanel({ branchId, branchKey, year, versionState }) {
  const [allItems, setAllItems] = useState([]);
  const [refItems, setRefItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState(new Set());
  const [editingCell, setEditingCell] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [incrPopover, setIncrPopover] = useState(null);
  const pendingUpdates = useRef(new Map());
  const updateTimer = useRef(null);

  // Standalone version selector state (used when no external versionState, i.e. Encore)
  const [availableVersions, setAvailableVersions] = useState([]);
  const [internalVersionName, setInternalVersionName] = useState(null);
  const [internalRefName, setInternalRefName] = useState(null);

  const supabase = useMemo(() => createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ), []);

  const isPhoenixGroup = branchKey === 'corporate' || branchKey === 'phoenix';
  const isEncore = branchKey === 'encore';
  const isStandalone = !versionState;

  // Resolve target branches
  const [targetBranches, setTargetBranches] = useState(null);

  useEffect(() => {
    if (!branchId && !isEncore) return;
    async function resolve() {
      const { data: allBranches } = await supabase
        .from('branches')
        .select('id, name');

      if (isEncore) {
        // All maintenance branches: Phoenix subs + Las Vegas
        const phoenixParent = allBranches?.find(b => b.name === 'Phoenix');
        const phxSubs = (allBranches || []).filter(b =>
          b.name.toLowerCase().includes('phx') ||
          (b.name.toLowerCase().includes('phoenix') && b.id !== phoenixParent?.id)
        );
        const lasVegas = allBranches?.find(b => b.name === 'Las Vegas');
        const branches = [...phxSubs];
        if (lasVegas) branches.push(lasVegas);
        setTargetBranches(branches.sort((a, b) => a.name.localeCompare(b.name)));
        return;
      }

      if (isPhoenixGroup) {
        const phoenixParent = allBranches?.find(b => b.name === 'Phoenix');
        const subs = (allBranches || []).filter(b =>
          b.name.toLowerCase().includes('phx') ||
          (b.name.toLowerCase().includes('phoenix') && b.id !== phoenixParent?.id)
        );
        if (subs.length > 0) {
          setTargetBranches(subs.sort((a, b) => a.name.localeCompare(b.name)));
          return;
        }
      }

      const branch = allBranches?.find(b => b.id === branchId);
      setTargetBranches(branch ? [branch] : []);
    }
    resolve();
  }, [branchId, branchKey, isPhoenixGroup, isEncore, supabase]);

  // Fetch available maintenance version names (for standalone mode)
  useEffect(() => {
    if (!isStandalone || !targetBranches?.length) {
      setAvailableVersions([]);
      return;
    }
    async function fetchVersions() {
      const branchIds = targetBranches.map(b => b.id);
      const { data } = await supabase
        .from('pnl_versions')
        .select('version_name, actual_months, is_locked, created_at')
        .in('branch_id', branchIds)
        .in('department', MAINT_DEPARTMENTS)
        .eq('year', year)
        .order('created_at', { ascending: false });

      // Deduplicate by version_name, keep first (most recent)
      const seen = new Set();
      const unique = [];
      for (const v of (data || [])) {
        if (!seen.has(v.version_name)) {
          seen.add(v.version_name);
          unique.push(v);
        }
      }
      setAvailableVersions(unique);
    }
    fetchVersions();
  }, [isStandalone, targetBranches, year, supabase]);

  // Reset internal selections when target branches or year change
  const defaultsAppliedKey = useRef(null);
  useEffect(() => {
    setInternalVersionName(null);
    setInternalRefName(null);
    defaultsAppliedKey.current = null;
  }, [branchKey, year]);

  // Apply admin-configured defaults in standalone mode (e.g. Encore)
  const [pnlDefaults, setPnlDefaults] = useState(null);
  useEffect(() => {
    if (!isStandalone) return;
    fetch('/api/pnl-defaults')
      .then(r => r.json())
      .then(d => { if (d.success) setPnlDefaults(d.defaults); })
      .catch(() => {});
  }, [isStandalone]);

  useEffect(() => {
    if (!isStandalone || !pnlDefaults || !availableVersions?.length) return;
    const key = `${branchKey}-${year}`;
    if (defaultsAppliedKey.current === key) return;
    defaultsAppliedKey.current = key;
    if (pnlDefaults.default_version_name) {
      const match = availableVersions.find(v => v.version_name === pnlDefaults.default_version_name);
      if (match) setInternalVersionName(match.version_name);
    }
    if (pnlDefaults.compare_version_name) {
      const match = availableVersions.find(v => v.version_name === pnlDefaults.compare_version_name);
      if (match) setInternalRefName(match.version_name);
    }
  }, [isStandalone, pnlDefaults, availableVersions, branchKey, year]);

  // Build effective version state: use external if provided, otherwise internal
  const effectiveVersionState = useMemo(() => {
    if (versionState) return versionState;
    const selectedVersion = internalVersionName
      ? availableVersions.find(v => v.version_name === internalVersionName)
      : null;
    return {
      versionName: internalVersionName,
      actualMonths: selectedVersion?.actual_months || 0,
      referenceVersionName: internalRefName,
      isLocked: false // Lock is checked per-group, not here
    };
  }, [versionState, internalVersionName, internalRefName, availableVersions]);

  // Helper: resolve version IDs for a given version name across target branches+depts
  const resolveVersionIds = useCallback(async (vName, branchIds, departments) => {
    if (!vName || vName === 'draft') return null;
    const { data: versions } = await supabase
      .from('pnl_versions')
      .select('id, branch_id, department, is_locked')
      .in('branch_id', branchIds)
      .in('department', departments)
      .eq('year', year)
      .eq('version_name', vName);
    return versions?.length ? versions : null;
  }, [supabase, year]);

  // Lock status per branch+department: { "branchId:dept": true/false }
  const [lockedGroups, setLockedGroups] = useState({});

  // Helper: fetch line items for given version records or draft
  const fetchItems = useCallback(async (branchIds, departments, versionRecords) => {
    let query = supabase
      .from('pnl_line_items')
      .select('*')
      .in('branch_id', branchIds)
      .in('department', departments)
      .eq('year', year)
      .order('branch_id')
      .order('row_order');

    if (versionRecords) {
      query = query.in('version_id', versionRecords.map(v => v.id));
    } else {
      query = query.is('version_id', null);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }, [supabase, year]);

  // Fetch primary data
  const fetchData = useCallback(async () => {
    if (!targetBranches?.length || !year) {
      setAllItems([]);
      setLockedGroups({});
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      const branchIds = targetBranches.map(b => b.id);
      const departments = MAINT_DEPARTMENTS;
      const versionRecords = await resolveVersionIds(effectiveVersionState?.versionName, branchIds, departments);
      const items = await fetchItems(branchIds, departments, versionRecords);
      setAllItems(items);

      // Build lock map from resolved versions
      const locks = {};
      if (versionRecords) {
        for (const v of versionRecords) {
          locks[`${v.branch_id}:${v.department}`] = v.is_locked;
        }
      }
      // Draft is never locked
      setLockedGroups(locks);
    } catch (err) {
      console.error('Failed to fetch maintenance revenue:', err);
      setAllItems([]);
      setLockedGroups({});
    } finally {
      setLoading(false);
    }
  }, [targetBranches, year, effectiveVersionState?.versionName, resolveVersionIds, fetchItems]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Fetch reference data
  useEffect(() => {
    async function fetchRef() {
      const refName = effectiveVersionState?.referenceVersionName;
      if (!refName || !targetBranches?.length) {
        setRefItems([]);
        return;
      }
      try {
        const branchIds = targetBranches.map(b => b.id);
        const departments = MAINT_DEPARTMENTS;
        const versionRecords = refName === 'draft' ? null : await resolveVersionIds(refName, branchIds, departments);
        const items = await fetchItems(branchIds, departments, versionRecords);
        setRefItems(items);
      } catch (err) {
        console.error('Failed to fetch reference maintenance revenue:', err);
        setRefItems([]);
      }
    }
    fetchRef();
  }, [targetBranches, effectiveVersionState?.referenceVersionName, resolveVersionIds, fetchItems]);

  const showComparison = refItems.length > 0;

  // Filter to Income section rows
  function filterIncomeRows(items) {
    const result = [];
    let inIncome = false;
    for (const item of items) {
      if (item.row_type === 'section_header' && item.account_name?.toLowerCase() === 'income') {
        inIncome = true;
        result.push(item);
        continue;
      }
      if (inIncome) {
        result.push(item);
        if (item.row_type === 'total' &&
            item.account_name?.toLowerCase().replace(/^total\s*-\s*/, 'total ').trim() === 'total income') {
          break;
        }
      }
    }
    return result;
  }

  // Find Total Income value from a set of items for a branch+dept
  function getTotalIncomeValues(items, branchId, dept) {
    const filtered = items.filter(i => i.branch_id === branchId && i.department === dept);
    const incomeRows = filterIncomeRows(filtered);
    const totalRow = incomeRows.find(r =>
      r.row_type === 'total' &&
      r.account_name?.toLowerCase().replace(/^total\s*-\s*/, 'total ').trim() === 'total income'
    );
    if (!totalRow) return null;
    const vals = {};
    for (const mk of MONTH_KEYS) vals[mk] = parseFloat(totalRow[mk]) || 0;
    return vals;
  }

  // Build grouped data — one row per branch + department
  const groupedData = useMemo(() => {
    if (!targetBranches?.length) return [];

    const groups = {};
    for (const item of allItems) {
      const key = `${item.branch_id}:${item.department}`;
      if (!groups[key]) groups[key] = [];
      groups[key].push(item);
    }

    const result = [];
    const sortedBranches = [...targetBranches].sort((a, b) => a.name.localeCompare(b.name));

    for (const branch of sortedBranches) {
      for (const dept of MAINT_DEPARTMENTS) {
        const key = `${branch.id}:${dept}`;
        const branchItems = groups[key] || [];
        const incomeRows = filterIncomeRows(branchItems);

        const detailRows = incomeRows.filter(r => r.row_type === 'detail');

        // Sum from detail rows so edits are reflected immediately
        const totals = {};
        for (const mk of MONTH_KEYS) {
          let sum = 0;
          for (const r of detailRows) sum += parseFloat(r[mk]) || 0;
          totals[mk] = Math.round(sum * 100) / 100;
        }

        // Reference totals
        const refTotals = getTotalIncomeValues(refItems, branch.id, dept);

        // Build ref lookup for detail rows (by account_code)
        const refIncomeRows = filterIncomeRows(
          refItems.filter(i => i.branch_id === branch.id && i.department === dept)
        );
        const refByCode = {};
        for (const r of refIncomeRows) {
          if (r.account_code) refByCode[r.account_code] = r;
        }

        result.push({
          key,
          label: `${branch.name} ${DEPT_LABELS[dept]}`,
          branchName: branch.name,
          branchId: branch.id,
          department: dept,
          totals,
          refTotals,
          detailRows,
          refByCode
        });
      }
    }

    return result;
  }, [targetBranches, allItems, refItems]);

  // Derive actual months count
  const actualMonths = effectiveVersionState?.actualMonths || 0;
  const importedMonthKeys = useMemo(() => new Set(MONTH_KEYS.slice(0, actualMonths)), [actualMonths]);

  // Check if a specific maintenance group is locked
  function isGroupLocked(branchId, department) {
    const key = `${branchId}:${department}`;
    return lockedGroups[key] || false;
  }

  const anyLocked = Object.values(lockedGroups).some(v => v);

  // --- Editing logic ---
  function isCellEditable(item) {
    if (item.row_type !== 'detail') return false;
    if (isGroupLocked(item.branch_id, item.department)) return false;
    return true;
  }

  const patchItem = useCallback((id, updates) => {
    setAllItems(prev => prev.map(li =>
      li.id === id ? { ...li, ...updates } : li
    ));
  }, []);

  const handleStartEdit = useCallback((id, monthKey) => {
    const item = allItems.find(li => li.id === id);
    if (!item || !isCellEditable(item)) return;
    setEditingCell({ id, monthKey });
    setEditValue(String(parseFloat(item[monthKey]) || 0));
  }, [allItems, lockedGroups]);

  const handleCellChange = useCallback((id, monthKey, value) => {
    patchItem(id, { [monthKey]: value });

    const key = `${id}`;
    const existing = pendingUpdates.current.get(key) || {};
    existing[monthKey] = value;
    pendingUpdates.current.set(key, existing);

    if (updateTimer.current) clearTimeout(updateTimer.current);
    updateTimer.current = setTimeout(async () => {
      const updates = new Map(pendingUpdates.current);
      pendingUpdates.current.clear();
      for (const [itemId, monthUpdates] of updates) {
        try {
          await fetch('/api/pnl/update-cells', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineItemId: parseInt(itemId), updates: monthUpdates })
          });
        } catch (err) {
          console.error('Failed to save maintenance revenue cell:', err);
        }
      }
    }, 500);
  }, [patchItem]);

  const handleFinishEdit = useCallback(() => {
    if (!editingCell) return;
    const val = editValue === '' ? 0 : parseFloat(editValue);
    const numVal = isNaN(val) ? 0 : Math.round(val * 100) / 100;
    handleCellChange(editingCell.id, editingCell.monthKey, numVal);
    setEditingCell(null);
  }, [editingCell, editValue, handleCellChange]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      handleFinishEdit();
    } else if (e.key === 'Escape') {
      setEditingCell(null);
    }
  }, [handleFinishEdit]);

  // --- Increment logic ---
  const handleIncrApply = useCallback(() => {
    if (!incrPopover) return;
    const increment = parseFloat(incrPopover.increment);
    if (isNaN(increment) || increment === 0) return;
    const baseValue = parseFloat(incrPopover.baseValue) || 0;
    const baseIdx = MONTH_KEYS.indexOf(incrPopover.baseMonth);
    const fillKeys = MONTH_KEYS.filter((m, i) => i > baseIdx && !importedMonthKeys.has(m));
    for (let i = 0; i < fillKeys.length; i++) {
      const val = Math.round((baseValue + increment * (i + 1)) * 100) / 100;
      handleCellChange(incrPopover.id, fillKeys[i], val);
    }
    patchItem(incrPopover.id, {
      monthly_increment: increment,
      increment_base_month: incrPopover.baseMonth
    });
    fetch('/api/pnl/apply-increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        lineItemId: incrPopover.id,
        monthlyIncrement: increment,
        incrementBaseMonth: incrPopover.baseMonth
      })
    }).catch(err => console.error('Failed to save increment:', err));
    setIncrPopover(null);
  }, [incrPopover, importedMonthKeys, handleCellChange, patchItem]);

  const handleIncrClear = useCallback((id) => {
    patchItem(id, { monthly_increment: null, increment_base_month: null });
    fetch('/api/pnl/apply-increment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ lineItemId: id, monthlyIncrement: null, incrementBaseMonth: null })
    }).catch(err => console.error('Failed to clear increment:', err));
    setIncrPopover(null);
  }, [patchItem]);

  const openIncrPopover = useCallback((e, item) => {
    e.stopPropagation();
    if (incrPopover?.id === item.id) {
      setIncrPopover(null);
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const actuals = MONTH_KEYS.filter(m => importedMonthKeys.has(m));
    const lastActualMonth = actuals.length > 0 ? actuals[actuals.length - 1] : null;
    const baseMonth = item.increment_base_month || lastActualMonth || 'jan';
    const baseValue = parseFloat(item[baseMonth]) || 0;
    setIncrPopover({
      id: item.id,
      baseMonth,
      baseValue,
      increment: item.monthly_increment != null ? String(item.monthly_increment) : '',
      x: rect.left,
      y: rect.bottom + 4,
      hasExisting: item.monthly_increment != null
    });
  }, [incrPopover, importedMonthKeys]);

  // Toggle group expansion
  const toggleGroup = useCallback((key) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Row total
  function rowTotal(item) {
    let sum = 0;
    for (const mk of MONTH_KEYS) sum += parseFloat(item[mk]) || 0;
    return sum;
  }

  function getRowClass(item) {
    switch (item.row_type) {
      case 'section_header': return 'bg-gray-700 text-white font-bold text-xs';
      case 'account_header': return 'bg-gray-100 font-semibold text-xs';
      case 'total': return 'bg-gray-100 font-bold text-xs border-t border-gray-300';
      default: return 'text-xs';
    }
  }

  function getTextWeight(rowType) {
    if (rowType === 'section_header' || rowType === 'total') return 'font-bold';
    if (rowType === 'account_header') return 'font-semibold';
    return 'font-normal';
  }

  if (!branchId && !isEncore) return null;

  // Grand totals for summary view
  const grandTotal = useMemo(() => {
    if (!groupedData.length) return null;
    const totals = {};
    for (const mk of MONTH_KEYS) {
      let sum = 0;
      for (const g of groupedData) sum += g.totals[mk] || 0;
      totals[mk] = Math.round(sum * 100) / 100;
    }
    return totals;
  }, [groupedData]);

  const grandRefTotal = useMemo(() => {
    if (!groupedData.length || !showComparison) return null;
    const totals = {};
    let hasAny = false;
    for (const mk of MONTH_KEYS) {
      let sum = 0;
      for (const g of groupedData) {
        if (g.refTotals) { sum += g.refTotals[mk] || 0; hasAny = true; }
      }
      totals[mk] = Math.round(sum * 100) / 100;
    }
    return hasAny ? totals : null;
  }, [groupedData, showComparison]);

  const hasData = groupedData.length > 0;

  // --- Comparison helpers ---
  function computeVariance(total, refTotal) {
    // Revenue: positive variance = favorable (more revenue)
    if (refTotal === null || refTotal === undefined) return { dollarVar: null, pctVar: null };
    const dollarVar = total - refTotal;
    const pctVar = refTotal !== 0 ? (dollarVar / Math.abs(refTotal)) * 100 : null;
    return { dollarVar, pctVar };
  }

  function renderComparisonCells(total, refTotal, weight) {
    const { dollarVar, pctVar } = computeVariance(total, refTotal);
    return (
      <>
        <td className={`py-0.5 px-1.5 text-right tabular-nums border-l border-gray-300 bg-amber-50 ${
          refTotal !== null && refTotal < 0 ? 'text-red-600' : ''
        } ${weight}`}>
          {refTotal !== null ? formatCurrency(refTotal) : '\u2014'}
        </td>
        <td className={`py-0.5 px-1 text-right tabular-nums bg-amber-50 ${
          dollarVar !== null && dollarVar > 0 ? 'text-green-600' : dollarVar !== null && dollarVar < 0 ? 'text-red-600' : ''
        } ${weight}`}>
          {dollarVar !== null ? formatCurrency(dollarVar) : '\u2014'}
        </td>
        <td className={`py-0.5 px-1 text-right tabular-nums bg-amber-50 ${
          pctVar !== null && pctVar > 0 ? 'text-green-600' : pctVar !== null && pctVar < 0 ? 'text-red-600' : ''
        } ${weight}`}>
          {pctVar !== null ? formatPercent(pctVar) : '\u2014'}
        </td>
      </>
    );
  }

  // Render a detail row (used by both multi-branch expanded and single-branch view)
  function renderDetailRow(item, idx, refByCode) {
    if (item.row_type === 'sub_line') return null;
    const total = rowTotal(item);
    const canEdit = isCellEditable(item);
    const showIncr = canEdit && item.row_type === 'detail' && item.id;
    const incrTint = item.monthly_increment != null ? 'rgba(16, 185, 129, 0.08)' : null;

    // Reference matching
    const refRow = item.account_code && refByCode ? refByCode[item.account_code] : null;
    const refTotal = refRow ? rowTotal(refRow) : (showComparison ? 0 : null);

    return (
      <tr
        key={item.id || `row-${idx}`}
        className={`${getRowClass(item)} border-b border-gray-100 hover:bg-yellow-50/30`}
      >
        <td className={`py-0.5 px-2 whitespace-nowrap sticky left-0 bg-inherit z-[5] ${getTextWeight(item.row_type)}`}
          style={{ paddingLeft: `${8 + (item.indent_level || 0) * 16}px` }}
        >
          {showIncr && (
            <span
              className={`inline-block w-5 text-center cursor-pointer select-none ${
                item.monthly_increment != null
                  ? 'text-emerald-500 hover:text-emerald-700 font-bold'
                  : 'text-gray-300 hover:text-emerald-500'
              }`}
              style={{ marginRight: '2px', fontSize: '10px' }}
              title={item.monthly_increment != null
                ? `+$${Number(item.monthly_increment).toLocaleString()}/mo from ${(item.increment_base_month || '').toUpperCase()} — click to edit`
                : 'Seed forecast with monthly increment'}
              onClick={(e) => openIncrPopover(e, item)}
            >
              +$
            </span>
          )}
          {item.account_name}
          {item.monthly_increment != null && (
            <span className="ml-1 text-emerald-500 text-[10px] font-normal"
              title={`Monthly increment of $${Number(item.monthly_increment).toLocaleString()} from ${(item.increment_base_month || '').toUpperCase()}`}
            >
              (+${Number(item.monthly_increment).toLocaleString()}/mo)
            </span>
          )}
        </td>
        {MONTH_KEYS.map((key, keyIdx) => {
          const val = parseFloat(item[key]) || 0;
          const isImported = importedMonthKeys.has(key);
          const isEditing = editingCell?.id === item.id && editingCell?.monthKey === key;
          const isBoundary = actualMonths > 0 && actualMonths < 12 && keyIdx === actualMonths;
          const cellBg = incrTint && !isImported ? incrTint : null;
          const refVal = refRow ? (parseFloat(refRow[key]) || 0) : null;
          const hasRef = refVal !== null && !isEditing;

          return (
            <td
              key={key}
              className={`py-0.5 px-0.5 text-right tabular-nums ${
                val < 0 ? 'text-red-600' : ''
              } ${getTextWeight(item.row_type)} ${
                !cellBg && isImported ? 'bg-blue-50/70' : ''
              } ${canEdit && !isEditing ? 'cursor-pointer hover:bg-yellow-50' : ''
              } ${isBoundary ? 'border-l-2 border-l-blue-300' : ''
              } ${hasRef ? 'group/ref' : ''}`}
              style={cellBg ? { backgroundColor: cellBg } : undefined}
              onMouseDown={() => {
                if (canEdit) handleStartEdit(item.id, key);
              }}
            >
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
              ) : hasRef ? (
                <>
                  <span className={`group-hover/ref:hidden ${canEdit && val === 0 ? 'text-gray-300' : ''}`}>
                    {formatCurrency(val)}
                  </span>
                  <span className="hidden group-hover/ref:inline text-amber-700">
                    {formatCurrency(refVal)}
                  </span>
                </>
              ) : (
                <span className={canEdit && val === 0 ? 'text-gray-300' : ''}>
                  {formatCurrency(val)}
                </span>
              )}
            </td>
          );
        })}
        <td className={`py-0.5 px-1.5 text-right tabular-nums border-l-2 border-r-2 border-gray-400 font-semibold ${
          total < 0 ? 'text-red-600' : ''
        }`}>
          {formatCurrency(total)}
        </td>
        {showComparison && renderComparisonCells(total, refTotal, getTextWeight(item.row_type))}
      </tr>
    );
  }

  return (
    <div className="p-6 border-b border-gray-200">
      <div className="flex items-center gap-2 mb-3">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="text-gray-500 hover:text-gray-700"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className={`h-4 w-4 transition-transform ${collapsed ? '-rotate-90' : ''}`} viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
        <h2 className="text-lg font-bold text-gray-800">
          Maintenance Revenue Reference
        </h2>
        {!isStandalone && (
          <span className="text-sm text-gray-500">
            {effectiveVersionState?.versionName
              ? `(${effectiveVersionState.versionName})`
              : '(Working Draft)'}
          </span>
        )}
        {anyLocked && (
          <span className="text-xs text-red-600 ml-1">(Some versions locked)</span>
        )}
      </div>

      {/* Standalone version selector (Encore mode) */}
      {isStandalone && !collapsed && (
        <div className="flex flex-wrap items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Version:</label>
            <select
              value={internalVersionName || ''}
              onChange={(e) => setInternalVersionName(e.target.value || null)}
              className="bg-white border border-gray-300 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500"
            >
              <option value="">Working Draft</option>
              {availableVersions.map(v => (
                <option key={v.version_name} value={v.version_name}>
                  {v.version_name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-gray-600">Compare to:</label>
            <select
              value={internalRefName || ''}
              onChange={(e) => setInternalRefName(e.target.value || null)}
              className="bg-white border border-gray-300 rounded px-2 py-1 text-xs focus:ring-2 focus:ring-green-500 focus:border-green-500"
            >
              <option value="">None</option>
              <option value="draft">Working Draft</option>
              {availableVersions
                .filter(v => v.version_name !== internalVersionName)
                .map(v => (
                  <option key={v.version_name} value={v.version_name}>
                    {v.version_name}
                  </option>
                ))}
            </select>
          </div>
        </div>
      )}

      {!collapsed && (
        <>
          {loading ? (
            <div className="flex items-center gap-2 py-4">
              <div className="h-5 w-5 rounded-full border-2 border-green-600 border-t-transparent animate-spin" />
              <span className="text-sm text-gray-500">Loading maintenance revenue...</span>
            </div>
          ) : !hasData ? (
            <p className="text-sm text-gray-500 py-4">
              No maintenance revenue data for this branch/year/version.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-gray-800 text-white text-[11px]">
                    <th className="py-1 px-2 text-left font-semibold sticky left-0 bg-gray-800 z-10 min-w-[260px]">
                      Branch / Department
                    </th>
                    {MONTH_KEYS.map((key, i) => {
                      const isActual = importedMonthKeys.has(key);
                      const isBoundary = actualMonths > 0 && actualMonths < 12 && i === actualMonths;
                      return (
                        <th
                          key={key}
                          className={`py-1 px-1 text-right font-semibold min-w-[70px] ${
                            isActual ? 'bg-blue-950 text-white' : 'text-white'
                          } ${isBoundary ? 'border-l-2 border-l-blue-300' : ''}`}
                        >
                          {MONTH_LABELS[i]}
                        </th>
                      );
                    })}
                    <th className="py-1 px-1.5 text-right font-semibold border-l-2 border-r-2 border-gray-400 min-w-[80px]">
                      Total
                    </th>
                    {showComparison && (
                      <>
                        <th className="py-1 px-1.5 text-right font-semibold min-w-[65px] border-l border-gray-600">
                          Ref
                        </th>
                        <th className="py-1 px-1 text-right font-semibold min-w-[58px]">
                          $ Var
                        </th>
                        <th className="py-1 px-1 text-right font-semibold min-w-[42px]">
                          %
                        </th>
                      </>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {groupedData.map((group) => {
                    const total = rowTotal(group.totals);
                    const refTotal = group.refTotals ? rowTotal(group.refTotals) : null;
                    const isExpanded = expandedGroups.has(group.key);
                    const bg = getBranchBg(group.branchName);
                    const groupLocked = isGroupLocked(group.branchId, group.department);

                    return (
                      <React.Fragment key={group.key}>
                        {/* Summary row */}
                        <tr className="text-xs border-b border-gray-100 hover:bg-yellow-50/30 cursor-pointer"
                          onClick={() => toggleGroup(group.key)}
                        >
                          <td className="py-0.5 px-2 whitespace-nowrap sticky left-0 z-[5] font-medium"
                            style={{ backgroundColor: bg || 'white' }}
                          >
                            <svg xmlns="http://www.w3.org/2000/svg"
                              className={`inline h-3 w-3 mr-1 transition-transform ${isExpanded ? '' : '-rotate-90'}`}
                              viewBox="0 0 20 20" fill="currentColor"
                            >
                              <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                            </svg>
                            {group.label}
                            {groupLocked && (
                              <span className="ml-1.5 text-red-500 text-[10px]" title="This maintenance version is locked">
                                <svg xmlns="http://www.w3.org/2000/svg" className="inline h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </td>
                          {MONTH_KEYS.map((key, keyIdx) => {
                            const val = group.totals[key] || 0;
                            const refVal = group.refTotals ? (group.refTotals[key] || 0) : null;
                            const isImported = importedMonthKeys.has(key);
                            const isBoundary = actualMonths > 0 && actualMonths < 12 && keyIdx === actualMonths;
                            return (
                              <td key={key}
                                className={`py-0.5 px-0.5 text-right tabular-nums font-medium ${
                                  val < 0 ? 'text-red-600' : ''
                                } ${isImported ? 'bg-blue-50/70' : ''
                                } ${isBoundary ? 'border-l-2 border-l-blue-300' : ''
                                } ${refVal !== null ? 'group/ref' : ''}`}
                              >
                                {refVal !== null ? (
                                  <>
                                    <span className="group-hover/ref:hidden">{formatCurrency(val)}</span>
                                    <span className="hidden group-hover/ref:inline text-amber-700">{formatCurrency(refVal)}</span>
                                  </>
                                ) : (
                                  formatCurrency(val)
                                )}
                              </td>
                            );
                          })}
                          <td className="py-0.5 px-1.5 text-right tabular-nums border-l-2 border-r-2 border-gray-400 font-semibold">
                            {formatCurrency(total)}
                          </td>
                          {showComparison && renderComparisonCells(total, refTotal, 'font-medium')}
                        </tr>

                        {/* Expanded detail rows */}
                        {isExpanded && group.detailRows.map((item, idx) =>
                          renderDetailRow(item, `${group.key}-${idx}`, group.refByCode)
                        )}
                      </React.Fragment>
                    );
                  })}

                  {/* Grand total row */}
                  {grandTotal && (
                    <tr className="bg-gray-100 font-bold text-xs border-t-2 border-gray-300">
                      <td className="py-1 px-2 whitespace-nowrap sticky left-0 bg-gray-100 z-[5] font-bold">
                        Total Maintenance Revenue
                      </td>
                      {MONTH_KEYS.map((key, keyIdx) => {
                        const val = grandTotal[key] || 0;
                        const isBoundary = actualMonths > 0 && actualMonths < 12 && keyIdx === actualMonths;
                        return (
                          <td key={key}
                            className={`py-1 px-0.5 text-right tabular-nums font-bold ${
                              val < 0 ? 'text-red-600' : ''
                            } ${isBoundary ? 'border-l-2 border-l-blue-300' : ''}`}
                          >
                            {formatCurrency(val)}
                          </td>
                        );
                      })}
                      <td className="py-1 px-1.5 text-right tabular-nums border-l-2 border-r-2 border-gray-400 font-bold">
                        {formatCurrency(rowTotal(grandTotal))}
                      </td>
                      {showComparison && grandRefTotal && renderComparisonCells(
                        rowTotal(grandTotal), rowTotal(grandRefTotal), 'font-bold'
                      )}
                      {showComparison && !grandRefTotal && (
                        <>
                          <td className="py-1 px-1.5 text-right bg-amber-50 border-l border-gray-300">{'\u2014'}</td>
                          <td className="py-1 px-1 text-right bg-amber-50">{'\u2014'}</td>
                          <td className="py-1 px-1 text-right bg-amber-50">{'\u2014'}</td>
                        </>
                      )}
                    </tr>
                  )}

                  {/* Maintenance Growth row (vs January) */}
                  {grandTotal && (() => {
                    const janVal = parseFloat(grandTotal.jan) || 0;
                    const refJanVal = grandRefTotal ? (parseFloat(grandRefTotal.jan) || 0) : 0;
                    const growthFor = (vals, jan) => {
                      const out = {};
                      for (const mk of MONTH_KEYS) {
                        const v = parseFloat(vals?.[mk]);
                        out[mk] = (mk === 'jan' || !jan || !isFinite(v)) ? null : Math.round(((v - jan) / jan) * 1000) / 10;
                      }
                      return out;
                    };
                    const growth = growthFor(grandTotal, janVal);
                    const refGrowth = grandRefTotal ? growthFor(grandRefTotal, refJanVal) : null;
                    const decGrowth = (janVal && isFinite(parseFloat(grandTotal.dec)))
                      ? Math.round((((parseFloat(grandTotal.dec) || 0) - janVal) / janVal) * 1000) / 10
                      : null;
                    const refDecGrowth = (grandRefTotal && refJanVal && isFinite(parseFloat(grandRefTotal.dec)))
                      ? Math.round((((parseFloat(grandRefTotal.dec) || 0) - refJanVal) / refJanVal) * 1000) / 10
                      : null;
                    return (
                      <tr className="bg-green-50 font-semibold text-xs border-t border-green-200">
                        <td className="py-1 px-2 whitespace-nowrap sticky left-0 bg-green-50 z-[5]">
                          <span className="text-green-600 mr-1">&#8599;</span>Maintenance Growth
                        </td>
                        {MONTH_KEYS.map((key, keyIdx) => {
                          const v = growth[key];
                          const isBoundary = actualMonths > 0 && actualMonths < 12 && keyIdx === actualMonths;
                          return (
                            <td key={key}
                              className={`py-1 px-0.5 text-right tabular-nums ${v != null && v < 0 ? 'text-red-600' : 'text-green-700'} ${isBoundary ? 'border-l-2 border-l-blue-300' : ''}`}
                            >
                              {v == null ? '\u2014' : formatPercent(v)}
                            </td>
                          );
                        })}
                        <td className="py-1 px-1.5 text-right tabular-nums border-l-2 border-r-2 border-gray-400 font-bold text-green-700">
                          {decGrowth == null ? '\u2014' : formatPercent(decGrowth)}
                        </td>
                        {showComparison && (
                          <>
                            <td className="py-1 px-1.5 text-right tabular-nums text-amber-700 border-l border-gray-300">
                              {refDecGrowth == null ? '\u2014' : formatPercent(refDecGrowth)}
                            </td>
                            <td className="py-1 px-1 text-right">{'\u2014'}</td>
                            <td className="py-1 px-1 text-right">{'\u2014'}</td>
                          </>
                        )}
                      </tr>
                    );
                  })()}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {/* Monthly increment popover */}
      {incrPopover && (
        <>
          <div className="fixed inset-0 z-[99]" onClick={() => setIncrPopover(null)} />
          <div
            className="fixed z-[100] bg-white border border-gray-300 rounded-lg shadow-lg p-3 text-xs"
            style={{ left: incrPopover.x, top: incrPopover.y, width: '260px' }}
          >
            <div className="mb-2 font-semibold text-gray-700 text-sm">Monthly Increment</div>
            <div className="mb-2">
              <label className="text-gray-500 block mb-1 font-medium">Base month:</label>
              <div className="flex items-center gap-2">
                <select
                  value={incrPopover.baseMonth}
                  onChange={(e) => {
                    const newMonth = e.target.value;
                    const row = allItems.find(li => li.id === incrPopover.id);
                    const newBaseValue = row ? (parseFloat(row[newMonth]) || 0) : 0;
                    setIncrPopover(p => ({ ...p, baseMonth: newMonth, baseValue: newBaseValue }));
                  }}
                  className="px-2 py-1 border border-gray-300 rounded text-xs focus:outline-none focus:ring-1 focus:ring-emerald-500 focus:border-emerald-500"
                >
                  {MONTH_KEYS.map((mk, mi) => (
                    <option key={mk} value={mk}>{MONTH_LABELS[mi]}</option>
                  ))}
                </select>
                <span className="text-gray-700 font-medium">${Number(incrPopover.baseValue).toLocaleString()}</span>
              </div>
            </div>
            <div className="mb-3">
              <label className="text-gray-500 block mb-1 font-medium">Increment per month:</label>
              <div className="flex items-center gap-1">
                <span className="text-gray-500">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={incrPopover.increment}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === '' || v === '-' || /^-?\d*\.?\d*$/.test(v)) setIncrPopover(p => ({ ...p, increment: v }));
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleIncrApply();
                    if (e.key === 'Escape') setIncrPopover(null);
                  }}
                  autoFocus
                  placeholder="e.g. 3333"
                  className="w-28 px-2 py-1 border border-gray-300 rounded text-right focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
                <span className="text-gray-500">/mo</span>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleIncrApply}
                className="flex-1 px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700 font-medium"
              >
                Apply
              </button>
              {incrPopover.hasExisting && (
                <button
                  onClick={() => handleIncrClear(incrPopover.id)}
                  className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 font-medium"
                >
                  Clear
                </button>
              )}
              <button
                onClick={() => setIncrPopover(null)}
                className="px-3 py-1.5 text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
