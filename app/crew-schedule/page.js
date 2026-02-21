"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { 
  useCrews, 
  useBranches,
  useCrewSchedule,
  useCrewDayData
} from '../hooks/useSupabase';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

// Get branch icon path based on branch name
const getIconPath = (branchName) => {
  if (!branchName) return null;
  
  const name = branchName.toLowerCase();
  if (name.includes('vegas') || name.includes('lv')) {
    return '/lv.png';
  } else if (name.includes('north')) {
    return '/n.png';
  } else if (name.includes('southeast') || name.includes('se')) {
    return '/se.png';
  } else if (name.includes('southwest') || name.includes('sw')) {
    return '/sw.png';
  }
  return null;
};

export default function CrewSchedulePrintPage() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const [session, setSession] = useState(null);
  
  // Fetch data using existing hooks
  const { crews = [], loading: crewsLoading } = useCrews();
  const { branches = [], loading: branchesLoading } = useBranches();

  // State
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedCrewId, setSelectedCrewId] = useState(null);
  const [expandedPropertyId, setExpandedPropertyId] = useState(null);
  
  // Get the selected crew object - handle both string and number IDs
  const selectedCrew = crews.find(c => String(c.id) === String(selectedCrewId));
  
  // Use the crew schedule hook - this returns full property objects organized by day
  const { schedule: savedSchedule, loading: scheduleLoading } = useCrewSchedule(selectedCrewId);
  
  // Use the crew day data hook for drive time
  const { crewDayData, loading: crewDayLoading } = useCrewDayData(selectedCrewId);

  // Constants
  const WEEKS_PER_MONTH = 4.33;
  const TARGET_DL_PERCENT = 40;
  const DRIVE_TIME_FACTOR = 0.9;
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  
  // Branch-specific hourly costs by crew type
  const HOURLY_COST_LAS_VEGAS_MAINTENANCE = 24.50;
  const HOURLY_COST_PHOENIX_MAINTENANCE = 25.50;
  const HOURLY_COST_LAS_VEGAS_ONSITE = 25.00;
  const HOURLY_COST_PHOENIX_ONSITE = 30.00;
  const DEFAULT_HOURLY_COST = 25.00;
  
  // Get selected branch for calculations
  const selectedBranch = branches.find(b => b.id === selectedBranchId);
  
  // Helper function to get hourly cost based on branch name and crew type
  const getHourlyCost = (branchName, crewType) => {
    if (!branchName) return DEFAULT_HOURLY_COST;
    
    const name = branchName.toLowerCase();
    const isOnsite = crewType === 'Onsite';
    
    // Las Vegas branch
    if (name.includes('las vegas') || name.includes('vegas')) {
      return isOnsite ? HOURLY_COST_LAS_VEGAS_ONSITE : HOURLY_COST_LAS_VEGAS_MAINTENANCE;
    }
    
    // Phoenix branches (Southeast, Southwest, North)
    if (name.includes('phoenix') || 
        name.includes('southeast') || 
        name.includes('southwest') || 
        name.includes('north')) {
      return isOnsite ? HOURLY_COST_PHOENIX_ONSITE : HOURLY_COST_PHOENIX_MAINTENANCE;
    }
    
    return DEFAULT_HOURLY_COST;
  };
  
  // Helper function to get drive time factor based on crew type
  const getDriveTimeFactor = (crewType) => {
    return crewType === 'Onsite' ? 1.0 : DRIVE_TIME_FACTOR;
  };

  // Calculate DL metrics for a property - uses selected crew's branch and type
  const calculatePropertyMetrics = (job) => {
    // Use adjusted_hours if set, otherwise fall back to current_hours (same as Direct Labor Calculator)
    const currentHours = job.adjusted_hours !== null ? job.adjusted_hours : (job.current_hours || 0);
    const monthlyRevenue = job.monthly_invoice || 0;
    
    // Get hourly cost and drive time factor based on selected crew
    const hourlyCost = getHourlyCost(selectedBranch?.name, selectedCrew?.crew_type);
    const driveTimeFactor = getDriveTimeFactor(selectedCrew?.crew_type);
    
    // Monthly labor cost
    const laborCost = currentHours * hourlyCost * WEEKS_PER_MONTH;
    
    // DL% - labor cost as % of revenue (adjusted for drive time)
    const dlPercent = monthlyRevenue > 0 ? (laborCost / (monthlyRevenue * driveTimeFactor)) * 100 : 0;
    
    // Target hours formula: (Monthly Invoice × Target DL%) × driveTimeFactor ÷ hourlyCost ÷ 4.33
    const targetHours = (monthlyRevenue * (TARGET_DL_PERCENT / 100) * driveTimeFactor) / hourlyCost / WEEKS_PER_MONTH;
    
    return { currentHours, targetHours, dlPercent, laborCost, monthlyRevenue };
  };

  // Check authentication
  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (!session) {
        router.push('/login');
      }
    };
    getSession();
  }, [supabase, router]);

  // Set default branch when branches load
  useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  // Filter crews by selected branch (Maintenance only)
  const filteredCrews = crews.filter(c => 
    c.branch_id === selectedBranchId && c.crew_type === 'Maintenance'
  );

  // Set default crew when filtered crews change
  useEffect(() => {
    if (filteredCrews.length > 0 && !selectedCrewId) {
      setSelectedCrewId(filteredCrews[0].id);
    } else if (filteredCrews.length > 0 && !filteredCrews.find(c => String(c.id) === String(selectedCrewId))) {
      // Only reset if the selected crew is not in the filtered list (e.g., branch changed)
      setSelectedCrewId(filteredCrews[0].id);
    }
  }, [filteredCrews.length, selectedBranchId]); // Only depend on length and branch, not the full array

  // The savedSchedule from useCrewSchedule already contains full property objects
  // organized by day: { Monday: [props], Tuesday: [props], ..., unassigned: [props] }
  const weekSchedule = savedSchedule || {
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
    Saturday: []
  };
  
  // Get unassigned properties for the branch
  const unassignedProperties = savedSchedule?.unassigned || [];

  // Calculate daily totals
  const calculateDayTotals = (dayJobs) => {
    const totalManHours = dayJobs.reduce((sum, job) => {
      const hours = job.adjusted_hours !== null ? job.adjusted_hours : (job.current_hours || 0);
      return sum + hours;
    }, 0);
    const crewSize = selectedCrew?.size || 4;
    const crewHours = crewSize > 0 ? totalManHours / crewSize : 0;
    return { totalManHours, crewHours };
  };

  // Calculate weekly totals
  const calculateWeeklyTotals = () => {
    let totalManHours = 0;
    let totalCrewHours = 0;
    
    days.forEach(day => {
      const dayJobs = weekSchedule[day] || [];
      const { totalManHours: dayManHours, crewHours: dayCrewHours } = calculateDayTotals(dayJobs);
      totalManHours += dayManHours;
      totalCrewHours += dayCrewHours;
    });
    
    return { totalManHours, totalCrewHours };
  };

  // Format hours to show hours and minutes
  const formatHoursWithMinutes = (hours) => {
    const wholeHours = Math.floor(hours);
    const minutes = Math.round((hours - wholeHours) * 60);
    return `${hours.toFixed(1)} Hours or ${minutes} minutes`;
  };

  // Format time window
  const formatTimeWindow = (time) => {
    if (!time) return '';
    // Handle both "HH:MM:SS" and "HH:MM" formats
    const parts = time.split(':');
    const hours = parseInt(parts[0], 10);
    const minutes = parts[1] || '00';
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  // Get branch name
  const getBranchName = (branchId) => {
    const branch = branches.find(b => b.id === branchId);
    return branch?.name || 'Unknown';
  };

  // Handle print
  const handlePrint = () => {
    window.print();
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (!selectedCrew) return;

    const crewSize = selectedCrew.size || 4;
    const branchName = getBranchName(selectedCrew.branch_id);
    
    let csvContent = '';
    
    // Header rows
    csvContent += `,${selectedCrew.name} SCHEDULE (${crewSize}-Man),,,,Crew Leader:,${selectedCrew.supervisor || ''},,,,Truck:,,,,,\n`;
    csvContent += `,,,,,Field Supervisor:,,,,,Riding Mower #,,,,,\n`;
    csvContent += `,,,,,Irrigation Tech:,,,,,Push Mower #,,,,,\n`;
    csvContent += `Service Day,Job Name,Address,OnProperty Man Hrs,OnProperty Crew Hrs,Total Crew Hours (Hours on site),Turf,Flowers,time_window_start,time_window_end,AM,Property Related Information,,Cutbacks,,,\n`;
    csvContent += `\n`;

    // Daily schedules
    days.forEach(day => {
      const dayJobs = weekSchedule[day] || [];
      
      if (dayJobs.length > 0) {
        dayJobs.forEach((job, index) => {
          const manHours = job.adjusted_hours !== null ? job.adjusted_hours : (job.current_hours || 0);
          const crewHours = crewSize > 0 ? manHours / crewSize : 0;
          const hasTurf = job.has_turf ? 'TRUE' : 'FALSE';
          const hasFlowers = job.has_flowers ? 'TRUE' : 'FALSE';
          const timeStart = job.service_window_start || '6:00:00';
          const timeEnd = job.service_window_end || '14:30:00';
          
          csvContent += `${index === 0 ? day : ''},${job.name || ''},"${job.address || ''}",${manHours.toFixed(1)},${formatHoursWithMinutes(crewHours)},${crewHours.toFixed(1)},${hasTurf},${hasFlowers},${timeStart},${timeEnd},${job.account_manager || ''},${job.notes || ''},${selectedCrew.name},${day},,,\n`;
        });
        
        // Day total
        const { totalManHours, crewHours } = calculateDayTotals(dayJobs);
        csvContent += `,,Total :,${totalManHours.toFixed(1)},,${crewHours.toFixed(1)},,,,,,,,${day},${day},${day},\n`;
      }
    });

    // Weekly total
    const { totalManHours, totalCrewHours } = calculateWeeklyTotals();
    csvContent += `Miles Driven:,,Total :,${totalManHours.toFixed(1)},,${totalCrewHours.toFixed(1)},,,,,,,,,,\n`;

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `Crew_Schedule_-_${branchName}_Branch_-_${selectedCrew.name}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Loading state
  if (crewsLoading || branchesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="w-full max-w-2xl px-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-7 w-7 rounded-full border-[3px] border-blue-600 border-t-transparent animate-spin" />
            <p className="text-lg font-semibold text-black">Loading schedule data...</p>
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

  const weeklyTotals = calculateWeeklyTotals();

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Print Styles */}
      <style jsx global>{`
        @media print {
          * {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 100% !important;
          }
          .no-print, nav, header {
            display: none !important;
          }
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .print-area > div {
            box-shadow: none !important;
            border-radius: 0 !important;
            margin: 0 !important;
            width: 100% !important;
            max-width: 100% !important;
          }
          .print-area table {
            width: 100% !important;
            font-size: 8px;
            line-height: 1.1;
          }
          .print-area td, .print-area th {
            padding: 1px 2px !important;
          }
          .print-area .text-xs {
            font-size: 8px !important;
          }
          .print-area h2 {
            font-size: 10px !important;
          }
          .print-area .bg-yellow-100 {
            padding: 2px 4px !important;
          }
          .print-area .bg-yellow-100 .text-xs {
            font-size: 7px !important;
          }
          @page {
            size: landscape;
            margin: 0.2in;
          }
        }
      `}</style>

      {/* Navigation Header - Hidden on Print */}
      <div className="no-print bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex justify-between items-center">
            <div className="flex items-center space-x-4">
              <Link 
                href="/" 
                className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 shadow-sm transition-colors flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                </svg>
                <span>Back to Calculator</span>
              </Link>
              
              <Link 
                href="/schedule" 
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 transition-colors flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
                <span>Drag & Drop Schedule</span>
              </Link>
            </div>

            <h1 className="text-xl font-bold text-gray-800">Crew Schedule</h1>

            <div className="flex items-center space-x-3">
              <button
                onClick={handleExportCSV}
                className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>Export CSV</span>
              </button>
              
              <button
                onClick={handlePrint}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" />
                </svg>
                <span>Print</span>
              </button>
            </div>
          </div>

          {/* Branch and Crew Selectors */}
          <div className="mt-4 space-y-3">
            {/* Branch Selector */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Branch:</label>
              <div className="flex space-x-2">
                {branches.map(branch => (
                  <button
                    key={branch.id}
                    onClick={() => {
                      setSelectedBranchId(branch.id);
                      setSelectedCrewId(null);
                    }}
                    className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center space-x-2 ${
                      selectedBranchId === branch.id
                        ? 'text-white shadow-md'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    style={{
                      backgroundColor: selectedBranchId === branch.id ? (branch.color || '#4F46E5') : undefined
                    }}
                  >
                    {getIconPath(branch.name) && (
                      <Image 
                        src={getIconPath(branch.name)} 
                        alt={branch.name} 
                        width={20} 
                        height={20}
                        className="rounded"
                      />
                    )}
                    <span>{branch.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Crew Selector */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Crew:</label>
              <select
                value={selectedCrewId || ''}
                onChange={(e) => setSelectedCrewId(e.target.value || null)}
                className="border border-gray-300 rounded-lg px-4 py-2 bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {filteredCrews.length === 0 ? (
                  <option value="">No crews available</option>
                ) : (
                  filteredCrews.map(crew => (
                    <option key={crew.id} value={crew.id}>
                      {crew.name} ({crew.size}-Man)
                    </option>
                  ))
                )}
              </select>
              
              {/* Loading indicator for schedule */}
              {scheduleLoading && (
                <div className="flex items-center text-black">
                  <div className="w-4 h-4 rounded-full border-2 border-blue-600 border-t-transparent animate-spin mr-2"></div>
                  <span className="text-sm font-medium">Loading schedule...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Printable Schedule Area */}
      <div className="print-area max-w-7xl mx-auto p-4">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          
          {/* Unassigned Properties Box */}
          {unassignedProperties.length > 0 && (
            <div className="px-3 py-2 bg-yellow-100 border-b-2 border-yellow-300">
              <div className="flex items-start">
                <div className="flex-shrink-0 mr-2">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-yellow-600 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <div className="flex-1">
                  <p className="text-xs font-semibold text-yellow-800 mb-1">
                    Unscheduled Properties ({unassignedProperties.length}) — {selectedBranch?.name}
                  </p>
                  <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-yellow-700">
                    {unassignedProperties.map(prop => (
                      <span key={prop.id} className="whitespace-nowrap">• {prop.name}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Schedule Header */}
          <div className="px-2 py-1.5 border-b-2 border-gray-300">
            <div className="flex justify-between items-center">
              <div className="flex items-center">
                {selectedBranch && getIconPath(selectedBranch.name) && (
                  <Image 
                    src={getIconPath(selectedBranch.name)} 
                    alt={selectedBranch.name} 
                    width={28} 
                    height={28} 
                    className="mr-2"
                  />
                )}
                <h2 className="text-sm font-bold text-gray-900">
                  {selectedCrew?.name || 'Select Crew'} ({selectedCrew?.size || 4}-Man) — {selectedBranch?.name}
                </h2>
              </div>
              <div className="flex items-center space-x-4 text-xs">
                <span><span className="text-gray-500">Leader:</span> <span className="font-medium">{selectedCrew?.supervisor || '—'}</span></span>
                <span><span className="text-gray-500">Truck:</span> <span className="font-medium">{selectedCrew?.vehicle || '—'}</span></span>
              </div>
            </div>
          </div>

          {/* Schedule Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-800 text-white">
                <tr>
                  <th className="px-1.5 py-0.5 text-left font-bold text-xs" style={{width: '60px'}}>Day</th>
                  <th className="px-1.5 py-0.5 text-left font-medium text-xs" style={{width: '22%'}}>Job Name</th>
                  <th className="px-1.5 py-0.5 text-left font-medium text-xs" style={{width: '22%'}}>Address</th>
                  <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '50px'}}>Man Hrs</th>
                  <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '70px'}}>Crew Hrs</th>
                  <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '35px'}}>Turf</th>
                  <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '35px'}}>Flowers</th>
                  <th className="px-1.5 py-0.5 text-left font-medium text-xs" style={{width: '70px'}}>CSS</th>
                  <th className="px-1.5 py-0.5 text-left font-medium text-xs">Notes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {days.map(day => {
                  const dayJobs = weekSchedule[day] || [];
                  const { totalManHours, crewHours } = calculateDayTotals(dayJobs);
                  const crewSize = selectedCrew?.size || 4;

                  if (dayJobs.length === 0) {
                    return (
                      <tr key={day} className="bg-gray-50">
                        <td className="px-1.5 py-0.5 font-bold text-gray-900 text-xs bg-orange-100">{day}</td>
                        <td colSpan={8} className="px-1.5 py-0.5 text-gray-400 italic text-xs">No jobs scheduled</td>
                      </tr>
                    );
                  }

                  return (
                    <React.Fragment key={day}>
                      {dayJobs.map((job, index) => {
                        const manHours = job.adjusted_hours !== null ? job.adjusted_hours : (job.current_hours || 0);
                        const jobCrewHours = crewSize > 0 ? manHours / crewSize : 0;
                        const minutes = Math.round(jobCrewHours * 60);
                        
                        const isExpanded = expandedPropertyId === job.id;
                        const metrics = calculatePropertyMetrics(job);
                        
                        return (
                          <React.Fragment key={job.id}>
                            <tr 
                              className="hover:bg-gray-50 cursor-pointer transition-all duration-150 hover:-translate-y-0.5 hover:shadow-md"
                              onClick={() => setExpandedPropertyId(isExpanded ? null : job.id)}
                            >
                              <td className={`px-1.5 py-0.5 font-bold text-gray-900 text-xs ${index === 0 ? 'bg-orange-100' : ''}`}>
                                {index === 0 ? day : ''}
                              </td>
                              <td className="px-1.5 py-0.5 text-xs truncate max-w-0" title={job.name}>
                                {job.map_link ? (
                                  <a 
                                    href={job.map_link} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="text-blue-600 hover:text-blue-800 hover:underline"
                                  >
                                    {job.name}
                                  </a>
                                ) : (
                                  <span className="text-gray-900">{job.name}</span>
                                )}
                              </td>
                              <td className="px-1.5 py-0.5 text-gray-600 text-xs truncate max-w-0" title={job.address}>{job.address || '—'}</td>
                              <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs">{manHours.toFixed(1)}</td>
                              <td className="px-1.5 py-0.5 text-center text-gray-600 text-xs whitespace-nowrap">
                                {jobCrewHours.toFixed(1)} ({minutes}m)
                              </td>
                              <td className="px-1.5 py-0.5 text-center">
                                {job.has_turf && (
                                  <span className="inline-block w-2.5 h-2.5 bg-green-500 rounded-full" title="Has Turf"></span>
                                )}
                              </td>
                              <td className="px-1.5 py-0.5 text-center">
                                {job.has_flowers && (
                                  <span className="inline-block w-2.5 h-2.5 bg-pink-500 rounded-full" title="Has Flowers"></span>
                                )}
                              </td>
                              <td className="px-1.5 py-0.5 text-gray-600 text-xs truncate max-w-0" title={job.account_manager}>{job.account_manager || ''}</td>
                              <td className="px-1.5 py-0.5 text-gray-600 text-xs truncate max-w-0">{job.notes || ''}</td>
                            </tr>
                            {/* Expanded metrics row */}
                            {isExpanded && (
                              <tr className="bg-blue-50 border-l-4 border-blue-400 no-print">
                                <td colSpan={9} className="px-3 py-2">
                                  <div className="flex items-center space-x-6 text-xs">
                                    <div className="flex items-center space-x-1">
                                      <span className="text-gray-500">Monthly Revenue:</span>
                                      <span className="font-semibold text-gray-800">${metrics.monthlyRevenue.toLocaleString()}</span>
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      <span className="text-gray-500">Monthly Labor Cost:</span>
                                      <span className="font-semibold text-gray-800">${metrics.laborCost.toFixed(0)}</span>
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      <span className="text-gray-500">DL%:</span>
                                      <span className={`font-semibold px-1.5 py-0.5 rounded ${metrics.dlPercent <= TARGET_DL_PERCENT ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {metrics.dlPercent.toFixed(1)}%
                                      </span>
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      <span className="text-gray-500">Current Hrs:</span>
                                      <span className="font-semibold text-gray-800">{metrics.currentHours.toFixed(1)}</span>
                                    </div>
                                    <div className="flex items-center space-x-1">
                                      <span className="text-gray-500">Target Hrs:</span>
                                      <span className={`font-semibold px-1.5 py-0.5 rounded ${metrics.currentHours <= metrics.targetHours ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                                        {metrics.targetHours.toFixed(1)}
                                      </span>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {/* Day Total Row */}
                      {/* Day Total Row */}
                      <tr className="bg-gray-100 font-bold border-b-2 border-gray-300">
                        <td className="px-1.5 py-0.5"></td>
                        <td className="px-1.5 py-0.5 text-right text-gray-700 text-xs">Total:</td>
                        <td className="px-1.5 py-0.5"></td>
                        <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs">{totalManHours.toFixed(1)}</td>
                        <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs">{crewHours.toFixed(1)}</td>
                        <td colSpan={4}></td>
                      </tr>
                    </React.Fragment>
                  );
                })}
                
                {/* Weekly Total Row */}
                <tr className="bg-blue-100 font-bold">
                  <td className="px-1.5 py-1"></td>
                  <td className="px-1.5 py-1 text-right text-blue-900 text-xs">Weekly Total:</td>
                  <td className="px-1.5 py-1"></td>
                  <td className="px-1.5 py-1 text-center text-blue-900 text-xs">{weeklyTotals.totalManHours.toFixed(1)}</td>
                  <td className="px-1.5 py-1 text-center text-blue-900 text-xs">{weeklyTotals.totalCrewHours.toFixed(1)}</td>
                  <td colSpan={4}></td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Footer Notes */}
          <div className="px-2 py-1 bg-gray-50 border-t text-xs text-gray-600">
            <div className="flex items-center space-x-3">
              <div className="flex items-center">
                <span className="inline-block w-2.5 h-2.5 bg-green-500 rounded-full mr-1"></span>
                <span>Turf</span>
              </div>
              <div className="flex items-center">
                <span className="inline-block w-2.5 h-2.5 bg-pink-500 rounded-full mr-1"></span>
                <span>Flowers</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}