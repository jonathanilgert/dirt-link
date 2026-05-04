// Supplier listing claim flow. Three states:
//   1. start(slug, userId) → creates a supplier_claims row.
//      Tries to send a verification email to the supplier's contact email
//      on file. If SES is unavailable / sandbox-bounces / no email exists,
//      falls back to a manual-review queue (admin notified by email).
//   2. verifyByToken(token, userId) → marks claim approved AND copies the
//      claim onto the permanent_pin (claimed_by, claimed_at), then syncs
//      the user's tier to the pin via lib/tier-sync.js.
//   3. approveManual(claimId, adminId) → admin path for the manual queue.
//
// SES sandbox handling: nodemailer throws on send failure, which we catch
// and fall back. When SES is moved to production, the email path activates
// automatically — no code change needed.

const { v4: uuidv4 } = require('uuid');
const crypto = require('crypto');
const nodemailer = require('nodemailer');
const { all, get, run } = require('../database/init');
const { syncTierForUser } = require('../lib/tier-sync');

const FROM_EMAIL = process.env.FROM_EMAIL || 'messages@dirtlink.ca';
const APP_URL    = process.env.APP_URL    || 'http://localhost:3000';
const ADMIN_EMAIL = 'jonathanilgert@gmail.com';

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

// ── start a claim ────────────────────────────────────────────────────────
async function startClaim({ supplierSlug, userId }) {
  const supplier = get(
    `SELECT * FROM permanent_pins
      WHERE slug = ? AND is_active = 1 AND entity_kind = 'supplier' AND directory_listing = 1`,
    [supplierSlug]
  );
  if (!supplier) return { ok: false, reason: 'supplier_not_found' };
  if (supplier.claimed_by) return { ok: false, reason: 'already_claimed' };

  const user = get(`SELECT * FROM users WHERE id = ?`, [userId]);
  if (!user) return { ok: false, reason: 'user_not_found' };

  // Reuse an in-progress claim row by this user for this supplier if one exists.
  const existing = get(
    `SELECT * FROM supplier_claims
      WHERE supplier_pin_id = ? AND user_id = ? AND status IN ('email_sent', 'manual_review_pending')`,
    [supplier.id, userId]
  );

  const claimId = existing ? existing.id : uuidv4();
  const token   = existing ? existing.verification_token : crypto.randomBytes(24).toString('hex');

  const emailOnFile = supplier.contact_email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supplier.contact_email)
    ? supplier.contact_email.trim()
    : null;

  let status, channel, sentTo;

  if (emailOnFile) {
    const sent = await trySendVerificationEmail({
      to: emailOnFile,
      supplier,
      user,
      token
    });
    if (sent.ok) {
      status  = 'email_sent';
      channel = 'email';
      sentTo  = emailOnFile;
    } else {
      // SES bounced (sandbox), transport not configured, or other failure.
      // Fall back to manual review and notify admin.
      status  = 'manual_review_pending';
      channel = 'manual';
      sentTo  = null;
      await notifyAdminOfManualClaim({ supplier, user, reason: sent.reason || 'send_failed' });
    }
  } else {
    status  = 'manual_review_pending';
    channel = 'manual';
    sentTo  = null;
    await notifyAdminOfManualClaim({ supplier, user, reason: 'no_email_on_file' });
  }

  if (existing) {
    run(
      `UPDATE supplier_claims SET status = ?, verification_channel = ?,
              verification_sent_to = ?, updated_at = datetime('now')
         WHERE id = ?`,
      [status, channel, sentTo, claimId]
    );
  } else {
    run(
      `INSERT INTO supplier_claims
        (id, supplier_pin_id, user_id, status, verification_token,
         verification_sent_to, verification_channel)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [claimId, supplier.id, userId, status, token, sentTo, channel]
    );
  }

  return { ok: true, status, channel, sentTo, claimId };
}

async function trySendVerificationEmail({ to, supplier, user, token }) {
  const tx = getTransport();
  if (!tx) return { ok: false, reason: 'no_transport' };
  const verifyUrl = `${APP_URL}/claim/${encodeURIComponent(supplier.slug)}/verify/${encodeURIComponent(token)}`;
  try {
    await tx.sendMail({
      from: `DirtLink <${FROM_EMAIL}>`,
      to,
      subject: `Verify your DirtLink listing for ${supplier.site_name}`,
      text: [
        `Hi,`,
        ``,
        `${user.contact_name || user.email} (${user.email}) is requesting to claim the DirtLink directory listing for ${supplier.site_name}.`,
        ``,
        `If this is your business, click the link below to verify and start managing the listing:`,
        verifyUrl,
        ``,
        `If you don't recognise this request, ignore this email — no action will be taken without verification.`,
        ``,
        `— DirtLink`
      ].join('\n')
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err && err.message ? err.message : 'send_failed' };
  }
}

async function notifyAdminOfManualClaim({ supplier, user, reason }) {
  const tx = getTransport();
  if (!tx) {
    // Silent in dev when no SMTP configured; the row in supplier_claims
    // is the durable record an admin can act on later.
    console.log(`[claims] manual review queued for ${supplier.slug} by ${user.email} (reason: ${reason})`);
    return;
  }
  try {
    await tx.sendMail({
      from: `DirtLink <${FROM_EMAIL}>`,
      to: ADMIN_EMAIL,
      subject: `[DirtLink] Manual review needed: ${supplier.site_name}`,
      text: [
        `New claim awaiting manual review.`,
        ``,
        `Supplier:  ${supplier.site_name}`,
        `Slug:      ${supplier.slug}`,
        `Pin id:    ${supplier.id}`,
        ``,
        `Claimed by: ${user.contact_name || ''} <${user.email}>  (user id: ${user.id})`,
        ``,
        `Reason for manual: ${reason}`,
        ``,
        `Approve via:`,
        `  POST /api/admin/claims/approve/<claim id>`,
        `  with body { secret: ADMIN_SECRET }`,
        ``,
        `(Pending claim row in DB has supplier_pin_id=${supplier.id} and user_id=${user.id}.)`
      ].join('\n')
    });
  } catch (err) {
    console.error('[claims] admin email failed:', err.message);
  }
}

// ── verify a claim by token ──────────────────────────────────────────────
function verifyClaimByToken({ token, userId }) {
  if (!token) return { ok: false, reason: 'no_token' };
  const claim = get(
    `SELECT * FROM supplier_claims WHERE verification_token = ?`,
    [token]
  );
  if (!claim) return { ok: false, reason: 'token_not_found' };
  if (claim.status === 'approved') {
    // Idempotent: already done. Surface the supplier so the caller can
    // redirect to the wizard.
    const supplier = get(`SELECT * FROM permanent_pins WHERE id = ?`, [claim.supplier_pin_id]);
    return { ok: true, alreadyApproved: true, claim, supplier };
  }
  if (claim.status !== 'email_sent') return { ok: false, reason: 'invalid_state' };
  if (claim.user_id !== userId) return { ok: false, reason: 'wrong_user' };

  return finaliseApproval(claim, userId);
}

// ── admin manual approval ────────────────────────────────────────────────
function approveClaimManual({ claimId, approvedBy }) {
  const claim = get(`SELECT * FROM supplier_claims WHERE id = ?`, [claimId]);
  if (!claim) return { ok: false, reason: 'claim_not_found' };
  if (claim.status === 'approved') return { ok: true, alreadyApproved: true };
  if (claim.status === 'rejected') return { ok: false, reason: 'already_rejected' };
  return finaliseApproval(claim, approvedBy);
}

function finaliseApproval(claim, approvedBy) {
  const supplier = get(`SELECT * FROM permanent_pins WHERE id = ?`, [claim.supplier_pin_id]);
  if (!supplier) return { ok: false, reason: 'supplier_gone' };
  if (supplier.claimed_by && supplier.claimed_by !== claim.user_id) {
    // Race: another user claimed in the interim. Reject this claim.
    run(
      `UPDATE supplier_claims SET status='rejected', rejected_reason='race_lost',
              updated_at=datetime('now') WHERE id=?`,
      [claim.id]
    );
    return { ok: false, reason: 'race_lost' };
  }

  run(
    `UPDATE permanent_pins
        SET claimed_by = ?, claimed_at = datetime('now'), updated_at = datetime('now')
      WHERE id = ?`,
    [claim.user_id, supplier.id]
  );

  run(
    `UPDATE supplier_claims
        SET status = 'approved', approved_at = datetime('now'),
            approved_by = ?, updated_at = datetime('now')
      WHERE id = ?`,
    [approvedBy, claim.id]
  );

  // Tier sync: copy users.user_type onto the pin (and any other pins this
  // user owns, in case of multi-listing accounts).
  const user = get(`SELECT user_type FROM users WHERE id = ?`, [claim.user_id]);
  if (user && user.user_type) {
    try { syncTierForUser(claim.user_id, user.user_type); }
    catch (e) { console.error('[claims] tier sync after approval failed:', e.message); }
  }

  const updated = get(`SELECT * FROM permanent_pins WHERE id = ?`, [supplier.id]);
  return { ok: true, claim, supplier: updated };
}

module.exports = {
  startClaim,
  verifyClaimByToken,
  approveClaimManual,
  // exported for testing:
  trySendVerificationEmail,
  notifyAdminOfManualClaim
};
