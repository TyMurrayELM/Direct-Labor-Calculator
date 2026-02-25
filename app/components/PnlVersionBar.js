'use client';

import React, { useState, useEffect, useRef } from 'react';
import PnlImport from './PnlImport';
import BudgetImport from './BudgetImport';

/** Parse actual month count from version name: "1+11" → 1, "12+0" → 12, "Original Budget" → 0 */
function parseActualMonthsFromName(name) {
  const match = name.match(/^(\d{1,2})\+\d{1,2}$/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * Version controls bar rendered above the P&L table.
 */
const DEPARTMENT_LABELS = {
  maintenance: 'Maintenance',
  maintenance_onsite: 'Maintenance Onsite',
  maintenance_wo: 'Maintenance WO',
  arbor: 'Arbor',
  enhancements: 'Enhancements',
  spray: 'Spray',
  irrigation: 'Irrigation'
};

export default function PnlVersionBar({
  branchId,
  branchName,
  department,
  year,
  versions,
  selectedVersionId,
  onSelectVersion,
  referenceVersionId,
  onSelectReference,
  importInfo,
  onImportComplete,
  onVersionSaved,
  currentVersionLocked,
  onToggleLock,
  versionNote,
  onUpdateVersionNote,
  hasLineItems,
  onCopyStructure,
  readOnly = false,
  canDelete = false
}) {
  const [saving, setSaving] = useState(false);
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [versionName, setVersionName] = useState('');
  const [saveError, setSaveError] = useState(null);
  const [showFillDropdown, setShowFillDropdown] = useState(false);
  const [filling, setFilling] = useState(false);
  const [fillMessage, setFillMessage] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showNotePopover, setShowNotePopover] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [showCopyDropdown, setShowCopyDropdown] = useState(false);
  const [copying, setCopying] = useState(false);
  const [copyMessage, setCopyMessage] = useState(null);
  const fillDropdownRef = useRef(null);
  const noteRef = useRef(null);
  const copyDropdownRef = useRef(null);

  // Close Fill Forecast dropdown on click outside
  useEffect(() => {
    if (!showFillDropdown) return;
    const handleClickOutside = (e) => {
      if (fillDropdownRef.current && !fillDropdownRef.current.contains(e.target)) {
        setShowFillDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showFillDropdown]);

  // Close copy dropdown on click outside
  useEffect(() => {
    if (!showCopyDropdown) return;
    const handleClickOutside = (e) => {
      if (copyDropdownRef.current && !copyDropdownRef.current.contains(e.target)) {
        setShowCopyDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showCopyDropdown]);

  // Close note popover on click outside
  useEffect(() => {
    if (!showNotePopover) return;
    const handleClickOutside = (e) => {
      if (noteRef.current && !noteRef.current.contains(e.target)) {
        setShowNotePopover(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showNotePopover]);

  const VERSION_NAME_OPTIONS = [
    'Working Forecast',
    'Original Forecast',
    'Original Budget',
    '0+12',
    '1+11', '2+10', '3+9', '4+8', '5+7', '6+6',
    '7+5', '8+4', '9+3', '10+2', '11+1', '12+0',
  ];

  const suggestVersionName = () => {
    const actualCount = importInfo?.months_included?.length || 0;
    const forecastCount = 12 - actualCount;
    return actualCount > 0 ? `${actualCount}+${forecastCount}` : 'Original Budget';
  };

  const handleStartSave = () => {
    setVersionName(suggestVersionName());
    setShowSaveInput(true);
    setSaveError(null);
  };

  const handleSaveVersion = async () => {
    if (!versionName.trim()) return;

    setSaving(true);
    setSaveError(null);

    try {
      const res = await fetch('/api/pnl/save-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          department,
          year,
          versionName: versionName.trim(),
          actualMonths: parseActualMonthsFromName(versionName.trim()) ?? (importInfo?.months_included?.length || 0)
        })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      setShowSaveInput(false);
      setVersionName('');
      if (onVersionSaved) onVersionSaved();
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleToggleLock = () => {
    if (selectedVersionId && onToggleLock) {
      onToggleLock(selectedVersionId, !currentVersionLocked);
    }
  };

  const handleDeleteVersion = async () => {
    setDeleting(true);
    try {
      const res = await fetch('/api/pnl/delete-version', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId: selectedVersionId })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      setConfirmDelete(false);
      onSelectVersion(null); // Switch back to draft
      if (onVersionSaved) onVersionSaved(); // Refresh version list
    } catch (err) {
      setSaveError(err.message);
    } finally {
      setDeleting(false);
    }
  };

  const handleFillForecast = async (sourceVersionId) => {
    setShowFillDropdown(false);
    setFilling(true);
    setFillMessage(null);

    try {
      const res = await fetch('/api/pnl/fill-forecast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          department,
          year,
          sourceVersionId,
          targetVersionId: selectedVersionId || undefined
        })
      });

      const result = await res.json();
      if (!result.success) throw new Error(result.error);

      const parts = [`Updated ${result.updatedCount} rows`];
      if (result.insertedCount) parts.push(`added ${result.insertedCount} new`);
      setFillMessage(parts.join(', '));
      setTimeout(() => setFillMessage(null), 4000);
      if (onImportComplete) onImportComplete();
    } catch (err) {
      setFillMessage(`Error: ${err.message}`);
      setTimeout(() => setFillMessage(null), 5000);
    } finally {
      setFilling(false);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
    });
  };

  return (
    <div className="bg-white border border-gray-200 rounded-lg px-4 py-3 mb-4 relative z-40">
      <div className="flex flex-wrap items-center gap-3">
        {/* Version selector */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Version:</label>
          <select
            value={selectedVersionId || ''}
            onChange={(e) => { setConfirmDelete(false); onSelectVersion(e.target.value ? parseInt(e.target.value) : null); }}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">Working Draft</option>
            {versions.map(v => (
              <option key={v.id} value={v.id}>
                {v.version_name} {v.is_locked ? '(Locked)' : ''} — {formatDate(v.created_at)}
              </option>
            ))}
          </select>
        </div>

        {/* Version note — only for saved versions, not in readOnly mode */}
        {!readOnly && selectedVersionId !== null && onUpdateVersionNote && (
          <div className="relative" ref={noteRef}>
            <button
              onClick={() => { setNoteText(versionNote || ''); setShowNotePopover(!showNotePopover); }}
              className={`px-2 py-1.5 rounded-md text-sm flex items-center gap-1 border ${
                versionNote
                  ? 'bg-amber-50 text-amber-700 border-amber-300 hover:bg-amber-100'
                  : 'bg-gray-50 text-gray-500 border-gray-300 hover:bg-gray-100'
              }`}
              title={versionNote || 'Add version note'}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 13V5a2 2 0 00-2-2H4a2 2 0 00-2 2v8a2 2 0 002 2h3l3 3 3-3h3a2 2 0 002-2zM5 7a1 1 0 011-1h8a1 1 0 110 2H6a1 1 0 01-1-1zm1 3a1 1 0 100 2h3a1 1 0 100-2H6z" clipRule="evenodd" />
              </svg>
              {versionNote ? 'Note' : ''}
            </button>
            {showNotePopover && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-lg shadow-lg z-20 p-3" style={{ width: '280px' }}>
                <div className="text-xs font-semibold text-gray-700 mb-2">Version Note</div>
                <textarea
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      onUpdateVersionNote(selectedVersionId, noteText || null);
                      setShowNotePopover(false);
                    }
                    if (e.key === 'Escape') setShowNotePopover(false);
                  }}
                  autoFocus
                  placeholder="Add a note about this version..."
                  rows={3}
                  disabled={currentVersionLocked}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-xs resize-none focus:outline-none focus:ring-1 focus:ring-amber-500 focus:border-amber-500 disabled:bg-gray-100"
                />
                <div className="flex gap-2 mt-2">
                  {!currentVersionLocked && (
                    <button
                      onClick={() => { onUpdateVersionNote(selectedVersionId, noteText || null); setShowNotePopover(false); }}
                      className="flex-1 px-3 py-1.5 bg-amber-500 text-white rounded text-xs font-medium hover:bg-amber-600"
                    >
                      Save
                    </button>
                  )}
                  {!currentVersionLocked && noteText && (
                    <button
                      onClick={() => { onUpdateVersionNote(selectedVersionId, null); setNoteText(''); setShowNotePopover(false); }}
                      className="px-3 py-1.5 bg-gray-200 text-gray-700 rounded text-xs font-medium hover:bg-gray-300"
                    >
                      Clear
                    </button>
                  )}
                  <button
                    onClick={() => setShowNotePopover(false)}
                    className="px-3 py-1.5 text-gray-500 hover:text-gray-700 text-xs"
                  >
                    {currentVersionLocked ? 'Close' : 'Cancel'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Save version — only when viewing draft, not in readOnly mode */}
        {!readOnly && selectedVersionId === null && (
          <>
            {showSaveInput ? (
              <div className="flex items-center gap-2">
                <select
                  value={versionName}
                  onChange={(e) => setVersionName(e.target.value)}
                  autoFocus
                  className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  {VERSION_NAME_OPTIONS.map(name => (
                    <option key={name} value={name}>{name}</option>
                  ))}
                </select>
                <button
                  onClick={handleSaveVersion}
                  disabled={saving || !versionName.trim()}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-md text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                >
                  {saving ? 'Saving...' : 'Save'}
                </button>
                <button
                  onClick={() => setShowSaveInput(false)}
                  className="px-2 py-1.5 text-gray-500 hover:text-gray-700 text-sm"
                >
                  Cancel
                </button>
                {saveError && <span className="text-xs text-red-600">{saveError}</span>}
              </div>
            ) : (
              <button
                onClick={handleStartSave}
                className="px-3 py-1.5 bg-emerald-600 text-white rounded-md text-sm font-medium hover:bg-emerald-700 flex items-center gap-1.5"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                  <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
                </svg>
                Save Version
              </button>
            )}
          </>
        )}

        {/* Lock toggle + Delete — only for saved versions, not in readOnly mode */}
        {!readOnly && selectedVersionId !== null && (
          <>
            {/* Lock toggle — admins only (onToggleLock is undefined for non-admins) */}
            {onToggleLock && (() => {
              const selectedVersion = versions.find(v => v.id === selectedVersionId);
              const lockedAt = selectedVersion?.locked_at;
              const lockTitle = currentVersionLocked && lockedAt
                ? `Locked ${formatDate(lockedAt)}`
                : currentVersionLocked ? 'Locked' : 'Click to lock';
              return (
              <button
                onClick={handleToggleLock}
                title={lockTitle}
                className={`px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 border ${
                  currentVersionLocked
                    ? 'bg-red-50 text-red-700 border-red-300 hover:bg-red-100'
                    : 'bg-gray-50 text-gray-700 border-gray-300 hover:bg-gray-100'
                }`}
              >
                {currentVersionLocked ? (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                    </svg>
                    Locked
                  </>
                ) : (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                      <path d="M10 2a5 5 0 00-5 5v2a2 2 0 00-2 2v5a2 2 0 002 2h10a2 2 0 002-2v-5a2 2 0 00-2-2H7V7a3 3 0 015.905-.75 1 1 0 001.937-.5A5.002 5.002 0 0010 2z" />
                    </svg>
                    Unlocked
                  </>
                )}
              </button>
              ); })()}

            {/* Delete version — admin only, unlocked only */}
            {!currentVersionLocked && canDelete && (
              confirmDelete ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-600 font-medium">Delete this version?</span>
                  <button
                    onClick={handleDeleteVersion}
                    disabled={deleting}
                    className="px-2 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                  >
                    {deleting ? 'Deleting...' : 'Yes, delete'}
                  </button>
                  <button
                    onClick={() => setConfirmDelete(false)}
                    className="px-2 py-1 text-gray-500 hover:text-gray-700 text-xs"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmDelete(true)}
                  className="px-3 py-1.5 rounded-md text-sm font-medium flex items-center gap-1.5 border border-red-300 text-red-600 hover:bg-red-50"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" />
                  </svg>
                  Delete
                </button>
              )
            )}
          </>
        )}

        <div className="w-px h-6 bg-gray-300 mx-1"></div>

        {/* Compare to dropdown */}
        <div className="flex items-center gap-2">
          <label className="text-sm font-medium text-gray-700">Compare to:</label>
          <select
            value={referenceVersionId || ''}
            onChange={(e) => onSelectReference(e.target.value ? (e.target.value === 'draft' ? 'draft' : parseInt(e.target.value)) : null)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          >
            <option value="">None</option>
            {selectedVersionId === null && versions.map(v => (
              <option key={v.id} value={v.id}>{v.version_name}</option>
            ))}
            {selectedVersionId !== null && (
              <>
                <option value="draft">Working Draft</option>
                {versions.filter(v => v.id !== selectedVersionId).map(v => (
                  <option key={v.id} value={v.id}>{v.version_name}</option>
                ))}
              </>
            )}
          </select>
        </div>

        <div className="w-px h-6 bg-gray-300 mx-1"></div>

        {/* Import buttons — draft or unlocked saved versions, not in readOnly mode */}
        {!readOnly && !currentVersionLocked && (
          <>
            <PnlImport
              branchId={branchId}
              department={department}
              year={year}
              onImportComplete={onImportComplete}
              hasExistingImport={hasLineItems}
              versionId={selectedVersionId}
            />
            {selectedVersionId === null && (
              <BudgetImport
                branchId={branchId}
                branchName={branchName}
                department={department}
                year={year}
                onImportComplete={onImportComplete}
              />
            )}
          </>
        )}

        {/* Fill Forecast — draft or unlocked saved versions, not in readOnly mode */}
        {!readOnly && !currentVersionLocked && versions.filter(v => v.id !== selectedVersionId).length > 0 && (
          <div className="relative" ref={fillDropdownRef}>
            <button
              onClick={() => setShowFillDropdown(!showFillDropdown)}
              disabled={filling}
              className="px-3 py-1.5 bg-amber-500 text-white rounded-md text-sm font-medium hover:bg-amber-600 disabled:opacity-50 flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
              </svg>
              {filling ? 'Filling...' : 'Fill Forecast'}
            </button>
            {showFillDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[200px]">
                <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                  Copy forecast months from:
                </div>
                {versions.filter(v => v.id !== selectedVersionId).map(v => (
                  <button
                    key={v.id}
                    onClick={() => handleFillForecast(v.id)}
                    className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-amber-50 hover:text-amber-800"
                  >
                    {v.version_name}
                  </button>
                ))}
              </div>
            )}
            {fillMessage && (
              <span className={`absolute top-full left-0 mt-1 text-xs whitespace-nowrap ${fillMessage.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>
                {fillMessage}
              </span>
            )}
          </div>
        )}

        {/* Copy Structure — draft only, not in readOnly mode */}
        {!readOnly && selectedVersionId === null && onCopyStructure && (
          <div className="relative" ref={copyDropdownRef}>
            <button
              onClick={() => setShowCopyDropdown(!showCopyDropdown)}
              disabled={copying}
              className="px-3 py-1.5 bg-indigo-500 text-white rounded-md text-sm font-medium hover:bg-indigo-600 disabled:opacity-50 flex items-center gap-1.5"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                <path d="M7 9a2 2 0 012-2h6a2 2 0 012 2v6a2 2 0 01-2 2H9a2 2 0 01-2-2V9z" />
                <path d="M5 3a2 2 0 00-2 2v6a2 2 0 002 2V5h8a2 2 0 00-2-2H5z" />
              </svg>
              {copying ? 'Copying...' : 'Copy Structure'}
            </button>
            {showCopyDropdown && (
              <div className="absolute top-full left-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg z-10 min-w-[200px]">
                <div className="px-3 py-2 text-xs text-gray-500 border-b border-gray-100">
                  Copy account structure from:
                </div>
                {Object.entries(DEPARTMENT_LABELS)
                  .filter(([key]) => key !== department)
                  .map(([key, label]) => (
                    <button
                      key={key}
                      onClick={async () => {
                        if (hasLineItems && !window.confirm('This will replace all existing draft rows. Continue?')) return;
                        setShowCopyDropdown(false);
                        setCopying(true);
                        setCopyMessage(null);
                        try {
                          await onCopyStructure(key);
                          setCopyMessage(`Copied from ${label}`);
                          setTimeout(() => setCopyMessage(null), 3000);
                        } catch (err) {
                          setCopyMessage(`Error: ${err.message}`);
                          setTimeout(() => setCopyMessage(null), 5000);
                        } finally {
                          setCopying(false);
                        }
                      }}
                      className="block w-full text-left px-3 py-2 text-sm text-gray-700 hover:bg-indigo-50 hover:text-indigo-800"
                    >
                      {label}
                    </button>
                  ))}
              </div>
            )}
            {copyMessage && (
              <span className={`absolute top-full left-0 mt-1 text-xs whitespace-nowrap ${copyMessage.startsWith('Error') ? 'text-red-600' : 'text-emerald-600'}`}>
                {copyMessage}
              </span>
            )}
          </div>
        )}

        {/* Import info */}
        {importInfo && (
          <div className="text-xs text-gray-500 ml-auto">
            <span className="font-medium">{importInfo.file_name}</span>
            {' \u00b7 '}
            Imported {formatDate(importInfo.imported_at)}
          </div>
        )}
      </div>
    </div>
  );
}
