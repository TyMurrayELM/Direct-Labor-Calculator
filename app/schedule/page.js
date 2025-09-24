"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  useProperties, 
  useCrews, 
  useBranches,
  useCrewSchedule,
  saveWeeklySchedule,
  clearCrewSchedule 
} from '../hooks/useSupabase';
import { createClientComponentClient } from '@supabase/auth-helpers-nextjs';
import { useRouter } from 'next/navigation';

export default function SchedulePage() {
  const router = useRouter();
  const supabase = createClientComponentClient();
  const [session, setSession] = useState(null);
  
  // Fetch data using your existing hooks
  const { properties = [], loading: propertiesLoading } = useProperties({
    pageSize: 1000 // Load all properties
  });
  const { crews = [], loading: crewsLoading } = useCrews();
  const { branches = [], loading: branchesLoading } = useBranches();

  // State for the scheduler
  const [selectedCrew, setSelectedCrew] = useState(null);
  const [weekSchedule, setWeekSchedule] = useState({
    Monday: [],
    Tuesday: [],
    Wednesday: [],
    Thursday: [],
    Friday: [],
  });
  const [unassignedJobs, setUnassignedJobs] = useState([]);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  
  // Use the crew schedule hook
  const { schedule: savedSchedule, loading: scheduleLoading } = useCrewSchedule(selectedCrew?.id);

  // Constants (matching your Direct Labor Calculator)
  const DRIVE_TIME_FACTOR = 0.9;
  const HOURLY_COST = 24.75;
  const WEEKS_PER_MONTH = 4.33;
  const TARGET_DIRECT_LABOR_PERCENT = 40;

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

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

  // Initialize data when loaded
  useEffect(() => {
    if (!propertiesLoading && !crewsLoading && properties.length > 0 && crews.length > 0) {
      // Debug: Check the structure of properties
      console.log('Properties loaded:', properties.length, 'properties');
      console.log('Sample property structure:', properties[0]);
      
      // Verify all properties have IDs
      const propertiesWithoutIds = properties.filter(p => !p || !p.id);
      if (propertiesWithoutIds.length > 0) {
        console.error('Properties without IDs:', propertiesWithoutIds);
      }
      
      // Set initial selected crew
      if (!selectedCrew && crews.length > 0) {
        setSelectedCrew(crews[0]);
      }
    }
  }, [properties, crews, propertiesLoading, crewsLoading]);
  
  // Load saved schedule when crew changes or schedule data loads
  useEffect(() => {
    if (!scheduleLoading && savedSchedule && selectedCrew && properties.length > 0) {
      console.log('Loading saved schedule:', savedSchedule);
      console.log('Available properties:', properties);
      
      // Create a map of properties by ID for quick lookup
      const propertyMap = {};
      properties.forEach(prop => {
        if (prop && prop.id) {
          propertyMap[prop.id] = prop;
        }
      });
      
      // Helper function to convert IDs to full property objects
      const idsToProperties = (ids) => {
        if (!ids || !Array.isArray(ids)) return [];
        return ids
          .map(id => {
            // Handle both cases: id might be a number or an object
            const propId = typeof id === 'object' ? id.id : id;
            return propertyMap[propId];
          })
          .filter(prop => prop !== undefined);
      };
      
      // Check if savedSchedule contains full objects or just IDs
      const sampleItem = savedSchedule.Monday?.[0];
      const isFullObject = sampleItem && typeof sampleItem === 'object' && sampleItem.name;
      
      if (isFullObject) {
        // If we already have full objects, use them directly
        const newSchedule = {
          Monday: savedSchedule.Monday || [],
          Tuesday: savedSchedule.Tuesday || [],
          Wednesday: savedSchedule.Wednesday || [],
          Thursday: savedSchedule.Thursday || [],
          Friday: savedSchedule.Friday || []
        };
        
        setWeekSchedule(newSchedule);
        setUnassignedJobs(savedSchedule.unassigned || []);
      } else {
        // Convert IDs to full property objects
        const newSchedule = {
          Monday: idsToProperties(savedSchedule.Monday),
          Tuesday: idsToProperties(savedSchedule.Tuesday),
          Wednesday: idsToProperties(savedSchedule.Wednesday),
          Thursday: idsToProperties(savedSchedule.Thursday),
          Friday: idsToProperties(savedSchedule.Friday)
        };
        
        setWeekSchedule(newSchedule);
        
        // Handle unassigned - if it's IDs, convert them; otherwise use as is
        const unassignedItems = savedSchedule.unassigned || [];
        if (unassignedItems.length > 0 && typeof unassignedItems[0] !== 'object') {
          setUnassignedJobs(idsToProperties(unassignedItems));
        } else {
          setUnassignedJobs(unassignedItems);
        }
      }
      
      setHasChanges(false);
    }
  }, [savedSchedule, scheduleLoading, selectedCrew, properties]);
  
  // Initialize unassigned jobs when no saved schedule exists
  useEffect(() => {
    if (!scheduleLoading && !savedSchedule && selectedCrew && properties.length > 0) {
      console.log('No saved schedule found, initializing with all properties as unassigned');
      // If there's no saved schedule, put all properties in unassigned
      setUnassignedJobs(properties);
      setWeekSchedule({
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
      });
      setHasChanges(false);
    }
  }, [savedSchedule, scheduleLoading, selectedCrew, properties]);

  // Sign out handler
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // Save schedule handler - FIXED to send only IDs with validation
  const handleSaveSchedule = async () => {
    if (!selectedCrew) return;
    
    setIsSaving(true);
    setSaveMessage(null);
    
    // Debug: Log the structure to understand what we're working with
    console.log('Current weekSchedule:', weekSchedule);
    console.log('Current unassignedJobs:', unassignedJobs);
    
    // Helper function to safely extract ID from a property object
    const extractPropertyId = (item) => {
      if (!item) {
        console.error('Item is null or undefined');
        return null;
      }
      
      // If it's already a number, return it
      if (typeof item === 'number') return item;
      
      // If it's an object, try different possible ID fields
      if (typeof item === 'object') {
        console.log('Extracting ID from object:', item);
        // Try common ID field names
        const id = item.id || item.property_id || item.propertyId;
        if (id !== undefined && id !== null) {
          const parsedId = parseInt(id);
          if (!isNaN(parsedId)) {
            console.log('Successfully extracted ID:', parsedId);
            return parsedId;
          } else {
            console.error('Failed to parse ID as integer:', id);
          }
        } else {
          console.error('No ID field found in object:', item);
        }
      }
      
      console.error('Could not extract ID from:', item);
      return null;
    };
    
    // Convert the schedule to use only property IDs with validation
    const scheduleWithIds = {};
    let hasInvalidIds = false;
    let allExtractedIds = [];
    
    for (const day of days) {
      console.log(`Processing ${day} with ${weekSchedule[day].length} jobs`);
      scheduleWithIds[day] = [];
      
      for (const job of weekSchedule[day]) {
        const id = extractPropertyId(job);
        if (id === null) {
          console.error(`Invalid job on ${day}:`, job);
          hasInvalidIds = true;
        } else {
          scheduleWithIds[day].push(id);
          allExtractedIds.push(id);
        }
      }
    }
    
    // Also process unassigned job IDs with validation
    const unassignedIds = [];
    console.log(`Processing ${unassignedJobs.length} unassigned jobs`);
    
    for (const job of unassignedJobs) {
      const id = extractPropertyId(job);
      if (id === null) {
        console.error('Invalid unassigned job:', job);
        hasInvalidIds = true;
      } else {
        unassignedIds.push(id);
        allExtractedIds.push(id);
      }
    }
    
    // Check for undefined values in the arrays
    const undefinedScheduledCount = Object.values(scheduleWithIds).flat().filter(id => id === undefined || id === null).length;
    const undefinedUnassignedCount = unassignedIds.filter(id => id === undefined || id === null).length;
    
    if (undefinedScheduledCount > 0 || undefinedUnassignedCount > 0) {
      console.error('Found undefined IDs in the data to save!');
      console.error('Scheduled undefined count:', undefinedScheduledCount);
      console.error('Unassigned undefined count:', undefinedUnassignedCount);
      console.error('Full schedule data:', scheduleWithIds);
      console.error('Unassigned IDs:', unassignedIds);
      setSaveMessage({ 
        type: 'error', 
        text: 'Error: Some properties have undefined IDs. Check the console for details.' 
      });
      setIsSaving(false);
      return;
    }
    
    if (hasInvalidIds) {
      console.error('Some properties have invalid IDs. Cannot save.');
      setSaveMessage({ 
        type: 'error', 
        text: 'Error: Some properties have invalid IDs. Check the console for details.' 
      });
      setIsSaving(false);
      return;
    }
    
    // Create the payload with both scheduled and unassigned IDs
    // Ensure no undefined values slip through
    const scheduleData = {
      Monday: (scheduleWithIds.Monday || []).filter(id => id !== undefined && id !== null),
      Tuesday: (scheduleWithIds.Tuesday || []).filter(id => id !== undefined && id !== null),
      Wednesday: (scheduleWithIds.Wednesday || []).filter(id => id !== undefined && id !== null),
      Thursday: (scheduleWithIds.Thursday || []).filter(id => id !== undefined && id !== null),
      Friday: (scheduleWithIds.Friday || []).filter(id => id !== undefined && id !== null),
      unassigned: (unassignedIds || []).filter(id => id !== undefined && id !== null)
    };
    
    console.log('Final schedule data to save:', scheduleData);
    console.log('All extracted IDs:', allExtractedIds);
    
    // Final validation - check if any arrays contain undefined
    const finalCheck = [
      ...scheduleData.Monday,
      ...scheduleData.Tuesday,
      ...scheduleData.Wednesday,
      ...scheduleData.Thursday,
      ...scheduleData.Friday,
      ...scheduleData.unassigned
    ];
    
    const hasUndefined = finalCheck.some(id => id === undefined || id === null || isNaN(id));
    if (hasUndefined) {
      console.error('CRITICAL: Found undefined/null/NaN in final data!', finalCheck);
      setSaveMessage({ 
        type: 'error', 
        text: 'Critical error: Invalid IDs detected. Cannot save schedule.' 
      });
      setIsSaving(false);
      return;
    }
    
    try {
      const result = await saveWeeklySchedule(selectedCrew.id, scheduleData);
      
      if (result.success) {
        setSaveMessage({ type: 'success', text: 'Schedule saved successfully!' });
        setHasChanges(false);
      } else {
        console.error('Save failed:', result.error);
        setSaveMessage({ type: 'error', text: result.error || 'Failed to save schedule' });
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save schedule: ' + error.message });
    }
    
    setIsSaving(false);
    
    // Clear message after 3 seconds
    setTimeout(() => setSaveMessage(null), 3000);
  };
  
  // Clear schedule handler
  const handleClearSchedule = async () => {
    if (!selectedCrew || !window.confirm('Are you sure you want to clear the entire schedule?')) return;
    
    setIsSaving(true);
    
    try {
      const result = await clearCrewSchedule(selectedCrew.id);
      
      if (result.success) {
        // Reset to unassigned - combine all scheduled jobs with existing unassigned
        const allJobs = [...unassignedJobs];
        Object.values(weekSchedule).flat().forEach(job => {
          // Check if job is valid and not already in unassigned
          if (job && job.id && !allJobs.some(j => j.id === job.id)) {
            allJobs.push(job);
          }
        });
        
        setWeekSchedule({
          Monday: [],
          Tuesday: [],
          Wednesday: [],
          Thursday: [],
          Friday: [],
        });
        setUnassignedJobs(allJobs);
        setHasChanges(true);
        setSaveMessage({ type: 'success', text: 'Schedule cleared!' });
      } else {
        setSaveMessage({ type: 'error', text: result.error || 'Failed to clear schedule' });
      }
    } catch (error) {
      console.error('Clear error:', error);
      setSaveMessage({ type: 'error', text: 'Failed to clear schedule: ' + error.message });
    }
    
    setIsSaving(false);
    setTimeout(() => setSaveMessage(null), 3000);
  };

  // Calculate daily crew hours
  const dailyCrewHours = selectedCrew ? selectedCrew.size * 8 * DRIVE_TIME_FACTOR : 0;

  // Simplified drag handlers
  const onDragStart = (e, job, sourceDay) => {
    console.log('Drag started:', job.name, 'from', sourceDay);
    const dragData = JSON.stringify({ job, sourceDay });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('application/json', dragData);
    e.dataTransfer.setData('text/plain', ''); // Firefox compatibility
    setDraggedItem({ job, sourceDay });
  };

  const onDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const onDragEnter = (e, day) => {
    e.preventDefault();
    setDragOverDay(day);
  };

  const onDragLeave = (e) => {
    e.preventDefault();
    // Check if we're actually leaving the drop zone
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setDragOverDay(null);
    }
  };

  const onDrop = (e, targetDay) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Drop on:', targetDay);
    setDragOverDay(null);
    
    // Use the state variable if dataTransfer doesn't work
    if (!draggedItem) {
      console.error('No dragged item found');
      return;
    }
    
    const { job, sourceDay } = draggedItem;
    
    // Don't do anything if dropping in the same location
    if (sourceDay === targetDay) {
      setDraggedItem(null);
      return;
    }
    
    let newSchedule = { ...weekSchedule };
    let newUnassigned = [...unassignedJobs];

    // Remove from source
    if (sourceDay === 'unassigned') {
      newUnassigned = newUnassigned.filter(j => j.id !== job.id);
    } else if (sourceDay && newSchedule[sourceDay]) {
      newSchedule[sourceDay] = newSchedule[sourceDay].filter(j => j.id !== job.id);
    }

    // Add to target
    if (targetDay === 'unassigned') {
      newUnassigned.push(job);
    } else if (targetDay && newSchedule[targetDay]) {
      newSchedule[targetDay] = [...newSchedule[targetDay], job];
    }

    setWeekSchedule(newSchedule);
    setUnassignedJobs(newUnassigned);
    setHasChanges(true);
    setDraggedItem(null);
  };

  const onDragEnd = () => {
    console.log('Drag ended');
    setDraggedItem(null);
    setDragOverDay(null);
  };

  // Calculate statistics
  const calculateWeeklyStats = () => {
    const totalScheduledHours = Object.values(weekSchedule).flat().reduce((sum, job) => sum + (job.current_hours || 0), 0);
    const totalRevenue = Object.values(weekSchedule).flat().reduce((sum, job) => sum + (job.monthly_invoice || 0), 0);
    const weeklyCapacity = dailyCrewHours * 5;
    const utilizationPercent = weeklyCapacity > 0 ? (totalScheduledHours / weeklyCapacity) * 100 : 0;
    const directLaborPercent = totalRevenue > 0 ? ((totalScheduledHours * HOURLY_COST * WEEKS_PER_MONTH) / totalRevenue) * 100 : 0;

    return {
      totalScheduledHours,
      totalRevenue,
      weeklyCapacity,
      utilizationPercent,
      directLaborPercent
    };
  };

  const stats = calculateWeeklyStats();

  // Calculate Direct Labor percentage for each day
  const calculateDailyDL = (dayJobs) => {
    const dayHours = dayJobs.reduce((sum, job) => sum + (job.current_hours || 0), 0);
    const dayRevenue = dayJobs.reduce((sum, job) => sum + (job.monthly_invoice || 0), 0);
    if (dayRevenue === 0) return 0;
    
    const dailyLaborCost = dayHours * HOURLY_COST * WEEKS_PER_MONTH;
    return (dailyLaborCost / dayRevenue) * 100;
  };

  // Loading state
  if (propertiesLoading || crewsLoading || branchesLoading || scheduleLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-blue-100">
        <div className="p-8 bg-white shadow-lg rounded-lg">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 border-t-4 border-b-4 border-blue-500 rounded-full animate-spin"></div>
            <p className="text-lg font-semibold text-gray-700">Loading schedule data...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto p-4 bg-blue-100 min-h-screen">
      <div className="bg-white rounded-xl shadow-lg p-6">
        {/* Navigation Header */}
        <div className="mb-6 pb-4 border-b border-gray-200">
          <div className="flex justify-between items-center">
            <h1 className="text-2xl font-bold text-gray-800">Weekly Schedule - Drag & Drop</h1>
            
            <div className="flex space-x-3">
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
        </div>

        {/* Crew Selector */}
        <div className="mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <label className="text-sm font-medium text-gray-700">Select Crew:</label>
              <select
                value={selectedCrew?.id || ''}
                onChange={(e) => {
                  const crew = crews.find(c => c.id === parseInt(e.target.value));
                  setSelectedCrew(crew);
                  setHasChanges(false);
                }}
                className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {crews.map(crew => (
                  <option key={crew.id} value={crew.id}>
                    {crew.name} ({crew.crew_type}, {crew.size} members)
                  </option>
                ))}
              </select>
              {selectedCrew && (
                <span className="text-sm text-gray-600">
                  Supervisor: <span className="font-medium">{selectedCrew.supervisor}</span>
                </span>
              )}
            </div>
            
            {/* Action Buttons */}
            <div className="flex items-center space-x-2">
              {hasChanges && (
                <span className="text-sm text-yellow-600 font-medium mr-2">
                  ⚠️ Unsaved changes
                </span>
              )}
              <button
                onClick={handleSaveSchedule}
                disabled={isSaving || !hasChanges}
                className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                  hasChanges 
                    ? 'bg-green-600 text-white hover:bg-green-700' 
                    : 'bg-gray-300 text-gray-500 cursor-not-allowed'
                }`}
              >
                {isSaving ? 'Saving...' : 'Save Schedule'}
              </button>
              <button
                onClick={handleClearSchedule}
                disabled={isSaving}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 font-medium transition-colors"
              >
                Clear All
              </button>
            </div>
          </div>
          
          {/* Save message */}
          {saveMessage && (
            <div className={`mt-2 p-2 rounded-lg text-sm ${
              saveMessage.type === 'success' 
                ? 'bg-green-100 text-green-700' 
                : 'bg-red-100 text-red-700'
            }`}>
              {saveMessage.text}
            </div>
          )}
        </div>

        {/* Stats Bar */}
        <div className="grid grid-cols-5 gap-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg mb-6">
          <div>
            <div className="text-xs text-gray-600 font-medium">Weekly Capacity</div>
            <div className="text-lg font-bold text-gray-800">{stats.weeklyCapacity.toFixed(1)} hrs</div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium">Scheduled Hours</div>
            <div className="text-lg font-bold text-blue-600">{stats.totalScheduledHours.toFixed(1)} hrs</div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium">Utilization</div>
            <div className={`text-lg font-bold ${
              stats.utilizationPercent > 100 ? 'text-red-600' : 
              stats.utilizationPercent > 90 ? 'text-yellow-600' : 
              'text-green-600'
            }`}>
              {stats.utilizationPercent.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium">Weekly Revenue</div>
            <div className="text-lg font-bold text-green-600">${stats.totalRevenue.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium">Direct Labor %</div>
            <div className={`text-lg font-bold ${
              stats.directLaborPercent > TARGET_DIRECT_LABOR_PERCENT ? 'text-red-600' : 'text-green-600'
            }`}>
              {stats.directLaborPercent.toFixed(1)}%
            </div>
          </div>
        </div>

        {/* Main Schedule Grid */}
        <div className="grid grid-cols-6 gap-3">
          {/* Unassigned Jobs Column */}
          <div>
            <h3 className="font-semibold text-gray-700 mb-2 text-sm">
              Unassigned ({unassignedJobs.length})
            </h3>
            <div
              onDragOver={onDragOver}
              onDragEnter={(e) => onDragEnter(e, 'unassigned')}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, 'unassigned')}
              className={`border-2 rounded-lg p-2 min-h-[500px] transition-colors ${
                dragOverDay === 'unassigned' ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-yellow-50'
              }`}
            >
              <div className="space-y-2">
                {unassignedJobs
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((job) => (
                  <div
                    key={job.id}
                    draggable={true}
                    onDragStart={(e) => onDragStart(e, job, 'unassigned')}
                    onDragEnd={onDragEnd}
                    className="bg-white p-2 rounded shadow-sm border border-gray-200 cursor-move transition-all hover:shadow-md hover:border-blue-300"
                    style={{ userSelect: 'none' }}
                  >
                    <div className="text-xs font-medium text-gray-900 truncate">{job.name}</div>
                    <div className="text-xs text-gray-500 truncate">{job.address || 'No address'}</div>
                    <div className="flex justify-between items-center mt-1">
                      <span className="text-xs font-semibold text-blue-600">
                        {(job.current_hours || 0).toFixed(1)} hrs
                      </span>
                      <span className="text-xs text-green-600">
                        ${(job.monthly_invoice || 0).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Days of Week Columns */}
          {days.map(day => {
            const dayJobs = weekSchedule[day];
            const dayHours = dayJobs.reduce((sum, job) => sum + (job.current_hours || 0), 0);
            const utilizationPercent = dailyCrewHours > 0 ? (dayHours / dailyCrewHours) * 100 : 0;
            const dlPercent = calculateDailyDL(dayJobs);

            return (
              <div key={day}>
                <div className="mb-2">
                  <h3 className="font-semibold text-gray-700 text-sm">{day}</h3>
                  <div className="flex justify-between text-xs text-gray-500">
                    <span>{dayHours.toFixed(1)}/{dailyCrewHours.toFixed(1)} hrs</span>
                    <span className={dlPercent > TARGET_DIRECT_LABOR_PERCENT ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}>
                      DL: {dlPercent.toFixed(1)}%
                    </span>
                  </div>
                </div>
                <div
                  onDragOver={onDragOver}
                  onDragEnter={(e) => onDragEnter(e, day)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, day)}
                  className={`border-2 rounded-lg p-2 min-h-[500px] transition-colors ${
                    dragOverDay === day ? 'border-blue-400 bg-blue-50' : 
                    utilizationPercent > 100 ? 'border-red-300 bg-red-50' :
                    utilizationPercent > 90 ? 'border-yellow-300 bg-yellow-50' :
                    'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="space-y-2 max-h-[450px] overflow-y-auto">
                    {dayJobs.map((job) => (
                      <div
                        key={job.id}
                        draggable={true}
                        onDragStart={(e) => onDragStart(e, job, day)}
                        onDragEnd={onDragEnd}
                        className="bg-white p-2 rounded shadow-sm border border-gray-200 cursor-move transition-all hover:shadow-md hover:border-blue-300"
                        style={{ userSelect: 'none' }}
                      >
                        <div className="text-xs font-medium text-gray-900 truncate">{job.name}</div>
                        <div className="text-xs text-gray-500 truncate">{job.address || 'No address'}</div>
                        <div className="flex justify-between items-center mt-1">
                          <span className="text-xs font-semibold text-blue-600">
                            {(job.current_hours || 0).toFixed(1)} hrs
                          </span>
                          <span className="text-xs text-green-600">
                            ${(job.monthly_invoice || 0).toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  
                  {/* Day Footer with Utilization */}
                  <div className="border-t mt-3 pt-2">
                    <div className="text-xs">
                      <div className="flex justify-between mb-1">
                        <span className="text-gray-600">Jobs:</span>
                        <span className="font-medium">{dayJobs.length}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-600">Utilization:</span>
                        <span className={`font-medium ${
                          utilizationPercent > 100 ? 'text-red-600' : 
                          utilizationPercent > 90 ? 'text-yellow-600' : 
                          'text-green-600'
                        }`}>
                          {utilizationPercent.toFixed(1)}%
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Legend */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium text-gray-700 mb-2 text-sm">How to Use:</h4>
          <ul className="text-xs text-gray-600 space-y-1">
            <li>• Drag properties from "Unassigned" to schedule them on specific days</li>
            <li>• Move properties between days by dragging them</li>
            <li>• Click "Save Schedule" to save changes to the database</li>
            <li>• The schedule shows properties assigned to the selected crew</li>
            <li>• Color coding: Green = Good, Yellow = High utilization, Red = Over capacity</li>
            <li>• Direct Labor target is 40% - stay below for optimal profitability</li>
          </ul>
        </div>
      </div>
    </div>
  );
}