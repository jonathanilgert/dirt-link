const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { generateApiKey } = require('../middleware/apiKey');

const router = express.Router();

// Generate a new API key (requires logged-in user)
router.post('/', requireAuth, (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'API key name is required' });
  }

  const id = uuidv4();
  const { key, hash } = generateApiKey();

  run(
    `INSERT INTO api_keys (id, name, key_hash, created_by) VALUES (?, ?, ?, ?)`,
    [id, name.trim(), hash, req.session.userId]
  );

  // Return the plaintext key ONCE — it cannot be retrieved again
  res.status(201).json({
    id,
    name: name.trim(),
    key,
    message: 'Store this key securely — it will not be shown again.'
  });
});

// List all API keys for the current user (without hashes)
router.get('/', requireAuth, (req, res) => {
  const keys = all(
    `SELECT id, name, is_active, last_used_at, created_at, revoked_at FROM api_keys WHERE created_by = ? ORDER BY created_at DESC`,
    [req.session.userId]
  );
  res.json(keys);
});

// Revoke an API key
router.delete('/:id', requireAuth, (req, res) => {
  const key = get(
    `SELECT * FROM api_keys WHERE id = ? AND created_by = ?`,
    [req.params.id, req.session.userId]
  );
  if (!key) return res.status(404).json({ error: 'API key not found' });

  run(
    `UPDATE api_keys SET is_active = 0, revoked_at = datetime('now') WHERE id = ?`,
    [req.params.id]
  );
  res.json({ message: 'API key revoked' });
});

// Rotate an API key — revokes old, creates new with same name
router.post('/:id/rotate', requireAuth, (req, res) => {
  const old = get(
    `SELECT * FROM api_keys WHERE id = ? AND created_by = ?`,
    [req.params.id, req.session.userId]
  );
  if (!old) return res.status(404).json({ error: 'API key not found' });

  // Revoke old key
  run(
    `UPDATE api_keys SET is_active = 0, revoked_at = datetime('now') WHERE id = ?`,
    [req.params.id]
  );

  // Create new key with same name
  const newId = uuidv4();
  const { key, hash } = generateApiKey();
  run(
    `INSERT INTO api_keys (id, name, key_hash, created_by) VALUES (?, ?, ?, ?)`,
    [newId, old.name, hash, req.session.userId]
  );

  res.status(201).json({
    id: newId,
    name: old.name,
    key,
    old_key_id: req.params.id,
    message: 'Old key revoked. Store this new key securely — it will not be shown again.'
  });
});

module.exports = router;
