// Read-only DB inspection for Stage 1 of the suppliers directory build.
// Dumps counts + a representative row from each pin table, then writes
// a pin-classification CSV for human review.
//
// Usage: node scripts/inspect-pins.js
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');

const DB_PATH = path.join(__dirname, '..', 'data', 'dirtlink.db');
const OUT_CSV = path.join(__dirname, '..', 'docs', 'marketing', 'calgary-launch', 'pin-classification-review.csv');

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  const all = (sql) => {
    const stmt = db.prepare(sql);
    const rows = [];
    while (stmt.step()) rows.push(stmt.getAsObject());
    stmt.free();
    return rows;
  };

  // --- Counts ---
  const counts = {
    pins:           all(`SELECT COUNT(*) AS n FROM pins`)[0].n,
    pins_active:    all(`SELECT COUNT(*) AS n FROM pins WHERE is_active = 1`)[0].n,
    permit_pins:    all(`SELECT COUNT(*) AS n FROM permit_pins`)[0].n,
    permit_active:  all(`SELECT COUNT(*) AS n FROM permit_pins WHERE is_active = 1`)[0].n,
    permanent:      all(`SELECT COUNT(*) AS n FROM permanent_pins`)[0].n,
    permanent_act:  all(`SELECT COUNT(*) AS n FROM permanent_pins WHERE is_active = 1`)[0].n,
  };
  console.log('--- COUNTS ---');
  console.log(JSON.stringify(counts, null, 2));

  // --- Representative records ---
  console.log('\n--- pins (first row) ---');
  console.log(JSON.stringify(all(`SELECT * FROM pins LIMIT 1`)[0] || null, null, 2));
  console.log('\n--- permit_pins (first row) ---');
  console.log(JSON.stringify(all(`SELECT * FROM permit_pins LIMIT 1`)[0] || null, null, 2));
  console.log('\n--- permanent_pins (first row) ---');
  console.log(JSON.stringify(all(`SELECT * FROM permanent_pins LIMIT 1`)[0] || null, null, 2));

  // --- Distinct site_type / material_type / permit_type ---
  console.log('\n--- distinct permanent_pins.site_type ---');
  console.log(all(`SELECT site_type, COUNT(*) AS n FROM permanent_pins GROUP BY site_type ORDER BY n DESC`));
  console.log('\n--- distinct pins.material_type ---');
  console.log(all(`SELECT material_type, pin_type, COUNT(*) AS n FROM pins GROUP BY material_type, pin_type ORDER BY n DESC`));
  console.log('\n--- distinct permit_pins.permit_type ---');
  console.log(all(`SELECT permit_type, COUNT(*) AS n FROM permit_pins GROUP BY permit_type ORDER BY n DESC LIMIT 20`));

  // --- Build classification CSV ---
  // Heuristics:
  //   permit_pins  -> entityType=permit,    directoryListing=false
  //   permanent_pins where site_type matches landfill/transfer/recycler -> reference
  //   permanent_pins otherwise -> supplier (suggested)
  //   pins (have/need) are marketplace listings, NOT in the directory
  fs.mkdirSync(path.dirname(OUT_CSV), { recursive: true });
  const lines = [];
  // Column shape per D2 in the open-questions reply: user marks decision +
  // notes inline in their editor and commits the file back. The
  // `current_entity_type` column shows what's already on the row (so the
  // user sees existing state); `suggested_category` is our best guess.
  lines.push('pin_id,business_name,current_entity_type,suggested_category,decision,notes');

  const refSiteTypes = /landfill|transfer|recycler|recycling|city|municipal|reference|disposal/i;
  const aggregateRe = /pit|aggregate|gravel|sand/i;
  const topsoilRe   = /topsoil|soil yard|loam/i;
  const landscapeRe = /landscape|garden|nursery|rock yard|mulch/i;
  const excavationRe = /excav|earthworks|grading|site prep/i;
  const haulingRe    = /haul|trucking|transport/i;
  const demoRe       = /demo|demolition/i;
  const concreteRe   = /concrete|asphalt|recycler/i;
  const labRe        = /lab|environmental|testing|geotech/i;
  const equipRe      = /rental|equipment|loader|excavator hire/i;
  const sodRe        = /sod|turf/i;

  function suggestCategory(name, type) {
    const blob = `${name || ''} ${type || ''}`.toLowerCase();
    if (refSiteTypes.test(blob)) return 'concrete-recyclers'; // best fit if reference fallback
    if (aggregateRe.test(blob)) return 'aggregate-pits';
    if (topsoilRe.test(blob))   return 'topsoil-yards';
    if (landscapeRe.test(blob)) return 'landscape-supply';
    if (excavationRe.test(blob)) return 'excavation-contractors';
    if (haulingRe.test(blob))    return 'hauling-trucking';
    if (demoRe.test(blob))       return 'demolition';
    if (concreteRe.test(blob))   return 'concrete-recyclers';
    if (labRe.test(blob))        return 'soil-testing';
    if (equipRe.test(blob))      return 'equipment-rental';
    if (sodRe.test(blob))        return 'sod-farms';
    return 'UNCLASSIFIED';
  }

  function csv(s) {
    if (s == null) return '';
    const v = String(s).replace(/"/g, '""');
    return /[",\n]/.test(v) ? `"${v}"` : v;
  }

  // permit_pins → entity_type=permit (never in directory)
  for (const r of all(`SELECT id, address, permit_number, permit_type FROM permit_pins WHERE is_active = 1 ORDER BY permit_date DESC LIMIT 5000`)) {
    lines.push([
      csv(r.id),
      csv(`${r.address} (permit ${r.permit_number})`),
      'permit',
      '',     // suggested_category — N/A for permits
      '',     // decision (user fills)
      ''      // notes
    ].join(','));
  }

  // permanent_pins → entity_type already set (supplier / reference). For
  // suppliers without a category, suggest one from name/site_type heuristics.
  for (const r of all(`SELECT id, site_name, site_type, address, category, entity_kind, directory_listing FROM permanent_pins WHERE is_active = 1 ORDER BY site_name`)) {
    const current = r.entity_kind || (refSiteTypes.test(`${r.site_name || ''} ${r.site_type || ''}`) ? 'reference' : 'supplier');
    const cat = current === 'supplier'
      ? (r.category || suggestCategory(r.site_name, r.site_type))
      : '';
    lines.push([
      csv(r.id),
      csv(r.site_name),
      current,
      csv(cat),
      '',     // decision: approve | change-to:[type] | exclude
      ''      // notes
    ].join(','));
  }

  fs.writeFileSync(OUT_CSV, lines.join('\n') + '\n');
  console.log(`\nWrote ${lines.length - 1} rows to ${OUT_CSV}`);
})();
