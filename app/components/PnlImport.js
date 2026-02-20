'use client';

import React, { useRef, useState } from 'react';
import { parsePnlXls } from '../../lib/parsePnlXls';

/**
 * P&L Import button — upload NetSuite Income Statement XLS
 * @param {{ branchId: number, department: string, year: number, onImportComplete: function }} props
 */
export default function PnlImport({ branchId, department, year, onImportComplete, hasExistingImport, versionId }) {
  const fileInputRef = useRef(null);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState(null);

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setImporting(true);
    setMessage(null);

    try {
      // Read the file
      const arrayBuffer = await file.arrayBuffer();

      // Parse the XLS
      const { year: parsedYear, months, lineItems } = parsePnlXls(arrayBuffer);

      // POST to API
      const res = await fetch('/api/pnl/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          department,
          year: year || parsedYear,
          fileName: file.name,
          months,
          lineItems,
          versionId: versionId || undefined
        })
      });

      const result = await res.json();

      if (!result.success) {
        throw new Error(result.error || 'Import failed');
      }

      setMessage({
        type: 'success',
        text: result.forecastPreserved > 0
          ? `Updated actuals (forecast preserved)`
          : `Imported ${result.rowCount} rows`
      });

      if (onImportComplete) {
        onImportComplete();
      }
    } catch (err) {
      console.error('P&L import error:', err);
      setMessage({ type: 'error', text: err.message });
    } finally {
      setImporting(false);
      // Reset the input so the same file can be re-imported
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  return (
    <div className="inline-flex items-center gap-2">
      <input
        ref={fileInputRef}
        type="file"
        accept=".xls,.xlsx"
        onChange={handleFileChange}
        className="hidden"
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing || !branchId}
        className={`px-3 py-1.5 bg-white text-violet-700 border border-violet-600 rounded-lg hover:bg-violet-50 transition-colors shadow-sm text-sm font-medium flex items-center space-x-1.5 ${
          importing ? 'opacity-60 cursor-not-allowed' : ''
        }`}
      >
        {importing ? (
          <>
            <div className="w-3 h-3 border-2 border-violet-400 border-t-transparent rounded-full animate-spin"></div>
            <span>Importing...</span>
          </>
        ) : (
          <>
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
            <span>{hasExistingImport ? 'Update Actuals' : 'Import P&L'}</span>
          </>
        )}
      </button>
      {message && (
        <span className={`text-xs ${message.type === 'success' ? 'text-green-600' : 'text-red-600'}`}>
          {message.text}
        </span>
      )}
    </div>
  );
}
