const crypto = require('crypto');
const { all, get, run } = require('../database/init');

// Hash an API key for storage (we never store plaintext keys)
function hashKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

// Generate a new API key — returns the plaintext key (shown once) and its hash
function generateApiKey() {
  const prefix = 'dl_';
  const raw = crypto.randomBytes(32).toString('hex');
  const key = prefix + raw;
  return { key, hash: hashKey(key) };
}

// Express middleware: validate X-API-Key header
function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key'];
  if (!key) {
    return res.status(401).json({ error: 'Missing X-API-Key header' });
  }

  const hash = hashKey(key);
  const record = get(
    `SELECT * FROM api_keys WHERE key_hash = ? AND is_active = 1`,
    [hash]
  );

  if (!record) {
    return res.status(403).json({ error: 'Invalid or revoked API key' });
  }

  // Update last_used_at
  run(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`, [record.id]);

  // Attach key info to request for audit logging
  req.apiKey = {
    id: record.id,
    name: record.name,
    created_by: record.created_by
  };

  next();
}

module.exports = { hashKey, generateApiKey, requireApiKey };
