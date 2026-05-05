const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { get, run, all } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { PLANS, getRevealStatus } = require('../config/pricing');

const router = express.Router();

// Register
router.post('/register', (req, res) => {
  const { email, password, company_name, contact_name, phone } = req.body;

  if (!email || !password || !company_name || !contact_name || !phone) {
    return res.status(400).json({ error: 'All fields including phone number are required' });
  }

  const existing = get('SELECT id FROM users WHERE email = ?', [email]);
  if (existing) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const id = uuidv4();
  const password_hash = bcrypt.hashSync(password, 10);

  run(
    `INSERT INTO users (id, email, password_hash, company_name, contact_name, phone) VALUES (?, ?, ?, ?, ?, ?)`,
    [id, email, password_hash, company_name, contact_name, phone]
  );

  req.session.userId = id;
  res.json({ id, email, company_name, contact_name, phone });
});

// Login
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  req.session.userId = user.id;
  res.json({
    id: user.id,
    email: user.email,
    company_name: user.company_name,
    contact_name: user.contact_name,
    phone: user.phone
  });
});

// Logout
router.post('/logout', (req, res) => {
  req.session.destroy();
  res.json({ message: 'Logged out' });
});

// Get current user (includes reveal credits and plan info)
router.get('/me', requireAuth, (req, res) => {
  const user = get('SELECT id, email, company_name, contact_name, phone, user_type, reveals_used, reveals_reset_at, priority_notifications, email_notifications, sms_notifications, created_at FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  const reveals = getRevealStatus(user, { all, run });
  const plan = PLANS[user.user_type] || PLANS.free;

  user.reveals = reveals;
  user.planName = plan.name;
  user.planPrice = plan.price;
  user.overageRate = plan.overageRate;
  res.json(user);
});

// Update profile
router.put('/me', requireAuth, (req, res) => {
  const { company_name, contact_name, phone } = req.body;
  run(
    `UPDATE users SET company_name = COALESCE(?, company_name), contact_name = COALESCE(?, contact_name), phone = COALESCE(?, phone), updated_at = datetime('now') WHERE id = ?`,
    [company_name, contact_name, phone, req.session.userId]
  );

  const user = get('SELECT id, email, company_name, contact_name, phone, user_type FROM users WHERE id = ?', [req.session.userId]);
  res.json(user);
});

// Change password
router.put('/password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) {
    return res.status(400).json({ error: 'Current and new password are required' });
  }
  if (new_password.length < 6) {
    return res.status(400).json({ error: 'New password must be at least 6 characters' });
  }

  const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user || !bcrypt.compareSync(current_password, user.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }

  const password_hash = bcrypt.hashSync(new_password, 10);
  run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [password_hash, req.session.userId]);
  res.json({ message: 'Password updated' });
});

// Update notification preferences
router.put('/notifications', requireAuth, (req, res) => {
  const { email_notifications, sms_notifications } = req.body;

  const updates = [];
  const params = [];

  if (email_notifications !== undefined) {
    updates.push('email_notifications = ?');
    params.push(email_notifications ? 1 : 0);
  }
  if (sms_notifications !== undefined) {
    updates.push('sms_notifications = ?');
    params.push(sms_notifications ? 1 : 0);
  }

  if (updates.length === 0) {
    return res.status(400).json({ error: 'No preferences to update' });
  }

  updates.push("updated_at = datetime('now')");
  params.push(req.session.userId);

  run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  const user = get('SELECT email_notifications, sms_notifications FROM users WHERE id = ?', [req.session.userId]);
  res.json(user);
});

// ── POST /api/auth/forgot-password ──────────────────────────────────────────
router.post('/forgot-password', (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'Email and new password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const user = get('SELECT id FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user) return res.status(404).json({ error: 'No account found with that email' });

  const password_hash = bcrypt.hashSync(password, 10);
  run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [password_hash, user.id]);

  res.json({ ok: true });
});

// ── DELETE /api/auth/account — permanently delete the authenticated user's account ──
router.delete('/account', requireAuth, (req, res) => {
  const userId = req.session.userId;
  const user = get('SELECT id, email FROM users WHERE id = ?', [userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });

  // Delete all user data in dependency order
  run(`DELETE FROM proximity_notifications   WHERE recipient_id = ?`, [userId]);
  run(`DELETE FROM proximity_alert_settings  WHERE user_id = ?`,      [userId]);
  run(`DELETE FROM notification_queue        WHERE user_id = ?`,       [userId]);
  run(`DELETE FROM reveal_purchases          WHERE user_id = ?`,       [userId]);
  run(`DELETE FROM billing_history           WHERE user_id = ?`,       [userId]);
  run(`DELETE FROM password_reset_tokens     WHERE user_id = ?`,       [userId]);

  // Messages and conversations — remove threads where user is a participant
  const convIds = all(
    `SELECT id FROM conversations WHERE pin_owner_id = ? OR requester_id = ?`,
    [userId, userId]
  ).map(c => c.id);
  if (convIds.length) {
    const ph = convIds.map(() => '?').join(',');
    run(`DELETE FROM messages WHERE conversation_id IN (${ph})`, convIds);
    run(`DELETE FROM conversations WHERE id IN (${ph})`,         convIds);
  }

  // Pins and associated data
  const pinIds = all(`SELECT id FROM pins WHERE user_id = ?`, [userId]).map(p => p.id);
  if (pinIds.length) {
    const ph = pinIds.map(() => '?').join(',');
    run(`DELETE FROM pin_photos WHERE pin_id IN (${ph})`, pinIds);
    run(`DELETE FROM proximity_notifications WHERE trigger_pin_id IN (${ph})`, pinIds);
    run(`DELETE FROM proximity_alert_settings WHERE pin_id IN (${ph})`,        pinIds);
    run(`DELETE FROM pins WHERE id IN (${ph})`,                                pinIds);
  }

  // Finally remove the user record
  run(`DELETE FROM users WHERE id = ?`, [userId]);

  // Destroy session
  req.session.destroy(() => {});

  res.json({ ok: true });
});

module.exports = router;
