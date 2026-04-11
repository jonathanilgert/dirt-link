const express = require('express');
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const { all, get, run } = require('../database/init');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

// Configure file upload — handles both test reports and photos
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const folder = file.fieldname === 'photos' ? 'photos' : 'reports';
    cb(null, path.join(__dirname, '..', 'uploads', folder));
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${uuidv4()}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (req, file, cb) => {
    if (file.fieldname === 'photos') {
      const allowed = ['.jpg', '.jpeg', '.png', '.webp', '.heic'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    } else {
      const allowed = ['.pdf', '.jpg', '.jpeg', '.png', '.doc', '.docx'];
      const ext = path.extname(file.originalname).toLowerCase();
      cb(null, allowed.includes(ext));
    }
  }
});

const pinUpload = upload.fields([
  { name: 'test_report', maxCount: 1 },
  { name: 'photos', maxCount: 5 }
]);

const { PLANS, getRevealStatus, calculateSavings } = require('../config/pricing');

// Get all active permit pins (public — for map display)
router.get('/permits', (req, res) => {
  const pins = all(`SELECT * FROM permit_pins WHERE is_active = 1 ORDER BY created_at DESC`);
  res.json(pins);
});

// Get all active permanent pins (public — for map display)
router.get('/permanent', (req, res) => {
  const pins = all(`SELECT * FROM permanent_pins WHERE is_active = 1 ORDER BY created_at DESC`);
  res.json(pins);
});

// Get my pins (must be before /:id to avoid route conflict)
router.get('/user/mine', requireAuth, (req, res) => {
  const pins = all(
    `SELECT p.*, u.company_name, u.contact_name FROM pins p JOIN users u ON p.user_id = u.id WHERE p.user_id = ? ORDER BY p.created_at DESC`,
    [req.session.userId]
  );
  // Attach photos to each pin
  pins.forEach(p => {
    p.photos = all('SELECT id, file_path FROM pin_photos WHERE pin_id = ?', [p.id]);
  });
  res.json(pins);
});

// Get all active pins
router.get('/', (req, res) => {
  const { pin_type, material_type } = req.query;

  let query = `SELECT p.*, u.company_name, u.contact_name FROM pins p JOIN users u ON p.user_id = u.id WHERE p.is_active = 1`;
  const params = [];

  if (pin_type) {
    query += ' AND p.pin_type = ?';
    params.push(pin_type);
  }
  if (material_type) {
    query += ' AND p.material_type = ?';
    params.push(material_type);
  }

  query += ' ORDER BY p.created_at DESC';

  const pins = all(query, params);
  // Attach photos
  pins.forEach(p => {
    p.photos = all('SELECT id, file_path FROM pin_photos WHERE pin_id = ?', [p.id]);
  });
  res.json(pins);
});

// Get single pin
router.get('/:id', (req, res) => {
  const pin = get(
    `SELECT p.*, u.company_name, u.contact_name, u.phone FROM pins p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [req.params.id]
  );
  if (!pin) return res.status(404).json({ error: 'Pin not found' });
  pin.photos = all('SELECT id, file_path FROM pin_photos WHERE pin_id = ?', [pin.id]);
  res.json(pin);
});

// Create pin
router.post('/', requireAuth, pinUpload, (req, res) => {
  const { pin_type, material_type, latitude, longitude, address, title, description, quantity_estimate, quantity_unit, is_tested, timeline_date } = req.body;

  if (!pin_type || !material_type || !latitude || !longitude || !title) {
    return res.status(400).json({ error: 'pin_type, material_type, latitude, longitude, and title are required' });
  }

  const id = uuidv4();
  const reportFile = req.files?.test_report?.[0];
  const test_report_path = reportFile ? `/uploads/reports/${reportFile.filename}` : null;

  run(
    `INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, description, quantity_estimate, quantity_unit, is_tested, test_report_path, timeline_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, req.session.userId, pin_type, material_type,
      parseFloat(latitude), parseFloat(longitude),
      address || null, title, description || null,
      quantity_estimate || null, quantity_unit || 'cubic_yards',
      is_tested === 'true' || is_tested === '1' ? 1 : 0,
      test_report_path,
      timeline_date || null
    ]
  );

  // Save photos
  const photoFiles = req.files?.photos || [];
  photoFiles.forEach(f => {
    run(
      `INSERT INTO pin_photos (id, pin_id, file_path) VALUES (?, ?, ?)`,
      [uuidv4(), id, `/uploads/photos/${f.filename}`]
    );
  });

  const pin = get(
    `SELECT p.*, u.company_name, u.contact_name FROM pins p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [id]
  );
  pin.photos = all('SELECT id, file_path FROM pin_photos WHERE pin_id = ?', [id]);
  res.status(201).json(pin);
});

// Update pin
router.put('/:id', requireAuth, pinUpload, (req, res) => {
  const pin = get('SELECT * FROM pins WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  if (!pin) return res.status(404).json({ error: 'Pin not found or not yours' });

  const { title, description, quantity_estimate, quantity_unit, is_tested, is_active, material_type, latitude, longitude, pin_type, address, timeline_date } = req.body;
  const reportFile = req.files?.test_report?.[0];
  const test_report_path = reportFile ? `/uploads/reports/${reportFile.filename}` : pin.test_report_path;

  // timeline_date: allow setting to 'now', a date string, or clearing with empty string
  const timelineValue = timeline_date === '' ? null : (timeline_date !== undefined ? timeline_date : undefined);

  run(
    `UPDATE pins SET title = COALESCE(?, title), description = COALESCE(?, description), quantity_estimate = COALESCE(?, quantity_estimate), quantity_unit = COALESCE(?, quantity_unit), material_type = COALESCE(?, material_type), is_tested = COALESCE(?, is_tested), test_report_path = COALESCE(?, test_report_path), is_active = COALESCE(?, is_active), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude), pin_type = COALESCE(?, pin_type), address = COALESCE(?, address), timeline_date = CASE WHEN ? = 1 THEN ? ELSE timeline_date END, updated_at = datetime('now') WHERE id = ?`,
    [
      title, description, quantity_estimate, quantity_unit, material_type,
      is_tested !== undefined ? (is_tested === 'true' || is_tested === '1' ? 1 : 0) : null,
      test_report_path, is_active !== undefined ? parseInt(is_active) : null,
      latitude ? parseFloat(latitude) : null, longitude ? parseFloat(longitude) : null,
      pin_type || null, address,
      timelineValue !== undefined ? 1 : 0, timelineValue !== undefined ? timelineValue : null,
      req.params.id
    ]
  );

  // Save any new photos
  const photoFiles = req.files?.photos || [];
  photoFiles.forEach(f => {
    run(
      `INSERT INTO pin_photos (id, pin_id, file_path) VALUES (?, ?, ?)`,
      [uuidv4(), req.params.id, `/uploads/photos/${f.filename}`]
    );
  });

  const updated = get(
    `SELECT p.*, u.company_name, u.contact_name FROM pins p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [req.params.id]
  );
  updated.photos = all('SELECT id, file_path FROM pin_photos WHERE pin_id = ?', [req.params.id]);
  res.json(updated);
});

// Quick update pin fields (JSON body — for reposition, activate/deactivate)
router.patch('/:id', requireAuth, (req, res) => {
  const pin = get('SELECT * FROM pins WHERE id = ? AND user_id = ?', [req.params.id, req.session.userId]);
  if (!pin) return res.status(404).json({ error: 'Pin not found or not yours' });

  const { is_active, latitude, longitude, timeline_date } = req.body;

  // timeline_date: allow setting to 'now', a date string, or clearing with empty string/null
  const timelineValue = timeline_date === '' ? null : (timeline_date !== undefined ? timeline_date : undefined);

  run(
    `UPDATE pins SET is_active = COALESCE(?, is_active), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude), timeline_date = CASE WHEN ? = 1 THEN ? ELSE timeline_date END, updated_at = datetime('now') WHERE id = ?`,
    [
      is_active !== undefined ? parseInt(is_active) : null,
      latitude !== undefined ? parseFloat(latitude) : null,
      longitude !== undefined ? parseFloat(longitude) : null,
      timelineValue !== undefined ? 1 : 0, timelineValue !== undefined ? timelineValue : null,
      req.params.id
    ]
  );

  const updated = get(
    `SELECT p.*, u.company_name, u.contact_name FROM pins p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [req.params.id]
  );
  updated.photos = all('SELECT id, file_path FROM pin_photos WHERE pin_id = ?', [req.params.id]);
  res.json(updated);
});

// Delete pin (soft delete)
router.delete('/:id', requireAuth, (req, res) => {
  const result = run("UPDATE pins SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND user_id = ?", [req.params.id, req.session.userId]);
  if (result.changes === 0) return res.status(404).json({ error: 'Pin not found or not yours' });
  res.json({ message: 'Pin removed' });
});

// ============================================================
// CLAIM FLOW — convert a permit pin into a full owned pin
// ============================================================
router.post('/claim/:permitId', requireAuth, pinUpload, (req, res) => {
  const permit = get('SELECT * FROM permit_pins WHERE id = ? AND is_active = 1', [req.params.permitId]);
  if (!permit) return res.status(404).json({ error: 'Permit pin not found' });
  if (permit.claimed_by) return res.status(409).json({ error: 'This site has already been claimed' });

  const { pin_type, material_type, address, quantity_estimate, quantity_unit, timeline_date, contact_phone, contact_email } = req.body;

  if (!pin_type || !material_type) {
    return res.status(400).json({ error: 'pin_type and material_type are required' });
  }

  // Create the real pin from permit data
  const id = uuidv4();
  const title = address || permit.address;
  const reportFile = req.files?.test_report?.[0];
  const test_report_path = reportFile ? `/uploads/reports/${reportFile.filename}` : null;

  run(
    `INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, description, quantity_estimate, quantity_unit, is_tested, test_report_path, timeline_date, source_permit_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, req.session.userId, pin_type, material_type,
      permit.latitude, permit.longitude,
      address || permit.address,
      title,
      permit.project_description || null,
      quantity_estimate || null,
      quantity_unit || 'cubic_yards',
      reportFile ? 1 : 0,
      test_report_path,
      timeline_date || null,
      permit.id
    ]
  );

  // Save photos
  const photoFiles = req.files?.photos || [];
  photoFiles.forEach(f => {
    run(
      `INSERT INTO pin_photos (id, pin_id, file_path) VALUES (?, ?, ?)`,
      [uuidv4(), id, `/uploads/photos/${f.filename}`]
    );
  });

  // Update user contact info if provided
  if (contact_phone || contact_email) {
    const updates = [];
    const params = [];
    if (contact_phone) { updates.push('phone = ?'); params.push(contact_phone); }
    params.push(req.session.userId);
    if (updates.length) run(`UPDATE users SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`, params);
  }

  // Mark permit pin as claimed
  run(
    `UPDATE permit_pins SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`,
    [req.session.userId, permit.id]
  );

  const pin = get(
    `SELECT p.*, u.company_name, u.contact_name FROM pins p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [id]
  );
  pin.photos = all('SELECT id, file_path FROM pin_photos WHERE pin_id = ?', [id]);
  res.status(201).json(pin);
});

// ============================================================
// INQUIRY FLOW — request to connect with a permit site
// ============================================================
router.get('/reveals', requireAuth, (req, res) => {
  const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  if (!user) return res.status(404).json({ error: 'User not found' });
  const reveals = getRevealStatus(user, { all, run });

  // Add smart nudge if applicable
  let nudge = null;
  if ((user.user_type === 'free') && reveals.overageSpentThisCycle > 0) {
    const savings = calculateSavings('free', 'pro', reveals.overagePurchasedThisCycle);
    if (savings > 0) {
      nudge = {
        message: `You've spent $${reveals.overageSpentThisCycle.toFixed(2)} on reveals this month — the Pro plan would save you $${savings.toFixed(2)}.`,
        targetPlan: 'pro',
        savings
      };
    }
  }

  res.json({ ...reveals, nudge });
});

router.post('/inquire/:permitId', requireAuth, (req, res) => {
  const permit = get('SELECT * FROM permit_pins WHERE id = ? AND is_active = 1', [req.params.permitId]);
  if (!permit) return res.status(404).json({ error: 'Permit pin not found' });

  // Check if user already inquired on this permit
  const existing = get('SELECT id FROM inquiries WHERE permit_pin_id = ? AND user_id = ?', [permit.id, req.session.userId]);
  if (existing) return res.status(409).json({ error: 'You have already submitted an inquiry for this site' });

  // Check reveal credits
  const user = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const reveals = getRevealStatus(user, { all, run });

  if (reveals.remaining === 0 && reveals.limit !== -1) {
    const plan = PLANS[user.user_type] || PLANS.free;
    return res.status(403).json({
      error: 'No reveals remaining this month',
      reveals,
      overageRate: plan.overageRate,
      upgrade_needed: true
    });
  }

  // Consume a reveal (if not unlimited)
  if (reveals.limit !== -1) {
    run(`UPDATE users SET reveals_used = reveals_used + 1 WHERE id = ?`, [req.session.userId]);
  }

  // Create the inquiry
  const id = uuidv4();
  run(
    `INSERT INTO inquiries (id, permit_pin_id, user_id) VALUES (?, ?, ?)`,
    [id, permit.id, req.session.userId]
  );

  // Return updated reveal count
  const updatedUser = get('SELECT * FROM users WHERE id = ?', [req.session.userId]);
  const updatedReveals = getRevealStatus(updatedUser, { all, run });

  res.status(201).json({
    inquiry_id: id,
    message: "We'll reach out to the site owner and notify you when we hear back.",
    reveals: updatedReveals
  });
});

module.exports = router;
