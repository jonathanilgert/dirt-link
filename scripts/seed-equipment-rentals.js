// One-time seed for the Equipment Rental category of /calgary/suppliers.
// Adds publicly listed Calgary-area equipment rental yards as free-tier
// directory listings (name, address, public phone, website, service area,
// map pin). All entries are unclaimed — owners can claim through the
// standard /claim/:slug flow to upgrade.
//
// Idempotent: re-running upserts by slug.
//
// Run on production:
//   ssh into the droplet, stop pm2, run:  node scripts/seed-equipment-rentals.js
//   start pm2 (server reloads dirtlink.db from disk on startup)

const path = require('path');
const fs = require('fs');
const initSqlJs = require('sql.js');
const { v4: uuidv4 } = require('uuid');

const DB_PATH = path.join(__dirname, '..', 'data', 'dirtlink.db');

const SUPPLIERS = [
  {
    slug: 'united-rentals-calgary-43-st-se',
    site_name: 'United Rentals — Calgary South (43 St SE)',
    category: 'equipment-rental',
    address: '4915 43 St SE, Calgary, AB T2B 3N4',
    latitude: 51.0202, longitude: -113.9755,
    contact_phone: '403-247-3300',
    website_url: 'https://www.unitedrentals.com/locations/ab/calgary',
    description: 'Earthmoving and general construction equipment rental — excavators, skid steers, loaders, compactors, light towers, aerial work platforms.',
    service_area: ['Calgary Metro', 'SE Calgary', 'Strathmore', 'Chestermere']
  },
  {
    slug: 'united-rentals-calgary-blackfoot',
    site_name: 'United Rentals — Calgary Blackfoot',
    category: 'equipment-rental',
    address: '7120 Blackfoot Trail SE, Calgary, AB T2H 2M1',
    latitude: 50.9885, longitude: -114.0440,
    contact_phone: '403-230-3900',
    website_url: 'https://www.unitedrentals.com/locations/ab/calgary',
    description: 'Full-service equipment rental yard — excavators, skid steers, dozers, compactors, generators, aerial lifts.',
    service_area: ['Calgary Metro', 'SE Calgary', 'SW Calgary', 'Okotoks']
  },
  {
    slug: 'united-rentals-trench-safety-calgary',
    site_name: 'United Rentals — Trench Safety Calgary',
    category: 'equipment-rental',
    address: '3639 8 St SE, Calgary, AB T2G 3A5',
    latitude: 51.0285, longitude: -114.0455,
    contact_phone: '403-243-1070',
    website_url: 'https://www.unitedrentals.com/locations/ab/calgary/trench-safety-rentals/s41',
    description: 'Specialty trench safety rentals — shoring boxes, slide rails, road plates, excavation safety equipment.',
    service_area: ['Calgary Metro', 'SE Calgary', 'Airdrie', 'Strathmore']
  },
  {
    slug: 'sunbelt-rentals-calgary-manitou-rd',
    site_name: 'Sunbelt Rentals — Calgary (Manitou Rd)',
    category: 'equipment-rental',
    address: '301 Manitou Rd SE, Calgary, AB T2G 4C2',
    latitude: 51.0295, longitude: -114.0345,
    contact_phone: '587-956-2353',
    website_url: 'https://www.sunbeltrentals.com/location/ca/ab/calgary/equipment-tool-rentals/7064/',
    description: 'General equipment and tool rental — mini excavators, skid steers, compactors, generators, aerial platforms.',
    service_area: ['Calgary Metro', 'Downtown Calgary', 'SE Calgary', 'Chestermere']
  },
  {
    slug: 'sunbelt-rentals-calgary-ne-aerial',
    site_name: 'Sunbelt Rentals — Calgary NE (Aerial)',
    category: 'equipment-rental',
    address: '1581 110 Ave NE, Calgary, AB T3K 0X9',
    latitude: 51.1485, longitude: -114.0145,
    contact_phone: '587-747-7891',
    website_url: 'https://www.sunbeltrentals.com/location/ca/ab/calgary/aerial-work-platform-rental/808/',
    description: 'Aerial work platform specialty branch — boom lifts, scissor lifts, telehandlers serving NE Calgary.',
    service_area: ['Calgary Metro', 'NE Calgary', 'Airdrie']
  },
  {
    slug: 'cat-rental-store-calgary-south',
    site_name: 'The Cat Rental Store — Calgary South (Finning)',
    category: 'equipment-rental',
    address: '11560 42 St SE, Calgary, AB T2Z 4E1',
    latitude: 50.9055, longitude: -113.9695,
    contact_phone: '403-640-4800',
    website_url: 'https://www.finning.com/en_CA/contact/branch-locator/the-cat-rental-store-of-calgary-ab-404cal.html',
    description: 'Caterpillar dealer rental yard — mini and full-size Cat excavators, dozers, skid steers, wheel loaders, compaction.',
    service_area: ['Calgary Metro', 'SE Calgary', 'Okotoks', 'High River']
  },
  {
    slug: 'cat-rental-store-calgary-north',
    site_name: 'The Cat Rental Store — Calgary North (Finning)',
    category: 'equipment-rental',
    address: '5292 55 St SE, Calgary, AB T2C 3G9',
    latitude: 50.9985, longitude: -113.9610,
    contact_phone: '403-731-2935',
    website_url: 'https://www.finning.com/en_CA/contact/branch-locator/the-cat-rental-store-of-calgary-ab.html',
    description: 'Cat rental yard for Calgary north and east — excavators, loaders, dozers, trench shoring for heavy civil and earthworks.',
    service_area: ['Calgary Metro', 'NE Calgary', 'Airdrie', 'Strathmore']
  },
  {
    slug: 'herc-rentals-calgary-25-st',
    site_name: 'Herc Rentals — Calgary (25 St SE)',
    category: 'equipment-rental',
    address: '4747 25 St SE, Calgary, AB T2B 3R9',
    latitude: 51.0220, longitude: -113.9925,
    contact_phone: '403-287-9494',
    website_url: 'https://www.hercrentals.com/ca/locations/alberta/calgary/calgary-25th-st.html',
    description: 'Full-line construction equipment rental — excavators, skid steers, telehandlers, compactors, light towers.',
    service_area: ['Calgary Metro', 'SE Calgary', 'Strathmore', 'Chestermere']
  },
  {
    slug: 'herc-rentals-calgary-meridian-rd',
    site_name: 'Herc Rentals — Calgary NE (Meridian Rd)',
    category: 'equipment-rental',
    address: '116 Meridian Rd SE, Calgary, AB T2A 2N6',
    latitude: 51.0410, longitude: -113.9810,
    contact_phone: '587-956-2360',
    website_url: 'https://www.hercrentals.com/ca/locations.html',
    description: 'Calgary east branch — earthmoving equipment, aerial platforms, generators, trench safety gear.',
    service_area: ['Calgary Metro', 'NE Calgary', 'SE Calgary', 'Airdrie']
  },
  {
    slug: 'home-depot-tool-rental-country-hills',
    site_name: 'Home Depot Tool Rental Center — Country Hills',
    category: 'equipment-rental',
    address: '388 Country Hills Blvd NE, Calgary, AB T3K 5J6',
    latitude: 51.1485, longitude: -114.0640,
    contact_phone: '403-226-7500',
    website_url: 'https://stores.homedepot.ca/ab/calgary/home-improvement-calgary-ab-7111.html',
    description: 'In-store tool rental — small skid steers, compactors, plate tampers, jackhammers, concrete tools for small earthworks jobs.',
    service_area: ['Calgary Metro', 'NW Calgary', 'NE Calgary', 'Airdrie']
  },
  {
    slug: 'home-depot-tool-rental-macleod-trail',
    site_name: 'Home Depot Tool Rental Center — Macleod Trail',
    category: 'equipment-rental',
    address: '6500 Macleod Trail SW, Calgary, AB T2H 0L9',
    latitude: 50.9930, longitude: -114.0720,
    contact_phone: '403-258-3800',
    website_url: 'https://stores.homedepot.ca/ab/calgary/home-improvement-calgary-ab-7063.html',
    description: 'In-store tool rental — mini excavators, skid steers, compactors, hand tools for small contractors and homeowners.',
    service_area: ['Calgary Metro', 'SW Calgary', 'Downtown Calgary', 'Okotoks']
  },
  {
    slug: 'home-depot-tool-rental-shawville',
    site_name: 'Home Depot Tool Rental Center — Shawville',
    category: 'equipment-rental',
    address: '390 Shawville Blvd SE, Calgary, AB T2Y 3S4',
    latitude: 50.9080, longitude: -114.0640,
    contact_phone: '403-201-5611',
    website_url: 'https://stores.homedepot.ca/ab/calgary/home-improvement-calgary-ab-7067.html',
    description: 'In-store tool rental serving south Calgary — skid steers, compactors, trenchers, concrete equipment.',
    service_area: ['Calgary Metro', 'SE Calgary', 'SW Calgary', 'Okotoks']
  },
  {
    slug: 'home-depot-tool-rental-126-ave-se',
    site_name: 'Home Depot Tool Rental Center — 126 Ave SE',
    category: 'equipment-rental',
    address: '5125 126 Ave SE, Calgary, AB T2Z 4B2',
    latitude: 50.9075, longitude: -113.9670,
    contact_phone: '403-257-8750',
    website_url: 'https://stores.homedepot.ca/ab/calgary/home-improvement-calgary-ab-7082.html',
    description: 'In-store tool rental in SE Calgary — small earthmoving tools, compactors, concrete equipment.',
    service_area: ['Calgary Metro', 'SE Calgary', 'Chestermere', 'Strathmore']
  },
  {
    slug: 'mini-dig-corp',
    site_name: 'Mini Dig Corp',
    category: 'equipment-rental',
    address: '2222 Alyth Pl SE, Calgary, AB T2G 3K9',
    latitude: 51.0345, longitude: -114.0345,
    contact_phone: '403-274-0090',
    website_url: 'https://minidig.com/',
    description: 'Calgary mini excavator specialist — micro and mini excavators (1.2t to 3.5t), full-size excavators, attachments, compaction for tight-access earthworks.',
    service_area: ['Calgary Metro', 'Downtown Calgary', 'SE Calgary', 'Cochrane']
  },
  {
    slug: 'rogers-rent-all',
    site_name: 'Rogers Rent-All',
    category: 'equipment-rental',
    address: '11915 16 St NE, Calgary, AB T3K 0S9',
    latitude: 51.1545, longitude: -114.0480,
    contact_phone: '403-276-5501',
    website_url: 'https://www.rogersrentall.ca/',
    description: 'Calgary independent rental yard serving Calgary and surrounding towns — mini excavators, skid steers, compactors, dump trailers, contractor tools.',
    service_area: ['Calgary Metro', 'NE Calgary', 'Airdrie', 'Cochrane', 'Okotoks', 'High River', 'Chestermere', 'Strathmore', 'Bragg Creek']
  },
  {
    slug: 'bandit-equipment-rentals',
    site_name: 'Bandit Equipment Rentals',
    category: 'equipment-rental',
    address: '6904 Silver Springs Rd NW, Calgary, AB T3B 3P8',
    latitude: 51.1085, longitude: -114.1840,
    contact_phone: null,
    website_url: 'https://banditrentals.ca/',
    description: 'Local Alberta-based heavy equipment rental serving Calgary and Airdrie — skid steers, mini excavators, compaction equipment.',
    service_area: ['Calgary Metro', 'NW Calgary', 'Airdrie', 'Cochrane']
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

  let created = 0, updated = 0;
  for (const s of SUPPLIERS) {
    const existing = get('SELECT id FROM permanent_pins WHERE slug = ?', [s.slug]);
    const serviceAreaJson = JSON.stringify(s.service_area);
    const publicPhone = s.contact_phone ? 1 : 0;

    if (existing) {
      db.run(
        `UPDATE permanent_pins SET
            site_name = ?, site_type = ?, category = ?, tier = ?,
            address = ?, latitude = ?, longitude = ?,
            description = ?, service_area = ?, website_url = ?,
            public_phone = ?, public_address = ?, contact_phone = ?,
            entity_kind = 'supplier', directory_listing = 1, is_active = 1,
            updated_at = datetime('now')
         WHERE id = ?`,
        [s.site_name, 'supplier', s.category, 'free',
         s.address, s.latitude, s.longitude,
         s.description, serviceAreaJson, s.website_url,
         publicPhone, 1, s.contact_phone,
         existing.id]
      );
      updated++;
      console.log(`updated  ${s.slug}`);
    } else {
      db.run(
        `INSERT INTO permanent_pins
           (id, latitude, longitude, site_name, site_type, address,
            contact_phone, website_url, is_active, entity_kind, directory_listing,
            slug, tier, category, description, service_area,
            public_phone, public_address)
         VALUES (?, ?, ?, ?, 'supplier', ?, ?, ?, 1, 'supplier', 1, ?, 'free', ?, ?, ?, ?, 1)`,
        [uuidv4(), s.latitude, s.longitude, s.site_name, s.address,
         s.contact_phone, s.website_url, s.slug, s.category, s.description,
         serviceAreaJson, publicPhone]
      );
      created++;
      console.log(`inserted ${s.slug}`);
    }
  }

  fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
  console.log(`\nsaved. created=${created} updated=${updated} total=${SUPPLIERS.length}`);
})();
