# Direct Labor Calculator

FTE forecast and P&L versioning tool built with Next.js and Supabase.

## Features

### Labor Forecasting
- Monthly revenue, FTE, and labor cost forecasting per branch
- Branch-specific hourly rates (Las Vegas, Phoenix, etc.)
- Combined views for multi-branch rollups (Encore, Phoenix)

### P&L Management
- **Import**: Upload NetSuite Income Statement XLS or Revenue/COGS/OpEx planning files
- **Editable cells**: Click any forecast-month cell to edit inline (actuals are read-only)
- **Dynamic totals**: Section totals, Gross Profit, GP%, Net Operating Income, and Net Income recompute live from detail rows
- **Drag-and-drop**: Reorder detail rows within sections
- **Actual/forecast distinction**: Visual styling differentiates imported actuals (blue tint) from editable forecast months

### P&L Versioning
- **Save versions**: Standardized naming (0+12, 1+11, ..., 12+0, Original Budget)
- **Compare**: Select a reference version to see side-by-side totals with $ and % variance columns
- **Fill Forecast**: Copy forecast-month values from any saved version into the working draft or another version
- **Lock/Unlock**: Prevent edits to finalized versions
- **Delete**: Remove unlocked versions

### Admin-Only Rows
- Detail rows can be flagged as `admin_only` to hide sensitive compensation data from P&L managers
- Non-admin users never see these rows, and their values are excluded from all totals
- Admin users see a toggle icon on detail rows (lock = hidden from non-admins, eye = visible to all)
- Admin-only flags are preserved across re-imports and version snapshots

## Tech Stack

- **Framework**: [Next.js](https://nextjs.org) (App Router)
- **Database**: [Supabase](https://supabase.com) (PostgreSQL + PostgREST)
- **Styling**: Tailwind CSS
- **Auth**: Supabase Auth with allowlist-based access control and role-based admin detection
- **Parsing**: `xlsx` library for XLS file parsing

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser.

### Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-supabase-anon-key>
```

## Project Structure

```
app/
  forecast/page.js          — Main forecast + P&L page
  components/
    PnlTable.js             — P&L table with editing, totals, comparison, admin-only
    PnlVersionBar.js        — Version selector, save, compare, fill, import controls
    PnlImport.js            — NetSuite P&L file upload
    BudgetImport.js         — Planning file upload (Revenue + COGS + OpEx)
    DirectLaborCalculator.js — FTE/labor calculator component
  api/pnl/
    import/route.js         — Import line items (preserves forecasts + admin flags)
    save-version/route.js   — Snapshot draft to named version
    update-cells/route.js   — Update month values on a line item
    toggle-admin-only/route.js — Toggle admin_only flag on detail rows
    fill-forecast/route.js  — Copy forecast values from source version
    lock-version/route.js   — Lock/unlock a version
    delete-version/route.js — Delete an unlocked version
    reorder-row/route.js    — Reorder rows via drag-and-drop
  hooks/useSupabase.js      — All data fetching hooks + CRUD functions
lib/
  parsePnlXls.js            — NetSuite Income Statement XLS parser
  parsePlanningXls.js       — Planning Excel parser (Revenue, COGS, OpEx)
```
