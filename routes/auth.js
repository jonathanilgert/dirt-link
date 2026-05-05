const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { get, run, all } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { PLANS, getRevealStatus } = require('../config/pricing');
const { getTransporterAndFrom } = require('../services/notifications');

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
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // Always respond 200 — never reveal whether email exists
  res.json({ message: 'If that email is registered, a reset link has been sent.' });

  const user = get('SELECT id, contact_name FROM users WHERE email = ?', [email.toLowerCase().trim()]);
  if (!user) return;

  // Expire any old tokens for this user
  run(`UPDATE password_reset_tokens SET used = 1 WHERE user_id = ? AND used = 0`, [user.id]);

  // Generate a secure token — expires in 1 hour
  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  run(`INSERT INTO password_reset_tokens (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)`,
    [uuidv4(), user.id, token, expiresAt]);

  const appUrl = process.env.APP_URL || 'https://dirtlink.ca';
  const resetUrl = `${appUrl}/reset-password?token=${token}`;

  const { transport, from } = getTransporterAndFrom();
  if (!transport) return; // SMTP not configured — skip silently

  try {
    await transport.sendMail({
      from: `DirtLink <${from}>`,
      to: email,
      subject: 'Reset your DirtLink password',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto">
          <h2 style="color:#1A1410">Reset your password</h2>
          <p>Hi ${user.contact_name || 'there'},</p>
          <p>Click the button below to reset your password. This link expires in 1 hour.</p>
          <p style="margin:24px 0">
            <a href="${resetUrl}" style="background:#F59E0B;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Reset Password</a>
          </p>
          <p style="color:#8A7E74;font-size:0.85rem">If you didn't request this, you can ignore this email.</p>
          <hr style="border:none;border-top:1px solid #E2D9CF;margin:24px 0">
          <p style="color:#8A7E74;font-size:0.8rem">DirtLink · Canada's Earth Material Marketplace</p>
        </div>`
    });
  } catch (err) {
    console.error('Password reset email error:', err.message);
  }
});

// ── GET /reset-password — served by catch-all in server.js (renders app with token in URL)
// ── POST /api/auth/reset-password ────────────────────────────────────────────
router.post('/reset-password', async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: 'Token and new password are required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

  const row = get(
    `SELECT * FROM password_reset_tokens WHERE token = ? AND used = 0 AND expires_at > datetime('now')`,
    [token]
  );
  if (!row) return res.status(400).json({ error: 'This reset link is invalid or has expired.' });

  const password_hash = bcrypt.hashSync(password, 10);
  run(`UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`, [password_hash, row.user_id]);
  run(`UPDATE password_reset_tokens SET used = 1 WHERE id = ?`, [row.id]);

  res.json({ message: 'Password updated. You can now log in.' });
});

module.exports = router;
