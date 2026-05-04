// Tier-priority lead routing for the DirtLink suppliers directory.
//
// SCAFFOLDED for launch (per the brief and E1):
//   - Delays implemented as in-process setTimeout. Restart-safe via
//     recoverPendingNotifications() called from server.js startup, which
//     re-arms timers for any rows still pending in the DB.
//   - Production migration path: replace the setTimeout fan-out with a
//     durable job queue (BullMQ on Redis, or AWS SQS) that polls
//     supplier_lead_notifications WHERE notified_at IS NULL AND
//     scheduled_for <= now(). The DB row is the durable record either way,
//     so the swap is contained to the scheduler — no schema change.
//
// Feature flag (E1): set LEAD_ROUTING_ENABLED=0 (or "false", or unset) to
// disable the routing entirely. Lead rows still persist; admin email still
// fires; just no supplier notifications get queued. Use this for incident
// rollback without redeploying.
//
// Feature flag (Stage 6 follow-up): LEAD_ROUTING_POWERHOUSE_ROTATION.
// Default OFF — every Powerhouse supplier matching a lead's area+category
// is notified, in parallel, at the tier's delay. When ON, the matched
// Powerhouse list will be reduced to a daily-rotated subset so each
// Powerhouse listing gets its turn rather than every-listing-every-time.
// The rotation algorithm itself is not yet implemented (see
// pickPowerhouseRotation below); flag is wired so the swap is a one-spot
// change once implemented.
//
// Tier policy (per the brief, with the C3 confirmation):
//   - Enterprise   notified at 0 min
//   - Powerhouse   at 15 min
//   - Pro          at 45 min
//   - Free         NEVER receives auto-routed leads (this is the entire
//                  monetization mechanic — see C3).
//   - If no Enterprise present, Powerhouse becomes the 0-min tier and
//     Pro becomes 15-min. Same collapse if Powerhouse is also absent.
//   - If no paid suppliers match, lead is routed to admin only.

const { v4: uuidv4 } = require('uuid');
const nodemailer = require('nodemailer');
const { all, get, run } = require('../database/init');
const { matchesArea, leadLocationToArea } = require('../lib/area-vocab');

const FROM_EMAIL  = process.env.FROM_EMAIL  || 'noreply@dirtlink.ca';
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'jonathanilgert@gmail.com';
const APP_URL     = process.env.APP_URL     || 'http://localhost:3000';

// Delay table — minutes, by tier, when the top tier present is enterprise.
const DELAYS_BY_TOP_TIER = {
  enterprise: { enterprise: 0, powerhouse: 15, pro: 45 },
  powerhouse: { powerhouse: 0, pro: 15 },
  pro:        { pro: 0 }
};
const TIER_RANK = { enterprise: 0, powerhouse: 1, pro: 2, free: 3 };

let _transport = null;
function getTransport() {
  if (_transport) return _transport;
  if (!process.env.SMTP_HOST) return null;
  _transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
  return _transport;
}

function isEnabled() {
  const v = process.env.LEAD_ROUTING_ENABLED;
  return !(v == null || v === '' || v === '0' || v === 'false' || v === 'FALSE');
}

function isPowerhouseRotationEnabled() {
  const v = process.env.LEAD_ROUTING_POWERHOUSE_ROTATION;
  return v === '1' || v === 'true' || v === 'TRUE';
}

// Reduce a list of matched Powerhouse suppliers to today's rotation
// subset. Today this is a no-op (returns the list unchanged) — the flag
// is wired so a future implementation can be dropped in here without
// touching routeLead. See follow-ups.md.
function pickPowerhouseRotation(powerhouseList, today = new Date()) {
  if (!isPowerhouseRotationEnabled()) return powerhouseList;
  // TODO: deterministic daily rotation by hash(date|slug). For now we
  // pass through unchanged — flipping the flag does not yet change
  // behavior, but the call-site is in place.
  return powerhouseList;
}

function parseList(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  try {
    const p = JSON.parse(raw);
    if (Array.isArray(p)) return p.filter(Boolean);
  } catch {}
  return String(raw).split(/[,;]/).map(s => s.trim()).filter(Boolean);
}

// Pure: given a lead and the universe of active supplier rows, return
// matching suppliers grouped by tier. Exported for tests.
function selectMatchingSuppliers({ lead, suppliers }) {
  const leadArea = leadLocationToArea(lead.location_area);
  const leadCategories = parseList(lead.categories || lead.material_category);
  const matches = suppliers.filter(s => {
    if (s.tier === 'free') return false; // C3
    const supplierAreas = parseList(s.service_area);
    if (!matchesArea(supplierAreas, leadArea)) return false;
    if (leadCategories.length === 0) return true; // unknown category → match all
    return leadCategories.includes(s.category);
  });
  const byTier = { enterprise: [], powerhouse: [], pro: [] };
  for (const s of matches) byTier[s.tier].push(s);
  return byTier;
}

// Compute the 0/15/45-min schedule, collapsing one tier upward when a
// higher tier is empty. Pure — exported for tests.
function planDelays(byTier) {
  if (byTier.enterprise.length) return DELAYS_BY_TOP_TIER.enterprise;
  if (byTier.powerhouse.length) return DELAYS_BY_TOP_TIER.powerhouse;
  if (byTier.pro.length)        return DELAYS_BY_TOP_TIER.pro;
  return null; // no paid suppliers → admin-only
}

function loadActiveSuppliersInDirectory() {
  return all(
    `SELECT id, slug, site_name, category, tier, service_area, contact_email
       FROM permanent_pins
      WHERE is_active = 1
        AND entity_kind = 'supplier'
        AND directory_listing = 1`
  );
}

// Main entry. lead: the row from leads (with category/area resolved).
// Returns { ok, matched: [{supplier_id, tier, scheduled_for, notification_id}], adminOnly, schedule }.
function routeLead(lead) {
  if (!isEnabled()) {
    return { ok: true, skipped: true, reason: 'flag_disabled' };
  }

  const suppliers = loadActiveSuppliersInDirectory();
  const byTier = selectMatchingSuppliers({ lead, suppliers });
  // Powerhouse rotation hook (currently no-op unless the flag flips on).
  byTier.powerhouse = pickPowerhouseRotation(byTier.powerhouse);
  const delays = planDelays(byTier);

  if (!delays) {
    return { ok: true, matched: [], adminOnly: true, schedule: null };
  }

  const matched = [];
  const allMatchedSupplierIds = [];

  for (const tier of Object.keys(delays)) {
    const delayMin = delays[tier];
    const scheduledFor = new Date(Date.now() + delayMin * 60_000).toISOString();
    for (const s of byTier[tier]) {
      const notificationId = uuidv4();
      run(
        `INSERT INTO supplier_lead_notifications
            (id, lead_id, supplier_id, tier_at_routing, scheduled_for, channel, status)
         VALUES (?, ?, ?, ?, ?, 'both', 'pending')`,
        [notificationId, lead.id, s.id, tier, scheduledFor]
      );
      allMatchedSupplierIds.push(s.id);
      matched.push({
        supplier_id: s.id, tier, scheduled_for: scheduledFor, notification_id: notificationId
      });

      if (delayMin === 0) {
        // Send immediately, in-process. Errors are swallowed (logged).
        sendNotification(notificationId).catch(err => console.error('[routeLead] send failed:', err.message));
      } else {
        // Schedule via setTimeout. Restart-safe via
        // recoverPendingNotifications().
        scheduleSendNotification(notificationId, delayMin * 60_000);
      }
    }
  }

  // Mark the lead matched and persist matched_suppliers for analytics.
  run(
    `UPDATE leads SET matched_suppliers = ?, status = 'matched' WHERE id = ?`,
    [JSON.stringify(allMatchedSupplierIds), lead.id]
  );

  return { ok: true, matched, schedule: delays, adminOnly: false };
}

const _scheduledTimers = new Map();

function scheduleSendNotification(notificationId, delayMs) {
  const cap = Math.min(delayMs, 6 * 60 * 60 * 1000); // 6h cap so a runaway can't pin a process
  const handle = setTimeout(() => {
    _scheduledTimers.delete(notificationId);
    sendNotification(notificationId).catch(err => console.error('[scheduler] send failed:', err.message));
  }, cap);
  _scheduledTimers.set(notificationId, handle);
}

// Re-arm timers for rows still pending after a process restart. Rows
// whose scheduled_for has already passed are sent immediately.
function recoverPendingNotifications() {
  if (!isEnabled()) return { recovered: 0, skipped: true };
  const pending = all(
    `SELECT id, scheduled_for FROM supplier_lead_notifications
      WHERE notified_at IS NULL AND status = 'pending'`
  );
  let immediate = 0, deferred = 0;
  for (const row of pending) {
    const t = Date.parse(row.scheduled_for);
    const wait = isFinite(t) ? Math.max(0, t - Date.now()) : 0;
    if (wait <= 0) {
      immediate++;
      sendNotification(row.id).catch(err => console.error('[recover] send failed:', err.message));
    } else {
      deferred++;
      scheduleSendNotification(row.id, wait);
    }
  }
  return { recovered: pending.length, immediate, deferred };
}

// Send a single notification: marks it sent in the DB, fires email if
// SMTP configured. The DB row is authoritative; email is a side-effect.
async function sendNotification(notificationId) {
  const note = get(`SELECT * FROM supplier_lead_notifications WHERE id = ?`, [notificationId]);
  if (!note || note.notified_at || note.status !== 'pending') return; // already done / cancelled
  const supplier = get(`SELECT * FROM permanent_pins WHERE id = ?`, [note.supplier_id]);
  const lead = get(`SELECT * FROM leads WHERE id = ?`, [note.lead_id]);
  if (!supplier || !lead) {
    run(
      `UPDATE supplier_lead_notifications SET status='dead', notified_at=datetime('now') WHERE id=?`,
      [notificationId]
    );
    return;
  }

  const tx = getTransport();
  const subject = `[DirtLink] New buyer lead near ${supplierAreasShort(supplier)}`;
  const body = renderEmailBody({ lead, supplier, note });
  let sentOk = false;

  // Email path (only if supplier has a contact email AND transport works).
  if (tx && supplier.contact_email) {
    try {
      await tx.sendMail({
        from: `DirtLink <${FROM_EMAIL}>`,
        to: supplier.contact_email,
        subject,
        text: body
      });
      sentOk = true;
    } catch (err) {
      console.error('[sln] email failed:', err.message);
    }
  }

  // Mark sent regardless of email success — the in-app notification (if
  // we add one) is the durable channel; email is best-effort. If the
  // email failed, status is 'sent' but we record nothing in
  // email_opened_at, which already implies non-delivery.
  run(
    `UPDATE supplier_lead_notifications
        SET notified_at = datetime('now'),
            status = 'sent'
      WHERE id = ?`,
    [notificationId]
  );
  return { sent: sentOk, notificationId };
}

function supplierAreasShort(supplier) {
  const arr = parseList(supplier.service_area);
  return arr[0] || 'Calgary';
}

function renderEmailBody({ lead, supplier, note }) {
  return [
    `New buyer lead routed to ${supplier.site_name} (${note.tier_at_routing} tier).`,
    ``,
    `Buyer:        ${lead.name || ''} <${lead.email}>`,
    lead.phone ? `Phone:        ${lead.phone}` : null,
    lead.materials_needed ? `Needs:        ${lead.materials_needed}` : null,
    lead.quantity ? `Quantity:     ${lead.quantity}` : null,
    lead.location_area ? `Area:         ${lead.location_area}` : null,
    `Source:       ${lead.source}`,
    ``,
    `Open your DirtLink dashboard to respond:`,
    `${APP_URL}/calgary/suppliers/${encodeURIComponent(supplier.slug)}`,
    ``,
    `(You're receiving this because ${supplier.site_name} is on the ${note.tier_at_routing} plan.)`
  ].filter(Boolean).join('\n');
}

// Always fire admin notification for every lead, regardless of routing
// outcome — preserves the existing behavior the leads service had.
async function notifyAdminForLead(lead) {
  const tx = getTransport();
  if (!tx) return;
  try {
    await tx.sendMail({
      from: `DirtLink <${FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `[DirtLink lead] ${lead.email} — ${lead.source}`,
      text: [
        `Lead id: ${lead.id}`,
        `Email:   ${lead.email}`,
        `Source:  ${lead.source}`,
        lead.phone ? `Phone:   ${lead.phone}` : null,
        lead.materials_needed ? `Needs:   ${lead.materials_needed}` : null,
        lead.location_area ? `Area:    ${lead.location_area}` : null,
        ``,
        `Routed: ${lead.matched_suppliers || '(none yet)'}`
      ].filter(Boolean).join('\n')
    });
  } catch (err) { console.error('[admin alert] failed:', err.message); }
}

module.exports = {
  routeLead,
  recoverPendingNotifications,
  notifyAdminForLead,
  // exported for tests:
  selectMatchingSuppliers,
  planDelays,
  isEnabled,
  isPowerhouseRotationEnabled,
  pickPowerhouseRotation,
  sendNotification
};
