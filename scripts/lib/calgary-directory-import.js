const fs = require('node:fs');
const path = require('node:path');
const https = require('node:https');
const { URL } = require('node:url');
const zlib = require('node:zlib');
const { slugify, isReservedSlug } = require('../../lib/directory-categories');

const XLSX_NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const REL_NS = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

const CATEGORY_SLUG_BY_LABEL = {
  'Aggregate & Gravel Pits': 'aggregate-pits',
  'Topsoil & Soil Yards': 'topsoil-yards',
  'Landscape Supply Yards': 'landscape-supply',
  'Excavation & Earthworks Contractors': 'excavation-contractors',
  'Hauling & Trucking': 'hauling-trucking',
  'Demolition Contractors': 'demolition',
  'Concrete & Asphalt Recyclers': 'concrete-recyclers',
  'Soil Testing & Environmental Labs': 'soil-testing',
  'Sod Farms & Turf Suppliers': 'sod-farms'
};

const EXCLUDED_EXISTING_LISTINGS = new Set([
  'burnco-rock-products',
  'soil-kings',
  'blue-grass-nursery-balzac',
  'blue-grass-nursery',
  'bulk-direct',
  'tmh-industries',
  'equipment-rental'
]);

const SERVICE_AREA_COORDINATES = new Map([
  ['calgary', { latitude: 51.0447, longitude: -114.0719, precision: 'service-area' }],
  ['calgary ab', { latitude: 51.0447, longitude: -114.0719, precision: 'service-area' }],
  ['calgary metro', { latitude: 51.0447, longitude: -114.0719, precision: 'service-area' }],
  ['yyc', { latitude: 51.0447, longitude: -114.0719, precision: 'service-area' }],
  ['airdrie', { latitude: 51.2917, longitude: -114.0144, precision: 'service-area' }],
  ['cochrane', { latitude: 51.1890, longitude: -114.4679, precision: 'service-area' }],
  ['okotoks', { latitude: 50.7254, longitude: -113.9748, precision: 'service-area' }],
  ['chestermere', { latitude: 51.0501, longitude: -113.8227, precision: 'service-area' }],
  ['high river', { latitude: 50.5810, longitude: -113.8740, precision: 'service-area' }],
  ['rocky view', { latitude: 51.1834, longitude: -114.1600, precision: 'service-area' }],
  ['foothills', { latitude: 50.7340, longitude: -114.1890, precision: 'service-area' }],
  ['bragg creek', { latitude: 50.9486, longitude: -114.5608, precision: 'service-area' }],
  ['red deer', { latitude: 52.2681, longitude: -113.8112, precision: 'service-area' }],
  ['edmonton', { latitude: 53.5461, longitude: -113.4938, precision: 'service-area' }]
]);

function escapeXml(s) {
  return String(s || '').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

function unzipEntry(buffer) {
  return zlib.inflateRawSync(buffer).toString('utf8');
}

function readZipEntries(filePath) {
  const buf = fs.readFileSync(filePath);
  const entries = new Map();
  const eocdSig = Buffer.from([0x50, 0x4b, 0x05, 0x06]);
  const eocd = buf.lastIndexOf(eocdSig);
  if (eocd < 0) throw new Error('Invalid xlsx/zip: EOCD not found');
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  let pos = cdOffset;
  const cdEnd = cdOffset + cdSize;
  while (pos < cdEnd) {
    const sig = buf.readUInt32LE(pos);
    if (sig !== 0x02014b50) throw new Error(`Invalid zip central directory at ${pos}`);
    const method = buf.readUInt16LE(pos + 10);
    const compressedSize = buf.readUInt32LE(pos + 20);
    const nameLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const commentLen = buf.readUInt16LE(pos + 32);
    const localOffset = buf.readUInt32LE(pos + 42);
    const name = buf.slice(pos + 46, pos + 46 + nameLen).toString('utf8');

    const localNameLen = buf.readUInt16LE(localOffset + 26);
    const localExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + localNameLen + localExtraLen;
    const data = buf.slice(dataStart, dataStart + compressedSize);
    entries.set(name, method === 8 ? unzipEntry(data) : data.toString('utf8'));
    pos += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function attrs(tag) {
  const out = {};
  String(tag || '').replace(/([A-Za-z_:][\w:.-]*)="([^"]*)"/g, (_, k, v) => { out[k] = escapeXml(v); });
  return out;
}

function tagBlocks(xml, tag) {
  const re = new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'g');
  return xml.match(re) || [];
}

function colIndex(ref) {
  const letters = String(ref || '').match(/^[A-Z]+/i)?.[0] || 'A';
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseWorkbook(filePath) {
  const entries = readZipEntries(filePath);
  const sharedStrings = [];
  const sst = entries.get('xl/sharedStrings.xml') || '';
  for (const si of tagBlocks(sst, 'si')) {
    const texts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(m => escapeXml(m[1]));
    sharedStrings.push(texts.join(''));
  }

  const rels = entries.get('xl/_rels/workbook.xml.rels') || '';
  const relMap = new Map();
  for (const rel of rels.match(/<Relationship\b[^>]*\/>/g) || []) {
    const a = attrs(rel);
    relMap.set(a.Id, a.Target);
  }

  const workbook = entries.get('xl/workbook.xml') || '';
  const sheets = {};
  for (const sheetTag of workbook.match(/<sheet\b[^>]*\/>/g) || []) {
    const a = attrs(sheetTag);
    const rid = a['r:id'];
    let target = relMap.get(rid) || '';
    target = target.replace(/^\//, '');
    if (!target.startsWith('xl/')) target = path.posix.join('xl', target);
    const xml = entries.get(target);
    if (!xml) continue;
    const rows = [];
    for (const rowXml of tagBlocks(xml, 'row')) {
      const row = [];
      const cellRe = /<c\b[^>]*?(?:\/>|>[\s\S]*?<\/c>)/g;
      for (const cellXml of rowXml.match(cellRe) || []) {
        const ca = attrs(cellXml.match(/<c\b[^>]*>/)?.[0] || cellXml.match(/<c\b[^>]*\/>/)?.[0] || '');
        const idx = colIndex(ca.r);
        const v = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1] || '';
        const inline = cellXml.match(/<t\b[^>]*>([\s\S]*?)<\/t>/)?.[1] || '';
        let value = inline ? escapeXml(inline) : escapeXml(v);
        if (ca.t === 's' && value !== '') value = sharedStrings[Number(value)] || '';
        row[idx] = value;
      }
      rows.push(row.map(v => v || ''));
    }
    sheets[a.name] = rows;
  }
  return sheets;
}

function normalizeWebsite(raw) {
  const s = String(raw || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

function splitServiceArea(raw) {
  return String(raw || '')
    .split(/[,;&]|\band\b|&/i)
    .map(s => s.trim())
    .filter(Boolean);
}

function normalizeStatus(raw) {
  return String(raw || '').trim().toLowerCase().replace(/\s+/g, '_');
}

function normalizeDirectoryRows(rows) {
  const header = rows[0] || [];
  const idx = Object.fromEntries(header.map((h, i) => [h, i]));
  return rows.slice(1).map(row => {
    const get = name => String(row[idx[name]] || '').trim();
    const category = get('Category');
    const categorySlug = CATEGORY_SLUG_BY_LABEL[category];
    if (!categorySlug) throw new Error(`Unknown category: ${category}`);
    const businessName = get('Business Name');
    return {
      category,
      categorySlug,
      businessName,
      serviceArea: get('Service Area'),
      address: get('Address'),
      phone: get('Phone'),
      website: get('Website'),
      description: get('Description'),
      sourceUrl: get('Source URL'),
      status: get('Status')
    };
  }).filter(row => row.businessName && !EXCLUDED_EXISTING_LISTINGS.has(slugify(row.businessName)));
}

function loadGeocodeCache(cachePath) {
  if (!cachePath || !fs.existsSync(cachePath)) return new Map();
  const obj = JSON.parse(fs.readFileSync(cachePath, 'utf8'));
  return new Map(Object.entries(obj));
}

function saveGeocodeCache(cachePath, cache) {
  if (!cachePath) return;
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(Object.fromEntries(cache), null, 2) + '\n');
}

function cacheKeys(row) {
  return [
    `${row.businessName}|${row.address}`,
    row.address ? `address:${row.address}` : '',
    ...splitServiceArea(row.serviceArea).map(area => `service:${area.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}`)
  ].filter(Boolean);
}

function fallbackCoordinate(row) {
  for (const area of splitServiceArea(row.serviceArea)) {
    const key = area.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    if (SERVICE_AREA_COORDINATES.has(key)) return SERVICE_AREA_COORDINATES.get(key);
  }
  return { latitude: 51.0447, longitude: -114.0719, precision: 'service-area' };
}

async function geocodeAddress(query) {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  url.searchParams.set('countrycodes', 'ca');
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'DirtLinkDirectoryImporter/1.0 support@dirtlink.ca' } }, res => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(`geocode HTTP ${res.statusCode}`));
        const first = JSON.parse(body)[0];
        if (!first) return resolve(null);
        resolve({ latitude: Number(first.lat), longitude: Number(first.lon), precision: 'geocoded' });
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => req.destroy(new Error('geocode timeout')));
  });
}

async function ensureCoordinates(row, { geocodeCache = new Map(), geocode = false, throttleMs = 1100 } = {}) {
  for (const key of cacheKeys(row)) {
    if (geocodeCache.has(key)) return geocodeCache.get(key);
  }
  let coord = null;
  if (geocode && row.address) {
    coord = await geocodeAddress(row.address.includes('AB') ? row.address : `${row.address}, Alberta, Canada`);
    if (coord && Number.isFinite(coord.latitude) && Number.isFinite(coord.longitude)) {
      geocodeCache.set(`${row.businessName}|${row.address}`, coord);
      geocodeCache.set(`address:${row.address}`, coord);
      if (throttleMs) await new Promise(resolve => setTimeout(resolve, throttleMs));
      return coord;
    }
  }
  coord = fallbackCoordinate(row);
  geocodeCache.set(`${row.businessName}|${row.address}`, coord);
  return coord;
}

function stableSlug(base, seenSlugs = new Set()) {
  let root = slugify(base) || 'supplier';
  let slug = root;
  let i = 2;
  while (isReservedSlug(slug) || seenSlugs.has(slug)) slug = `${root}-${i++}`;
  seenSlugs.add(slug);
  return slug;
}

function buildSupplierRecord(row, { geocodeCache = new Map(), seenSlugs = new Set(), coordinates } = {}) {
  const coord = coordinates || cacheKeys(row).map(k => geocodeCache.get(k)).find(Boolean) || fallbackCoordinate(row);
  const slug = stableSlug(row.businessName, seenSlugs);
  const serviceAreas = splitServiceArea(row.serviceArea);
  return {
    slug,
    site_name: row.businessName,
    site_type: 'supplier',
    category: row.categorySlug,
    tier: 'free',
    address: row.address || row.serviceArea || 'Calgary, AB',
    latitude: Number(coord.latitude),
    longitude: Number(coord.longitude),
    description: row.description || null,
    service_area: JSON.stringify(serviceAreas),
    // The outreach-ready Calgary directory listings remain marked
    // needs_review in notes, but their supplied contact fields must be
    // visible so businesses can confirm/correct them when claiming.
    public_phone: row.phone ? 1 : 0,
    public_address: row.address ? 1 : 0,
    contact_phone: row.phone || null,
    website_url: normalizeWebsite(row.website) || null,
    source_url: row.sourceUrl || null,
    review_status: normalizeStatus(row.status) || 'needs_review',
    notes: JSON.stringify({ source_url: row.sourceUrl || null, review_status: normalizeStatus(row.status) || 'needs_review', coordinate_precision: coord.precision || 'unknown' }),
    entity_kind: 'supplier',
    directory_listing: 1,
    is_active: 1
  };
}

module.exports = {
  CATEGORY_SLUG_BY_LABEL,
  EXCLUDED_EXISTING_LISTINGS,
  parseWorkbook,
  normalizeDirectoryRows,
  normalizeWebsite,
  splitServiceArea,
  loadGeocodeCache,
  saveGeocodeCache,
  ensureCoordinates,
  buildSupplierRecord,
  stableSlug
};
