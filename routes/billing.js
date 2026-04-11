const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { get, run, all } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { PLANS, PLAN_ORDER, calculateSavings, getRevealStatus } = require('../config/pricing');

const router = express.Router();

// Lazy-init Stripe (only when keys are configured)
let stripe = null;
function getStripe() {
  if (!stripe && process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
  }
  return stripe;
}

// ============================================================
// GET /api/billing/status — current plan, reveals, usage
// ============================================================
router.get('/status', requireAuth, (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const reveals = getRevealStatus(user, { all, run });
  const plan = PLANS[user.user_type] || PLANS.free;

  // Build smart nudge for free users who've purchased overages
  let nudge = null;
  if (user.user_type === 'free' && reveals.overageSpentThisCycle > 0) {
    const savings = calculateSavings('free', 'pro', reveals.overagePurchasedThisCycle);
    if (savings > 0) {
      nudge = {
        message: `You've spent $${reveals.overageSpentThisCycle.toFixed(2)} on reveals this month — the Pro plan would save you $${savings.toFixed(2)}.`,
        targetPlan: 'pro',
        savings: savings
      };
    }
  } else if (user.user_type === 'pro' && reveals.overageSpentThisCycle > 0) {
    const savings = calculateSavings('pro', 'powerhouse', reveals.overagePurchasedThisCycle);
    if (savings > 0) {
      nudge = {
        message: `You've spent $${reveals.overageSpentThisCycle.toFixed(2)} on extra reveals — upgrading to Powerhouse would save you $${savings.toFixed(2)}/month.`,
        targetPlan: 'powerhouse',
        savings: savings
      };
    }
  }

  res.json({
    plan: user.user_type,
    planName: plan.name,
    planPrice: plan.price,
    reveals,
    nudge,
    priorityNotifications: !!user.priority_notifications,
    stripeSubscriptionId: user.stripe_subscription_id || null
  });
});

// ============================================================
// GET /api/billing/plans — all available plans with pricing
// ============================================================
router.get('/plans', (req, res) => {
  const plans = PLAN_ORDER.map(key => ({
    key,
    ...PLANS[key],
    stripePriceId: undefined // don't expose to client
  }));
  res.json(plans);
});

// ============================================================
// POST /api/billing/checkout — create Stripe checkout for subscription
// ============================================================
router.post('/checkout', requireAuth, async (req, res) => {
  const { plan } = req.body;
  const s = getStripe();

  if (!s) {
    return res.status(503).json({ error: 'Payment system not configured' });
  }

  if (!plan || !PLANS[plan] || plan === 'free') {
    return res.status(400).json({ error: 'Invalid plan' });
  }

  const planConfig = PLANS[plan];
  if (!planConfig.stripePriceId) {
    return res.status(400).json({ error: 'Plan not available for purchase yet' });
  }

  const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  try {
    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await s.customers.create({
        email: user.email,
        name: user.contact_name,
        metadata: { dirtlink_user_id: user.id, company: user.company_name }
      });
      customerId = customer.id;
      run(`UPDATE users SET stripe_customer_id = ? WHERE id = ?`, [customerId, user.id]);
    }

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: planConfig.stripePriceId, quantity: 1 }],
      success_url: `${req.protocol}://${req.get('host')}/?billing=success&plan=${plan}`,
      cancel_url: `${req.protocol}://${req.get('host')}/?billing=cancelled`,
      metadata: { dirtlink_user_id: user.id, plan }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe checkout error:', err.message);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
});

// ============================================================
// POST /api/billing/buy-reveal — one-time reveal purchase
// ============================================================
router.post('/buy-reveal', requireAuth, async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const plan = PLANS[user.user_type] || PLANS.free;
  if (plan.revealsPerMonth === -1) {
    return res.status(400).json({ error: 'You have unlimited reveals' });
  }

  const amountCents = Math.round(plan.overageRate * 100);
  const s = getStripe();

  if (!s) {
    // Dev mode: grant reveal without payment
    const id = uuidv4();
    run(`INSERT INTO reveal_purchases (id, user_id, amount, status) VALUES (?, ?, ?, 'completed')`,
      [id, user.id, amountCents]);
    run(`INSERT INTO billing_history (id, user_id, type, description, amount, status) VALUES (?, ?, 'reveal_purchase', ?, ?, 'completed')`,
      [uuidv4(), user.id, `1 additional reveal (${plan.name} rate)`, amountCents]);

    const updatedUser = get('SELECT * FROM users WHERE id = ?', [user.id]);
    const reveals = getRevealStatus(updatedUser, { all, run });
    return res.json({ success: true, reveals, devMode: true });
  }

  try {
    // Get or create Stripe customer
    let customerId = user.stripe_customer_id;
    if (!customerId) {
      const customer = await s.customers.create({
        email: user.email,
        name: user.contact_name,
        metadata: { dirtlink_user_id: user.id, company: user.company_name }
      });
      customerId = customer.id;
      run(`UPDATE users SET stripe_customer_id = ? WHERE id = ?`, [customerId, user.id]);
    }

    const session = await s.checkout.sessions.create({
      customer: customerId,
      mode: 'payment',
      line_items: [{
        price_data: {
          currency: 'usd',
          unit_amount: amountCents,
          product_data: {
            name: 'DirtLink Reveal',
            description: `1 additional reveal at ${plan.name} plan rate`
          }
        },
        quantity: 1
      }],
      success_url: `${req.protocol}://${req.get('host')}/?reveal=success`,
      cancel_url: `${req.protocol}://${req.get('host')}/?reveal=cancelled`,
      metadata: { dirtlink_user_id: user.id, type: 'reveal_purchase' }
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe reveal purchase error:', err.message);
    res.status(500).json({ error: 'Failed to create payment session' });
  }
});

// ============================================================
// POST /api/billing/cancel — cancel subscription (downgrade to free at period end)
// ============================================================
router.post('/cancel', requireAuth, async (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  if (user.user_type === 'free' || !user.stripe_subscription_id) {
    return res.status(400).json({ error: 'No active subscription to cancel' });
  }

  const s = getStripe();
  if (s && user.stripe_subscription_id) {
    try {
      await s.subscriptions.update(user.stripe_subscription_id, {
        cancel_at_period_end: true
      });
    } catch (err) {
      console.error('Stripe cancel error:', err.message);
      return res.status(500).json({ error: 'Failed to cancel subscription' });
    }
  } else {
    // Dev mode: immediate downgrade
    run(`UPDATE users SET user_type = 'free', stripe_subscription_id = NULL, priority_notifications = 0, updated_at = datetime('now') WHERE id = ?`, [user.id]);
  }

  res.json({ message: 'Subscription will be cancelled at the end of the billing period' });
});

// ============================================================
// GET /api/billing/history — billing history
// ============================================================
router.get('/history', requireAuth, (req, res) => {
  const history = all(
    `SELECT id, type, description, amount, status, created_at FROM billing_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
    [req.session.userId]
  );
  res.json(history);
});

// ============================================================
// POST /api/billing/webhook — Stripe webhook handler
// ============================================================
router.post('/webhook', async (req, res) => {
  const s = getStripe();
  if (!s) return res.status(200).send('OK');

  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = s.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  switch (event.type) {
    case 'checkout.session.completed': {
      const session = event.data.object;
      const userId = session.metadata?.dirtlink_user_id;
      if (!userId) break;

      if (session.metadata.type === 'reveal_purchase') {
        // One-time reveal purchase completed
        const id = uuidv4();
        run(`INSERT INTO reveal_purchases (id, user_id, amount, stripe_payment_intent_id, status) VALUES (?, ?, ?, ?, 'completed')`,
          [id, userId, session.amount_total, session.payment_intent]);
        run(`INSERT INTO billing_history (id, user_id, type, description, amount, stripe_id, status) VALUES (?, ?, 'reveal_purchase', '1 additional reveal', ?, ?, 'completed')`,
          [uuidv4(), userId, session.amount_total, session.payment_intent]);
      } else if (session.mode === 'subscription') {
        // Subscription started
        const plan = session.metadata.plan;
        const subscriptionId = session.subscription;
        run(`UPDATE users SET user_type = ?, stripe_subscription_id = ?, priority_notifications = ?, plan_started_at = datetime('now'), reveals_used = 0, reveals_reset_at = ?, updated_at = datetime('now') WHERE id = ?`,
          [plan, subscriptionId, plan === 'powerhouse' || plan === 'enterprise' ? 1 : 0,
           new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString(), userId]);
        run(`INSERT INTO billing_history (id, user_id, type, description, amount, stripe_id, status) VALUES (?, ?, 'subscription', ?, ?, ?, 'completed')`,
          [uuidv4(), userId, `Subscribed to ${PLANS[plan]?.name || plan} plan`, session.amount_total, subscriptionId]);
      }
      break;
    }

    case 'customer.subscription.updated': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const user = get('SELECT * FROM users WHERE stripe_customer_id = ?', [customerId]);
      if (!user) break;

      if (subscription.cancel_at_period_end) {
        // Marked for cancellation — don't downgrade yet
        run(`INSERT INTO billing_history (id, user_id, type, description, amount, stripe_id, status) VALUES (?, ?, 'subscription_update', 'Subscription set to cancel at period end', 0, ?, 'completed')`,
          [uuidv4(), user.id, subscription.id]);
      }
      break;
    }

    case 'customer.subscription.deleted': {
      const subscription = event.data.object;
      const customerId = subscription.customer;
      const user = get('SELECT * FROM users WHERE stripe_customer_id = ?', [customerId]);
      if (!user) break;

      // Downgrade to free
      run(`UPDATE users SET user_type = 'free', stripe_subscription_id = NULL, priority_notifications = 0, updated_at = datetime('now') WHERE id = ?`, [user.id]);
      run(`INSERT INTO billing_history (id, user_id, type, description, amount, stripe_id, status) VALUES (?, ?, 'subscription_cancelled', 'Downgraded to Free plan', 0, ?, 'completed')`,
        [uuidv4(), user.id, subscription.id]);
      break;
    }

    case 'invoice.payment_succeeded': {
      const invoice = event.data.object;
      const customerId = invoice.customer;
      const user = get('SELECT * FROM users WHERE stripe_customer_id = ?', [customerId]);
      if (!user || !invoice.subscription) break;

      // Reset reveals on each billing cycle renewal
      const nextReset = new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString();
      run(`UPDATE users SET reveals_used = 0, reveals_reset_at = ? WHERE id = ?`, [nextReset, user.id]);

      run(`INSERT INTO billing_history (id, user_id, type, description, amount, stripe_id, status) VALUES (?, ?, 'invoice', ?, ?, ?, 'completed')`,
        [uuidv4(), user.id, `Monthly subscription payment`, invoice.amount_paid, invoice.id]);
      break;
    }
  }

  res.status(200).send('OK');
});

module.exports = router;
