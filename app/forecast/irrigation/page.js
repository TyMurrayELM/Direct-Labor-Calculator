"use client";

import React, { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import {
  useBranches,
  mergeBranches
} from '../../hooks/useSupabase';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import PnlSection from '../../components/PnlSection';

export default function IrrigationForecastPage() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const BRANCH_ICONS = { 'phx - north': '/n.png', 'phx - southeast': '/se.png', 'phx - southwest': '/sw.png', 'las vegas': '/lv.png' };

  // State
  const [session, setSession] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedYear, setSelectedYear] = useState(2026);
  const [pnlVersionState, setPnlVersionState] = useState(null);
  const [currentMetrics, setCurrentMetrics] = useState(null);
  const [baselineMetrics, setBaselineMetrics] = useState(null);

  const { branches, loading: branchesLoading } = useBranches();

  // Check authentication
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
      } else {
        setSession(session);
      }
    };
    getSession();
  }, [router, supabase.auth]);

  // Set Phoenix as default when branches load
  useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId('phoenix');
    }
  }, [branches, selectedBranchId]);

  // Check if Phoenix (combined) view is selected
  const isPhoenixView = selectedBranchId === 'phoenix';

  // Resolve Phoenix sub-branch IDs for combined view (memoized to avoid infinite re-renders)
  const phoenixSubBranchIds = useMemo(() =>
    branches.filter(b => b.name.toLowerCase().includes('phx')).map(b => b.id),
    [branches]
  );

  // Fetch irrigation P&L metrics for current version and Original Forecast baseline
  const pnlBranchId = isPhoenixView ? null : selectedBranchId;
  // Metrics branch IDs: single branch or all Phoenix sub-branches
  const metricsBranchIds = isPhoenixView ? phoenixSubBranchIds : (pnlBranchId ? [pnlBranchId] : []);
  useEffect(() => {
    if (metricsBranchIds.length === 0 || !pnlVersionState) { setCurrentMetrics(null); setBaselineMetrics(null); return; }

    const normalize = (name) => (name || '').toLowerCase().replace(/^total\s*-\s*/, 'total ').trim();

    // Compute metrics from a list of items (already merged if combined view)
    // recalcTotals: true for current/draft data (totals may be stale after edits),
    //               false for saved reference versions (use stored totals to match PnlTable reference display)
    const computeMetrics = (items, recalcTotals = true) => {
      if (!items?.length) return null;

      // --- Optionally recalculate total rows from detail rows ---
      if (!recalcTotals) { /* skip — use stored total values */ }
      else for (let i = 0; i < items.length; i++) {
        if (items[i].row_type !== 'total') continue;
        const sectionName = normalize(items[i].account_name).replace(/^total\s*/, '').trim();
        if (!sectionName) continue;

        let headerIdx = -1;
        for (let j = i - 1; j >= 0; j--) {
          if ((items[j].row_type === 'section_header' || items[j].row_type === 'account_header') &&
              items[j].account_name?.toLowerCase().trim() === sectionName) {
            headerIdx = j; break;
          }
        }
        if (headerIdx < 0) {
          for (let j = 0; j < items.length; j++) {
            if ((items[j].row_type === 'section_header' || items[j].row_type === 'account_header') &&
                items[j].account_name?.toLowerCase().trim() === sectionName) {
              headerIdx = j; break;
            }
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

      // --- Revenue and Gross Profit ---
      const incomeRow = items.find(r => r.row_type === 'total' && normalize(r.account_name) === 'total income');
      const revenue = incomeRow ? MONTH_KEYS.reduce((s, mk) => s + (parseFloat(incomeRow[mk]) || 0), 0) : 0;

      let cogsRow = items.find(r => r.row_type === 'total' && normalize(r.account_name).startsWith('total cost of'));
      if (!cogsRow && incomeRow) {
        const incIdx = items.indexOf(incomeRow);
        for (let k = incIdx + 1; k < items.length; k++) {
          if (items[k].row_type === 'total' && (items[k].indent_level || 0) === 0) {
            const tn = normalize(items[k].account_name);
            if (!tn.startsWith('total income') && !tn.startsWith('total other income')) {
              cogsRow = items[k]; break;
            }
          }
        }
      }
      const cogs = cogsRow ? MONTH_KEYS.reduce((s, mk) => s + (parseFloat(cogsRow[mk]) || 0), 0) : 0;
      const grossProfit = Math.round((revenue - cogs) * 100) / 100;
      const grossMargin = revenue !== 0 ? Math.round((grossProfit / revenue) * 1000) / 10 : 0;

      // --- NOI from indent-level-0 totals ---
      const noiRow = items.find(r =>
        (r.row_type === 'total' || r.row_type === 'calculated' || r.row_type === 'section_header') &&
        (normalize(r.account_name) === 'net ordinary income' || normalize(r.account_name) === 'net operating income')
      );
      let noi = 0;
      if (noiRow) {
        const noiIdx = items.indexOf(noiRow);
        for (let j = 0; j < noiIdx; j++) {
          if (items[j].row_type !== 'total' || (items[j].indent_level || 0) > 0) continue;
          const tn = normalize(items[j].account_name);
          if (!tn.startsWith('total ')) continue;
          const sn = tn.replace(/^total\s*/, '');
          const isIncome = sn === 'income' || sn.startsWith('other income');
          noi += MONTH_KEYS.reduce((s, mk) => {
            const v = parseFloat(items[j][mk]) || 0;
            return s + (isIncome ? v : -v);
          }, 0);
        }
      }

      // --- Controllable NOI ---
      let controllableNoi = 0;
      if (noiRow) {
        const noiIdx = items.indexOf(noiRow);
        for (let i = 0; i < noiIdx; i++) {
          if (items[i].row_type !== 'total' || (items[i].indent_level || 0) > 0) continue;
          const tn = normalize(items[i].account_name);
          if (!tn.startsWith('total ')) continue;
          const sectionName = tn.replace(/^total\s*/, '').trim();

          let headerIdx = -1;
          for (let j = i - 1; j >= 0; j--) {
            if ((items[j].row_type === 'section_header' || items[j].row_type === 'account_header') &&
                items[j].account_name?.toLowerCase().trim() === sectionName) {
              headerIdx = j; break;
            }
          }
          if (headerIdx < 0) continue;

          const isIncome = sectionName === 'income' || sectionName.startsWith('other income');
          let sectionSum = 0;
          for (let j = headerIdx + 1; j < i; j++) {
            if (items[j].row_type === 'detail' && !items[j].admin_only) {
              sectionSum += MONTH_KEYS.reduce((s, mk) => s + (parseFloat(items[j][mk]) || 0), 0);
            }
          }
          controllableNoi += isIncome ? sectionSum : -sectionSum;
        }
      }

      return { revenue, grossProfit, grossMargin, noi, controllableNoi };
    };

    // Fetch items for a set of version IDs (multi-branch combined or single branch)
    const fetchItems = async (branchIds, versionIds) => {
      let query = supabase
        .from('pnl_line_items')
        .select('branch_id,account_code,account_name,row_type,row_order,admin_only,indent_level,jan,feb,mar,apr,may,jun,jul,aug,sep,oct,nov,dec')
        .in('branch_id', branchIds)
        .eq('department', 'irrigation')
        .eq('year', selectedYear)
        .is('parent_id', null)
        .in('row_type', ['section_header', 'account_header', 'detail', 'total', 'calculated'])
        .order('row_order', { ascending: true });
      if (versionIds === null) {
        query = query.is('version_id', null);
      } else if (Array.isArray(versionIds)) {
        query = query.in('version_id', versionIds);
      } else {
        query = query.eq('version_id', versionIds);
      }
      const { data } = await query;
      return data || [];
    };

    // Fetch version IDs by name across branches (one per branch, most recent)
    const fetchVersionIdsByName = async (branchIds, versionName) => {
      const { data } = await supabase
        .from('pnl_versions')
        .select('id,branch_id')
        .in('branch_id', branchIds)
        .eq('department', 'irrigation')
        .eq('year', selectedYear)
        .eq('version_name', versionName)
        .order('created_at', { ascending: false });
      // Deduplicate: keep only the most recent version per branch
      const perBranch = new Map();
      for (const v of (data || [])) {
        if (!perBranch.has(v.branch_id)) perBranch.set(v.branch_id, v.id);
      }
      return [...perBranch.values()];
    };

    const run = async () => {
      // Resolve current version IDs
      let currentVersionIds = null; // null = draft
      if (isPhoenixView && pnlVersionState.versionName) {
        currentVersionIds = await fetchVersionIdsByName(metricsBranchIds, pnlVersionState.versionName);
        if (currentVersionIds.length === 0) currentVersionIds = null;
      } else if (!isPhoenixView) {
        currentVersionIds = pnlVersionState.selectedVersionId; // single ID or null for draft
      }

      // Resolve baseline version IDs
      const baselineVersionIds = await fetchVersionIdsByName(metricsBranchIds, 'Original Forecast');

      // Fetch items and compute metrics
      const currentItems = await fetchItems(metricsBranchIds, currentVersionIds);
      const baselineItems = baselineVersionIds.length > 0
        ? await fetchItems(metricsBranchIds, baselineVersionIds)
        : [];

      // For combined view, merge across branches first; for single branch, use as-is
      const mergedCurrent = isPhoenixView && metricsBranchIds.length > 1
        ? mergeBranches(currentItems)
        : currentItems;
      const mergedBaseline = isPhoenixView && metricsBranchIds.length > 1
        ? mergeBranches(baselineItems)
        : baselineItems;

      setCurrentMetrics(computeMetrics(mergedCurrent, true));
      setBaselineMetrics(mergedBaseline.length > 0 ? computeMetrics(mergedBaseline, false) : null);
    };
    run();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(metricsBranchIds), selectedYear, pnlVersionState?.selectedVersionId, pnlVersionState?.versionName]);

  // Helper functions
  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  // Get selected branch info
  const selectedBranch = isPhoenixView
    ? { name: 'Phoenix (Combined)', color: '#2563EB' }
    : branches.find(b => b.id === selectedBranchId) || {};

  const versionLabel = isPhoenixView ? 'Phoenix' : (selectedBranch?.name || '');
  const versionSuffix = pnlVersionState?.versionName ? ` \u00b7 ${pnlVersionState.versionName}` : ' \u00b7 Draft';

  const renderSummaryCard = (title, gradient, currentVal, baselineVal, upIsGood, subtitle, baselineSubtitle) => {
    const delta = baselineVal != null && currentVal != null ? currentVal - baselineVal : null;
    const pctChange = delta !== null && baselineVal !== 0 ? (delta / Math.abs(baselineVal)) * 100 : null;
    const isPositive = upIsGood ? delta > 0 : delta < 0;

    return (
      <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
        <div className={`bg-gradient-to-r ${gradient} px-4 py-2`}>
          <div className="text-white text-xs font-semibold tracking-wide uppercase">{title}</div>
        </div>
        <div className="px-4 py-3">
          <div className="text-2xl font-bold text-gray-900">{formatCurrency(currentVal)}</div>
          {subtitle && <div className="text-xs text-gray-500 mt-0.5">{subtitle}</div>}
          {baselineVal != null && (
            <div className="text-xs text-gray-500 mt-1">
              Original Forecast: {formatCurrency(baselineVal)}{baselineSubtitle ? ` (${baselineSubtitle})` : ''}
            </div>
          )}
          {delta !== null && delta !== 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${
                isPositive ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}>
                {delta > 0 ? '\u2191' : '\u2193'} {formatCurrency(Math.abs(delta))}
                {pctChange !== null && <span className="font-normal ml-0.5">({Math.abs(pctChange).toFixed(1)}%)</span>}
              </span>
              <span className="text-[10px] text-gray-500">vs Original Forecast</span>
            </div>
          )}
        </div>
        <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-500">
          {versionLabel}{versionSuffix}
        </div>
      </div>
    );
  };

  // Year options
  const yearOptions = [2025, 2026, 2027];

  const isLoading = branchesLoading;

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-blue-50">
        <div className="w-full max-w-2xl px-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-7 w-7 rounded-full border-[3px] border-blue-600 border-t-transparent animate-spin" />
            <p className="text-lg font-semibold text-black">Loading forecast data...</p>
          </div>
          <div className="space-y-3">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="flex gap-4 animate-pulse">
                <div className="h-4 bg-blue-200 rounded w-44" />
                <div className="h-4 bg-blue-100 rounded w-24" />
                <div className="h-4 bg-blue-200 rounded w-20" />
                <div className="h-4 bg-blue-100 rounded w-16" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-blue-50 min-h-screen">
      <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-white to-gray-100 p-4 border-b border-gray-200"
          style={{ borderTop: `4px solid ${selectedBranch.color || '#2563EB'}` }}>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              {/* Irrigation Icon */}
              <div className="bg-blue-100 p-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.69l1.34 1.79C15.4 7.14 18 10.6 18 14a6 6 0 11-12 0c0-3.4 2.6-6.86 4.66-9.52L12 2.69z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Irrigation Forecast</h1>
                <p className="text-sm text-gray-700 mt-1">P&L Forecast</p>
              </div>
            </div>

            <div className="flex space-x-3">
              <Link
                href="/forecast"
                className="px-2 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Maintenance Forecast</span>
              </Link>

              <Link
                href="/"
                className="px-2 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                <span>Calculator</span>
              </Link>
            </div>
          </div>

          {/* Branch & Year Selector */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Branch:</label>
              <div className="flex flex-wrap gap-2">
                {/* Phoenix Combined Button */}
                <button
                  onClick={() => setSelectedBranchId('phoenix')}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${
                    selectedBranchId === 'phoenix'
                      ? 'bg-orange-700 text-white shadow-md'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  <img src="/az.png" alt="" className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                  Phoenix
                </button>
                {/* All individual branches including sub-branches */}
                {branches.filter(b => b.name !== 'Phoenix' && b.name !== 'Corporate').map(branch => (
                  <button
                    key={branch.id}
                    onClick={() => setSelectedBranchId(branch.id)}
                    className={`px-3 py-1.5 text-sm rounded-lg font-medium transition-all ${
                      selectedBranchId === branch.id
                        ? 'text-white shadow-md'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    style={{
                      backgroundColor: selectedBranchId === branch.id ? (branch.name.toLowerCase().includes('vegas') ? '#B8860B' : (branch.color || '#2563EB')) : undefined
                    }}
                  >
                    {BRANCH_ICONS[branch.name.toLowerCase()] && (
                      <img src={BRANCH_ICONS[branch.name.toLowerCase()]} alt="" className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                    )}
                    {branch.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Year:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {yearOptions.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
          </div>

          </div>

        {/* Summary Cards */}
        {currentMetrics && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Annual Revenue */}
              {renderSummaryCard(
                'Annual Revenue', 'from-blue-600 to-blue-500',
                currentMetrics.revenue, baselineMetrics?.revenue,
                true
              )}
              {/* Gross Margin */}
              {renderSummaryCard(
                'Gross Margin', 'from-sky-600 to-sky-500',
                currentMetrics.grossProfit, baselineMetrics?.grossProfit,
                true,
                `${currentMetrics.grossMargin}% margin`,
                baselineMetrics ? `${baselineMetrics.grossMargin}%` : null
              )}
              {/* Total Controllable Income */}
              {renderSummaryCard(
                'Total Controllable Income', 'from-indigo-600 to-indigo-500',
                currentMetrics.controllableNoi, baselineMetrics?.controllableNoi,
                true
              )}
            </div>
          </div>
        )}

        {/* P&L Section (individual branches only, not Phoenix combined) */}
        {!isPhoenixView && selectedBranchId && (
          <PnlSection
            branchId={selectedBranchId}
            branchName={selectedBranch?.name}
            year={selectedYear}
            department="irrigation"
            onVersionStateChange={setPnlVersionState}
          />
        )}

        {isPhoenixView && phoenixSubBranchIds.length > 0 && (
          <PnlSection
            branchId={phoenixSubBranchIds}
            branchName="Phoenix (Combined)"
            year={selectedYear}
            department="irrigation"
            onVersionStateChange={setPnlVersionState}
          />
        )}

      </div>
    </div>
  );
}
