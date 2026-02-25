import * as XLSX from 'xlsx';

const MONTH_KEYS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/**
 * Parse a cell value into a numeric amount.
 * Handles numbers, strings with $, commas, and parenthesized negatives.
 */
function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val * 100) / 100;
  let str = String(val).trim();
  const isNeg = str.startsWith('(') && str.endsWith(')');
  str = str.replace(/[($,)]/g, '').trim();
  if (!str || str === '-') return 0;
  const num = parseFloat(str);
  if (isNaN(num)) return 0;
  return Math.round((isNeg ? -num : num) * 100) / 100;
}

/**
 * Normalize account code by stripping trailing zeros from each segment.
 * "6152.10" → "6152.1", "5050.2.03" → "5050.2.3"
 */
function normalizeAccountCode(code) {
  if (!code) return code;
  return code.split('.').map((seg, i) => i === 0 ? seg : String(parseFloat(seg))).join('.');
}

/**
 * Compute indent level from account code dot segments.
 * "5050" → 1, "5050.2" → 2, "5050.2.1" → 3
 */
function getIndentFromCode(code) {
  if (!code) return 0;
  return code.split('.').length;
}

/**
 * Parse a planning sheet (COGS or OpEx) from an Excel ArrayBuffer.
 * Auto-detects type from the sheet name.
 *
 * Layout: Header row has "Account#" in col 1. Detail rows have an account
 * code in col 1 and account name in col 5. Monthly values in cols 9-20 (Jan-Dec).
 *
 * @param {ArrayBuffer} arrayBuffer
 * @param {string} [branchFilter] - Optional branch name to filter rows (e.g. "Las Vegas").
 *   Matched against column C (index 2) which contains values like "8 - Las Vegas".
 * @returns {{ type: 'cogs'|'opex', accounts: Array<{ account_code: string, account_name: string, jan: number, ..., dec: number }> }}
 */
export function parsePlanningSheet(arrayBuffer, branchFilter) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Auto-detect type from sheet name
  const nameLower = sheetName.toLowerCase();
  let type;
  if (nameLower.includes('revenue') || nameLower.includes('income')) {
    type = 'revenue';
  } else if (nameLower.includes('cogs') || nameLower.includes('cost')) {
    type = 'cogs';
  } else if (nameLower.includes('opex') || nameLower.includes('operating') || nameLower.includes('expense')) {
    type = 'opex';
  } else {
    // Fallback: check file for clues in first few rows
    type = 'opex';
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
      const rowText = (rows[i] || []).join(' ').toLowerCase();
      if (rowText.includes('revenue') || rowText.includes('income')) {
        type = 'revenue';
        break;
      } else if (rowText.includes('cogs') || rowText.includes('cost of sales')) {
        type = 'cogs';
        break;
      }
    }
  }

  // Find header row by scanning for "Account#" in column B (index 1)
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cell = String(rows[i]?.[1] || '').trim().toLowerCase();
    if (cell === 'account#' || cell === 'account #' || cell === 'account') {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error(`Could not find "Account#" header row in the ${type.toUpperCase()} spreadsheet`);
  }

  // Data starts on the row after the header
  const dataStartIdx = headerRowIdx + 1;

  // Normalize branch filter for fuzzy matching against col 2 ("8 - Las Vegas")
  // Handle abbreviations: "Phx" → "Phoenix", "LV" → "Las Vegas"
  const normalizeBranch = (s) => s.toLowerCase().trim()
    .replace(/\bphx\b/g, 'phoenix')
    .replace(/\blv\b/g, 'las vegas');
  const branchFilterLower = branchFilter ? normalizeBranch(branchFilter) : null;

  console.log(`[parsePlanningSheet] type=${type}, headerRow=${headerRowIdx}, totalRows=${rows.length}, branchFilter="${branchFilterLower}"`);
  // Log unique branch values in col C for debugging
  const branchValues = new Set();
  for (let i = dataStartIdx; i < Math.min(rows.length, dataStartIdx + 50); i++) {
    const v = String(rows[i]?.[2] || '').trim();
    if (v) branchValues.add(v);
  }
  console.log('[parsePlanningSheet] Branch values in col C (sample):', Array.from(branchValues));

  // Use a Map to deduplicate by account code — same account may appear
  // for multiple divisions within the same branch; sum their values.
  const accountMap = new Map();

  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i];

    // Detail rows have a branch number in col 0 AND an account code in col 1.
    // XLSX may parse codes like "5000.3" as a number, so convert to string first.
    const col0 = row[0];
    const col1raw = row[1];
    if (col0 === null || col0 === undefined || col0 === '') continue;
    if (col1raw === null || col1raw === undefined || col1raw === '') continue;

    const col1 = String(col1raw).trim();

    // Account codes look like "5050.2.1", "5101.03", or "5000.3"
    if (!col1.match(/^\d{4}(\.\d+)*$/)) continue;

    // Filter by branch name if provided (col 2 contains e.g. "8 - Las Vegas")
    if (branchFilterLower) {
      const branchCol = normalizeBranch(String(row[2] || ''));
      if (!branchCol.includes(branchFilterLower)) continue;
    }

    // Skip rollup/summary rows where Class (col 4) is "All Classifications"
    const classCol = String(row[4] || '').toLowerCase().trim();
    if (classCol === 'all classifications') continue;

    const accountCode = normalizeAccountCode(col1);
    const accountName = String(row[5] || '').trim(); // Column F (index 5)

    // Skip rows with no account name
    if (!accountName) continue;

    // Month values in columns J-U (index 9-20), Jan-Dec
    const monthValues = {};
    for (let m = 0; m < 12; m++) {
      monthValues[MONTH_KEYS[m]] = parseAmount(row[9 + m]);
    }

    // Deduplicate: sum values if same account code appears multiple times (e.g. different divisions)
    if (accountMap.has(accountCode)) {
      const existing = accountMap.get(accountCode);
      for (const mk of MONTH_KEYS) {
        existing[mk] = (existing[mk] || 0) + (monthValues[mk] || 0);
      }
    } else {
      accountMap.set(accountCode, {
        account_code: accountCode,
        account_name: accountName,
        ...monthValues
      });
    }
  }

  return { type, accounts: Array.from(accountMap.values()) };
}

/**
 * Build a unified P&L line-items array from parsed Revenue, COGS, and OpEx accounts.
 * Produces section_header, detail, and total rows matching the format
 * expected by the existing /api/pnl/import endpoint.
 *
 * @param {Array} cogsAccounts - From parsePlanningSheet (COGS file)
 * @param {Array} opexAccounts - From parsePlanningSheet (OpEx file)
 * @param {Array} revenueAccounts - From parsePlanningSheet (Revenue file)
 * @returns {Array<object>} lineItems ready for API submission
 */
export function buildBudgetLineItems(cogsAccounts = [], opexAccounts = [], revenueAccounts = []) {
  const lineItems = [];
  let rowOrder = 0;

  const zeroMonths = () => ({ jan: 0, feb: 0, mar: 0, apr: 0, may: 0, jun: 0, jul: 0, aug: 0, sep: 0, oct: 0, nov: 0, dec: 0 });

  // Helper: add a section with header, detail rows, and total. Returns section totals.
  function addSection(sectionName, accounts) {
    const totals = zeroMonths();
    if (accounts.length === 0) return totals;

    // Section header
    lineItems.push({
      row_order: rowOrder++,
      account_code: null,
      account_name: sectionName,
      full_label: sectionName,
      row_type: 'section_header',
      indent_level: 0,
      ...zeroMonths()
    });

    // Detail rows
    for (const acct of accounts) {
      const indent = getIndentFromCode(acct.account_code);

      lineItems.push({
        row_order: rowOrder++,
        account_code: acct.account_code,
        account_name: acct.account_name,
        full_label: `${acct.account_code} - ${acct.account_name}`,
        row_type: 'detail',
        indent_level: indent,
        ...MONTH_KEYS.reduce((obj, mk) => {
          obj[mk] = acct[mk] || 0;
          totals[mk] += acct[mk] || 0;
          return obj;
        }, {})
      });
    }

    // Section total
    const totalLabel = `Total ${sectionName}`;
    lineItems.push({
      row_order: rowOrder++,
      account_code: null,
      account_name: totalLabel,
      full_label: totalLabel,
      row_type: 'total',
      indent_level: 0,
      ...totals
    });

    return totals;
  }

  const incomeTotals = addSection('Income', revenueAccounts);
  const cogsTotals = addSection('Cost Of Sales', cogsAccounts);

  // Gross Profit = Income - COGS
  if (revenueAccounts.length > 0 || cogsAccounts.length > 0) {
    const gp = zeroMonths();
    for (const mk of MONTH_KEYS) {
      gp[mk] = Math.round(((incomeTotals[mk] || 0) - (cogsTotals[mk] || 0)) * 100) / 100;
    }
    lineItems.push({
      row_order: rowOrder++,
      account_code: null,
      account_name: 'Gross Profit',
      full_label: 'Gross Profit',
      row_type: 'calculated',
      indent_level: 0,
      ...gp
    });

    // Gross Profit % = (Gross Profit / Income) * 100
    const gpPct = zeroMonths();
    for (const mk of MONTH_KEYS) {
      gpPct[mk] = incomeTotals[mk] !== 0
        ? Math.round(((gp[mk] / incomeTotals[mk]) * 100) * 10) / 10
        : 0;
    }
    lineItems.push({
      row_order: rowOrder++,
      account_code: null,
      account_name: 'Gross Profit %',
      full_label: 'Gross Profit %',
      row_type: 'percent',
      indent_level: 0,
      ...gpPct
    });
  }

  const expenseTotals = addSection('Expense', opexAccounts);

  // Net Operating Income = Income - COGS - Expenses
  if (revenueAccounts.length > 0 || cogsAccounts.length > 0 || opexAccounts.length > 0) {
    const noi = zeroMonths();
    for (const mk of MONTH_KEYS) {
      noi[mk] = Math.round(((incomeTotals[mk] || 0) - (cogsTotals[mk] || 0) - (expenseTotals[mk] || 0)) * 100) / 100;
    }
    lineItems.push({
      row_order: rowOrder++,
      account_code: null,
      account_name: 'Net Operating Income',
      full_label: 'Net Operating Income',
      row_type: 'calculated',
      indent_level: 0,
      ...noi
    });

    // Net Income = Net Operating Income (same when no Other Income/Expense sections)
    lineItems.push({
      row_order: rowOrder++,
      account_code: null,
      account_name: 'Net Income',
      full_label: 'Net Income',
      row_type: 'calculated',
      indent_level: 0,
      ...noi
    });
  }

  return lineItems;
}
