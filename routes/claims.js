// API surface for the supplier claim flow.
//   POST /api/claims/start             — auth: requireAuth, body { supplier_slug }
//   POST /api/claims/wizard/:claimId   — auth: requireAuth + claim ownership, body: step data
//   POST /api/admin/claims/approve/:id — auth: ADMIN_SECRET in body
//
// The page surfaces (/claim/:slug, /claim/:slug/verify/:token,
// /claim/:slug/wizard, /upgrade) live in server.js because they are
// HTML-rendered, not JSON, and need access to the partial cache.

const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { all, get, run } = require('../database/init');
const { startClaim, approveClaimManual } = require('../services/claims');

const router = express.Router();

router.post('/start', requireAuth, async (req, res) => {
  const slug = String(req.body && req.body.supplier_slug || '').toLowerCase().trim();
  if (!slug) return res.status(400).json({ error: 'supplier_slug required' });
  const result = await startClaim({ supplierSlug: slug, userId: req.session.userId });
  if (!result.ok) return res.status(409).json({ error: result.reason });
  res.json({
    status: result.status,                  // 'email_sent' | 'manual_review_pending'
    channel: result.channel,
    sentTo: result.sentTo,
    claimId: result.claimId
  });
});

// Save partial wizard data per step. Steps 1-2 mutate permanent_pins
// directly (basic + visibility fields). Steps 3-4 are gated — if user
// isn't on the corresponding tier, the API rejects the write so a
// power-user can't bypass the locked UI by hand-crafting the request.
router.post('/wizard/:claimId', requireAuth, (req, res) => {
  const claim = get(`SELECT * FROM supplier_claims WHERE id = ?`, [req.params.claimId]);
  if (!claim || claim.user_id !== req.session.userId) {
    return res.status(404).json({ error: 'claim_not_found' });
  }
  if (claim.status !== 'approved') return res.status(409).json({ error: 'claim_not_approved' });

  const supplier = get(`SELECT * FROM permanent_pins WHERE id = ?`, [claim.supplier_pin_id]);
  if (!supplier) return res.status(404).json({ error: 'supplier_gone' });

  const user = get(`SELECT user_type FROM users WHERE id = ?`, [req.session.userId]);
  const userTier = (user && user.user_type) || 'free';
  const tierRank = { free: 3, pro: 2, powerhouse: 1, enterprise: 0 };
  function atLeast(target) { return tierRank[userTier] <= tierRank[target]; }

  const step = parseInt(req.body && req.body.step, 10);
  const updates = [];
  const params  = [];

  if (step === 1) {
    // Basic info — Free OK
    if (req.body.category) { updates.push('category = ?'); params.push(String(req.body.category).slice(0, 64)); }
    if (Array.isArray(req.body.service_area)) {
      updates.push('service_area = ?'); params.push(JSON.stringify(req.body.service_area.slice(0, 32).map(s => String(s).slice(0, 64))));
    }
  } else if (step === 2) {
    // Visibility — Free OK
    updates.push('public_phone = ?');   params.push(req.body.public_phone   ? 1 : 0);
    updates.push('public_address = ?'); params.push(req.body.public_address ? 1 : 0);
  } else if (step === 3) {
    // Pro fields — gated
    if (!atLeast('pro')) return res.status(402).json({ error: 'upgrade_required', plan: 'pro' });
    if (req.body.description) { updates.push('description = ?'); params.push(String(req.body.description).slice(0, 250)); }
    if (req.body.website_url) { updates.push('website_url = ?'); params.push(String(req.body.website_url).slice(0, 240)); }
    if (req.body.business_hours && typeof req.body.business_hours === 'object') {
      updates.push('business_hours = ?'); params.push(JSON.stringify(req.body.business_hours));
    }
    if (Array.isArray(req.body.photos)) {
      updates.push('photos = ?'); params.push(JSON.stringify(req.body.photos.slice(0, 3).map(s => String(s).slice(0, 480))));
    }
    if (req.body.logo_url) { updates.push('logo_url = ?'); params.push(String(req.body.logo_url).slice(0, 480)); }
  } else if (step === 4) {
    // Powerhouse fields — gated. Lead form is implicit on Powerhouse+; the
    // step is mostly a confirmation. We still require Powerhouse to write.
    if (!atLeast('powerhouse')) return res.status(402).json({ error: 'upgrade_required', plan: 'powerhouse' });
    if (Array.isArray(req.body.photos)) {
      updates.push('photos = ?'); params.push(JSON.stringify(req.body.photos.slice(0, 10).map(s => String(s).slice(0, 480))));
    }
  } else {
    return res.status(400).json({ error: 'invalid_step' });
  }

  if (updates.length === 0) return res.json({ ok: true, noop: true });
  updates.push("updated_at = datetime('now')");
  params.push(supplier.id);
  run(`UPDATE permanent_pins SET ${updates.join(', ')} WHERE id = ?`, params);

  const refreshed = get(`SELECT * FROM permanent_pins WHERE id = ?`, [supplier.id]);
  res.json({ ok: true, supplier: refreshed });
});

// Admin manual approval — same secret pattern as /api/admin/create-key.
router.post('/admin/approve/:claimId', (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret)        return res.status(503).json({ error: 'ADMIN_SECRET not configured' });
  if (req.body && req.body.secret !== adminSecret) return res.status(403).json({ error: 'invalid_admin_secret' });

  const result = approveClaimManual({ claimId: req.params.claimId, approvedBy: 'admin' });
  if (!result.ok) return res.status(409).json(result);
  res.json(result);
});

module.exports = router;
