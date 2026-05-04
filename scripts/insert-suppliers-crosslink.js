// Inserts a "Browse Calgary [thing] suppliers" cross-link section directly
// above the FAQ section on each of the 18 material/service Calgary pages.
// Idempotent — skips pages that already contain the marker class.
//
// Usage: node scripts/insert-suppliers-crosslink.js

const fs = require('fs');
const path = require('path');

const CALGARY_DIR = path.join(__dirname, '..', 'public', 'calgary');

// Page → directory deep link + descriptor for the link copy.
const PAGES = {
  'topsoil.html':              { anchor: 'topsoil-yards',          desc: 'topsoil yards and soil suppliers' },
  'gravel.html':               { anchor: 'aggregate-pits',         desc: 'gravel and aggregate pits' },
  'fill-dirt.html':            { anchor: 'aggregate-pits',         desc: 'fill suppliers and aggregate pits' },
  'sand.html':                 { anchor: 'aggregate-pits',         desc: 'sand and aggregate suppliers' },
  'landscape-rock.html':       { anchor: 'landscape-supply',       desc: 'landscape supply yards' },
  'mulch.html':                { anchor: 'landscape-supply',       desc: 'mulch and landscape supply yards' },
  'compost.html':              { anchor: 'landscape-supply',       desc: 'compost and landscape supply yards' },
  'road-crush.html':           { anchor: 'aggregate-pits',         desc: 'aggregate pits stocking road crush' },
  'pit-run.html':              { anchor: 'aggregate-pits',         desc: 'pits running pit-run material' },
  'river-rock.html':           { anchor: 'landscape-supply',       desc: 'river rock and landscape supply yards' },
  'recycled-concrete.html':    { anchor: 'concrete-recyclers',     desc: 'concrete and asphalt recyclers' },
  'loam.html':                 { anchor: 'topsoil-yards',          desc: 'soil yards stocking loam blends' },
  'boulders.html':             { anchor: 'landscape-supply',       desc: 'landscape suppliers carrying boulders' },
  'dirt-disposal.html':        { anchor: '',                       desc: 'haulers, recyclers, and excavation contractors' },
  'free-fill-dirt.html':       { anchor: 'excavation-contractors', desc: 'excavation contractors with surplus fill' },
  'clean-fill-wanted.html':    { anchor: 'excavation-contractors', desc: 'excavation contractors looking for clean fill' },
  'landfill-tipping-fees.html': { anchor: 'concrete-recyclers',    desc: 'recyclers and disposal sites' },
  'dirt-disposal-cost.html':   { anchor: 'hauling-trucking',       desc: 'haulers and trucking operators' }
};

const FAQ_MARKER = '<h2>Frequently asked questions</h2>';
const ALREADY_INSERTED = 'data-cta="material-to-directory"';

const SECTION_OPENER = '  <section class="section">\n    <div class="container">\n      ' + FAQ_MARKER;

function buildBlock(anchor, desc) {
  const href = anchor ? `/calgary/suppliers#${anchor}` : '/calgary/suppliers';
  return `  <section class="section-tight">
    <div class="container">
      <p class="lede" style="margin:0;">Browse <a href="${href}" data-cta="material-to-directory">Calgary ${desc} in the directory →</a></p>
    </div>
  </section>

`;
}

let changed = 0, skipped = 0, missing = 0;

for (const [file, meta] of Object.entries(PAGES)) {
  const fp = path.join(CALGARY_DIR, file);
  if (!fs.existsSync(fp)) { console.log(`MISSING ${file}`); missing++; continue; }
  let html = fs.readFileSync(fp, 'utf8');
  if (html.includes(ALREADY_INSERTED)) { console.log(`skip   ${file} (already inserted)`); skipped++; continue; }
  if (!html.includes(SECTION_OPENER)) {
    console.log(`WARN   ${file} — could not locate FAQ insertion point with expected indent`);
    continue;
  }
  const block = buildBlock(meta.anchor, meta.desc);
  html = html.replace(SECTION_OPENER, block + SECTION_OPENER);
  fs.writeFileSync(fp, html);
  console.log(`patch  ${file}  →  ${meta.anchor || '(directory root)'}`);
  changed++;
}

console.log(`\nchanged: ${changed}  skipped: ${skipped}  missing: ${missing}`);
