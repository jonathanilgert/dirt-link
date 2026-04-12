const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { planSupportsProximity } = require('../services/proximity');

const router = express.Router();

const ALLOWED_RADII = [5, 10, 25, 50];

// ── Middleware: require Powerhouse or Enterprise plan ──
function requireProximityPlan(req, res, next) {
  const user = get('SELECT user_type FROM users WHERE id = ?', [req.session.userId]);
  if (!user || !planSupportsProximity(user.user_type)) {
    return res.status(403).json({
      error: 'Proximity alerts are available on the Powerhouse and Enterprise plans.',
      upgrade_needed: true
    });
  }
  next();
}

// ── GET /api/proximity/settings — get user's proximity alert config ──
router.get('/settings', requireAuth, requireProximityPlan, (req, res) => {
  const user = get('SELECT proximity_radius_km, proximity_paused FROM users WHERE id = ?', [req.session.userId]);

  // Get all monitored pins with their alert settings
  const monitoredPins = all(`
    SELECT pas.id AS setting_id, pas.pin_id, pas.radius_km, pas.notify_email, pas.notify_sms, pas.notify_in_app, pas.is_paused,
           p.title, p.address, p.pin_type, p.material_type, p.is_active
    FROM proximity_alert_settings pas
    JOIN pins p ON pas.pin_id = p.id
    WHERE pas.user_id = ?
    ORDER BY p.created_at DESC
  `, [req.session.userId]);

  res.json({
    defaultRadius: user.proximity_radius_km || 10,
    globalPaused: !!user.proximity_paused,
    allowedRadii: ALLOWED_RADII,
    monitoredPins
  });
});

// ── PUT /api/proximity/settings — update global defaults ──
router.put('/settings', requireAuth, requireProximityPlan, (req, res) => {
  const { default_radius_km, paused } = req.body;
  const updates = [];
  const params = [];

  if (default_radius_km !== undefined) {
    if (!ALLOWED_RADII.includes(Number(default_radius_km))) {
      return res.status(400).json({ error: `Radius must be one of: ${ALLOWED_RADII.join(', ')} km` });
    }
    updates.push('proximity_radius_km = ?');
    params.push(Number(default_radius_km));
  }
  if (paused !== undefined) {
    updates.push('proximity_paused = ?');
    params.push(paused ? 1 : 0);
  }

  if (updates.length === 0) return res.status(400).json({ error: 'No settings to update' });

  updates.push("updated_at = datetime('now')");
  params.push(req.session.userId);
  run(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

  res.json({ message: 'Proximity settings updated' });
});

// ── POST /api/proximity/monitor/:pinId — start monitoring a pin ──
router.post('/monitor/:pinId', requireAuth, requireProximityPlan, (req, res) => {
  const pin = get('SELECT * FROM pins WHERE id = ? AND user_id = ? AND is_active = 1', [req.params.pinId, req.session.userId]);
  if (!pin) return res.status(404).json({ error: 'Pin not found or not yours' });

  // Check if already monitoring
  const existing = get('SELECT id FROM proximity_alert_settings WHERE user_id = ? AND pin_id = ?', [req.session.userId, pin.id]);
  if (existing) return res.status(409).json({ error: 'Already monitoring this pin', setting_id: existing.id });

  const user = get('SELECT proximity_radius_km FROM users WHERE id = ?', [req.session.userId]);
  const { radius_km, notify_email, notify_sms, notify_in_app } = req.body;

  const id = uuidv4();
  const radius = ALLOWED_RADII.includes(Number(radius_km)) ? Number(radius_km) : (user.proximity_radius_km || 10);

  run(
    `INSERT INTO proximity_alert_settings (id, user_id, pin_id, radius_km, notify_email, notify_sms, notify_in_app)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, req.session.userId, pin.id, radius,
     notify_email !== undefined ? (notify_email ? 1 : 0) : 1,
     notify_sms !== undefined ? (notify_sms ? 1 : 0) : 0,
     notify_in_app !== undefined ? (notify_in_app ? 1 : 0) : 1]
  );

  res.status(201).json({
    setting_id: id,
    pin_id: pin.id,
    radius_km: radius,
    message: `Now monitoring for new sites within ${radius} km of ${pin.title || pin.address}`
  });
});

// ── PUT /api/proximity/monitor/:settingId — update a monitoring setting ──
router.put('/monitor/:settingId', requireAuth, requireProximityPlan, (req, res) => {
  const setting = get('SELECT * FROM proximity_alert_settings WHERE id = ? AND user_id = ?', [req.params.settingId, req.session.userId]);
  if (!setting) return res.status(404).json({ error: 'Setting not found' });

  const { radius_km, notify_email, notify_sms, notify_in_app, is_paused } = req.body;
  const updates = [];
  const params = [];

  if (radius_km !== undefined) {
    if (!ALLOWED_RADII.includes(Number(radius_km))) {
      return res.status(400).json({ error: `Radius must be one of: ${ALLOWED_RADII.join(', ')} km` });
    }
    updates.push('radius_km = ?');
    params.push(Number(radius_km));
  }
  if (notify_email !== undefined) { updates.push('notify_email = ?'); params.push(notify_email ? 1 : 0); }
  if (notify_sms !== undefined) { updates.push('notify_sms = ?'); params.push(notify_sms ? 1 : 0); }
  if (notify_in_app !== undefined) { updates.push('notify_in_app = ?'); params.push(notify_in_app ? 1 : 0); }
  if (is_paused !== undefined) { updates.push('is_paused = ?'); params.push(is_paused ? 1 : 0); }

  if (updates.length === 0) return res.status(400).json({ error: 'No settings to update' });

  updates.push("updated_at = datetime('now')");
  params.push(req.params.settingId);
  run(`UPDATE proximity_alert_settings SET ${updates.join(', ')} WHERE id = ?`, params);

  res.json({ message: 'Monitoring settings updated' });
});

// ── DELETE /api/proximity/monitor/:settingId — stop monitoring a pin ──
router.delete('/monitor/:settingId', requireAuth, requireProximityPlan, (req, res) => {
  const result = run('DELETE FROM proximity_alert_settings WHERE id = ? AND user_id = ?', [req.params.settingId, req.session.userId]);
  if (result.changes === 0) return res.status(404).json({ error: 'Setting not found' });
  res.json({ message: 'Monitoring stopped' });
});

// ── GET /api/proximity/notifications — in-app notification list ──
router.get('/notifications', requireAuth, (req, res) => {
  const { unread_only, limit, offset } = req.query;
  let query = `SELECT * FROM proximity_notifications WHERE recipient_id = ?`;
  const params = [req.session.userId];

  if (unread_only === '1' || unread_only === 'true') {
    query += ' AND is_read = 0';
  }

  query += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
  params.push(parseInt(limit) || 50, parseInt(offset) || 0);

  const notifications = all(query, params);

  // Also get unread count
  const unreadCount = get('SELECT COUNT(*) as count FROM proximity_notifications WHERE recipient_id = ? AND is_read = 0', [req.session.userId]);

  res.json({
    notifications,
    unread_count: unreadCount?.count || 0
  });
});

// ── POST /api/proximity/notifications/read — mark notifications as read ──
router.post('/notifications/read', requireAuth, (req, res) => {
  const { notification_ids, all: markAll } = req.body;

  if (markAll) {
    run('UPDATE proximity_notifications SET is_read = 1 WHERE recipient_id = ? AND is_read = 0', [req.session.userId]);
  } else if (Array.isArray(notification_ids) && notification_ids.length > 0) {
    const placeholders = notification_ids.map(() => '?').join(',');
    run(
      `UPDATE proximity_notifications SET is_read = 1 WHERE id IN (${placeholders}) AND recipient_id = ?`,
      [...notification_ids, req.session.userId]
    );
  } else {
    return res.status(400).json({ error: 'Provide notification_ids array or all: true' });
  }

  res.json({ message: 'Notifications marked as read' });
});

// ── GET /api/proximity/notifications/count — just the unread count (for badge polling) ──
router.get('/notifications/count', requireAuth, (req, res) => {
  const result = get('SELECT COUNT(*) as count FROM proximity_notifications WHERE recipient_id = ? AND is_read = 0', [req.session.userId]);
  res.json({ count: result?.count || 0 });
});

module.exports = router;
