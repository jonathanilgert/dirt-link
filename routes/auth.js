const express = require('express');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { get, run } = require('../database/init');
const { requireAuth } = require('../middleware/auth');

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

// Get current user
router.get('/me', requireAuth, (req, res) => {
  const user = get('SELECT id, email, company_name, contact_name, phone, user_type, created_at FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
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

module.exports = router;
