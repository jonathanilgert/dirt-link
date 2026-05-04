// Reset Foothills Pit Co. + clear stage4 test users so the e2e script
// can be re-run cleanly. Run BEFORE starting the server, since sql.js
// holds an exclusive in-memory copy once getDb() is called.

const { getDb, run } = require('../database/init');

(async () => {
  await getDb();
  run(`UPDATE permanent_pins SET claimed_by = NULL, claimed_at = NULL, tier = 'pro' WHERE slug = 'foothills-pit-co'`);
  run(`DELETE FROM supplier_claims
        WHERE supplier_pin_id IN (SELECT id FROM permanent_pins WHERE slug = 'foothills-pit-co')`);
  run(`DELETE FROM users WHERE email LIKE 'stage4-%@example.com'`);
  console.log('reset done');
  process.exit(0);
})();
