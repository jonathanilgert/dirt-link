#!/usr/bin/env node
// Import Henry's reviewed Calgary suppliers/trades workbook into permanent_pins.
//
// Usage:
//   node scripts/import-calgary-directory.js /path/to/DirtLink_Calgary_Directory.xlsx \
//     --cache scripts/data/calgary-directory-geocode-cache.json --geocode
//
// Safety:
// - Idempotent upsert by slug.
// - Keeps contact details unpublic until a claim/review flow approves them
//   (public_phone/public_address = 0).
// - Stores source URL and review status in the existing notes JSON to avoid a
//   schema change for this import pass.

const { v4: uuidv4 } = require('uuid');
const { getDb, run, get, all } = require('../database/init');
const {
  EXCLUDED_EXISTING_LISTINGS,
  parseWorkbook,
  normalizeDirectoryRows,
  loadGeocodeCache,
  saveGeocodeCache,
  ensureCoordinates,
  buildSupplierRecord
} = require('./lib/calgary-directory-import');

function parseArgs(argv) {
  const args = { workbook: null, cache: null, geocode: false, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--cache') args.cache = argv[++i];
    else if (a === '--geocode') args.geocode = true;
    else if (a === '--dry-run') args.dryRun = true;
    else if (!args.workbook) args.workbook = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.workbook) throw new Error('Usage: node scripts/import-calgary-directory.js <xlsx> [--cache path] [--geocode] [--dry-run]');
  return args;
}

function permanentPinColumns() {
  return new Set(all('PRAGMA table_info(permanent_pins)').map(c => c.name));
}

function pickInsertColumns(record, cols) {
  const wanted = [
    'id', 'latitude', 'longitude', 'site_name', 'site_type', 'address',
    'contact_phone', 'website_url', 'notes', 'is_active', 'entity_kind',
    'directory_listing', 'slug', 'tier', 'category', 'description',
    'service_area', 'public_phone', 'public_address'
  ];
  return wanted.filter(c => cols.has(c));
}

function pickUpdateColumns(record, cols) {
  const wanted = [
    'latitude', 'longitude', 'site_name', 'site_type', 'address',
    'contact_phone', 'website_url', 'notes', 'is_active', 'entity_kind',
    'directory_listing', 'tier', 'category', 'description', 'service_area',
    'public_phone', 'public_address'
  ];
  return wanted.filter(c => cols.has(c));
}

function upsertSupplier(record, cols, dryRun = false) {
  const existing = get('SELECT id FROM permanent_pins WHERE slug = ?', [record.slug]);
  if (dryRun) return existing ? 'would-update' : 'would-insert';

  if (existing) {
    const updateCols = pickUpdateColumns(record, cols);
    const assignments = updateCols.map(c => `${c} = ?`).join(', ');
    run(
      `UPDATE permanent_pins SET ${assignments}, updated_at = datetime('now') WHERE id = ?`,
      [...updateCols.map(c => record[c]), existing.id]
    );
    return 'updated';
  }

  const insertCols = pickInsertColumns(record, cols);
  const placeholders = insertCols.map(() => '?').join(', ');
  run(
    `INSERT INTO permanent_pins (${insertCols.join(', ')}) VALUES (${placeholders})`,
    insertCols.map(c => c === 'id' ? uuidv4() : record[c])
  );
  return 'inserted';
}

async function main() {
  const args = parseArgs(process.argv);
  await getDb();
  const sheets = parseWorkbook(args.workbook);
  const rows = normalizeDirectoryRows(sheets['Calgary Directory']);
  const geocodeCache = loadGeocodeCache(args.cache);
  const cols = permanentPinColumns();
  // Only de-dupe within this import batch plus the explicitly excluded live
  // listings. Existing imported suppliers must keep their original slug so
  // the upsert below updates them instead of creating `-2` duplicates on each
  // replay.
  const seenSlugs = new Set(EXCLUDED_EXISTING_LISTINGS);

  const stats = { rows: rows.length, inserted: 0, updated: 0, wouldInsert: 0, wouldUpdate: 0, categories: {}, geocodedOrCached: 0 };
  for (const row of rows) {
    const coordinates = await ensureCoordinates(row, { geocodeCache, geocode: args.geocode });
    const record = buildSupplierRecord(row, { geocodeCache, seenSlugs, coordinates });
    const action = upsertSupplier(record, cols, args.dryRun);
    if (action === 'inserted') stats.inserted++;
    else if (action === 'updated') stats.updated++;
    else if (action === 'would-insert') stats.wouldInsert++;
    else if (action === 'would-update') stats.wouldUpdate++;
    stats.categories[record.category] = (stats.categories[record.category] || 0) + 1;
    stats.geocodedOrCached++;
    console.log(`${action.padEnd(12)} ${record.slug} (${record.category})`);
  }

  saveGeocodeCache(args.cache, geocodeCache);
  console.log(JSON.stringify(stats, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
