"use client";

import React, { useState, useEffect } from 'react';

const ROLES = ['viewer', 'finance', 'admin'];
const TABS = ['Users', 'P&L Defaults'];

export default function AdminSettingsModal({ onClose, currentUserEmail }) {
  const [activeTab, setActiveTab] = useState('Users');

  // --- Users tab state ---
  const [users, setUsers] = useState([]);
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState(false);

  // --- P&L Defaults tab state ---
  const [versionNames, setVersionNames] = useState([]);
  const [defaultVersion, setDefaultVersion] = useState('');
  const [compareVersion, setCompareVersion] = useState('');
  const [loadingDefaults, setLoadingDefaults] = useState(true);
  const [savingDefaults, setSavingDefaults] = useState(false);
  const [defaultsSaved, setDefaultsSaved] = useState(false);

  // --- Fetch users ---
  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/allowlist');
      const data = await res.json();
      if (data.success) {
        setUsers(data.users);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoadingUsers(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  // --- Fetch P&L defaults + version names ---
  useEffect(() => {
    async function loadDefaults() {
      try {
        const [defaultsRes, versionsRes] = await Promise.all([
          fetch('/api/pnl-defaults'),
          fetch('/api/pnl-defaults/version-names')
        ]);
        const defaultsData = await defaultsRes.json();
        const versionsData = await versionsRes.json();

        if (defaultsData.success && defaultsData.defaults) {
          setDefaultVersion(defaultsData.defaults.default_version_name || '');
          setCompareVersion(defaultsData.defaults.compare_version_name || '');
        }
        if (versionsData.success) {
          setVersionNames(versionsData.names || []);
        }
      } catch (err) {
        console.error('Failed to load P&L defaults:', err);
      } finally {
        setLoadingDefaults(false);
      }
    }
    loadDefaults();
  }, []);

  // --- Users handlers ---
  const handleAdd = async () => {
    if (!newEmail.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: newEmail.trim(), role: newRole }),
      });
      const data = await res.json();
      if (data.success) {
        setNewEmail('');
        setNewRole('viewer');
        await fetchUsers();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRoleChange = async (email, role) => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/allowlist', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchUsers();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (email) => {
    if (!confirm(`Remove ${email} from the allowlist?`)) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/allowlist', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchUsers();
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const isCurrentUser = (email) =>
    currentUserEmail && email.toLowerCase() === currentUserEmail.toLowerCase();

  // --- P&L Defaults handler ---
  const handleSaveDefaults = async () => {
    setSavingDefaults(true);
    setError(null);
    setDefaultsSaved(false);
    try {
      const res = await fetch('/api/pnl-defaults', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_version_name: defaultVersion || null,
          compare_version_name: compareVersion || null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setDefaultsSaved(true);
        setTimeout(() => setDefaultsSaved(false), 2000);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSavingDefaults(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
          <h2 className="text-lg font-semibold text-gray-800">Admin Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 px-5">
          {TABS.map((tab) => (
            <button
              key={tab}
              onClick={() => { setActiveTab(tab); setError(null); }}
              className={`px-4 py-2.5 text-sm font-medium transition-colors relative ${
                activeTab === tab
                  ? 'text-indigo-600'
                  : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab}
              {activeTab === tab && (
                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-indigo-600" />
              )}
            </button>
          ))}
        </div>

        {/* Error */}
        {error && (
          <div className="mx-5 mt-3 px-3 py-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
            {error}
          </div>
        )}

        {/* Tab Content */}
        {activeTab === 'Users' && (
          <>
            {/* User List */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {loadingUsers ? (
                <div className="text-center py-8 text-black font-medium">Loading users...</div>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b border-gray-100">
                      <th className="pb-2 font-medium">Email</th>
                      <th className="pb-2 font-medium w-28">Role</th>
                      <th className="pb-2 font-medium w-16"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((user) => (
                      <tr key={user.email} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="py-2 pr-2 text-gray-700 truncate max-w-[220px]" title={user.email}>
                          {user.email}
                          {isCurrentUser(user.email) && (
                            <span className="ml-1.5 text-xs text-indigo-500 font-medium">(you)</span>
                          )}
                        </td>
                        <td className="py-2">
                          <select
                            value={user.role}
                            onChange={(e) => handleRoleChange(user.email, e.target.value)}
                            disabled={saving}
                            className="block w-full text-sm border border-gray-300 rounded px-2 py-1 bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </select>
                        </td>
                        <td className="py-2 text-center">
                          {!isCurrentUser(user.email) && (
                            <button
                              onClick={() => handleRemove(user.email)}
                              disabled={saving}
                              className="text-red-400 hover:text-red-600 disabled:opacity-40 transition-colors"
                              title="Remove user"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* Add User Row */}
            <div className="border-t border-gray-200 px-5 py-3">
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  placeholder="email@example.com"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                  className="flex-1 text-sm border border-gray-300 rounded px-3 py-1.5 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                />
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="text-sm border border-gray-300 rounded px-2 py-1.5 bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button
                  onClick={handleAdd}
                  disabled={saving || !newEmail.trim()}
                  className="px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                >
                  Add
                </button>
              </div>
            </div>
          </>
        )}

        {activeTab === 'P&L Defaults' && (
          <div className="flex-1 overflow-y-auto px-5 py-4">
            {loadingDefaults ? (
              <div className="text-center py-8 text-black font-medium">Loading defaults...</div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-gray-600">
                  Set the default version and comparison that all users see when loading the P&L. Versions are matched by name across all branches and departments.
                </p>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Default Version</label>
                  <select
                    value={defaultVersion}
                    onChange={(e) => setDefaultVersion(e.target.value)}
                    className="block w-full text-sm border border-gray-300 rounded px-3 py-2 bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">Working Draft (default)</option>
                    {versionNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Compare To</label>
                  <select
                    value={compareVersion}
                    onChange={(e) => setCompareVersion(e.target.value)}
                    className="block w-full text-sm border border-gray-300 rounded px-3 py-2 bg-white focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    <option value="">None (default)</option>
                    {versionNames.map((name) => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={handleSaveDefaults}
                    disabled={savingDefaults}
                    className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 disabled:opacity-40 transition-colors"
                  >
                    {savingDefaults ? 'Saving...' : 'Save Defaults'}
                  </button>
                  {defaultsSaved && (
                    <span className="text-sm text-green-600 font-medium">Saved</span>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
