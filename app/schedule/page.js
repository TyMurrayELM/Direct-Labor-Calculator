"use client";

import React, { useState, useEffect } from 'react';
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
      // Set initial selected crew
      if (!selectedCrew && crews.length > 0) {
        setSelectedCrew(crews[0]);
      }
      
      // Initialize unassigned jobs with actual properties
      const formattedProperties = properties.map(prop => ({
        id: prop.id,
        name: prop.name,
        address: prop.address || 'No address provided',
        current_hours: prop.current_hours || 0,
        monthly_invoice: prop.monthly_invoice || 0,
        crew_id: prop.crew_id,
        branch_id: prop.branch_id
      }));
      
      // Only show properties assigned to the selected crew or unassigned
      const crewProperties = selectedCrew 
        ? formattedProperties.filter(p => p.crew_id === selectedCrew.id || !p.crew_id)
        : formattedProperties;
      
      setUnassignedJobs(crewProperties);
    }
  }, [properties, crews, propertiesLoading, crewsLoading, selectedCrew]);

  // Sign out handler
  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
  };

  // Calculate daily crew hours
  const dailyCrewHours = selectedCrew ? selectedCrew.size * 8 * DRIVE_TIME_FACTOR : 0;

  // Drag and Drop handlers
  const handleDragStart = (e, job, sourceDay) => {
    setDraggedItem({ job, sourceDay });
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDragEnter = (e, day) => {
    e.preventDefault();
    setDragOverDay(day);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    if (e.currentTarget === e.target) {
      setDragOverDay(null);
    }
  };

  const handleDrop = (e, targetDay) => {
    e.preventDefault();
    setDragOverDay(null);

    if (!draggedItem) return;

    const { job, sourceDay } = draggedItem;
    let newSchedule = { ...weekSchedule };
    let newUnassigned = [...unassignedJobs];

    // Remove from source
    if (sourceDay === 'unassigned') {
      newUnassigned = newUnassigned.filter(j => j.id !== job.id);
    } else if (sourceDay) {
      newSchedule[sourceDay] = newSchedule[sourceDay].filter(j => j.id !== job.id);
    }

    // Add to target
    if (targetDay === 'unassigned') {
      newUnassigned = [...newUnassigned, job];
    } else if (targetDay) {
      newSchedule[targetDay] = [...newSchedule[targetDay], job];
    }

    setWeekSchedule(newSchedule);
    setUnassignedJobs(newUnassigned);
    setDraggedItem(null);
  };

  // Calculate statistics
  const calculateWeeklyStats = () => {
    const totalScheduledHours = Object.values(weekSchedule).flat().reduce((sum, job) => sum + job.current_hours, 0);
    const totalRevenue = Object.values(weekSchedule).flat().reduce((sum, job) => sum + job.monthly_invoice, 0);
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
    const dayHours = dayJobs.reduce((sum, job) => sum + job.current_hours, 0);
    const dayRevenue = dayJobs.reduce((sum, job) => sum + job.monthly_invoice, 0);
    if (dayRevenue === 0) return 0;
    
    const dailyLaborCost = dayHours * HOURLY_COST * WEEKS_PER_MONTH;
    return (dailyLaborCost / dayRevenue) * 100;
  };

  // Job Card Component
  const JobCard = ({ job, sourceDay }) => (
    <div
      draggable
      onDragStart={(e) => handleDragStart(e, job, sourceDay)}
      className="bg-white p-2 rounded shadow-sm border border-gray-200 cursor-move transition-all hover:shadow-md hover:border-blue-300"
    >
      <div className="text-xs font-medium text-gray-900 truncate">{job.name}</div>
      <div className="text-xs text-gray-500 truncate">{job.address}</div>
      <div className="flex justify-between items-center mt-1">
        <span className="text-xs font-semibold text-blue-600">{job.current_hours.toFixed(1)} hrs</span>
        <span className="text-xs text-green-600">${job.monthly_invoice.toLocaleString()}</span>
      </div>
    </div>
  );

  // Loading state
  if (propertiesLoading || crewsLoading || branchesLoading) {
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
          <div className="flex items-center space-x-4">
            <label className="text-sm font-medium text-gray-700">Select Crew:</label>
            <select
              value={selectedCrew?.id || ''}
              onChange={(e) => {
                const crew = crews.find(c => c.id === parseInt(e.target.value));
                setSelectedCrew(crew);
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
              onDragOver={handleDragOver}
              onDragEnter={(e) => handleDragEnter(e, 'unassigned')}
              onDragLeave={handleDragLeave}
              onDrop={(e) => handleDrop(e, 'unassigned')}
              className={`border-2 rounded-lg p-2 min-h-[500px] transition-colors ${
                dragOverDay === 'unassigned' ? 'border-blue-400 bg-blue-50' : 'border-gray-300 bg-yellow-50'
              }`}
            >
              <div className="space-y-2 max-h-[600px] overflow-y-auto">
                {unassignedJobs.map((job) => (
                  <JobCard key={job.id} job={job} sourceDay="unassigned" />
                ))}
              </div>
            </div>
          </div>

          {/* Days of Week Columns */}
          {days.map(day => {
            const dayJobs = weekSchedule[day];
            const dayHours = dayJobs.reduce((sum, job) => sum + job.current_hours, 0);
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
                  onDragOver={handleDragOver}
                  onDragEnter={(e) => handleDragEnter(e, day)}
                  onDragLeave={handleDragLeave}
                  onDrop={(e) => handleDrop(e, day)}
                  className={`border-2 rounded-lg p-2 min-h-[500px] transition-colors ${
                    dragOverDay === day ? 'border-blue-400 bg-blue-50' : 
                    utilizationPercent > 100 ? 'border-red-300 bg-red-50' :
                    utilizationPercent > 90 ? 'border-yellow-300 bg-yellow-50' :
                    'border-gray-200 bg-gray-50'
                  }`}
                >
                  <div className="space-y-2 max-h-[450px] overflow-y-auto">
                    {dayJobs.map((job) => (
                      <JobCard key={job.id} job={job} sourceDay={day} />
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
            <li>• The schedule shows properties assigned to {selectedCrew?.name || 'the selected crew'}</li>
            <li>• Color coding: <span className="text-green-600 font-medium">Green = Good</span>, <span className="text-yellow-600 font-medium">Yellow = High utilization</span>, <span className="text-red-600 font-medium">Red = Over capacity</span></li>
            <li>• Direct Labor % target is {TARGET_DIRECT_LABOR_PERCENT}% - stay below for optimal profitability</li>
          </ul>
        </div>
      </div>
    </div>
  );
}