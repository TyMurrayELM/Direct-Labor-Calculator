"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useCrews, useBranches } from '../hooks/useSupabase';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter } from 'next/navigation';

const getIconPath = (branchName) => {
  if (!branchName) return null;
  const name = branchName.toLowerCase();
  if (name.includes('vegas') || name.includes('lv')) return '/lv.png';
  if (name.includes('north')) return '/n.png';
  if (name.includes('southeast') || name.includes('se')) return '/se.png';
  if (name.includes('southwest') || name.includes('sw')) return '/sw.png';
  return null;
};

export default function RoutesPage() {
  const router = useRouter();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  const [session, setSession] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const { crews = [], loading: crewsLoading } = useCrews();
  const { branches = [], loading: branchesLoading } = useBranches();

  const [selectedBranchId, setSelectedBranchId] = useState(null);
  const [selectedCrewIds, setSelectedCrewIds] = useState([]);

  // Optimization state
  const [optimizing, setOptimizing] = useState(false);
  const [optimizeStatus, setOptimizeStatus] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [applying, setApplying] = useState(false);
  const [applyMessage, setApplyMessage] = useState(null);

  // Past optimizations
  const [history, setHistory] = useState([]);

  // Close crew dropdown on outside click
  useEffect(() => {
    const handleClick = (e) => {
      if (!e.target.closest('[data-crew-dropdown]')) {
        document.querySelectorAll('[data-crew-menu]').forEach(el => el.classList.add('hidden'));
      }
    };
    document.addEventListener('click', handleClick);
    return () => document.removeEventListener('click', handleClick);
  }, []);

  // Auth + admin check
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (!session) {
        router.push('/login');
      } else {
        supabase.from('allowlist').select('role').eq('email', session.user.email).single()
          .then(({ data }) => {
            if (data?.role !== 'admin') {
              router.push('/');
            } else {
              setUserRole('admin');
            }
          });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session);
      if (!session) router.push('/login');
    });
    return () => subscription.unsubscribe();
  }, []);

  // Auto-select first branch
  useEffect(() => {
    if (branches.length > 0 && !selectedBranchId) {
      setSelectedBranchId(branches[0].id);
    }
  }, [branches]);

  // Filter crews by branch (maintenance only, skip onsite)
  const branchCrews = crews.filter(c =>
    c.branch_id === selectedBranchId && c.crew_type !== 'Onsite'
  );

  // Load optimization history when crew selection changes (single crew only)
  useEffect(() => {
    if (selectedCrewIds.length === 1) {
      loadHistory(selectedCrewIds[0]);
    } else {
      setHistory([]);
    }
  }, [selectedCrewIds]);

  async function loadHistory(crewId) {
    try {
      const res = await fetch(`/api/routes/optimizations?crew_id=${crewId}`);
      const data = await res.json();
      if (data.success) setHistory(data.optimizations || []);
    } catch { /* ignore */ }
  }

  async function loadOptimization(optId) {
    try {
      setOptimizing(true);
      setOptimizeStatus('Loading optimization...');
      setError(null);
      const res = await fetch(`/api/routes/optimizations?id=${optId}`);
      const data = await res.json();
      if (data.success) {
        setResult(data);
        setOptimizeStatus('');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setOptimizing(false);
    }
  }

  async function deleteOptimization(optId, e) {
    e.stopPropagation();
    if (!confirm('Delete this optimization run?')) return;
    try {
      const res = await fetch('/api/routes/optimizations', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: optId }),
      });
      const data = await res.json();
      if (data.success) {
        setHistory(prev => prev.filter(h => h.id !== optId));
        if (result?.optimization_id === optId) setResult(null);
      }
    } catch { /* ignore */ }
  }

  async function runOptimization() {
    if (selectedCrewIds.length === 0) return;
    setOptimizing(true);
    setResult(null);
    setError(null);
    setApplyMessage(null);

    try {
      setOptimizeStatus('Building distance matrix & solving routes...');
      const payload = selectedCrewIds.length === 1
        ? { crew_id: selectedCrewIds[0] }
        : { crew_ids: selectedCrewIds };
      const res = await fetch('/api/routes/optimize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        setError(data.error);
      } else {
        setResult(data);
        if (selectedCrewIds.length === 1) {
          loadHistory(selectedCrewIds[0]);
        }
      }
    } catch (err) {
      setError(err.message);
    }
    setOptimizeStatus('');
    setOptimizing(false);
  }

  async function applyOptimization() {
    if (!result?.optimization_id) return;
    setApplying(true);
    setApplyMessage(null);

    try {
      const res = await fetch('/api/routes/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ optimization_id: result.optimization_id }),
      });

      const data = await res.json();
      if (data.success) {
        setApplyMessage(`Applied! ${data.updated} properties updated.`);
        loadHistory(selectedCrewIds[0]);
      } else {
        setApplyMessage(`Error: ${data.error}`);
      }
    } catch (err) {
      setApplyMessage(`Error: ${err.message}`);
    } finally {
      setApplying(false);
    }
  }

  if (!session || userRole !== 'admin') return null;

  return (
    <div className="min-h-screen bg-gray-50 p-4">
      {/* Header */}
      <div className="max-w-7xl mx-auto mb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <Link href="/" className="text-gray-500 hover:text-gray-700">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M9.707 16.707a1 1 0 01-1.414 0l-6-6a1 1 0 010-1.414l6-6a1 1 0 011.414 1.414L5.414 9H17a1 1 0 110 2H5.414l4.293 4.293a1 1 0 010 1.414z" clipRule="evenodd" />
              </svg>
            </Link>
            <h1 className="text-xl font-bold text-gray-800">Route Optimizer</h1>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto">
        {/* Controls */}
        <div className="bg-white rounded-lg shadow-sm border p-4 mb-4">
          <div className="flex flex-wrap items-center gap-4">
            {/* Branch selector */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Branch:</label>
              <select
                value={selectedBranchId || ''}
                onChange={(e) => {
                  setSelectedBranchId(Number(e.target.value));
                  setSelectedCrewIds([]);
                  setResult(null);
                }}
                className="border rounded-md px-3 py-1.5 text-sm"
              >
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>

            {/* Crew multi-select */}
            <div className="flex items-center space-x-2">
              <label className="text-sm font-medium text-gray-700">Crews:</label>
              <div className="relative" data-crew-dropdown>
                <div className="border rounded-md px-3 py-1.5 text-sm min-w-[200px] cursor-pointer bg-white flex items-center justify-between"
                  onClick={(e) => {
                    const dropdown = e.currentTarget.nextElementSibling;
                    dropdown.classList.toggle('hidden');
                  }}
                >
                  <span className="text-gray-700">
                    {selectedCrewIds.length === 0 ? 'Select crews...' :
                     selectedCrewIds.length === 1 ? crews.find(c => c.id === selectedCrewIds[0])?.name :
                     `${selectedCrewIds.length} crews selected`}
                  </span>
                  <svg className="w-4 h-4 text-gray-400 ml-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
                <div data-crew-menu className="hidden absolute z-10 mt-1 w-full bg-white border rounded-md shadow-lg max-h-60 overflow-y-auto">
                  <div className="p-1.5 border-b">
                    <button
                      className="text-xs text-blue-600 hover:underline mr-3"
                      onClick={() => {
                        setSelectedCrewIds(branchCrews.map(c => c.id));
                        setResult(null);
                      }}
                    >Select all</button>
                    <button
                      className="text-xs text-gray-500 hover:underline"
                      onClick={() => {
                        setSelectedCrewIds([]);
                        setResult(null);
                      }}
                    >Clear</button>
                  </div>
                  {branchCrews.map(c => (
                    <label key={c.id} className="flex items-center px-3 py-1.5 hover:bg-gray-50 cursor-pointer text-sm">
                      <input
                        type="checkbox"
                        checked={selectedCrewIds.includes(c.id)}
                        onChange={(e) => {
                          setResult(null);
                          setError(null);
                          if (e.target.checked) {
                            setSelectedCrewIds(prev => [...prev, c.id]);
                          } else {
                            setSelectedCrewIds(prev => prev.filter(id => id !== c.id));
                          }
                        }}
                        className="mr-2"
                      />
                      {c.name} ({c.size}m)
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {/* Run button */}
            <button
              onClick={runOptimization}
              disabled={selectedCrewIds.length === 0 || optimizing}
              className="px-4 py-1.5 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium flex items-center space-x-2"
            >
              {optimizing ? (
                <>
                  <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  <span>Optimizing...</span>
                </>
              ) : (
                <>
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                  </svg>
                  <span>Run Optimization{selectedCrewIds.length > 1 ? ` (${selectedCrewIds.length} crews)` : ''}</span>
                </>
              )}
            </button>
          </div>

          {/* Status messages */}
          {optimizeStatus && (
            <div className="mt-3 text-sm text-blue-600 flex items-center space-x-2">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span>{optimizeStatus}</span>
            </div>
          )}
          {error && (
            <div className="mt-3 text-sm text-red-600 bg-red-50 border border-red-200 rounded-md p-3">{error}</div>
          )}
        </div>

        {/* Optimization results */}
        {result && (() => {
          const activeRoutes = Object.keys(result.routes || {}).filter(day => result.routes?.[day]?.length > 0);
          const allTotals = Object.values(result.day_totals || {});
          const totalServiceMin = allTotals.reduce((s, d) => s + (d.service_minutes || 0), 0);
          const totalDriveMin = allTotals.reduce((s, d) => s + (d.drive_minutes || 0), 0);
          const totalStops = allTotals.reduce((s, d) => s + (d.stop_count || 0), 0);
          const routesNeeded = result.routes_needed || activeRoutes.length;
          const crewCount = result.crew_count || selectedCrewIds.length;
          const crewsNeeded = Math.ceil(routesNeeded / 5);
          const branchName = result.branch_name || 'Branch';

          const formatTime = (mins) => {
            if (!mins && mins !== 0) return '';
            const h = Math.floor(mins / 60);
            const m = mins % 60;
            const ampm = h >= 12 ? 'PM' : 'AM';
            const h12 = h > 12 ? h - 12 : (h === 0 ? 12 : h);
            return `${h12}:${String(m).padStart(2, '0')} ${ampm}`;
          };
          const formatDuration = (mins) => {
            const h = Math.floor(mins / 60);
            const m = Math.round(mins % 60);
            return h > 0 ? `${h}h ${m}m` : `${m}m`;
          };

          return (
            <div className="space-y-4">
              {/* Summary stats — QS style */}
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{routesNeeded}</div>
                  <div className="text-xs text-gray-500">Routes</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{totalStops}</div>
                  <div className="text-xs text-gray-500">Total Stops</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{routesNeeded > 0 ? Math.round(totalStops / routesNeeded) : 0}</div>
                  <div className="text-xs text-gray-500">Avg Stops</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{formatDuration(totalServiceMin)}</div>
                  <div className="text-xs text-gray-500">Total Service</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{formatDuration(totalDriveMin)}</div>
                  <div className="text-xs text-gray-500">Total Drive</div>
                </div>
                <div className="bg-white rounded-lg border p-2 text-center">
                  <div className="text-xl font-bold text-teal-700">{formatDuration(totalServiceMin + totalDriveMin)}</div>
                  <div className="text-xs text-gray-500">Total Time</div>
                </div>
                {crewCount > 1 ? (
                  <div className="bg-white rounded-lg border p-2 text-center">
                    <div className={`text-xl font-bold ${crewsNeeded < crewCount ? 'text-emerald-600' : 'text-teal-700'}`}>{crewsNeeded}</div>
                    <div className="text-xs text-gray-500">Crews Needed (of {crewCount})</div>
                  </div>
                ) : (
                  <div className="bg-white rounded-lg border p-2 text-center">
                    <div className="text-xl font-bold text-teal-700">{formatDuration((totalServiceMin + totalDriveMin) / (routesNeeded || 1))}</div>
                    <div className="text-xs text-gray-500">Avg Time</div>
                  </div>
                )}
              </div>

              {/* Crew consolidation / info banners */}
              {(() => {
                const currentTotalRoutes = crewCount * 5;
                if (crewCount > 1 && routesNeeded < currentTotalRoutes) {
                  return (
                    <div className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-md p-3">
                      <strong>{routesNeeded} routes</strong> needed for all {result.properties_count} properties.
                      Currently using {crewCount} crews ({currentTotalRoutes} route slots).
                      {crewsNeeded < crewCount ? (
                        <> Could consolidate to <strong>{crewsNeeded} crew{crewsNeeded > 1 ? 's' : ''}</strong> ({crewsNeeded * 5} route slots).</>
                      ) : (
                        <> All {crewCount} crews are needed.</>
                      )}
                    </div>
                  );
                }
                if (crewCount > 1 && routesNeeded >= currentTotalRoutes) {
                  return (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                      <strong>{routesNeeded} routes</strong> needed — all {crewCount} crews ({currentTotalRoutes} route slots) are fully utilized.
                      {routesNeeded > currentTotalRoutes && <> Consider adding crews.</>}
                    </div>
                  );
                }
                if (crewCount === 1 && routesNeeded > 5) {
                  return (
                    <div className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md p-3">
                      This crew needs <strong>{routesNeeded} routes</strong> (more than 5 per week). Consider splitting into additional crews.
                    </div>
                  );
                }
                return null;
              })()}

              {result.constraints_applied?.length > 0 && (
                <div className="text-sm border rounded-md p-3 bg-gray-50">
                  <div className="font-semibold text-gray-700 mb-2">Constraints</div>
                  <div className="space-y-1.5">
                    {result.constraints_applied.map((c, i) => (
                      <div key={i} className="flex items-start gap-2 text-xs">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                          c.status === 'enforced' ? 'bg-emerald-100 text-emerald-700' :
                          'bg-red-100 text-red-700'
                        }`}>
                          {c.status === 'enforced' ? 'Enforced' : 'Skipped'}
                        </span>
                        <span className="text-gray-600">
                          {c.description}
                          {c.reason && <span className="text-red-600 ml-1">— {c.reason}</span>}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.dropped_properties?.length > 0 && (
                <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-md p-3">
                  {result.dropped_properties.length} properties could not fit even with expanded routes. Consider adding crews.
                </div>
              )}

              {/* Routes Table — QS style */}
              <div className="bg-white rounded-lg shadow-md border border-gray-200 overflow-hidden">
                {/* Table Header */}
                <div className="px-2 py-1.5 border-b-2 border-gray-300">
                  <div className="flex justify-between items-center">
                    <h2 className="text-sm font-bold text-gray-900">
                      Optimization Results — {result.crew_name}{crewCount > 1 ? ` (${crewCount} crews)` : ''}
                    </h2>
                    <div className="flex items-center space-x-4 text-xs">
                      <span><span className="text-gray-500">Routes:</span> <span className="font-medium">{routesNeeded}</span></span>
                      <span><span className="text-gray-500">Stops:</span> <span className="font-medium">{totalStops}</span></span>
                      <div className="flex items-center space-x-2">
                        {applyMessage && (
                          <span className={`text-xs ${applyMessage.startsWith('Applied') ? 'text-emerald-600' : 'text-red-600'}`}>
                            {applyMessage}
                          </span>
                        )}
                        <button
                          onClick={applyOptimization}
                          disabled={applying || applyMessage?.startsWith('Applied')}
                          className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-xs font-medium"
                        >
                          {applying ? 'Applying...' : 'Apply to Schedule'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-gray-800 text-white">
                      <tr>
                        <th className="px-1.5 py-0.5 text-left font-bold text-xs" style={{width: '80px'}}>Route</th>
                        <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '30px'}}>#</th>
                        <th className="px-1.5 py-0.5 text-left font-medium text-xs" style={{width: '22%'}}>Property</th>
                        <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '65px'}}>Arrival</th>
                        <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '60px'}}>Drive</th>
                        <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '70px'}}>Service</th>
                        <th className="px-1.5 py-0.5 text-center font-medium text-xs" style={{width: '55px'}}>Window</th>
                        <th className="px-1.5 py-0.5 text-left font-medium text-xs">Complex</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-200">
                      {activeRoutes.map((day) => {
                        const stops = result.routes?.[day] || [];
                        const totals = result.day_totals?.[day] || {};
                        const overLimit = totals.total_minutes > 480;

                        return (
                          <React.Fragment key={day}>
                            {stops.map((stop, idx) => {
                              const isFirst = idx === 0;
                              const complexId = result.propertyComplexes?.[stop.property_id];
                              const complexName = complexId ? result.complexNames?.[complexId] : null;
                              const hasWindow = stop.window_start && stop.window_end && (stop.window_start !== 360 || stop.window_end !== 840);

                              return (
                                <tr key={`${day}-${stop.property_id}`} className="hover:bg-gray-50">
                                  <td className={`px-1.5 py-0.5 font-bold text-xs ${isFirst ? 'bg-teal-100 text-teal-800' : 'text-gray-300'}`}>
                                    {isFirst ? day : ''}
                                  </td>
                                  <td className="px-1.5 py-0.5 text-center text-gray-500 text-xs">{idx + 1}</td>
                                  <td className="px-1.5 py-0.5 text-xs truncate max-w-0" title={result.propertyNames?.[stop.property_id]}>
                                    <span className="text-gray-900">{result.propertyNames?.[stop.property_id] || `Property #${stop.property_id}`}</span>
                                  </td>
                                  <td className="px-1.5 py-0.5 text-center text-gray-600 text-xs">
                                    {stop.arrival_minutes ? formatTime(stop.arrival_minutes) : ''}
                                  </td>
                                  <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs font-medium">
                                    {Math.round(stop.drive_time_seconds / 60)}m
                                  </td>
                                  <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs font-medium">
                                    {Math.round(stop.onsite_minutes)}m
                                  </td>
                                  <td className={`px-1.5 py-0.5 text-center text-xs ${hasWindow ? 'text-amber-600 font-medium' : 'text-gray-400'}`}>
                                    {hasWindow ? `${formatTime(stop.window_start)}` : ''}
                                  </td>
                                  <td className={`px-1.5 py-0.5 text-xs ${complexName ? 'text-blue-700 font-medium' : 'text-gray-400'}`}>
                                    {complexName || ''}
                                  </td>
                                </tr>
                              );
                            })}
                            {/* Route Total Row */}
                            <tr className={`${overLimit ? 'bg-red-100' : 'bg-gray-100'} font-bold border-b-2 border-gray-300`}>
                              <td className="px-1.5 py-0.5"></td>
                              <td className="px-1.5 py-0.5"></td>
                              <td className="px-1.5 py-0.5 text-right text-gray-700 text-xs">
                                {day} Total ({stops.length} stops):
                              </td>
                              <td className="px-1.5 py-0.5"></td>
                              <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs">{formatDuration(totals.drive_minutes || 0)}</td>
                              <td className="px-1.5 py-0.5 text-center text-gray-900 text-xs">{formatDuration(totals.service_minutes || 0)}</td>
                              <td className={`px-1.5 py-0.5 text-center text-xs font-bold ${overLimit ? 'text-red-700' : 'text-gray-900'}`}>
                                {formatDuration(totals.total_minutes || 0)}
                              </td>
                              <td className="px-1.5 py-0.5"></td>
                            </tr>
                          </React.Fragment>
                        );
                      })}

                      {/* Grand Total Row */}
                      {activeRoutes.length > 1 && (
                        <tr className="bg-teal-100 font-bold">
                          <td className="px-1.5 py-1"></td>
                          <td className="px-1.5 py-1"></td>
                          <td className="px-1.5 py-1 text-right text-teal-900 text-xs">Grand Total:</td>
                          <td className="px-1.5 py-1"></td>
                          <td className="px-1.5 py-1 text-center text-teal-900 text-xs">{formatDuration(totalDriveMin)}</td>
                          <td className="px-1.5 py-1 text-center text-teal-900 text-xs">{formatDuration(totalServiceMin)}</td>
                          <td className="px-1.5 py-1 text-center text-teal-900 text-xs">{formatDuration(totalServiceMin + totalDriveMin)}</td>
                          <td className="px-1.5 py-1"></td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          );
        })()}

        {/* History */}
        {history.length > 0 && (
          <div className="mt-6 bg-white rounded-lg shadow-sm border p-4">
            <h3 className="text-sm font-semibold text-gray-700 mb-3">Optimization History</h3>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-gray-500 border-b">
                  <th className="pb-2">Date</th>
                  <th className="pb-2">Crew</th>
                  <th className="pb-2">Properties</th>
                  <th className="pb-2">Original</th>
                  <th className="pb-2">Optimized</th>
                  <th className="pb-2">Saved</th>
                  <th className="pb-2">Status</th>
                  <th className="pb-2"></th>
                </tr>
              </thead>
              <tbody>
                {history.map(opt => (
                  <tr
                    key={opt.id}
                    className="border-b last:border-0 hover:bg-blue-50 cursor-pointer transition-colors"
                    onClick={() => loadOptimization(opt.id)}
                  >
                    <td className="py-2">{new Date(opt.created_at).toLocaleDateString()}</td>
                    <td className="py-2">{opt.crew_name}</td>
                    <td className="py-2">{opt.properties_count}</td>
                    <td className="py-2">{opt.original_drive_minutes?.toFixed(0)} min</td>
                    <td className="py-2">{opt.total_drive_minutes?.toFixed(0)} min</td>
                    <td className="py-2 text-emerald-600 font-medium">
                      {(opt.original_drive_minutes - opt.total_drive_minutes)?.toFixed(0)} min
                    </td>
                    <td className="py-2">
                      <span className={`px-2 py-0.5 rounded-full text-xs ${
                        opt.status === 'applied' ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-600'
                      }`}>
                        {opt.status}
                      </span>
                    </td>
                    <td className="py-2 text-right">
                      <button
                        onClick={(e) => deleteOptimization(opt.id, e)}
                        className="text-gray-400 hover:text-red-500 transition-colors"
                        title="Delete optimization"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
