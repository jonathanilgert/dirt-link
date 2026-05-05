// Reset Stage 5 e2e state. Run BEFORE starting the server.
const { getDb, run } = require('../database/init');
(async () => {
  await getDb();
  run(`DELETE FROM supplier_lead_notifications`);
  run(`DELETE FROM leads WHERE email LIKE '%stage5%example.com' OR email LIKE 'should-not-route%'`);
  run(`DELETE FROM permanent_pins WHERE site_name = 'Stage5 Aggregates Ltd.'`);
  run(`DELETE FROM api_keys WHERE name LIKE 'stage5-%'`);
  console.log('reset done');
  process.exit(0);
})();
