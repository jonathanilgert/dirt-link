// One-shot enrichment of the seed suppliers so all tier-gated render paths
// can be verified by curl in Stage 3 QA. Adds:
//   - photos + business_hours on Shepard (Powerhouse)
//   - is_sponsored_slot=1 + website_url on Bluegrass (Enterprise)
//   - a second Enterprise supplier in the aggregate-pits category so
//     siblings render on Bluegrass's profile.
const { v4: uuidv4 } = require('uuid');
const { getDb, run, get } = require('../database/init');

(async () => {
  // Ensure latest migrations (including is_sponsored_slot) are applied.
  const db = await getDb();

  // Shepard (Powerhouse) — photos + hours + website
  run(
    `UPDATE permanent_pins SET
       photos = ?,
       business_hours = ?,
       website_url = ?
     WHERE slug = 'shepard-soil-yards'`,
    [
      JSON.stringify([
        'https://dirtlink.ca/images/calgary/shepard-1.jpg',
        'https://dirtlink.ca/images/calgary/shepard-2.jpg',
        'https://dirtlink.ca/images/calgary/shepard-3.jpg',
        'https://dirtlink.ca/images/calgary/shepard-4.jpg'
      ]),
      JSON.stringify({
        monday:    { open: '07:00', close: '17:00' },
        tuesday:   { open: '07:00', close: '17:00' },
        wednesday: { open: '07:00', close: '17:00' },
        thursday:  { open: '07:00', close: '17:00' },
        friday:    { open: '07:00', close: '17:00' },
        saturday:  { open: '08:00', close: '14:00' }
      }),
      'https://example.com/shepard-soil'
    ]
  );

  // Bluegrass (Enterprise) — sponsored slot + website + photos
  run(
    `UPDATE permanent_pins SET
       is_sponsored_slot = 1,
       website_url = ?,
       photos = ?,
       services = ?
     WHERE slug = 'bluegrass-aggregate'`,
    [
      'https://example.com/bluegrass',
      JSON.stringify([
        'https://dirtlink.ca/images/calgary/bluegrass-1.jpg',
        'https://dirtlink.ca/images/calgary/bluegrass-2.jpg'
      ]),
      JSON.stringify(['road crush', 'pit run', 'concrete sand', '20mm minus'])
    ]
  );

  // Second supplier in aggregate-pits so Bluegrass has siblings.
  const exists = get(`SELECT id FROM permanent_pins WHERE slug = ?`, ['foothills-pit-co']);
  if (!exists) {
    run(
      `INSERT INTO permanent_pins
         (id, latitude, longitude, site_name, site_type, address,
          contact_phone, is_active, entity_kind, directory_listing, slug,
          tier, category, description, service_area,
          public_phone, public_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'supplier', 1, ?, ?, ?, ?, ?, ?, ?)`,
      [uuidv4(), 50.84, -114.13, 'Foothills Pit Co.', 'supplier',
       'Foothills, AB', '403-555-0104', 'foothills-pit-co',
       'pro', 'aggregate-pits',
       'Family-run pit south of Calgary. Tandem and triaxle pickup, no delivery.',
       JSON.stringify(['SW Calgary', 'Foothills', 'High River']),
       1, 0]
    );
    console.log('inserted foothills-pit-co');
  } else {
    console.log('foothills-pit-co already exists');
  }

  console.log('saved (init.js auto-saves on every run/get).');
  process.exit(0);
})();
