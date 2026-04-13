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

module.exports = router;
