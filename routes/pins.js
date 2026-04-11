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
  const { pin_type, material_type, latitude, longitude, address, title, description, quantity_estimate, quantity_unit, is_tested } = req.body;

  if (!pin_type || !material_type || !latitude || !longitude || !title) {
    return res.status(400).json({ error: 'pin_type, material_type, latitude, longitude, and title are required' });
  }

  const id = uuidv4();
  const reportFile = req.files?.test_report?.[0];
  const test_report_path = reportFile ? `/uploads/reports/${reportFile.filename}` : null;

  run(
    `INSERT INTO pins (id, user_id, pin_type, material_type, latitude, longitude, address, title, description, quantity_estimate, quantity_unit, is_tested, test_report_path) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, req.session.userId, pin_type, material_type,
      parseFloat(latitude), parseFloat(longitude),
      address || null, title, description || null,
      quantity_estimate || null, quantity_unit || 'cubic_yards',
      is_tested === 'true' || is_tested === '1' ? 1 : 0,
      test_report_path
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

  const { title, description, quantity_estimate, quantity_unit, is_tested, is_active, material_type, latitude, longitude, pin_type, address } = req.body;
  const reportFile = req.files?.test_report?.[0];
  const test_report_path = reportFile ? `/uploads/reports/${reportFile.filename}` : pin.test_report_path;

  run(
    `UPDATE pins SET title = COALESCE(?, title), description = COALESCE(?, description), quantity_estimate = COALESCE(?, quantity_estimate), quantity_unit = COALESCE(?, quantity_unit), material_type = COALESCE(?, material_type), is_tested = COALESCE(?, is_tested), test_report_path = COALESCE(?, test_report_path), is_active = COALESCE(?, is_active), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude), pin_type = COALESCE(?, pin_type), address = COALESCE(?, address), updated_at = datetime('now') WHERE id = ?`,
    [
      title, description, quantity_estimate, quantity_unit, material_type,
      is_tested !== undefined ? (is_tested === 'true' || is_tested === '1' ? 1 : 0) : null,
      test_report_path, is_active !== undefined ? parseInt(is_active) : null,
      latitude ? parseFloat(latitude) : null, longitude ? parseFloat(longitude) : null,
      pin_type || null, address,
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

  const { is_active, latitude, longitude } = req.body;

  run(
    `UPDATE pins SET is_active = COALESCE(?, is_active), latitude = COALESCE(?, latitude), longitude = COALESCE(?, longitude), updated_at = datetime('now') WHERE id = ?`,
    [
      is_active !== undefined ? parseInt(is_active) : null,
      latitude !== undefined ? parseFloat(latitude) : null,
      longitude !== undefined ? parseFloat(longitude) : null,
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

module.exports = router;
