"use client";

import React, { useState, useEffect } from 'react';
import { useProperties, useCrews, useBranches, updatePropertyHours, usePropertyOptions } from '../hooks/useSupabase';
import Link from 'next/link';
import Image from 'next/image';
import { useSession, useSupabaseClient } from '@supabase/auth-helpers-react';
// No need to import PropertyForm as we're navigating to properties page

// Custom Branch Dropdown Component (inline for easy copy/paste)
const BranchDropdown = ({ branches, selectedBranchId, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = React.useRef(null);
  
  // Get selected branch
  const selectedBranch = branches.find(branch => branch.id === selectedBranchId) || {};
  
  // Get icon based on branch name
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

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="border rounded-lg pl-3 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium bg-white shadow-sm flex items-center"
        style={{ minWidth: '180px' }}
      >
        {selectedBranchId ? (
          <div className="flex items-center">
            {getIconPath(selectedBranch.name) && (
              <div className="mr-2">
                <img 
                  src={getIconPath(selectedBranch.name)} 
                  alt=""
                  width={20}
                  height={20}
                  style={{ display: 'inline-block' }}
                  onError={(e) => { e.target.style.display = 'none'; }}
                />
              </div>
            )}
            <span>{selectedBranch.name}</span>
          </div>
        ) : (
          <span>All Branches</span>
        )}
        
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>
      
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md bg-white shadow-lg">
          <div className="py-1 max-h-60 overflow-y-auto">
            <button
              type="button"
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100"
              onClick={() => {
                onChange(null);
                setIsOpen(false);
              }}
            >
              All Branches
            </button>
            
            {branches.map((branch) => (
              <button
                key={branch.id}
                type="button"
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center"
                onClick={() => {
                  onChange(branch.id);
                  setIsOpen(false);
                }}
              >
                {getIconPath(branch.name) && (
                  <div className="mr-2">
                    <img 
                      src={getIconPath(branch.name)} 
                      alt=""
                      width={20}
                      height={20}
                      style={{ display: 'inline-block' }}
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  </div>
                )}
                <span>{branch.name}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

const DirectLaborCalculator = () => {
  // Auth related state
  const session = useSession();
  const supabase = useSupabaseClient();

  // Handle sign out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload(); // Reload to update UI
  };
  
  // Constants for calculations
  const DRIVE_TIME_FACTOR = 0.9;
  const HOURLY_COST = 24.75;
  const WEEKS_PER_MONTH = 4.33;
  const HOURS_PER_WEEK = 40; // Weekly hours for headcount calculation
  
  // State for target direct labor percentage
  const [targetDirectLaborPercent, setTargetDirectLaborPercent] = useState(0.40);
  const [targetDirectLaborInput, setTargetDirectLaborInput] = useState("40");
  
  // State for pagination and filters
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedCrewId, setSelectedCrewId] = useState(null);
  const [selectedCrewType, setSelectedCrewType] = useState('');
  const [page, setPage] = useState(1);
  const pageSize = 50; // Increased from 10 to 50
  
  // State for advanced filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [regionFilter, setRegionFilter] = useState('');
  const [accountManagerFilter, setAccountManagerFilter] = useState('');
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  
  // State for tracking edited hours
  const [editedHours, setEditedHours] = useState({});
  
  // State for tracking which property is currently being saved
  const [savingPropertyId, setSavingPropertyId] = useState(null);
  
  // State for messages
  const [message, setMessage] = useState({ text: '', type: '' });
  
  // Fetch data using custom hooks
  const { branches, loading: branchesLoading } = useBranches();
  const { crews, loading: crewsLoading } = useCrews(selectedBranchId);
  const { options, loading: optionsLoading } = usePropertyOptions();
  
  // Fetch properties with pagination
  const { 
    properties, 
    loading: propertiesLoading, 
    count, 
    totalPages,
    totalMonthlyInvoice: backendTotalMonthlyInvoice,
    totalCurrentHours: backendTotalCurrentHours,
    totalNewHours: backendTotalNewHours,
    refetchProperties  // Extract the refetch function
  } = useProperties({
    branchId: selectedBranchId,
    crewId: selectedCrewId,
    crewType: selectedCrewType,
    region: regionFilter,
    accountManager: accountManagerFilter,
    propertyType: propertyTypeFilter,
    company: companyFilter,
    client: clientFilter,
    page,
    pageSize,
    fetchAllTotals: true  // Add this flag to ensure we get correct totals
  });
  
  // Determine if any data is loading
  const isLoading = branchesLoading || crewsLoading || propertiesLoading || optionsLoading;
  
  // Get selected branch
  const selectedBranch = branches.find(branch => branch.id === selectedBranchId) || {};
  
  // Calculate target hours based on formula
  const calculateTargetHours = (monthlyInvoice) => {
    return (monthlyInvoice * targetDirectLaborPercent * DRIVE_TIME_FACTOR) / (HOURLY_COST * WEEKS_PER_MONTH);
  };

  // Calculate direct labor percentage
  const calculateDirectLaborPercent = (hours, monthlyInvoice) => {
    if (hours === 0 || monthlyInvoice === 0) return 0;
    return (hours * HOURLY_COST * WEEKS_PER_MONTH) / (monthlyInvoice * DRIVE_TIME_FACTOR) * 100;
  };
  
  // Calculate weekly cost from hours - UPDATED to not multiply by WEEKS_PER_MONTH
  const calculateWeeklyCost = (hours) => {
    return hours * HOURLY_COST;
  };

  // Handle change for new hours input
  const handleNewHoursChange = (id, value) => {
    const newValue = value === "" ? "" : parseFloat(value);
    setEditedHours({
      ...editedHours,
      [id]: newValue
    });
  };
  
  // Clear all filters
  const clearFilters = () => {
    setRegionFilter('');
    setAccountManagerFilter('');
    setPropertyTypeFilter('');
    setCompanyFilter('');
    setClientFilter('');
    setSelectedCrewType('');
    setPage(1);
  };
  
  // Save changes to Supabase - UPDATED to use refetchProperties
  const saveNewHours = async (id, newHours) => {
    try {
      // Set the saving state to show loading indicator
      setSavingPropertyId(id);
      
      // Call the API to update the hours
      const result = await updatePropertyHours(id, newHours);
      
      if (result.success) {
        // Remove from edited hours once saved
        const updatedEditedHours = { ...editedHours };
        delete updatedEditedHours[id];
        setEditedHours(updatedEditedHours);
        
        // Refetch the data instead of reloading the page
        await refetchProperties();
        
        // Success notification could be added here
      } else {
        // Handle error - could add a toast notification here
        console.error('Failed to save:', result.error);
      }
    } catch (error) {
      console.error('Error saving hours:', error);
    } finally {
      // Clear the saving state
      setSavingPropertyId(null);
    }
  };

  // We no longer need property form handlers as we're navigating to another page

  // Format currency without decimal points
  const formatCurrency = (amount) => {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(amount);
  };

  // Format percentage
  const formatPercent = (value) => {
    return `${value.toFixed(1)}%`;
  };
  
  // Format numbers with commas and no decimals
  const formatNumber = (value) => {
    return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(value);
  };

  // Format headcount - adding 10% for drive time
  const formatHeadcount = (hours) => {
    // Add 10% for drive time before calculating headcount
    const hoursWithDriveTime = hours * 1.1;
    return (hoursWithDriveTime / HOURS_PER_WEEK).toFixed(1);
  };

  // Calculate totals for current page
  const currentPageMonthlyInvoice = properties.reduce((sum, prop) => sum + prop.monthly_invoice, 0);
  const currentPageCurrentHours = properties.reduce((sum, prop) => sum + prop.current_hours, 0);
  const currentPageNewHours = properties.reduce((sum, prop) => {
    const editedHour = editedHours[prop.id];
    const adjustedHour = prop.adjusted_hours !== null ? prop.adjusted_hours : prop.current_hours;
    return sum + (editedHour !== undefined ? editedHour : adjustedHour);
  }, 0);
  const currentPageTargetHours = properties.reduce((sum, prop) => sum + calculateTargetHours(prop.monthly_invoice), 0);
  
  // Always use actual totals from the backend, no estimation
  const totalMonthlyInvoice = backendTotalMonthlyInvoice || 0;
  const totalCurrentHours = backendTotalCurrentHours || 0;
  const totalNewHours = backendTotalNewHours || 0;
  const totalTargetHours = calculateTargetHours(totalMonthlyInvoice);
  
  // Calculate percentages based on all-pages data
  const currentOverallDirectLabor = calculateDirectLaborPercent(totalCurrentHours, totalMonthlyInvoice);
  const newOverallDirectLabor = calculateDirectLaborPercent(totalNewHours, totalMonthlyInvoice);

  // Calculate headcounts - adding 10% for drive time
  const currentHeadcount = (totalCurrentHours * 1.1) / HOURS_PER_WEEK;
  const targetHeadcount = (totalTargetHours * 1.1) / HOURS_PER_WEEK;
  const newHeadcount = (totalNewHours * 1.1) / HOURS_PER_WEEK;

  // Handle loading state
  if (branchesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <div className="p-8 bg-white shadow-lg rounded-lg">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 border-t-4 border-b-4 border-blue-500 rounded-full animate-spin"></div>
            <p className="text-lg font-semibold text-gray-700">Loading data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-blue-100 min-h-screen">
      <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
        {/* Header with gradient background */}
        <div className="bg-gradient-to-r from-white to-gray-100 p-4 border-b border-gray-200" 
             style={{ borderTop: `4px solid ${selectedBranch.color || '#4F46E5'}` }}>
          {/* Header - Top Row */}
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-800">Direct Labor Maintenance Calculator</h1>
            
            <div className="flex space-x-3">
              <Link 
                href="/crews" 
                className="px-4 py-2 bg-white text-emerald-700 border-2 border-emerald-600 rounded-lg hover:bg-emerald-50 transition-colors shadow-sm font-medium flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                </svg>
                <span>Manage Crews</span>
              </Link>
              
              <Link 
                href="/properties" 
                className="px-4 py-2 bg-white text-blue-700 border-2 border-blue-600 rounded-lg hover:bg-blue-50 transition-colors shadow-sm font-medium flex items-center space-x-2"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                <span>Manage Properties</span>
              </Link>
              
             {session && (
  <button 
    onClick={handleSignOut}
    className="px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-100 transition-colors shadow-sm font-medium flex items-center space-x-2"
  >
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
      <path fillRule="evenodd" d="M3 3a1 1 0 00-1 1v12a1 1 0 001 1h12a1 1 0 001-1V4a1 1 0 00-1-1H3zm11.293 9.293a1 1 0 001.414-1.414l-3-3a1 1 0 00-1.414 0l-3 3a1 1 0 001.414 1.414L10 10.414V15a1 1 0 102 0v-4.586l1.293 1.293z" />
    </svg>
    <span>Sign Out</span>
  </button>
)}
            </div>
          </div>
          
          {/* Filter Controls Row */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center">
              <label className="font-medium text-gray-700 whitespace-nowrap">Branch:</label>
              <div className="ml-2">
                <BranchDropdown
                  branches={branches}
                  selectedBranchId={selectedBranchId}
                  onChange={(branchId) => {
                    setSelectedBranchId(branchId);
                    setSelectedCrewId(null);
                    setPage(1);
                  }}
                />
              </div>
            </div>
            
            <div className="flex items-center">
              <label className="font-medium text-gray-700 whitespace-nowrap">Crew Type:</label>
              <div className="relative ml-2">
                <select
                  value={selectedCrewType}
                  onChange={(e) => {
                    setSelectedCrewType(e.target.value);
                    setPage(1); // Reset to first page
                  }}
                  className="border rounded-lg px-4 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none text-sm font-medium bg-white shadow-sm"
                  style={{ minWidth: '180px' }}
                >
                  <option value="">All Crew Types</option>
                  <option value="Maintenance">Maintenance</option>
                  <option value="Onsite">Onsite</option>
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
            
            <div className="flex items-center">
              <label className="font-medium text-gray-700 whitespace-nowrap">Crew:</label>
              <div className="relative ml-2">
                <select
                  value={selectedCrewId || ""}
                  onChange={(e) => {
                    const crewId = e.target.value ? parseInt(e.target.value) : null;
                    setSelectedCrewId(crewId);
                    setPage(1); // Reset to first page
                  }}
                  className="border rounded-lg px-4 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none text-sm font-medium bg-white shadow-sm"
                  disabled={crewsLoading}
                  style={{ minWidth: '180px' }}
                >
                  <option value="">All Crews</option>
                  {crews
                    .filter(crew => !selectedCrewType || crew.crew_type === selectedCrewType)
                    .map((crew) => (
                      <option key={crew.id} value={crew.id}>
                        {crew.name} ({crew.crew_type})
                      </option>
                    ))
                  }
                </select>
                <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                  <svg className="h-5 w-5 text-gray-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </div>
              </div>
            </div>
          </div>
          
          {/* Target DL and Cost Section */}
          <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-blue-50 p-6 rounded-xl shadow-sm border border-blue-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <label className="text-sm font-medium text-gray-700 mr-3">Target Direct Labor:</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={targetDirectLaborInput}
                      onChange={(e) => {
                        const value = e.target.value.replace(/[^\d.]/g, '');
                        setTargetDirectLaborInput(value);
                        if (value === '' || (!isNaN(parseFloat(value)) && isFinite(value))) {
                          setTargetDirectLaborPercent(parseFloat(value || 0) / 100);
                        }
                      }}
                      className="border border-blue-200 rounded-lg w-20 px-3 py-2 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none text-center font-bold bg-white shadow-sm"
                    />
                    <span className="absolute right-2 top-1/2 transform -translate-y-1/2 text-sm font-medium text-gray-600">%</span>
                  </div>
                </div>
                
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-700">Target Wk Hrs:</span>
                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-sm font-bold">
                      {formatNumber(totalTargetHours)}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({formatHeadcount(totalTargetHours)} HC | Cost: {formatCurrency(calculateWeeklyCost(totalTargetHours))})
                    </span>
                  </div>
                </div>
              </div>

              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center">
                  <span className="text-sm font-medium text-gray-700 mr-3">Current Overall DL:</span>
                  <span className={`px-3 py-1 rounded-full text-white text-sm font-bold ${currentOverallDirectLabor < targetDirectLaborPercent * 100 ? 'bg-green-500' : 'bg-red-500'}`}>
                    {formatPercent(currentOverallDirectLabor)}
                  </span>
                </div>
                
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-700">Current Wk Hours:</span>
                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1 rounded-full bg-blue-600 text-white text-sm font-bold">
                      {formatNumber(totalCurrentHours)}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({formatHeadcount(totalCurrentHours)} HC | Cost: {formatCurrency(calculateWeeklyCost(totalCurrentHours))})
                    </span>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="bg-indigo-50 p-6 rounded-xl shadow-sm border border-indigo-100">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <span className="text-sm font-medium text-gray-700 mr-3">Hourly Cost:</span>
                  <span className="px-3 py-1 rounded-full bg-indigo-600 text-white text-sm font-bold shadow-sm">
                    {formatCurrency(HOURLY_COST)}
                  </span>
                </div>
                
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-700">New Wk Hours:</span>
                  <div className="flex items-center space-x-2">
                    <span className="px-3 py-1 rounded-full bg-indigo-600 text-white text-sm font-bold">
                      {formatNumber(totalNewHours)}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({formatHeadcount(totalNewHours)} HC | Cost: {formatCurrency(calculateWeeklyCost(totalNewHours))})
                    </span>
                  </div>
                </div>
              </div>
              
              <div className="mt-4 flex items-center justify-between">
                <div className="flex items-center">
                  <span className="text-sm font-medium text-gray-700 mr-3">New Overall DL:</span>
                  <span className={`px-3 py-1 rounded-full text-white text-sm font-bold ${newOverallDirectLabor < targetDirectLaborPercent * 100 ? 'bg-green-500' : 'bg-red-500'}`}>
                    {formatPercent(newOverallDirectLabor)}
                  </span>
                </div>
                
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-700">Difference:</span>
                  <div className="flex items-center space-x-2">
                    <span className={`px-3 py-1 rounded-full text-white text-sm font-bold ${totalNewHours <= totalTargetHours ? 'bg-green-500' : 'bg-red-500'}`}>
                      {formatNumber(totalNewHours - totalTargetHours)}
                    </span>
                    <span className="text-xs text-gray-500">
                      ({(newHeadcount - targetHeadcount).toFixed(1)} HC | Cost: {formatCurrency(calculateWeeklyCost(totalNewHours - totalTargetHours))})
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* Advanced Filters Section */}
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <button 
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className="text-sm font-medium text-blue-600 hover:text-blue-800 flex items-center focus:outline-none"
              >
                <svg 
                  xmlns="http://www.w3.org/2000/svg" 
                  className={`h-5 w-5 mr-1 transform transition-transform ${showAdvancedFilters ? 'rotate-180' : ''}`} 
                  fill="none" 
                  viewBox="0 0 24 24" 
                  stroke="currentColor"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
                {showAdvancedFilters ? 'Hide Advanced Filters' : 'Show Advanced Filters'}
              </button>
              
              {/* Filter badge */}
              {(regionFilter || accountManagerFilter || propertyTypeFilter || companyFilter || clientFilter) && (
                <div className="bg-blue-100 text-blue-800 text-xs px-2 py-1 rounded-full flex items-center">
                  <span className="font-medium">Filters Active</span>
                  <button 
                    onClick={clearFilters}
                    className="ml-1 text-blue-500 hover:text-blue-700"
                    title="Clear all filters"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              )}
            </div>
            
            {showAdvancedFilters && (
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4 animate-fadeIn">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Filter Properties</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
                  {/* Region Filter */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Region</label>
                    <select
                      value={regionFilter}
                      onChange={(e) => {
                        setRegionFilter(e.target.value);
                        setPage(1); // Reset to first page
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">All Regions</option>
                      {options.regions.map((region) => (
                        <option key={region} value={region}>
                          {region}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Account Manager Filter */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Account Manager</label>
                    <select
                      value={accountManagerFilter}
                      onChange={(e) => {
                        setAccountManagerFilter(e.target.value);
                        setPage(1); // Reset to first page
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">All Managers</option>
                      {options.accountManagers.map((manager) => (
                        <option key={manager} value={manager}>
                          {manager}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Property Type Filter */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Property Type</label>
                    <select
                      value={propertyTypeFilter}
                      onChange={(e) => {
                        setPropertyTypeFilter(e.target.value);
                        setPage(1); // Reset to first page
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">All Types</option>
                      {options.propertyTypes.map((type) => (
                        <option key={type} value={type}>
                          {type}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Company Filter */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Company</label>
                    <select
                      value={companyFilter}
                      onChange={(e) => {
                        setCompanyFilter(e.target.value);
                        setPage(1); // Reset to first page
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">All Companies</option>
                      {options.companies.map((company) => (
                        <option key={company} value={company}>
                          {company}
                        </option>
                      ))}
                    </select>
                  </div>
                  
                  {/* Client Filter */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Client</label>
                    <select
                      value={clientFilter}
                      onChange={(e) => {
                        setClientFilter(e.target.value);
                        setPage(1); // Reset to first page
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">All Clients</option>
                      {options.clients.map((client) => (
                        <option key={client} value={client}>
                          {client}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                
                <div className="mt-3 flex justify-end">
                  <button
                    onClick={clearFilters}
                    className="px-3 py-1 bg-gray-200 text-gray-700 text-sm rounded hover:bg-gray-300"
                  >
                    Clear Filters
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Success/Error Message */}
        {message.text && (
          <div className={`p-4 mx-6 my-4 rounded-lg flex items-start ${
            message.type === 'success' 
              ? 'bg-green-50 text-green-700 border-l-4 border-green-500' 
              : 'bg-red-50 text-red-700 border-l-4 border-red-500'
          }`}>
            {message.type === 'success' ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6 mr-2 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            )}
            <span>{message.text}</span>
          </div>
        )}

        {propertiesLoading ? (
          <div className="p-12 text-center">
            <div className="flex items-center justify-center">
              <div className="w-8 h-8 border-t-4 border-b-4 border-blue-500 rounded-full animate-spin"></div>
              <p className="ml-3 text-lg font-medium text-gray-700">Loading properties...</p>
            </div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 shadow-sm">Property</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 shadow-sm">Monthly Invoice</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 shadow-sm">Current Wk Hours</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 shadow-sm">Current DL%</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 shadow-sm">Target Wk Hrs</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 shadow-sm">New Wk Hours</th>
                  <th scope="col" className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider sticky top-0 bg-gray-50 z-10 shadow-sm">New DL%</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {properties.length === 0 ? (
                  <tr>
                    <td colSpan="7" className="px-6 py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center">
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                        </svg>
                        <p className="text-lg font-medium">No properties found</p>
                        <p className="text-sm text-gray-400 mt-1">Try changing your filters or adding properties</p>
                      </div>
                    </td>
                  </tr>
                ) : (
                  properties.map((property) => {
                    const targetHours = calculateTargetHours(property.monthly_invoice);
                    const currentDLPercent = calculateDirectLaborPercent(property.current_hours, property.monthly_invoice);
                    const newHours = editedHours[property.id] !== undefined 
                      ? editedHours[property.id] 
                      : (property.adjusted_hours !== null ? property.adjusted_hours : property.current_hours);
                    const newDLPercent = calculateDirectLaborPercent(newHours, property.monthly_invoice);
                    
                    // Determine if this property is currently being saved
                    const isSaving = savingPropertyId === property.id;
                    
                    return (
                      <tr key={property.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-6 py-4 whitespace-nowrap">
                          {/* Make property name a link to edit view */}
                          <Link 
                            href={`/properties?edit=${property.id}`}
                            className="font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left"
                          >
                            {property.name}
                          </Link>
                          <div className="flex flex-col text-xs text-gray-500 mt-1">
                            {property.crews && (
                              <span>Crew: {property.crews.name} ({property.crews.crew_type})</span>
                            )}
                            {property.property_type && (
                              <span className="mt-0.5">Type: {property.property_type}</span>
                            )}
                            {property.account_manager && (
                              <span className="mt-0.5">Manager: {property.account_manager}</span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700 font-medium">
                          {formatCurrency(property.monthly_invoice)}
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-700">{property.current_hours}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 inline-flex text-sm leading-5 font-medium rounded-full ${currentDLPercent < targetDirectLaborPercent * 100 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {formatPercent(currentDLPercent)}
                          </span>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-indigo-600">{targetHours.toFixed(1)}</td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={editedHours[property.id] !== undefined ? editedHours[property.id] : ""}
                              onChange={(e) => handleNewHoursChange(property.id, e.target.value)}
                              placeholder={(property.adjusted_hours !== null ? property.adjusted_hours : property.current_hours).toString()}
                              className="block w-24 sm:text-sm border-gray-300 border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm"
                              disabled={isSaving}
                            />
                            {editedHours[property.id] !== undefined && editedHours[property.id] !== property.current_hours && (
                              isSaving ? (
                                <div className="w-8 h-8 flex items-center justify-center">
                                  <div className="w-5 h-5 border-t-2 border-b-2 border-blue-500 rounded-full animate-spin"></div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => saveNewHours(property.id, editedHours[property.id])}
                                  className="bg-blue-600 hover:bg-blue-700 text-white p-2 rounded-md shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                                  title="Save changes"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </button>
                              )
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <span className={`px-3 py-1 inline-flex text-sm leading-5 font-medium rounded-full ${newDLPercent < targetDirectLaborPercent * 100 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {editedHours[property.id] !== undefined || property.adjusted_hours !== null ? formatPercent(newDLPercent) : "-"}
                          </span>
                        </td>
                      </tr>
                    );
                  })
                )}

                {/* Totals row for current page */}
                <tr className="bg-gray-50 font-medium border-t-2 border-gray-200">
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">PAGE TOTALS</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{formatCurrency(currentPageMonthlyInvoice)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{formatNumber(currentPageCurrentHours)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-3 py-1 inline-flex text-sm leading-5 font-bold rounded-full ${calculateDirectLaborPercent(currentPageCurrentHours, currentPageMonthlyInvoice) < targetDirectLaborPercent * 100 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {formatPercent(calculateDirectLaborPercent(currentPageCurrentHours, currentPageMonthlyInvoice))}
                    </span>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{formatNumber(currentPageTargetHours)}</td>
                  <td className="px-6 py-4 whitespace-nowrap text-sm font-bold text-gray-900">{formatNumber(currentPageNewHours)}</td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-3 py-1 inline-flex text-sm leading-5 font-bold rounded-full ${calculateDirectLaborPercent(currentPageNewHours, currentPageMonthlyInvoice) < targetDirectLaborPercent * 100 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {currentPageNewHours > 0 ? formatPercent(calculateDirectLaborPercent(currentPageNewHours, currentPageMonthlyInvoice)) : "-"}
                    </span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination & Formula Section */}
        <div className="border-t border-gray-200">
          <div className="bg-gray-50 p-4 sm:p-6 flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <div className="text-sm text-gray-500 border-l-4 border-blue-500 pl-3 py-1 bg-blue-50 rounded-r-md">
              <p className="font-medium text-blue-900">Formula: (Monthly Invoice × Target DL%) × 0.9 ÷ 24.75 ÷ 4.33</p>
              <p className="text-blue-800 mt-1">Target DL% is adjustable, 0.9 accounts for Drive Time, 24.75 is hourly cost, 4.33 is weeks per month</p>
            </div>
            
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setPage(Math.max(1, page - 1))}
                disabled={page === 1 || isLoading}
                className={`px-4 py-2 rounded-lg flex items-center space-x-1 font-medium shadow-sm transition-colors ${page === 1 || isLoading ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'}`}
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
                <span>Previous</span>
              </button>
              <span className="text-sm text-gray-700 bg-white px-4 py-2 rounded-lg border border-gray-300 shadow-sm">
                Page {page} of {totalPages || 1}
              </span>
              <button
                onClick={() => setPage(Math.min(totalPages || 1, page + 1))}
                disabled={page === (totalPages || 1) || isLoading}
                className={`px-4 py-2 rounded-lg flex items-center space-x-1 font-medium shadow-sm transition-colors ${page === (totalPages || 1) || isLoading ? 'bg-gray-200 text-gray-400 cursor-not-allowed' : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'}`}
              >
                <span>Next</span>
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
      
      {/* Results counter at bottom */}
      {!propertiesLoading && (
        <div className="mt-4 text-center text-sm text-gray-500">
          Showing {properties.length} of {count} properties
        </div>
      )}

      {/* No need for the PropertyForm modal */}
    </div>
  );
};

export default DirectLaborCalculator;