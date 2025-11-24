"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  useBranches, 
  useRevenueForecasts,
  useAllBranchForecasts,
  batchUpsertForecasts 
} from '../hooks/useSupabase';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

export default function ForecastPage() {
  const router = useRouter();
  const supabase = createClientComponentClient();
  
  // Constants matching your existing calculator
  const GROSS_MARGIN_TARGET = 0.60;
  const HOURS_PER_MONTH = 173.33; // ~40 hrs/week * 4.333 weeks
  const DEFAULT_HOURLY_RATE = 25.81;
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // State
  const [session, setSession] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedYear, setSelectedYear] = useState(2026);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  
  // Local state for form inputs
  const [monthlyRevenue, setMonthlyRevenue] = useState(
    months.reduce((acc, month) => ({ ...acc, [month]: '' }), {})
  );
  const [actualFtes, setActualFtes] = useState(
    months.reduce((acc, month) => ({ ...acc, [month]: '' }), {})
  );
  const [actualLaborCost, setActualLaborCost] = useState(
    months.reduce((acc, month) => ({ ...acc, [month]: '' }), {})
  );
  const [weeksInMonth, setWeeksInMonth] = useState(
    months.reduce((acc, month) => ({ ...acc, [month]: '4.33' }), {})
  );
  const [actualHours, setActualHours] = useState(
    months.reduce((acc, month) => ({ ...acc, [month]: '' }), {})
  );
  const [isNormalized, setIsNormalized] = useState(true);
  
  // Fetch data
  const { branches, loading: branchesLoading } = useBranches();
  const { forecasts, loading: forecastsLoading, refetchForecasts } = useRevenueForecasts(selectedBranchId, selectedYear);
  const { forecasts: allBranchForecasts, loading: allForecastsLoading } = useAllBranchForecasts(selectedYear);
  
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
  
  // Load forecasts into form when they change
  useEffect(() => {
    if (forecasts && forecasts.length > 0) {
      const revenueData = {};
      const ftesData = {};
      const laborCostData = {};
      const weeksData = {};
      const hoursData = {};
      
      months.forEach(month => {
        const forecast = forecasts.find(f => f.month === month);
        if (forecast) {
          revenueData[month] = forecast.forecast_revenue ? 
            Number(forecast.forecast_revenue).toLocaleString('en-US') : '';
          ftesData[month] = forecast.actual_ftes ? 
            String(forecast.actual_ftes) : '';
          laborCostData[month] = forecast.actual_labor_cost ? 
            Number(forecast.actual_labor_cost).toLocaleString('en-US') : '';
          weeksData[month] = forecast.weeks_in_month ? 
            String(forecast.weeks_in_month) : '4.33';
          hoursData[month] = forecast.actual_hours ? 
            Number(forecast.actual_hours).toLocaleString('en-US') : '';
        } else {
          revenueData[month] = '';
          ftesData[month] = '';
          laborCostData[month] = '';
          weeksData[month] = '4.33';
          hoursData[month] = '';
        }
      });
      
      setMonthlyRevenue(revenueData);
      setActualFtes(ftesData);
      setActualLaborCost(laborCostData);
      setWeeksInMonth(weeksData);
      setActualHours(hoursData);
    } else {
      // Clear form if no forecasts
      setMonthlyRevenue(months.reduce((acc, month) => ({ ...acc, [month]: '' }), {}));
      setActualFtes(months.reduce((acc, month) => ({ ...acc, [month]: '' }), {}));
      setActualLaborCost(months.reduce((acc, month) => ({ ...acc, [month]: '' }), {}));
      setWeeksInMonth(months.reduce((acc, month) => ({ ...acc, [month]: '4.33' }), {}));
      setActualHours(months.reduce((acc, month) => ({ ...acc, [month]: '' }), {}));
    }
  }, [forecasts]);

  // Handlers
  const handleRevenueChange = (month, value) => {
    const numericValue = value.replace(/[^0-9.]/g, '');
    const formatted = numericValue ? Number(numericValue).toLocaleString('en-US') : '';
    setMonthlyRevenue(prev => ({ ...prev, [month]: formatted }));
  };

  const handleActualFtesChange = (month, value) => {
    const numericValue = value.replace(/[^0-9.]/g, '');
    setActualFtes(prev => ({ ...prev, [month]: numericValue }));
  };

  const handleActualLaborCostChange = (month, value) => {
    const numericValue = value.replace(/[^0-9.]/g, '');
    const formatted = numericValue ? Number(numericValue).toLocaleString('en-US') : '';
    setActualLaborCost(prev => ({ ...prev, [month]: formatted }));
  };

  const handleWeeksInMonthChange = (month, value) => {
    const numericValue = value.replace(/[^0-9.]/g, '');
    setWeeksInMonth(prev => ({ ...prev, [month]: numericValue }));
  };

  const handleActualHoursChange = (month, value) => {
    const numericValue = value.replace(/[^0-9.]/g, '');
    const formatted = numericValue ? Number(numericValue).toLocaleString('en-US') : '';
    setActualHours(prev => ({ ...prev, [month]: formatted }));
  };

  const parseRevenue = (value) => {
    return parseFloat(String(value).replace(/,/g, '')) || 0;
  };

  // Check if Encore (company-wide) view is selected
  const isEncoreView = selectedBranchId === 'encore';

  // Get selected branch and its hourly rate
  const selectedBranch = isEncoreView 
    ? { name: 'Encore (All Branches)', color: '#374151' }
    : branches.find(b => b.id === selectedBranchId) || {};
  const hourlyRate = isEncoreView ? DEFAULT_HOURLY_RATE : (selectedBranch.hourly_rate || DEFAULT_HOURLY_RATE);

  // Calculate Encore (combined) data from all branches
  const encoreData = isEncoreView ? months.reduce((acc, month) => {
    let monthRevenue = 0;
    let monthLaborCost = 0;
    let monthActualHours = 0;
    let monthActualFtes = 0;
    let monthWeeks = 4.33;
    
    branches.forEach(branch => {
      const branchForecasts = allBranchForecasts[branch.id] || [];
      const forecast = branchForecasts.find(f => f.month === month);
      if (forecast) {
        monthRevenue += parseFloat(forecast.forecast_revenue) || 0;
        monthLaborCost += parseFloat(forecast.actual_labor_cost) || 0;
        monthActualHours += parseFloat(forecast.actual_hours) || 0;
        monthActualFtes += parseFloat(forecast.actual_ftes) || 0;
        // Use weeks from first branch that has it (they should all be the same)
        if (forecast.weeks_in_month) {
          monthWeeks = parseFloat(forecast.weeks_in_month);
        }
      }
    });
    
    acc[month] = {
      revenue: monthRevenue,
      laborCost: monthLaborCost,
      actualHours: monthActualHours,
      actualFtes: monthActualFtes,
      weeks: monthWeeks
    };
    return acc;
  }, {}) : null;

  const calculateMetrics = (revenue) => {
    const rev = parseRevenue(revenue);
    const laborBudget = rev * (1 - GROSS_MARGIN_TARGET);
    const laborHours = laborBudget / hourlyRate;
    const ftes = Math.floor(laborHours / HOURS_PER_MONTH);
    
    return { revenue: rev, laborBudget, laborHours, ftes };
  };

  const calculateActualDL = (revenue, ftes, weeks = 4.33) => {
    const rev = parseRevenue(revenue);
    const actualFteCount = parseFloat(ftes) || 0;
    if (rev === 0) return null;
    // Real: scale by weeks, Normalized: use base 4.33 weeks
    const hoursMultiplier = isNormalized ? HOURS_PER_MONTH : (HOURS_PER_MONTH / 4.33) * weeks;
    const actualLaborCost = actualFteCount * hoursMultiplier * hourlyRate;
    return (actualLaborCost / rev) * 100;
  };

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

  // Save handler
  const handleSave = async () => {
    if (!selectedBranchId) return;
    
    setIsSaving(true);
    setSaveMessage(null);
    
    try {
      const monthlyData = {};
      months.forEach(month => {
        monthlyData[month] = {
          revenue: parseRevenue(monthlyRevenue[month]),
          actualFtes: parseFloat(actualFtes[month]) || null,
          actualLaborCost: parseRevenue(actualLaborCost[month]) || null,
          weeksInMonth: parseFloat(weeksInMonth[month]) || 4.33,
          actualHours: parseFloat(String(actualHours[month]).replace(/,/g, '')) || null
        };
      });
      
      const result = await batchUpsertForecasts(selectedBranchId, selectedYear, monthlyData);
      
      if (result.success) {
        setSaveMessage({ type: 'success', text: 'Forecast saved successfully!' });
        refetchForecasts();
      } else {
        setSaveMessage({ type: 'error', text: result.error || 'Failed to save forecast' });
      }
    } catch (error) {
      setSaveMessage({ type: 'error', text: error.message });
    } finally {
      setIsSaving(false);
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  // Calculate totals for current branch (or use company totals for Encore)
  const branchTotals = months.reduce((acc, month) => {
    const metrics = calculateMetrics(monthlyRevenue[month]);
    return {
      revenue: acc.revenue + metrics.revenue,
      laborBudget: acc.laborBudget + metrics.laborBudget,
      laborHours: acc.laborHours + metrics.laborHours
    };
  }, { revenue: 0, laborBudget: 0, laborHours: 0 });

  // Calculate company-wide totals from all branches
  const companyTotals = branches.reduce((acc, branch) => {
    const branchForecasts = allBranchForecasts[branch.id] || [];
    const branchRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.forecast_revenue) || 0), 0);
    const branchHourlyRate = branch.hourly_rate || DEFAULT_HOURLY_RATE;
    const branchLaborBudget = branchRevenue * (1 - GROSS_MARGIN_TARGET);
    const branchLaborHours = branchLaborBudget / branchHourlyRate;
    return {
      revenue: acc.revenue + branchRevenue,
      laborBudget: acc.laborBudget + branchLaborBudget,
      laborHours: acc.laborHours + branchLaborHours
    };
  }, { revenue: 0, laborBudget: 0, laborHours: 0 });

  // Use company totals when in Encore mode, otherwise use branch totals
  const totals = isEncoreView ? companyTotals : branchTotals;

  const avgFtes = Math.floor(totals.laborHours / HOURS_PER_MONTH / 12);

  // Year options
  const currentYear = new Date().getFullYear();
  const yearOptions = [2025, 2026, 2027];

  // Loading state
  if (branchesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-blue-100">
        <div className="p-8 bg-white shadow-lg rounded-lg">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 border-t-4 border-b-4 border-blue-500 rounded-full animate-spin"></div>
            <p className="text-lg font-semibold text-gray-700">Loading...</p>
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
            
            <div className="flex space-x-3">
              <Link 
                href="/" 
                className="px-2 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Back to Calculator</span>
              </Link>
              
              <Link 
                href="/schedule" 
                className="px-2 py-1.5 bg-white text-indigo-700 border-2 border-indigo-600 rounded-lg hover:bg-indigo-50 transition-colors shadow-sm font-medium flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
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
                {branches.map(branch => (
                  <button
                    key={branch.id}
                    onClick={() => setSelectedBranchId(branch.id)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      selectedBranchId === branch.id
                        ? 'text-white shadow-md'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    style={{
                      backgroundColor: selectedBranchId === branch.id ? (branch.color || '#4F46E5') : undefined
                    }}
                  >
                    {branch.name}
                  </button>
                ))}
                <button
                  onClick={() => setSelectedBranchId('encore')}
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    selectedBranchId === 'encore'
                      ? 'bg-gray-800 text-white shadow-md'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Encore
                </button>
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
            
            <button
              onClick={handleSave}
              disabled={isSaving || !selectedBranchId || selectedBranchId === 'encore'}
              className={`ml-auto px-6 py-2 rounded-lg font-medium shadow-sm transition-colors flex items-center space-x-2 ${
                isSaving || selectedBranchId === 'encore'
                  ? 'bg-gray-400 text-white cursor-not-allowed' 
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isSaving ? (
                <>
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293zM9 4a1 1 0 012 0v2H9V4z" />
                  </svg>
                  <span>Save Forecast</span>
                </>
              )}
            </button>
          </div>
          
          {/* Save Message */}
          {saveMessage && (
            <div className={`p-3 rounded-lg mb-4 ${
              saveMessage.type === 'success' 
                ? 'bg-green-50 text-green-700 border border-green-200' 
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {saveMessage.text}
            </div>
          )}
          
          {/* Company-Wide Summary */}
          <div className="bg-gradient-to-r from-gray-800 to-gray-700 rounded-lg p-4 mb-4 text-white">
            <div className="text-sm text-gray-300 mb-1">Company-Wide Annual Totals ({selectedYear})</div>
            <div className="flex flex-wrap gap-6">
              <div>
                <span className="text-gray-400 text-sm">Total Revenue:</span>
                <span className="ml-2 font-bold text-lg">{formatCurrency(companyTotals.revenue)}</span>
              </div>
              <div>
                <span className="text-gray-400 text-sm">Total Labor Budget:</span>
                <span className="ml-2 font-bold text-lg">{formatCurrency(companyTotals.laborBudget)}</span>
              </div>
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
          
          {/* Normalized Toggle */}
          <div className="flex items-center gap-3">
            <span className={`text-sm font-medium ${!isNormalized ? 'text-gray-800' : 'text-gray-400'}`}>Real</span>
            <button
              onClick={() => setIsNormalized(!isNormalized)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                isNormalized ? 'bg-blue-600' : 'bg-gray-300'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                  isNormalized ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
            <span className={`text-sm font-medium ${isNormalized ? 'text-gray-800' : 'text-gray-400'}`}>Normalized</span>
            <span className="text-xs text-gray-500">(4.33 weeks)</span>
          </div>
        </div>

        {/* Main Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-800 text-white text-sm">
                <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-gray-800 z-10">Metric</th>
                {months.map(month => (
                  <th key={month} className="px-2 py-2 text-center font-semibold min-w-20">
                    {month}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-semibold bg-gray-700 min-w-24">Total</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {/* Revenue Input Row */}
              <tr className="bg-green-50 border-b border-green-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-green-50 z-10">
                  Monthly Revenue
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    {isEncoreView ? (
                      <div className="text-center text-green-700 font-medium">
                        {formatCurrency(encoreData[month]?.revenue || 0)}
                      </div>
                    ) : (
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                        <input
                          type="text"
                          value={monthlyRevenue[month]}
                          onChange={(e) => handleRevenueChange(month, e.target.value)}
                          placeholder="0"
                          className="w-full pl-5 pr-1 py-1.5 border border-gray-300 rounded text-right text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500 outline-none bg-white"
                        />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-green-700 bg-green-100">
                  {isEncoreView 
                    ? formatCurrency(months.reduce((sum, m) => sum + (encoreData[m]?.revenue || 0), 0))
                    : formatCurrency(totals.revenue)
                  }
                </td>
              </tr>

              {/* Weeks in Month Row */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className="px-2 py-1.5 text-xs text-gray-600 sticky left-0 bg-gray-50 z-10">
                  Pay Weeks
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1">
                    {isEncoreView ? (
                      <div className="text-center text-xs text-gray-600">
                        {encoreData[month]?.weeks || 4.33}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={weeksInMonth[month]}
                        onChange={(e) => handleWeeksInMonthChange(month, e.target.value)}
                        placeholder="4.33"
                        className="w-full px-1 py-1 border border-gray-300 rounded text-center text-xs focus:ring-2 focus:ring-gray-400 focus:border-gray-400 outline-none bg-white"
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 py-1.5 text-center text-xs text-gray-500 bg-gray-100">
                  —
                </td>
              </tr>

              {/* Labor Target Row */}
              <tr className="bg-blue-50 border-b border-blue-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-blue-50 z-10">
                  Labor Target (40%)
                </td>
                {months.map(month => {
                  const revenue = isEncoreView 
                    ? (encoreData[month]?.revenue || 0)
                    : parseRevenue(monthlyRevenue[month]);
                  const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                  return (
                    <td key={month} className="px-2 py-2 text-center text-blue-700">
                      {revenue > 0 ? formatCurrency(laborBudget) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-center font-semibold text-blue-700 bg-blue-100">
                  {formatCurrency(totals.laborBudget)}
                </td>
              </tr>

              {/* Actual Labor Cost Input Row */}
              <tr className="bg-sky-50 border-b border-sky-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-sky-50 z-10">
                  Actual Labor Cost
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    {isEncoreView ? (
                      <div className="text-center text-sky-700 font-medium">
                        {formatCurrency(encoreData[month]?.laborCost || 0)}
                      </div>
                    ) : (
                      <div className="relative">
                        <span className="absolute left-1.5 top-1/2 -translate-y-1/2 text-gray-500 text-sm">$</span>
                        <input
                          type="text"
                          value={actualLaborCost[month]}
                          onChange={(e) => handleActualLaborCostChange(month, e.target.value)}
                          placeholder="0"
                          className="w-full pl-5 pr-1 py-1.5 border border-gray-300 rounded text-right text-sm focus:ring-2 focus:ring-sky-500 focus:border-sky-500 outline-none bg-white"
                        />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-sky-700 bg-sky-100">
                  {isEncoreView
                    ? formatCurrency(months.reduce((sum, m) => sum + (encoreData[m]?.laborCost || 0), 0))
                    : formatCurrency(months.reduce((sum, month) => sum + parseRevenue(actualLaborCost[month]), 0))
                  }
                </td>
              </tr>

              {/* Actual Labor Cost DL % Row */}
              <tr className="bg-sky-50/50 border-b border-sky-100">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-sky-50/50 z-10">
                  Actual DL %{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const rev = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const cost = isEncoreView ? (encoreData[month]?.laborCost || 0) : parseRevenue(actualLaborCost[month]);
                  const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  // Normalized: (cost / weeks) * 4.33, Real: actual cost
                  const displayCost = isNormalized && weeks > 0 ? (cost / weeks) * 4.33 : cost;
                  const dlPercent = rev > 0 && cost > 0 ? (displayCost / rev) * 100 : null;
                  return (
                    <td key={month} className="px-2 py-1.5 text-center">
                      {dlPercent !== null ? (
                        <span className={`text-xs font-medium ${dlPercent > 40 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatNumber(dlPercent, 1)}%
                        </span>
                      ) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center bg-sky-100/50">
                  {(() => {
                    const totalRev = totals.revenue;
                    const totalCost = months.reduce((sum, month) => {
                      const cost = isEncoreView ? (encoreData[month]?.laborCost || 0) : parseRevenue(actualLaborCost[month]);
                      const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                      const displayCost = isNormalized && weeks > 0 ? (cost / weeks) * 4.33 : cost;
                      return sum + displayCost;
                    }, 0);
                    if (totalRev === 0 || totalCost === 0) return '—';
                    const avgDL = (totalCost / totalRev) * 100;
                    return (
                      <span className={`text-xs font-medium ${avgDL > 40 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatNumber(avgDL, 1)}%
                      </span>
                    );
                  })()}
                </td>
              </tr>

              {/* FTEs Row */}
              <tr className="bg-orange-50 border-b border-orange-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-orange-50 z-10">
                  FTEs Required{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const revenue = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                  const laborHours = laborBudget / (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate);
                  const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  // Normalized: base hours (standard 4.33 weeks), Real: scale UP by actual weeks
                  const displayHours = isNormalized 
                    ? laborHours 
                    : (laborHours / 4.33) * weeks;
                  const displayFtes = Math.floor(displayHours / HOURS_PER_MONTH);
                  return (
                    <td key={month} className="px-2 py-2 text-center">
                      {revenue > 0 ? (
                        <span className="inline-block bg-orange-200 text-orange-800 font-bold px-2 py-0.5 rounded-full text-sm">
                          {displayFtes}
                        </span>
                      ) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-center bg-orange-100">
                  <div className="text-xs text-gray-500">Avg</div>
                  <span className="inline-block bg-orange-300 text-orange-900 font-bold px-2 py-0.5 rounded-full text-sm">
                    {(() => {
                      const totalHours = months.reduce((sum, month) => {
                        const revenue = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                        const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                        const laborHours = laborBudget / (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate);
                        const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                        return sum + (isNormalized ? laborHours : (laborHours / 4.33) * weeks);
                      }, 0);
                      return Math.floor(totalHours / HOURS_PER_MONTH / 12);
                    })()}
                  </span>
                </td>
              </tr>

              {/* Labor Hours Est Row */}
              <tr className="bg-orange-50/50 border-b border-orange-100">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-orange-50/50 z-10">
                  Labor Hours Est{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const revenue = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                  const laborHours = laborBudget / (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate);
                  const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  // Normalized: base hours (standard 4.33 weeks), Real: scale UP by actual weeks
                  const displayHours = isNormalized 
                    ? laborHours 
                    : (laborHours / 4.33) * weeks;
                  return (
                    <td key={month} className="px-2 py-1.5 text-center text-xs text-gray-600">
                      {revenue > 0 ? formatNumber(displayHours, 0) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-xs text-gray-600 bg-orange-100/50">
                  {formatNumber(months.reduce((sum, month) => {
                    const revenue = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                    const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                    const laborHours = laborBudget / (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate);
                    const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                    return sum + (isNormalized ? laborHours : (laborHours / 4.33) * weeks);
                  }, 0), 0)}
                </td>
              </tr>

              {/* Target DL % Row */}
              <tr className="bg-orange-50/50 border-b border-orange-100">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-orange-50/50 z-10">
                  Target DL %
                </td>
                {months.map(month => {
                  const revenue = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  return (
                    <td key={month} className="px-2 py-1.5 text-center text-xs text-gray-500">
                      {revenue > 0 ? '40.0%' : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-xs text-gray-500 bg-orange-100/50">
                  40.0%
                </td>
              </tr>

              {/* Actual Hours Input Row */}
              <tr className="bg-red-50 border-b border-red-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-red-50 z-10">
                  Actual Hours
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    {isEncoreView ? (
                      <div className="text-center text-red-700 font-medium">
                        {formatNumber(encoreData[month]?.actualHours || 0, 0)}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={actualHours[month]}
                        onChange={(e) => handleActualHoursChange(month, e.target.value)}
                        placeholder="0"
                        className="w-full px-1 py-1.5 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none bg-white"
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-red-700 bg-red-100">
                  {isEncoreView
                    ? formatNumber(months.reduce((sum, m) => sum + (encoreData[m]?.actualHours || 0), 0), 0)
                    : formatNumber(months.reduce((sum, month) => sum + (parseFloat(String(actualHours[month]).replace(/,/g, '')) || 0), 0), 0)
                  }
                </td>
              </tr>

              {/* Actual FTEs Row (calculated from Actual Hours) */}
              <tr className="bg-red-50/50 border-b border-red-100">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-red-50/50 z-10">
                  Actual FTEs{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const hours = isEncoreView ? (encoreData[month]?.actualHours || 0) : (parseFloat(String(actualHours[month]).replace(/,/g, '')) || 0);
                  const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  if (hours <= 0 || weeks <= 0) {
                    return (
                      <td key={month} className="px-2 py-1.5 text-center text-xs text-red-600">
                        —
                      </td>
                    );
                  }
                  // Normalized: (hours / weeks) * 4.33, Real: actual hours
                  const displayHours = isNormalized ? (hours / weeks) * 4.33 : hours;
                  const rawFtes = displayHours / HOURS_PER_MONTH;
                  const decimal = rawFtes % 1;
                  // Round up if decimal > 0.1, otherwise floor
                  const displayFtes = decimal > 0.1 ? Math.ceil(rawFtes) : Math.floor(rawFtes);
                  return (
                    <td key={month} className="px-2 py-1.5 text-center text-xs text-red-600">
                      {displayFtes}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-xs text-red-600 bg-red-100/50">
                  {(() => {
                    let totalFtes = 0;
                    let monthsWithData = 0;
                    months.forEach(month => {
                      const hours = isEncoreView ? (encoreData[month]?.actualHours || 0) : (parseFloat(String(actualHours[month]).replace(/,/g, '')) || 0);
                      const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                      if (hours > 0 && weeks > 0) {
                        const displayHours = isNormalized ? (hours / weeks) * 4.33 : hours;
                        const rawFtes = displayHours / HOURS_PER_MONTH;
                        const decimal = rawFtes % 1;
                        totalFtes += decimal > 0.1 ? Math.ceil(rawFtes) : Math.floor(rawFtes);
                        monthsWithData++;
                      }
                    });
                    if (monthsWithData === 0) return '—';
                    const avgFtes = totalFtes / monthsWithData;
                    const decimal = avgFtes % 1;
                    return decimal > 0.1 ? Math.ceil(avgFtes) : Math.floor(avgFtes);
                  })()}
                </td>
              </tr>

              {/* Actual HC Input Row */}
              <tr className="bg-teal-50 border-b border-teal-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-teal-50 z-10">
                  Actual HC
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    {isEncoreView ? (
                      <div className="text-center text-teal-700 font-medium">
                        {encoreData[month]?.actualFtes || '—'}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={actualFtes[month]}
                        onChange={(e) => handleActualFtesChange(month, e.target.value)}
                        placeholder="0"
                        className="w-full px-1 py-1.5 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white"
                      />
                    )}
                  </td>
                ))}
                <td className="px-2 py-2 text-center bg-teal-100">
                  <div className="text-xs text-gray-500">Avg</div>
                  <span className="font-semibold text-teal-700">
                    {isEncoreView
                      ? formatNumber(
                          months.reduce((sum, m) => sum + (encoreData[m]?.actualFtes || 0), 0) / 
                          (months.filter(m => (encoreData[m]?.actualFtes || 0) > 0).length || 1),
                          2
                        )
                      : formatNumber(
                          months.reduce((sum, m) => sum + (parseFloat(actualFtes[m]) || 0), 0) / 
                          (months.filter(m => parseFloat(actualFtes[m]) > 0).length || 1),
                          2
                        )
                    }
                  </span>
                </td>
              </tr>

              {/* Actual DL % Row (based on HC) */}
              <tr className="bg-teal-50/50">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-teal-50/50 z-10">
                  Actual DL %{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const rev = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const ftes = isEncoreView ? (encoreData[month]?.actualFtes || 0) : (parseFloat(actualFtes[month]) || 0);
                  const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  if (rev === 0 || ftes === 0) {
                    return (
                      <td key={month} className="px-2 py-1.5 text-center">—</td>
                    );
                  }
                  const hoursMultiplier = isNormalized ? HOURS_PER_MONTH : (HOURS_PER_MONTH / 4.33) * weeks;
                  const actualLaborCostCalc = ftes * hoursMultiplier * (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate);
                  const actualDL = (actualLaborCostCalc / rev) * 100;
                  return (
                    <td key={month} className="px-2 py-1.5 text-center">
                      <span className={`text-xs font-medium ${actualDL > 40 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatNumber(actualDL, 1)}%
                      </span>
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center bg-teal-100/50">
                  {(() => {
                    const totalRev = totals.revenue;
                    const totalActualFtes = isEncoreView 
                      ? months.reduce((sum, m) => sum + (encoreData[m]?.actualFtes || 0), 0)
                      : months.reduce((sum, m) => sum + (parseFloat(actualFtes[m]) || 0), 0);
                    const monthsWithFtes = isEncoreView
                      ? months.filter(m => (encoreData[m]?.actualFtes || 0) > 0).length
                      : months.filter(m => parseFloat(actualFtes[m]) > 0).length;
                    const avgActualFtes = monthsWithFtes > 0 ? totalActualFtes / monthsWithFtes : 0;
                    const monthsWithRev = isEncoreView
                      ? months.filter(m => (encoreData[m]?.revenue || 0) > 0).length
                      : months.filter(m => parseRevenue(monthlyRevenue[m]) > 0).length;
                    const avgRev = monthsWithRev > 0 ? totalRev / monthsWithRev : 0;
                    if (avgRev === 0 || avgActualFtes === 0) return '—';
                    // For total, calculate weighted average of weeks
                    const avgWeeks = months.reduce((sum, m) => {
                      const weeks = isEncoreView ? (encoreData[m]?.weeks || 4.33) : (parseFloat(weeksInMonth[m]) || 4.33);
                      return sum + weeks;
                    }, 0) / 12;
                    const hoursMultiplier = isNormalized ? HOURS_PER_MONTH : (HOURS_PER_MONTH / 4.33) * avgWeeks;
                    const avgDL = (avgActualFtes * hoursMultiplier * (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate) / avgRev) * 100;
                    return (
                      <span className={`text-xs font-medium ${avgDL > 40 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatNumber(avgDL, 1)}%
                      </span>
                    );
                  })()}
                </td>
              </tr>

              {/* Maint Crews Row */}
              <tr className="bg-gray-100 border-b border-gray-200">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-gray-100 z-10">
                  <div className="flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-4 4v-4m-6 8h12a2 2 0 002-2V7a2 2 0 00-2-2h-3l-1-2H10L9 5H6a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>Maint Crews (4m){isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}</span>
                  </div>
                </td>
                {months.map((month, index) => {
                  const revenue = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                  const laborHours = laborBudget / (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate);
                  const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  const displayHours = isNormalized 
                    ? laborHours 
                    : (laborHours / 4.33) * weeks;
                  const displayFtes = Math.floor(displayHours / HOURS_PER_MONTH);
                  const crews = displayFtes > 0 ? Math.ceil(displayFtes / 4) : null;
                  
                  // Calculate prior month's crews
                  let priorCrews = null;
                  if (index > 0) {
                    const priorMonth = months[index - 1];
                    const priorRevenue = isEncoreView ? (encoreData[priorMonth]?.revenue || 0) : parseRevenue(monthlyRevenue[priorMonth]);
                    const priorLaborBudget = priorRevenue * (1 - GROSS_MARGIN_TARGET);
                    const priorLaborHours = priorLaborBudget / (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate);
                    const priorWeeks = isEncoreView ? (encoreData[priorMonth]?.weeks || 4.33) : (parseFloat(weeksInMonth[priorMonth]) || 4.33);
                    const priorDisplayHours = isNormalized 
                      ? priorLaborHours 
                      : (priorLaborHours / 4.33) * priorWeeks;
                    const priorDisplayFtes = Math.floor(priorDisplayHours / HOURS_PER_MONTH);
                    priorCrews = priorDisplayFtes > 0 ? Math.ceil(priorDisplayFtes / 4) : null;
                  }
                  
                  const hasJump = crews !== null && priorCrews !== null && crews !== priorCrews;
                  
                  return (
                    <td key={month} className={`px-2 py-1.5 text-center text-xs ${hasJump ? 'bg-yellow-200 text-yellow-800 font-semibold' : 'text-gray-600'}`}>
                      {crews !== null ? crews : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-xs text-gray-600 bg-gray-200">
                  {(() => {
                    const totalHours = months.reduce((sum, month) => {
                      const revenue = isEncoreView ? (encoreData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                      const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                      const laborHours = laborBudget / (isEncoreView ? DEFAULT_HOURLY_RATE : hourlyRate);
                      const weeks = isEncoreView ? (encoreData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                      return sum + (isNormalized ? laborHours : (laborHours / 4.33) * weeks);
                    }, 0);
                    const avgFtes = Math.floor(totalHours / HOURS_PER_MONTH / 12);
                    return avgFtes > 0 ? Math.ceil(avgFtes / 4) : '—';
                  })()}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Summary Cards */}
        {totals.revenue > 0 && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-green-500 to-green-600 rounded-xl p-5 text-white shadow-lg">
                <div className="text-green-100 text-sm font-medium mb-1">Annual Revenue</div>
                <div className="text-2xl font-bold">{formatCurrency(totals.revenue)}</div>
                <div className="text-green-200 text-xs mt-1">{selectedBranch.name}</div>
              </div>
              <div className="bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl p-5 text-white shadow-lg">
                <div className="text-blue-100 text-sm font-medium mb-1">Annual Labor Cost at Target</div>
                <div className="text-2xl font-bold">{formatCurrency(totals.laborBudget)}</div>
                <div className="text-blue-200 text-xs mt-1">{selectedBranch.name}</div>
              </div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-5 text-white shadow-lg">
                <div className="text-purple-100 text-sm font-medium mb-1">YTD Actual DL %</div>
                <div className="text-2xl font-bold">
                  {(() => {
                    // Get the last completed month (prior month)
                    const now = new Date();
                    const lastCompletedMonthIndex = now.getMonth() - 1; // 0-indexed, -1 for prior month
                    
                    // If we're in January, there's no prior month this year
                    if (lastCompletedMonthIndex < 0) return '—';
                    
                    // Only sum through the last completed month
                    const ytdMonths = months.slice(0, lastCompletedMonthIndex + 1);
                    const totalActualCost = ytdMonths.reduce((sum, month) => sum + parseRevenue(actualLaborCost[month]), 0);
                    const totalRevenue = ytdMonths.reduce((sum, month) => sum + parseRevenue(monthlyRevenue[month]), 0);
                    
                    if (totalRevenue === 0 || totalActualCost === 0) return '—';
                    return formatNumber((totalActualCost / totalRevenue) * 100, 1) + '%';
                  })()}
                </div>
                <div className="text-purple-200 text-xs mt-1">{selectedBranch.name} (thru {months[Math.max(0, new Date().getMonth() - 1)]})</div>
              </div>
              <div className="bg-gradient-to-br from-orange-500 to-orange-600 rounded-xl p-5 text-white shadow-lg">
                <div className="text-orange-100 text-sm font-medium mb-1">Average FTEs/Month</div>
                <div className="text-2xl font-bold">{avgFtes}</div>
                <div className="text-orange-200 text-xs mt-1">{selectedBranch.name}</div>
              </div>
            </div>
          </div>
        )}

        {/* Branch Comparison */}
        <div className="p-6 border-t border-gray-200">
          <h3 className="font-semibold text-gray-800 mb-4">Branch Comparison ({selectedYear})</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200">
                  <th className="text-left py-2 px-3 font-medium text-gray-600">Branch</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Annual Revenue</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Labor Budget</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">YTD Actual DL %</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Actual HC</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Target FTEs</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">% of Company</th>
                </tr>
              </thead>
              <tbody>
                {branches.map(branch => {
                  const branchForecasts = allBranchForecasts[branch.id] || [];
                  const branchRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.forecast_revenue) || 0), 0);
                  const branchHourlyRate = branch.hourly_rate || DEFAULT_HOURLY_RATE;
                  const branchLaborBudget = branchRevenue * (1 - GROSS_MARGIN_TARGET);
                  const branchLaborHours = branchLaborBudget / branchHourlyRate;
                  const branchAvgFtes = Math.floor(branchLaborHours / HOURS_PER_MONTH / 12);
                  const percentOfCompany = companyTotals.revenue > 0 
                    ? (branchRevenue / companyTotals.revenue) * 100 
                    : 0;
                  
                  // Calculate YTD Actual DL % through prior month
                  const now = new Date();
                  const lastCompletedMonthIndex = now.getMonth() - 1;
                  let ytdActualDL = null;
                  let lastMonthActualHC = null;
                  let lastMonthTargetFTEs = null;
                  
                  if (lastCompletedMonthIndex >= 0) {
                    const ytdMonths = months.slice(0, lastCompletedMonthIndex + 1);
                    const lastMonth = months[lastCompletedMonthIndex];
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
                    
                    const ytdRevenue = ytdMonths.reduce((sum, month) => {
                      const forecast = branchForecasts.find(f => f.month === month);
                      return sum + (forecast ? parseFloat(forecast.forecast_revenue) || 0 : 0);
                    }, 0);
                    const ytdLaborCost = ytdMonths.reduce((sum, month) => {
                      const forecast = branchForecasts.find(f => f.month === month);
                      return sum + (forecast ? parseFloat(forecast.actual_labor_cost) || 0 : 0);
                    }, 0);
                    if (ytdRevenue > 0 && ytdLaborCost > 0) {
                      ytdActualDL = (ytdLaborCost / ytdRevenue) * 100;
                    }
                  }
                  
                  return (
                    <tr 
                      key={branch.id} 
                      className={`border-b border-gray-100 ${selectedBranchId === branch.id ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                    >
                      <td className="py-2 px-3 font-medium">
                        <span 
                          className="inline-block w-3 h-3 rounded-full mr-2"
                          style={{ backgroundColor: branch.color || '#4F46E5' }}
                        ></span>
                        {branch.name}
                        {selectedBranchId === branch.id && (
                          <span className="ml-2 text-xs text-blue-600">(editing)</span>
                        )}
                      </td>
                      <td className="py-2 px-3 text-right">{formatCurrency(branchRevenue)}</td>
                      <td className="py-2 px-3 text-right">{formatCurrency(branchLaborBudget)}</td>
                      <td className="py-2 px-3 text-right">
                        {ytdActualDL !== null ? (
                          <span className={`font-medium ${ytdActualDL > 40 ? 'text-red-600' : 'text-green-600'}`}>
                            {formatNumber(ytdActualDL, 1)}%
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2 px-3 text-right">{lastMonthActualHC !== null ? lastMonthActualHC : '—'}</td>
                      <td className="py-2 px-3 text-right">{lastMonthTargetFTEs !== null ? lastMonthTargetFTEs : '—'}</td>
                      <td className="py-2 px-3 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <div className="w-16 bg-gray-200 rounded-full h-2">
                            <div 
                              className="h-2 rounded-full" 
                              style={{ 
                                width: `${Math.min(percentOfCompany, 100)}%`,
                                backgroundColor: branch.color || '#4F46E5'
                              }}
                            />
                          </div>
                          <span className="w-12 text-right">{formatNumber(percentOfCompany, 1)}%</span>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                <tr className="bg-gray-100 font-semibold">
                  <td className="py-2 px-3">Company Total</td>
                  <td className="py-2 px-3 text-right">{formatCurrency(companyTotals.revenue)}</td>
                  <td className="py-2 px-3 text-right">{formatCurrency(companyTotals.laborBudget)}</td>
                  <td className="py-2 px-3 text-right">
                    {(() => {
                      const now = new Date();
                      const lastCompletedMonthIndex = now.getMonth() - 1;
                      if (lastCompletedMonthIndex < 0) return '—';
                      
                      const ytdMonths = months.slice(0, lastCompletedMonthIndex + 1);
                      let totalYtdRevenue = 0;
                      let totalYtdLaborCost = 0;
                      
                      branches.forEach(branch => {
                        const branchForecasts = allBranchForecasts[branch.id] || [];
                        ytdMonths.forEach(month => {
                          const forecast = branchForecasts.find(f => f.month === month);
                          if (forecast) {
                            totalYtdRevenue += parseFloat(forecast.forecast_revenue) || 0;
                            totalYtdLaborCost += parseFloat(forecast.actual_labor_cost) || 0;
                          }
                        });
                      });
                      
                      if (totalYtdRevenue === 0 || totalYtdLaborCost === 0) return '—';
                      const companyYtdDL = (totalYtdLaborCost / totalYtdRevenue) * 100;
                      return (
                        <span className={`${companyYtdDL > 40 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatNumber(companyYtdDL, 1)}%
                        </span>
                      );
                    })()}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {(() => {
                      const now = new Date();
                      const lastCompletedMonthIndex = now.getMonth() - 1;
                      if (lastCompletedMonthIndex < 0) return '—';
                      
                      const lastMonth = months[lastCompletedMonthIndex];
                      let totalActualHC = 0;
                      
                      branches.forEach(branch => {
                        const branchForecasts = allBranchForecasts[branch.id] || [];
                        const forecast = branchForecasts.find(f => f.month === lastMonth);
                        if (forecast) {
                          totalActualHC += parseFloat(forecast.actual_ftes) || 0;
                        }
                      });
                      
                      return totalActualHC > 0 ? totalActualHC : '—';
                    })()}
                  </td>
                  <td className="py-2 px-3 text-right">
                    {(() => {
                      const now = new Date();
                      const lastCompletedMonthIndex = now.getMonth() - 1;
                      if (lastCompletedMonthIndex < 0) return '—';
                      
                      const lastMonth = months[lastCompletedMonthIndex];
                      let totalTargetFTEs = 0;
                      
                      branches.forEach(branch => {
                        const branchForecasts = allBranchForecasts[branch.id] || [];
                        const branchHourlyRate = branch.hourly_rate || DEFAULT_HOURLY_RATE;
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
                      
                      return totalTargetFTEs > 0 ? totalTargetFTEs : '—';
                    })()}
                  </td>
                  <td className="py-2 px-3 text-right">100%</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Formula Reference */}
        <div className="p-6 bg-gray-50 border-t border-gray-200">
          <div className="font-semibold text-gray-700 mb-2">Calculation Reference:</div>
          <div className="text-sm text-gray-600 space-y-1">
            <div><span className="font-medium">Labor Budget</span> = Revenue × 40%</div>
            <div><span className="font-medium">Labor Hours</span> = Labor Budget ÷ ${hourlyRate}/hr (varies by branch)</div>
            <div><span className="font-medium">FTEs</span> = Labor Hours ÷ {HOURS_PER_MONTH} hrs/month</div>
          </div>
        </div>
      </div>
    </div>
  );
}