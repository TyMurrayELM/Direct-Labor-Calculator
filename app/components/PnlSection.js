'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { usePnlLineItems, usePnlVersions, mergeAllDepartments } from '../hooks/useSupabase';
import PnlTable from './PnlTable';
import PnlVersionBar from './PnlVersionBar';
import PnlImport from './PnlImport';
import BudgetImport from './BudgetImport';

/**
 * Self-contained P&L section component.
 *
 * Props:
 *   branchId       — selected branch ID
 *   branchName     — display name for branch
 *   year           — selected year
 *   department     — department string (e.g. 'maintenance', 'arbor', 'spray')
 *   onDepartmentChange  — if provided, renders the department dropdown (main page only)
 *   departmentOptions   — array of { value, label } for dropdown
 */
const DEPARTMENT_LABELS = {
  maintenance: 'Maintenance',
  maintenance_onsite: 'Maintenance Onsite',
  maintenance_wo: 'Maintenance WO',
  arbor: 'Arbor',
  enhancements: 'Enhancements',
  spray: 'Spray',
  irrigation: 'Irrigation',
  biz_dev_marketing: 'Business Development and Marketing',
  equipment_fleet: 'Equipment & Fleet Operations',
  facilities: 'Facilities',
  finance_accounting: 'Finance and Accounting',
  it_technology: 'IT/Technology',
  insurance: 'Insurance',
  owner_ops_benefits: 'Owner Operations & Benefits',
  safety: 'Safety',
  talent_culture: 'Talent & Culture'
};

export default function PnlSection({
  branchId,
  branchName,
  year,
  department,
  onDepartmentChange,
  departmentOptions,
  onVersionStateChange
}) {
  // --- Role detection ---
  const [userRole, setUserRole] = useState(null);
  const [previewAsUser, setPreviewAsUser] = useState(false);
  const isRealAdmin = userRole === 'admin';
  const isAdmin = isRealAdmin && !previewAsUser;
  const isEditor = userRole === 'finance' || userRole === 'admin';
  useEffect(() => {
    const checkRole = async () => {
      const sb = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      );
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return;
      const { data } = await sb
        .from('allowlist')
        .select('role')
        .eq('email', session.user.email)
        .limit(1);
      if (data?.[0]?.role) setUserRole(data[0].role);
    };
    checkRole();
  }, []);

  // --- Version state ---
  const [selectedVersionId, setSelectedVersionId] = useState(null);
  const [referenceVersionId, setReferenceVersionId] = useState(null);
  const [referenceItems, setReferenceItems] = useState(null);
  const [showCopyDropdown, setShowCopyDropdown] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState(null);
  const copyDropdownRef = useRef(null);
  const pnlCellUpdateTimer = useRef(null);
  const pendingPnlUpdates = useRef(new Map());

  // --- Admin-configured defaults ---
  const [pnlDefaults, setPnlDefaults] = useState(null);
  const defaultsAppliedKey = useRef(null);
  useEffect(() => {
    fetch('/api/pnl-defaults')
      .then(r => r.json())
      .then(d => { if (d.success) setPnlDefaults(d.defaults); })
      .catch(() => {});
  }, []);

  // Reset version selections when branch/year/department changes
  useEffect(() => {
    setSelectedVersionId(null);
    setReferenceVersionId(null);
    setReferenceItems(null);
    defaultsAppliedKey.current = null;
  }, [branchId, year, department]);

  // --- Combined department logic ---
  const isCombinedDepartment = department === 'all_maintenance';

  // Fetch versions
  const { versions: pnlVersions, allRawVersions: pnlAllRawVersions, refetchVersions: refetchPnlVersions } = usePnlVersions(
    branchId, department, year
  );

  // Apply admin-configured defaults when versions load for a new context
  useEffect(() => {
    if (!pnlVersions || pnlVersions.length === 0 || !pnlDefaults) return;
    // Guard against stale versions from a previous branch/department/year
    // (the clear effect and fetch are async, so pnlVersions may still hold old data)
    const sample = pnlVersions[0];
    if (sample?.branch_id !== branchId || sample?.year !== year) return;
    if (!isCombinedDepartment && sample?.department !== department) return;
    const key = `${branchId}-${year}-${department}`;
    if (defaultsAppliedKey.current === key) return;
    defaultsAppliedKey.current = key;

    if (pnlDefaults.default_version_name) {
      const match = pnlVersions.find(v => v.version_name === pnlDefaults.default_version_name);
      if (match) setSelectedVersionId(match.id);
    }
    if (pnlDefaults.compare_version_name) {
      const match = pnlVersions.find(v => v.version_name === pnlDefaults.compare_version_name);
      if (match) setReferenceVersionId(match.id);
    }
  }, [pnlVersions, pnlDefaults, branchId, year, department]);

  // For all_maintenance: map selected version ID to array of version IDs across all 3 departments
  const pnlEffectiveVersionId = useMemo(() => {
    if (!isCombinedDepartment || selectedVersionId === null) return selectedVersionId;
    const selectedVersion = pnlVersions.find(v => v.id === selectedVersionId);
    if (!selectedVersion) return selectedVersionId;
    return pnlAllRawVersions
      .filter(v => v.version_name === selectedVersion.version_name)
      .map(v => v.id);
  }, [isCombinedDepartment, selectedVersionId, pnlVersions, pnlAllRawVersions]);

  // Fetch line items
  const { lineItems: pnlLineItems, importInfo: pnlImportInfo, loading: pnlLoading, refetchPnlData, patchLineItem, addLineItem, reorderLineItems } = usePnlLineItems(
    branchId, department, year, pnlEffectiveVersionId
  );

  // Version helpers
  const currentPnlVersion = selectedVersionId ? pnlVersions.find(v => v.id === selectedVersionId) : null;
  const isPnlLocked = isCombinedDepartment ? true : (currentPnlVersion?.is_locked || false);
  const isPnlEditable = isCombinedDepartment ? false : (selectedVersionId === null || !isPnlLocked);

  // Derive imported months
  const importedMonths = useMemo(() => {
    const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    if (selectedVersionId && currentPnlVersion) {
      const count = currentPnlVersion.actual_months || 0;
      return count > 0 ? MONTHS.slice(0, count) : [];
    }
    if (pnlImportInfo?.months_included?.length) return pnlImportInfo.months_included;
    return [];
  }, [pnlImportInfo, currentPnlVersion, selectedVersionId]);

  // --- Fetch reference items when referenceVersionId changes ---
  useEffect(() => {
    async function fetchRef() {
      if (!referenceVersionId || !branchId) {
        setReferenceItems(null);
        return;
      }
      const { createClient } = await import('@supabase/supabase-js');
      const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

      if (isCombinedDepartment) {
        const ALL_DEPTS = ['maintenance', 'maintenance_onsite', 'maintenance_wo'];
        let q = sb.from('pnl_line_items').select('*')
          .eq('branch_id', branchId).in('department', ALL_DEPTS).eq('year', year)
          .order('row_order');
        if (referenceVersionId === 'draft') {
          q = q.is('version_id', null);
        } else {
          const refVersion = pnlVersions.find(v => v.id === referenceVersionId);
          if (refVersion) {
            const refIds = pnlAllRawVersions
              .filter(v => v.version_name === refVersion.version_name)
              .map(v => v.id);
            q = q.in('version_id', refIds);
          } else {
            q = q.eq('version_id', referenceVersionId);
          }
        }
        const { data } = await q;
        setReferenceItems(mergeAllDepartments(data || []));
      } else {
        let q = sb.from('pnl_line_items').select('*')
          .eq('branch_id', branchId).eq('department', department).eq('year', year)
          .order('row_order');
        if (referenceVersionId === 'draft') {
          q = q.is('version_id', null);
        } else {
          q = q.eq('version_id', referenceVersionId);
        }
        const { data } = await q;
        setReferenceItems(data || []);
      }
    }
    fetchRef();
  }, [referenceVersionId, branchId, department, year, isCombinedDepartment, pnlVersions, pnlAllRawVersions]);

  // --- Handlers ---

  const handlePnlCellChange = useCallback((lineItemId, monthKey, value) => {
    const key = `${lineItemId}`;
    const existing = pendingPnlUpdates.current.get(key) || {};
    existing[monthKey] = value;
    pendingPnlUpdates.current.set(key, existing);

    patchLineItem(lineItemId, { [monthKey]: value });

    if (pnlCellUpdateTimer.current) clearTimeout(pnlCellUpdateTimer.current);
    pnlCellUpdateTimer.current = setTimeout(async () => {
      const updates = new Map(pendingPnlUpdates.current);
      pendingPnlUpdates.current.clear();
      for (const [itemId, monthUpdates] of updates) {
        try {
          await fetch('/api/pnl/update-cells', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineItemId: parseInt(itemId), updates: monthUpdates })
          });
        } catch (err) {
          console.error('Failed to save P&L cell:', err);
        }
      }
    }, 500);
  }, [patchLineItem]);

  const handlePnlRowReorder = useCallback(async (movedId, newOrder) => {
    // Optimistic local reorder — no loading flash
    reorderLineItems(newOrder);
    try {
      await fetch('/api/pnl/reorder-row', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineItemId: movedId, newOrder })
      });
    } catch (err) {
      console.error('Failed to reorder P&L row:', err);
      refetchPnlData();
    }
  }, [reorderLineItems, refetchPnlData]);

  const handlePnlToggleLock = async (versionId, newLockState) => {
    try {
      const res = await fetch('/api/pnl/lock-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId, isLocked: newLockState })
      });
      const result = await res.json();
      if (result.success) refetchPnlVersions();
    } catch (err) {
      console.error('Failed to toggle P&L lock:', err);
    }
  };

  const handleToggleAdminOnly = useCallback(async (lineItemId, currentValue) => {
    try {
      const newValue = !currentValue;
      patchLineItem(lineItemId, { admin_only: newValue });
      // Cascade to sub-line children optimistically
      (pnlLineItems || []).forEach(li => {
        if (li.row_type === 'sub_line' && li.parent_id === lineItemId) {
          patchLineItem(li.id, { admin_only: newValue });
        }
      });
      const res = await fetch('/api/pnl/toggle-admin-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineItemId, adminOnly: newValue })
      });
      const result = await res.json();
      if (!result.success) console.error('Failed to save admin_only:', result.error);
    } catch (err) {
      console.error('Failed to toggle admin_only:', err);
    }
  }, [patchLineItem, pnlLineItems]);

  const handleTogglePctMode = useCallback(async (lineItemId, pctOfTotal, pctSource) => {
    try {
      const patch = { pct_of_total: pctOfTotal, pct_source: pctSource };
      if (pctOfTotal != null) {
        patch.monthly_increment = null;
        patch.increment_base_month = null;
      }
      patchLineItem(lineItemId, patch);
      const res = await fetch('/api/pnl/toggle-pct-mode', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineItemId, pctOfTotal, pctSource })
      });
      const result = await res.json();
      if (!result.success) console.error('Failed to save pct mode:', result.error);
    } catch (err) {
      console.error('Failed to toggle pct mode:', err);
    }
  }, [patchLineItem]);

  const handleApplyIncrement = useCallback(async (lineItemId, monthlyIncrement, incrementBaseMonth) => {
    try {
      const patch = { monthly_increment: monthlyIncrement, increment_base_month: incrementBaseMonth };
      if (monthlyIncrement != null) {
        patch.pct_of_total = null;
        patch.pct_source = null;
      }
      patchLineItem(lineItemId, patch);
      const res = await fetch('/api/pnl/apply-increment', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineItemId, monthlyIncrement, incrementBaseMonth })
      });
      const result = await res.json();
      if (!result.success) console.error('Failed to save increment:', result.error);
    } catch (err) {
      console.error('Failed to apply increment:', err);
    }
  }, [patchLineItem]);

  const handleAddStructuralRow = useCallback(async (row, insertBeforeId) => {
    try {
      const res = await fetch('/api/pnl/add-line-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          department,
          year,
          versionId: selectedVersionId || null,
          accountCode: row.account_code,
          accountName: row.account_name,
          fullLabel: row.full_label,
          rowType: row.row_type,
          indentLevel: row.indent_level,
          insertBeforeId
        })
      });
      const result = await res.json();
      if (result.success) refetchPnlData();
    } catch (err) {
      console.error('Failed to add structural row:', err);
    }
  }, [branchId, department, year, selectedVersionId, refetchPnlData]);

  const handleAddRefRow = useCallback(async (refItem, insertBeforeId) => {
    try {
      const res = await fetch('/api/pnl/add-line-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          department,
          year,
          versionId: selectedVersionId || null,
          accountCode: refItem.account_code,
          accountName: refItem.account_name,
          fullLabel: refItem.full_label,
          rowType: refItem.row_type,
          indentLevel: refItem.indent_level,
          insertBeforeId
        })
      });
      const result = await res.json();
      if (result.success) refetchPnlData();
    } catch (err) {
      console.error('Failed to add ref row:', err);
    }
  }, [branchId, department, year, selectedVersionId, refetchPnlData]);

  const handleUpdateCellNote = useCallback(async (lineItemId, monthKey, noteText) => {
    try {
      const res = await fetch('/api/pnl/update-cell-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineItemId, monthKey, noteText })
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error);
      patchLineItem(lineItemId, { cell_notes: result.cell_notes });
    } catch (err) {
      console.error('Failed to update cell note:', err);
    }
  }, [patchLineItem]);

  const handleUpdateVersionNote = useCallback(async (versionId, noteText) => {
    try {
      const res = await fetch('/api/pnl/update-version-note', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId, noteText })
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error);
      refetchPnlVersions();
    } catch (err) {
      console.error('Failed to update version note:', err);
    }
  }, [refetchPnlVersions]);

  const handleCopyStructure = useCallback(async (sourceDepartment) => {
    const res = await fetch('/api/pnl/copy-structure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branchId,
        sourceDepartment,
        targetDepartment: department,
        year
      })
    });
    const result = await res.json();
    if (!result.success) throw new Error(result.error);
    refetchPnlData();
  }, [branchId, department, year, refetchPnlData]);

  const handleClearDraft = useCallback(async () => {
    try {
      const res = await fetch('/api/pnl/clear-draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, department, year })
      });
      const result = await res.json();
      if (!result.success) throw new Error(result.error);
      refetchPnlData();
    } catch (err) {
      console.error('Failed to clear draft:', err);
    }
  }, [branchId, department, year, refetchPnlData]);

  const handleDeleteLineItem = useCallback(async (lineItemId) => {
    patchLineItem(lineItemId, { _deleted: true });
    try {
      const res = await fetch('/api/pnl/delete-line-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineItemId })
      });
      const result = await res.json();
      if (!result.success) {
        console.error('Failed to delete line item:', result.error);
        refetchPnlData();
      }
    } catch (err) {
      console.error('Failed to delete line item:', err);
      refetchPnlData();
    }
  }, [patchLineItem, refetchPnlData]);

  const handleAddSubLine = useCallback(async (parentLineItemId) => {
    try {
      const res = await fetch('/api/pnl/add-sub-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentLineItemId, label: 'New sub-line' })
      });
      const result = await res.json();
      if (result.success && result.lineItem) {
        addLineItem(result.lineItem);
      } else {
        console.error('Failed to add sub-line:', result.error);
      }
    } catch (err) {
      console.error('Failed to add sub-line:', err);
    }
  }, [addLineItem]);

  const handleRenameSubLine = useCallback(async (lineItemId, label) => {
    patchLineItem(lineItemId, { account_name: label, full_label: label });
    try {
      const res = await fetch('/api/pnl/rename-sub-line', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineItemId, label })
      });
      const result = await res.json();
      if (!result.success) console.error('Failed to rename sub-line:', result.error);
    } catch (err) {
      console.error('Failed to rename sub-line:', err);
    }
  }, [patchLineItem]);

  // Close copy dropdown on click outside
  useEffect(() => {
    if (!showCopyDropdown) return;
    const handleClickOutside = (e) => {
      if (copyDropdownRef.current && !copyDropdownRef.current.contains(e.target)) {
        setShowCopyDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCopyDropdown]);

  // Expose version state to parent (used by MaintenanceRevenuePanel)
  const referenceVersion = referenceVersionId ? pnlVersions.find(v => v.id === referenceVersionId) : null;
  const referenceVersionName = referenceVersionId === 'draft' ? 'draft' : (referenceVersion?.version_name || null);
  useEffect(() => {
    if (onVersionStateChange) {
      onVersionStateChange({
        selectedVersionId,
        versionName: currentPnlVersion?.version_name || null,
        actualMonths: currentPnlVersion?.actual_months || (pnlImportInfo?.months_included?.length || 0),
        isLocked: isPnlLocked,
        referenceVersionName
      });
    }
  }, [selectedVersionId, currentPnlVersion, pnlImportInfo, isPnlLocked, referenceVersionName, onVersionStateChange]);

  const canImport = !isCombinedDepartment && isEditor && !isPnlLocked;

  // --- Render ---
  return (
    <div className="p-6 border-t border-gray-200">
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h2 className="text-lg font-bold text-gray-800">
          {selectedVersionId
            ? `P&L — ${currentPnlVersion?.version_name || 'Version'}`
            : 'P&L — Working Draft'
          }
          {isCombinedDepartment && <span className="ml-2 text-sm font-normal text-gray-500">(Read-only)</span>}
          {!isCombinedDepartment && isPnlLocked && <span className="ml-2 text-sm font-normal text-red-600">(Locked)</span>}
        </h2>
        {onDepartmentChange && departmentOptions && (
          <select
            value={department}
            onChange={(e) => onDepartmentChange(e.target.value)}
            className="bg-white border border-gray-300 rounded-lg px-2 py-1 text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            {departmentOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        )}

        {/* Import P&L */}
        {canImport && (
          <PnlImport
            branchId={branchId}
            department={department}
            year={year}
            onImportComplete={refetchPnlData}
            hasExistingImport={pnlLineItems?.length > 0}
            versionId={selectedVersionId}
          />
        )}

        {/* Import Budget — draft only */}
        {canImport && selectedVersionId === null && (
          <BudgetImport
            branchId={branchId}
            branchName={branchName}
            department={department}
            year={year}
            onImportComplete={refetchPnlData}
          />
        )}

        {/* Copy Structure — draft only */}
        {canImport && selectedVersionId === null && (
          <div className="relative" ref={copyDropdownRef}>
            <button
              onClick={() => setShowCopyDropdown(!showCopyDropdown)}
              disabled={copying}
              className="px-3 py-1.5 bg-indigo-500 text-white rounded-md text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
              </svg>
              {copying ? 'Copying...' : 'Copy Structure'}
            </button>
            {showCopyDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[200px]">
                <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                  Copy account structure from:
                </div>
                {Object.entries(DEPARTMENT_LABELS)
                  .filter(([key]) => key !== department)
                  .map(([key, label]) => (
                    <button
                      key={key}
                      onClick={async () => {
                        if (pnlLineItems?.length > 0 && !window.confirm('This will replace all existing draft rows. Continue?')) return;
                        setShowCopyDropdown(false);
                        setCopying(true);
                        setCopyMessage(null);
                        try {
                          await handleCopyStructure(key);
                          setCopyMessage(`Copied from ${label}`);
                          setTimeout(() => setCopyMessage(null), 3000);
                        } catch (err) {
                          setCopyMessage(`Error: ${err.message}`);
                          setTimeout(() => setCopyMessage(null), 5000);
                        } finally {
                          setCopying(false);
                        }
                      }}
                      className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-800"
                    >
                      {label}
                    </button>
                  ))}
              </div>
            )}
            {copyMessage && (
              <span className={`text-xs ${copyMessage.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>
                {copyMessage}
              </span>
            )}
          </div>
        )}

        {/* Admin preview toggle */}
        {isRealAdmin && (
          <button
            onClick={() => setPreviewAsUser(p => !p)}
            title={previewAsUser ? 'Viewing as user — click to switch back to admin view' : 'Preview as non-admin user'}
            className={`ml-auto px-2 py-1 rounded-md text-xs font-medium flex items-center gap-1 transition-colors ${
              previewAsUser
                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200 border border-gray-200'
            }`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              {previewAsUser ? (
                <path fillRule="evenodd" d="M3.707 2.293a1 1 0 00-1.414 1.414l14 14a1 1 0 001.414-1.414l-1.473-1.473A10.014 10.014 0 0019.542 10C18.268 5.943 14.478 3 10 3a9.958 9.958 0 00-4.512 1.074l-1.78-1.781zm4.261 4.26l1.514 1.515a2.003 2.003 0 012.45 2.45l1.514 1.514a4 4 0 00-5.478-5.478z" clipRule="evenodd" />
              ) : (
                <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              )}
              {previewAsUser ? (
                <path d="M.458 10C1.732 5.943 5.522 3 10 3c.716 0 1.414.09 2.085.248L.458 10z" />
              ) : (
                <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              )}
            </svg>
            {previewAsUser ? 'User view' : 'Preview as user'}
          </button>
        )}
      </div>

      <PnlVersionBar
        branchId={branchId}
        department={department}
        year={year}
        versions={pnlVersions}
        selectedVersionId={selectedVersionId}
        onSelectVersion={setSelectedVersionId}
        referenceVersionId={referenceVersionId}
        onSelectReference={setReferenceVersionId}
        importInfo={pnlImportInfo}
        onVersionSaved={isCombinedDepartment || !isEditor ? undefined : refetchPnlVersions}
        currentVersionLocked={isPnlLocked}
        onToggleLock={!isCombinedDepartment && isAdmin ? handlePnlToggleLock : undefined}
        versionNote={currentPnlVersion?.notes || null}
        onUpdateVersionNote={isCombinedDepartment || !isEditor ? undefined : handleUpdateVersionNote}
        hasLineItems={pnlLineItems?.length > 0}
        onImportComplete={isCombinedDepartment || !isEditor ? undefined : refetchPnlData}
        readOnly={isCombinedDepartment || !isEditor}
        canDelete={isAdmin}
        onClearDraft={!isCombinedDepartment && isEditor ? handleClearDraft : undefined}
      />

      <PnlTable
        lineItems={pnlLineItems}
        importInfo={pnlImportInfo}
        loading={pnlLoading}
        year={year}
        importedMonths={importedMonths}
        onCellChange={isCombinedDepartment || !isEditor ? undefined : handlePnlCellChange}
        onRowReorder={isCombinedDepartment || !isEditor ? undefined : handlePnlRowReorder}
        isEditable={isPnlEditable && isEditor}
        isLocked={isPnlLocked}
        referenceItems={referenceItems}
        isAdmin={isAdmin}
        onToggleAdminOnly={!isCombinedDepartment && isAdmin ? handleToggleAdminOnly : undefined}
        onTogglePctMode={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleTogglePctMode : undefined}
        onApplyIncrement={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleApplyIncrement : undefined}
        onAddRefRow={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleAddRefRow : undefined}
        onAddStructuralRow={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleAddStructuralRow : undefined}
        onDeleteLineItem={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleDeleteLineItem : undefined}
        onAddSubLine={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleAddSubLine : undefined}
        onRenameSubLine={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleRenameSubLine : undefined}
        onUpdateCellNote={isCombinedDepartment ? undefined : handleUpdateCellNote}
        crossDeptConfig={
          !['maintenance', 'maintenance_onsite', 'maintenance_wo', 'all_maintenance'].includes(department)
            ? { branchId, year, versionName: currentPnlVersion?.version_name || null, department }
            : null
        }
        department={department}
      />

      {!pnlLoading && !pnlLineItems?.length && (
        <div className="text-center py-8 text-gray-500">
          <p className="text-sm">
            {isCombinedDepartment
              ? 'No P&L data across maintenance departments for this branch/year.'
              : 'No P&L data. Import a NetSuite Income Statement XLS to get started.'}
          </p>
        </div>
      )}
    </div>
  );
}
