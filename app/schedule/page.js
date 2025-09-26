"use client";

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { 
  useProperties, 
  useCrews, 
  useBranches,
  useCrewSchedule,
  saveWeeklySchedule,
  clearCrewSchedule,
  updateCrew 
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
    Saturday: [],
  });
  const [unassignedJobs, setUnassignedJobs] = useState([]);
  const [draggedItem, setDraggedItem] = useState(null);
  const [dragOverDay, setDragOverDay] = useState(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState(null);
  const [hasChanges, setHasChanges] = useState(false);
  
  // State for crew quick edit modal
  const [showCrewEditModal, setShowCrewEditModal] = useState(false);
  const [editingSaving, setEditingSaving] = useState(false);
  
  // Use the crew schedule hook
  const { schedule: savedSchedule, loading: scheduleLoading } = useCrewSchedule(selectedCrew?.id);

  // Constants (matching your Direct Labor Calculator)
  const DRIVE_TIME_FACTOR = 0.9;
  const HOURLY_COST = 24.75;
  const OVERTIME_MULTIPLIER = 1.5;
  const OVERTIME_HOURLY_COST = HOURLY_COST * OVERTIME_MULTIPLIER; // $37.125
  const WEEKS_PER_MONTH = 4.33;
  const TARGET_DIRECT_LABOR_PERCENT = 40;

  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

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
      console.log('Loading saved schedule for crew:', selectedCrew.name);
      console.log('Crew branch_id:', selectedCrew.branch_id);
      
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
          Friday: savedSchedule.Friday || [],
          Saturday: savedSchedule.Saturday || []
        };
        
        setWeekSchedule(newSchedule);
        
        // For unassigned, get ALL properties from the same branch that don't have a service_day
        const branchUnassigned = properties.filter(prop => 
          prop.branch_id === selectedCrew.branch_id && 
          !prop.service_day
        );
        setUnassignedJobs(branchUnassigned);
      } else {
        // Convert IDs to full property objects
        const newSchedule = {
          Monday: idsToProperties(savedSchedule.Monday),
          Tuesday: idsToProperties(savedSchedule.Tuesday),
          Wednesday: idsToProperties(savedSchedule.Wednesday),
          Thursday: idsToProperties(savedSchedule.Thursday),
          Friday: idsToProperties(savedSchedule.Friday),
          Saturday: idsToProperties(savedSchedule.Saturday)
        };
        
        setWeekSchedule(newSchedule);
        
        // For unassigned, get ALL properties from the same branch that don't have a service_day
        const branchUnassigned = properties.filter(prop => 
          prop.branch_id === selectedCrew.branch_id && 
          !prop.service_day
        );
        setUnassignedJobs(branchUnassigned);
      }
      
      setHasChanges(false);
    }
  }, [savedSchedule, scheduleLoading, selectedCrew, properties]);
  
  // Initialize unassigned jobs when no saved schedule exists
  useEffect(() => {
    if (!scheduleLoading && !savedSchedule && selectedCrew && properties.length > 0) {
      console.log('No saved schedule found, loading all branch unassigned properties');
      // Get all properties from the same branch that don't have a service_day
      const branchUnassigned = properties.filter(prop => 
        prop.branch_id === selectedCrew.branch_id && 
        !prop.service_day
      );
      
      setUnassignedJobs(branchUnassigned);
      setWeekSchedule({
        Monday: [],
        Tuesday: [],
        Wednesday: [],
        Thursday: [],
        Friday: [],
        Saturday: [],
      });
      setHasChanges(false);
    }
  }, [savedSchedule, scheduleLoading, selectedCrew, properties]);

  // Sign out handler
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // Save schedule handler - Updated to also assign crew_id
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
    let scheduledPropertyIds = []; // Track all properties that are scheduled
    
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
          scheduledPropertyIds.push(id); // Track scheduled properties
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
    // Include the scheduled property IDs so we can update their crew_id
    const scheduleData = {
      Monday: (scheduleWithIds.Monday || []).filter(id => id !== undefined && id !== null),
      Tuesday: (scheduleWithIds.Tuesday || []).filter(id => id !== undefined && id !== null),
      Wednesday: (scheduleWithIds.Wednesday || []).filter(id => id !== undefined && id !== null),
      Thursday: (scheduleWithIds.Thursday || []).filter(id => id !== undefined && id !== null),
      Friday: (scheduleWithIds.Friday || []).filter(id => id !== undefined && id !== null),
      Saturday: (scheduleWithIds.Saturday || []).filter(id => id !== undefined && id !== null),
      unassigned: (unassignedIds || []).filter(id => id !== undefined && id !== null),
      scheduledPropertyIds: scheduledPropertyIds // Pass the IDs of properties to assign to this crew
    };
    
    console.log('Final schedule data to save:', scheduleData);
    console.log('Properties to assign to crew:', scheduledPropertyIds);
    
    // Final validation - check if any arrays contain undefined
    const finalCheck = [
      ...scheduleData.Monday,
      ...scheduleData.Tuesday,
      ...scheduleData.Wednesday,
      ...scheduleData.Thursday,
      ...scheduleData.Friday,
      ...scheduleData.Saturday,
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
        setSaveMessage({ type: 'success', text: 'Schedule saved and properties assigned to crew!' });
        setHasChanges(false);
        
        // Clear message after 3 seconds
        setTimeout(() => setSaveMessage(null), 3000);
      } else {
        console.error('Save failed:', result.error);
        setSaveMessage({ type: 'error', text: result.error || 'Failed to save schedule' });
      }
    } catch (error) {
      console.error('Save error:', error);
      setSaveMessage({ type: 'error', text: 'Failed to save schedule: ' + error.message });
    }
    
    setIsSaving(false);
  };
  
  // Clear schedule handler
  const handleClearSchedule = async () => {
    if (!selectedCrew || !window.confirm('Are you sure you want to clear the entire schedule? Properties will remain assigned to this crew but will be unscheduled.')) 
      return;
    
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
          Saturday: [],
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

  const onDrop = (e, targetDay, insertIndex = null) => {
    e.preventDefault();
    e.stopPropagation();
    console.log('Drop on:', targetDay, 'insertIndex:', insertIndex);
    setDragOverDay(null);
    
    // Use the state variable if dataTransfer doesn't work
    if (!draggedItem) {
      console.error('No dragged item found');
      return;
    }
    
    const { job, sourceDay } = draggedItem;
    
    let newSchedule = { ...weekSchedule };
    let newUnassigned = [...unassignedJobs];

    // Remove from source first
    if (sourceDay === 'unassigned') {
      newUnassigned = newUnassigned.filter(j => j.id !== job.id);
    } else if (sourceDay && newSchedule[sourceDay]) {
      newSchedule[sourceDay] = newSchedule[sourceDay].filter(j => j.id !== job.id);
    }

    // Add to target
    if (targetDay === 'unassigned') {
      newUnassigned.push(job);
    } else if (targetDay && newSchedule[targetDay]) {
      if (insertIndex !== null && insertIndex >= 0) {
        // Insert at specific position for reordering
        newSchedule[targetDay].splice(insertIndex, 0, job);
      } else {
        // Add to the end
        newSchedule[targetDay] = [...newSchedule[targetDay], job];
      }
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
    
    // Get Saturday scheduled hours and revenue specifically for OT calculation
    const saturdayScheduledHours = weekSchedule.Saturday ? 
      weekSchedule.Saturday.reduce((sum, job) => sum + (job.current_hours || 0), 0) : 0;
    const saturdayRevenue = weekSchedule.Saturday ?
      weekSchedule.Saturday.reduce((sum, job) => sum + (job.monthly_invoice || 0), 0) : 0;
    const regularScheduledHours = totalScheduledHours - saturdayScheduledHours;
    const regularRevenue = totalRevenue - saturdayRevenue;
    
    // Dynamically calculate work days - only count Saturday if it has properties
    const hasSaturdayWork = weekSchedule.Saturday && weekSchedule.Saturday.length > 0;
    const workDaysInWeek = hasSaturdayWork ? 6 : 5;
    
    const weeklyCapacity = dailyCrewHours * workDaysInWeek;
    const utilizationPercent = weeklyCapacity > 0 ? (totalScheduledHours / weeklyCapacity) * 100 : 0;
    
    // Calculate direct labor with OT for Saturday scheduled hours
    const regularLaborCost = regularScheduledHours * HOURLY_COST * WEEKS_PER_MONTH;
    const saturdayLaborCost = saturdayScheduledHours * OVERTIME_HOURLY_COST * WEEKS_PER_MONTH;
    const totalLaborCost = regularLaborCost + saturdayLaborCost;
    const directLaborPercent = totalRevenue > 0 ? (totalLaborCost / totalRevenue) * 100 : 0;
    
    // Calculate effective DL based on full crew cost with OT for Saturday
    let monthlyCrewCost, monthlyRegularCrewCost, monthlySaturdayCrewCost;
    let regularEffectiveDL = 0;
    let saturdayEffectiveDL = 0;
    
    if (hasSaturdayWork) {
      // 5 regular days + 1 OT day
      monthlyRegularCrewCost = selectedCrew ? selectedCrew.size * 8 * 5 * HOURLY_COST * WEEKS_PER_MONTH : 0;
      monthlySaturdayCrewCost = selectedCrew ? selectedCrew.size * 8 * 1 * OVERTIME_HOURLY_COST * WEEKS_PER_MONTH : 0;
      monthlyCrewCost = monthlyRegularCrewCost + monthlySaturdayCrewCost;
      
      // Calculate separate eDL percentages
      regularEffectiveDL = regularRevenue > 0 ? (monthlyRegularCrewCost / regularRevenue) * 100 : 0;
      saturdayEffectiveDL = saturdayRevenue > 0 ? (monthlySaturdayCrewCost / saturdayRevenue) * 100 : 0;
    } else {
      // Just 5 regular days
      monthlyRegularCrewCost = selectedCrew ? selectedCrew.size * 8 * 5 * HOURLY_COST * WEEKS_PER_MONTH : 0;
      monthlySaturdayCrewCost = 0;
      monthlyCrewCost = monthlyRegularCrewCost;
      regularEffectiveDL = totalRevenue > 0 ? (monthlyCrewCost / totalRevenue) * 100 : 0;
    }
    
    const effectiveDirectLaborPercent = totalRevenue > 0 ? (monthlyCrewCost / totalRevenue) * 100 : 0;

    return {
      totalScheduledHours,
      totalRevenue,
      weeklyCapacity,
      utilizationPercent,
      directLaborPercent,
      effectiveDirectLaborPercent,
      monthlyCrewCost,
      monthlyRegularCrewCost,
      monthlySaturdayCrewCost,
      regularEffectiveDL,
      saturdayEffectiveDL,
      workDaysInWeek,
      hasSaturdayWork
    };
  };

  const stats = calculateWeeklyStats();

  // Calculate Direct Labor percentage for each day
  const calculateDailyDL = (dayJobs, isOvertimeDay = false) => {
    const dayHours = dayJobs.reduce((sum, job) => sum + (job.current_hours || 0), 0);
    const dayRevenue = dayJobs.reduce((sum, job) => sum + (job.monthly_invoice || 0), 0);
    if (dayRevenue === 0) return 0;
    
    const hourlyRate = isOvertimeDay ? OVERTIME_HOURLY_COST : HOURLY_COST;
    const dailyLaborCost = dayHours * hourlyRate * WEEKS_PER_MONTH;
    return (dailyLaborCost / dayRevenue) * 100;
  };

  // Calculate Effective Direct Labor percentage for each day
  const calculateDailyEffectiveDL = (dayJobs, crewSize, isOvertimeDay = false) => {
    const dayRevenue = dayJobs.reduce((sum, job) => sum + (job.monthly_invoice || 0), 0);
    if (dayRevenue === 0) return 0;
    
    // Use full crew capacity without drive time factor - full cost of crew for the day
    const fullDayHours = crewSize * 8;
    const hourlyRate = isOvertimeDay ? OVERTIME_HOURLY_COST : HOURLY_COST;
    const dailyLaborCost = fullDayHours * hourlyRate * WEEKS_PER_MONTH;
    return (dailyLaborCost / dayRevenue) * 100;
  };

  // Get crew name for display
  const getCrewName = (crewId) => {
    const crew = crews.find(c => c.id === crewId);
    return crew ? crew.name : 'Unassigned';
  };

  // Quick Crew Edit Modal Component
  const QuickCrewEditModal = ({ crew, onSave, onCancel }) => {
    const [formData, setFormData] = useState({
      size: crew?.size || 1,
      supervisor: crew?.supervisor || ''
    });
    const [error, setError] = useState(null);
    
    const handleSubmit = async (e) => {
      e.preventDefault();
      
      if (!formData.size || formData.size < 1) {
        setError("Crew size must be at least 1");
        return;
      }
      
      setEditingSaving(true);
      setError(null);
      
      try {
        const updatedCrew = {
          ...crew,
          size: parseInt(formData.size),
          supervisor: formData.supervisor
        };
        
        const result = await updateCrew(crew.id, updatedCrew);
        
        if (result.success) {
          onSave(updatedCrew);
        } else {
          setError(result.error || 'Failed to update crew');
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setEditingSaving(false);
      }
    };
    
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
        <div className="bg-white rounded-lg p-6 max-w-md w-full">
          <h3 className="text-lg font-semibold mb-4">Quick Edit: {crew?.name}</h3>
          
          {error && (
            <div className="bg-red-50 text-red-600 p-3 rounded-lg mb-4 text-sm">
              {error}
            </div>
          )}
          
          <form onSubmit={handleSubmit}>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Crew Size
                </label>
                <input
                  type="number"
                  value={formData.size}
                  onChange={(e) => setFormData({ ...formData, size: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  min="1"
                  max="10"
                  required
                />
                <p className="text-xs text-gray-500 mt-1">
                  Current capacity: {formData.size * 8 * DRIVE_TIME_FACTOR} hours/day
                </p>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Supervisor
                </label>
                <input
                  type="text"
                  value={formData.supervisor}
                  onChange={(e) => setFormData({ ...formData, supervisor: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter supervisor name"
                />
              </div>
              
              <div className="bg-blue-50 p-3 rounded-lg text-sm">
                <p className="text-blue-900 font-medium">Impact of changes:</p>
                <p className="text-blue-700 text-xs mt-1">
                  • Weekly capacity will {formData.size > crew.size ? 'increase' : formData.size < crew.size ? 'decrease' : 'stay the same'}
                </p>
                <p className="text-blue-700 text-xs">
                  • All metrics will recalculate automatically
                </p>
              </div>
            </div>
            
            <div className="flex justify-end space-x-2 mt-6">
              <button
                type="button"
                onClick={onCancel}
                className="px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
                disabled={editingSaving}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors flex items-center"
                disabled={editingSaving}
              >
                {editingSaving ? (
                  <>
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    Saving...
                  </>
                ) : (
                  'Save Changes'
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  };
  
  // Handler for saving crew changes
  const handleCrewEditSave = (updatedCrew) => {
    // Update the selected crew with new data
    setSelectedCrew(updatedCrew);
    setShowCrewEditModal(false);
    setSaveMessage({ type: 'success', text: 'Crew updated successfully!' });
    
    // Clear message after 3 seconds
    setTimeout(() => setSaveMessage(null), 3000);
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

  // Get the branch name for display
  const selectedBranchName = selectedCrew && branches.find(b => b.id === selectedCrew.branch_id)?.name || 'Unknown Branch';

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
                {(() => {
                  // Group crews by branch
                  const crewsByBranch = crews.reduce((acc, crew) => {
                    const branchName = branches.find(b => b.id === crew.branch_id)?.name || 'Unknown Branch';
                    if (!acc[branchName]) {
                      acc[branchName] = [];
                    }
                    acc[branchName].push(crew);
                    return acc;
                  }, {});
                  
                  // Sort branch names and render optgroups
                  return Object.keys(crewsByBranch)
                    .sort()
                    .map(branchName => (
                      <optgroup key={branchName} label={branchName}>
                        {crewsByBranch[branchName]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map(crew => (
                            <option key={crew.id} value={crew.id}>
                              {crew.name} ({crew.crew_type}, {crew.size} members)
                            </option>
                          ))}
                      </optgroup>
                    ));
                })()}
              </select>
              {selectedCrew && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm text-gray-600">
                    Supervisor: <span className="font-medium">{selectedCrew.supervisor}</span>
                    {branches.find(b => b.id === selectedCrew.branch_id) && (
                      <> | Branch: <span className="font-medium">
                        {branches.find(b => b.id === selectedCrew.branch_id)?.name}
                      </span></>
                    )}
                  </span>
                  <button
                    onClick={() => setShowCrewEditModal(true)}
                    className="ml-2 p-1 text-gray-400 hover:text-blue-600 transition-colors rounded hover:bg-gray-100"
                    title="Quick edit crew size & supervisor"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                    </svg>
                  </button>
                </div>
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
        <div className="grid grid-cols-7 gap-3 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg mb-6">
          <div>
            <div className="text-xs text-gray-600 font-medium flex items-center gap-1">
              Weekly Capacity
              <span 
                className="cursor-help text-gray-400 hover:text-gray-600" 
                title={`Based on ${stats.workDaysInWeek} work days (${stats.hasSaturdayWork ? 'includes Saturday' : 'Mon-Fri only'})`}
              >ℹ</span>
            </div>
            <div className="text-lg font-bold text-gray-800">{stats.weeklyCapacity.toFixed(1)} hrs</div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium">Scheduled Hours</div>
            <div className="text-lg font-bold text-blue-600">{stats.totalScheduledHours.toFixed(1)} hrs</div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium flex items-center gap-1">
              Utilization
              <span 
                className="cursor-help text-gray-400 hover:text-gray-600" 
                title="Percentage of total weekly capacity being used. Target: 90%+"
              >ℹ</span>
            </div>
            <div className={`text-lg font-bold ${
              stats.utilizationPercent > 100 ? 'text-red-600' : 
              stats.utilizationPercent > 90 ? 'text-yellow-600' : 
              'text-green-600'
            }`}>
              {stats.utilizationPercent.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium flex items-center gap-1">
              Monthly Crew Cost
              <span 
                className="cursor-help text-gray-400 hover:text-gray-600" 
                title={`Based on ${stats.workDaysInWeek}-day work week${stats.hasSaturdayWork ? ' (Saturday at 1.5x OT rate)' : ''}`}
              >ℹ</span>
            </div>
            <div className="text-lg font-bold text-red-600">${stats.monthlyCrewCost.toLocaleString()}</div>
            {stats.hasSaturdayWork && (
              <div className="text-xs text-gray-600 mt-1">
                <div>Reg: ${stats.monthlyRegularCrewCost.toLocaleString()}</div>
                <div className="text-orange-600">OT: ${stats.monthlySaturdayCrewCost.toLocaleString()}</div>
              </div>
            )}
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium">Monthly Revenue</div>
            <div className="text-lg font-bold text-green-600">${stats.totalRevenue.toLocaleString()}</div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium flex items-center gap-1">
              js Direct Labor %
              <span 
                className="cursor-help text-gray-400 hover:text-gray-600" 
                title={`Total Labor cost based on On-Property Hours for each job on the schedule vs the Total Revenue for those jobs. Ignores Utilization %${stats.hasSaturdayWork ? '. Saturday hours calculated at 1.5x OT rate.' : ''}`}
              >ℹ</span>
            </div>
            <div className={`text-lg font-bold ${
              stats.directLaborPercent > TARGET_DIRECT_LABOR_PERCENT ? 'text-red-600' : 'text-green-600'
            }`}>
              {stats.directLaborPercent.toFixed(1)}%
            </div>
          </div>
          <div>
            <div className="text-xs text-gray-600 font-medium flex items-center gap-1">
              Effective DL %
              <span 
                className="cursor-help text-gray-400 hover:text-gray-600" 
                title={`Effective Direct Labor: Full crew cost for ${stats.workDaysInWeek} days regardless of utilization${stats.hasSaturdayWork ? ' (Saturday at 1.5x OT rate)' : ''}. Shows what you're actually paying for the full-time crew vs revenue. Target is <40%`}
              >ℹ</span>
            </div>
            <div className={`text-lg font-bold ${
              stats.effectiveDirectLaborPercent > TARGET_DIRECT_LABOR_PERCENT ? 'text-orange-600' : 'text-green-600'
            }`}>
              {stats.effectiveDirectLaborPercent.toFixed(1)}%
            </div>
            {stats.hasSaturdayWork && (
              <div className="text-xs text-gray-600 mt-1">
                <div>M-F: {stats.regularEffectiveDL.toFixed(1)}%</div>
                <div className={`${stats.saturdayEffectiveDL > TARGET_DIRECT_LABOR_PERCENT ? 'text-orange-600' : 'text-green-600'}`}>
                  Sat: {stats.saturdayEffectiveDL.toFixed(1)}%
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Main Schedule Grid */}
        <div className="grid grid-cols-7 gap-3">
          {/* Unassigned Jobs Column - Updated to show branch-wide unassigned */}
          <div>
            <h3 className="font-semibold text-gray-700 mb-2 text-sm">
              <div className="flex flex-col">
                <span>Branch Unassigned</span>
                <span className="text-xs font-normal text-gray-500">({selectedBranchName})</span>
              </div>
            </h3>
            <div className="text-xs text-gray-500 mb-2">
              Total: {unassignedJobs.length} properties
            </div>
            <div
              onDragOver={onDragOver}
              onDragEnter={(e) => onDragEnter(e, 'unassigned')}
              onDragLeave={onDragLeave}
              onDrop={(e) => onDrop(e, 'unassigned')}
              className={`border-2 rounded-lg p-2 min-h-[500px] transition-colors ${
                dragOverDay === 'unassigned' ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-yellow-50'
              }`}
            >
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {unassignedJobs
                  .sort((a, b) => a.name.localeCompare(b.name))
                  .map((job) => (
                  <div
                    key={job.id}
                    draggable={true}
                    onDragStart={(e) => onDragStart(e, job, 'unassigned')}
                    onDragEnd={onDragEnd}
                    className={`bg-white p-2 rounded shadow-sm border cursor-move transition-all hover:shadow-md hover:border-blue-300 ${
                      job.crew_id === selectedCrew?.id 
                        ? 'border-green-400 bg-green-50' 
                        : job.crew_id 
                          ? 'border-orange-300 bg-orange-50' 
                          : 'border-gray-200'
                    }`}
                    style={{ userSelect: 'none' }}
                    title={job.crew_id ? `Currently assigned to: ${getCrewName(job.crew_id)}` : 'Not assigned to any crew'}
                  >
                    <div className="flex justify-between items-start">
                      <div 
                        className="text-xs font-medium text-gray-900 truncate flex-1"
                        title={job.name}
                      >
                        {job.name}
                        {job.crew_id && job.crew_id !== selectedCrew?.id && (
                          <span className="ml-1 text-orange-600 text-xs">
                            ({getCrewName(job.crew_id)})
                          </span>
                        )}
                      </div>
                      <Link 
                        href={`/properties?edit=${job.id}&return=/schedule`}
                        className="ml-1 text-gray-400 hover:text-blue-600 transition-colors"
                        title="Edit property"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                        </svg>
                      </Link>
                    </div>
                    <div className="flex justify-between items-center mt-1">
                      <div className="flex flex-col">
                        <span className="text-xs text-blue-600" title="Man Hours: Total Hours for this job">
                          MH: {(job.current_hours || 0).toFixed(1)}
                        </span>
                        <span className="text-xs text-purple-600" title="Crew Hours: Total Hours for a crew for this job">
                          CH: {selectedCrew ? ((job.current_hours || 0) / selectedCrew.size).toFixed(1) : '0.0'}
                        </span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-xs text-green-600">
                          ${(job.monthly_invoice || 0).toLocaleString()}
                        </span>
                        <span 
                          className={`text-xs font-semibold ${
                            ((job.current_hours || 0) * HOURLY_COST * WEEKS_PER_MONTH) / (job.monthly_invoice || 1) * 100 > TARGET_DIRECT_LABOR_PERCENT 
                              ? 'text-red-600' 
                              : 'text-green-600'
                          }`}
                          title="Direct Labor Cost vs Revenue for this specific job"
                        >
                          DL: {job.monthly_invoice > 0 
                            ? (((job.current_hours || 0) * HOURLY_COST * WEEKS_PER_MONTH) / job.monthly_invoice * 100).toFixed(1) 
                            : '0.0'}%
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Days of Week Columns */}
          {days.map(day => {
            const isSaturday = day === 'Saturday';
            const dayJobs = weekSchedule[day];
            const dayHours = dayJobs.reduce((sum, job) => sum + (job.current_hours || 0), 0);
            const dayMonthlyRevenue = dayJobs.reduce((sum, job) => sum + (job.monthly_invoice || 0), 0);
            const dayWeeklyRevenue = dayMonthlyRevenue / WEEKS_PER_MONTH;
            // Explicitly calculate Saturday at OT rate
            const hourlyRate = isSaturday ? OVERTIME_HOURLY_COST : HOURLY_COST;
            const dailyCrewCost = selectedCrew ? selectedCrew.size * 8 * hourlyRate : 0;
            const utilizationPercent = dailyCrewHours > 0 ? (dayHours / dailyCrewHours) * 100 : 0;
            const dlPercent = calculateDailyDL(dayJobs, isSaturday);
            const eDLPercent = calculateDailyEffectiveDL(dayJobs, selectedCrew?.size || 0, isSaturday);

            return (
              <div key={day}>
                <div className="mb-2">
                  <div className="flex justify-between items-center">
                    <h3 className="font-semibold text-gray-700 text-sm">
                      {day}
                      {isSaturday && (
                        <span className="ml-1 text-xs font-normal text-orange-600">(OT)</span>
                      )}
                    </h3>
                    <span className="text-xs text-gray-500">{dayHours.toFixed(1)}/{dailyCrewHours.toFixed(1)} hrs</span>
                  </div>
                  {isSaturday && (
                    <div className="bg-orange-50 border border-orange-200 rounded px-1 py-0.5 mb-1">
                      <div className="text-xs text-orange-700 font-medium">⚠️ Overtime Rates (1.5x)</div>
                    </div>
                  )}
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600" title={`Job Scheduled Direct Labor: Labor cost based on actual scheduled hours${isSaturday ? ' at OT rate' : ''}`}>jsDL:</span>
                    <span 
                      className={dlPercent > TARGET_DIRECT_LABOR_PERCENT ? 'text-red-600 font-medium' : 'text-green-600 font-medium'}
                      title={`Scheduled hours (${dayHours.toFixed(1)}) × ${isSaturday ? OVERTIME_HOURLY_COST : HOURLY_COST}/hr × ${WEEKS_PER_MONTH} weeks ÷ ${(dayMonthlyRevenue).toFixed(0)} revenue = ${dlPercent.toFixed(1)}%`}
                    >
                      {dlPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600" title={`Effective Direct Labor: Labor cost based on full crew capacity${isSaturday ? ' at OT rate' : ''} (what you actually pay)`}>eDL:</span>
                    <span 
                      className={`font-medium ${
                        eDLPercent > TARGET_DIRECT_LABOR_PERCENT ? 'text-orange-600' : 'text-green-600'
                      }`}
                      title={`Full crew (${selectedCrew?.size || 0} × 8hrs) × ${isSaturday ? OVERTIME_HOURLY_COST : HOURLY_COST}/hr × ${WEEKS_PER_MONTH} weeks ÷ ${(dayMonthlyRevenue).toFixed(0)} revenue = ${eDLPercent.toFixed(1)}%`}
                    >
                      {eDLPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-gray-600" title="Percentage of available crew hours that are scheduled">Utilization:</span>
                    <span 
                      className={`font-medium ${
                        utilizationPercent > 100 ? 'text-red-600' : 
                        utilizationPercent > 90 ? 'text-yellow-600' : 
                        'text-green-600'
                      }`}
                      title={`${dayHours.toFixed(1)} scheduled hours ÷ ${dailyCrewHours.toFixed(1)} available hours = ${utilizationPercent.toFixed(1)}%`}
                    >
                      {utilizationPercent.toFixed(1)}%
                    </span>
                  </div>
                  <div className="border-t mt-1 pt-1">
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">
                        Crew Cost{isSaturday ? ' (OT)' : ''}:
                      </span>
                      <span className={`font-medium ${isSaturday ? 'text-orange-600' : 'text-red-600'}`}>
                        ${dailyCrewCost.toFixed(0)}/day
                      </span>
                    </div>
                    {isSaturday && (
                      <div className="flex justify-between text-xs text-orange-500">
                        <span>Rate:</span>
                        <span>${OVERTIME_HOURLY_COST.toFixed(2)}/hr</span>
                      </div>
                    )}
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Revenue:</span>
                      <span className="font-medium text-green-600">
                        ${dayWeeklyRevenue.toFixed(0)}/wk
                      </span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Jobs:</span>
                      <span className="font-medium">{dayJobs.length}</span>
                    </div>
                    <div className="flex justify-between text-xs">
                      <span className="text-gray-600">Crew Hrs:</span>
                      <span className="font-medium text-purple-600">
                        {selectedCrew ? (dayHours / selectedCrew.size).toFixed(1) : '0.0'}
                      </span>
                    </div>
                    {isSaturday && (
                      <>
                        <div className="flex justify-between text-xs text-orange-500">
                          <span>Rate:</span>
                          <span>${OVERTIME_HOURLY_COST.toFixed(2)}/hr</span>
                        </div>
                        <div className="flex justify-between text-xs mt-1 pt-1 border-t border-orange-200">
                          <span className="text-orange-600">OT Premium:</span>
                          <span className="font-medium text-orange-600">
                            +${((dailyCrewCost - (selectedCrew?.size || 0) * 8 * HOURLY_COST)).toFixed(0)}
                          </span>
                        </div>
                        <div className="flex justify-between text-xs text-orange-500">
                          <span>Breakdown:</span>
                          <span>{selectedCrew?.size || 0} × 8hrs × $37.13</span>
                        </div>
                      </>
                    )}
                  </div>
                </div>
                <div
                  onDragOver={onDragOver}
                  onDragEnter={(e) => onDragEnter(e, day)}
                  onDragLeave={onDragLeave}
                  onDrop={(e) => onDrop(e, day)}
                  className={`border-2 rounded-lg p-2 min-h-[500px] transition-colors ${
                    dragOverDay === day ? 'border-blue-400 bg-blue-50' : 
                    isSaturday ? 'border-orange-300 bg-orange-50' :
                    utilizationPercent > 100 ? 'border-red-300 bg-red-50' :
                    utilizationPercent > 90 ? 'border-yellow-300 bg-yellow-50' :
                    'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="space-y-2">
                    {dayJobs.map((job, index) => (
                      <div key={job.id}>
                        {/* Drop zone before each item */}
                        <div
                          className="h-1 transition-all"
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            e.currentTarget.style.height = '30px';
                            e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.3)';
                            e.currentTarget.style.borderRadius = '4px';
                          }}
                          onDragLeave={(e) => {
                            e.currentTarget.style.height = '4px';
                            e.currentTarget.style.backgroundColor = 'transparent';
                          }}
                          onDrop={(e) => {
                            e.currentTarget.style.height = '4px';
                            e.currentTarget.style.backgroundColor = 'transparent';
                            onDrop(e, day, index);
                          }}
                        />
                        <div
                          draggable={true}
                          onDragStart={(e) => onDragStart(e, job, day)}
                          onDragEnd={onDragEnd}
                          className="bg-white p-2 rounded shadow-sm border border-gray-200 cursor-move transition-all hover:shadow-md hover:border-blue-300"
                          style={{ userSelect: 'none' }}
                        >
                          <div className="flex justify-between items-start">
                            <div 
                              className="text-xs font-medium text-gray-900 truncate flex-1"
                              title={job.name}
                            >
                              {job.name}
                            </div>
                            <Link 
                              href={`/properties?edit=${job.id}&return=/schedule`}
                              className="ml-1 text-gray-400 hover:text-blue-600 transition-colors"
                              title="Edit property"
                              onClick={(e) => e.stopPropagation()}
                              onMouseDown={(e) => e.stopPropagation()}
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                                <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
                              </svg>
                            </Link>
                          </div>
                          <div className="flex justify-between items-center mt-1">
                            <div className="flex flex-col">
                              <span className="text-xs text-blue-600" title="Man Hours: Total Hours for this job">
                                MH: {(job.current_hours || 0).toFixed(1)}
                              </span>
                              <span className="text-xs text-purple-600" title="Crew Hours: Total Hours for a crew for this job">
                                CH: {selectedCrew ? ((job.current_hours || 0) / selectedCrew.size).toFixed(1) : '0.0'}
                              </span>
                            </div>
                            <div className="flex flex-col items-end">
                              <span className="text-xs text-green-600">
                                ${(job.monthly_invoice || 0).toLocaleString()}
                              </span>
                              <span 
                                className={`text-xs font-semibold ${
                                  ((job.current_hours || 0) * HOURLY_COST * WEEKS_PER_MONTH) / (job.monthly_invoice || 1) * 100 > TARGET_DIRECT_LABOR_PERCENT 
                                    ? 'text-red-600' 
                                    : 'text-green-600'
                                }`}
                                title="Direct Labor Cost vs Revenue for this specific job"
                              >
                                DL: {job.monthly_invoice > 0 
                                  ? (((job.current_hours || 0) * HOURLY_COST * WEEKS_PER_MONTH) / job.monthly_invoice * 100).toFixed(1) 
                                  : '0.0'}%
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))}
                    {/* Drop zone at the end */}
                    {dayJobs.length > 0 && (
                      <div
                        className="h-1 transition-all"
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          e.currentTarget.style.height = '30px';
                          e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.3)';
                          e.currentTarget.style.borderRadius = '4px';
                        }}
                        onDragLeave={(e) => {
                          e.currentTarget.style.height = '4px';
                          e.currentTarget.style.backgroundColor = 'transparent';
                        }}
                        onDrop={(e) => {
                          e.currentTarget.style.height = '4px';
                          e.currentTarget.style.backgroundColor = 'transparent';
                          onDrop(e, day, dayJobs.length);
                        }}
                      />
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Updated Legend */}
        <div className="mt-6 p-4 bg-blue-50 rounded-lg">
          <h4 className="font-medium text-gray-700 mb-2 text-sm">How to Use:</h4>
          <ul className="text-xs text-gray-600 space-y-1">
            <li>• The "Branch Unassigned" column shows ALL unscheduled properties from the {selectedBranchName} branch</li>
            <li>• Properties with green backgrounds are already assigned to {selectedCrew?.name || 'this crew'}</li>
            <li>• Properties with orange backgrounds belong to other crews - dragging them will reassign them to {selectedCrew?.name || 'this crew'}</li>
            <li>• When you save, scheduled properties are automatically assigned to {selectedCrew?.name || 'the selected crew'}</li>
            <li>• Drag properties between days to reorganize your schedule</li>
            <li>• Hover over property names to see the full name</li>
            <li>• Click "Save Schedule" to save changes and crew assignments to the database</li>
            <li>• Color coding: Green = Good, Yellow = High utilization, Red = Over capacity</li>
          </ul>
        </div>
      </div>
      
      {/* Quick Crew Edit Modal */}
      {showCrewEditModal && selectedCrew && (
        <QuickCrewEditModal
          crew={selectedCrew}
          onSave={handleCrewEditSave}
          onCancel={() => setShowCrewEditModal(false)}
        />
      )}
    </div>
  );
}