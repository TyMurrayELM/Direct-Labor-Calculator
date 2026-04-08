"use client";

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useBranches } from '../../hooks/useSupabase';
import { createBrowserClient } from '@supabase/ssr';
import { useRouter, useSearchParams } from 'next/navigation';
import PnlSection from '../../components/PnlSection';
import MaintenanceRevenuePanel from '../../components/MaintenanceRevenuePanel';

const OVERHEAD_DEPARTMENTS = [
  { value: 'biz_dev_marketing', label: 'Business Development and Marketing' },
  { value: 'equipment_fleet', label: 'Equipment & Fleet Operations' },
  { value: 'facilities', label: 'Facilities' },
  { value: 'finance_accounting', label: 'Finance and Accounting' },
  { value: 'it_technology', label: 'IT/Technology' },
  { value: 'insurance', label: 'Insurance' },
  { value: 'owner_ops_benefits', label: 'Owner Operations & Benefits' },
  { value: 'safety', label: 'Safety' },
  { value: 'talent_culture', label: 'Talent & Culture' },
];

// Fixed branch options for overhead departments
const OVERHEAD_BRANCHES = [
  { key: 'encore', label: 'Encore', color: '#2563EB', dbName: null },
  { key: 'phoenix', label: 'Phoenix', color: '#C2410C', dbName: 'Phoenix' },
  { key: 'las_vegas', label: 'Las Vegas', color: '#B8860B', dbName: 'Las Vegas' },
  { key: 'corporate', label: 'Corporate', color: '#6B7280', dbName: 'Corporate' },
];

export default function OverheadForecastPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const supabase = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  // State
  const [session, setSession] = useState(null);
  const [authorized, setAuthorized] = useState(false);
  const [selectedBranchKey, setSelectedBranchKey] = useState(() => {
    const fromUrl = searchParams.get('branch');
    return OVERHEAD_BRANCHES.some(b => b.key === fromUrl) ? fromUrl : 'encore';
  });
  const [selectedYear, setSelectedYear] = useState(2026);
  const [selectedDepartment, setSelectedDepartment] = useState(() => {
    const fromUrl = searchParams.get('department');
    return OVERHEAD_DEPARTMENTS.some(d => d.value === fromUrl) ? fromUrl : 'biz_dev_marketing';
  });

  // Sync department + branch to URL
  useEffect(() => {
    const params = new URLSearchParams(Array.from(searchParams.entries()));
    if (params.get('department') === selectedDepartment && params.get('branch') === selectedBranchKey) return;
    params.set('department', selectedDepartment);
    params.set('branch', selectedBranchKey);
    router.replace(`/forecast/overhead?${params.toString()}`, { scroll: false });
  }, [selectedDepartment, selectedBranchKey, router, searchParams]);
  const [creatingCorporate, setCreatingCorporate] = useState(false);
  const [pnlVersionState, setPnlVersionState] = useState(null);

  const { branches, loading: branchesLoading } = useBranches();

  // Check authentication + admin role
  useEffect(() => {
    const checkAuth = async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        router.push('/login');
        return;
      }
      setSession(session);

      const { data } = await supabase
        .from('allowlist')
        .select('role')
        .eq('email', session.user.email.toLowerCase())
        .single();

      if (data?.role !== 'admin') {
        router.push('/forecast');
        return;
      }
      setAuthorized(true);
    };
    checkAuth();
  }, [router, supabase]);

  // Resolve DB branch IDs from branch names
  const phoenixBranchId = branches.find(b => b.name === 'Phoenix')?.id || null;
  const lasVegasBranchId = branches.find(b => b.name === 'Las Vegas')?.id || null;
  const corporateBranchId = branches.find(b => b.name === 'Corporate')?.id || null;

  const isEncoreView = selectedBranchKey === 'encore';

  // Get active branch ID and display info for PnlSection
  const getActiveBranchId = () => {
    switch (selectedBranchKey) {
      case 'phoenix': return phoenixBranchId;
      case 'las_vegas': return lasVegasBranchId;
      case 'corporate': return corporateBranchId;
      default: return null;
    }
  };

  const getActiveBranchName = () => {
    switch (selectedBranchKey) {
      case 'phoenix': return ['Corporate', 'Phoenix'];
      case 'las_vegas': return 'Las Vegas';
      case 'corporate': return 'Corporate';
      default: return 'Encore';
    }
  };

  const activeBranchId = getActiveBranchId();
  const activeBranchName = getActiveBranchName();
  const activeBranchDef = OVERHEAD_BRANCHES.find(b => b.key === selectedBranchKey);

  // Create Corporate branch if it doesn't exist
  const createCorporateBranch = useCallback(async () => {
    setCreatingCorporate(true);
    try {
      const { error } = await supabase
        .from('branches')
        .insert({ name: 'Corporate', color: '#6B7280' });
      if (error) throw error;
      // Reload page to pick up new branch
      window.location.reload();
    } catch (err) {
      console.error('Error creating Corporate branch:', err);
      setCreatingCorporate(false);
    }
  }, [supabase]);

  const yearOptions = [2025, 2026, 2027];

  if (branchesLoading || !authorized) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-green-50">
        <div className="w-full max-w-2xl px-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="h-7 w-7 rounded-full border-[3px] border-green-600 border-t-transparent animate-spin" />
            <p className="text-lg font-semibold text-black">Loading...</p>
          </div>
        </div>
      </div>
    );
  }

  // Check if selected branch is missing from DB
  const isMissingBranch = !isEncoreView && !activeBranchId;
  const isMissingCorporate = selectedBranchKey === 'corporate' && !corporateBranchId;

  return (
    <div className="max-w-7xl mx-auto p-4 sm:p-6 bg-green-50 min-h-screen">
      <div className="bg-white shadow-xl rounded-xl overflow-hidden border border-gray-100">
        {/* Header */}
        <div className="bg-gradient-to-r from-white to-gray-100 p-4 border-b border-gray-200"
          style={{ borderTop: `4px solid ${activeBranchDef?.color || '#16A34A'}` }}>
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-3">
              <div className="bg-gray-100 p-2 rounded-lg">
                <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-800">Overhead P&L</h1>
                <p className="text-sm text-gray-700 mt-1">Overhead department profit & loss</p>
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

          {/* Branch, Year & Department Selectors */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Branch:</label>
              <div className="flex flex-wrap gap-2">
                {OVERHEAD_BRANCHES.filter(b => !(b.key === 'phoenix' && selectedDepartment === 'biz_dev_marketing')).map(branch => (
                  <button
                    key={branch.key}
                    onClick={() => setSelectedBranchKey(branch.key)}
                    className={`px-4 py-2 rounded-lg font-medium transition-all ${
                      selectedBranchKey === branch.key
                        ? 'text-white shadow-md'
                        : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
                    }`}
                    style={{
                      backgroundColor: selectedBranchKey === branch.key ? branch.color : undefined
                    }}
                  >
                    {branch.key === 'encore' && <img src="/agave.png" alt="" className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />}
                    {branch.key === 'phoenix' && <img src="/az.png" alt="" className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />}
                    {branch.key === 'las_vegas' && <img src="/lv.png" alt="" className="w-4 h-4 inline-block mr-1.5 -mt-0.5" />}
                    {branch.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Year:</label>
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(parseInt(e.target.value))}
                className="bg-white border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                {yearOptions.map(year => (
                  <option key={year} value={year}>{year}</option>
                ))}
              </select>
            </div>

            <div className="flex items-center gap-2">
              <label className="text-sm font-medium text-gray-700">Department:</label>
              <select
                value={selectedDepartment}
                onChange={(e) => setSelectedDepartment(e.target.value)}
                className="bg-white border border-gray-300 rounded-lg px-3 py-2 focus:ring-2 focus:ring-green-500 focus:border-green-500"
              >
                {OVERHEAD_DEPARTMENTS.map(dept => (
                  <option key={dept.value} value={dept.value}>{dept.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Encore roll-up view */}
        {isEncoreView && selectedDepartment === 'biz_dev_marketing' && (
          <MaintenanceRevenuePanel
            branchId={null}
            branchKey="encore"
            year={selectedYear}
            versionState={pnlVersionState}
          />
        )}
        {isEncoreView && (
          <div className="p-6">
            <div className="text-center text-gray-500 py-8">
              <p className="text-lg font-medium mb-2">Encore (All Branches)</p>
              <p className="text-sm">Select Phoenix, Las Vegas, or Corporate to view and edit P&L for this department.</p>
            </div>
          </div>
        )}

        {/* Missing Corporate branch — offer to create */}
        {isMissingCorporate && (
          <div className="p-6">
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">The &quot;Corporate&quot; branch does not exist yet.</p>
              <button
                onClick={createCorporateBranch}
                disabled={creatingCorporate}
                className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors disabled:opacity-50"
              >
                {creatingCorporate ? 'Creating...' : 'Create Corporate Branch'}
              </button>
            </div>
          </div>
        )}

        {/* Missing non-Corporate branch (shouldn't happen, but handle gracefully) */}
        {isMissingBranch && !isMissingCorporate && (
          <div className="p-6">
            <div className="text-center text-gray-500 py-8">
              <p>Branch &quot;{activeBranchDef?.dbName}&quot; not found in the database.</p>
            </div>
          </div>
        )}

        {/* Maintenance Revenue Reference — biz_dev_marketing only */}
        {!isEncoreView && activeBranchId && selectedDepartment === 'biz_dev_marketing' && (
          <MaintenanceRevenuePanel
            branchId={activeBranchId}
            branchKey={selectedBranchKey}
            year={selectedYear}
            versionState={pnlVersionState}
          />
        )}

        {/* P&L Section — only for individual branches with valid IDs */}
        {!isEncoreView && activeBranchId && (
          <PnlSection
            branchId={activeBranchId}
            branchName={activeBranchName}
            year={selectedYear}
            department={selectedDepartment}
            onVersionStateChange={selectedDepartment === 'biz_dev_marketing' ? setPnlVersionState : undefined}
          />
        )}
      </div>
    </div>
  );
}
