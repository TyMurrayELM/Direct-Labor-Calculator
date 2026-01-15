"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';
import { useBranches } from '../hooks/useSupabase';

// Get branch icon path based on branch name
const getIconPath = (branchName) => {
  if (!branchName) return null;
  const name = branchName.toLowerCase();
  if (name.includes('vegas') || name.includes('lv')) return '/lv.png';
  if (name.includes('north')) return '/n.png';
  if (name.includes('southeast') || name.includes('se')) return '/se.png';
  if (name.includes('southwest') || name.includes('sw')) return '/sw.png';
  return null;
};

// Branch Dropdown Component
const BranchDropdown = ({ branches, selectedBranchId, onChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = React.useRef(null);
  
  const selectedBranch = branches.find(branch => branch.id === selectedBranchId) || {};

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className="border rounded-lg pl-3 pr-10 py-2 focus:outline-none focus:ring-2 focus:ring-teal-500 text-sm font-medium bg-white shadow-sm flex items-center"
        style={{ minWidth: '180px' }}
      >
        {selectedBranchId ? (
          <div className="flex items-center">
            {getIconPath(selectedBranch.name) && (
              <img src={getIconPath(selectedBranch.name)} alt="" width={20} height={20} className="mr-2" 
                   onError={(e) => { e.target.style.display = 'none'; }} />
            )}
            <span>{selectedBranch.name}</span>
          </div>
        ) : (
          <span className="text-gray-500">Select Branch</span>
        )}
        <div className="absolute inset-y-0 right-0 flex items-center pr-2 pointer-events-none">
          <svg className="h-5 w-5 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </div>
      </button>
      
      {isOpen && (
        <div className="absolute z-10 mt-1 w-full rounded-md bg-white shadow-lg">
          <div className="py-1 max-h-60 overflow-y-auto">
            {branches.map((branch) => (
              <button
                key={branch.id}
                type="button"
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-100 flex items-center"
                onClick={() => { onChange(branch.id); setIsOpen(false); }}
              >
                {getIconPath(branch.name) && (
                  <img src={getIconPath(branch.name)} alt="" width={20} height={20} className="mr-2"
                       onError={(e) => { e.target.style.display = 'none'; }} />
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

export default function QSRoutesPage() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState(null);
  
  const { branches, loading: branchesLoading } = useBranches();
  
  const [routes, setRoutes] = useState([]);
  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedRouteId, setSelectedRouteId] = useState('all');
  const [uploadBranchId, setUploadBranchId] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState({ text: '', type: '' });
  const [isUploading, setIsUploading] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingFile, setPendingFile] = useState(null);
  const [parsedRoutes, setParsedRoutes] = useState([]);
  const [selectedDay, setSelectedDay] = useState('all');
  
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

  useEffect(() => {
    const getSession = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      setSession(session);
      if (!session) {
        router.push('/login');
      } else {
        const { data } = await supabase
          .from('allowlist')
          .select('role')
          .eq('email', session.user.email)
          .single();
        if (data) setUserRole(data.role);
      }
    };
    getSession();
  }, [supabase, router]);

  useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches, selectedBranchId]);

  useEffect(() => {
    const fetchRoutes = async () => {
      if (!selectedBranchId) return;
      
      setIsLoading(true);
      try {
        const { data: routesData, error: routesError } = await supabase
          .from('qs_routes')
          .select('*')
          .eq('branch_id', selectedBranchId)
          .order('route_number');

        if (routesError) throw routesError;

        if (routesData && routesData.length > 0) {
          const routeIds = routesData.map(r => r.id);
          const { data: stopsData, error: stopsError } = await supabase
            .from('qs_route_stops')
            .select('*')
            .in('route_id', routeIds)
            .order('stop_order');

          if (stopsError) throw stopsError;

          const routesWithStops = routesData.map(route => ({
            id: route.id,
            routeNumber: route.route_number,
            duration: route.duration,
            distance: route.distance,
            uploadedAt: route.uploaded_at,
            dayOfWeek: route.day_of_week || null,
            branchAddress: route.branch_address || null,
            stops: (stopsData || [])
              .filter(stop => stop.route_id === route.id)
              .map(stop => ({
                id: stop.id,
                name: stop.property_name,
                address: stop.address,
                serviceTime: stop.service_time,
                notes: stop.notes
              }))
          }));

          setRoutes(routesWithStops);
        } else {
          setRoutes([]);
        }
      } catch (err) {
        console.error('Error fetching routes:', err);
        setError('Failed to load routes');
      } finally {
        setIsLoading(false);
      }
    };

    fetchRoutes();
  }, [selectedBranchId, supabase]);

  const parseCSV = (text) => {
    const lines = text.trim().split('\n');
    if (lines.length < 2) {
      setError('CSV file appears to be empty');
      return [];
    }

    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    const routeIdx = headers.findIndex(h => h.toLowerCase() === 'route_number');
    const aliasIdx = headers.findIndex(h => h.toLowerCase() === 'alias');
    const addressIdx = headers.findIndex(h => h.toLowerCase() === 'address');
    const serviceTimeIdx = headers.findIndex(h => h.toLowerCase() === 'service_time');
    const durationIdx = headers.findIndex(h => h.toLowerCase() === 'planned_total_route_duration');
    const distanceIdx = headers.findIndex(h => h.toLowerCase() === 'route_total_distance');
    const notesIdx = headers.findIndex(h => h.toLowerCase() === 'notes');

    if (routeIdx === -1) {
      setError('CSV must have a Route_Number column');
      return [];
    }

    const routeMap = {};
    
    for (let i = 1; i < lines.length; i++) {
      const row = parseCSVRow(lines[i]);
      if (row.length === 0) continue;

      const routeNum = parseInt(row[routeIdx]?.trim()) || 0;
      const alias = row[aliasIdx]?.trim() || '';
      const address = row[addressIdx]?.trim() || '';
      const serviceTime = row[serviceTimeIdx]?.trim() || '00:00:00';
      const duration = row[durationIdx]?.trim() || '';
      const distance = parseFloat(row[distanceIdx]?.trim()) || 0;
      const notes = row[notesIdx]?.trim() || '';

      if (!routeNum) continue;

      // Check if this is a branch location row (no alias and zero service time)
      const isBranchLocation = !alias && serviceTime === '00:00:00';

      if (!routeMap[routeNum]) {
        routeMap[routeNum] = { routeNumber: routeNum, duration, distance, branchAddress: null, stops: [] };
      }

      // Capture branch address from start/end rows
      if (isBranchLocation && address) {
        routeMap[routeNum].branchAddress = address;
        continue; // Don't add to stops
      }

      routeMap[routeNum].stops.push({ name: alias, address, serviceTime, notes });
    }

    return Object.values(routeMap).sort((a, b) => a.routeNumber - b.routeNumber);
  };

  const parseCSVRow = (row) => {
    const result = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < row.length; i++) {
      const char = row[i];
      if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else current += char;
    }
    result.push(current.trim());
    return result;
  };

  const handleFileSelect = (file) => {
    if (!file) return;
    if (!file.name.endsWith('.csv')) { setError('Please upload a CSV file'); return; }

    setError('');
    setPendingFile(file);

    const reader = new FileReader();
    reader.onload = (e) => {
      const parsed = parseCSV(e.target.result);
      setParsedRoutes(parsed);
    };
    reader.onerror = () => setError('Error reading file');
    reader.readAsText(file);
  };

  const handleUpload = async () => {
    if (!uploadBranchId) { setError('Please select a branch for this upload'); return; }
    if (parsedRoutes.length === 0) { setError('No valid routes to upload'); return; }

    setIsUploading(true);
    setError('');

    try {
      // First, delete ALL existing routes for this branch
      const { data: existingRoutes, error: fetchError } = await supabase
        .from('qs_routes')
        .select('id')
        .eq('branch_id', uploadBranchId);

      if (fetchError) {
        console.error('Error fetching existing routes:', fetchError);
        throw fetchError;
      }

      if (existingRoutes && existingRoutes.length > 0) {
        const existingIds = existingRoutes.map(r => r.id);
        
        // Delete stops first (foreign key constraint)
        const { error: stopsDeleteError } = await supabase
          .from('qs_route_stops')
          .delete()
          .in('route_id', existingIds);
        
        if (stopsDeleteError) {
          console.error('Error deleting stops:', stopsDeleteError);
          throw stopsDeleteError;
        }

        // Delete routes
        const { error: routesDeleteError } = await supabase
          .from('qs_routes')
          .delete()
          .eq('branch_id', uploadBranchId);
        
        if (routesDeleteError) {
          console.error('Error deleting routes:', routesDeleteError);
          throw routesDeleteError;
        }
      }

      // Now insert new routes
      for (const route of parsedRoutes) {
        const { data: routeData, error: routeError } = await supabase
          .from('qs_routes')
          .insert({
            branch_id: uploadBranchId,
            route_number: route.routeNumber,
            duration: route.duration,
            distance: route.distance,
            branch_address: route.branchAddress,
            uploaded_at: new Date().toISOString()
          })
          .select()
          .single();

        if (routeError) throw routeError;

        if (route.stops.length > 0) {
          const stopsToInsert = route.stops.map((stop, index) => ({
            route_id: routeData.id,
            stop_order: index + 1,
            property_name: stop.name,
            address: stop.address,
            service_time: stop.serviceTime,
            notes: stop.notes
          }));

          const { error: stopsError } = await supabase.from('qs_route_stops').insert(stopsToInsert);
          if (stopsError) throw stopsError;
        }
      }

      // Force refresh by temporarily clearing routes, then setting branch
      setRoutes([]);
      
      // If uploading to currently selected branch, force re-fetch
      if (uploadBranchId === selectedBranchId) {
        setSelectedBranchId(null);
        setTimeout(() => setSelectedBranchId(uploadBranchId), 100);
      } else {
        setSelectedBranchId(uploadBranchId);
      }
      
      setPendingFile(null);
      setParsedRoutes([]);
      setUploadBranchId(null);
      
      setMessage({ text: `Successfully uploaded ${parsedRoutes.length} routes`, type: 'success' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);

    } catch (err) {
      console.error('Upload error:', err);
      setError('Failed to upload routes: ' + err.message);
    } finally {
      setIsUploading(false);
    }
  };

  const handleCancelUpload = () => {
    setPendingFile(null);
    setParsedRoutes([]);
    setUploadBranchId(null);
    setError('');
  };

  const handleDragOver = useCallback((e) => { e.preventDefault(); setIsDragging(true); }, []);
  const handleDragLeave = useCallback((e) => { e.preventDefault(); setIsDragging(false); }, []);
  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsDragging(false);
    handleFileSelect(e.dataTransfer.files[0]);
  }, []);

  const parseServiceTimeToMinutes = (timeStr) => {
    if (!timeStr) return 0;
    const parts = timeStr.split(':');
    return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  };

  const parseDurationToMinutes = (durationStr) => {
    if (!durationStr) return 0;
    const parts = durationStr.split(':');
    return (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0);
  };

  const formatDuration = (durationStr) => {
    if (!durationStr) return '—';
    const parts = durationStr.split(':');
    return `${parseInt(parts[0]) || 0}h ${parseInt(parts[1]) || 0}m`;
  };

  const formatMinutesToDuration = (minutes) => {
    const hours = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return `${hours}h ${mins}m`;
  };

  // Export routes to CSV
  const handleExportCSV = () => {
    if (filteredRoutes.length === 0) return;

    // Build CSV content
    const headers = ['Route', 'Day', 'Stop #', 'Property', 'Address', 'Service Time (min)', 'Route Time', 'Miles', 'Notes'];
    const rows = [];

    filteredRoutes.forEach(route => {
      route.stops.forEach((stop, index) => {
        rows.push([
          index === 0 ? `Route ${route.routeNumber}` : '',
          index === 0 ? (route.dayOfWeek || 'Unassigned') : '',
          index + 1,
          `"${(stop.name || '').replace(/"/g, '""')}"`,
          `"${(stop.address || '').replace(/"/g, '""')}"`,
          parseServiceTimeToMinutes(stop.serviceTime),
          index === 0 ? formatDuration(route.duration) : '',
          index === 0 ? route.distance?.toFixed(1) : '',
          `"${(stop.notes || '').replace(/"/g, '""')}"`
        ]);
      });
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `routes-${selectedBranchName.replace(/\s+/g, '-').toLowerCase()}-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Open route in Google Maps
  const handleOpenInMaps = (route) => {
    if (!route.stops || route.stops.length === 0) return;

    // Get addresses, filter out empty ones
    const addresses = route.stops
      .map(stop => stop.address)
      .filter(addr => addr && addr.trim());

    if (addresses.length === 0) return;

    // Google Maps supports up to ~25 waypoints
    // Start from branch, go through all stops, return to branch
    const encodedAddresses = addresses
      .slice(0, 23) // Limit to 23 stops (leaving room for branch start & end)
      .map(addr => encodeURIComponent(addr))
      .join('/');

    // Use branch address if available, otherwise current location
    const startEnd = route.branchAddress 
      ? encodeURIComponent(route.branchAddress)
      : 'Current+Location';

    const mapsUrl = `https://www.google.com/maps/dir/${startEnd}/${encodedAddresses}/${startEnd}`;
    window.open(mapsUrl, '_blank');
  };

  // Update route day assignment
  const handleDayChange = async (routeId, day) => {
    const dayValue = day === '' ? null : day;
    
    try {
      const { error } = await supabase
        .from('qs_routes')
        .update({ day_of_week: dayValue })
        .eq('id', routeId);

      if (error) throw error;

      // Update local state
      setRoutes(prev => prev.map(route => 
        route.id === routeId ? { ...route, dayOfWeek: dayValue } : route
      ));
    } catch (err) {
      console.error('Error updating day:', err);
      setMessage({ text: 'Failed to update day assignment', type: 'error' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    }
  };

  const handleDeleteRoutes = async () => {
    if (!selectedBranchId || !confirm('Are you sure you want to delete all routes for this branch?')) return;

    try {
      const { data: existingRoutes } = await supabase
        .from('qs_routes')
        .select('id')
        .eq('branch_id', selectedBranchId);

      if (existingRoutes && existingRoutes.length > 0) {
        const existingIds = existingRoutes.map(r => r.id);
        await supabase.from('qs_route_stops').delete().in('route_id', existingIds);
        await supabase.from('qs_routes').delete().eq('branch_id', selectedBranchId);
      }

      setRoutes([]);
      setMessage({ text: 'Routes deleted successfully', type: 'success' });
      setTimeout(() => setMessage({ text: '', type: '' }), 3000);
    } catch (err) {
      console.error('Delete error:', err);
      setError('Failed to delete routes');
    }
  };

  // Filter routes based on selection
  const filteredRoutes = routes.filter(r => {
    const matchesRoute = selectedRouteId === 'all' || r.id === selectedRouteId;
    const matchesDay = selectedDay === 'all' || 
      (selectedDay === '' && !r.dayOfWeek) || 
      r.dayOfWeek === selectedDay;
    return matchesRoute && matchesDay;
  });

  // Calculate summary stats
  const calculateStats = () => {
    if (routes.length === 0) return null;

    const totalRoutes = routes.length;
    // Exclude "Branch Location" stops from count
    const totalStops = routes.reduce((sum, r) => sum + r.stops.filter(s => s.name !== 'Branch Location').length, 0);
    const totalDistance = routes.reduce((sum, r) => sum + (r.distance || 0), 0);
    const totalDurationMinutes = routes.reduce((sum, r) => sum + parseDurationToMinutes(r.duration), 0);
    const totalServiceMinutes = routes.reduce((sum, r) => 
      sum + r.stops.filter(s => s.name !== 'Branch Location').reduce((s, stop) => s + parseServiceTimeToMinutes(stop.serviceTime), 0), 0);

    return {
      totalRoutes,
      totalStops,
      totalDistance: totalDistance.toFixed(1),
      avgDistance: (totalDistance / totalRoutes).toFixed(1),
      totalDuration: formatMinutesToDuration(totalDurationMinutes),
      avgDuration: formatMinutesToDuration(totalDurationMinutes / totalRoutes),
      totalServiceTime: formatMinutesToDuration(totalServiceMinutes),
      avgStopsPerRoute: (totalStops / totalRoutes).toFixed(1)
    };
  };

  const stats = calculateStats();
  const selectedBranch = branches.find(b => b.id === selectedBranchId);
  const selectedBranchName = selectedBranch?.name || '';

  if (branchesLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-100">
        <div className="p-8 bg-white shadow-lg rounded-lg">
          <div className="flex items-center space-x-4">
            <div className="w-8 h-8 border-t-4 border-b-4 border-teal-500 rounded-full animate-spin"></div>
            <p className="text-lg font-semibold text-gray-700">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-100">

      {/* Header */}
      <div className="no-print bg-white shadow-sm border-b">
        <div className="max-w-7xl mx-auto px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-4">
              <Link href="/" className="text-gray-500 hover:text-gray-700">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
                </svg>
              </Link>
              <h1 className="text-xl font-bold text-gray-800">QS Route Viewer</h1>
            </div>
            
            <div className="flex items-center space-x-3">
              <div className="flex items-center space-x-2">
                <span className="text-sm font-medium text-gray-600">Branch:</span>
                <BranchDropdown
                  branches={branches}
                  selectedBranchId={selectedBranchId}
                  onChange={(id) => { setSelectedBranchId(id); setSelectedRouteId('all'); }}
                />
              </div>

              {routes.length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600">Route:</span>
                  <select
                    value={selectedRouteId}
                    onChange={(e) => setSelectedRouteId(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm font-medium bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="all">All Routes</option>
                    {routes.map(route => (
                      <option key={route.id} value={route.id}>Route {route.routeNumber}</option>
                    ))}
                  </select>
                </div>
              )}

              {routes.length > 0 && (
                <div className="flex items-center space-x-2">
                  <span className="text-sm font-medium text-gray-600">Day:</span>
                  <select
                    value={selectedDay}
                    onChange={(e) => setSelectedDay(e.target.value)}
                    className="border rounded-lg px-3 py-2 text-sm font-medium bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  >
                    <option value="all">All Days</option>
                    <option value="">Unassigned</option>
                    {days.map(day => (
                      <option key={day} value={day}>{day}</option>
                    ))}
                  </select>
                </div>
              )}

              {routes.length > 0 && (
                <button onClick={handleExportCSV} className="px-3 py-1.5 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clipRule="evenodd" />
                  </svg>
                  <span>Export CSV</span>
                </button>
              )}

              {userRole === 'admin' && routes.length > 0 && (
                <button onClick={handleDeleteRoutes} className="px-3 py-1.5 bg-white text-red-600 border border-red-300 rounded-lg hover:bg-red-50 transition-colors shadow-sm text-sm font-medium">
                  Delete
                </button>
              )}

              <Link href="/schedule" className="px-3 py-1.5 bg-white text-purple-700 border border-purple-600 rounded-lg hover:bg-purple-50 transition-colors shadow-sm text-sm font-medium">
                Crew Schedule
              </Link>
              <Link href="/" className="px-3 py-1.5 bg-white text-blue-700 border border-blue-600 rounded-lg hover:bg-blue-50 transition-colors shadow-sm text-sm font-medium">
                Dashboard
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Messages */}
      {message.text && (
        <div className="max-w-7xl mx-auto px-4 mt-4">
          <div className={`p-3 rounded-lg ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-200' : 'bg-red-50 text-red-700 border border-red-200'}`}>
            {message.text}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* Upload Area - Admin Only */}
        {userRole === 'admin' && (
          <div className="no-print mb-6">
            {!pendingFile ? (
              <div
                className={`border-2 border-dashed rounded-xl p-6 text-center transition-colors ${isDragging ? 'border-teal-500 bg-teal-50' : 'border-gray-300 bg-white hover:border-gray-400'}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                <div className="flex items-center justify-center space-x-4">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 13h6m-3-3v6m5 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <div className="text-left">
                    <h3 className="text-base font-semibold text-gray-700">Upload Optimized Route CSV</h3>
                    <p className="text-gray-500 text-sm">Drag and drop or click to browse</p>
                  </div>
                  <input type="file" accept=".csv" onChange={(e) => handleFileSelect(e.target.files[0])} className="hidden" id="csv-upload" />
                  <label htmlFor="csv-upload" className="inline-flex items-center px-4 py-2 bg-teal-600 text-white rounded-lg hover:bg-teal-700 cursor-pointer transition-colors text-sm">
                    Choose File
                  </label>
                </div>
              </div>
            ) : (
              <div className="bg-white border rounded-xl p-6">
                <h3 className="text-lg font-semibold text-gray-800 mb-4">Upload Routes</h3>
                
                <div className="flex items-center space-x-2 mb-4 text-sm text-gray-600">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 text-teal-600" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M4 4a2 2 0 012-2h4.586A2 2 0 0112 2.586L15.414 6A2 2 0 0116 7.414V16a2 2 0 01-2 2H6a2 2 0 01-2-2V4z" clipRule="evenodd" />
                  </svg>
                  <span>{pendingFile.name}</span>
                  <span className="text-gray-400">•</span>
                  <span>{parsedRoutes.length} routes found</span>
                </div>

                <div className="flex items-center space-x-4 mb-4">
                  <span className="text-sm font-medium text-gray-700">Upload to Branch:</span>
                  <BranchDropdown branches={branches} selectedBranchId={uploadBranchId} onChange={setUploadBranchId} />
                </div>

                {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

                <div className="flex items-center space-x-3">
                  <button
                    onClick={handleUpload}
                    disabled={isUploading || !uploadBranchId}
                    className={`px-4 py-2 rounded-lg text-sm font-medium flex items-center space-x-2 ${isUploading || !uploadBranchId ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-teal-600 text-white hover:bg-teal-700'}`}
                  >
                    {isUploading && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>}
                    <span>{isUploading ? 'Uploading...' : 'Upload Routes'}</span>
                  </button>
                  <button onClick={handleCancelUpload} className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300 text-sm font-medium">
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Content Area */}
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-t-4 border-b-4 border-teal-500 rounded-full animate-spin"></div>
            <span className="ml-3 text-gray-600">Loading routes...</span>
          </div>
        ) : routes.length === 0 ? (
          <div className="text-center py-12 bg-white rounded-xl border">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16 text-gray-300 mx-auto mb-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
            </svg>
            <h3 className="text-lg font-medium text-gray-700 mb-1">No Routes for {selectedBranchName}</h3>
            <p className="text-gray-500 text-sm">{userRole === 'admin' ? 'Upload a route CSV above to get started' : 'No routes have been uploaded yet'}</p>
          </div>
        ) : (
          <div className="print-area">
            {/* Summary Stats */}
            {stats && (
              <>
                <div className="no-print mb-3 text-xs text-gray-500 italic">
                  Maximum route duration set to 6.5 hours. Start and ending location set to the branch location.
                </div>
                <div className="no-print grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{stats.totalRoutes}</div>
                  <div className="text-xs text-gray-500">Routes</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{stats.totalStops}</div>
                  <div className="text-xs text-gray-500">Total Stops</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{stats.avgStopsPerRoute}</div>
                  <div className="text-xs text-gray-500">Avg Stops</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{stats.totalDistance}</div>
                  <div className="text-xs text-gray-500">Total Miles</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{stats.avgDistance}</div>
                  <div className="text-xs text-gray-500">Avg Miles</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-lg font-bold text-teal-700">{stats.totalDuration}</div>
                  <div className="text-xs text-gray-500">Total Time</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-lg font-bold text-teal-700">{stats.avgDuration}</div>
                  <div className="text-xs text-gray-500">Avg Time</div>
                </div>
              </div>
              </>
            )}

            {/* Routes Table Card */}
            <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
              {/* Header */}
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
                      {selectedRouteId === 'all' ? 'All Routes' : `Route ${filteredRoutes[0]?.routeNumber}`} — {selectedBranchName}
                    </h2>
                  </div>
                  <div className="flex items-center space-x-4 text-xs">
                    <span><span className="text-gray-500">Routes:</span> <span className="font-medium">{filteredRoutes.length}</span></span>
                    <span><span className="text-gray-500">Stops:</span> <span className="font-medium">{filteredRoutes.reduce((sum, r) => sum + r.stops.length, 0)}</span></span>
                  </div>
                </div>
              </div>

              {/* Table */}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-800 text-white">
                    <tr>
                      <th className="px-1.5 py-0.5 text-left font-bold text-xs" style={{width: '70px'}}>Route</th>
                      <th className="px-1.5 py-0.5 text-left font-medium text-xs" style={{width: '90px'}}>Day</th>
                      <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '30px'}}>#</th>
                      <th className="px-1.5 py-0.5 text-left font-medium text-xs" style={{width: '20%'}}>Property</th>
                      <th className="px-1.5 py-0.5 text-left font-medium text-xs" style={{width: '22%'}}>Address</th>
                      <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '70px'}}>Service Time</th>
                      <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '80px'}}>Route Time</th>
                      <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '60px'}}>Miles</th>
                      <th className="px-1.5 py-0.5 text-left font-medium text-xs">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {filteredRoutes.map((route) => {
                      const routeServiceMinutes = route.stops.reduce((sum, stop) => sum + parseServiceTimeToMinutes(stop.serviceTime), 0);
                      
                      return (
                        <React.Fragment key={route.id}>
                          {route.stops.map((stop, index) => {
                            const isFirstInRoute = index === 0;
                            
                            return (
                              <tr 
                                key={`${route.id}-${index}`} 
                                className="hover:bg-gray-50"
                              >
                                <td className={`px-1.5 py-0.5 font-bold text-xs ${isFirstInRoute ? 'bg-teal-100 text-teal-800' : 'text-gray-300'}`}>
                                  {isFirstInRoute ? `Route ${route.routeNumber}` : ''}
                                </td>
                                <td className={`px-1.5 py-0.5 text-xs ${isFirstInRoute ? 'bg-teal-50' : ''}`}>
                                  {isFirstInRoute ? (
                                    <select
                                      value={route.dayOfWeek || ''}
                                      onChange={(e) => handleDayChange(route.id, e.target.value)}
                                      onClick={(e) => e.stopPropagation()}
                                      className={`w-full text-xs border-0 bg-transparent focus:ring-1 focus:ring-teal-500 rounded cursor-pointer ${route.dayOfWeek ? 'text-gray-900 font-medium' : 'text-gray-400'}`}
                                    >
                                      <option value="">Unassigned</option>
                                      {days.map(day => (
                                        <option key={day} value={day}>{day}</option>
                                      ))}
                                    </select>
                                  ) : null}
                                </td>
                                <td className="px-1.5 py-0.5 text-center text-gray-500 text-xs">{index + 1}</td>
                                <td className="px-1.5 py-0.5 text-xs truncate max-w-0" title={stop.name}>
                                  <span className="text-gray-900">{stop.name}</span>
                                </td>
                                <td className="px-1.5 py-0.5 text-gray-600 text-xs truncate max-w-0" title={stop.address}>
                                  {stop.address || '—'}
                                </td>
                                <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs font-medium">
                                  {parseServiceTimeToMinutes(stop.serviceTime)} min
                                </td>
                                <td className="px-1.5 py-0.5 text-center text-gray-600 text-xs">
                                </td>
                                <td className="px-1.5 py-0.5 text-center text-gray-600 text-xs">
                                </td>
                                <td className="px-1.5 py-0.5 text-gray-500 text-xs truncate max-w-0" title={stop.notes}>
                                  {stop.notes || ''}
                                </td>
                              </tr>
                            );
                          })}
                          {/* Route Total Row */}
                          <tr className="bg-gray-100 font-bold border-b-2 border-gray-300">
                            <td className="px-1.5 py-0.5"></td>
                            <td className="px-1.5 py-0.5">
                              <button
                                onClick={() => handleOpenInMaps(route)}
                                className="text-blue-600 hover:text-blue-800 text-xs font-medium flex items-center space-x-1"
                                title="Open route in Google Maps"
                              >
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
                                  <path fillRule="evenodd" d="M5.05 4.05a7 7 0 119.9 9.9L10 18.9l-4.95-4.95a7 7 0 010-9.9zM10 11a2 2 0 100-4 2 2 0 000 4z" clipRule="evenodd" />
                                </svg>
                                <span>Open Route</span>
                              </button>
                            </td>
                            <td className="px-1.5 py-0.5"></td>
                            <td className="px-1.5 py-0.5 text-right text-gray-700 text-xs">Route {route.routeNumber} Total:</td>
                            <td className="px-1.5 py-0.5"></td>
                            <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs">{formatMinutesToDuration(routeServiceMinutes)}</td>
                            <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs">{formatDuration(route.duration)}</td>
                            <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs">{route.distance?.toFixed(1)} mi</td>
                            <td className="px-1.5 py-0.5"></td>
                          </tr>
                        </React.Fragment>
                      );
                    })}
                    
                    {/* Grand Total Row */}
                    {filteredRoutes.length > 1 && (
                      <tr className="bg-teal-100 font-bold">
                        <td className="px-1.5 py-1"></td>
                        <td className="px-1.5 py-1"></td>
                        <td className="px-1.5 py-1"></td>
                        <td className="px-1.5 py-1 text-right text-teal-900 text-xs">Grand Total:</td>
                        <td className="px-1.5 py-1"></td>
                        <td className="px-1.5 py-1 text-center text-teal-900 text-xs">
                          {formatMinutesToDuration(filteredRoutes.reduce((sum, r) => 
                            sum + r.stops.reduce((s, stop) => s + parseServiceTimeToMinutes(stop.serviceTime), 0), 0))}
                        </td>
                        <td className="px-1.5 py-1 text-center text-teal-900 text-xs">
                          {formatMinutesToDuration(filteredRoutes.reduce((sum, r) => sum + parseDurationToMinutes(r.duration), 0))}
                        </td>
                        <td className="px-1.5 py-1 text-center text-teal-900 text-xs">
                          {filteredRoutes.reduce((sum, r) => sum + (r.distance || 0), 0).toFixed(1)} mi
                        </td>
                        <td className="px-1.5 py-1"></td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}