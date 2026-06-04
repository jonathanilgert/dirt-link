const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');

const {
  parseWorkbook,
  normalizeDirectoryRows,
  CATEGORY_SLUG_BY_LABEL,
  buildSupplierRecord,
  loadGeocodeCache,
  EXCLUDED_EXISTING_LISTINGS
} = require('../scripts/lib/calgary-directory-import');

const WORKBOOK = path.join(
  '/mnt/c/Users/pc/OneDrive/Agents/50_Work_Desk',
  'DirtLink_Calgary_Directory.xlsx'
);

test('Calgary directory workbook parses all 96 reviewed supplier rows', () => {
  assert.equal(fs.existsSync(WORKBOOK), true, 'expected work-desk xlsx fixture');
  const sheets = parseWorkbook(WORKBOOK);
  const rows = normalizeDirectoryRows(sheets['Calgary Directory']);

  assert.equal(rows.length, 96);
  assert.equal(rows.filter(r => r.status === 'Needs review').length, 96);
  assert.equal(rows.filter(r => r.businessName === 'BURNCO Rock Products').length, 0, 'existing live listings are excluded');

  const counts = rows.reduce((acc, row) => {
    acc[row.categorySlug] = (acc[row.categorySlug] || 0) + 1;
    return acc;
  }, {});

  assert.deepEqual(counts, {
    'aggregate-pits': 12,
    'topsoil-yards': 10,
    'landscape-supply': 10,
    'excavation-contractors': 21,
    'hauling-trucking': 10,
    demolition: 10,
    'concrete-recyclers': 4,
    'soil-testing': 14,
    'sod-farms': 5
  });
});

test('supplier records preserve review status and expose supplied outreach contact fields', () => {
  const rows = normalizeDirectoryRows(parseWorkbook(WORKBOOK)['Calgary Directory']);
  const row = rows.find(r => r.businessName === 'Koomen Contracting Ltd.');
  const cache = loadGeocodeCache(path.join(__dirname, 'fixtures', 'calgary-directory-geocode-cache.sample.json'));
  const supplier = buildSupplierRecord(row, { geocodeCache: cache });

  assert.equal(supplier.slug, 'koomen-contracting-ltd');
  assert.equal(supplier.category, CATEGORY_SLUG_BY_LABEL['Excavation & Earthworks Contractors']);
  assert.equal(supplier.tier, 'free');
  assert.equal(supplier.review_status, 'needs_review');
  assert.equal(supplier.directory_listing, 1);
  assert.equal(supplier.entity_kind, 'supplier');
  assert.equal(supplier.public_phone, 1);
  assert.equal(supplier.public_address, 0);
  assert.equal(supplier.contact_phone, '587-333-3200');
  assert.equal(supplier.website_url, 'https://koomencontracting.ca');
  assert.equal(supplier.source_url, 'https://www.koomencontracting.ca/services/excavating');
  assert.deepEqual(JSON.parse(supplier.service_area), ['Calgary', 'Airdrie', 'Cochrane', 'Okotoks', 'Chestermere', 'High River', 'S. Alberta']);
  assert.equal(typeof supplier.latitude, 'number');
  assert.equal(typeof supplier.longitude, 'number');
});

test('reserved/colliding slugs receive stable numeric suffixes', () => {
  const rows = normalizeDirectoryRows([
    ['Category', 'Business Name', 'Service Area', 'Address', 'Phone', 'Website', 'Description', 'Source URL', 'Status'],
    ['Hauling & Trucking', 'API', 'Calgary', '', '', '', 'Reserved word', '', 'Needs review'],
    ['Hauling & Trucking', 'API', 'Calgary', '', '', '', 'Duplicate reserved word', '', 'Needs review']
  ]);
  const cache = new Map([['service:calgary', { latitude: 51.0447, longitude: -114.0719, precision: 'service-area' }]]);
  const seen = new Set(EXCLUDED_EXISTING_LISTINGS);
  const slugs = rows.map(row => buildSupplierRecord(row, { geocodeCache: cache, seenSlugs: seen }).slug);

  assert.deepEqual(slugs, ['api-2', 'api-3']);
});
