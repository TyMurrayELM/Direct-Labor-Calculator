"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  useBranches,
  useRevenueForecasts,
  useAllBranchForecasts
} from '../../hooks/useSupabase';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import PnlSection from '../../components/PnlSection';

export default function ArborForecastPage() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  
  // Constants for Arbor department
  const ARBOR_REVENUE_PERCENT = 0.50; // 50% of (Maintenance + Onsite) Revenue
  const BILLING_RATE = 110; // $110/hr billing rate
  const HOURLY_COST = 29; // $29/hr fully burdened cost
  const HOURS_PER_MONTH = 173.33; // ~40 hrs/week * 4.333 weeks
  const CREW_SIZE = 4;
  
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  
  // State
  const [session, setSession] = useState(null);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedYear, setSelectedYear] = useState(2026);
  const [saveMessage, setSaveMessage] = useState(null);
  
  // Fetch data from Maintenance forecasts
  const { branches, loading: branchesLoading } = useBranches();
  // Only fetch single branch forecasts when we have a valid numeric branch ID (not 'phoenix' or null)
  const validBranchId = selectedBranchId && selectedBranchId !== 'phoenix' ? selectedBranchId : null;
  const { forecasts, loading: forecastsLoading } = useRevenueForecasts(validBranchId, selectedYear);
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
  
  // Set Phoenix as default when branches load
  useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId('phoenix');
    }
  }, [branches, selectedBranchId]);

  // Helper functions
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

  // Check if Phoenix (combined) view is selected
  const isPhoenixView = selectedBranchId === 'phoenix';

  // Get Phoenix branches for combined view (Phx - North, Phx - SouthEast, Phx - SouthWest)
  const phoenixBranches = branches.filter(b => b.name.toLowerCase().includes('phx'));

  // Get selected branch info
  const selectedBranch = isPhoenixView 
    ? { name: 'Phoenix (Combined)', color: '#10B981' }
    : branches.find(b => b.id === selectedBranchId) || {};

  // Get maintenance revenue data
  const getMaintenanceRevenue = (month) => {
    if (isPhoenixView) {
      // Combine all Phoenix branches
      let total = 0;
      phoenixBranches.forEach(branch => {
        const branchForecasts = allBranchForecasts[branch.id] || [];
        const forecast = branchForecasts.find(f => f.month === month);
        if (forecast) {
          total += parseFloat(forecast.forecast_revenue) || 0;
        }
      });
      return total;
    } else {
      const forecast = forecasts?.find(f => f.month === month);
      return forecast ? parseFloat(forecast.forecast_revenue) || 0 : 0;
    }
  };

  // Get onsite revenue data
  const getOnsiteRevenue = (month) => {
    if (isPhoenixView) {
      // Combine all Phoenix branches
      let total = 0;
      phoenixBranches.forEach(branch => {
        const branchForecasts = allBranchForecasts[branch.id] || [];
        const forecast = branchForecasts.find(f => f.month === month);
        if (forecast) {
          total += parseFloat(forecast.onsite_revenue) || 0;
        }
      });
      return total;
    } else {
      const forecast = forecasts?.find(f => f.month === month);
      return forecast ? parseFloat(forecast.onsite_revenue) || 0 : 0;
    }
  };

  // Calculate Arbor metrics for a given maintenance and onsite revenue
  const calculateArborMetrics = (maintenanceRevenue, onsiteRevenue) => {
    const combinedRevenue = maintenanceRevenue + onsiteRevenue;
    const arborRevenue = combinedRevenue * ARBOR_REVENUE_PERCENT;
    const billableHours = arborRevenue / BILLING_RATE;
    const laborCost = billableHours * HOURLY_COST;
    const ftes = billableHours / HOURS_PER_MONTH;
    const crews = ftes / CREW_SIZE;
    
    return {
      maintenanceRevenue,
      onsiteRevenue,
      combinedRevenue,
      arborRevenue,
      billableHours,
      laborCost,
      ftes,
      crews
    };
  };

  // Calculate monthly data
  const monthlyData = months.map(month => {
    const maintenanceRevenue = getMaintenanceRevenue(month);
    const onsiteRevenue = getOnsiteRevenue(month);
    return {
      month,
      ...calculateArborMetrics(maintenanceRevenue, onsiteRevenue)
    };
  });

  // Calculate totals
  const totals = monthlyData.reduce((acc, d) => ({
    maintenanceRevenue: acc.maintenanceRevenue + d.maintenanceRevenue,
    onsiteRevenue: acc.onsiteRevenue + d.onsiteRevenue,
    combinedRevenue: acc.combinedRevenue + d.combinedRevenue,
    arborRevenue: acc.arborRevenue + d.arborRevenue,
    billableHours: acc.billableHours + d.billableHours,
    laborCost: acc.laborCost + d.laborCost
  }), {
    maintenanceRevenue: 0,
    onsiteRevenue: 0,
    combinedRevenue: 0,
    arborRevenue: 0,
    billableHours: 0,
    laborCost: 0
  });

  const avgFtes = totals.billableHours / HOURS_PER_MONTH / 12;
  const avgCrews = avgFtes / CREW_SIZE;

  // Year options
  const yearOptions = [2025, 2026, 2027];

  // CSV Export Function - Horizontal layout matching the UI
  const exportToCSV = () => {
    try {
      setSaveMessage({ type: 'success', text: 'Preparing export...' });
      
      const branchName = isPhoenixView ? 'Phoenix_Combined' : (selectedBranch.name || 'Unknown').replace(/\s+/g, '_');
      
      // Escape CSV values
      const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        return (str.includes(',') || str.includes('"') || str.includes('\n')) 
          ? `"${str.replace(/"/g, '""')}"` 
          : str;
      };
      
      // Build rows (each row is a metric, columns are months + total)
      const rows = [];
      
      // Header row
      rows.push(['Metric', ...months, 'Total']);
      
      // Maintenance Revenue (source)
      rows.push(['Maintenance Revenue', ...monthlyData.map(d => d.maintenanceRevenue), totals.maintenanceRevenue]);
      
      // Onsite Revenue (source)
      rows.push(['Onsite Revenue', ...monthlyData.map(d => d.onsiteRevenue), totals.onsiteRevenue]);
      
      // Combined Revenue (source)
      rows.push(['Combined Revenue (Maint + Onsite)', ...monthlyData.map(d => d.combinedRevenue), totals.combinedRevenue]);
      
      // Arbor Revenue Target
      rows.push(['Arbor Revenue (50% of Combined)', ...monthlyData.map(d => d.arborRevenue), totals.arborRevenue]);
      
      // Billable Hours
      rows.push(['Billable Hours (@$110/hr)', ...monthlyData.map(d => Math.round(d.billableHours)), Math.round(totals.billableHours)]);
      
      // Labor Cost
      rows.push(['Labor Cost (@$29/hr)', ...monthlyData.map(d => d.laborCost), totals.laborCost]);
      
      // FTEs Required
      rows.push(['FTEs Required', ...monthlyData.map(d => d.ftes.toFixed(1)), avgFtes.toFixed(1) + ' (avg)']);
      
      // Crews Required
      rows.push(['Crews (4-person)', ...monthlyData.map(d => Math.ceil(d.crews)), Math.ceil(avgCrews) + ' (avg)']);
      
      // Build CSV content
      const csvContent = rows.map(row => row.map(escapeCSV).join(',')).join('\n');
      
      // Create and trigger download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', `Arbor_FTE_Forecast_${branchName}_${selectedYear}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setSaveMessage({ type: 'success', text: 'Export complete!' });
      setTimeout(() => setSaveMessage(null), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setSaveMessage({ type: 'error', text: 'Error exporting data' });
      setTimeout(() => setSaveMessage(null), 3000);
    }
  };

  // Loading state - only wait for forecastsLoading when we have a valid branch selected
  const isLoading = branchesLoading || allForecastsLoading || (validBranchId && forecastsLoading);
  
  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-green-50">
        <div className="p-8 bg-white shadow-lg rounded-lg">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 border-t-4 border-b-4 border-green-600 rounded-full animate-spin"></div>
            <p className="text-lg font-semibold text-gray-700">Loading forecast data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-green-50 min-h-screen">
      <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-white to-gray-100 p-4 border-b border-gray-200"
          style={{ borderTop: `4px solid ${selectedBranch.color || '#16A34A'}` }}>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              {/* Tree Icon */}
              <div className="bg-green-100 p-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 3L4 14h5v7h6v-7h5L12 3z" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Arbor FTE Forecast</h1>
                <p className="text-sm text-gray-700 mt-1">Based on Maintenance Revenue projections</p>
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
                  className={`px-4 py-2 rounded-lg font-medium transition-all ${
                    selectedBranchId === 'phoenix'
                      ? 'bg-green-600 text-white shadow-md'
                      : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                  }`}
                >
                  Phoenix
                </button>
                {/* All individual branches */}
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
                      backgroundColor: selectedBranchId === branch.id ? (branch.color || '#16A34A') : undefined
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
                className="border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                {yearOptions.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>
            
            {/* Export CSV Button */}
            <button
              onClick={exportToCSV}
              className="px-4 py-2 bg-white text-green-700 border border-green-600 rounded-lg hover:bg-green-50 transition-colors shadow-sm font-medium flex items-center space-x-2"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              <span>Export CSV</span>
            </button>
          </div>
          
          {/* Message */}
          {saveMessage && (
            <div className={`p-3 rounded-lg mb-4 ${
              saveMessage.type === 'success' 
                ? 'bg-green-50 text-green-700 border border-green-200' 
                : 'bg-red-50 text-red-700 border border-red-200'
            }`}>
              {saveMessage.text}
            </div>
          )}
          
          {/* Constants Display */}
          <div className="flex flex-wrap gap-4 text-sm bg-green-50 rounded-lg p-4 border border-green-200">
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Arbor Target:</span>
              <span className="text-green-700 font-semibold">50% of (Maint + Onsite)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Billing Rate:</span>
              <span className="text-green-700 font-semibold">${BILLING_RATE}/hr</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Labor Cost:</span>
              <span className="text-green-700 font-semibold">${HOURLY_COST}/hr</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-medium text-gray-700">Crew Size:</span>
              <span className="text-green-700 font-semibold">{CREW_SIZE} people</span>
            </div>
          </div>
        </div>

        {/* Main Table */}
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="bg-green-800 text-white text-sm">
                <th className="px-3 py-2 text-left font-semibold sticky left-0 bg-green-800 z-10">Metric</th>
                {months.map(month => (
                  <th key={month} className="px-2 py-2 text-center font-semibold min-w-20">
                    {month}
                  </th>
                ))}
                <th className="px-3 py-2 text-center font-semibold bg-green-900 min-w-24">Total</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {/* Maintenance Revenue (Source) Row */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">
                  <div className="flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
                    </svg>
                    Maintenance Revenue
                  </div>
                </td>
                {monthlyData.map(d => (
                  <td key={d.month} className="px-2 py-2 text-center text-gray-700">
                    {d.maintenanceRevenue > 0 ? formatCurrency(d.maintenanceRevenue) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-gray-700 bg-gray-100">
                  {formatCurrency(totals.maintenanceRevenue)}
                </td>
              </tr>

              {/* Onsite Revenue (Source) Row */}
              <tr className="bg-gray-50 border-b border-gray-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-gray-50 z-10">
                  <div className="flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                    </svg>
                    Onsite Revenue
                  </div>
                </td>
                {monthlyData.map(d => (
                  <td key={d.month} className="px-2 py-2 text-center text-gray-700">
                    {d.onsiteRevenue > 0 ? formatCurrency(d.onsiteRevenue) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-gray-700 bg-gray-100">
                  {formatCurrency(totals.onsiteRevenue)}
                </td>
              </tr>

              {/* Arbor Revenue Target Row */}
              <tr className="bg-green-50 border-b border-green-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-green-50 z-10">
                  Arbor Revenue (50% of Maint + Onsite)
                </td>
                {monthlyData.map(d => (
                  <td key={d.month} className="px-2 py-2 text-center text-green-700 font-medium">
                    {d.arborRevenue > 0 ? formatCurrency(d.arborRevenue) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-bold text-green-700 bg-green-100">
                  {formatCurrency(totals.arborRevenue)}
                </td>
              </tr>

              {/* Billable Hours Row */}
              <tr className="bg-purple-50 border-b border-purple-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-purple-50 z-10">
                  Billable Hours (@${BILLING_RATE}/hr)
                </td>
                {monthlyData.map(d => (
                  <td key={d.month} className="px-2 py-2 text-center text-purple-700">
                    {d.billableHours > 0 ? formatNumber(d.billableHours, 0) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-purple-700 bg-purple-100">
                  {formatNumber(totals.billableHours, 0)}
                </td>
              </tr>

              {/* Labor Cost Row */}
              <tr className="bg-orange-50 border-b border-orange-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-orange-50 z-10">
                  Labor Cost (@${HOURLY_COST}/hr)
                </td>
                {monthlyData.map(d => (
                  <td key={d.month} className="px-2 py-2 text-center text-orange-700">
                    {d.laborCost > 0 ? formatCurrency(d.laborCost) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-center font-semibold text-orange-700 bg-orange-100">
                  {formatCurrency(totals.laborCost)}
                </td>
              </tr>

              {/* FTEs Required Row */}
              <tr className="bg-teal-50 border-b border-teal-200">
                <td className="px-2 py-2 font-medium text-gray-700 sticky left-0 bg-teal-50 z-10">
                  FTEs Required
                </td>
                {monthlyData.map(d => (
                  <td key={d.month} className="px-2 py-2 text-center">
                    {d.ftes > 0 ? (
                      <span className="inline-block bg-teal-200 text-teal-800 font-bold px-2 py-0.5 rounded-full text-sm">
                        {formatNumber(d.ftes, 1)}
                      </span>
                    ) : '—'}
                  </td>
                ))}
                <td className="px-2 py-2 text-center bg-teal-100">
                  <div className="text-xs text-gray-700">Avg</div>
                  <span className="inline-block bg-teal-300 text-teal-900 font-bold px-2 py-0.5 rounded-full text-sm">
                    {formatNumber(avgFtes, 1)}
                  </span>
                </td>
              </tr>

              {/* Crews Required Row */}
              <tr className="bg-gray-100 border-b border-gray-200">
                <td className="px-2 py-1.5 text-xs text-gray-700 sticky left-0 bg-gray-100 z-10">
                  <div className="flex items-center gap-1">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-gray-700" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                    </svg>
                    <span>Crews ({CREW_SIZE}-person)</span>
                  </div>
                </td>
                {monthlyData.map((d, index) => {
                  const crews = Math.ceil(d.crews);
                  const prevCrews = index > 0 ? Math.ceil(monthlyData[index - 1].crews) : null;
                  const hasJump = crews > 0 && prevCrews !== null && prevCrews > 0 && crews !== prevCrews;
                  
                  return (
                    <td key={d.month} className={`px-2 py-1.5 text-center text-xs ${hasJump ? 'bg-yellow-200 text-yellow-800 font-semibold' : 'text-gray-700'}`}>
                      {d.crews > 0 ? crews : '—'}
                    </td>
                  );
                })}
                <td className="px-2 py-1.5 text-center text-xs text-gray-700 bg-gray-200">
                  {avgCrews > 0 ? Math.ceil(avgCrews) : '—'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* Summary Cards */}
        {totals.arborRevenue > 0 && (
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              <div className="bg-gradient-to-br from-green-600 to-green-700 rounded-xl p-5 text-white shadow-lg">
                <div className="text-green-100 text-sm font-medium mb-1">Annual Arbor Revenue Target</div>
                <div className="text-2xl font-bold">{formatCurrency(totals.arborRevenue)}</div>
                <div className="text-green-200 text-xs mt-1">50% of Maintenance</div>
              </div>
              <div className="bg-gradient-to-br from-purple-500 to-purple-600 rounded-xl p-5 text-white shadow-lg">
                <div className="text-purple-100 text-sm font-medium mb-1">Annual Billable Hours</div>
                <div className="text-2xl font-bold">{formatNumber(totals.billableHours, 0)}</div>
                <div className="text-purple-200 text-xs mt-1">@ ${BILLING_RATE}/hr</div>
              </div>
              <div className="bg-gradient-to-br from-red-500 to-red-600 rounded-xl p-5 text-white shadow-lg">
                <div className="text-red-100 text-sm font-medium mb-1">Annual Labor Cost</div>
                <div className="text-2xl font-bold">{formatCurrency(totals.laborCost)}</div>
                <div className="text-red-200 text-xs mt-1">@ ${HOURLY_COST}/hr</div>
              </div>
              <div className="bg-gradient-to-br from-teal-500 to-teal-600 rounded-xl p-5 text-white shadow-lg">
                <div className="text-teal-100 text-sm font-medium mb-1">Average FTEs/Month</div>
                <div className="text-2xl font-bold">{formatNumber(avgFtes, 1)}</div>
                <div className="text-teal-200 text-xs mt-1">{Math.ceil(avgCrews)} crew(s)</div>
              </div>
            </div>
          </div>
        )}

        {/* P&L Section */}
        {!isPhoenixView && (
          <PnlSection
            branchId={selectedBranchId}
            branchName={selectedBranch?.name}
            year={selectedYear}
            department="arbor"
          />
        )}

        {/* Formula Reference */}
        <div className="p-6 bg-gray-50 border-t border-gray-200">
          <div className="font-semibold text-gray-700 mb-2">Calculation Reference:</div>
          <div className="text-sm text-gray-700 space-y-1">
            <div><span className="font-medium">Arbor Revenue</span> = Maintenance Revenue × 50%</div>
            <div><span className="font-medium">Billable Hours</span> = Arbor Revenue ÷ ${BILLING_RATE}/hr</div>
            <div><span className="font-medium">Labor Cost</span> = Billable Hours × ${HOURLY_COST}/hr</div>
            <div><span className="font-medium">FTEs</span> = Billable Hours ÷ {HOURS_PER_MONTH} hrs/month</div>
            <div><span className="font-medium">Crews</span> = FTEs ÷ {CREW_SIZE}</div>
          </div>
        </div>
      </div>
    </div>
  );
}