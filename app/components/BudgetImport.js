'use client';

import React, { useRef, useState } from 'react';
import { parsePlanningSheet, buildBudgetLineItems } from '../../lib/parsePlanningXls';

/**
 * Budget Import — upload COGS and/or OpEx planning Excel files.
 * Parses both files, merges into unified P&L line items, and POSTs to existing import API.
 */
export default function BudgetImport({ branchId, branchName, department, year, onImportComplete }) {
  const [open, setOpen] = useState(false);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState(null);
  const revenueInputRef = useRef(null);
  const cogsInputRef = useRef(null);
  const opexInputRef = useRef(null);
  const [files, setFiles] = useState({ revenue: null, cogs: null, opex: null });
  const [dragOver, setDragOver] = useState({ revenue: false, cogs: false, opex: false });

  const setFile = (key, file) => {
    if (file && (file.name.endsWith('.xls') || file.name.endsWith('.xlsx'))) {
      setFiles(prev => ({ ...prev, [key]: file }));
    }
  };

  const handleDrop = (key) => (e) => {
    e.preventDefault();
    setDragOver(prev => ({ ...prev, [key]: false }));
    const file = e.dataTransfer.files?.[0];
    setFile(key, file);
  };

  const handleDragOver = (key) => (e) => {
    e.preventDefault();
    setDragOver(prev => ({ ...prev, [key]: true }));
  };

  const handleDragLeave = (key) => (e) => {
    e.preventDefault();
    setDragOver(prev => ({ ...prev, [key]: false }));
  };

  const handleFileChange = (key) => (e) => {
    const file = e.target.files?.[0];
    setFile(key, file);
    // Reset input so same file can be re-selected
    if (e.target) e.target.value = '';
  };

  const handleImport = async () => {
    const revenueFile = files.revenue;
    const cogsFile = files.cogs;
    const opexFile = files.opex;

    console.log('Budget import — files state:', {
      revenue: revenueFile?.name || null,
      cogs: cogsFile?.name || null,
      opex: opexFile?.name || null,
      branchName
    });

    if (!revenueFile && !cogsFile && !opexFile) {
      setMessage({ type: 'error', text: 'Upload at least one file' });
      return;
    }

    setImporting(true);
    setMessage(null);

    try {
      let revenueAccounts = [];
      let cogsAccounts = [];
      let opexAccounts = [];

      console.log('Budget import — branch filter:', branchName);

      if (revenueFile) {
        const buf = await revenueFile.arrayBuffer();
        console.log('Revenue file size:', buf.byteLength, 'bytes');
        const parsed = parsePlanningSheet(buf, branchName);
        console.log('Revenue parsed:', parsed.type, parsed.accounts.length, 'accounts');
        if (parsed.type === 'revenue') {
          revenueAccounts = parsed.accounts;
        } else if (parsed.type === 'cogs') {
          cogsAccounts = parsed.accounts;
        } else {
          opexAccounts = parsed.accounts;
        }
      }

      if (cogsFile) {
        const buf = await cogsFile.arrayBuffer();
        console.log('COGS file size:', buf.byteLength, 'bytes');
        const parsed = parsePlanningSheet(buf, branchName);
        console.log('COGS parsed:', parsed.type, parsed.accounts.length, 'accounts');
        if (parsed.type === 'cogs') {
          cogsAccounts = parsed.accounts;
        } else if (parsed.type === 'revenue') {
          revenueAccounts = parsed.accounts;
        } else {
          opexAccounts = parsed.accounts;
        }
      }

      if (opexFile) {
        const buf = await opexFile.arrayBuffer();
        console.log('OpEx file size:', buf.byteLength, 'bytes');
        const parsed = parsePlanningSheet(buf, branchName);
        console.log('OpEx parsed:', parsed.type, parsed.accounts.length, 'accounts');
        if (parsed.type === 'opex') {
          opexAccounts = parsed.accounts;
        } else if (parsed.type === 'revenue') {
          revenueAccounts = parsed.accounts;
        } else {
          cogsAccounts = parsed.accounts;
        }
      }

      console.log('Totals — revenue:', revenueAccounts.length, 'cogs:', cogsAccounts.length, 'opex:', opexAccounts.length);

      const lineItems = buildBudgetLineItems(cogsAccounts, opexAccounts, revenueAccounts);

      if (lineItems.length === 0) {
        throw new Error('No accounts found in the uploaded file(s). Check that the branch name matches column C in the spreadsheet.');
      }

      // Build file name from uploaded files
      const uploadedNames = [revenueFile?.name, cogsFile?.name, opexFile?.name].filter(Boolean).join(' + ');

      const res = await fetch('/api/pnl/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          department,
          year,
          fileName: uploadedNames,
          months: [],
          lineItems
        })
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || 'Import failed');
      }

      setMessage({ type: 'success', text: `Imported ${result.rowCount} budget rows` });
      setOpen(false);
      setFiles({ revenue: null, cogs: null, opex: null });

      if (onImportComplete) onImportComplete();
    } catch (err) {
      console.error('Budget import error:', err);
      setMessage({ type: 'error', text: err.message });
    } finally {
      setImporting(false);
    }
  };

  const dropZone = (key, label, inputRef) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <div
        onDrop={handleDrop(key)}
        onDragOver={handleDragOver(key)}
        onDragLeave={handleDragLeave(key)}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed rounded-md px-3 py-2 text-center cursor-pointer transition-colors ${
          dragOver[key]
            ? 'border-teal-500 bg-teal-50'
            : files[key]
              ? 'border-teal-300 bg-teal-50/50'
              : 'border-gray-300 hover:border-teal-400 hover:bg-gray-50'
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept=".xls,.xlsx"
          onChange={handleFileChange(key)}
          className="hidden"
        />
        {files[key] ? (
          <span className="text-xs text-teal-700 font-medium">{files[key].name}</span>
        ) : (
          <span className="text-xs text-gray-400">Drop file or click to browse</span>
        )}
      </div>
    </div>
  );

  return (
    <div className="relative inline-flex items-center gap-2">
      <button
        onClick={() => { setOpen(!open); setMessage(null); }}
        disabled={importing || !branchId}
        className={`px-3 py-1.5 bg-white text-teal-700 border border-teal-600 rounded-lg hover:bg-teal-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5 ${
          importing ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        {importing ? (
          <>
            <div className="w-3 h-3 border-2 border-teal-400 border-t-transparent rounded-full animate-spin"></div>
            <span>Importing...</span>
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span>Import Budget</span>
          </>
        )}
      </button>

      {open && (
        <div className="absolute top-full left-0 mt-1 z-50 bg-white border border-gray-200 rounded-lg shadow-lg p-4 w-80">
          <div className="space-y-3">
            {dropZone('revenue', 'Revenue Planning File', revenueInputRef)}
            {dropZone('cogs', 'COGS Planning File', cogsInputRef)}
            {dropZone('opex', 'OpEx Planning File', opexInputRef)}
            <div className="flex items-center gap-2">
              <button
                onClick={handleImport}
                disabled={importing}
                className="px-3 py-1.5 bg-teal-600 text-white rounded-md text-sm font-medium hover:bg-teal-700 disabled:opacity-50"
              >
                {importing ? 'Importing...' : 'Import'}
              </button>
              <button
                onClick={() => { setOpen(false); setMessage(null); }}
                className="px-2 py-1.5 text-gray-500 hover:text-gray-700 text-sm"
              >
                Cancel
              </button>
            </div>
            {message && (
              <p className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
                {message.text}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Show message when dropdown is closed too */}
      {!open && message && (
        <span className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {message.text}
        </span>
      )}
    </div>
  );
}
