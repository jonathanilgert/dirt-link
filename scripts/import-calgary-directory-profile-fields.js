#!/usr/bin/env node
// Patch Calgary directory supplier profile fields from Henry's slug-keyed
// profile workbook. This is intentionally idempotent and updates only rows
// that already exist by exact slug.
//
// Usage:
//   node scripts/import-calgary-directory-profile-fields.js \
//     /path/to/DirtLink_Calgary_Directory_PROFILE_IMPORT.xlsx [--dry-run]

const { getDb, get, run } = require('../database/init');
const { parseWorkbook, normalizeWebsite } = require('./lib/calgary-directory-import');

function parseArgs(argv) {
  const args = { workbook: null, dryRun: false };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (!args.workbook) args.workbook = a;
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!args.workbook) throw new Error('Usage: node scripts/import-calgary-directory-profile-fields.js <xlsx> [--dry-run]');
  return args;
}

function rowsFromProfileWorkbook(workbook) {
  const sheets = parseWorkbook(workbook);
  const rows = sheets['Profile Import'] || Object.values(sheets)[0] || [];
  const header = rows[0] || [];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  const required = ['Slug', 'Business Name', 'Service Area', 'Address', 'Phone', 'Website', 'Description', 'Source URL'];
  for (const name of required) {
    if (!(name in idx)) throw new Error(`Profile workbook missing required column: ${name}`);
  }
  return rows.slice(1).map(row => {
    const val = name => String(row[idx[name]] || '').trim();
    return {
      slug: val('Slug'),
      site_name: val('Business Name'),
      service_area_raw: val('Service Area'),
      address: val('Address'),
      contact_phone: val('Phone'),
      website_url: normalizeWebsite(val('Website')) || null,
      description: val('Description') || null,
      source_url: val('Source URL') || null
    };
  }).filter(row => row.slug);
}

function mergeNotes(existingNotes, patch) {
  let notes = {};
  try { notes = existingNotes ? JSON.parse(existingNotes) : {}; }
  catch { notes = { legacy_notes: existingNotes }; }
  return JSON.stringify({
    ...notes,
    source_url: patch.source_url || notes.source_url || null,
    review_status: notes.review_status || 'needs_review',
    profile_fields_imported_at: new Date().toISOString()
  });
}

async function main() {
  const args = parseArgs(process.argv);
  await getDb();
  const rows = rowsFromProfileWorkbook(args.workbook);
  const stats = { rows: rows.length, updated: 0, missing: 0, unchanged: 0, withAddress: 0, withPhone: 0, withWebsite: 0, withDescription: 0, dryRun: args.dryRun };

  for (const row of rows) {
    const existing = get('SELECT id, slug, notes FROM permanent_pins WHERE slug = ? AND directory_listing = 1', [row.slug]);
    if (!existing) {
      stats.missing++;
      console.log(`missing      ${row.slug}`);
      continue;
    }

    if (row.address) stats.withAddress++;
    if (row.contact_phone) stats.withPhone++;
    if (row.website_url) stats.withWebsite++;
    if (row.description) stats.withDescription++;

    const params = [
      row.site_name,
      row.address || row.service_area_raw || 'Calgary, AB',
      row.contact_phone || null,
      row.website_url,
      row.description,
      JSON.stringify(row.service_area_raw ? row.service_area_raw.split(/[,;&]|\band\b|&/i).map(s => s.trim()).filter(Boolean) : []),
      row.contact_phone ? 1 : 0,
      row.address ? 1 : 0,
      mergeNotes(existing.notes, row),
      existing.id
    ];

    if (args.dryRun) {
      stats.unchanged++;
      console.log(`would-update ${row.slug}`);
      continue;
    }

    run(`UPDATE permanent_pins
         SET site_name = ?, address = ?, contact_phone = ?, website_url = ?, description = ?,
             service_area = ?, public_phone = ?, public_address = ?, notes = ?, updated_at = datetime('now')
         WHERE id = ?`, params);
    stats.updated++;
    console.log(`updated      ${row.slug}`);
  }

  console.log(JSON.stringify(stats, null, 2));
}

main().catch(err => {
  console.error(err.stack || err.message);
  process.exit(1);
});
