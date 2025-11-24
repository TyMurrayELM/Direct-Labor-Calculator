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
  const HOURLY_RATE = 25.81;
  const HOURS_PER_MONTH = 173.33; // ~40 hrs/week * 4.333 weeks
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // State
  const [session, setSession] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
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
            String(forecast.actual_hours) : '';
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
    setActualHours(prev => ({ ...prev, [month]: numericValue }));
  };

  const parseRevenue = (value) => {
    return parseFloat(String(value).replace(/,/g, '')) || 0;
  };

  const calculateMetrics = (revenue) => {
    const rev = parseRevenue(revenue);
    const laborBudget = rev * (1 - GROSS_MARGIN_TARGET);
    const laborHours = laborBudget / HOURLY_RATE;
    const ftes = Math.floor(laborHours / HOURS_PER_MONTH);
    
    return { revenue: rev, laborBudget, laborHours, ftes };
  };

  const calculateActualDL = (revenue, ftes) => {
    const rev = parseRevenue(revenue);
    const actualFteCount = parseFloat(ftes) || 0;
    if (rev === 0) return null;
    const actualLaborCost = actualFteCount * HOURS_PER_MONTH * HOURLY_RATE;
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
          actualHours: parseFloat(actualHours[month]) || null
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

  // Calculate totals for current branch
  const totals = months.reduce((acc, month) => {
    const metrics = calculateMetrics(monthlyRevenue[month]);
    return {
      revenue: acc.revenue + metrics.revenue,
      laborBudget: acc.laborBudget + metrics.laborBudget,
      laborHours: acc.laborHours + metrics.laborHours
    };
  }, { revenue: 0, laborBudget: 0, laborHours: 0 });

  const avgFtes = Math.floor(totals.laborHours / HOURS_PER_MONTH / 12);

  // Calculate company-wide totals from all branches
  const companyTotals = branches.reduce((acc, branch) => {
    const branchForecasts = allBranchForecasts[branch.id] || [];
    const branchRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.forecast_revenue) || 0), 0);
    return {
      revenue: acc.revenue + branchRevenue,
      laborBudget: acc.laborBudget + (branchRevenue * (1 - GROSS_MARGIN_TARGET))
    };
  }, { revenue: 0, laborBudget: 0 });

  // Get selected branch
  const selectedBranch = branches.find(b => b.id === selectedBranchId) || {};

  // Year options
  const currentYear = new Date().getFullYear();
  const yearOptions = [currentYear - 1, currentYear, currentYear + 1, currentYear + 2];

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
              disabled={isSaving || !selectedBranchId}
              className={`ml-auto px-6 py-2 rounded-lg font-medium shadow-sm transition-colors flex items-center space-x-2 ${
                isSaving 
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
              <span className="text-purple-600 font-semibold">${HOURLY_RATE}/hr</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Hours/Month:</span>
              <span className="text-orange-600 font-semibold">{HOURS_PER_MONTH}</span>
            </div>
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
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-green-700 bg-green-100">
                  {formatCurrency(totals.revenue)}
                </td>
              </tr>

              {/* Weeks in Month Row */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className="px-2 py-1.5 text-xs text-gray-600 sticky left-0 bg-gray-50 z-10">
                  Pay Weeks
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1">
                    <input
                      type="text"
                      value={weeksInMonth[month]}
                      onChange={(e) => handleWeeksInMonthChange(month, e.target.value)}
                      placeholder="4.33"
                      className="w-full px-1 py-1 border border-gray-300 rounded text-center text-xs focus:ring-2 focus:ring-gray-400 focus:border-gray-400 outline-none bg-white"
                    />
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
                  const metrics = calculateMetrics(monthlyRevenue[month]);
                  const weeks = parseFloat(weeksInMonth[month]) || 4.33;
                  // Scale labor budget by pay weeks: (base budget / 4.33) * actual weeks
                  const adjustedBudget = (metrics.laborBudget / 4.33) * weeks;
                  return (
                    <td key={month} className="px-2 py-2 text-center text-blue-700">
                      {metrics.revenue > 0 ? formatCurrency(adjustedBudget) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-center font-semibold text-blue-700 bg-blue-100">
                  {formatCurrency(months.reduce((sum, month) => {
                    const metrics = calculateMetrics(monthlyRevenue[month]);
                    const weeks = parseFloat(weeksInMonth[month]) || 4.33;
                    return sum + (metrics.laborBudget / 4.33) * weeks;
                  }, 0))}
                </td>
              </tr>

              {/* Actual Labor Cost Input Row */}
              <tr className="bg-sky-50 border-b border-sky-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-sky-50 z-10">
                  Actual Labor Cost
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
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
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-sky-700 bg-sky-100">
                  {formatCurrency(months.reduce((sum, month) => sum + parseRevenue(actualLaborCost[month]), 0))}
                </td>
              </tr>

              {/* Actual Labor Cost DL % Row (Normalized) */}
              <tr className="bg-sky-50/50 border-b border-sky-100">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-sky-50/50 z-10" title="Normalized to 4.33 weeks">
                  Actual DL % (Norm)
                </td>
                {months.map(month => {
                  const rev = parseRevenue(monthlyRevenue[month]);
                  const cost = parseRevenue(actualLaborCost[month]);
                  const weeks = parseFloat(weeksInMonth[month]) || 4.33;
                  // Normalize: (cost / weeks) * 4.33 gives us what cost would be in a standard month
                  const normalizedCost = weeks > 0 ? (cost / weeks) * 4.33 : cost;
                  const dlPercent = rev > 0 && cost > 0 ? (normalizedCost / rev) * 100 : null;
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
                    // Normalize each month's cost before summing
                    const totalNormalizedCost = months.reduce((sum, month) => {
                      const cost = parseRevenue(actualLaborCost[month]);
                      const weeks = parseFloat(weeksInMonth[month]) || 4.33;
                      const normalizedCost = weeks > 0 ? (cost / weeks) * 4.33 : cost;
                      return sum + normalizedCost;
                    }, 0);
                    if (totalRev === 0 || totalNormalizedCost === 0) return '—';
                    const avgDL = (totalNormalizedCost / totalRev) * 100;
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
                  FTEs Required
                </td>
                {months.map(month => {
                  const metrics = calculateMetrics(monthlyRevenue[month]);
                  return (
                    <td key={month} className="px-2 py-2 text-center">
                      {metrics.revenue > 0 ? (
                        <span className="inline-block bg-orange-200 text-orange-800 font-bold px-2 py-0.5 rounded-full text-sm">
                          {metrics.ftes}
                        </span>
                      ) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-2 text-center bg-orange-100">
                  <div className="text-xs text-gray-500">Avg</div>
                  <span className="inline-block bg-orange-300 text-orange-900 font-bold px-2 py-0.5 rounded-full text-sm">
                    {avgFtes}
                  </span>
                </td>
              </tr>

              {/* Labor Hours Est Row */}
              <tr className="bg-orange-50/50 border-b border-orange-100">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-orange-50/50 z-10">
                  Labor Hours Est
                </td>
                {months.map(month => {
                  const metrics = calculateMetrics(monthlyRevenue[month]);
                  return (
                    <td key={month} className="px-2 py-1.5 text-center text-xs text-gray-600">
                      {metrics.revenue > 0 ? formatNumber(metrics.laborHours, 0) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-xs text-gray-600 bg-orange-100/50">
                  {formatNumber(totals.laborHours, 0)}
                </td>
              </tr>

              {/* Target DL % Row */}
              <tr className="bg-orange-50/50 border-b border-orange-100">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-orange-50/50 z-10">
                  Target DL %
                </td>
                {months.map(month => {
                  const metrics = calculateMetrics(monthlyRevenue[month]);
                  return (
                    <td key={month} className="px-2 py-1.5 text-center text-xs text-gray-500">
                      {metrics.revenue > 0 ? '40.0%' : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-xs text-gray-500 bg-orange-100/50">
                  40.0%
                </td>
              </tr>

              {/* Actual Hours Input Row */}
              <tr className="bg-violet-50 border-b border-violet-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-violet-50 z-10">
                  Actual Hours
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    <input
                      type="text"
                      value={actualHours[month]}
                      onChange={(e) => handleActualHoursChange(month, e.target.value)}
                      placeholder="0"
                      className="w-full px-1 py-1.5 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-violet-500 focus:border-violet-500 outline-none bg-white"
                    />
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-violet-700 bg-violet-100">
                  {formatNumber(months.reduce((sum, month) => sum + (parseFloat(actualHours[month]) || 0), 0), 0)}
                </td>
              </tr>

              {/* Actual FTEs Row (calculated from Actual Hours) */}
              <tr className="bg-violet-50/50 border-b border-violet-100">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-violet-50/50 z-10">
                  Actual FTEs
                </td>
                {months.map(month => {
                  const hours = parseFloat(actualHours[month]) || 0;
                  const weeks = parseFloat(weeksInMonth[month]) || 4.33;
                  // Normalize hours to 4.33 weeks, then divide by hours per month
                  const normalizedFtes = hours > 0 && weeks > 0 
                    ? Math.floor((hours / weeks) * 4.33 / HOURS_PER_MONTH)
                    : null;
                  return (
                    <td key={month} className="px-2 py-1.5 text-center text-xs text-violet-600">
                      {normalizedFtes !== null ? normalizedFtes : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-xs text-violet-600 bg-violet-100/50">
                  {(() => {
                    const totalNormalizedFtes = months.reduce((sum, month) => {
                      const hours = parseFloat(actualHours[month]) || 0;
                      const weeks = parseFloat(weeksInMonth[month]) || 4.33;
                      const normalizedFtes = hours > 0 && weeks > 0 ? (hours / weeks) * 4.33 / HOURS_PER_MONTH : 0;
                      return sum + normalizedFtes;
                    }, 0);
                    const monthsWithData = months.filter(m => parseFloat(actualHours[m]) > 0).length;
                    return monthsWithData > 0 ? Math.floor(totalNormalizedFtes / monthsWithData) : '—';
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
                    <input
                      type="text"
                      value={actualFtes[month]}
                      onChange={(e) => handleActualFtesChange(month, e.target.value)}
                      placeholder="0"
                      className="w-full px-1 py-1.5 border border-gray-300 rounded text-center text-sm focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none bg-white"
                    />
                  </td>
                ))}
                <td className="px-2 py-2 text-center bg-teal-100">
                  <div className="text-xs text-gray-500">Avg</div>
                  <span className="font-semibold text-teal-700">
                    {formatNumber(
                      months.reduce((sum, m) => sum + (parseFloat(actualFtes[m]) || 0), 0) / 
                      (months.filter(m => parseFloat(actualFtes[m]) > 0).length || 1),
                      2
                    )}
                  </span>
                </td>
              </tr>

              {/* Actual DL % Row */}
              <tr className="bg-teal-50/50">
                <td className="px-2 py-1.5 text-xs text-gray-500 sticky left-0 bg-teal-50/50 z-10">
                  Actual DL %
                </td>
                {months.map(month => {
                  const actualDL = calculateActualDL(monthlyRevenue[month], actualFtes[month]);
                  return (
                    <td key={month} className="px-2 py-1.5 text-center">
                      {actualDL !== null ? (
                        <span className={`text-xs font-medium ${actualDL > 40 ? 'text-red-600' : 'text-green-600'}`}>
                          {formatNumber(actualDL, 1)}%
                        </span>
                      ) : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center bg-teal-100/50">
                  {(() => {
                    const totalRev = totals.revenue;
                    const totalActualFtes = months.reduce((sum, m) => sum + (parseFloat(actualFtes[m]) || 0), 0);
                    const monthsWithFtes = months.filter(m => parseFloat(actualFtes[m]) > 0).length;
                    const avgActualFtes = monthsWithFtes > 0 ? totalActualFtes / monthsWithFtes : 0;
                    const monthsWithRev = months.filter(m => parseRevenue(monthlyRevenue[m]) > 0).length;
                    const avgRev = monthsWithRev > 0 ? totalRev / monthsWithRev : 0;
                    if (avgRev === 0 || avgActualFtes === 0) return '—';
                    const avgDL = (avgActualFtes * HOURS_PER_MONTH * HOURLY_RATE / avgRev) * 100;
                    return (
                      <span className={`text-xs font-medium ${avgDL > 40 ? 'text-red-600' : 'text-green-600'}`}>
                        {formatNumber(avgDL, 1)}%
                      </span>
                    );
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
                <div className="text-blue-100 text-sm font-medium mb-1">Annual Labor Budget</div>
                <div className="text-2xl font-bold">{formatCurrency(totals.laborBudget)}</div>
                <div className="text-blue-200 text-xs mt-1">{selectedBranch.name}</div>
              </div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-5 text-white shadow-lg">
                <div className="text-purple-100 text-sm font-medium mb-1">Total Labor Hours</div>
                <div className="text-2xl font-bold">{formatNumber(totals.laborHours, 0)}</div>
                <div className="text-purple-200 text-xs mt-1">{selectedBranch.name}</div>
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
                  <th className="text-right py-2 px-3 font-medium text-gray-600">Avg FTEs</th>
                  <th className="text-right py-2 px-3 font-medium text-gray-600">% of Company</th>
                </tr>
              </thead>
              <tbody>
                {branches.map(branch => {
                  const branchForecasts = allBranchForecasts[branch.id] || [];
                  const branchRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.forecast_revenue) || 0), 0);
                  const branchLaborBudget = branchRevenue * (1 - GROSS_MARGIN_TARGET);
                  const branchLaborHours = branchLaborBudget / HOURLY_RATE;
                  const branchAvgFtes = Math.floor(branchLaborHours / HOURS_PER_MONTH / 12);
                  const percentOfCompany = companyTotals.revenue > 0 
                    ? (branchRevenue / companyTotals.revenue) * 100 
                    : 0;
                  
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
                      <td className="py-2 px-3 text-right">{branchAvgFtes}</td>
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
                    {Math.floor(companyTotals.laborBudget / HOURLY_RATE / HOURS_PER_MONTH / 12)}
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
            <div><span className="font-medium">Labor Hours</span> = Labor Budget ÷ ${HOURLY_RATE}/hr</div>
            <div><span className="font-medium">FTEs</span> = Labor Hours ÷ {HOURS_PER_MONTH} hrs/month</div>
          </div>
        </div>
      </div>
    </div>
  );
}