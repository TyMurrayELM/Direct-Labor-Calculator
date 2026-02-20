"use client";

import React, { useState, useEffect, useRef } from 'react';
import { useProperties, useCrews, useBranches, updatePropertyHours, updatePropertyQSVisitTime, usePropertyOptions, useComplexes } from '../hooks/useSupabase';
import Link from 'next/link';
import Image from 'next/image';
import { useSession, useSupabaseClient } from '@supabase/auth-helpers-react';
import { useSearchParams, useRouter } from 'next/navigation';
import UserManagementModal from './UserManagementModal';
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
        className="border rounded-lg pl-3 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm font-medium bg-white shadow-sm flex items-center text-gray-900"
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
          <svg className="h-5 w-5 text-gray-700" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>
      
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md bg-white shadow-lg">
          <div className="py-1 max-h-60 overflow-y-auto">
            <button
              type="button"
              className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 text-gray-900"
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
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center text-gray-900"
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
  
  // User role state
  const [userRole, setUserRole] = useState(null);
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showExports, setShowExports] = useState(false);
  const exportsRef = useRef(null);
  const [showForecast, setShowForecast] = useState(false);
  const forecastRef = useRef(null);
  
  // Fetch user role from allowlist
  useEffect(() => {
    const fetchUserRole = async () => {
      if (session?.user?.email) {
        const { data, error } = await supabase
          .from('allowlist')
          .select('role')
          .eq('email', session.user.email)
          .single();
        
        if (data && !error) {
          setUserRole(data.role);
        }
      }
    };
    
    fetchUserRole();
  }, [session, supabase]);

  // Close dropdowns on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (exportsRef.current && !exportsRef.current.contains(event.target)) {
        setShowExports(false);
      }
      if (forecastRef.current && !forecastRef.current.contains(event.target)) {
        setShowForecast(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // URL params for persistent filters
  const searchParams = useSearchParams();
  const router = useRouter();

  // Handle sign out
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    window.location.reload(); // Reload to update UI
  };
  
  // Constants for calculations
  const DRIVE_TIME_FACTOR = 0.9;
  const WEEKS_PER_MONTH = 4.33;
  const HOURS_PER_WEEK = 40; // Weekly hours for headcount calculation
  
  // Branch-specific hourly costs by crew type
  const HOURLY_COST_LAS_VEGAS_MAINTENANCE = 24.50;
  const HOURLY_COST_PHOENIX_MAINTENANCE = 25.50;
  const HOURLY_COST_LAS_VEGAS_ONSITE = 25.00;
  const HOURLY_COST_PHOENIX_ONSITE = 30.00;
  const DEFAULT_HOURLY_COST = 25.00;
  
  // State for target direct labor percentage
  const [targetDirectLaborPercent, setTargetDirectLaborPercent] = useState(0.40);
  const [targetDirectLaborInput, setTargetDirectLaborInput] = useState("40");
  
  // State for pagination and filters - read from URL
  const [selectedBranchId, setSelectedBranchId] = useState(() => {
    const branchParam = searchParams.get('branch');
    return branchParam ? parseInt(branchParam) : null;
  });
  const [selectedCrewId, setSelectedCrewId] = useState(() => {
    const crewParam = searchParams.get('crew');
    return crewParam ? parseInt(crewParam) : null;
  });
  const [selectedCrewType, setSelectedCrewType] = useState(() => {
    return searchParams.get('crewType') || '';
  });
  const [page, setPage] = useState(1);
  const pageSize = 10000; // Load all records
  
  // State for advanced filters
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [regionFilter, setRegionFilter] = useState('');
  const [accountManagerFilter, setAccountManagerFilter] = useState('');
  const [propertyTypeFilter, setPropertyTypeFilter] = useState('');
  const [companyFilter, setCompanyFilter] = useState('');
  const [clientFilter, setClientFilter] = useState('');
  const [propertyNameFilter, setPropertyNameFilter] = useState('');
  
  // State for tracking edited hours
  const [editedHours, setEditedHours] = useState({});
  
  // State for tracking edited QS visit times
  const [editedQSTime, setEditedQSTime] = useState({});
  
  // State for filtering only properties with hours mismatch - read from URL
  const [showMismatchOnly, setShowMismatchOnly] = useState(() => {
    return searchParams.get('needsUpdate') === 'true';
  });
  
  // State for tracking which property is currently being saved
  const [savingPropertyId, setSavingPropertyId] = useState(null);
  
  // State for tracking recently saved property (for success animation)
  const [recentlySavedId, setRecentlySavedId] = useState(null);
  
  // State for messages
  const [message, setMessage] = useState({ text: '', type: '' });
  
  // State for table sorting
  const [sortField, setSortField] = useState(null);
  const [sortDirection, setSortDirection] = useState('asc');
  
  // Update URL when filters change
  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString());
    if (selectedBranchId) {
      params.set('branch', selectedBranchId.toString());
    } else {
      params.delete('branch');
    }
    if (selectedCrewId) {
      params.set('crew', selectedCrewId.toString());
    } else {
      params.delete('crew');
    }
    if (selectedCrewType) {
      params.set('crewType', selectedCrewType);
    } else {
      params.delete('crewType');
    }
    if (showMismatchOnly) {
      params.set('needsUpdate', 'true');
    } else {
      params.delete('needsUpdate');
    }
    router.replace(`?${params.toString()}`, { scroll: false });
  }, [selectedBranchId, selectedCrewId, selectedCrewType, showMismatchOnly, router, searchParams]);
  
  // Fetch data using custom hooks
  const { branches, loading: branchesLoading } = useBranches();
  const { crews, loading: crewsLoading } = useCrews(selectedBranchId);
  const { options, loading: optionsLoading } = usePropertyOptions();
  const { complexes } = useComplexes(selectedBranchId);
  
  // Create a lookup map for complex names
  const complexNameMap = React.useMemo(() => {
    return (complexes || []).reduce((acc, c) => { acc[c.id] = c.name; return acc; }, {});
  }, [complexes]);
  
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
  
  // Calculate target hours based on formula - now with branch/crew-specific rates
  const calculateTargetHours = (monthlyInvoice, branchName, crewType) => {
    const hourlyCost = getHourlyCost(branchName, crewType);
    const driveTimeFactor = getDriveTimeFactor(crewType);
    return (monthlyInvoice * targetDirectLaborPercent * driveTimeFactor) / (hourlyCost * WEEKS_PER_MONTH);
  };

  // Calculate direct labor percentage - now with branch/crew-specific rates
  const calculateDirectLaborPercent = (hours, monthlyInvoice, branchName, crewType) => {
    if (hours === 0 || monthlyInvoice === 0) return 0;
    const hourlyCost = getHourlyCost(branchName, crewType);
    const driveTimeFactor = getDriveTimeFactor(crewType);
    return (hours * hourlyCost * WEEKS_PER_MONTH) / (monthlyInvoice * driveTimeFactor) * 100;
  };
  
  // Calculate weekly cost from hours - now with branch/crew-specific rates
  const calculateWeeklyCost = (hours, branchName, crewType) => {
    const hourlyCost = getHourlyCost(branchName, crewType);
    return hours * hourlyCost;
  };

  // Handle change for new hours input
  const handleNewHoursChange = (id, value) => {
    const newValue = value === "" ? "" : parseFloat(value);
    setEditedHours({
      ...editedHours,
      [id]: newValue
    });
  };
  
  // Handle change for QS visit time input - store raw value for smooth typing
  const handleQSTimeChange = (id, value) => {
    // Only allow digits
    const cleaned = value.replace(/[^0-9]/g, '');
    setEditedQSTime({
      ...editedQSTime,
      [id]: cleaned
    });
  };
  
  // Save QS visit time to Supabase
  const saveQSTime = async (id, qsTime) => {
    try {
      setSavingPropertyId(id);
      
      // Parse to integer, removing any leading zeros
      const parsedTime = qsTime === "" ? null : parseInt(qsTime, 10);
      const result = await updatePropertyQSVisitTime(id, parsedTime);
      
      if (result.success) {
        const updatedEditedQSTime = { ...editedQSTime };
        delete updatedEditedQSTime[id];
        setEditedQSTime(updatedEditedQSTime);
        
        await refetchProperties();
        
        setRecentlySavedId(id);
        setTimeout(() => setRecentlySavedId(null), 1500);
      } else {
        console.error('Failed to save QS time:', result.error);
      }
    } catch (error) {
      console.error('Error saving QS time:', error);
    } finally {
      setSavingPropertyId(null);
    }
  };
  
  // Handle column sort
  const handleSort = (field) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };
  
  // Clear all filters
  const clearFilters = () => {
    setRegionFilter('');
    setAccountManagerFilter('');
    setPropertyTypeFilter('');
    setCompanyFilter('');
    setClientFilter('');
    setSelectedCrewType('');
    setPropertyNameFilter('');
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
        
        // Trigger success animation
        setRecentlySavedId(id);
        setTimeout(() => setRecentlySavedId(null), 1500);
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

  // Format time from 24h (HH:MM:SS) to 12h format (h:mm AM/PM)
  const formatTime = (timeString) => {
    if (!timeString) return '';
    const [hours, minutes] = timeString.split(':');
    const hour = parseInt(hours, 10);
    const ampm = hour >= 12 ? 'PM' : 'AM';
    const hour12 = hour % 12 || 12;
    return `${hour12}:${minutes} ${ampm}`;
  };

  // Format headcount - adding 10% for drive time
  const formatHeadcount = (hours) => {
    // Add 10% for drive time before calculating headcount
    const hoursWithDriveTime = hours * 1.1;
    return (hoursWithDriveTime / HOURS_PER_WEEK).toFixed(1);
  };

  // Export to CSV function - fetches ALL filtered records
  const exportToCSV = async () => {
    try {
      setMessage({ text: 'Preparing export...', type: 'success' });

      // Fetch properties with complex_id
      let query = supabase
        .from('properties')
        .select(`
          id, name, address, monthly_invoice, current_hours, adjusted_hours,
          region, account_manager, property_type, company, client,
          service_window_start, service_window_end, complex_id,
          branch_id, crew_id,
          branches (id, name),
          crews (id, name, crew_type, size)
        `)
        .order('name');

      if (selectedBranchId) query = query.eq('branch_id', selectedBranchId);
      if (selectedCrewId) query = query.eq('crew_id', selectedCrewId);
      if (regionFilter) query = query.eq('region', regionFilter);
      if (accountManagerFilter) query = query.eq('account_manager', accountManagerFilter);
      if (propertyTypeFilter) query = query.eq('property_type', propertyTypeFilter);
      if (companyFilter) query = query.eq('company', companyFilter);
      if (clientFilter) query = query.eq('client', clientFilter);

      const { data: allProperties, error } = await query;

      if (error) {
        setMessage({ text: 'Error exporting data', type: 'error' });
        setTimeout(() => setMessage({ text: '', type: '' }), 3000);
        return;
      }

      // Fetch complexes for this branch
      let complexesQuery = supabase.from('complexes').select('*');
      if (selectedBranchId) complexesQuery = complexesQuery.eq('branch_id', selectedBranchId);
      const { data: complexes } = await complexesQuery;
      const complexMap = (complexes || []).reduce((acc, c) => { acc[c.id] = c; return acc; }, {});

      let filteredProperties = allProperties;
      if (selectedCrewType) {
        filteredProperties = filteredProperties.filter(p => p.crews?.crew_type === selectedCrewType);
      }
      // Apply property name filter
      if (propertyNameFilter) {
        filteredProperties = filteredProperties.filter(p => p.name?.toLowerCase().includes(propertyNameFilter.toLowerCase()));
      }
      // Apply mismatch filter
      if (showMismatchOnly) {
        filteredProperties = filteredProperties.filter(p => p.adjusted_hours !== null && p.adjusted_hours !== p.current_hours);
      }

      if (!filteredProperties || filteredProperties.length === 0) {
        setMessage({ text: 'No data to export', type: 'error' });
        setTimeout(() => setMessage({ text: '', type: '' }), 3000);
        return;
      }

      // Group properties by complex_id
      const complexGroups = {};
      const standaloneProperties = [];

      filteredProperties.forEach(property => {
        if (property.complex_id && complexMap[property.complex_id]) {
          if (!complexGroups[property.complex_id]) {
            complexGroups[property.complex_id] = [];
          }
          complexGroups[property.complex_id].push(property);
        } else {
          standaloneProperties.push(property);
        }
      });

      const headers = ['Property','Address','New Wkly Total Hours','New Wkly Crew Hours','Minutes','Time Window Start','Time Window End','Notes'];

      const rows = [];

      // Branch addresses lookup
      const branchAddresses = {
        'Las Vegas': '6290 S Pecos Rd, Las Vegas, Nevada, 89120',
        'Phx - North': '23325 N 23rd Avenue, Phoenix, AZ 85027',
        'Phx - SouthEast': '1715 N Arizona Ave, Chandler, AZ 85225',
        'Phx - SouthWest': '2600 S. 20th Ave, Phoenix, AZ 85009'
      };

      // Add branch location as first row (for route optimization import)
      const branchName = selectedBranch?.name || '';
      const branchAddress = branchAddresses[branchName] || '';
      if (branchAddress) {
        rows.push([
          'Branch Location',
          branchAddress,
          0,
          0,
          0,
          '',
          '',
          `Start/End location for ${branchName}`
        ]);
      }

      // Process complex groups - sum hours, use complex name/address
      Object.entries(complexGroups).forEach(([complexId, properties]) => {
        const complex = complexMap[complexId];
        
        // Sum total hours across all properties in complex
        let totalNewHours = 0;
        let totalCrewHours = 0;
        let earliestStart = null;
        let latestEnd = null;

        properties.forEach(property => {
          const newHours = editedHours[property.id] !== undefined 
            ? editedHours[property.id] 
            : (property.adjusted_hours !== null ? property.adjusted_hours : property.current_hours);
          const crewSize = property.crews?.size || 1;
          
          totalNewHours += newHours || 0;
          totalCrewHours += (newHours || 0) / crewSize;

          // Track earliest start and latest end times
          if (property.service_window_start) {
            if (!earliestStart || property.service_window_start < earliestStart) {
              earliestStart = property.service_window_start;
            }
          }
          if (property.service_window_end) {
            if (!latestEnd || property.service_window_end > latestEnd) {
              latestEnd = property.service_window_end;
            }
          }
        });

        const minutes = Math.round(totalCrewHours * 60);

        // Create notes with list of property names in the complex
        const propertyNames = properties.map(p => p.name).sort().join(', ');

        rows.push([
          complex.name ? `${complex.name} - Complex` : `Complex ${complexId}`,
          complex.address || properties[0]?.address || '',
          totalNewHours.toFixed(1),
          totalCrewHours.toFixed(1),
          minutes,
          earliestStart || '',
          latestEnd || '',
          propertyNames
        ]);
      });

      // Process standalone properties
      standaloneProperties.forEach(property => {
        const newHours = editedHours[property.id] !== undefined 
          ? editedHours[property.id] 
          : (property.adjusted_hours !== null ? property.adjusted_hours : property.current_hours);
        const crewSize = property.crews?.size || 1;
        const crewHours = (newHours || 0) / crewSize;
        const minutes = Math.round(crewHours * 60);
        
        rows.push([
          property.name || '',
          property.address || '',
          newHours || 0,
          crewHours.toFixed(1),
          minutes,
          property.service_window_start || '',
          property.service_window_end || '',
          ''
        ]);
      });

      // Separate branch row (first row) from property rows for sorting
      const branchRow = rows.length > 0 && rows[0][0] === 'Branch Location' ? rows.shift() : null;
      
      // Sort property rows alphabetically by name
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      
      // Put branch row back at the beginning
      if (branchRow) {
        rows.unshift(branchRow);
      }

      const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str.replace(/"/g, '""')}"` : str;
      };

      const csvContent = [headers.map(escapeCSV).join(','), ...rows.map(row => row.map(escapeCSV).join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', `route-export${selectedBranch?.name ? `_${selectedBranch.name.replace(/\s+/g, '-')}` : ''}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      const complexCount = Object.keys(complexGroups).length;
      const standaloneCount = standaloneProperties.length;
      setMessage({ 
        text: `Exported ${rows.length} rows (${complexCount} complexes, ${standaloneCount} standalone properties)`, 
        type: 'success' 
      });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setMessage({ text: 'Error exporting data', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // Export ALL properties to CSV (no complex grouping)
  const exportAllProperties = async () => {
    try {
      setMessage({ text: 'Preparing full property export...', type: 'success' });

      let query = supabase
        .from('properties')
        .select(`
          id, name, address, monthly_invoice, current_hours, adjusted_hours,
          region, account_manager, property_type, company, client,
          service_window_start, service_window_end, complex_id,
          branch_id, crew_id,
          branches (id, name),
          crews (id, name, crew_type, size)
        `)
        .order('name');

      if (selectedBranchId) query = query.eq('branch_id', selectedBranchId);
      if (selectedCrewId) query = query.eq('crew_id', selectedCrewId);
      if (regionFilter) query = query.eq('region', regionFilter);
      if (accountManagerFilter) query = query.eq('account_manager', accountManagerFilter);
      if (propertyTypeFilter) query = query.eq('property_type', propertyTypeFilter);
      if (companyFilter) query = query.eq('company', companyFilter);
      if (clientFilter) query = query.eq('client', clientFilter);

      const { data: allProperties, error } = await query;

      if (error) {
        setMessage({ text: 'Error exporting data', type: 'error' });
        setTimeout(() => setMessage({ text: '', type: '' }), 3000);
        return;
      }

      let filteredProperties = allProperties;
      if (selectedCrewType) {
        filteredProperties = filteredProperties.filter(p => p.crews?.crew_type === selectedCrewType);
      }
      if (propertyNameFilter) {
        filteredProperties = filteredProperties.filter(p => p.name?.toLowerCase().includes(propertyNameFilter.toLowerCase()));
      }
      if (showMismatchOnly) {
        filteredProperties = filteredProperties.filter(p => p.adjusted_hours !== null && p.adjusted_hours !== p.current_hours);
      }

      if (!filteredProperties || filteredProperties.length === 0) {
        setMessage({ text: 'No data to export', type: 'error' });
        setTimeout(() => setMessage({ text: '', type: '' }), 3000);
        return;
      }

      const headers = ['Property','Address','New Wkly Total Hours','New Wkly Crew Hours','Minutes','Time Window Start','Time Window End','Notes'];
      const rows = [];

      // Process ALL properties individually (no complex grouping)
      filteredProperties.forEach(property => {
        const newHours = editedHours[property.id] !== undefined 
          ? editedHours[property.id] 
          : (property.adjusted_hours !== null ? property.adjusted_hours : property.current_hours);
        const crewSize = property.crews?.size || 1;
        const crewHours = (newHours || 0) / crewSize;
        const minutes = Math.round(crewHours * 60);
        
        rows.push([
          property.name || '',
          property.address || '',
          newHours || 0,
          crewHours.toFixed(1),
          minutes,
          property.service_window_start || '',
          property.service_window_end || '',
          ''
        ]);
      });

      // Sort rows alphabetically by name
      rows.sort((a, b) => a[0].localeCompare(b[0]));

      const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str.replace(/"/g, '""')}"` : str;
      };

      const csvContent = [headers.map(escapeCSV).join(','), ...rows.map(row => row.map(escapeCSV).join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', `all-properties${selectedBranch?.name ? `_${selectedBranch.name.replace(/\s+/g, '-')}` : ''}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      setMessage({ 
        text: `Exported ${rows.length} properties (no complex grouping)`, 
        type: 'success' 
      });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    } catch (err) {
      console.error('Export error:', err);
      setMessage({ text: 'Error exporting data', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // Export QS Schedule to CSV - exports QS Visit Time instead of crew hours
  // Consolidates multiple visits (e.g., "Property (Visit 1)", "Property (Visit 2)") into single entries
  const exportQSSchedule = async () => {
    try {
      setMessage({ text: 'Preparing QS export...', type: 'success' });

      let query = supabase
        .from('properties')
        .select(`
          id, name, address, monthly_invoice, current_hours, adjusted_hours, qs_visit_time,
          region, account_manager, property_type, company, client,
          service_window_start, service_window_end, complex_id,
          branch_id, crew_id,
          branches (id, name),
          crews (id, name, crew_type, size)
        `)
        .order('name');

      if (selectedBranchId) query = query.eq('branch_id', selectedBranchId);
      if (selectedCrewId) query = query.eq('crew_id', selectedCrewId);
      if (regionFilter) query = query.eq('region', regionFilter);
      if (accountManagerFilter) query = query.eq('account_manager', accountManagerFilter);
      if (propertyTypeFilter) query = query.eq('property_type', propertyTypeFilter);
      if (companyFilter) query = query.eq('company', companyFilter);
      if (clientFilter) query = query.eq('client', clientFilter);

      const { data: allProperties, error } = await query;

      if (error) {
        setMessage({ text: 'Error exporting QS data', type: 'error' });
        setTimeout(() => setMessage({ text: '', type: '' }), 3000);
        return;
      }

      let complexesQuery = supabase.from('complexes').select('*');
      if (selectedBranchId) complexesQuery = complexesQuery.eq('branch_id', selectedBranchId);
      const { data: complexesData } = await complexesQuery;
      const complexMap = (complexesData || []).reduce((acc, c) => { acc[c.id] = c; return acc; }, {});

      let filteredProps = allProperties;
      if (selectedCrewType) {
        filteredProps = filteredProps.filter(p => p.crews?.crew_type === selectedCrewType);
      }
      if (propertyNameFilter) {
        filteredProps = filteredProps.filter(p => p.name?.toLowerCase().includes(propertyNameFilter.toLowerCase()));
      }

      if (!filteredProps || filteredProps.length === 0) {
        setMessage({ text: 'No data to export', type: 'error' });
        setTimeout(() => setMessage({ text: '', type: '' }), 3000);
        return;
      }

      // Helper function to get base property name (strips "(Visit X)" suffix)
      const getBasePropertyName = (name) => {
        if (!name) return '';
        return name.replace(/\s*\(Visit\s*\d+\)\s*$/i, '').trim();
      };

      const complexGroups = {};
      const standaloneProperties = [];

      filteredProps.forEach(property => {
        if (property.complex_id && complexMap[property.complex_id]) {
          if (!complexGroups[property.complex_id]) {
            complexGroups[property.complex_id] = [];
          }
          complexGroups[property.complex_id].push(property);
        } else {
          standaloneProperties.push(property);
        }
      });

      const headers = ['Property', 'Address', 'Minutes', 'Time Window Start', 'Time Window End', 'Notes'];
      const QS_TIME_WINDOW_START = '06:00:00';
      const QS_TIME_WINDOW_END = '12:30:00';
      const rows = [];

      // Branch addresses lookup
      const branchAddresses = {
        'Las Vegas': '6290 S Pecos Rd, Las Vegas, Nevada, 89120',
        'Phx - North': '23325 N 23rd Avenue, Phoenix, AZ 85027',
        'Phx - SouthEast': '1715 N Arizona Ave, Chandler, AZ 85225',
        'Phx - SouthWest': '2600 S. 20th Ave, Phoenix, AZ 85009'
      };

      // Add branch location as first row
      const branchName = selectedBranch?.name || '';
      const branchAddress = branchAddresses[branchName] || '';
      if (branchAddress) {
        rows.push([
          'Branch Location',
          branchAddress,
          0,
          '',
          '',
          `Start/End location for ${branchName}`
        ]);
      }

      // Process complex groups
      Object.entries(complexGroups).forEach(([complexId, properties]) => {
        const complex = complexMap[complexId];
        let totalQSTime = 0;

        properties.forEach(property => {
          const qsTime = editedQSTime[property.id] !== undefined 
            ? editedQSTime[property.id] 
            : (property.qs_visit_time || 0);
          totalQSTime += qsTime || 0;
        });

        const propertyNames = properties.map(p => p.name).sort().join(', ');

        rows.push([
          complex.name ? `${complex.name} - Complex` : `Complex ${complexId}`,
          complex.address || properties[0]?.address || '',
          Math.round(totalQSTime),
          QS_TIME_WINDOW_START,
          QS_TIME_WINDOW_END,
          propertyNames
        ]);
      });

      // Group standalone properties by base name to consolidate multi-visit properties
      const consolidatedProperties = {};
      
      standaloneProperties.forEach(property => {
        const baseName = getBasePropertyName(property.name);
        const qsTime = editedQSTime[property.id] !== undefined 
          ? editedQSTime[property.id] 
          : (property.qs_visit_time || 0);
        
        if (!consolidatedProperties[baseName]) {
          consolidatedProperties[baseName] = {
            name: baseName,
            address: property.address || '',
            totalQSTime: 0,
            visitCount: 0,
            originalNames: []
          };
        }
        
        consolidatedProperties[baseName].totalQSTime += qsTime || 0;
        consolidatedProperties[baseName].visitCount += 1;
        consolidatedProperties[baseName].originalNames.push(property.name);
        
        // Use the first non-empty address found
        if (!consolidatedProperties[baseName].address && property.address) {
          consolidatedProperties[baseName].address = property.address;
        }
      });

      // Convert consolidated properties to rows
      Object.values(consolidatedProperties).forEach(prop => {
        const notes = prop.visitCount > 1 ? `Combined from ${prop.visitCount} visits` : '';
        
        rows.push([
          prop.name,
          prop.address,
          Math.round(prop.totalQSTime),
          QS_TIME_WINDOW_START,
          QS_TIME_WINDOW_END,
          notes
        ]);
      });

      // Separate branch row (first row) from property rows for sorting
      const branchRow = rows.length > 0 && rows[0][0] === 'Branch Location' ? rows.shift() : null;
      
      // Sort property rows alphabetically
      rows.sort((a, b) => a[0].localeCompare(b[0]));
      
      // Put branch row back at the beginning
      if (branchRow) {
        rows.unshift(branchRow);
      }

      const escapeCSV = (value) => {
        if (value === null || value === undefined) return '';
        const str = String(value);
        return (str.includes(',') || str.includes('"') || str.includes('\n')) ? `"${str.replace(/"/g, '""')}"` : str;
      };

      const csvContent = [headers.map(escapeCSV).join(','), ...rows.map(row => row.map(escapeCSV).join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.setAttribute('href', URL.createObjectURL(blob));
      link.setAttribute('download', `qs-schedule${selectedBranch?.name ? `_${selectedBranch.name.replace(/\s+/g, '-')}` : ''}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
      const complexCount = Object.keys(complexGroups).length;
      const standaloneCount = standaloneProperties.length;
      setMessage({ 
        text: `QS Schedule exported: ${rows.length} rows (${complexCount} complexes, ${standaloneCount} standalone)`, 
        type: 'success' 
      });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    } catch (err) {
      console.error('QS Export error:', err);
      setMessage({ text: 'Error exporting QS data', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  // Filter properties for display (mismatch filter and property name filter)
  const filteredProperties = properties.filter(property => {
    // Property name filter (case-insensitive partial match)
    if (propertyNameFilter && !property.name?.toLowerCase().includes(propertyNameFilter.toLowerCase())) {
      return false;
    }
    // Mismatch filter
    if (showMismatchOnly) {
      return property.adjusted_hours !== null && property.adjusted_hours !== property.current_hours;
    }
    return true;
  });

  // Sort filtered properties
  const sortedProperties = [...filteredProperties].sort((a, b) => {
    if (!sortField) return 0;
    
    let aValue, bValue;
    
    // Get values based on sort field
    switch (sortField) {
      case 'property':
        aValue = a.name?.toLowerCase() || '';
        bValue = b.name?.toLowerCase() || '';
        break;
      case 'css':
        aValue = a.account_manager?.toLowerCase() || '';
        bValue = b.account_manager?.toLowerCase() || '';
        break;
      case 'monthlyInvoice':
        aValue = a.monthly_invoice || 0;
        bValue = b.monthly_invoice || 0;
        break;
      case 'currentHours':
        aValue = a.current_hours || 0;
        bValue = b.current_hours || 0;
        break;
      case 'currentDL':
        const aBranchName = a.branches?.name || '';
        const aCrewType = a.crews?.crew_type || '';
        const bBranchName = b.branches?.name || '';
        const bCrewType = b.crews?.crew_type || '';
        aValue = calculateDirectLaborPercent(a.current_hours, a.monthly_invoice, aBranchName, aCrewType);
        bValue = calculateDirectLaborPercent(b.current_hours, b.monthly_invoice, bBranchName, bCrewType);
        break;
      case 'targetHours':
        const aBranch = a.branches?.name || '';
        const aCrew = a.crews?.crew_type || '';
        const bBranch = b.branches?.name || '';
        const bCrew = b.crews?.crew_type || '';
        aValue = calculateTargetHours(a.monthly_invoice, aBranch, aCrew);
        bValue = calculateTargetHours(b.monthly_invoice, bBranch, bCrew);
        break;
      case 'newHours':
        aValue = a.adjusted_hours !== null ? a.adjusted_hours : a.current_hours;
        bValue = b.adjusted_hours !== null ? b.adjusted_hours : b.current_hours;
        break;
      case 'newDL':
        const aNewHours = a.adjusted_hours !== null ? a.adjusted_hours : a.current_hours;
        const bNewHours = b.adjusted_hours !== null ? b.adjusted_hours : b.current_hours;
        const aBrName = a.branches?.name || '';
        const aCrType = a.crews?.crew_type || '';
        const bBrName = b.branches?.name || '';
        const bCrType = b.crews?.crew_type || '';
        aValue = calculateDirectLaborPercent(aNewHours, a.monthly_invoice, aBrName, aCrType);
        bValue = calculateDirectLaborPercent(bNewHours, b.monthly_invoice, bBrName, bCrType);
        break;
      case 'qsVisit':
        aValue = a.qs_visit_time || 0;
        bValue = b.qs_visit_time || 0;
        break;
      default:
        return 0;
    }
    
    // Compare values
    if (typeof aValue === 'string') {
      const comparison = aValue.localeCompare(bValue);
      return sortDirection === 'asc' ? comparison : -comparison;
    } else {
      const comparison = aValue - bValue;
      return sortDirection === 'asc' ? comparison : -comparison;
    }
  });

  // Calculate totals for current page (using filtered properties)
  const currentPageMonthlyInvoice = filteredProperties.reduce((sum, prop) => sum + prop.monthly_invoice, 0);
  const currentPageCurrentHours = filteredProperties.reduce((sum, prop) => sum + prop.current_hours, 0);
  const currentPageNewHours = filteredProperties.reduce((sum, prop) => {
    const editedHour = editedHours[prop.id];
    const adjustedHour = prop.adjusted_hours !== null ? prop.adjusted_hours : prop.current_hours;
    return sum + (editedHour !== undefined ? editedHour : adjustedHour);
  }, 0);
  const currentPageTargetHours = filteredProperties.reduce((sum, prop) => {
    const branchName = prop.branches?.name || '';
    const crewType = prop.crews?.crew_type || '';
    return sum + calculateTargetHours(prop.monthly_invoice, branchName, crewType);
  }, 0);
  
  // Always use actual totals from the backend, no estimation
  const totalMonthlyInvoice = backendTotalMonthlyInvoice || 0;
  const totalCurrentHours = backendTotalCurrentHours || 0;
  const totalNewHours = backendTotalNewHours || 0;
  
  // Calculate total target hours using property-level calculations
  const totalTargetHours = filteredProperties.reduce((sum, prop) => {
    const branchName = prop.branches?.name || '';
    const crewType = prop.crews?.crew_type || '';
    return sum + calculateTargetHours(prop.monthly_invoice, branchName, crewType);
  }, 0);
  
  // Calculate percentages based on property-level data with correct rates
  const calculateWeightedDLPercent = (getHoursForProperty) => {
    let totalLaborCost = 0;
    let totalAdjustedRevenue = 0;
    
    filteredProperties.forEach(prop => {
      const branchName = prop.branches?.name || '';
      const crewType = prop.crews?.crew_type || '';
      const hourlyCost = getHourlyCost(branchName, crewType);
      const driveTimeFactor = getDriveTimeFactor(crewType);
      const hours = getHoursForProperty(prop);
      
      totalLaborCost += hours * hourlyCost * WEEKS_PER_MONTH;
      totalAdjustedRevenue += prop.monthly_invoice * driveTimeFactor;
    });
    
    return totalAdjustedRevenue > 0 ? (totalLaborCost / totalAdjustedRevenue) * 100 : 0;
  };
  
  const currentOverallDirectLabor = calculateWeightedDLPercent(prop => prop.current_hours);
  const newOverallDirectLabor = calculateWeightedDLPercent(prop => {
    const editedHour = editedHours[prop.id];
    const adjustedHour = prop.adjusted_hours !== null ? prop.adjusted_hours : prop.current_hours;
    return editedHour !== undefined ? editedHour : adjustedHour;
  });

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
    <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-slate-50 min-h-screen">
      <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
        {/* Header with gradient background */}
        <div className="bg-gradient-to-r from-white to-gray-100 p-4 border-b border-gray-200" 
             style={{ borderTop: `4px solid ${selectedBranch.color || '#4F46E5'}` }}>
          {/* Header - Top Row */}
          <div className="flex justify-between items-center mb-4">
            <h1 className="text-2xl font-bold text-gray-800">Direct Labor Maintenance Calculator</h1>
            
            <div className="flex items-center space-x-2">
              {/* Page Navigation Links */}
              <Link
                href="/crews"
                className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-emerald-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M13 6a3 3 0 11-6 0 3 3 0 016 0zM18 8a2 2 0 11-4 0 2 2 0 014 0zM14 15a4 4 0 00-8 0v3h8v-3zM6 8a2 2 0 11-4 0 2 2 0 014 0zM16 18v-3a5.972 5.972 0 00-.75-2.906A3.005 3.005 0 0119 15v3h-3zM4.75 12.094A5.973 5.973 0 004 15v3H1v-3a3 3 0 013.75-2.906z" />
                </svg>
                <span>Crews</span>
              </Link>

              <Link
                href="/properties"
                className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-blue-600" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M10.707 2.293a1 1 0 00-1.414 0l-7 7a1 1 0 001.414 1.414L4 10.414V17a1 1 0 001 1h2a1 1 0 001-1v-2a1 1 0 011-1h2a1 1 0 011 1v2a1 1 0 001 1h2a1 1 0 001-1v-6.586l.293.293a1 1 0 001.414-1.414l-7-7z" />
                </svg>
                <span>Properties</span>
              </Link>

              <Link
                href="/schedule"
                className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-purple-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M6 2a1 1 0 00-1 1v1H4a2 2 0 00-2 2v10a2 2 0 002 2h12a2 2 0 002-2V6a2 2 0 00-2-2h-1V3a1 1 0 10-2 0v1H7V3a1 1 0 00-1-1zm0 5a1 1 0 000 2h8a1 1 0 100-2H6z" clipRule="evenodd" />
                </svg>
                <span>Scheduling</span>
              </Link>

              <Link
                href="/qs-routes"
                className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-teal-600" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                </svg>
                <span>QS Routes</span>
              </Link>

              <div className="relative" ref={forecastRef}>
                <button
                  onClick={() => setShowForecast(!showForecast)}
                  className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-amber-600" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M2 11a1 1 0 011-1h2a1 1 0 011 1v5a1 1 0 01-1 1H3a1 1 0 01-1-1v-5zM8 7a1 1 0 011-1h2a1 1 0 011 1v9a1 1 0 01-1 1H9a1 1 0 01-1-1V7zM14 4a1 1 0 011-1h2a1 1 0 011 1v12a1 1 0 01-1 1h-2a1 1 0 01-1-1V4z" />
                  </svg>
                  <span>FTE Forecast</span>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                </button>
                {showForecast && (
                  <div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                    <Link href="/forecast" onClick={() => setShowForecast(false)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2">
                      <span>Maintenance</span>
                    </Link>
                    <Link href="/forecast/arbor" onClick={() => setShowForecast(false)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2">
                      <span>Arbor</span>
                    </Link>
                    <Link href="/forecast/enhancements" onClick={() => setShowForecast(false)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2">
                      <span>Enhancements</span>
                    </Link>
                    <Link href="/forecast/irrigation" onClick={() => setShowForecast(false)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2">
                      <span>Irrigation</span>
                    </Link>
                    <Link href="/forecast/spray" onClick={() => setShowForecast(false)} className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2">
                      <span>Spray</span>
                    </Link>
                  </div>
                )}
              </div>

              {/* Divider */}
              <div className="h-8 w-px bg-gray-300"></div>

              {/* Exports Dropdown (admin only) */}
              {userRole === 'admin' && (
                <div className="relative" ref={exportsRef}>
                  <button
                    onClick={() => setShowExports(!showExports)}
                    className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                    </svg>
                    <span>Exports</span>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                  {showExports && (
                    <div className="absolute right-0 mt-1 w-48 bg-white border border-gray-200 rounded-lg shadow-lg z-50 py-1">
                      <button
                        onClick={() => { exportAllProperties(); setShowExports(false); }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                        <span>All Properties Export</span>
                      </button>
                      <button
                        onClick={() => { exportToCSV(); setShowExports(false); }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        <span>Route Export</span>
                      </button>
                      <button
                        onClick={() => { exportQSSchedule(); setShowExports(false); }}
                        className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 flex items-center space-x-2"
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                        </svg>
                        <span>QS Export</span>
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Manage Users (admin only) */}
              {userRole === 'admin' && (
                <button
                  onClick={() => setShowUserManagement(true)}
                  className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5"
                  title="Manage Users"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.49 3.17c-.38-1.56-2.6-1.56-2.98 0a1.532 1.532 0 01-2.286.948c-1.372-.836-2.942.734-2.106 2.106.54.886.061 2.042-.947 2.287-1.561.379-1.561 2.6 0 2.978a1.532 1.532 0 01.947 2.287c-.836 1.372.734 2.942 2.106 2.106a1.532 1.532 0 012.287.947c.379 1.561 2.6 1.561 2.978 0a1.533 1.533 0 012.287-.947c1.372.836 2.942-.734 2.106-2.106a1.533 1.533 0 01.947-2.287c1.561-.379 1.561-2.6 0-2.978a1.532 1.532 0 01-.947-2.287c.836-1.372-.734-2.942-2.106-2.106a1.532 1.532 0 01-2.287-.947zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
                  </svg>
                  <span>Users</span>
                </button>
              )}

              {/* Sign Out Button */}
              {session && (
                <button
                  onClick={handleSignOut}
                  className="flex items-center space-x-2 px-3 py-1.5 bg-white border border-gray-300 rounded-full hover:bg-gray-50 hover:shadow-md transition-all shadow-sm"
                  title={`Signed in as ${session.user?.email}`}
                >
                  {session.user?.user_metadata?.avatar_url ? (
                    <img
                      src={session.user.user_metadata.avatar_url}
                      alt="Profile"
                      className="w-6 h-6 rounded-full"
                      onError={(e) => {
                        e.target.style.display = 'none';
                        e.target.nextSibling.style.display = 'flex';
                      }}
                    />
                  ) : null}
                  <div
                    className={`w-6 h-6 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-white text-xs font-medium ${session.user?.user_metadata?.avatar_url ? 'hidden' : ''}`}
                  >
                    {session.user?.email?.charAt(0).toUpperCase() || 'U'}
                  </div>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                  </svg>
                </button>
              )}
            </div>
          </div>
          
          {/* Filter Controls Row */}
          <div className="flex flex-wrap items-center gap-2">
            <BranchDropdown
              branches={branches}
              selectedBranchId={selectedBranchId}
              onChange={(branchId) => {
                setSelectedBranchId(branchId);
                setSelectedCrewId(null);
                setPage(1);
              }}
            />

            <div className="relative">
              <select
                value={selectedCrewType}
                onChange={(e) => {
                  setSelectedCrewType(e.target.value);
                  setPage(1);
                }}
                className="border rounded-lg px-4 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none text-sm font-medium bg-white shadow-sm text-gray-900"
                style={{ minWidth: '180px' }}
              >
                <option value="">All Crew Types</option>
                <option value="Maintenance">Maintenance</option>
                <option value="Onsite">Onsite</option>
              </select>
              <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
                <svg className="h-5 w-5 text-gray-700" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>

            <div className="relative">
              <select
                value={selectedCrewId || ""}
                onChange={(e) => {
                  const crewId = e.target.value ? parseInt(e.target.value) : null;
                  setSelectedCrewId(crewId);
                  setPage(1);
                }}
                className="border rounded-lg px-4 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none text-sm font-medium bg-white shadow-sm text-gray-900"
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
                <svg className="h-5 w-5 text-gray-700" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                  <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                </svg>
              </div>
            </div>

            {/* Mismatch Filter Toggle - pushed right */}
            <button
              onClick={() => setShowMismatchOnly(!showMismatchOnly)}
              className={`ml-auto flex items-center space-x-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors shadow-sm ${
                showMismatchOnly
                  ? 'bg-amber-500 text-white border border-amber-600 hover:bg-amber-600'
                  : 'bg-white text-gray-700 border border-gray-300 hover:bg-gray-50'
              }`}
              title="Show only properties where Current Hours ≠ New Hours"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
              </svg>
              <span>Needs Update</span>
            </button>
          </div>
          
          {/* Compact Stats Bar */}
          <div className="mt-3 flex items-stretch flex-wrap gap-2">
            {/* Target Group */}
            <div className="flex items-center gap-4 bg-slate-100 border border-slate-300 rounded-lg px-4 py-2.5">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-800 uppercase tracking-wide">Target DL</span>
                <div className="flex items-center mt-0.5">
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
                      className="border border-slate-400 rounded w-14 px-2 py-0.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none text-center font-bold bg-white"
                    />
                    <span className="absolute right-1.5 top-1/2 transform -translate-y-1/2 text-xs font-bold text-slate-700">%</span>
                  </div>
                </div>
              </div>
              <div className="h-8 w-px bg-slate-300" />
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-slate-800 uppercase tracking-wide">Target Hrs</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-sm font-bold text-slate-900">{formatNumber(totalTargetHours)}</span>
                  <span className="text-xs font-semibold text-slate-600">({formatHeadcount(totalTargetHours)} HC)</span>
                </div>
              </div>
            </div>

            {/* Current Group */}
            <div className="flex items-center gap-4 bg-blue-100 border border-blue-300 rounded-lg px-4 py-2.5">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Current DL</span>
                <span className={`text-sm font-bold mt-0.5 ${currentOverallDirectLabor < targetDirectLaborPercent * 100 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatPercent(currentOverallDirectLabor)}
                </span>
              </div>
              <div className="h-8 w-px bg-blue-300" />
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-blue-900 uppercase tracking-wide">Current Hrs</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-sm font-bold text-blue-900">{formatNumber(totalCurrentHours)}</span>
                  <span className="text-xs font-semibold text-blue-700">({formatHeadcount(totalCurrentHours)} HC)</span>
                </div>
              </div>
            </div>

            {/* New Group */}
            <div className="flex items-center gap-4 bg-indigo-100 border border-indigo-300 rounded-lg px-4 py-2.5">
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-indigo-900 uppercase tracking-wide">New DL</span>
                <span className={`text-sm font-bold mt-0.5 ${newOverallDirectLabor < targetDirectLaborPercent * 100 ? 'text-green-700' : 'text-red-700'}`}>
                  {formatPercent(newOverallDirectLabor)}
                </span>
              </div>
              <div className="h-8 w-px bg-indigo-300" />
              <div className="flex flex-col">
                <span className="text-xs font-semibold text-indigo-900 uppercase tracking-wide">New Hrs</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className="text-sm font-bold text-indigo-900">{formatNumber(totalNewHours)}</span>
                  <span className="text-xs font-semibold text-indigo-700">({formatHeadcount(totalNewHours)} HC)</span>
                </div>
              </div>
            </div>

            {/* Diff Group */}
            <div className={`flex items-center rounded-lg px-4 py-2.5 ${totalNewHours <= totalTargetHours ? 'bg-green-100 border border-green-300' : 'bg-red-100 border border-red-300'}`}>
              <div className="flex flex-col">
                <span className={`text-xs font-semibold uppercase tracking-wide ${totalNewHours <= totalTargetHours ? 'text-green-900' : 'text-red-900'}`}>Diff</span>
                <div className="flex items-baseline gap-1 mt-0.5">
                  <span className={`text-sm font-bold ${totalNewHours <= totalTargetHours ? 'text-green-800' : 'text-red-800'}`}>
                    {formatNumber(totalNewHours - totalTargetHours)}
                  </span>
                  <span className={`text-xs font-semibold ${totalNewHours <= totalTargetHours ? 'text-green-700' : 'text-red-700'}`}>({(newHeadcount - targetHeadcount).toFixed(1)} HC)</span>
                </div>
              </div>
            </div>

            {/* Rates */}
            <div className="flex items-center text-xs font-semibold text-slate-700 px-2">
              Rates: PHX ${HOURLY_COST_PHOENIX_MAINTENANCE}/${HOURLY_COST_PHOENIX_ONSITE} &middot; LV ${HOURLY_COST_LAS_VEGAS_MAINTENANCE}/${HOURLY_COST_LAS_VEGAS_ONSITE}
            </div>
          </div>
          
          {/* Advanced Filters Section */}
          <div className="mt-3">
            <div className="flex items-center mb-2">
              <button
                type="button"
                onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                className="relative px-3 py-1 text-xs font-semibold text-blue-700 bg-blue-50 border border-blue-300 rounded-full hover:bg-blue-100 flex items-center gap-1.5 focus:outline-none transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
                </svg>
                {showAdvancedFilters ? 'Hide Filters' : 'More Filters'}
                {/* Active filter count dot */}
                {(() => {
                  const count = [regionFilter, accountManagerFilter, propertyTypeFilter, companyFilter, clientFilter, propertyNameFilter].filter(Boolean).length;
                  return count > 0 ? (
                    <span className="inline-flex items-center justify-center w-4 h-4 text-[10px] font-bold text-white bg-blue-500 rounded-full">
                      {count}
                    </span>
                  ) : null;
                })()}
              </button>
            </div>
            
            {showAdvancedFilters && (
              <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 mb-4 animate-fadeIn">
                <h3 className="text-sm font-medium text-gray-700 mb-3">Filter Properties</h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
                  {/* Property Name Search */}
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">Property Name</label>
                    <input
                      type="text"
                      value={propertyNameFilter}
                      onChange={(e) => setPropertyNameFilter(e.target.value)}
                      placeholder="Search by name..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  
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
          <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-blue-900 sticky top-0 z-10">
                <tr>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 w-64 max-w-64 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('property')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Property</span>
                      {sortField === 'property' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('css')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>CSS</span>
                      {sortField === 'css' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('monthlyInvoice')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Monthly Invoice</span>
                      {sortField === 'monthlyInvoice' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('currentHours')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Current Wkly Total Hours<br/><span className="text-blue-200 normal-case">(Crew Hrs)</span></span>
                      {sortField === 'currentHours' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('currentDL')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Current DL%</span>
                      {sortField === 'currentDL' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('targetHours')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>Target Wk Hrs<br/><span className="text-blue-200 normal-case">(Crew Hrs)</span></span>
                      {sortField === 'targetHours' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('newHours')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>New Wkly Total Hours<br/><span className="text-blue-200 normal-case">(Crew Hrs)</span></span>
                      {sortField === 'newHours' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('newDL')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>New DL%</span>
                      {sortField === 'newDL' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                  <th 
                    scope="col" 
                    className="px-4 py-2 text-left text-xs font-medium text-white uppercase tracking-wider bg-blue-900 cursor-pointer hover:bg-blue-800 select-none"
                    onClick={() => handleSort('qsVisit')}
                  >
                    <div className="flex items-center space-x-1">
                      <span>QS Visit<br/><span className="text-blue-200 normal-case">(minutes)</span></span>
                      {sortField === 'qsVisit' && (
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          {sortDirection === 'asc' ? (
                            <path fillRule="evenodd" d="M14.707 12.707a1 1 0 01-1.414 0L10 9.414l-3.293 3.293a1 1 0 01-1.414-1.414l4-4a1 1 0 011.414 0l4 4a1 1 0 010 1.414z" clipRule="evenodd" />
                          ) : (
                            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                          )}
                        </svg>
                      )}
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-100">
                {sortedProperties.length === 0 ? (
                  <tr>
                    <td colSpan="9" className="px-6 py-12 text-center text-gray-500">
                      <div className="flex flex-col items-center">
                        {showMismatchOnly ? (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-green-400 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-lg font-medium text-green-700">All properties are up to date!</p>
                            <p className="text-sm text-gray-400 mt-1">No properties need hours updates on this page</p>
                          </>
                        ) : (
                          <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-12 w-12 text-gray-300 mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
                            </svg>
                            <p className="text-lg font-medium">No properties found</p>
                            <p className="text-sm text-gray-400 mt-1">Try changing your filters or adding properties</p>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  sortedProperties.map((property, index) => {
                    const branchName = property.branches?.name || '';
                    const crewType = property.crews?.crew_type || '';
                    const targetHours = calculateTargetHours(property.monthly_invoice, branchName, crewType);
                    const currentDLPercent = calculateDirectLaborPercent(property.current_hours, property.monthly_invoice, branchName, crewType);
                    const newHours = editedHours[property.id] !== undefined 
                      ? editedHours[property.id] 
                      : (property.adjusted_hours !== null ? property.adjusted_hours : property.current_hours);
                    const newDLPercent = calculateDirectLaborPercent(newHours, property.monthly_invoice, branchName, crewType);
                    
                    // Determine if this property is currently being saved
                    const isSaving = savingPropertyId === property.id;
                    const justSaved = recentlySavedId === property.id;
                    
                    // Check if current hours differs from new/adjusted hours (needs update)
                    const hasHoursMismatch = property.adjusted_hours !== null && property.adjusted_hours !== property.current_hours;
                    
                    return (
                      <tr 
                        key={property.id} 
                        className={`transition-all duration-300 ${justSaved ? 'bg-green-100' : index % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'} ${!justSaved && 'hover:bg-blue-50'}`}
                      >
                        <td className="px-4 py-2 w-64 max-w-64">
                          {/* Make property name a link to edit property directly */}
                          <div className="flex items-center">
                            <Link 
                              href={`/properties?edit=${property.id}`}
                              className="font-medium text-blue-600 hover:text-blue-800 hover:underline cursor-pointer text-left break-words"
                            >
                              {property.name}
                            </Link>
                            {property.complex_id && (
                              <span 
                                className="ml-1.5 text-orange-500 cursor-help" 
                                title={complexNameMap[property.complex_id] || 'Part of complex'}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a1 1 0 01-1 1h-2v-2a2 2 0 00-2-2H9a2 2 0 00-2 2v2H5a1 1 0 01-1-1V4zm3 1h2v2H7V5zm2 4H7v2h2V9zm2-4h2v2h-2V5zm2 4h-2v2h2V9z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col text-xs text-gray-500 mt-1">
                            {property.crews && (
                              <span>Crew: {property.crews.name} ({property.crews.crew_type}) - {property.crews.size}m</span>
                            )}
                            {(property.service_window_start || property.service_window_end) && (
                              <span className="text-purple-600 mt-0.5">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3 inline mr-1" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                </svg>
                                {property.service_window_start ? formatTime(property.service_window_start) : '—'} - {property.service_window_end ? formatTime(property.service_window_end) : '—'}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                          {property.account_manager || '—'}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900 font-medium">
                          {formatCurrency(property.monthly_invoice)}
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-900">
                          <div className="flex items-center">
                            {property.current_hours}
                            <span className="text-gray-700 ml-1">
                              ({property.crews?.size ? (property.current_hours / property.crews.size).toFixed(1) : '—'})
                            </span>
                            {/* Hours mismatch indicator */}
                            {hasHoursMismatch && (
                              <span 
                                className="ml-2 text-amber-500" 
                                title={`New hours (${property.adjusted_hours}) differs from current hours (${property.current_hours}) - update needed`}
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                                </svg>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`px-3 py-1 inline-flex text-sm leading-5 font-medium rounded-full ${currentDLPercent < targetDirectLaborPercent * 100 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {formatPercent(currentDLPercent)}
                          </span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap text-sm font-medium text-indigo-600">
                          {targetHours.toFixed(1)}
                          <span className="text-gray-700 font-normal ml-1">
                            ({property.crews?.size ? (targetHours / property.crews.size).toFixed(1) : '—'})
                          </span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            <input
                              type="number"
                              value={editedHours[property.id] !== undefined ? editedHours[property.id] : ""}
                              onChange={(e) => handleNewHoursChange(property.id, e.target.value)}
                              placeholder={(property.adjusted_hours !== null ? property.adjusted_hours : property.current_hours).toString()}
                              className="block w-24 sm:text-sm border-gray-300 border rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm bg-white text-center text-gray-900 placeholder:text-gray-900"
                              disabled={isSaving}
                            />
                            <span className="text-gray-700 text-sm">
                              ({property.crews?.size ? (newHours / property.crews.size).toFixed(1) : '—'})
                            </span>
                            {justSaved && !editedHours[property.id] && (
                              <div className="w-8 h-8 flex items-center justify-center bg-green-500 rounded-md">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                            {/* Show save button if edited value differs from the saved new hours (adjusted_hours or current_hours) */}
                            {editedHours[property.id] !== undefined && editedHours[property.id] !== (property.adjusted_hours !== null ? property.adjusted_hours : property.current_hours) && (
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
                        <td className="px-4 py-2 whitespace-nowrap">
                          <span className={`px-3 py-1 inline-flex text-sm leading-5 font-medium rounded-full ${newDLPercent < targetDirectLaborPercent * 100 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                            {editedHours[property.id] !== undefined || property.adjusted_hours !== null ? formatPercent(newDLPercent) : "-"}
                          </span>
                        </td>
                        <td className="px-4 py-2 whitespace-nowrap">
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              inputMode="numeric"
                              pattern="[0-9]*"
                              value={editedQSTime[property.id] !== undefined ? editedQSTime[property.id] : ""}
                              onChange={(e) => handleQSTimeChange(property.id, e.target.value)}
                              placeholder={property.qs_visit_time !== null ? property.qs_visit_time.toString() : "—"}
                              className="block w-20 sm:text-sm border-gray-300 border rounded-md px-2 py-1.5 focus:outline-none focus:ring-2 focus:ring-teal-500 shadow-sm bg-white text-center text-gray-900 placeholder:text-gray-900"
                              disabled={savingPropertyId === property.id}
                            />
                            {editedQSTime[property.id] !== undefined && String(editedQSTime[property.id]) !== String(property.qs_visit_time || '') && (
                              savingPropertyId === property.id ? (
                                <div className="w-7 h-7 flex items-center justify-center">
                                  <div className="w-4 h-4 border-t-2 border-b-2 border-teal-500 rounded-full animate-spin"></div>
                                </div>
                              ) : (
                                <button
                                  onClick={() => saveQSTime(property.id, editedQSTime[property.id])}
                                  className="bg-teal-600 hover:bg-teal-700 text-white p-1.5 rounded-md shadow-sm transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-teal-500"
                                  title="Save QS time"
                                >
                                  <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                </button>
                              )
                            )}
                            {recentlySavedId === property.id && !editedQSTime[property.id] && property.qs_visit_time !== null && (
                              <div className="w-7 h-7 flex items-center justify-center bg-green-500 rounded-md">
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                              </div>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}

                {/* Totals row */}
                <tr className="bg-gray-50 font-medium border-t-2 border-gray-200">
                  <td className="px-4 py-2 whitespace-nowrap text-sm font-bold text-gray-900 w-64 max-w-64">TOTALS</td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700">—</td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm font-bold text-gray-900">{formatCurrency(currentPageMonthlyInvoice)}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm font-bold text-gray-900">{formatNumber(currentPageCurrentHours)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`px-3 py-1 inline-flex text-sm leading-5 font-bold rounded-full ${currentOverallDirectLabor < targetDirectLaborPercent * 100 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {formatPercent(currentOverallDirectLabor)}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm font-bold text-gray-900">{formatNumber(currentPageTargetHours)}</td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm font-bold text-gray-900">{formatNumber(currentPageNewHours)}</td>
                  <td className="px-4 py-2 whitespace-nowrap">
                    <span className={`px-3 py-1 inline-flex text-sm leading-5 font-bold rounded-full ${newOverallDirectLabor < targetDirectLaborPercent * 100 ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
                      {currentPageNewHours > 0 ? formatPercent(newOverallDirectLabor) : "-"}
                    </span>
                  </td>
                  <td className="px-4 py-2 whitespace-nowrap text-sm text-gray-700">—</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* Formula Section */}
        <div className="border-t border-gray-200">
          <div className="bg-gray-50 p-4 sm:p-6">
            <div className="text-sm text-gray-500 border-l-4 border-blue-500 pl-3 py-1 bg-blue-50 rounded-r-md">
              <p className="font-medium text-blue-900">Formula: (Monthly Invoice × Target DL%) × Drive Time Factor ÷ Hourly Cost ÷ 4.33</p>
              <p className="text-blue-800 mt-1">Hourly rates: PHX Maint $25.50, PHX Onsite $30.00, LV Maint $24.50, LV Onsite $25.00 | Drive Time: Maint 0.9, Onsite 1.0</p>
            </div>
          </div>
        </div>
      </div>
      
      {/* Results counter at bottom */}
      {!propertiesLoading && (
        <div className="mt-4 text-center text-sm text-gray-500">
          {showMismatchOnly ? (
            <span>Showing {filteredProperties.length} properties needing update (from {properties.length} total)</span>
          ) : (
            <span>Showing {properties.length} properties</span>
          )}
        </div>
      )}

      {/* No need for the PropertyForm modal */}

      {/* User Management Modal */}
      {showUserManagement && (
        <UserManagementModal
          onClose={() => setShowUserManagement(false)}
          currentUserEmail={session?.user?.email}
        />
      )}
    </div>
  );
};

export default DirectLaborCalculator;