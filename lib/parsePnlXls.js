import * as XLSX from 'xlsx';

const MONTH_MAP = {
  'Jan': 'jan', 'Feb': 'feb', 'Mar': 'mar', 'Apr': 'apr',
  'May': 'may', 'Jun': 'jun', 'Jul': 'jul', 'Aug': 'aug',
  'Sep': 'sep', 'Oct': 'oct', 'Nov': 'nov', 'Dec': 'dec',
  'January': 'jan', 'February': 'feb', 'March': 'mar', 'April': 'apr',
  'June': 'jun', 'July': 'jul', 'August': 'aug',
  'September': 'sep', 'October': 'oct', 'November': 'nov', 'December': 'dec'
};

const CALCULATED_ROWS = new Set([
  'gross profit', 'net ordinary income', 'net operating income', 'net income', 'net other income',
  'total income', 'total cost of sales', 'total expense',
  'total other income', 'total other expense'
]);

/** Rename legacy labels on import */
const LABEL_RENAMES = {
  'Net Ordinary Income': 'Net Operating Income'
};

/**
 * Parse a NetSuite P&L (Income Statement) XLS export
 * @param {ArrayBuffer} arrayBuffer - The file contents
 * @returns {{ year: number, months: string[], lineItems: object[] }}
 */
export function parsePnlXls(arrayBuffer) {
  const workbook = XLSX.read(arrayBuffer, { type: 'array' });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  // Find the header row containing "Financial Row"
  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const firstCell = String(rows[i]?.[0] || '').trim();
    if (firstCell.toLowerCase().includes('financial row')) {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error('Could not find "Financial Row" header row in the spreadsheet');
  }

  const headerRow = rows[headerRowIdx];

  // Extract year from the period info rows (rows 0-5) or from month headers
  let year = null;
  // Check header cells for "Mon YYYY" pattern
  for (let c = 1; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').trim();
    const match = cell.match(/\b(20\d{2})\b/);
    if (match) {
      year = parseInt(match[1]);
      break;
    }
  }
  // Fallback: check the first few rows for a year
  if (!year) {
    for (let i = 0; i < headerRowIdx; i++) {
      const rowText = (rows[i] || []).join(' ');
      const match = rowText.match(/\b(20\d{2})\b/);
      if (match) {
        year = parseInt(match[1]);
        break;
      }
    }
  }
  if (!year) {
    year = new Date().getFullYear();
  }

  // Map column indices to month keys
  const monthColumns = []; // { colIdx, monthKey, monthLabel }
  for (let c = 1; c < headerRow.length; c++) {
    const cell = String(headerRow[c] || '').trim();
    // Skip "Total" column
    if (cell.toLowerCase() === 'total') continue;
    // Extract month name — "Jan 2026" → "Jan", or just "Jan"
    const monthName = cell.split(/\s+/)[0];
    const monthKey = MONTH_MAP[monthName];
    if (monthKey) {
      monthColumns.push({ colIdx: c, monthKey, monthLabel: monthName.substring(0, 3) });
    }
  }

  // Fallback for single-month exports: header columns may be branch names
  // (e.g., "Las Vegas") instead of month names. Check pre-header rows for "Mon YYYY".
  if (monthColumns.length === 0) {
    for (let i = 0; i < headerRowIdx; i++) {
      const cellText = String(rows[i]?.[0] || '').trim();
      const monthMatch = cellText.match(/^(\w+)\s+20\d{2}$/);
      if (monthMatch) {
        const monthName = monthMatch[1];
        const monthKey = MONTH_MAP[monthName];
        if (monthKey) {
          // Map each non-"Total" data column to this single month
          for (let c = 1; c < headerRow.length; c++) {
            const hdr = String(headerRow[c] || '').trim().toLowerCase();
            if (hdr && hdr !== 'total') {
              monthColumns.push({ colIdx: c, monthKey, monthLabel: monthName.substring(0, 3) });
            }
          }
          break;
        }
      }
    }
  }

  // Skip the "Amount" subheader row (headerRowIdx + 1)
  const dataStartIdx = headerRowIdx + 2;

  const lineItems = [];
  let rowOrder = 0;

  // Track which months have any non-zero values across all rows
  const monthsWithData = new Set();

  for (let i = dataStartIdx; i < rows.length; i++) {
    const row = rows[i];
    const rawLabel = String(row[0] || '').trim();
    if (!rawLabel) continue;

    // Extract amounts for each month
    const amounts = {};
    let hasAnyAmount = false;
    for (const { colIdx, monthKey } of monthColumns) {
      const val = parseAmount(row[colIdx]);
      amounts[monthKey] = val;
      if (val !== 0) {
        hasAnyAmount = true;
        monthsWithData.add(monthKey);
      }
    }

    // Classify the row
    const { rowType, accountCode, accountName, indentLevel } = classifyRow(rawLabel, hasAnyAmount);

    lineItems.push({
      row_order: rowOrder++,
      account_code: accountCode,
      account_name: accountName,
      full_label: rawLabel,
      row_type: rowType,
      indent_level: indentLevel,
      ...amounts
    });
  }

  // Inject Gross Profit % row after Gross Profit (if both GP and Income total exist)
  const ALL_MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const gpIdx = lineItems.findIndex(li =>
    li.row_type === 'calculated' && li.account_name.toLowerCase() === 'gross profit'
  );
  if (gpIdx !== -1) {
    const gpRow = lineItems[gpIdx];
    const incomeRow = lineItems.find(li =>
      (li.row_type === 'total' || li.row_type === 'calculated') &&
      li.account_name.toLowerCase() === 'total income'
    );
    if (incomeRow) {
      const gpPct = {};
      for (const mk of ALL_MONTHS) {
        const income = incomeRow[mk] || 0;
        gpPct[mk] = income !== 0
          ? Math.round(((gpRow[mk] / income) * 100) * 10) / 10
          : 0;
      }
      lineItems.splice(gpIdx + 1, 0, {
        row_order: 0,
        account_code: null,
        account_name: 'Gross Profit %',
        full_label: 'Gross Profit %',
        row_type: 'percent',
        indent_level: 0,
        ...gpPct
      });
      // Re-number row_order after insertion
      for (let j = 0; j < lineItems.length; j++) {
        lineItems[j].row_order = j;
      }
    }
  }

  // Only report months that actually contain data as "included"
  // This distinguishes actuals (jan has values) from empty forecast columns
  const months = monthColumns
    .filter(mc => monthsWithData.has(mc.monthKey))
    .map(mc => mc.monthKey);

  return { year, months, lineItems };
}

/**
 * Parse a cell value into a numeric amount
 */
function parseAmount(val) {
  if (val === null || val === undefined || val === '') return 0;
  if (typeof val === 'number') return Math.round(val * 100) / 100;
  // Handle string: remove $, commas, handle parentheses for negatives
  let str = String(val).trim();
  const isNeg = str.startsWith('(') && str.endsWith(')');
  str = str.replace(/[($,)]/g, '').trim();
  if (!str || str === '-') return 0;
  const num = parseFloat(str);
  if (isNaN(num)) return 0;
  return Math.round((isNeg ? -num : num) * 100) / 100;
}

/**
 * Classify a row by its label
 * @returns {{ rowType: string, accountCode: string|null, accountName: string, indentLevel: number }}
 */
function classifyRow(rawLabel, hasAnyAmount) {
  // Check for "Total - " prefix
  if (rawLabel.startsWith('Total - ') || rawLabel.startsWith('Total ')) {
    const name = rawLabel.replace(/^Total\s*-?\s*/, '').trim();
    // Check if the total label includes an account code
    const codeMatch = name.match(/^(\d{4}(?:\.\d+)*)\s*-\s*(.+)$/);
    return {
      rowType: 'total',
      accountCode: codeMatch ? normalizeAccountCode(codeMatch[1]) : null,
      accountName: codeMatch ? `Total - ${codeMatch[2].trim()}` : rawLabel,
      indentLevel: codeMatch ? getIndentFromCode(normalizeAccountCode(codeMatch[1])) : 0
    };
  }

  // Check for known calculated rows
  if (CALCULATED_ROWS.has(rawLabel.toLowerCase())) {
    return {
      rowType: 'calculated',
      accountCode: null,
      accountName: LABEL_RENAMES[rawLabel] || rawLabel,
      indentLevel: 0
    };
  }

  // Check for account code pattern: "XXXX - Name" or "XXXX.X.X - Name"
  const accountMatch = rawLabel.match(/^(\d{4}(?:\.\d+)*)\s*-\s*(.+)$/);
  if (accountMatch) {
    const code = normalizeAccountCode(accountMatch[1]);
    const name = accountMatch[2].trim();
    const indent = getIndentFromCode(code);

    if (hasAnyAmount) {
      return {
        rowType: 'detail',
        accountCode: code,
        accountName: name,
        indentLevel: indent
      };
    } else {
      return {
        rowType: 'account_header',
        accountCode: code,
        accountName: name,
        indentLevel: indent
      };
    }
  }

  // Section headers: "Income", "Cost Of Sales", "Expense", "Other Income", "Other Expense"
  return {
    rowType: 'section_header',
    accountCode: null,
    accountName: rawLabel,
    indentLevel: 0
  };
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
 * Compute indent level from account code dot segments
 * "5050" → 1, "5050.2" → 2, "5050.2.1" → 3
 */
function getIndentFromCode(code) {
  if (!code) return 0;
  return code.split('.').length;
}
