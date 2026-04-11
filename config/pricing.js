// DirtLink Pricing Tiers & Reveal Configuration
// Central source of truth for all plan details

const PLANS = {
  free: {
    name: 'Free',
    price: 0,
    revealsPerMonth: 3,
    overageRate: 4.99,
    features: [
      'Post unlimited listings',
      'Browse the full map',
      '3 reveals per month',
      'Additional reveals at $4.99 each'
    ],
    stripePriceId: null
  },
  pro: {
    name: 'Pro',
    price: 29,
    revealsPerMonth: 10,
    overageRate: 2.99,
    features: [
      'Everything in Free',
      '10 reveals per month',
      'Additional reveals at $2.99 each'
    ],
    stripePriceId: process.env.STRIPE_PRO_PRICE_ID || null
  },
  powerhouse: {
    name: 'Powerhouse',
    price: 59,
    revealsPerMonth: 40,
    overageRate: 1.49,
    features: [
      'Everything in Pro',
      '40 reveals per month',
      'Additional reveals at $1.49 each',
      'Priority notifications for new pins nearby'
    ],
    stripePriceId: process.env.STRIPE_POWERHOUSE_PRICE_ID || null
  },
  enterprise: {
    name: 'Enterprise',
    price: 149,
    revealsPerMonth: -1, // unlimited
    overageRate: 0,
    features: [
      'Everything in Powerhouse',
      'Unlimited reveals',
      'Private map view (your sites only)',
      'Unlimited outreach'
    ],
    stripePriceId: process.env.STRIPE_ENTERPRISE_PRICE_ID || null
  }
};

const PLAN_ORDER = ['free', 'pro', 'powerhouse', 'enterprise'];

// Calculate how much a user has spent on overage reveals this billing cycle
function getOverageSpend(overagePurchases) {
  return overagePurchases.reduce((sum, p) => sum + p.amount, 0);
}

// Calculate savings if user upgraded to a given plan, based on current overage spend
function calculateSavings(currentPlan, targetPlan, overageCount) {
  const current = PLANS[currentPlan];
  const target = PLANS[targetPlan];
  if (!current || !target) return 0;

  const overageCostOnCurrent = overageCount * current.overageRate;
  const monthlyCostOnCurrent = current.price + overageCostOnCurrent;

  // On target plan, how many overages would they need?
  const targetIncluded = target.revealsPerMonth === -1 ? 999 : target.revealsPerMonth;
  const currentIncluded = current.revealsPerMonth === -1 ? 999 : current.revealsPerMonth;
  const totalRevealsUsed = currentIncluded + overageCount;
  const overageOnTarget = Math.max(0, totalRevealsUsed - targetIncluded);
  const monthlyCostOnTarget = target.price + (overageOnTarget * target.overageRate);

  return Math.max(0, monthlyCostOnCurrent - monthlyCostOnTarget);
}

// Get reveal status for a user (checks monthly reset, returns remaining + overage info)
function getRevealStatus(user, db) {
  const { all } = db;
  const plan = PLANS[user.user_type] || PLANS.free;

  // Enterprise = unlimited
  if (plan.revealsPerMonth === -1) {
    return {
      plan: user.user_type,
      planName: plan.name,
      limit: -1,
      used: 0,
      remaining: -1,
      overageRate: 0,
      overagePurchasedThisCycle: 0,
      overageSpentThisCycle: 0
    };
  }

  const now = new Date();
  const resetAt = user.reveals_reset_at ? new Date(user.reveals_reset_at) : null;
  let used = user.reveals_used || 0;

  // Check if we need to reset
  if (!resetAt || now >= resetAt) {
    const nextReset = new Date(now.getFullYear(), now.getMonth() + 1, 1).toISOString();
    const { run } = db;
    run(`UPDATE users SET reveals_used = 0, reveals_reset_at = ? WHERE id = ?`, [nextReset, user.id]);
    used = 0;
  }

  // Count overage reveals purchased this billing cycle
  const cycleStart = user.reveals_reset_at
    ? new Date(new Date(user.reveals_reset_at).getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    : new Date(now.getFullYear(), now.getMonth(), 1).toISOString();

  const overages = all(
    `SELECT COUNT(*) as count, COALESCE(SUM(amount), 0) as total FROM reveal_purchases WHERE user_id = ? AND created_at >= ?`,
    [user.id, cycleStart]
  );
  const overageCount = overages[0]?.count || 0;
  const overageSpent = (overages[0]?.total || 0) / 100; // stored in cents

  const included = plan.revealsPerMonth;
  const totalAvailable = included + overageCount;
  const remaining = Math.max(0, totalAvailable - used);

  return {
    plan: user.user_type,
    planName: plan.name,
    limit: included,
    used,
    remaining,
    includedRemaining: Math.max(0, included - used),
    overageRate: plan.overageRate,
    overagePurchasedThisCycle: overageCount,
    overageSpentThisCycle: overageSpent
  };
}

module.exports = { PLANS, PLAN_ORDER, getOverageSpend, calculateSavings, getRevealStatus };
