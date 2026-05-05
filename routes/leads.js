// POST /api/leads — calculator lead capture.
//
// Important: result is recomputed server-side from the inputs. We never
// trust whatever the client posted in `result` — the email and DB row both
// reflect the server's calculation, which is the source of truth.

const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { calculateDisposalCost } = require('../lib/calculators/rates');
const { insertLead, sendAdminNotification, sendEstimateToUser } = require('../services/leads');
const { routeLead, notifyAdminForLead } = require('../services/lead-routing');
const { all, get, run } = require('../database/init');
const { leadLocationToArea } = require('../lib/area-vocab');

const router = express.Router();

const VALID_SOURCES = new Set([
  'calculator-disposal-cost-Calgary',
  'profile_lead_form'
]);

// Map calculator's material code → directory category slug.
// Used when feeding routeLead from the calculator path so suppliers get
// matched to the right category.
const MATERIAL_TO_CATEGORY = {
  'clean-fill': 'aggregate-pits',
  'topsoil':    'topsoil-yards',
  'sod':        'landscape-supply',
  'mixed':      'concrete-recyclers'
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Pure validation + recompute. Returns either { error, status } or
// { cleanEmail, cleanName, source, cleanInputs, result }. Exported for tests.
function validateAndCompute(body) {
  body = body || {};
  const { email, name, source, inputs } = body;

  if (!email || typeof email !== 'string' || !EMAIL_RE.test(email.trim())) {
    return { error: 'Valid email is required', status: 400 };
  }
  if (!source || !VALID_SOURCES.has(source)) {
    return { error: 'Unknown lead source', status: 400 };
  }
  if (!inputs || typeof inputs !== 'object') {
    return { error: 'Missing inputs', status: 400 };
  }

  const cleanEmail = email.trim().toLowerCase();
  let cleanName = null;
  if (name && typeof name === 'string') {
    const trimmed = name.trim().slice(0, 120);
    if (trimmed) cleanName = trimmed;
  }

  // Server-side recompute — never trust client-submitted dollar amounts.
  const result = calculateDisposalCost({
    loads: inputs.loads,
    materialType: inputs.materialType,
    quadrant: inputs.quadrant
  });

  const cleanInputs = {
    loads: result.loads,
    materialType: result.materialType,
    quadrant: result.quadrant
  };

  return { cleanEmail, cleanName, source, cleanInputs, result };
}

router.post('/', async (req, res) => {
  const v = validateAndCompute(req.body);
  if (v.error) return res.status(v.status).json({ error: v.error });

  const { cleanEmail, cleanName, source, cleanInputs, result } = v;
  const resultsUrl = req.body && req.body.resultsUrl;

  let lead;
  try {
    lead = insertLead({
      email: cleanEmail,
      name: cleanName,
      source,
      inputs: cleanInputs,
      result
    });

    // Backfill the routing fields so routeLead can match suppliers by
    // area + category. The calculator's quadrant maps to a vocab area.
    const leadArea = leadLocationToArea(cleanInputs.quadrant);
    const category = MATERIAL_TO_CATEGORY[cleanInputs.materialType] || null;
    run(
      `UPDATE leads SET location_area = ?, materials_needed = ?, categories = ?
        WHERE id = ?`,
      [leadArea, cleanInputs.materialType, category ? JSON.stringify([category]) : null, lead.id]
    );
    lead = get(`SELECT * FROM leads WHERE id = ?`, [lead.id]);
  } catch (err) {
    console.error('[leads] insert failed:', err);
    return res.status(500).json({ error: 'Could not save lead' });
  }

  // Fire-and-forget emails — don't make the user wait on SMTP.
  Promise.allSettled([
    sendAdminNotification({ email: cleanEmail, name: cleanName, source, inputs: cleanInputs, result }),
    sendEstimateToUser({ email: cleanEmail, name: cleanName, source, inputs: cleanInputs, result, resultsUrl })
  ]).catch(err => console.error('[leads] email batch error:', err));

  // Tier-priority routing to matching suppliers (Stage 5).
  let routed;
  try { routed = routeLead(lead); }
  catch (err) { console.error('[leads] routeLead failed:', err.message); }

  res.status(201).json({
    id: lead.id,
    status: 'received',
    message: 'Estimate sent to your email.',
    matched_suppliers: routed && routed.matched ? routed.matched.length : 0
  });
});

// ── Profile-page lead capture (Powerhouse+ only) ────────────────────────
// Stage 5: a Powerhouse+ supplier profile renders an embedded "request a
// quote" form. Submissions land here; we persist + route via routeLead.
const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.post('/profile', async (req, res) => {
  const b = req.body || {};
  if (!b.email || typeof b.email !== 'string' || !EMAIL_OK.test(b.email.trim())) {
    return res.status(400).json({ error: 'Valid email is required' });
  }
  if (!b.supplier_slug || typeof b.supplier_slug !== 'string') {
    return res.status(400).json({ error: 'supplier_slug required' });
  }

  const supplier = get(
    `SELECT * FROM permanent_pins
      WHERE slug = ? AND is_active = 1 AND entity_kind = 'supplier' AND directory_listing = 1`,
    [b.supplier_slug.toLowerCase().trim()]
  );
  if (!supplier) return res.status(404).json({ error: 'supplier_not_found' });

  // Only Powerhouse+ profiles render the lead form. Reject submissions to
  // a slug whose tier is below that — a free-tier supplier should never
  // surface a lead form, so a hit here is either a stale page or a
  // direct-API attempt.
  const tierRank = { enterprise: 0, powerhouse: 1, pro: 2, free: 3 };
  if (tierRank[supplier.tier] > tierRank.powerhouse) {
    return res.status(403).json({ error: 'lead_form_not_available_at_tier' });
  }

  const supplierAreas = (function () {
    try { return JSON.parse(supplier.service_area || '[]'); } catch { return []; }
  })();
  const inferredArea = supplierAreas[0] || null;

  const id = uuidv4();
  run(
    `INSERT INTO leads (id, email, name, phone, source, materials_needed, quantity,
                        location_area, categories, status, inputs, result)
     VALUES (?, ?, ?, ?, 'profile_lead_form', ?, ?, ?, ?, 'new', ?, ?)`,
    [
      id,
      b.email.trim().toLowerCase(),
      (b.name || '').toString().slice(0, 120) || null,
      (b.phone || '').toString().slice(0, 40) || null,
      (b.materials_needed || '').toString().slice(0, 240) || null,
      (b.message || b.quantity || '').toString().slice(0, 2000) || null,
      inferredArea,
      supplier.category ? JSON.stringify([supplier.category]) : null,
      JSON.stringify({ supplier_slug: supplier.slug }),
      JSON.stringify({})
    ]
  );
  const lead = get(`SELECT * FROM leads WHERE id = ?`, [id]);

  // Always-fires admin alert preserves prior behavior.
  Promise.resolve(notifyAdminForLead(lead)).catch(() => {});

  // Tier-priority routing.
  let routed;
  try { routed = routeLead(lead); }
  catch (err) { console.error('[leads/profile] routeLead failed:', err.message); }

  res.status(201).json({
    id: lead.id,
    status: 'received',
    matched_suppliers: routed && routed.matched ? routed.matched.length : 0
  });
});

module.exports = router;
module.exports.validateAndCompute = validateAndCompute;
module.exports.VALID_SOURCES = VALID_SOURCES;
