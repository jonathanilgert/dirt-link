// Sync a user's plan tier to every supplier listing they own.
// Source of truth for the rendered tier on profile/directory pages is
// permanent_pins.tier; users.user_type is the billing source. This helper
// keeps them in lockstep and is called from:
//   - the claim approval flow (initial copy from users.user_type)
//   - the Stripe webhook handler in routes/billing.js (subscription
//     create/update/delete events)
//
// Edge case (called out in Stage 1 / B4 confirmation): one user account
// can claim multiple supplier listings. A single tier change must update
// ALL of their owned pins atomically.

const { run, all } = require('../database/init');

const VALID_TIERS = ['free', 'pro', 'powerhouse', 'enterprise'];

function syncTierForUser(userId, newTier) {
  if (!userId) throw new Error('syncTierForUser: userId required');
  if (!VALID_TIERS.includes(newTier)) throw new Error(`syncTierForUser: invalid tier "${newTier}"`);

  const owned = all(
    `SELECT id, slug, tier FROM permanent_pins WHERE claimed_by = ? AND is_active = 1`,
    [userId]
  );
  if (owned.length === 0) return { updated: 0, pins: [] };

  run(
    `UPDATE permanent_pins
        SET tier = ?, updated_at = datetime('now')
      WHERE claimed_by = ? AND is_active = 1`,
    [newTier, userId]
  );

  return {
    updated: owned.length,
    pins: owned.map(p => ({ id: p.id, slug: p.slug, oldTier: p.tier, newTier }))
  };
}

module.exports = { syncTierForUser, VALID_TIERS };
