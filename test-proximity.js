#!/usr/bin/env node
// ─────────────────────────────────────────────────────────
// DirtLink Proximity Alerts — Integration Test Script
// Run:  node test-proximity.js
// ─────────────────────────────────────────────────────────
require('dotenv').config();
const { getDb, all, get, run, save } = require('./database/init');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');

// Calgary city center as baseline
const BASE_LAT = 51.0447;
const BASE_LNG = -114.0719;

// Offset ~3 km north-east (well within 10 km default radius)
const NEAR_LAT = 51.0700;
const NEAR_LNG = -114.0400;

// Offset ~60 km away (outside any radius)
const FAR_LAT = 51.5500;
const FAR_LNG = -114.0700;

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ✓ ${label}`);
    passed++;
  } else {
    console.log(`  ✗ FAIL: ${label}`);
    failed++;
  }
}

async function main() {
  await getDb();
  console.log('\n══════════════════════════════════════');
  console.log(' DirtLink Proximity Alerts Test Suite');
  console.log('══════════════════════════════════════\n');

  // ── Setup: create two test users ──
  console.log('--- Setup ---');

  const userA_id = uuidv4();
  const userB_id = uuidv4();
  const pwHash = bcrypt.hashSync('testpass123', 10);

  run(`INSERT INTO users (id, email, password_hash, company_name, contact_name, phone, user_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userA_id, `testA-${Date.now()}@test.com`, pwHash, 'Acme Excavation', 'Alice', '403-555-0001', 'powerhouse']);

  run(`INSERT INTO users (id, email, password_hash, company_name, contact_name, phone, user_type)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [userB_id, `testB-${Date.now()}@test.com`, pwHash, 'Beta Trucking', 'Bob', '403-555-0002', 'free']);

  const userA = get('SELECT * FROM users WHERE id = ?', [userA_id]);
  const userB = get('SELECT * FROM users WHERE id = ?', [userB_id]);
  assert(userA && userA.user_type === 'powerhouse', 'User A created as Powerhouse');
  assert(userB && userB.user_type === 'free', 'User B created as Free tier');

  // ── Create a pin for User A (the one who will monitor) ──
  const pinA_id = uuidv4();
  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [pinA_id, userA_id, 'have', 'clean_fill', BASE_LAT, BASE_LNG, '100 Centre St, Calgary', 'Acme Downtown Dig']);

  assert(!!get('SELECT id FROM pins WHERE id = ?', [pinA_id]), 'User A pin created at Calgary center');

  // ══════════════════════════════════════
  // Test 1: Plan eligibility check
  // ══════════════════════════════════════
  console.log('\n--- Test 1: Plan Eligibility ---');

  const { planSupportsProximity } = require('./services/proximity');
  assert(planSupportsProximity('powerhouse') === true, 'Powerhouse plan is eligible');
  assert(planSupportsProximity('enterprise') === true, 'Enterprise plan is eligible');
  assert(planSupportsProximity('pro') === false, 'Pro plan is NOT eligible');
  assert(planSupportsProximity('free') === false, 'Free plan is NOT eligible');

  // ══════════════════════════════════════
  // Test 2: Haversine distance calculation
  // ══════════════════════════════════════
  console.log('\n--- Test 2: Haversine Distance ---');

  const { haversineKm } = require('./services/proximity');

  const distNear = haversineKm(BASE_LAT, BASE_LNG, NEAR_LAT, NEAR_LNG);
  const distFar = haversineKm(BASE_LAT, BASE_LNG, FAR_LAT, FAR_LNG);
  const distSelf = haversineKm(BASE_LAT, BASE_LNG, BASE_LAT, BASE_LNG);

  console.log(`    Near point: ${distNear.toFixed(2)} km`);
  console.log(`    Far point:  ${distFar.toFixed(2)} km`);

  assert(distSelf === 0, 'Same point = 0 km');
  assert(distNear > 0 && distNear < 10, `Near point is within 10 km (${distNear.toFixed(2)} km)`);
  assert(distFar > 50, `Far point is beyond 50 km (${distFar.toFixed(2)} km)`);

  // ══════════════════════════════════════
  // Test 3: Bounding box pre-filter
  // ══════════════════════════════════════
  console.log('\n--- Test 3: Bounding Box ---');

  const { boundingBox } = require('./services/proximity');
  const box = boundingBox(BASE_LAT, BASE_LNG, 10);

  assert(NEAR_LAT >= box.minLat && NEAR_LAT <= box.maxLat, 'Near point within lat bounds');
  assert(NEAR_LNG >= box.minLng && NEAR_LNG <= box.maxLng, 'Near point within lng bounds');
  assert(FAR_LAT < box.minLat || FAR_LAT > box.maxLat, 'Far point outside lat bounds');

  // ══════════════════════════════════════
  // Test 4: Enable monitoring on User A's pin
  // ══════════════════════════════════════
  console.log('\n--- Test 4: Enable Monitoring ---');

  const settingId = uuidv4();
  run(`INSERT INTO proximity_alert_settings (id, user_id, pin_id, radius_km, notify_email, notify_sms, notify_in_app)
       VALUES (?, ?, ?, 10, 1, 0, 1)`,
    [settingId, userA_id, pinA_id]);

  const setting = get('SELECT * FROM proximity_alert_settings WHERE id = ?', [settingId]);
  assert(!!setting, 'Monitoring setting created');
  assert(setting.radius_km === 10, 'Default radius is 10 km');
  assert(setting.notify_in_app === 1, 'In-app notifications enabled');
  assert(setting.is_paused === 0, 'Monitoring is not paused');

  // ══════════════════════════════════════
  // Test 5: New nearby pin triggers notification
  // ══════════════════════════════════════
  console.log('\n--- Test 5: Nearby Pin Notification ---');

  const { notifyForNewPin } = require('./services/proximity');

  const nearbyPin = {
    id: uuidv4(),
    user_id: userB_id,
    latitude: NEAR_LAT,
    longitude: NEAR_LNG,
    address: '456 Nearby Ave NE, Calgary',
    title: 'Beta Fill Site'
  };

  // Insert the pin so it exists in DB
  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [nearbyPin.id, nearbyPin.user_id, 'need', 'gravel', nearbyPin.latitude, nearbyPin.longitude, nearbyPin.address, nearbyPin.title]);

  const notifications = notifyForNewPin(nearbyPin, 'material_listing', 'pins');

  assert(notifications.length > 0, `Notification generated (got ${notifications.length})`);
  assert(notifications[0].setting.uid === userA_id, 'Notification is for User A (Powerhouse)');
  assert(notifications[0].distanceKm < 10, `Distance is within radius (${notifications[0].distanceKm} km)`);

  // Check in-app notification was saved
  const inAppNotif = get('SELECT * FROM proximity_notifications WHERE recipient_id = ? ORDER BY created_at DESC LIMIT 1', [userA_id]);
  assert(!!inAppNotif, 'In-app notification saved to DB');
  assert(inAppNotif.trigger_type === 'material_listing', 'Trigger type is material_listing');
  assert(inAppNotif.is_read === 0, 'Notification is unread');
  assert(inAppNotif.title.includes('Acme Downtown Dig'), 'Title references monitored pin');
  console.log(`    Notification: "${inAppNotif.title}"`);
  console.log(`    Body: "${inAppNotif.body}"`);

  // ══════════════════════════════════════
  // Test 6: Far-away pin does NOT trigger notification
  // ══════════════════════════════════════
  console.log('\n--- Test 6: Far Pin — No Notification ---');

  const countBefore = get('SELECT COUNT(*) as c FROM proximity_notifications WHERE recipient_id = ?', [userA_id]).c;

  const farPin = {
    id: uuidv4(),
    user_id: userB_id,
    latitude: FAR_LAT,
    longitude: FAR_LNG,
    address: '999 Faraway Rd, Red Deer',
    title: 'Distant Site'
  };

  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [farPin.id, farPin.user_id, 'have', 'topsoil', farPin.latitude, farPin.longitude, farPin.address, farPin.title]);

  const farNotifs = notifyForNewPin(farPin, 'material_listing', 'pins');
  const countAfter = get('SELECT COUNT(*) as c FROM proximity_notifications WHERE recipient_id = ?', [userA_id]).c;

  assert(farNotifs.length === 0, 'No notifications for far-away pin');
  assert(countAfter === countBefore, 'No new DB notifications created');

  // ══════════════════════════════════════
  // Test 7: Own pin does NOT trigger self-notification
  // ══════════════════════════════════════
  console.log('\n--- Test 7: Self-Pin — No Self-Notification ---');

  const selfPin = {
    id: uuidv4(),
    user_id: userA_id, // same user as the monitor owner
    latitude: NEAR_LAT,
    longitude: NEAR_LNG,
    address: '789 Self St, Calgary',
    title: 'My Own New Pin'
  };

  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [selfPin.id, selfPin.user_id, 'have', 'clay', selfPin.latitude, selfPin.longitude, selfPin.address, selfPin.title]);

  const selfNotifs = notifyForNewPin(selfPin, 'material_listing', 'pins');
  assert(selfNotifs.length === 0, 'No self-notification when creating own pin');

  // ══════════════════════════════════════
  // Test 8: Paused monitoring — no notification
  // ══════════════════════════════════════
  console.log('\n--- Test 8: Paused Monitoring ---');

  run('UPDATE proximity_alert_settings SET is_paused = 1 WHERE id = ?', [settingId]);

  const pausedPin = {
    id: uuidv4(),
    user_id: userB_id,
    latitude: NEAR_LAT + 0.001,
    longitude: NEAR_LNG + 0.001,
    address: '321 Paused Test Ave',
    title: 'Should Not Alert'
  };

  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [pausedPin.id, pausedPin.user_id, 'need', 'sand', pausedPin.latitude, pausedPin.longitude, pausedPin.address, pausedPin.title]);

  const pausedNotifs = notifyForNewPin(pausedPin, 'material_listing', 'pins');
  assert(pausedNotifs.length === 0, 'No notification when monitoring is paused');

  // Unpause for remaining tests
  run('UPDATE proximity_alert_settings SET is_paused = 0 WHERE id = ?', [settingId]);

  // ══════════════════════════════════════
  // Test 9: Batch / Digest mode (bulk API import)
  // ══════════════════════════════════════
  console.log('\n--- Test 9: Batch Digest (Bulk Import) ---');

  const { notifyForNewPinsBatch } = require('./services/proximity');

  const countBeforeBatch = get('SELECT COUNT(*) as c FROM proximity_notifications WHERE recipient_id = ?', [userA_id]).c;

  const batchPermits = [];
  for (let i = 0; i < 5; i++) {
    const id = uuidv4();
    // Keep all 5 within ~1km of NEAR point (well within 10km radius of BASE)
    const lat = NEAR_LAT + (i * 0.0005);
    const lng = NEAR_LNG + (i * 0.0005);
    run(`INSERT INTO permit_pins (id, latitude, longitude, address, permit_number, permit_type, permit_date, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'unclaimed')`,
      [id, lat, lng, `${100 + i} Batch St, Calgary`, `BATCH-${Date.now()}-${i}`, 'Commercial', '2026-04-11']);
    batchPermits.push({ id, latitude: lat, longitude: lng, address: `${100 + i} Batch St, Calgary` });
  }

  notifyForNewPinsBatch(batchPermits, 'development_permit', 'permit_pins');

  const countAfterBatch = get('SELECT COUNT(*) as c FROM proximity_notifications WHERE recipient_id = ?', [userA_id]).c;
  const newBatchNotifs = countAfterBatch - countBeforeBatch;

  assert(newBatchNotifs === 1, `Batch created exactly 1 digest notification (got ${newBatchNotifs})`);

  // Find the digest notification specifically by trigger_type
  const digestNotif = get('SELECT * FROM proximity_notifications WHERE recipient_id = ? AND trigger_type = ? ORDER BY rowid DESC LIMIT 1', [userA_id, 'development_permit']);
  assert(!!digestNotif && digestNotif.title.includes('5 new site'), `Digest title mentions all 5 sites: "${digestNotif?.title}"`);
  assert(!!digestNotif && digestNotif.trigger_type === 'development_permit', 'Digest trigger type is development_permit');
  console.log(`    Digest: "${digestNotif?.title}"`);
  console.log(`    Body: "${digestNotif?.body}"`);

  // ══════════════════════════════════════
  // Test 10: Permit pin (single) triggers notification
  // ══════════════════════════════════════
  console.log('\n--- Test 10: Single Permit Pin ---');

  const permitId = uuidv4();
  run(`INSERT INTO permit_pins (id, latitude, longitude, address, permit_number, permit_type, permit_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'unclaimed')`,
    [permitId, NEAR_LAT - 0.005, NEAR_LNG - 0.005, '55 Permit Blvd, Calgary', `PERM-${Date.now()}`, 'Residential', '2026-05-01']);

  const permitPin = get('SELECT * FROM permit_pins WHERE id = ?', [permitId]);
  const permitNotifs = notifyForNewPin(permitPin, 'development_permit', 'permit_pins');

  assert(permitNotifs.length > 0, 'Permit pin triggered notification');
  const permitNotifDb = get('SELECT * FROM proximity_notifications WHERE trigger_permit_pin_id = ?', [permitId]);
  assert(!!permitNotifDb, 'Permit notification saved with correct FK');
  assert(permitNotifDb.body.includes('Development permit'), 'Body mentions "Development permit"');

  // ══════════════════════════════════════
  // Test 11: Custom radius enforcement
  // ══════════════════════════════════════
  console.log('\n--- Test 11: Custom Radius (5 km) ---');

  // Set radius to 5 km — the near test point (~3.3 km) should still trigger
  run('UPDATE proximity_alert_settings SET radius_km = 5 WHERE id = ?', [settingId]);

  const inRangePin = {
    id: uuidv4(), user_id: userB_id,
    latitude: BASE_LAT + 0.02, longitude: BASE_LNG + 0.02,
    address: 'Within 5km', title: 'Close Enough'
  };
  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [inRangePin.id, inRangePin.user_id, 'have', 'rock', inRangePin.latitude, inRangePin.longitude, inRangePin.address, inRangePin.title]);

  const dist5 = haversineKm(BASE_LAT, BASE_LNG, inRangePin.latitude, inRangePin.longitude);
  const range5Notifs = notifyForNewPin(inRangePin, 'material_listing', 'pins');

  console.log(`    Distance to pin: ${dist5.toFixed(2)} km`);
  assert(dist5 < 5, `Pin is within 5 km (${dist5.toFixed(2)} km)`);
  assert(range5Notifs.length > 0, 'Notification triggered within 5 km radius');

  // Now test a pin at ~8 km — should NOT trigger with 5 km radius
  const outOf5Pin = {
    id: uuidv4(), user_id: userB_id,
    latitude: BASE_LAT + 0.065, longitude: BASE_LNG,
    address: 'Beyond 5km', title: 'Too Far For 5km'
  };
  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [outOf5Pin.id, outOf5Pin.user_id, 'need', 'gravel', outOf5Pin.latitude, outOf5Pin.longitude, outOf5Pin.address, outOf5Pin.title]);

  const distOut = haversineKm(BASE_LAT, BASE_LNG, outOf5Pin.latitude, outOf5Pin.longitude);
  const out5Notifs = notifyForNewPin(outOf5Pin, 'material_listing', 'pins');

  console.log(`    Distance to pin: ${distOut.toFixed(2)} km`);
  assert(distOut > 5, `Pin is beyond 5 km (${distOut.toFixed(2)} km)`);
  assert(out5Notifs.length === 0, 'No notification beyond 5 km radius');

  // Reset radius
  run('UPDATE proximity_alert_settings SET radius_km = 10 WHERE id = ?', [settingId]);

  // ══════════════════════════════════════
  // Test 12: Global pause on user
  // ══════════════════════════════════════
  console.log('\n--- Test 12: Global User Pause ---');

  run('UPDATE users SET proximity_paused = 1 WHERE id = ?', [userA_id]);

  const globalPausePin = {
    id: uuidv4(), user_id: userB_id,
    latitude: NEAR_LAT, longitude: NEAR_LNG,
    address: 'Global Pause Test', title: 'During Global Pause'
  };
  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [globalPausePin.id, globalPausePin.user_id, 'have', 'topsoil', globalPausePin.latitude, globalPausePin.longitude, globalPausePin.address, globalPausePin.title]);

  const globalPauseNotifs = notifyForNewPin(globalPausePin, 'material_listing', 'pins');
  assert(globalPauseNotifs.length === 0, 'No notification when user has global pause on');

  run('UPDATE users SET proximity_paused = 0 WHERE id = ?', [userA_id]);

  // ══════════════════════════════════════
  // Test 13: Free user with monitoring — not eligible
  // ══════════════════════════════════════
  console.log('\n--- Test 13: Free User Not Eligible ---');

  const freePinId = uuidv4();
  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [freePinId, userB_id, 'have', 'sand', BASE_LAT + 0.001, BASE_LNG + 0.001, 'Free User Pin', 'Free Pin']);

  const freeSettingId = uuidv4();
  run(`INSERT INTO proximity_alert_settings (id, user_id, pin_id, radius_km, notify_in_app) VALUES (?, ?, ?, 10, 1)`,
    [freeSettingId, userB_id, freePinId]);

  // Create a nearby pin — User B (free) should NOT get notified
  const freeTestPin = {
    id: uuidv4(), user_id: userA_id,
    latitude: BASE_LAT + 0.005, longitude: BASE_LNG + 0.005,
    address: 'Near Free Pin', title: 'Free Shouldnt See'
  };
  run(`INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
    [freeTestPin.id, freeTestPin.user_id, 'need', 'clay', freeTestPin.latitude, freeTestPin.longitude, freeTestPin.address, freeTestPin.title]);

  const freeNotifs = notifyForNewPin(freeTestPin, 'material_listing', 'pins');
  const freeUserNotifCount = get('SELECT COUNT(*) as c FROM proximity_notifications WHERE recipient_id = ?', [userB_id]).c;
  assert(freeNotifs.filter(n => n.setting.uid === userB_id).length === 0, 'Free user did not receive proximity notification');
  assert(freeUserNotifCount === 0, 'No notifications in DB for free user');

  // ══════════════════════════════════════
  // Cleanup
  // ══════════════════════════════════════
  console.log('\n--- Cleanup ---');

  // Remove test data
  const testPinIds = [pinA_id, nearbyPin.id, farPin.id, selfPin.id, pausedPin.id, inRangePin.id, outOf5Pin.id, globalPausePin.id, freePinId, freeTestPin.id];
  for (const pid of testPinIds) {
    run('DELETE FROM pin_photos WHERE pin_id = ?', [pid]);
    run('DELETE FROM pins WHERE id = ?', [pid]);
  }
  for (const bp of batchPermits) {
    run('DELETE FROM permit_pins WHERE id = ?', [bp.id]);
  }
  run('DELETE FROM permit_pins WHERE id = ?', [permitId]);
  run('DELETE FROM proximity_notifications WHERE recipient_id IN (?, ?)', [userA_id, userB_id]);
  run('DELETE FROM proximity_alert_settings WHERE user_id IN (?, ?)', [userA_id, userB_id]);
  run('DELETE FROM users WHERE id IN (?, ?)', [userA_id, userB_id]);

  console.log('  Test data cleaned up.\n');

  // ══════════════════════════════════════
  // Summary
  // ══════════════════════════════════════
  console.log('══════════════════════════════════════');
  console.log(` Results: ${passed} passed, ${failed} failed`);
  console.log('══════════════════════════════════════\n');

  process.exit(failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error('Test script error:', err);
  process.exit(1);
});
