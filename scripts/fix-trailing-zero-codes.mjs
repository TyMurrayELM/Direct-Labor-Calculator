// One-shot: repair pnl_line_items account codes that lost a trailing zero
// in budget imports (parsePlanningXls read numeric cells, so 6152.10 became
// 6152.1 — which is a DIFFERENT real account, e.g. Specialist Wages vs
// Administrative Wages).
//
// Detection: for every code pair (short, long) where long = short + '0' and
// both exist as detail-row codes, any detail row whose code is `short` but
// whose account_name appears under `long` was mangled — its code (and the
// code prefix in full_label) is rewritten to `long`.
//
// Rows where the fix would collide with an existing `long` row in the SAME
// branch/dept/year/version are NOT auto-fixed (that version holds both
// variants and needs a manual merge) — they're listed for review instead.
//
// Dry-run by default; pass --apply to write.
//
// Usage:
//   node --env-file=.env.local scripts/fix-trailing-zero-codes.mjs
//   node --env-file=.env.local scripts/fix-trailing-zero-codes.mjs --apply

import { createClient } from '@supabase/supabase-js';

const APPLY = process.argv.includes('--apply');

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

const norm = (s) => String(s || '').trim().toLowerCase();
const scopeKey = (r) => `${r.branch_id}|${r.department}|${r.year}|${r.version_id ?? 'draft'}`;

(async () => {
  console.log(`Mode: ${APPLY ? 'APPLY (writes enabled)' : 'DRY RUN (no writes)'}\n`);

  // Fetch all detail rows, paginated past the 1000-row PostgREST cap
  const rows = [];
  const PAGE = 1000;
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await supabase
      .from('pnl_line_items')
      .select('id, branch_id, department, year, version_id, account_code, account_name, full_label')
      .eq('row_type', 'detail')
      .not('account_code', 'is', null)
      .order('id', { ascending: true })
      .range(offset, offset + PAGE - 1);
    if (error) throw error;
    if (!data?.length) break;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  console.log(`Fetched ${rows.length} detail rows\n`);

  // Names seen under each code
  const namesByCode = new Map();
  for (const r of rows) {
    if (!namesByCode.has(r.account_code)) namesByCode.set(r.account_code, new Set());
    namesByCode.get(r.account_code).add(norm(r.account_name));
  }

  // Existing (scope, code) pairs, to detect same-version collisions
  const codeInScope = new Set(rows.map((r) => `${scopeKey(r)}|${r.account_code}`));

  const fixes = [];
  const collisions = [];

  for (const r of rows) {
    const shortCode = r.account_code;
    const longCode = `${shortCode}0`;
    if (!namesByCode.has(longCode)) continue; // no sibling long-code account exists
    if (!namesByCode.get(longCode).has(norm(r.account_name))) continue; // name belongs to the short code

    const fix = {
      id: r.id,
      scope: scopeKey(r),
      name: r.account_name,
      from: shortCode,
      to: longCode,
      newFullLabel: r.full_label?.startsWith(`${shortCode} `)
        ? `${longCode}${r.full_label.slice(shortCode.length)}`
        : r.full_label,
    };

    if (codeInScope.has(`${scopeKey(r)}|${longCode}`)) {
      collisions.push(fix);
    } else {
      fixes.push(fix);
    }
  }

  if (fixes.length === 0 && collisions.length === 0) {
    console.log('Nothing to fix — no mangled codes found.');
    return;
  }

  console.log(`=== Proposed fixes (${fixes.length}) ===`);
  for (const f of fixes) {
    console.log(`  id=${f.id}  [${f.scope}]  ${f.from} -> ${f.to}  "${f.name}"`);
  }

  if (collisions.length) {
    console.log(`\n=== NEEDS MANUAL REVIEW (${collisions.length}) — version already has a ${'long'}-code row ===`);
    for (const f of collisions) {
      console.log(`  id=${f.id}  [${f.scope}]  ${f.from} -> ${f.to}  "${f.name}"  (collides; merge by hand)`);
    }
  }

  if (!APPLY) {
    console.log('\nDry run complete. Re-run with --apply to write the fixes.');
    return;
  }

  console.log('\nApplying...');
  let ok = 0;
  for (const f of fixes) {
    const { error } = await supabase
      .from('pnl_line_items')
      .update({ account_code: f.to, full_label: f.newFullLabel })
      .eq('id', f.id);
    if (error) {
      console.error(`  FAILED id=${f.id}:`, error.message);
    } else {
      ok++;
    }
  }
  console.log(`Done: ${ok}/${fixes.length} rows updated. Collisions skipped: ${collisions.length}`);
})();
