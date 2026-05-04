// Dev-only seed for the suppliers directory. Inserts 4 representative rows
// into permanent_pins with entity_kind='supplier', directory_listing=1, one
// per tier — so /calgary/suppliers renders with content during local QA.
//
// Idempotent: re-running upserts by slug.
//
// Usage: node scripts/seed-directory-suppliers.js
const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'data', 'dirtlink.db');

const SUPPLIERS = [
  {
    slug: 'bluegrass-aggregate',
    site_name: 'Bluegrass Aggregate',
    site_type: 'supplier',
    category: 'aggregate-pits',
    tier: 'enterprise',
    address: 'Foothills Industrial, Calgary, AB',
    latitude: 50.96, longitude: -114.03,
    description: 'Aggregate, road crush, and pit-run from a Foothills pit. Tandem and triaxle pickup.',
    service_area: JSON.stringify(['Calgary Metro', 'Okotoks']),
    public_phone: 1, public_address: 1, contact_phone: '403-555-0101',
    claimed_by: null
  },
  {
    slug: 'shepard-soil-yards',
    site_name: 'Shepard Soil Yards',
    site_type: 'supplier',
    category: 'topsoil-yards',
    tier: 'powerhouse',
    address: '50th Ave SE, Calgary, AB',
    latitude: 50.94, longitude: -113.92,
    description: 'Screened topsoil and lawn blends from a Shepard yard. Same-day delivery in season.',
    service_area: JSON.stringify(['SE Calgary', 'Chestermere', 'Strathmore']),
    public_phone: 1, public_address: 0, contact_phone: '403-555-0102',
    claimed_by: null
  },
  {
    slug: 'manchester-stone',
    site_name: 'Manchester Stone & Mulch',
    site_type: 'supplier',
    category: 'landscape-supply',
    tier: 'pro',
    address: 'Manchester Industrial, Calgary, AB',
    latitude: 51.00, longitude: -114.07,
    description: 'Decorative rock, mulch, compost, and slabs for residential landscape projects.',
    service_area: JSON.stringify(['Calgary Metro', 'Airdrie', 'Cochrane']),
    public_phone: 1, public_address: 1, contact_phone: '403-555-0103',
    claimed_by: null
  },
  {
    slug: 'cornerstone-haul',
    site_name: 'Cornerstone Haul',
    site_type: 'supplier',
    category: 'hauling-trucking',
    tier: 'free',
    address: 'NE Calgary, AB',
    latitude: 51.13, longitude: -113.97,
    description: null,
    service_area: JSON.stringify(['NE Calgary', 'Airdrie']),
    public_phone: 0, public_address: 0, contact_phone: null,
    claimed_by: null
  }
];

(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(DB_PATH));

  const get = (sql, params = []) => {
    const stmt = db.prepare(sql);
    stmt.bind(params);
    const row = stmt.step() ? stmt.getAsObject() : null;
    stmt.free();
    return row;
  };

  for (const s of SUPPLIERS) {
    const existing = get('SELECT id FROM permanent_pins WHERE slug = ?', [s.slug]);
    if (existing) {
      db.run(
        `UPDATE permanent_pins SET
            site_name = ?, site_type = ?, category = ?, tier = ?,
            address = ?, latitude = ?, longitude = ?,
            description = ?, service_area = ?,
            public_phone = ?, public_address = ?, contact_phone = ?,
            entity_kind = 'supplier', directory_listing = 1, is_active = 1,
            updated_at = datetime('now')
         WHERE id = ?`,
        [s.site_name, s.site_type, s.category, s.tier,
         s.address, s.latitude, s.longitude,
         s.description, s.service_area,
         s.public_phone, s.public_address, s.contact_phone,
         existing.id]
      );
      console.log(`updated  ${s.slug}`);
    } else {
      db.run(
        `INSERT INTO permanent_pins
            (id, latitude, longitude, site_name, site_type, address,
             contact_phone, is_active, entity_kind, directory_listing, slug,
             tier, category, description, service_area,
             public_phone, public_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'supplier', 1, ?, ?, ?, ?, ?, ?, ?)`,
        [uuidv4(), s.latitude, s.longitude, s.site_name, s.site_type, s.address,
         s.contact_phone, s.slug, s.tier, s.category, s.description, s.service_area,
         s.public_phone, s.public_address]
      );
      console.log(`inserted ${s.slug}`);
    }
  }

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log('saved.');
})();
