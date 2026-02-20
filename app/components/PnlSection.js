'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import { usePnlLineItems, usePnlVersions, mergeAllDepartments } from '../hooks/useSupabase';
import PnlTable from './PnlTable';
import PnlVersionBar from './PnlVersionBar';

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
export default function PnlSection({
  branchId,
  branchName,
  year,
  department,
  onDepartmentChange,
  departmentOptions
}) {
  // --- Role detection ---
  const [userRole, setUserRole] = useState(null);
  const isAdmin = userRole === 'admin';
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
  const pnlCellUpdateTimer = useRef(null);
  const pendingPnlUpdates = useRef(new Map());

  // Reset version selections when branch/year/department changes
  useEffect(() => {
    setSelectedVersionId(null);
    setReferenceVersionId(null);
    setReferenceItems(null);
  }, [branchId, year, department]);

  // --- Combined department logic ---
  const isCombinedDepartment = department === 'all_maintenance';

  // Fetch versions
  const { versions: pnlVersions, allRawVersions: pnlAllRawVersions, refetchVersions: refetchPnlVersions } = usePnlVersions(
    branchId, department, year
  );

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
  const { lineItems: pnlLineItems, importInfo: pnlImportInfo, loading: pnlLoading, refetchPnlData, patchLineItem, reorderLineItems } = usePnlLineItems(
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
      patchLineItem(lineItemId, { admin_only: !currentValue });
      const res = await fetch('/api/pnl/toggle-admin-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lineItemId, adminOnly: !currentValue })
      });
      const result = await res.json();
      if (!result.success) console.error('Failed to save admin_only:', result.error);
    } catch (err) {
      console.error('Failed to toggle admin_only:', err);
    }
  }, [patchLineItem]);

  const handleTogglePctMode = useCallback(async (lineItemId, pctOfTotal, pctSource) => {
    try {
      patchLineItem(lineItemId, { pct_of_total: pctOfTotal, pct_source: pctSource });
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

  // --- Render ---
  return (
    <div className="p-6 border-t border-gray-200">
      <div className="flex items-center gap-3 mb-3">
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
      </div>

      <PnlVersionBar
        branchId={branchId}
        branchName={branchName}
        department={department}
        year={year}
        versions={pnlVersions}
        selectedVersionId={selectedVersionId}
        onSelectVersion={setSelectedVersionId}
        referenceVersionId={referenceVersionId}
        onSelectReference={setReferenceVersionId}
        importInfo={pnlImportInfo}
        onImportComplete={isCombinedDepartment || !isEditor ? undefined : refetchPnlData}
        onVersionSaved={isCombinedDepartment || !isEditor ? undefined : refetchPnlVersions}
        currentVersionLocked={isPnlLocked}
        onToggleLock={!isCombinedDepartment && isAdmin ? handlePnlToggleLock : undefined}
        versionNote={currentPnlVersion?.notes || null}
        onUpdateVersionNote={isCombinedDepartment || !isEditor ? undefined : handleUpdateVersionNote}
        hasLineItems={pnlLineItems?.length > 0}
        onCopyStructure={isCombinedDepartment || !isEditor ? undefined : handleCopyStructure}
        readOnly={isCombinedDepartment || !isEditor}
        canDelete={isAdmin}
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
        onAddRefRow={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleAddRefRow : undefined}
        onAddStructuralRow={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleAddStructuralRow : undefined}
        onDeleteLineItem={!isCombinedDepartment && isEditor && isPnlEditable && !isPnlLocked ? handleDeleteLineItem : undefined}
        onUpdateCellNote={isCombinedDepartment ? undefined : handleUpdateCellNote}
        crossDeptConfig={
          !['maintenance', 'maintenance_onsite', 'maintenance_wo', 'all_maintenance'].includes(department)
            ? { branchId, year, versionName: currentPnlVersion?.version_name || null }
            : null
        }
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
