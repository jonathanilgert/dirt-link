const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../database/init');
const { requireApiKey } = require('../middleware/apiKey');
const { rateLimit } = require('../middleware/rateLimit');
const { auditLog } = require('../middleware/auditLog');

const { notifyForNewPin, notifyForNewPinsBatch } = require('../services/proximity');

const router = express.Router();

// All external API routes require API key + rate limiting + audit logging
router.use(requireApiKey);
router.use(rateLimit({ windowMs: 60 * 1000, max: 60 }));
router.use(auditLog);

// --- Validation helpers ---

function validatePermitPin(pin) {
  const errors = [];
  if (pin.latitude == null || typeof pin.latitude !== 'number' || pin.latitude < -90 || pin.latitude > 90) {
    errors.push('latitude must be a number between -90 and 90');
  }
  if (pin.longitude == null || typeof pin.longitude !== 'number' || pin.longitude < -180 || pin.longitude > 180) {
    errors.push('longitude must be a number between -180 and 180');
  }
  if (!pin.address || typeof pin.address !== 'string' || !pin.address.trim()) {
    errors.push('address is required');
  }
  if (!pin.permit_number || typeof pin.permit_number !== 'string' || !pin.permit_number.trim()) {
    errors.push('permit_number is required');
  }
  if (!pin.permit_type || typeof pin.permit_type !== 'string' || !pin.permit_type.trim()) {
    errors.push('permit_type is required');
  }
  if (!pin.permit_date || typeof pin.permit_date !== 'string' || !pin.permit_date.trim()) {
    errors.push('permit_date is required');
  }
  return errors;
}

function validatePermanentPin(pin) {
  const errors = [];
  if (pin.latitude == null || typeof pin.latitude !== 'number' || pin.latitude < -90 || pin.latitude > 90) {
    errors.push('latitude must be a number between -90 and 90');
  }
  if (pin.longitude == null || typeof pin.longitude !== 'number' || pin.longitude < -180 || pin.longitude > 180) {
    errors.push('longitude must be a number between -180 and 180');
  }
  if (!pin.site_name || typeof pin.site_name !== 'string' || !pin.site_name.trim()) {
    errors.push('site_name is required');
  }
  if (!pin.site_type || typeof pin.site_type !== 'string' || !pin.site_type.trim()) {
    errors.push('site_type is required');
  }
  if (!pin.address || typeof pin.address !== 'string' || !pin.address.trim()) {
    errors.push('address is required');
  }
  return errors;
}

// --- Endpoint 1: Create Permit Pin ---

router.post('/permit-pins', (req, res) => {
  const errors = validatePermitPin(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { latitude, longitude, address, permit_number, permit_type, permit_date, project_description, estimated_project_size } = req.body;

  // Check for duplicate permit number
  const existing = get(`SELECT id FROM permit_pins WHERE permit_number = ?`, [permit_number.trim()]);
  if (existing) {
    return res.status(409).json({ error: 'A pin with this permit number already exists', existing_id: existing.id });
  }

  const id = uuidv4();
  run(
    `INSERT INTO permit_pins (id, latitude, longitude, address, permit_number, permit_type, permit_date, project_description, estimated_project_size, status, created_by_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', ?)`,
    [id, latitude, longitude, address.trim(), permit_number.trim(), permit_type.trim(), permit_date.trim(), project_description?.trim() || null, estimated_project_size?.trim() || null, req.apiKey.id]
  );

  const pin = get(`SELECT * FROM permit_pins WHERE id = ?`, [id]);

  // Trigger proximity alerts
  try { notifyForNewPin(pin, 'development_permit', 'permit_pins'); } catch (e) { console.error('[proximity] Error:', e.message); }

  res.status(201).json(pin);
});

// --- Endpoint 2: Create Permanent Pin ---

router.post('/permanent-pins', (req, res) => {
  const errors = validatePermanentPin(req.body);
  if (errors.length > 0) {
    return res.status(400).json({ error: 'Validation failed', details: errors });
  }

  const { latitude, longitude, site_name, site_type, address, contact_phone, contact_email, hours_of_operation, accepted_materials, rates_fees, website_url, notes, category, description, services } = req.body;

  const id = uuidv4();
  run(
    `INSERT INTO permanent_pins (id, latitude, longitude, site_name, site_type, address, contact_phone, contact_email, hours_of_operation, accepted_materials, rates_fees, website_url, notes, category, description, services, created_by_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, latitude, longitude, site_name.trim(), site_type.trim(), address.trim(), contact_phone?.trim() || null, contact_email?.trim() || null, hours_of_operation?.trim() || null, accepted_materials?.trim() || null, rates_fees?.trim() || null, website_url?.trim() || null, notes?.trim() || null, category?.trim() || null, description?.trim() || null, services?.trim() || null, req.apiKey.id]
  );

  const pin = get(`SELECT * FROM permanent_pins WHERE id = ?`, [id]);
  res.status(201).json(pin);
});

// --- Endpoint 3: Bulk Create ---

router.post('/bulk', (req, res) => {
  const { permit_pins, permanent_pins } = req.body;

  if (!permit_pins && !permanent_pins) {
    return res.status(400).json({ error: 'Request must include permit_pins and/or permanent_pins arrays' });
  }

  const results = { permit_pins: [], permanent_pins: [], errors: [] };

  // Process permit pins
  if (Array.isArray(permit_pins)) {
    if (permit_pins.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 permit pins per bulk request' });
    }
    permit_pins.forEach((pin, index) => {
      const errors = validatePermitPin(pin);
      if (errors.length > 0) {
        results.errors.push({ type: 'permit_pin', index, errors });
        return;
      }

      // Skip duplicates
      const existing = get(`SELECT id FROM permit_pins WHERE permit_number = ?`, [pin.permit_number.trim()]);
      if (existing) {
        results.errors.push({ type: 'permit_pin', index, errors: [`Duplicate permit number: ${pin.permit_number}`], existing_id: existing.id });
        return;
      }

      const id = uuidv4();
      run(
        `INSERT INTO permit_pins (id, latitude, longitude, address, permit_number, permit_type, permit_date, project_description, estimated_project_size, status, created_by_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'unclaimed', ?)`,
        [id, pin.latitude, pin.longitude, pin.address.trim(), pin.permit_number.trim(), pin.permit_type.trim(), pin.permit_date.trim(), pin.project_description?.trim() || null, pin.estimated_project_size?.trim() || null, req.apiKey.id]
      );
      results.permit_pins.push({ id, permit_number: pin.permit_number.trim() });
    });
  }

  // Process permanent pins
  if (Array.isArray(permanent_pins)) {
    if (permanent_pins.length > 500) {
      return res.status(400).json({ error: 'Maximum 500 permanent pins per bulk request' });
    }
    permanent_pins.forEach((pin, index) => {
      const errors = validatePermanentPin(pin);
      if (errors.length > 0) {
        results.errors.push({ type: 'permanent_pin', index, errors });
        return;
      }

      const id = uuidv4();
      run(
        `INSERT INTO permanent_pins (id, latitude, longitude, site_name, site_type, address, contact_phone, contact_email, hours_of_operation, accepted_materials, rates_fees, website_url, notes, category, description, services, created_by_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, pin.latitude, pin.longitude, pin.site_name.trim(), pin.site_type.trim(), pin.address.trim(), pin.contact_phone?.trim() || null, pin.contact_email?.trim() || null, pin.hours_of_operation?.trim() || null, pin.accepted_materials?.trim() || null, pin.rates_fees?.trim() || null, pin.website_url?.trim() || null, pin.notes?.trim() || null, pin.category?.trim() || null, pin.description?.trim() || null, pin.services?.trim() || null, req.apiKey.id]
      );
      results.permanent_pins.push({ id, site_name: pin.site_name.trim() });
    });
  }

  // Trigger batched proximity alerts for all newly created permit pins
  if (results.permit_pins.length > 0) {
    try {
      const newPermits = results.permit_pins.map(p => get(`SELECT * FROM permit_pins WHERE id = ?`, [p.id])).filter(Boolean);
      if (newPermits.length > 0) {
        notifyForNewPinsBatch(newPermits, 'development_permit', 'permit_pins');
      }
    } catch (e) { console.error('[proximity] Batch error:', e.message); }
  }

  const status = results.errors.length > 0 ? 207 : 201;
  res.status(status).json({
    summary: {
      permit_pins_created: results.permit_pins.length,
      permanent_pins_created: results.permanent_pins.length,
      errors: results.errors.length
    },
    ...results
  });
});

// --- Read endpoints (for verification) ---

router.get('/permit-pins', (req, res) => {
  const { status, limit, offset } = req.query;
  let query = `SELECT * FROM permit_pins WHERE is_active = 1`;
  const params = [];

  if (status) {
    query += ` AND status = ?`;
    params.push(status);
  }
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit) || 100, parseInt(offset) || 0);

  res.json(all(query, params));
});

router.get('/permanent-pins', (req, res) => {
  const { site_type, limit, offset } = req.query;
  let query = `SELECT * FROM permanent_pins WHERE is_active = 1`;
  const params = [];

  if (site_type) {
    query += ` AND site_type = ?`;
    params.push(site_type);
  }
  query += ` ORDER BY created_at DESC LIMIT ? OFFSET ?`;
  params.push(parseInt(limit) || 100, parseInt(offset) || 0);

  res.json(all(query, params));
});

// --- Hubert ingestion endpoint (E3) ---
//
// POST /suppliers/ingest — bulk upsert of supplier rows into permanent_pins.
// Idempotent on (name + address) or (name + phone) when address is missing.
// Scope-guarded: caller's API key must include "external:supplier-ingest"
// (or have NULL scopes for backwards-compat).
//
// Every ingested record lands with entity_kind='supplier',
// directory_listing=0, tier='free', claimed=false. They stay invisible to
// public users until Jonathan reviews the pin-classification CSV and
// flips directory_listing manually. This is the safety net against bad
// data going live.
const { requireApiKeyScope } = require('../middleware/apiKey');
const { CATEGORIES } = require('../lib/directory-categories');
const { normalizeAreas } = require('../lib/area-vocab');

const VALID_CATEGORY = new Set(CATEGORIES.map(c => c.slug));
const MAX_INGEST_BATCH = 100;

function validateSupplier(rec) {
  const errors = [];
  if (!rec || typeof rec !== 'object') return ['record must be an object'];
  if (!rec.name || typeof rec.name !== 'string' || !rec.name.trim()) errors.push('name is required');
  if (!rec.category || !VALID_CATEGORY.has(rec.category)) {
    errors.push(`category must be one of: ${[...VALID_CATEGORY].join(', ')}`);
  }
  const areas = normalizeAreas(rec.serviceArea || rec.service_area);
  if (!areas.ok) errors.push(...areas.errors.map(e => 'serviceArea: ' + e));
  if (rec.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(rec.email).trim())) {
    errors.push('email is malformed');
  }
  if (rec.website && typeof rec.website === 'string' && !/^https?:\/\//i.test(rec.website.trim())) {
    errors.push('website must start with http(s)://');
  }
  if (rec.latitude != null && (typeof rec.latitude !== 'number' || rec.latitude < -90 || rec.latitude > 90)) {
    errors.push('latitude out of range');
  }
  if (rec.longitude != null && (typeof rec.longitude !== 'number' || rec.longitude < -180 || rec.longitude > 180)) {
    errors.push('longitude out of range');
  }
  return errors;
}

function findExistingSupplier(rec) {
  const name = rec.name.trim();
  const address = (rec.address || '').trim();
  const phone   = (rec.phone   || '').trim();
  if (address) {
    const byAddr = get(
      `SELECT * FROM permanent_pins WHERE site_name = ? AND address = ?`,
      [name, address]
    );
    if (byAddr) return byAddr;
  }
  if (phone) {
    const byPhone = get(
      `SELECT * FROM permanent_pins WHERE site_name = ? AND contact_phone = ?`,
      [name, phone]
    );
    if (byPhone) return byPhone;
  }
  return null;
}

router.post('/suppliers/ingest', requireApiKeyScope('external:supplier-ingest'), (req, res) => {
  const records = Array.isArray(req.body) ? req.body : (req.body && req.body.suppliers);
  if (!Array.isArray(records)) {
    return res.status(400).json({ error: 'Body must be an array (or {suppliers: [...]})' });
  }
  if (records.length === 0) return res.json({ summary: { created: 0, updated: 0, rejected: 0 }, results: [] });
  if (records.length > MAX_INGEST_BATCH) {
    return res.status(413).json({ error: `Too many records — cap is ${MAX_INGEST_BATCH} per request` });
  }

  const results = [];
  let created = 0, updated = 0, rejected = 0;

  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    const errors = validateSupplier(rec);
    if (errors.length) {
      rejected++;
      results.push({ index: i, action: 'rejected', name: (rec && rec.name) || null, errors });
      continue;
    }

    const areasNorm = normalizeAreas(rec.serviceArea || rec.service_area);
    const serviceAreaJson = JSON.stringify(areasNorm.areas);
    const name = rec.name.trim();
    const existing = findExistingSupplier(rec);

    if (existing) {
      run(
        `UPDATE permanent_pins
            SET site_type      = COALESCE(?, site_type),
                category       = ?,
                service_area   = ?,
                contact_phone  = COALESCE(NULLIF(?, ''), contact_phone),
                contact_email  = COALESCE(NULLIF(?, ''), contact_email),
                website_url    = COALESCE(NULLIF(?, ''), website_url),
                description    = COALESCE(NULLIF(?, ''), description),
                address        = COALESCE(NULLIF(?, ''), address),
                latitude       = COALESCE(?, latitude),
                longitude      = COALESCE(?, longitude),
                entity_kind    = 'supplier',
                updated_at     = datetime('now')
          WHERE id = ?`,
        [
          rec.site_type || 'supplier',
          rec.category,
          serviceAreaJson,
          (rec.phone || '').trim(),
          (rec.email || '').trim(),
          (rec.website || '').trim(),
          (rec.description || '').trim(),
          (rec.address || '').trim(),
          typeof rec.latitude  === 'number' ? rec.latitude  : null,
          typeof rec.longitude === 'number' ? rec.longitude : null,
          existing.id
        ]
      );
      updated++;
      results.push({ index: i, action: 'updated', pin_id: existing.id, name });
    } else {
      const id = uuidv4();
      run(
        `INSERT INTO permanent_pins
           (id, latitude, longitude, site_name, site_type, address,
            contact_phone, contact_email, website_url, description,
            category, service_area, is_active, entity_kind, directory_listing,
            tier, public_phone, public_address, created_by_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'supplier', 0, 'free', 0, 0, ?)`,
        [
          id,
          typeof rec.latitude  === 'number' ? rec.latitude  : 51.0447,  // Calgary centroid fallback
          typeof rec.longitude === 'number' ? rec.longitude : -114.0719,
          name,
          rec.site_type || 'supplier',
          (rec.address || '').trim(),
          (rec.phone   || '').trim() || null,
          (rec.email   || '').trim() || null,
          (rec.website || '').trim() || null,
          (rec.description || '').trim() || null,
          rec.category,
          serviceAreaJson,
          req.apiKey.id
        ]
      );
      created++;
      results.push({ index: i, action: 'created', pin_id: id, name });
    }
  }

  res.json({ summary: { created, updated, rejected }, results });
});

// --- Read-only inspector (D1, Stage 6) ---
//
// GET /admin/inspect-pins — dump permanent_pins + permit_pins so the user
// can regenerate the pin-classification CSV without granting SSH or
// pulling a DB file. Mounted on the same router so it inherits the same
// requireApiKey + rateLimit + auditLog. Scope: 'admin:read' (or NULL
// scopes for back-compat).
//
// Querystring filters:
//   ?entity_kind=supplier   — only directory-eligible rows
//   ?include_permits=true   — also include permit_pins
router.get('/admin/inspect-pins', requireApiKeyScope('admin:read'), (req, res) => {
  const conditions = [`is_active = 1`];
  const params = [];
  if (req.query.entity_kind) {
    conditions.push(`entity_kind = ?`);
    params.push(String(req.query.entity_kind));
  }
  const permanent = all(
    `SELECT * FROM permanent_pins WHERE ${conditions.join(' AND ')} ORDER BY site_name`,
    params
  );
  const includePermits = String(req.query.include_permits || '').toLowerCase() === 'true';
  const permits = includePermits
    ? all(`SELECT * FROM permit_pins WHERE is_active = 1 ORDER BY permit_date DESC`)
    : [];
  res.json({
    permanent_pins: permanent,
    permit_pins:    permits,
    counts: {
      permanent_pins: permanent.length,
      permit_pins:    permits.length
    },
    generated_at: new Date().toISOString()
  });
});

// --- Permit pin management by permit_number (for Hubert relevance pruning) ---
//
// These three endpoints let Hubert manage permit_pins by the natural key
// (permit_number) instead of the internal UUID. They never touch
// permanent_pins. Soft-deactivation (is_active=0) is preferred over hard
// delete so a misfire can be undone with /reactivate.
//
// permit_number is NOT unique in the schema, so a single number can match
// multiple rows; all rows for a given permit_number are updated together.

const MAX_PERMIT_NUMBER_BATCH = 1000;

function parsePermitNumbers(req) {
  const body = req.body || {};
  const list = body.permit_numbers;
  if (!Array.isArray(list)) {
    return { error: 'permit_numbers must be an array of strings' };
  }
  if (list.length === 0) {
    return { error: 'permit_numbers must not be empty' };
  }
  if (list.length > MAX_PERMIT_NUMBER_BATCH) {
    return { error: `Maximum ${MAX_PERMIT_NUMBER_BATCH} permit_numbers per request` };
  }
  const seen = new Set();
  const cleaned = [];
  for (const v of list) {
    if (typeof v !== 'string') return { error: 'permit_numbers must contain only strings' };
    const t = v.trim();
    if (!t) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    cleaned.push(t);
  }
  if (cleaned.length === 0) return { error: 'permit_numbers contained no non-empty values' };
  return { permit_numbers: cleaned };
}

// POST /permit-pins/deactivate
// Body: { "permit_numbers": ["DP2026-00196", ...] }
// Sets is_active = 0 on every permit_pin matching any supplied permit_number.
router.post('/permit-pins/deactivate', (req, res) => {
  const parsed = parsePermitNumbers(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let matched = 0, deactivated = 0, already_inactive = 0;
  const missing = [];

  for (const permitNumber of parsed.permit_numbers) {
    const rows = all(
      `SELECT id, is_active FROM permit_pins WHERE permit_number = ?`,
      [permitNumber]
    );
    if (rows.length === 0) {
      missing.push(permitNumber);
      continue;
    }
    for (const row of rows) {
      matched++;
      if (row.is_active === 0) {
        already_inactive++;
      } else {
        run(
          `UPDATE permit_pins SET is_active = 0, updated_at = datetime('now') WHERE id = ?`,
          [row.id]
        );
        deactivated++;
      }
    }
  }

  res.json({ matched, deactivated, already_inactive, missing });
});

// POST /permit-pins/reactivate
// Body: { "permit_numbers": ["DP2026-00196", ...] }
// Inverse of /deactivate — sets is_active = 1.
router.post('/permit-pins/reactivate', (req, res) => {
  const parsed = parsePermitNumbers(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  let matched = 0, reactivated = 0, already_active = 0;
  const missing = [];

  for (const permitNumber of parsed.permit_numbers) {
    const rows = all(
      `SELECT id, is_active FROM permit_pins WHERE permit_number = ?`,
      [permitNumber]
    );
    if (rows.length === 0) {
      missing.push(permitNumber);
      continue;
    }
    for (const row of rows) {
      matched++;
      if (row.is_active === 1) {
        already_active++;
      } else {
        run(
          `UPDATE permit_pins SET is_active = 1, updated_at = datetime('now') WHERE id = ?`,
          [row.id]
        );
        reactivated++;
      }
    }
  }

  res.json({ matched, reactivated, already_active, missing });
});

// POST /permit-pins/by-permit-numbers
// Body: { "permit_numbers": ["DP2026-00196", ...] }
// Lookup helper so Hubert can verify state without scraping the full list.
// Returns full rows (both active and inactive) grouped by permit_number.
router.post('/permit-pins/by-permit-numbers', (req, res) => {
  const parsed = parsePermitNumbers(req);
  if (parsed.error) return res.status(400).json({ error: parsed.error });

  const results = {};
  const missing = [];
  for (const permitNumber of parsed.permit_numbers) {
    const rows = all(
      `SELECT * FROM permit_pins WHERE permit_number = ? ORDER BY created_at DESC`,
      [permitNumber]
    );
    if (rows.length === 0) {
      missing.push(permitNumber);
    } else {
      results[permitNumber] = rows;
    }
  }

  res.json({
    found: Object.keys(results).length,
    missing,
    permit_pins: results
  });
});

module.exports = router;
