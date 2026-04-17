"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  useBranches,
  useAllBranchForecasts,
  useCrews
} from '../hooks/useSupabase';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import PnlSection from '../components/PnlSection';

export default function ForecastPage() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // Constants matching your existing calculator
  const GROSS_MARGIN_TARGET = 0.60;
  const HOURS_PER_MONTH = 173.33; // ~40 hrs/week * 4.333 weeks

  // Branch-specific hourly costs (Maintenance rates - matching Crew Management page)
  const HOURLY_COST_LAS_VEGAS = 24.50;
  const HOURLY_COST_PHOENIX = 25.50;
  const DEFAULT_HOURLY_RATE = 25.00;

  // Single source of truth for branch classification by name.
  // Returns one of: 'phoenix_parent' | 'phoenix_sub' | 'las_vegas' | 'default'
  const classifyBranch = (branchName) => {
    if (!branchName) return 'default';
    const name = branchName.toLowerCase().trim();
    if (name === 'phoenix') return 'phoenix_parent';
    if (name.includes('las vegas') || name.includes('vegas')) return 'las_vegas';
    if (name.includes('phoenix') ||
        name.includes('southeast') ||
        name.includes('southwest') ||
        name.includes('north') ||
        name.includes('phx')) {
      return 'phoenix_sub';
    }
    return 'default';
  };

  const getHourlyRateByBranch = (branch) => {
    const region = classifyBranch(branch?.name);
    if (region === 'las_vegas') return HOURLY_COST_LAS_VEGAS;
    if (region === 'phoenix_sub' || region === 'phoenix_parent') return HOURLY_COST_PHOENIX;
    return DEFAULT_HOURLY_RATE;
  };

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const PNL_MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const sumPnl = (obj) => obj ? PNL_MONTH_KEYS.reduce((s, k) => s + (parseFloat(obj[k]) || 0), 0) : 0;
  const sumPnlSlice = (obj, start, end) => obj ? PNL_MONTH_KEYS.slice(start, end + 1).reduce((s, k) => s + (parseFloat(obj[k]) || 0), 0) : 0;

  // State
  const [session, setSession] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedDepartment, setSelectedDepartment] = useState('maintenance');
  const [phoenixPnlDepartment, setPhoenixPnlDepartment] = useState('arbor');
  const [pnlVersionName, setPnlVersionName] = useState(null);

  // Fetch data
  const { branches, loading: branchesLoading } = useBranches();
  const { forecasts: allBranchForecasts, loading: allForecastsLoading, refetchForecasts: refetchAllForecasts } = useAllBranchForecasts(selectedYear);
  const { crews, loading: crewsLoading } = useCrews();

  // P&L summary data for summary cards (revenue + direct labor by department)
  const [pnlSummary, setPnlSummary] = useState(null);
  const [pnlBaseline, setPnlBaseline] = useState(null);
  useEffect(() => {
    if (!selectedBranchId || selectedBranchId === 'encore' || selectedBranchId === 'phoenix') {
      setPnlSummary(null);
      setPnlBaseline(null);
      return;
    }
    const base = `/api/pnl/cross-dept-revenue?branchId=${selectedBranchId}&year=${selectedYear}`;
    const fetchPnlSummary = async () => {
      try {
        const vParam = pnlVersionName ? `&versionName=${encodeURIComponent(pnlVersionName)}` : '';
        const res = await fetch(`${base}${vParam}`);
        const data = await res.json();
        if (data.success) setPnlSummary(data.departments);
        else setPnlSummary(null);
      } catch { setPnlSummary(null); }
    };
    const fetchBaseline = async () => {
      try {
        const res = await fetch(`${base}&versionName=${encodeURIComponent('Original Forecast')}`);
        const data = await res.json();
        if (data.success) setPnlBaseline(data.departments);
        else setPnlBaseline(null);
      } catch { setPnlBaseline(null); }
    };
    fetchPnlSummary();
    fetchBaseline();
  }, [selectedBranchId, selectedYear, pnlVersionName]);

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

  // Set initial branch when branches load
  useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  // Refetch all branch forecasts when switching to Encore or Phoenix view
  useEffect(() => {
    if (selectedBranchId === 'encore' || selectedBranchId === 'phoenix') {
      refetchAllForecasts();
    }
  }, [selectedBranchId, refetchAllForecasts]);

  const formatCurrency = (value) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatNumber = (value, decimals = 1) => {
    return value.toLocaleString('en-US', {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  };

  // Check if Encore (company-wide) or Phoenix (combined Phoenix branches) view is selected
  const isEncoreView = selectedBranchId === 'encore';
  const isPhoenixView = selectedBranchId === 'phoenix';
  const isCombinedView = isEncoreView || isPhoenixView;

  // Phoenix parent branch ID for region-level P&L (arbor, enhancements, spray)
  const phoenixBranchRecord = branches.find(b => b.name === 'Phoenix');
  const phoenixBranchId = phoenixBranchRecord?.id || null;

  // Is this a Phoenix *sub*-branch? (Excludes the parent "Phoenix" record used for region-level P&L.)
  const isPhoenixBranch = (branch) => classifyBranch(branch?.name) === 'phoenix_sub';

  // Get selected branch and its hourly rate
  const selectedBranch = isEncoreView
    ? { name: 'Encore (All Branches)', color: '#374151' }
    : isPhoenixView
    ? { name: 'Phoenix (Combined)', color: '#DC2626' }
    : branches.find(b => b.id === selectedBranchId) || {};
  const hourlyRate = isEncoreView
    ? DEFAULT_HOURLY_RATE
    : isPhoenixView
    ? HOURLY_COST_PHOENIX
    : getHourlyRateByBranch(selectedBranch);

  // Operational branches (exclude parent "Phoenix" record used for region-level P&L only)
  const operationalBranches = branches.filter(b => b.name !== 'Phoenix');

  // Roll up revenue + labor totals across an arbitrary list of branches.
  const reduceBranchTotals = (branchList) => branchList.reduce((acc, branch) => {
    const branchForecasts = allBranchForecasts[branch.id] || [];
    const branchRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.forecast_revenue) || 0), 0);
    const branchOnsiteRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.onsite_revenue) || 0), 0);
    const branchHourlyRate = getHourlyRateByBranch(branch);
    const branchLaborBudget = branchRevenue * (1 - GROSS_MARGIN_TARGET);
    const branchOnsiteLaborBudget = branchOnsiteRevenue * 0.55;
    const branchLaborHours = branchLaborBudget / branchHourlyRate;
    return {
      revenue: acc.revenue + branchRevenue,
      onsiteRevenue: acc.onsiteRevenue + branchOnsiteRevenue,
      laborBudget: acc.laborBudget + branchLaborBudget,
      onsiteLaborBudget: acc.onsiteLaborBudget + branchOnsiteLaborBudget,
      laborHours: acc.laborHours + branchLaborHours
    };
  }, { revenue: 0, onsiteRevenue: 0, laborBudget: 0, onsiteLaborBudget: 0, laborHours: 0 });

  const companyTotals = reduceBranchTotals(operationalBranches);
  const phoenixTotals = reduceBranchTotals(branches.filter(isPhoenixBranch));

  // For individual branches, derive totals from P&L summary
  const branchTotals = (() => {
    if (!pnlSummary) return { revenue: 0, onsiteRevenue: 0, laborBudget: 0, onsiteLaborBudget: 0, laborHours: 0 };
    const maintRev = sumPnl(pnlSummary.maintenance?.revenue);
    const onsiteRev = sumPnl(pnlSummary.maintenance_onsite?.revenue);
    const laborBudget = maintRev * (1 - GROSS_MARGIN_TARGET);
    const onsiteLaborBudget = onsiteRev * 0.55;
    const laborHours = laborBudget / hourlyRate;
    return { revenue: maintRev, onsiteRevenue: onsiteRev, laborBudget, onsiteLaborBudget, laborHours };
  })();

  // Use appropriate totals based on view
  const totals = isEncoreView ? companyTotals : isPhoenixView ? phoenixTotals : branchTotals;

  const avgMaintFtes = Math.floor(totals.laborHours / HOURS_PER_MONTH / 12);

  // Calculate Scheduled HC (sum of crew sizes, excluding Onsite crews)
  const getScheduledHC = () => {
    // Filter out Onsite crews - only count Maintenance crews.
    // Case-insensitive match: DB values have varied casing historically.
    const maintenanceCrews = crews.filter(crew => (crew.crew_type || '').toLowerCase() !== 'onsite');

    if (isEncoreView) {
      // Sum all maintenance crews across all branches
      return maintenanceCrews.reduce((sum, crew) => sum + (crew.size || 0), 0);
    } else if (isPhoenixView) {
      // Sum maintenance crews from Phoenix branches only
      const phoenixBranchIds = branches.filter(isPhoenixBranch).map(b => b.id);
      return maintenanceCrews
        .filter(crew => phoenixBranchIds.includes(crew.branch_id))
        .reduce((sum, crew) => sum + (crew.size || 0), 0);
    } else {
      // Sum maintenance crews from selected branch only
      return maintenanceCrews
        .filter(crew => crew.branch_id === selectedBranchId)
        .reduce((sum, crew) => sum + (crew.size || 0), 0);
    }
  };

  const scheduledHC = getScheduledHC();

  // Year options
  const yearOptions = [2025, 2026, 2027];

  // Loading state
  if (branchesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-blue-100">
        <div className="w-full max-w-2xl px-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-7 w-7 rounded-full border-[3px] border-blue-600 border-t-transparent animate-spin" />
            <p className="text-lg font-semibold text-black">Loading...</p>
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
    <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-blue-100 min-h-screen">
      <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-white to-gray-100 p-4 border-b border-gray-200"
          style={{ borderTop: `4px solid ${selectedBranch.color || '#4F46E5'}` }}>
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-800">Maintenance FTE Forecast Based on Revenue</h1>

            <div className="flex space-x-2">
              <Link
                href="/"
                className="px-2 py-1 bg-white text-gray-700 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors flex items-center space-x-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Calculator</span>
              </Link>

              <Link
                href="/schedule"
                className="px-2 py-1 bg-white text-indigo-600 text-sm border border-indigo-400 rounded-lg hover:bg-indigo-50 transition-colors shadow-sm font-medium flex items-center space-x-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
                <span>Schedule</span>
              </Link>
            </div>
          </div>

          {/* Branch & Year Selector */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Branch:</label>
              <div className="flex flex-wrap gap-2">
                {branches.filter(b => b.name !== 'Phoenix' && b.name !== 'Corporate').map(branch => {
                  // Define colors based on branch name
                  const branchName = branch.name.toLowerCase();
                  let lightBg, darkBg, lightText, darkText, hoverBg;

                  if (branchName.includes('north')) {
                    lightBg = 'bg-green-100';
                    darkBg = 'bg-green-600';
                    lightText = 'text-green-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-green-200';
                  } else if (branchName.includes('southeast')) {
                    lightBg = 'bg-red-100';
                    darkBg = 'bg-red-600';
                    lightText = 'text-red-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-red-200';
                  } else if (branchName.includes('southwest')) {
                    lightBg = 'bg-blue-100';
                    darkBg = 'bg-blue-600';
                    lightText = 'text-blue-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-blue-200';
                  } else if (branchName.includes('vegas')) {
                    lightBg = 'bg-amber-100';
                    darkBg = '';
                    lightText = 'text-amber-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-amber-200';
                  } else {
                    lightBg = 'bg-gray-200';
                    darkBg = 'bg-gray-600';
                    lightText = 'text-gray-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-gray-300';
                  }

                  const isSelected = selectedBranchId === branch.id;
                  const BRANCH_ICONS = { 'phx - north': '/n.png', 'phx - southeast': '/se.png', 'phx - southwest': '/sw.png', 'las vegas': '/lv.png' };
                  const icon = BRANCH_ICONS[branch.name.toLowerCase()];

                  return (
                    <button
                      key={branch.id}
                      onClick={() => setSelectedBranchId(branch.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                        isSelected
                          ? `${darkBg} ${darkText} shadow-md`
                          : `${lightBg} ${lightText} ${hoverBg}`
                      }`}
                      style={isSelected && branchName.includes('vegas') ? { backgroundColor: '#B8860B' } : undefined}
                    >
                      {icon && <img src={icon} alt="" className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />}
                      {branch.name.replace('Phoenix ', '').replace('Las Vegas', 'LV')}
                    </button>
                  );
                })}
                <button
                  onClick={() => setSelectedBranchId('phoenix')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                    selectedBranchId === 'phoenix'
                      ? 'bg-orange-700 text-white shadow-md'
                      : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                  }`}
                >
                  <img src="/az.png" alt="" className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                  Phoenix
                </button>
                <button
                  onClick={() => setSelectedBranchId('encore')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                    selectedBranchId === 'encore'
                      ? 'bg-blue-700 text-white shadow-md'
                      : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                  }`}
                >
                  <img src="/agave.png" alt="" className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />
                  Encore
                </button>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Year:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="bg-white border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                {yearOptions.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Company-Wide Summary */}
          <div className="bg-gradient-to-r from-gray-800 to-gray-700 rounded-lg px-4 py-2 mb-4 text-white flex items-center gap-6">
            <div className="text-sm text-gray-300">Company-Wide Annual Totals ({selectedYear})</div>
            <div className="flex items-center gap-1">
              <span className="text-gray-400 text-sm">Total Revenue:</span>
              <span className="font-bold">{formatCurrency(companyTotals.revenue)}</span>
            </div>
            <div className="flex items-center gap-1">
              <span className="text-gray-400 text-sm">Total Labor Budget:</span>
              <span className="font-bold">{formatCurrency(companyTotals.laborBudget)}</span>
            </div>
          </div>

          {/* Constants Display */}
          <div className="flex flex-wrap gap-4 text-sm bg-gray-100 rounded-lg p-4">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Target GM:</span>
              <span className="text-green-600 font-semibold">60%</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Labor Budget:</span>
              <span className="text-blue-600 font-semibold">40% of Revenue</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Fully Burdened Rate:</span>
              <span className="text-purple-600 font-semibold">${hourlyRate}/hr</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Hours/Month:</span>
              <span className="text-orange-600 font-semibold">{HOURS_PER_MONTH}</span>
            </div>
          </div>
        </div>

        {/* Summary Cards */}
        {(totals.revenue > 0 || totals.onsiteRevenue > 0) && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">

              {/* Annual Revenue */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-green-600 to-green-500 px-4 py-2">
                  <div className="text-white text-xs font-semibold tracking-wide uppercase">Annual Revenue</div>
                </div>
                {(() => {
                  const maintRev = pnlSummary ? sumPnl(pnlSummary.maintenance?.revenue) : totals.revenue;
                  const onsiteRev = pnlSummary ? sumPnl(pnlSummary.maintenance_onsite?.revenue) : totals.onsiteRevenue;
                  const totalRev = maintRev + onsiteRev;
                  const baseTotal = pnlBaseline
                    ? sumPnl(pnlBaseline.maintenance?.revenue) + sumPnl(pnlBaseline.maintenance_onsite?.revenue)
                    : null;
                  const delta = baseTotal !== null ? totalRev - baseTotal : null;
                  const pctChange = baseTotal > 0 ? ((totalRev - baseTotal) / baseTotal) * 100 : null;

                  return (
                    <div className="px-4 py-3">
                      <div className="text-2xl font-bold text-gray-900">{formatCurrency(totalRev)}</div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-900">
                        <span>{formatCurrency(maintRev)} maint</span>
                        <span className="text-gray-300">|</span>
                        <span>{formatCurrency(onsiteRev)} onsite</span>
                      </div>
                      {delta !== null && delta !== 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${
                            delta > 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {delta > 0 ? '\u2191' : '\u2193'} {formatCurrency(Math.abs(delta))}
                            {pctChange !== null && <span className="font-normal ml-0.5">({formatNumber(Math.abs(pctChange), 1)}%)</span>}
                          </span>
                          <span className="text-[10px] text-gray-900">vs Original Forecast</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-900">
                  {selectedBranch.name}{pnlVersionName ? ` \u00b7 ${pnlVersionName}` : ''}
                </div>
              </div>

              {/* Annual Direct Labor */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-2">
                  <div className="text-white text-xs font-semibold tracking-wide uppercase">Annual Direct Labor</div>
                </div>
                {(() => {
                  const maintDL = pnlSummary ? Math.abs(sumPnl(pnlSummary.maintenance?.directLabor)) : totals.laborBudget;
                  const onsiteDL = pnlSummary ? Math.abs(sumPnl(pnlSummary.maintenance_onsite?.directLabor)) : totals.onsiteLaborBudget;
                  const totalDL = maintDL + onsiteDL;
                  const baseTotal = pnlBaseline
                    ? Math.abs(sumPnl(pnlBaseline.maintenance?.directLabor)) + Math.abs(sumPnl(pnlBaseline.maintenance_onsite?.directLabor))
                    : null;
                  const delta = baseTotal !== null ? totalDL - baseTotal : null;
                  const pctChange = baseTotal > 0 ? ((totalDL - baseTotal) / baseTotal) * 100 : null;

                  return (
                    <div className="px-4 py-3">
                      <div className="text-2xl font-bold text-gray-900">{formatCurrency(totalDL)}</div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-900">
                        <span>{formatCurrency(maintDL)} maint</span>
                        <span className="text-gray-300">|</span>
                        <span>{formatCurrency(onsiteDL)} onsite</span>
                      </div>
                      {delta !== null && delta !== 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${
                            delta > 0 ? 'bg-red-100 text-red-700' : 'bg-green-100 text-green-700'
                          }`}>
                            {delta > 0 ? '\u2191' : '\u2193'} {formatCurrency(Math.abs(delta))}
                            {pctChange !== null && <span className="font-normal ml-0.5">({formatNumber(Math.abs(pctChange), 1)}%)</span>}
                          </span>
                          <span className="text-[10px] text-gray-900">vs Original Forecast</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-900">
                  {selectedBranch.name}{pnlVersionName ? ` \u00b7 ${pnlVersionName}` : ''}
                </div>
              </div>

              {/* YTD Actual DL % */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-purple-600 to-purple-500 px-4 py-2">
                  <div className="text-white text-xs font-semibold tracking-wide uppercase">YTD Direct Labor %</div>
                </div>
                {(() => {
                  const now = new Date();
                  const currentMonthIndex = now.getMonth();
                  const lastMonthIndex = currentMonthIndex === 0 ? 0 : currentMonthIndex - 1;

                  let maintActualCost, maintRevenue, onsiteActualCost, onsiteRev;

                  if (pnlSummary) {
                    maintRevenue = sumPnlSlice(pnlSummary.maintenance?.revenue, 0, lastMonthIndex);
                    maintActualCost = Math.abs(sumPnlSlice(pnlSummary.maintenance?.directLabor, 0, lastMonthIndex));
                    onsiteRev = sumPnlSlice(pnlSummary.maintenance_onsite?.revenue, 0, lastMonthIndex);
                    onsiteActualCost = Math.abs(sumPnlSlice(pnlSummary.maintenance_onsite?.directLabor, 0, lastMonthIndex));
                  } else if (isCombinedView) {
                    const ytdMonths = months.slice(0, lastMonthIndex + 1);
                    const branchesToSum = isPhoenixView ? branches.filter(isPhoenixBranch) : operationalBranches;
                    maintRevenue = 0; maintActualCost = 0; onsiteRev = 0; onsiteActualCost = 0;
                    branchesToSum.forEach(branch => {
                      const branchForecasts = allBranchForecasts[branch.id] || [];
                      ytdMonths.forEach(month => {
                        const forecast = branchForecasts.find(f => f.month === month);
                        if (forecast) {
                          maintRevenue += parseFloat(forecast.forecast_revenue) || 0;
                          maintActualCost += parseFloat(forecast.actual_labor_cost) || 0;
                          onsiteRev += parseFloat(forecast.onsite_revenue) || 0;
                          onsiteActualCost += parseFloat(forecast.onsite_actual_labor_cost) || 0;
                        }
                      });
                    });
                  } else {
                    maintActualCost = 0; maintRevenue = 0; onsiteActualCost = 0; onsiteRev = 0;
                  }

                  const maintDL = maintRevenue > 0 ? (maintActualCost / maintRevenue) * 100 : null;
                  const onsiteDL = onsiteRev > 0 ? (onsiteActualCost / onsiteRev) * 100 : null;
                  const totalRevenue = maintRevenue + onsiteRev;
                  const totalCost = maintActualCost + onsiteActualCost;
                  const combinedDL = totalRevenue > 0 ? (totalCost / totalRevenue) * 100 : null;

                  let baseCombinedDL = null;
                  if (pnlBaseline) {
                    const baseMaintRev = sumPnlSlice(pnlBaseline.maintenance?.revenue, 0, lastMonthIndex);
                    const baseMaintCost = Math.abs(sumPnlSlice(pnlBaseline.maintenance?.directLabor, 0, lastMonthIndex));
                    const baseOnsiteRev = sumPnlSlice(pnlBaseline.maintenance_onsite?.revenue, 0, lastMonthIndex);
                    const baseOnsiteCost = Math.abs(sumPnlSlice(pnlBaseline.maintenance_onsite?.directLabor, 0, lastMonthIndex));
                    const baseTotalRev = baseMaintRev + baseOnsiteRev;
                    const baseTotalCost = baseMaintCost + baseOnsiteCost;
                    if (baseTotalRev > 0) baseCombinedDL = (baseTotalCost / baseTotalRev) * 100;
                  }

                  const maintLaborTarget = maintRevenue * 0.40;
                  const onsiteLaborTarget = onsiteRev * 0.55;
                  const combinedDLTarget = totalRevenue > 0 ? ((maintLaborTarget + onsiteLaborTarget) / totalRevenue) * 100 : null;

                  return (
                    <div className="px-4 py-3">
                      <div className="flex items-baseline gap-1">
                        <div className="text-2xl font-bold text-gray-900">
                          {combinedDL !== null ? formatNumber(combinedDL, 1) + '%' : '\u2014'}
                        </div>
                        {combinedDLTarget !== null && (
                          <span className="text-sm text-gray-900 font-normal">/ {formatNumber(combinedDLTarget, 1)}%</span>
                        )}
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-900">
                        <span>{maintDL !== null ? formatNumber(maintDL, 1) + '%' : '\u2014'} maint</span>
                        <span className="text-gray-300">|</span>
                        <span>{onsiteDL !== null ? formatNumber(onsiteDL, 1) + '%' : '\u2014'} onsite</span>
                      </div>
                      {combinedDL !== null && baseCombinedDL !== null && (
                        <div className="mt-2 flex items-center gap-2">
                          {(() => {
                            const dlDelta = combinedDL - baseCombinedDL;
                            const favorable = dlDelta <= 0;
                            return (
                              <>
                                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${
                                  favorable ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                                }`}>
                                  {dlDelta > 0 ? '\u2191' : dlDelta < 0 ? '\u2193' : ''} {formatNumber(Math.abs(dlDelta), 1)}pp
                                </span>
                                <span className="text-[10px] text-gray-900">vs Original Forecast</span>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-900">
                  {selectedBranch.name} &middot; thru {months[Math.max(0, new Date().getMonth() === 0 ? 0 : new Date().getMonth() - 1)]}
                </div>
              </div>

              {/* Average FTEs/Month */}
              <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
                <div className="bg-gradient-to-r from-orange-500 to-orange-400 px-4 py-2">
                  <div className="text-white text-xs font-semibold tracking-wide uppercase">Avg FTEs / Month</div>
                </div>
                {(() => {
                  const onsiteRevTotal = pnlSummary ? sumPnl(pnlSummary.maintenance_onsite?.revenue) : totals.onsiteRevenue;
                  const avgOnsiteFtes = onsiteRevTotal > 0
                    ? Math.floor((onsiteRevTotal * 0.55) / hourlyRate / HOURS_PER_MONTH / 12)
                    : 0;
                  const totalFtes = avgMaintFtes + avgOnsiteFtes;

                  let baseTotalFtes = null;
                  if (pnlBaseline) {
                    const baseMaintRev = sumPnl(pnlBaseline.maintenance?.revenue);
                    const baseOnsiteRev = sumPnl(pnlBaseline.maintenance_onsite?.revenue);
                    const baseMaintLaborBudget = baseMaintRev * (1 - GROSS_MARGIN_TARGET);
                    const baseMaintHours = baseMaintLaborBudget / hourlyRate;
                    const baseMaintFtes = Math.floor(baseMaintHours / HOURS_PER_MONTH / 12);
                    const baseOnsiteFtes = baseOnsiteRev > 0
                      ? Math.floor((baseOnsiteRev * 0.55) / hourlyRate / HOURS_PER_MONTH / 12)
                      : 0;
                    baseTotalFtes = baseMaintFtes + baseOnsiteFtes;
                  }
                  const delta = baseTotalFtes !== null ? totalFtes - baseTotalFtes : null;

                  return (
                    <div className="px-4 py-3">
                      <div className="text-2xl font-bold text-gray-900">{totalFtes}</div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-gray-900">
                        <span>{avgMaintFtes} maint</span>
                        <span className="text-gray-300">|</span>
                        <span>{avgOnsiteFtes} onsite</span>
                      </div>
                      {delta !== null && delta !== 0 && (
                        <div className="mt-2 flex items-center gap-2">
                          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-semibold ${
                            delta > 0 ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {delta > 0 ? '\u2191' : '\u2193'} {Math.abs(delta)}
                          </span>
                          <span className="text-[10px] text-gray-900">vs Original Forecast</span>
                        </div>
                      )}
                    </div>
                  );
                })()}
                <div className="px-4 py-1.5 bg-gray-50 border-t border-gray-100 text-[10px] text-gray-900">
                  {selectedBranch.name}{pnlVersionName ? ` \u00b7 ${pnlVersionName}` : ''}
                </div>
              </div>

            </div>
          </div>
        )}



        {/* Branch Comparison - Only show for Phoenix and Encore views */}
        {isCombinedView && (
        <div className="p-6 border-t border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-4">Branch Comparison ({selectedYear})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-700">Branch</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-700">Annual Revenue</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-700">Labor Budget</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-700">YTD Actual DL %</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-700">Actual HC</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-700">Target FTEs</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-700">% of {isPhoenixView ? 'Phoenix' : 'Company'}</th>
                </tr>
              </thead>
              <tbody>
                {(isPhoenixView ? branches.filter(isPhoenixBranch) : operationalBranches).map(branch => {
                  const branchForecasts = allBranchForecasts[branch.id] || [];
                  const branchRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.forecast_revenue) || 0), 0);
                  const branchOnsiteRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.onsite_revenue) || 0), 0);
                  const branchTotalRevenue = branchRevenue + branchOnsiteRevenue;
                  const branchHourlyRate = getHourlyRateByBranch(branch);
                  const branchMaintenanceLaborBudget = branchRevenue * (1 - GROSS_MARGIN_TARGET);
                  const branchOnsiteLaborBudget = branchOnsiteRevenue * 0.55;
                  const branchTotalLaborBudget = branchMaintenanceLaborBudget + branchOnsiteLaborBudget;
                  const branchLaborHours = branchMaintenanceLaborBudget / branchHourlyRate;
                  const branchAvgFtes = Math.floor(branchLaborHours / HOURS_PER_MONTH / 12);
                  // Use appropriate totals for percentage calculation
                  const viewTotals = isPhoenixView ? phoenixTotals : companyTotals;
                  const viewTotalRevenue = viewTotals.revenue + viewTotals.onsiteRevenue;
                  const percentOfTotal = viewTotalRevenue > 0
                    ? (branchTotalRevenue / viewTotalRevenue) * 100
                    : 0;

                  // Calculate YTD Actual DL % (Combined: Maintenance + Onsite)
                  const now = new Date();
                  const currentMonthIndex = now.getMonth();
                  const lastMonthIndex = currentMonthIndex === 0 ? 0 : currentMonthIndex - 1;
                  let ytdCombinedDL = null;
                  let lastMonthActualHC = null;
                  let lastMonthTargetFTEs = null;

                  const ytdMonths = months.slice(0, lastMonthIndex + 1);
                  const lastMonth = months[lastMonthIndex];
                  const lastMonthForecast = branchForecasts.find(f => f.month === lastMonth);

                  // Get Actual HC from last complete month
                  if (lastMonthForecast) {
                    lastMonthActualHC = parseFloat(lastMonthForecast.actual_ftes) || null;

                    // Calculate Target FTEs for last month (FTEs Required)
                    const lastMonthRevenue = parseFloat(lastMonthForecast.forecast_revenue) || 0;
                    if (lastMonthRevenue > 0) {
                      const laborBudget = lastMonthRevenue * (1 - GROSS_MARGIN_TARGET);
                      const laborHours = laborBudget / branchHourlyRate;
                      lastMonthTargetFTEs = Math.floor(laborHours / HOURS_PER_MONTH);
                    }
                  }

                  // Combined YTD calculation (Maintenance + Onsite)
                  const ytdMaintRevenue = ytdMonths.reduce((sum, month) => {
                    const forecast = branchForecasts.find(f => f.month === month);
                    return sum + (forecast ? parseFloat(forecast.forecast_revenue) || 0 : 0);
                  }, 0);
                  const ytdMaintLaborCost = ytdMonths.reduce((sum, month) => {
                    const forecast = branchForecasts.find(f => f.month === month);
                    return sum + (forecast ? parseFloat(forecast.actual_labor_cost) || 0 : 0);
                  }, 0);
                  const ytdOnsiteRevenue = ytdMonths.reduce((sum, month) => {
                    const forecast = branchForecasts.find(f => f.month === month);
                    return sum + (forecast ? parseFloat(forecast.onsite_revenue) || 0 : 0);
                  }, 0);
                  const ytdOnsiteLaborCost = ytdMonths.reduce((sum, month) => {
                    const forecast = branchForecasts.find(f => f.month === month);
                    return sum + (forecast ? parseFloat(forecast.onsite_actual_labor_cost) || 0 : 0);
                  }, 0);

                  const totalYtdRevenue = ytdMaintRevenue + ytdOnsiteRevenue;
                  const totalYtdLaborCost = ytdMaintLaborCost + ytdOnsiteLaborCost;

                  // Calculate combined DL target: (Maint @ 40% + Onsite @ 55%) / Total Revenue
                  let ytdCombinedDLTarget = null;
                  if (totalYtdRevenue > 0) {
                    ytdCombinedDL = (totalYtdLaborCost / totalYtdRevenue) * 100;
                    const maintLaborTarget = ytdMaintRevenue * 0.40;
                    const onsiteLaborTarget = ytdOnsiteRevenue * 0.55;
                    ytdCombinedDLTarget = ((maintLaborTarget + onsiteLaborTarget) / totalYtdRevenue) * 100;
                  }

                  return (
                    <tr
                      key={branch.id}
                      className="border-b border-gray-100 hover:bg-gray-50"
                    >
                      <td className="py-2 px-3 font-medium">
                        <span
                          className="inline-block w-3 h-3 rounded-full mr-2"
                          style={{ backgroundColor: branch.color || '#4F46E5' }}
                        ></span>
                        {branch.name}
                      </td>
                      <td className="py-2 px-3 text-right">{formatCurrency(branchTotalRevenue)}</td>
                      <td className="py-2 px-3 text-right">{formatCurrency(branchTotalLaborBudget)}</td>
                      <td className="py-2 px-3 text-right">
                        {ytdCombinedDL !== null ? (
                          <span className={`font-medium ${ytdCombinedDL > ytdCombinedDLTarget ? 'text-red-600' : 'text-green-600'}`}>
                            {formatNumber(ytdCombinedDL, 1)}%
                            <span className="text-gray-700 font-normal text-xs"> / {formatNumber(ytdCombinedDLTarget, 1)}%</span>
                          </span>
                        ) : '\u2014'}
                      </td>
                      <td className="py-2 px-3 text-right">{lastMonthActualHC !== null ? lastMonthActualHC : '\u2014'}</td>
                      <td className="py-2 px-3 text-right">{lastMonthTargetFTEs !== null ? lastMonthTargetFTEs : '\u2014'}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div
                              className="h-2 rounded-full"
                              style={{
                                width: `${Math.min(percentOfTotal, 100)}%`,
                                backgroundColor: branch.color || '#4F46E5'
                              }}
                            />
                          </div>
                          <span className="w-12 text-right">{formatNumber(percentOfTotal, 1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-100 font-semibold">
                  <td className="py-2 px-3">{isPhoenixView ? 'Phoenix Total' : 'Company Total'}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency((isPhoenixView ? phoenixTotals : companyTotals).revenue + (isPhoenixView ? phoenixTotals : companyTotals).onsiteRevenue)}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency((isPhoenixView ? phoenixTotals : companyTotals).laborBudget + (isPhoenixView ? phoenixTotals : companyTotals).onsiteLaborBudget)}</td>
                  <td className="py-2 px-3 text-right">
                    {(() => {
                      const now = new Date();
                      const currentMonthIndex = now.getMonth();
                      const lastMonthIndex = currentMonthIndex === 0 ? 0 : currentMonthIndex - 1;

                      const ytdMonths = months.slice(0, lastMonthIndex + 1);
                      let totalYtdMaintRevenue = 0;
                      let totalYtdMaintLaborCost = 0;
                      let totalYtdOnsiteRevenue = 0;
                      let totalYtdOnsiteLaborCost = 0;

                      const branchesToSum = isPhoenixView ? branches.filter(isPhoenixBranch) : operationalBranches;
                      branchesToSum.forEach(branch => {
                        const branchForecasts = allBranchForecasts[branch.id] || [];
                        ytdMonths.forEach(month => {
                          const forecast = branchForecasts.find(f => f.month === month);
                          if (forecast) {
                            totalYtdMaintRevenue += parseFloat(forecast.forecast_revenue) || 0;
                            totalYtdMaintLaborCost += parseFloat(forecast.actual_labor_cost) || 0;
                            totalYtdOnsiteRevenue += parseFloat(forecast.onsite_revenue) || 0;
                            totalYtdOnsiteLaborCost += parseFloat(forecast.onsite_actual_labor_cost) || 0;
                          }
                        });
                      });

                      const totalYtdRevenue = totalYtdMaintRevenue + totalYtdOnsiteRevenue;
                      const totalYtdLaborCost = totalYtdMaintLaborCost + totalYtdOnsiteLaborCost;

                      if (totalYtdRevenue === 0) return '\u2014';
                      const totalYtdDL = (totalYtdLaborCost / totalYtdRevenue) * 100;

                      // Calculate combined DL target
                      const maintLaborTarget = totalYtdMaintRevenue * 0.40;
                      const onsiteLaborTarget = totalYtdOnsiteRevenue * 0.55;
                      const totalYtdDLTarget = ((maintLaborTarget + onsiteLaborTarget) / totalYtdRevenue) * 100;

                      return (
                        <span className={`${totalYtdDL > totalYtdDLTarget ? 'text-red-600' : 'text-green-600'}`}>
                          {formatNumber(totalYtdDL, 1)}%
                          <span className="text-gray-700 font-normal text-xs"> / {formatNumber(totalYtdDLTarget, 1)}%</span>
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {(() => {
                      const now = new Date();
                      const currentMonthIndex = now.getMonth();
                      const lastMonthIndex = currentMonthIndex === 0 ? 0 : currentMonthIndex - 1;

                      const lastMonth = months[lastMonthIndex];
                      let totalActualHC = 0;

                      const branchesToSum = isPhoenixView ? branches.filter(isPhoenixBranch) : operationalBranches;
                      branchesToSum.forEach(branch => {
                        const branchForecasts = allBranchForecasts[branch.id] || [];
                        const forecast = branchForecasts.find(f => f.month === lastMonth);
                        if (forecast) {
                          totalActualHC += parseFloat(forecast.actual_ftes) || 0;
                        }
                      });

                      return totalActualHC > 0 ? totalActualHC : '\u2014';
                    })()}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {(() => {
                      const now = new Date();
                      const currentMonthIndex = now.getMonth();
                      const lastMonthIndex = currentMonthIndex === 0 ? 0 : currentMonthIndex - 1;

                      const lastMonth = months[lastMonthIndex];
                      let totalTargetFTEs = 0;

                      const branchesToSum = isPhoenixView ? branches.filter(isPhoenixBranch) : operationalBranches;
                      branchesToSum.forEach(branch => {
                        const branchForecasts = allBranchForecasts[branch.id] || [];
                        const branchHourlyRate = getHourlyRateByBranch(branch);
                        const forecast = branchForecasts.find(f => f.month === lastMonth);
                        if (forecast) {
                          const revenue = parseFloat(forecast.forecast_revenue) || 0;
                          if (revenue > 0) {
                            const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                            const laborHours = laborBudget / branchHourlyRate;
                            totalTargetFTEs += Math.floor(laborHours / HOURS_PER_MONTH);
                          }
                        }
                      });

                      return totalTargetFTEs > 0 ? totalTargetFTEs : '\u2014';
                    })()}
                  </td>
                  <td className="py-2 px-3 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        )}

        {/* P&L Section — individual branches */}
        {!isCombinedView && (
          <PnlSection
            branchId={selectedBranchId}
            branchName={selectedBranch?.name}
            year={selectedYear}
            department={selectedDepartment}
            onDepartmentChange={setSelectedDepartment}
            departmentOptions={[
              { value: 'maintenance', label: 'Maintenance' },
              { value: 'maintenance_onsite', label: 'Maintenance Onsite' },
              { value: 'maintenance_wo', label: 'Maintenance WO' },
              { value: 'all_maintenance', label: 'All Maintenance' }
            ]}
            scheduledHC={scheduledHC}
            onVersionStateChange={(state) => setPnlVersionName(state.versionName)}
          />
        )}

        {/* P&L Section — Phoenix region-level (Arbor, Enhancement, Spray) */}
        {isPhoenixView && phoenixBranchId && (
          <PnlSection
            branchId={phoenixBranchId}
            branchName={['Corporate', 'Phoenix']}
            year={selectedYear}
            department={phoenixPnlDepartment}
            onDepartmentChange={setPhoenixPnlDepartment}
            departmentOptions={[
              { value: 'arbor', label: 'Arbor' },
              { value: 'enhancements', label: 'Enhancements' },
              { value: 'spray', label: 'Spray' }
            ]}
          />
        )}
      </div>
    </div>
  );
}
