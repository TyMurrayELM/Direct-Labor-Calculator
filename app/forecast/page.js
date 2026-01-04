"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  useBranches, 
  useRevenueForecasts,
  useAllBranchForecasts,
  batchUpsertForecasts,
  useCrews
} from '../hooks/useSupabase';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

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
  
  // Helper function to get hourly cost based on branch name
  const getHourlyRateByBranch = (branch) => {
    if (!branch || !branch.name) return DEFAULT_HOURLY_RATE;
    
    const branchName = branch.name.toLowerCase();
    
    // Las Vegas branch
    if (branchName.includes('las vegas') || branchName.includes('vegas')) {
      return HOURLY_COST_LAS_VEGAS;
    }
    
    // Phoenix branches (Southeast, Southwest, North)
    if (branchName.includes('phoenix') || 
        branchName.includes('southeast') || 
        branchName.includes('southwest') || 
        branchName.includes('north') ||
        branchName.includes('phx')) {
      return HOURLY_COST_PHOENIX;
    }
    
    return DEFAULT_HOURLY_RATE;
  };
  
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
  // Don't fetch individual branch forecasts when Encore or Phoenix (combined views) is selected
  const { forecasts, loading: forecastsLoading, refetchForecasts } = useRevenueForecasts(
    (selectedBranchId === 'encore' || selectedBranchId === 'phoenix') ? null : selectedBranchId, 
    selectedYear
  );
  const { forecasts: allBranchForecasts, loading: allForecastsLoading, refetchForecasts: refetchAllForecasts } = useAllBranchForecasts(selectedYear);
  const { crews, loading: crewsLoading } = useCrews(); // Fetch all crews (no branchId filter)
  
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

  // Check if Encore (company-wide) or Phoenix (combined Phoenix branches) view is selected
  const isEncoreView = selectedBranchId === 'encore';
  const isPhoenixView = selectedBranchId === 'phoenix';
  const isCombinedView = isEncoreView || isPhoenixView;
  
  // Helper to check if a branch is a Phoenix branch
  const isPhoenixBranch = (branch) => {
    if (!branch || !branch.name) return false;
    const name = branch.name.toLowerCase();
    return name.includes('phoenix') || 
           name.includes('southeast') || 
           name.includes('southwest') || 
           name.includes('north') ||
           name.includes('phx');
  };

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

  // Calculate Phoenix (combined Phoenix branches) data
  const phoenixData = isPhoenixView ? months.reduce((acc, month) => {
    let monthRevenue = 0;
    let monthLaborCost = 0;
    let monthActualHours = 0;
    let monthActualFtes = 0;
    let monthWeeks = 4.33;
    
    branches.filter(isPhoenixBranch).forEach(branch => {
      const branchForecasts = allBranchForecasts[branch.id] || [];
      const forecast = branchForecasts.find(f => f.month === month);
      if (forecast) {
        monthRevenue += parseFloat(forecast.forecast_revenue) || 0;
        monthLaborCost += parseFloat(forecast.actual_labor_cost) || 0;
        monthActualHours += parseFloat(forecast.actual_hours) || 0;
        monthActualFtes += parseFloat(forecast.actual_ftes) || 0;
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

  // Helper to get combined data for either Encore or Phoenix view
  const combinedData = isEncoreView ? encoreData : isPhoenixView ? phoenixData : null;

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
        refetchAllForecasts(); // Also refresh all branch data for Encore view
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

  // CSV Export Function - Horizontal layout matching the UI (months as columns)
  const exportToCSV = () => {
    try {
      setSaveMessage({ type: 'success', text: 'Preparing export...' });
      
      const branchName = isEncoreView ? 'Encore_All_Branches' : isPhoenixView ? 'Phoenix_Combined' : (selectedBranch.name || 'Unknown').replace(/\s+/g, '_');
      
      // Escape CSV values
      const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        return (str.includes(',') || str.includes('"') || str.includes('\n')) 
          ? `"${str.replace(/"/g, '""')}"` 
          : str;
      };
      
      // Calculate all monthly data first
      const monthlyData = months.map(month => {
        const revenue = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
        const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
        const laborHours = laborBudget / hourlyRate;
        const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
        
        // FTEs calculation (normalized or real)
        const displayHours = isNormalized ? laborHours : (laborHours / 4.33) * weeks;
        const ftes = Math.floor(displayHours / HOURS_PER_MONTH);
        const crews = ftes > 0 ? Math.ceil(ftes / 4) : '';
        
        // Actual values
        const actLaborCost = isCombinedView ? (combinedData[month]?.laborCost || 0) : parseRevenue(actualLaborCost[month]);
        const actHours = isCombinedView ? (combinedData[month]?.actualHours || 0) : (parseFloat(String(actualHours[month]).replace(/,/g, '')) || 0);
        const actHC = isCombinedView ? (combinedData[month]?.actualFtes || 0) : (parseFloat(actualFtes[month]) || 0);
        
        // Actual DL % calculation (from labor cost)
        const displayCost = isNormalized && weeks > 0 ? (actLaborCost / weeks) * 4.33 : actLaborCost;
        const dlPercentCost = revenue > 0 && actLaborCost > 0 ? (displayCost / revenue) * 100 : null;
        
        // Actual FTEs from hours
        let actualFtesFromHours = '';
        if (actHours > 0 && weeks > 0) {
          const dispHours = isNormalized ? (actHours / weeks) * 4.33 : actHours;
          const rawFtes = dispHours / HOURS_PER_MONTH;
          const decimal = rawFtes % 1;
          actualFtesFromHours = decimal > 0.1 ? Math.ceil(rawFtes) : Math.floor(rawFtes);
        }
        
        // Actual DL % from HC
        let dlPercentHC = null;
        if (revenue > 0 && actHC > 0) {
          const hoursMultiplier = isNormalized ? HOURS_PER_MONTH : (HOURS_PER_MONTH / 4.33) * weeks;
          const actualLaborCostCalc = actHC * hoursMultiplier * hourlyRate;
          dlPercentHC = (actualLaborCostCalc / revenue) * 100;
        }
        
        return {
          month,
          weeks,
          revenue,
          laborBudget,
          actLaborCost,
          dlPercentCost,
          ftes,
          displayHours,
          actHours,
          actualFtesFromHours,
          actHC,
          dlPercentHC,
          crews
        };
      });
      
      // Calculate totals
      const totalRevenue = monthlyData.reduce((sum, d) => sum + d.revenue, 0);
      const totalLaborBudget = monthlyData.reduce((sum, d) => sum + d.laborBudget, 0);
      const totalActLaborCost = monthlyData.reduce((sum, d) => sum + d.actLaborCost, 0);
      const totalDisplayCost = months.reduce((sum, month, i) => {
        const d = monthlyData[i];
        const displayCost = isNormalized && d.weeks > 0 ? (d.actLaborCost / d.weeks) * 4.33 : d.actLaborCost;
        return sum + displayCost;
      }, 0);
      const avgDLCost = totalRevenue > 0 && totalDisplayCost > 0 ? (totalDisplayCost / totalRevenue) * 100 : null;
      const totalDisplayHours = monthlyData.reduce((sum, d) => sum + d.displayHours, 0);
      const avgFtes = Math.floor(totalDisplayHours / HOURS_PER_MONTH / 12);
      const totalActHours = monthlyData.reduce((sum, d) => sum + d.actHours, 0);
      const avgActHC = monthlyData.filter(d => d.actHC > 0).length > 0 
        ? monthlyData.reduce((sum, d) => sum + d.actHC, 0) / monthlyData.filter(d => d.actHC > 0).length 
        : '';
      
      // Build rows (each row is a metric, columns are months + total)
      const rows = [];
      
      // Header row: Metric, Jan, Feb, ..., Dec, Total
      rows.push(['Metric', ...months, 'Total']);
      
      // Pay Weeks row
      rows.push(['Pay Weeks', ...monthlyData.map(d => d.weeks), '']);
      
      // Monthly Revenue row
      rows.push(['Monthly Revenue', ...monthlyData.map(d => d.revenue), totalRevenue]);
      
      // Labor Target (40%) row
      rows.push(['Labor Target (40%)', ...monthlyData.map(d => d.revenue > 0 ? d.laborBudget : ''), totalLaborBudget]);
      
      // Actual Labor Cost row
      rows.push(['Actual Labor Cost', ...monthlyData.map(d => d.actLaborCost || ''), totalActLaborCost || '']);
      
      // Actual DL % (from cost) row
      rows.push(['Actual DL % (Cost)', ...monthlyData.map(d => d.dlPercentCost !== null ? d.dlPercentCost.toFixed(1) + '%' : ''), avgDLCost !== null ? avgDLCost.toFixed(1) + '%' : '']);
      
      // FTEs Required row
      rows.push(['FTEs Required', ...monthlyData.map(d => d.revenue > 0 ? d.ftes : ''), avgFtes + ' (avg)']);
      
      // Labor Hours Est row
      rows.push(['Labor Hours Est', ...monthlyData.map(d => d.revenue > 0 ? Math.round(d.displayHours) : ''), Math.round(totalDisplayHours)]);
      
      // Target DL % row
      rows.push(['Target DL %', ...monthlyData.map(d => d.revenue > 0 ? '40.0%' : ''), '40.0%']);
      
      // Actual Hours row
      rows.push(['Actual Hours', ...monthlyData.map(d => d.actHours || ''), totalActHours || '']);
      
      // Actual FTEs (from hours) row
      rows.push(['Actual FTEs (Hours)', ...monthlyData.map(d => d.actualFtesFromHours), '']);
      
      // Actual HC row
      rows.push(['Actual HC', ...monthlyData.map(d => d.actHC || ''), avgActHC ? avgActHC.toFixed(1) + ' (avg)' : '']);
      
      // Scheduled HC row (from crews)
      rows.push(['Scheduled HC (Crews)', ...months.map(() => scheduledHC || ''), scheduledHC || '']);
      
      // Actual DL % (from HC) row
      rows.push(['Actual DL % (HC)', ...monthlyData.map(d => d.dlPercentHC !== null ? d.dlPercentHC.toFixed(1) + '%' : ''), '']);
      
      // Maint Crews row
      rows.push(['Maint Crews (4m)', ...monthlyData.map(d => d.crews), avgFtes > 0 ? Math.ceil(avgFtes / 4) : '']);
      
      // Build CSV content
      const csvContent = rows.map(row => row.map(escapeCSV).join(',')).join('\n');
      
      // Create and trigger download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', `FTE_Forecast_${branchName}_${selectedYear}_${new Date().toISOString().split('T')[0]}.csv`);
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
    const branchHourlyRate = getHourlyRateByBranch(branch);
    const branchLaborBudget = branchRevenue * (1 - GROSS_MARGIN_TARGET);
    const branchLaborHours = branchLaborBudget / branchHourlyRate;
    return {
      revenue: acc.revenue + branchRevenue,
      laborBudget: acc.laborBudget + branchLaborBudget,
      laborHours: acc.laborHours + branchLaborHours
    };
  }, { revenue: 0, laborBudget: 0, laborHours: 0 });

  // Calculate Phoenix-only totals (combined Phoenix branches)
  const phoenixTotals = branches.filter(isPhoenixBranch).reduce((acc, branch) => {
    const branchForecasts = allBranchForecasts[branch.id] || [];
    const branchRevenue = branchForecasts.reduce((sum, f) => sum + (parseFloat(f.forecast_revenue) || 0), 0);
    const branchHourlyRate = getHourlyRateByBranch(branch);
    const branchLaborBudget = branchRevenue * (1 - GROSS_MARGIN_TARGET);
    const branchLaborHours = branchLaborBudget / branchHourlyRate;
    return {
      revenue: acc.revenue + branchRevenue,
      laborBudget: acc.laborBudget + branchLaborBudget,
      laborHours: acc.laborHours + branchLaborHours
    };
  }, { revenue: 0, laborBudget: 0, laborHours: 0 });

  // Use appropriate totals based on view
  const totals = isEncoreView ? companyTotals : isPhoenixView ? phoenixTotals : branchTotals;

  const avgFtes = Math.floor(totals.laborHours / HOURS_PER_MONTH / 12);

  // Calculate Scheduled HC (sum of crew sizes, excluding Onsite crews)
  const getScheduledHC = () => {
    // Filter out Onsite crews - only count Maintenance crews
    const maintenanceCrews = crews.filter(crew => crew.crew_type !== 'Onsite');
    
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
            
            <div className="flex space-x-2">
              <Link 
                href="/" 
                className="px-2 py-1 bg-white text-gray-600 text-sm border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors flex items-center space-x-1.5"
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
                {branches.map(branch => {
                  // Define colors based on branch name
                  const branchName = branch.name.toLowerCase();
                  let lightBg, darkBg, lightText, darkText, hoverBg;
                  
                  if (branchName.includes('north')) {
                    // Green for North
                    lightBg = 'bg-green-100';
                    darkBg = 'bg-green-600';
                    lightText = 'text-green-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-green-200';
                  } else if (branchName.includes('southeast')) {
                    // Red for Southeast
                    lightBg = 'bg-red-100';
                    darkBg = 'bg-red-600';
                    lightText = 'text-red-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-red-200';
                  } else if (branchName.includes('southwest')) {
                    // Blue for Southwest
                    lightBg = 'bg-blue-100';
                    darkBg = 'bg-blue-600';
                    lightText = 'text-blue-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-blue-200';
                  } else if (branchName.includes('vegas')) {
                    // Yellowish Gold for Las Vegas
                    lightBg = 'bg-amber-100';
                    darkBg = 'bg-amber-500';
                    lightText = 'text-amber-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-amber-200';
                  } else {
                    // Default gray
                    lightBg = 'bg-gray-200';
                    darkBg = 'bg-gray-600';
                    lightText = 'text-gray-700';
                    darkText = 'text-white';
                    hoverBg = 'hover:bg-gray-300';
                  }
                  
                  const isSelected = selectedBranchId === branch.id;
                  
                  return (
                    <button
                      key={branch.id}
                      onClick={() => setSelectedBranchId(branch.id)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                        isSelected
                          ? `${darkBg} ${darkText} shadow-md`
                          : `${lightBg} ${lightText} ${hoverBg}`
                      }`}
                    >
                      {branch.name.replace('Phoenix ', '').replace('Las Vegas', 'LV')}
                    </button>
                  );
                })}
                <button
                  onClick={() => setSelectedBranchId('phoenix')}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all shadow-sm ${
                    selectedBranchId === 'phoenix'
                      ? 'bg-orange-500 text-white shadow-md'
                      : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
                  }`}
                >
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
            
            {/* Export CSV Button */}
            <button
              onClick={exportToCSV}
              className="px-3 py-1.5 bg-white text-emerald-700 border border-emerald-600 rounded-lg hover:bg-emerald-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
              <span>Export</span>
            </button>
            
            <button
              onClick={handleSave}
              disabled={isSaving || !selectedBranchId || isCombinedView}
              className={`ml-auto px-3 py-1.5 rounded-lg text-sm font-medium shadow-sm transition-colors flex items-center space-x-1.5 ${
                isSaving || isCombinedView
                  ? 'bg-gray-400 text-white cursor-not-allowed' 
                  : 'bg-green-600 text-white hover:bg-green-700'
              }`}
            >
              {isSaving ? (
                <>
                  <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M7.707 10.293a1 1 0 10-1.414 1.414l3 3a1 1 0 001.414 0l3-3a1 1 0 00-1.414-1.414L11 11.586V6h5a2 2 0 012 2v7a2 2 0 01-2 2H4a2 2 0 01-2-2V8a2 2 0 012-2h5v5.586l-1.293-1.293zM9 4a1 1 0 012 0v2H9V4z" />
                  </svg>
                  <span>Save</span>
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
        <div className="overflow-x-auto rounded-lg border border-gray-200 shadow-sm">
          <table className="w-full border-collapse">
            <thead>
              {/* Pay Weeks Row - above header */}
              <tr className="bg-slate-50 text-sm">
                <th className="px-3 py-2 text-left text-xs text-slate-500 font-medium tracking-wide uppercase sticky left-0 bg-slate-50 z-10">
                  Pay Weeks
                </th>
                {months.map(month => (
                  <th key={month} className="px-1 py-1.5 font-normal">
                    {isCombinedView ? (
                      <div className="text-center text-xs text-slate-600 font-medium">
                        {combinedData[month]?.weeks || 4.33}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={weeksInMonth[month]}
                        onChange={(e) => handleWeeksInMonthChange(month, e.target.value)}
                        placeholder="4.33"
                        className="w-full px-1 py-1.5 border border-slate-200 rounded text-center text-xs font-mono focus:ring-2 focus:ring-slate-400 focus:border-slate-400 outline-none bg-white transition-all duration-150 hover:border-slate-300"
                      />
                    )}
                  </th>
                ))}
                <th className="px-3 py-2 text-center text-xs text-slate-400 bg-slate-100 font-normal">
                  —
                </th>
              </tr>
              <tr className="bg-gradient-to-r from-slate-700 to-slate-800 text-white text-sm">
                <th className="px-3 py-3 text-left font-semibold tracking-wide sticky left-0 bg-slate-700 z-10">Metric</th>
                {months.map(month => (
                  <th key={month} className="px-2 py-3 text-center font-semibold min-w-20">
                    {month}
                  </th>
                ))}
                <th className="px-3 py-3 text-center font-semibold bg-slate-900/30 min-w-28">Total / Avg</th>
              </tr>
            </thead>
            <tbody className="text-sm">
              {/* Revenue Input Row */}
              <tr className="bg-emerald-50/60 border-b border-emerald-100 hover:bg-emerald-50 transition-colors duration-150">
                <td className="px-3 py-2.5 font-medium text-slate-700 sticky left-0 bg-emerald-50/60 z-10">
                  Monthly Revenue
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    {isCombinedView ? (
                      <div className="text-center text-emerald-700 font-semibold tabular-nums">
                        {formatCurrency(combinedData[month]?.revenue || 0)}
                      </div>
                    ) : (
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input
                          type="text"
                          value={monthlyRevenue[month]}
                          onChange={(e) => handleRevenueChange(month, e.target.value)}
                          placeholder="0"
                          className="w-full pl-5 pr-1 py-1.5 border border-slate-200 rounded text-right text-sm font-mono focus:ring-2 focus:ring-emerald-400 focus:border-emerald-400 outline-none bg-white transition-all duration-150 hover:border-emerald-300"
                        />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center bg-emerald-100/80">
                  <span className="font-bold text-emerald-800 text-base tabular-nums">
                    {isCombinedView 
                      ? formatCurrency(months.reduce((sum, m) => sum + (combinedData[m]?.revenue || 0), 0))
                      : formatCurrency(totals.revenue)
                    }
                  </span>
                </td>
              </tr>

              {/* Labor Target Row */}
              <tr className="bg-blue-50/60 border-b border-blue-100 hover:bg-blue-50 transition-colors duration-150">
                <td className="px-3 py-2.5 font-medium text-slate-700 sticky left-0 bg-blue-50/60 z-10">
                  Labor Target (40%)
                </td>
                {months.map(month => {
                  const revenue = isCombinedView 
                    ? (combinedData[month]?.revenue || 0)
                    : parseRevenue(monthlyRevenue[month]);
                  const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                  return (
                    <td key={month} className="px-2 py-2.5 text-center text-blue-700 tabular-nums">
                      {revenue > 0 ? formatCurrency(laborBudget) : '—'}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-center bg-blue-100/80">
                  <span className="font-bold text-blue-800 text-base tabular-nums">
                    {formatCurrency(totals.laborBudget)}
                  </span>
                </td>
              </tr>

              {/* Actual Labor Cost Input Row */}
              <tr className="bg-sky-50/60 border-b border-sky-100 hover:bg-sky-50 transition-colors duration-150">
                <td className="px-3 py-2.5 font-medium text-slate-700 sticky left-0 bg-sky-50/60 z-10">
                  Actual Labor Cost
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    {isCombinedView ? (
                      <div className="text-center text-sky-700 font-semibold tabular-nums">
                        {formatCurrency(combinedData[month]?.laborCost || 0)}
                      </div>
                    ) : (
                      <div className="relative">
                        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400 text-sm">$</span>
                        <input
                          type="text"
                          value={actualLaborCost[month]}
                          onChange={(e) => handleActualLaborCostChange(month, e.target.value)}
                          placeholder="0"
                          className="w-full pl-5 pr-1 py-1.5 border border-slate-200 rounded text-right text-sm font-mono focus:ring-2 focus:ring-sky-400 focus:border-sky-400 outline-none bg-white transition-all duration-150 hover:border-sky-300"
                        />
                      </div>
                    )}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center bg-sky-100/80">
                  <span className="font-bold text-sky-800 text-base tabular-nums">
                    {isCombinedView
                      ? formatCurrency(months.reduce((sum, m) => sum + (combinedData[m]?.laborCost || 0), 0))
                      : formatCurrency(months.reduce((sum, month) => sum + parseRevenue(actualLaborCost[month]), 0))
                    }
                  </span>
                </td>
              </tr>

              {/* Actual Labor Cost DL % Row */}
              <tr className="bg-sky-50/30 border-b border-sky-100/50 hover:bg-sky-50/50 transition-colors duration-150">
                <td className="px-3 py-2 text-xs font-medium text-slate-500 sticky left-0 bg-sky-50/30 z-10">
                  Actual DL %{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const rev = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const cost = isCombinedView ? (combinedData[month]?.laborCost || 0) : parseRevenue(actualLaborCost[month]);
                  const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  // Normalized: (cost / weeks) * 4.33, Real: actual cost
                  const displayCost = isNormalized && weeks > 0 ? (cost / weeks) * 4.33 : cost;
                  const dlPercent = rev > 0 && cost > 0 ? (displayCost / rev) * 100 : null;
                  return (
                    <td key={month} className="px-2 py-2 text-center">
                      {dlPercent !== null ? (
                        <span className={`text-xs font-bold tabular-nums ${dlPercent > 40 ? 'text-red-600' : 'text-emerald-600'}`}>
                          {formatNumber(dlPercent, 1)}%
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center bg-sky-100/50">
                  {(() => {
                    const totalRev = totals.revenue;
                    const totalCost = months.reduce((sum, month) => {
                      const cost = isCombinedView ? (combinedData[month]?.laborCost || 0) : parseRevenue(actualLaborCost[month]);
                      const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                      const displayCost = isNormalized && weeks > 0 ? (cost / weeks) * 4.33 : cost;
                      return sum + displayCost;
                    }, 0);
                    if (totalRev === 0 || totalCost === 0) return <span className="text-slate-300">—</span>;
                    const avgDL = (totalCost / totalRev) * 100;
                    return (
                      <span className={`text-sm font-bold tabular-nums ${avgDL > 40 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {formatNumber(avgDL, 1)}%
                      </span>
                    );
                  })()}
                </td>
              </tr>

              {/* FTEs Row */}
              <tr className="bg-amber-50/60 border-b border-amber-100 hover:bg-amber-50 transition-colors duration-150">
                <td className="px-3 py-2.5 font-medium text-slate-700 sticky left-0 bg-amber-50/60 z-10">
                  FTEs Required{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const revenue = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                  const laborHours = laborBudget / hourlyRate;
                  const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  // Normalized: base hours (standard 4.33 weeks), Real: scale UP by actual weeks
                  const displayHours = isNormalized 
                    ? laborHours 
                    : (laborHours / 4.33) * weeks;
                  const displayFtes = Math.floor(displayHours / HOURS_PER_MONTH);
                  return (
                    <td key={month} className="px-2 py-2.5 text-center">
                      {revenue > 0 ? (
                        <span className="inline-flex items-center justify-center min-w-8 h-7 bg-amber-200/80 text-amber-900 font-bold px-2 rounded-md text-sm tabular-nums shadow-sm">
                          {displayFtes}
                        </span>
                      ) : <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2.5 text-center bg-amber-100/80">
                  <div className="text-xs text-slate-500 mb-0.5">Avg</div>
                  <span className="inline-flex items-center justify-center min-w-10 h-7 bg-amber-300/80 text-amber-900 font-bold px-2 rounded-md text-base tabular-nums shadow-sm">
                    {(() => {
                      const totalHours = months.reduce((sum, month) => {
                        const revenue = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                        const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                        const laborHours = laborBudget / hourlyRate;
                        const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
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
                  const revenue = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                  const laborHours = laborBudget / hourlyRate;
                  const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
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
                    const revenue = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                    const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                    const laborHours = laborBudget / hourlyRate;
                    const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                    return sum + (isNormalized ? laborHours : (laborHours / 4.33) * weeks);
                  }, 0), 0)}
                </td>
              </tr>

              {/* Target DL % Row */}
              <tr className="bg-amber-50/30 border-b border-amber-100/50 hover:bg-amber-50/50 transition-colors duration-150">
                <td className="px-3 py-2 text-xs font-medium text-slate-500 sticky left-0 bg-amber-50/30 z-10">
                  Target DL %
                </td>
                {months.map(month => {
                  const revenue = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  return (
                    <td key={month} className="px-2 py-2 text-center text-xs font-medium text-slate-500 tabular-nums">
                      {revenue > 0 ? '40.0%' : <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center text-sm font-medium text-slate-500 bg-amber-100/50 tabular-nums">
                  40.0%
                </td>
              </tr>

              {/* Actual Hours Input Row */}
              <tr className="bg-rose-50/60 border-b border-rose-100 hover:bg-rose-50 transition-colors duration-150">
                <td className="px-3 py-2.5 font-medium text-slate-700 sticky left-0 bg-rose-50/60 z-10">
                  Actual Hours
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    {isCombinedView ? (
                      <div className="text-center text-rose-700 font-semibold tabular-nums">
                        {formatNumber(combinedData[month]?.actualHours || 0, 0)}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={actualHours[month]}
                        onChange={(e) => handleActualHoursChange(month, e.target.value)}
                        placeholder="0"
                        className="w-full px-1 py-1.5 border border-slate-200 rounded text-center text-sm font-mono focus:ring-2 focus:ring-rose-400 focus:border-rose-400 outline-none bg-white transition-all duration-150 hover:border-rose-300"
                      />
                    )}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center bg-rose-100/80">
                  <span className="font-bold text-rose-800 text-base tabular-nums">
                    {isCombinedView
                      ? formatNumber(months.reduce((sum, m) => sum + (combinedData[m]?.actualHours || 0), 0), 0)
                      : formatNumber(months.reduce((sum, month) => sum + (parseFloat(String(actualHours[month]).replace(/,/g, '')) || 0), 0), 0)
                    }
                  </span>
                </td>
              </tr>

              {/* Actual FTEs Row (calculated from Actual Hours) */}
              <tr className="bg-rose-50/30 border-b border-rose-100/50 hover:bg-rose-50/50 transition-colors duration-150">
                <td className="px-3 py-2 text-xs font-medium text-slate-500 sticky left-0 bg-rose-50/30 z-10">
                  Actual FTEs{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const hours = isCombinedView ? (combinedData[month]?.actualHours || 0) : (parseFloat(String(actualHours[month]).replace(/,/g, '')) || 0);
                  const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  if (hours <= 0 || weeks <= 0) {
                    return (
                      <td key={month} className="px-2 py-2 text-center">
                        <span className="text-slate-300">—</span>
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
                    <td key={month} className="px-2 py-2 text-center text-xs font-semibold text-rose-600 tabular-nums">
                      {displayFtes}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center text-sm font-bold text-rose-600 bg-rose-100/50 tabular-nums">
                  {(() => {
                    let totalFtes = 0;
                    let monthsWithData = 0;
                    months.forEach(month => {
                      const hours = isCombinedView ? (combinedData[month]?.actualHours || 0) : (parseFloat(String(actualHours[month]).replace(/,/g, '')) || 0);
                      const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                      if (hours > 0 && weeks > 0) {
                        const displayHours = isNormalized ? (hours / weeks) * 4.33 : hours;
                        const rawFtes = displayHours / HOURS_PER_MONTH;
                        const decimal = rawFtes % 1;
                        totalFtes += decimal > 0.1 ? Math.ceil(rawFtes) : Math.floor(rawFtes);
                        monthsWithData++;
                      }
                    });
                    if (monthsWithData === 0) return <span className="text-slate-300">—</span>;
                    const avgFtes = totalFtes / monthsWithData;
                    const decimal = avgFtes % 1;
                    return decimal > 0.1 ? Math.ceil(avgFtes) : Math.floor(avgFtes);
                  })()}
                </td>
              </tr>

              {/* Actual HC Input Row */}
              <tr className="bg-teal-50/60 border-b border-teal-100 hover:bg-teal-50 transition-colors duration-150">
                <td className="px-3 py-2.5 font-medium text-slate-700 sticky left-0 bg-teal-50/60 z-10">
                  Actual HC
                </td>
                {months.map(month => (
                  <td key={month} className="px-1 py-1.5">
                    {isCombinedView ? (
                      <div className="text-center text-teal-700 font-semibold tabular-nums">
                        {combinedData[month]?.actualFtes || <span className="text-slate-300">—</span>}
                      </div>
                    ) : (
                      <input
                        type="text"
                        value={actualFtes[month]}
                        onChange={(e) => handleActualFtesChange(month, e.target.value)}
                        placeholder="0"
                        className="w-full px-1 py-1.5 border border-slate-200 rounded text-center text-sm font-mono focus:ring-2 focus:ring-teal-400 focus:border-teal-400 outline-none bg-white transition-all duration-150 hover:border-teal-300"
                      />
                    )}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center bg-teal-100/80">
                  <div className="text-xs text-slate-500 mb-0.5">Avg</div>
                  <span className="font-bold text-teal-800 text-base tabular-nums">
                    {isCombinedView
                      ? formatNumber(
                          months.reduce((sum, m) => sum + (combinedData[m]?.actualFtes || 0), 0) / 
                          (months.filter(m => (combinedData[m]?.actualFtes || 0) > 0).length || 1),
                          1
                        )
                      : formatNumber(
                          months.reduce((sum, m) => sum + (parseFloat(actualFtes[m]) || 0), 0) / 
                          (months.filter(m => parseFloat(actualFtes[m]) > 0).length || 1),
                          1
                        )
                    }
                  </span>
                </td>
              </tr>

              {/* Scheduled HC Row (from crews table) */}
              <tr className="bg-cyan-50/60 border-b border-cyan-100 hover:bg-cyan-50 transition-colors duration-150">
                <td className="px-3 py-2.5 font-medium text-slate-700 sticky left-0 bg-cyan-50/60 z-10">
                  Scheduled HC
                  <span className="text-xs text-slate-400 ml-1">(crews)</span>
                </td>
                {months.map(month => (
                  <td key={month} className="px-2 py-2.5 text-center text-cyan-700 font-semibold tabular-nums">
                    {scheduledHC || <span className="text-slate-300">—</span>}
                  </td>
                ))}
                <td className="px-3 py-2.5 text-center bg-cyan-100/80">
                  <span className="font-bold text-cyan-800 text-base tabular-nums">
                    {scheduledHC || <span className="text-slate-300">—</span>}
                  </span>
                </td>
              </tr>

              {/* Actual DL % Row (based on HC) */}
              <tr className="bg-teal-50/30 border-b border-teal-100/50 hover:bg-teal-50/50 transition-colors duration-150">
                <td className="px-3 py-2 text-xs font-medium text-slate-500 sticky left-0 bg-teal-50/30 z-10">
                  Actual DL %{isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}
                </td>
                {months.map(month => {
                  const rev = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const ftes = isCombinedView ? (combinedData[month]?.actualFtes || 0) : (parseFloat(actualFtes[month]) || 0);
                  const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  if (rev === 0 || ftes === 0) {
                    return (
                      <td key={month} className="px-2 py-2 text-center"><span className="text-slate-300">—</span></td>
                    );
                  }
                  const hoursMultiplier = isNormalized ? HOURS_PER_MONTH : (HOURS_PER_MONTH / 4.33) * weeks;
                  const actualLaborCostCalc = ftes * hoursMultiplier * hourlyRate;
                  const actualDL = (actualLaborCostCalc / rev) * 100;
                  return (
                    <td key={month} className="px-2 py-2 text-center">
                      <span className={`text-xs font-bold tabular-nums ${actualDL > 40 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {formatNumber(actualDL, 1)}%
                      </span>
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center bg-teal-100/50">
                  {(() => {
                    const totalRev = totals.revenue;
                    const totalActualFtes = isCombinedView 
                      ? months.reduce((sum, m) => sum + (combinedData[m]?.actualFtes || 0), 0)
                      : months.reduce((sum, m) => sum + (parseFloat(actualFtes[m]) || 0), 0);
                    const monthsWithFtes = isCombinedView
                      ? months.filter(m => (combinedData[m]?.actualFtes || 0) > 0).length
                      : months.filter(m => parseFloat(actualFtes[m]) > 0).length;
                    const avgActualFtes = monthsWithFtes > 0 ? totalActualFtes / monthsWithFtes : 0;
                    const monthsWithRev = isCombinedView
                      ? months.filter(m => (combinedData[m]?.revenue || 0) > 0).length
                      : months.filter(m => parseRevenue(monthlyRevenue[m]) > 0).length;
                    const avgRev = monthsWithRev > 0 ? totalRev / monthsWithRev : 0;
                    if (avgRev === 0 || avgActualFtes === 0) return <span className="text-slate-300">—</span>;
                    // For total, calculate weighted average of weeks
                    const avgWeeks = months.reduce((sum, m) => {
                      const weeks = isCombinedView ? (combinedData[m]?.weeks || 4.33) : (parseFloat(weeksInMonth[m]) || 4.33);
                      return sum + weeks;
                    }, 0) / 12;
                    const hoursMultiplier = isNormalized ? HOURS_PER_MONTH : (HOURS_PER_MONTH / 4.33) * avgWeeks;
                    const avgDL = (avgActualFtes * hoursMultiplier * hourlyRate / avgRev) * 100;
                    return (
                      <span className={`text-sm font-bold tabular-nums ${avgDL > 40 ? 'text-red-600' : 'text-emerald-600'}`}>
                        {formatNumber(avgDL, 1)}%
                      </span>
                    );
                  })()}
                </td>
              </tr>

              {/* Maint Crews Row */}
              <tr className="bg-slate-100/60 border-b border-slate-200 hover:bg-slate-100 transition-colors duration-150">
                <td className="px-3 py-2 text-xs font-medium text-slate-500 sticky left-0 bg-slate-100/60 z-10">
                  <div className="flex items-center gap-1.5">
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h8m-8 4h8m-4 4v-4m-6 8h12a2 2 0 002-2V7a2 2 0 00-2-2h-3l-1-2H10L9 5H6a2 2 0 00-2 2v10a2 2 0 002 2z" />
                    </svg>
                    <span>Maint Crews (4m){isNormalized && <span className="inline-block w-1.5 h-1.5 bg-blue-500 rounded-full ml-1"></span>}</span>
                  </div>
                </td>
                {months.map((month, index) => {
                  const revenue = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                  const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                  const laborHours = laborBudget / hourlyRate;
                  const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                  const displayHours = isNormalized 
                    ? laborHours 
                    : (laborHours / 4.33) * weeks;
                  const displayFtes = Math.floor(displayHours / HOURS_PER_MONTH);
                  const crews = displayFtes > 0 ? Math.ceil(displayFtes / 4) : null;
                  
                  // Calculate prior month's crews
                  let priorCrews = null;
                  if (index > 0) {
                    const priorMonth = months[index - 1];
                    const priorRevenue = isCombinedView ? (combinedData[priorMonth]?.revenue || 0) : parseRevenue(monthlyRevenue[priorMonth]);
                    const priorLaborBudget = priorRevenue * (1 - GROSS_MARGIN_TARGET);
                    const priorLaborHours = priorLaborBudget / hourlyRate;
                    const priorWeeks = isCombinedView ? (combinedData[priorMonth]?.weeks || 4.33) : (parseFloat(weeksInMonth[priorMonth]) || 4.33);
                    const priorDisplayHours = isNormalized 
                      ? priorLaborHours 
                      : (priorLaborHours / 4.33) * priorWeeks;
                    const priorDisplayFtes = Math.floor(priorDisplayHours / HOURS_PER_MONTH);
                    priorCrews = priorDisplayFtes > 0 ? Math.ceil(priorDisplayFtes / 4) : null;
                  }
                  
                  const hasJump = crews !== null && priorCrews !== null && crews !== priorCrews;
                  
                  return (
                    <td key={month} className={`px-2 py-2 text-center text-xs tabular-nums ${hasJump ? 'bg-amber-100 text-amber-800 font-bold' : 'text-slate-600 font-medium'}`}>
                      {crews !== null ? crews : <span className="text-slate-300">—</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-center text-sm font-bold text-slate-700 bg-slate-200/80 tabular-nums">
                  {(() => {
                    const totalHours = months.reduce((sum, month) => {
                      const revenue = isCombinedView ? (combinedData[month]?.revenue || 0) : parseRevenue(monthlyRevenue[month]);
                      const laborBudget = revenue * (1 - GROSS_MARGIN_TARGET);
                      const laborHours = laborBudget / hourlyRate;
                      const weeks = isCombinedView ? (combinedData[month]?.weeks || 4.33) : (parseFloat(weeksInMonth[month]) || 4.33);
                      return sum + (isNormalized ? laborHours : (laborHours / 4.33) * weeks);
                    }, 0);
                    const avgFtes = Math.floor(totalHours / HOURS_PER_MONTH / 12);
                    return avgFtes > 0 ? Math.ceil(avgFtes / 4) : <span className="text-slate-300">—</span>;
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
                    
                    let totalActualCost, totalRevenue;
                    
                    if (isCombinedView) {
                      // Use encoreData for Encore view
                      totalActualCost = ytdMonths.reduce((sum, month) => sum + (combinedData[month]?.laborCost || 0), 0);
                      totalRevenue = ytdMonths.reduce((sum, month) => sum + (combinedData[month]?.revenue || 0), 0);
                    } else {
                      // Use local state for single branch
                      totalActualCost = ytdMonths.reduce((sum, month) => sum + parseRevenue(actualLaborCost[month]), 0);
                      totalRevenue = ytdMonths.reduce((sum, month) => sum + parseRevenue(monthlyRevenue[month]), 0);
                    }
                    
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
                  const branchHourlyRate = getHourlyRateByBranch(branch);
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