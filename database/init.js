const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, '..', 'data', 'dirtlink.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

let db = null;

async function getDb() {
  if (db) return db;

  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(DB_PATH)) {
    const buffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      company_name TEXT NOT NULL,
      contact_name TEXT NOT NULL,
      phone TEXT,
      user_type TEXT NOT NULL DEFAULT 'free',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pins (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pin_type TEXT NOT NULL CHECK (pin_type IN ('have', 'need')),
      material_type TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      address TEXT,
      title TEXT NOT NULL,
      description TEXT,
      quantity_estimate TEXT,
      quantity_unit TEXT DEFAULT 'cubic_yards',
      is_tested INTEGER NOT NULL DEFAULT 0,
      test_report_path TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      pin_id TEXT NOT NULL,
      initiator_id TEXT NOT NULL,
      owner_id TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pin_id) REFERENCES pins(id),
      FOREIGN KEY (initiator_id) REFERENCES users(id),
      FOREIGN KEY (owner_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      sender_id TEXT NOT NULL,
      body TEXT NOT NULL,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id),
      FOREIGN KEY (sender_id) REFERENCES users(id)
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS pin_photos (
      id TEXT PRIMARY KEY,
      pin_id TEXT NOT NULL,
      file_path TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (pin_id) REFERENCES pins(id)
    )
  `);

  // API keys for external integrations (e.g. Hubert AI agent)
  db.run(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_hash TEXT UNIQUE NOT NULL,
      created_by TEXT NOT NULL,
      is_active INTEGER NOT NULL DEFAULT 1,
      last_used_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      revoked_at TEXT
    )
  `);

  // Development permit pins (opaque/unclaimed)
  db.run(`
    CREATE TABLE IF NOT EXISTS permit_pins (
      id TEXT PRIMARY KEY,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      address TEXT NOT NULL,
      permit_number TEXT NOT NULL,
      permit_type TEXT NOT NULL,
      permit_date TEXT NOT NULL,
      project_description TEXT,
      estimated_project_size TEXT,
      status TEXT NOT NULL DEFAULT 'unclaimed',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Permanent site pins (landfills, transfer stations)
  db.run(`
    CREATE TABLE IF NOT EXISTS permanent_pins (
      id TEXT PRIMARY KEY,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      site_name TEXT NOT NULL,
      site_type TEXT NOT NULL,
      address TEXT NOT NULL,
      contact_phone TEXT,
      contact_email TEXT,
      hours_of_operation TEXT,
      accepted_materials TEXT,
      rates_fees TEXT,
      website_url TEXT,
      notes TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_by_key TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Inquiries — users requesting to connect with permit pin owners
  db.run(`
    CREATE TABLE IF NOT EXISTS inquiries (
      id TEXT PRIMARY KEY,
      permit_pin_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (permit_pin_id) REFERENCES permit_pins(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Proximity alert settings — per-pin monitoring config for Powerhouse/Enterprise users
  db.run(`
    CREATE TABLE IF NOT EXISTS proximity_alert_settings (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      pin_id TEXT NOT NULL,
      radius_km REAL NOT NULL DEFAULT 10,
      notify_email INTEGER NOT NULL DEFAULT 1,
      notify_sms INTEGER NOT NULL DEFAULT 0,
      notify_in_app INTEGER NOT NULL DEFAULT 1,
      is_paused INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id),
      FOREIGN KEY (pin_id) REFERENCES pins(id)
    )
  `);

  // In-app proximity notifications
  db.run(`
    CREATE TABLE IF NOT EXISTS proximity_notifications (
      id TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL,
      alert_setting_id TEXT NOT NULL,
      trigger_pin_id TEXT,
      trigger_permit_pin_id TEXT,
      trigger_type TEXT NOT NULL,
      distance_km REAL NOT NULL,
      title TEXT NOT NULL,
      body TEXT NOT NULL,
      link TEXT,
      is_read INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (recipient_id) REFERENCES users(id),
      FOREIGN KEY (alert_setting_id) REFERENCES proximity_alert_settings(id)
    )
  `);

  // Add reveals tracking columns to users (safe — IF NOT EXISTS handled by ALTER failing silently)
  const userCols = all(`PRAGMA table_info(users)`).map(c => c.name);
  if (!userCols.includes('reveals_used')) {
    db.run(`ALTER TABLE users ADD COLUMN reveals_used INTEGER NOT NULL DEFAULT 0`);
  }
  if (!userCols.includes('reveals_reset_at')) {
    db.run(`ALTER TABLE users ADD COLUMN reveals_reset_at TEXT`);
  }
  // Stripe & subscription fields
  if (!userCols.includes('stripe_customer_id')) {
    db.run(`ALTER TABLE users ADD COLUMN stripe_customer_id TEXT`);
  }
  if (!userCols.includes('stripe_subscription_id')) {
    db.run(`ALTER TABLE users ADD COLUMN stripe_subscription_id TEXT`);
  }
  if (!userCols.includes('plan_started_at')) {
    db.run(`ALTER TABLE users ADD COLUMN plan_started_at TEXT`);
  }
  if (!userCols.includes('priority_notifications')) {
    db.run(`ALTER TABLE users ADD COLUMN priority_notifications INTEGER NOT NULL DEFAULT 0`);
  }

  // Notification preferences on users
  if (!userCols.includes('email_notifications')) {
    db.run(`ALTER TABLE users ADD COLUMN email_notifications INTEGER NOT NULL DEFAULT 1`);
  }
  if (!userCols.includes('sms_notifications')) {
    db.run(`ALTER TABLE users ADD COLUMN sms_notifications INTEGER NOT NULL DEFAULT 0`);
  }
  if (!userCols.includes('unsubscribe_token')) {
    db.run(`ALTER TABLE users ADD COLUMN unsubscribe_token TEXT`);
  }
  // Proximity alert defaults
  if (!userCols.includes('proximity_radius_km')) {
    db.run(`ALTER TABLE users ADD COLUMN proximity_radius_km REAL NOT NULL DEFAULT 10`);
  }
  if (!userCols.includes('proximity_paused')) {
    db.run(`ALTER TABLE users ADD COLUMN proximity_paused INTEGER NOT NULL DEFAULT 0`);
  }

  // Notification queue for batching
  db.run(`
    CREATE TABLE IF NOT EXISTS notification_queue (
      id TEXT PRIMARY KEY,
      recipient_id TEXT NOT NULL,
      conversation_id TEXT NOT NULL,
      message_id TEXT NOT NULL,
      sender_name TEXT NOT NULL,
      pin_address TEXT,
      message_body TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      sent_at TEXT,
      FOREIGN KEY (recipient_id) REFERENCES users(id),
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    )
  `);

  // Add timeline_date and source_permit_id to pins
  const pinCols = all(`PRAGMA table_info(pins)`).map(c => c.name);
  if (!pinCols.includes('timeline_date')) {
    db.run(`ALTER TABLE pins ADD COLUMN timeline_date TEXT`);
  }
  if (!pinCols.includes('source_permit_id')) {
    db.run(`ALTER TABLE pins ADD COLUMN source_permit_id TEXT`);
  }

  // Add claimed_by and claimed_at to permit_pins
  const permitCols = all(`PRAGMA table_info(permit_pins)`).map(c => c.name);
  if (!permitCols.includes('claimed_by')) {
    db.run(`ALTER TABLE permit_pins ADD COLUMN claimed_by TEXT`);
  }
  if (!permitCols.includes('claimed_at')) {
    db.run(`ALTER TABLE permit_pins ADD COLUMN claimed_at TEXT`);
  }

  // Add claimable fields to permanent_pins (business directory feature)
  const permPinCols = all(`PRAGMA table_info(permanent_pins)`).map(c => c.name);
  if (!permPinCols.includes('claimed_by')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN claimed_by TEXT`);
  }
  if (!permPinCols.includes('claimed_at')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN claimed_at TEXT`);
  }
  if (!permPinCols.includes('category')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN category TEXT`);
  }
  if (!permPinCols.includes('description')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN description TEXT`);
  }
  if (!permPinCols.includes('services')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN services TEXT`);
  }

  // Calgary suppliers directory (Stage 2 of /calgary/suppliers build).
  // entity_kind separates true suppliers from reference sites (landfills,
  // recyclers, city facilities) that share this table. directory_listing
  // is the explicit opt-in flag — Jonathan flips this per row after review.
  if (!permPinCols.includes('entity_kind')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN entity_kind TEXT NOT NULL DEFAULT 'reference'`);
  }
  if (!permPinCols.includes('directory_listing')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN directory_listing INTEGER NOT NULL DEFAULT 0`);
  }
  if (!permPinCols.includes('slug')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN slug TEXT`);
  }
  if (!permPinCols.includes('tier')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN tier TEXT NOT NULL DEFAULT 'free'`);
  }
  if (!permPinCols.includes('tier_expires_at')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN tier_expires_at TEXT`);
  }
  if (!permPinCols.includes('logo_url')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN logo_url TEXT`);
  }
  if (!permPinCols.includes('service_area')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN service_area TEXT`);
  }
  if (!permPinCols.includes('business_hours')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN business_hours TEXT`);
  }
  if (!permPinCols.includes('photos')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN photos TEXT`);
  }
  if (!permPinCols.includes('public_phone')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN public_phone INTEGER NOT NULL DEFAULT 0`);
  }
  if (!permPinCols.includes('public_address')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN public_address INTEGER NOT NULL DEFAULT 0`);
  }
  if (!permPinCols.includes('vanity_url')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN vanity_url TEXT`);
  }
  if (!permPinCols.includes('included_in_blast')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN included_in_blast INTEGER NOT NULL DEFAULT 0`);
  }
  if (!permPinCols.includes('is_sponsored_slot')) {
    db.run(`ALTER TABLE permanent_pins ADD COLUMN is_sponsored_slot INTEGER NOT NULL DEFAULT 0`);
  }

  // Extend leads for the Stage 5 routing scaffolding. The base table is
  // calculator-only today; these columns generalize it for any inbound lead.
  const leadCols = all(`PRAGMA table_info(leads)`).map(c => c.name);
  if (!leadCols.includes('phone')) {
    db.run(`ALTER TABLE leads ADD COLUMN phone TEXT`);
  }
  if (!leadCols.includes('materials_needed')) {
    db.run(`ALTER TABLE leads ADD COLUMN materials_needed TEXT`);
  }
  if (!leadCols.includes('quantity')) {
    db.run(`ALTER TABLE leads ADD COLUMN quantity TEXT`);
  }
  if (!leadCols.includes('location_lat')) {
    db.run(`ALTER TABLE leads ADD COLUMN location_lat REAL`);
  }
  if (!leadCols.includes('location_lng')) {
    db.run(`ALTER TABLE leads ADD COLUMN location_lng REAL`);
  }
  if (!leadCols.includes('location_area')) {
    db.run(`ALTER TABLE leads ADD COLUMN location_area TEXT`);
  }
  if (!leadCols.includes('matched_suppliers')) {
    db.run(`ALTER TABLE leads ADD COLUMN matched_suppliers TEXT`);
  }
  if (!leadCols.includes('categories')) {
    db.run(`ALTER TABLE leads ADD COLUMN categories TEXT`);
  }

  // Supplier directory claim flow (Stage 4). One row per claim attempt.
  // status transitions: 'email_sent' → 'approved' (after token click) OR
  // 'manual_review_pending' → 'approved' (after admin approval) OR
  // 'rejected' (admin reject).
  db.run(`
    CREATE TABLE IF NOT EXISTS supplier_claims (
      id TEXT PRIMARY KEY,
      supplier_pin_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      verification_token TEXT,
      verification_sent_to TEXT,
      verification_channel TEXT,
      approved_at TEXT,
      approved_by TEXT,
      rejected_reason TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (supplier_pin_id) REFERENCES permanent_pins(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Per-supplier lead notifications. Source of truth for "who got told
  // about which lead, at what tier, when, via what channel, and what
  // happened next". Schema follows the C2 confirmation in the Stage 1
  // open-questions reply, with `scheduled_for` added so the same row
  // doubles as the scheduler queue (status='pending' until sent).
  //
  // Production migration path: swap the in-process setTimeout scheduler
  // in services/lead-routing.js for a durable queue (BullMQ / SQS) that
  // polls WHERE notified_at IS NULL AND scheduled_for <= now().
  //
  // Note: an earlier `lead_notifications` table exists from a prior
  // Stage 2 iteration; it is unused and will be dropped in a future
  // migration once we're confident no rows exist anywhere.
  db.run(`
    CREATE TABLE IF NOT EXISTS supplier_lead_notifications (
      id TEXT PRIMARY KEY,
      lead_id TEXT NOT NULL,
      supplier_id TEXT NOT NULL,
      tier_at_routing TEXT NOT NULL,
      scheduled_for TEXT NOT NULL,
      notified_at TEXT,
      channel TEXT NOT NULL,
      email_opened_at TEXT,
      in_app_opened_at TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (lead_id)    REFERENCES leads(id),
      FOREIGN KEY (supplier_id) REFERENCES permanent_pins(id)
    )
  `);

  // Scopes for API keys (JSON array of strings, e.g. ["external:supplier-ingest"]).
  // NULL/missing means "no scope restrictions" — backwards-compat for keys
  // issued before E3 landed.
  const apiKeyCols = all(`PRAGMA table_info(api_keys)`).map(c => c.name);
  if (!apiKeyCols.includes('scopes')) {
    db.run(`ALTER TABLE api_keys ADD COLUMN scopes TEXT`);
  }

  // Reveal purchases (one-time overage buys)
  db.run(`
    CREATE TABLE IF NOT EXISTS reveal_purchases (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      amount INTEGER NOT NULL,
      stripe_payment_intent_id TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Billing history (subscriptions + one-time purchases)
  db.run(`
    CREATE TABLE IF NOT EXISTS billing_history (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      description TEXT NOT NULL,
      amount INTEGER NOT NULL,
      stripe_id TEXT,
      status TEXT NOT NULL DEFAULT 'completed',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // Calculator leads — captured from the disposal-cost calculator (and
  // future calculator widgets). DB is the system of record; admin email
  // is the immediate alert. See routes/leads.js + services/leads.js.
  db.run(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL,
      name TEXT,
      source TEXT NOT NULL,
      inputs TEXT,
      result TEXT,
      status TEXT NOT NULL DEFAULT 'new',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Audit log for API calls
  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key_id TEXT,
      api_key_name TEXT,
      method TEXT NOT NULL,
      path TEXT NOT NULL,
      status_code INTEGER,
      duration_ms INTEGER,
      request_body TEXT,
      ip_address TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Create indexes (IF NOT EXISTS not supported for indexes in all versions, use try/catch)
  const indexes = [
    'CREATE INDEX IF NOT EXISTS idx_pins_active ON pins(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_pins_type ON pins(pin_type)',
    'CREATE INDEX IF NOT EXISTS idx_pins_material ON pins(material_type)',
    'CREATE INDEX IF NOT EXISTS idx_pins_user ON pins(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_initiator ON conversations(initiator_id)',
    'CREATE INDEX IF NOT EXISTS idx_conversations_owner ON conversations(owner_id)',
    'CREATE INDEX IF NOT EXISTS idx_pin_photos ON pin_photos(pin_id)',
    'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
    'CREATE INDEX IF NOT EXISTS idx_permit_pins_status ON permit_pins(status)',
    'CREATE INDEX IF NOT EXISTS idx_permit_pins_active ON permit_pins(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_permit_pins_permit ON permit_pins(permit_number)',
    'CREATE INDEX IF NOT EXISTS idx_permanent_pins_active ON permanent_pins(is_active)',
    'CREATE INDEX IF NOT EXISTS idx_permanent_pins_type ON permanent_pins(site_type)',
    'CREATE INDEX IF NOT EXISTS idx_permanent_pins_claimed ON permanent_pins(claimed_by)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_key ON audit_log(api_key_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_leads_source ON leads(source)',
    'CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)',
    'CREATE INDEX IF NOT EXISTS idx_leads_created ON leads(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_leads_email ON leads(email)',
    'CREATE INDEX IF NOT EXISTS idx_inquiries_permit ON inquiries(permit_pin_id)',
    'CREATE INDEX IF NOT EXISTS idx_inquiries_user ON inquiries(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_permit_pins_claimed ON permit_pins(claimed_by)',
    'CREATE INDEX IF NOT EXISTS idx_reveal_purchases_user ON reveal_purchases(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_reveal_purchases_created ON reveal_purchases(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_billing_history_user ON billing_history(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)',
    'CREATE INDEX IF NOT EXISTS idx_notification_queue_recipient ON notification_queue(recipient_id, sent_at)',
    'CREATE INDEX IF NOT EXISTS idx_users_unsubscribe ON users(unsubscribe_token)',
    // Proximity alert indexes
    'CREATE INDEX IF NOT EXISTS idx_proximity_settings_user ON proximity_alert_settings(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_proximity_settings_pin ON proximity_alert_settings(pin_id)',
    'CREATE INDEX IF NOT EXISTS idx_proximity_settings_active ON proximity_alert_settings(user_id, is_paused)',
    'CREATE INDEX IF NOT EXISTS idx_proximity_notifications_recipient ON proximity_notifications(recipient_id, is_read)',
    // Geospatial bounding-box pre-filter indexes
    'CREATE INDEX IF NOT EXISTS idx_pins_lat ON pins(latitude)',
    'CREATE INDEX IF NOT EXISTS idx_pins_lng ON pins(longitude)',
    'CREATE INDEX IF NOT EXISTS idx_permit_pins_lat ON permit_pins(latitude)',
    'CREATE INDEX IF NOT EXISTS idx_permit_pins_lng ON permit_pins(longitude)',
    // Suppliers directory
    'CREATE INDEX IF NOT EXISTS idx_permanent_pins_directory ON permanent_pins(directory_listing, entity_kind)',
    'CREATE INDEX IF NOT EXISTS idx_permanent_pins_category ON permanent_pins(category)',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_permanent_pins_slug ON permanent_pins(slug) WHERE slug IS NOT NULL',
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_permanent_pins_vanity ON permanent_pins(vanity_url) WHERE vanity_url IS NOT NULL',
    // Lead notifications scheduler (legacy; superseded by supplier_lead_notifications)
    'CREATE INDEX IF NOT EXISTS idx_lead_notifications_pending ON lead_notifications(sent_at, scheduled_for)',
    'CREATE INDEX IF NOT EXISTS idx_lead_notifications_lead ON lead_notifications(lead_id)',
    // Supplier lead notifications (Stage 5)
    'CREATE INDEX IF NOT EXISTS idx_sln_pending  ON supplier_lead_notifications(notified_at, scheduled_for)',
    'CREATE INDEX IF NOT EXISTS idx_sln_lead     ON supplier_lead_notifications(lead_id)',
    'CREATE INDEX IF NOT EXISTS idx_sln_supplier ON supplier_lead_notifications(supplier_id)',
    'CREATE INDEX IF NOT EXISTS idx_sln_status   ON supplier_lead_notifications(status)',
    // Supplier claims
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_supplier_claims_token ON supplier_claims(verification_token) WHERE verification_token IS NOT NULL',
    'CREATE INDEX IF NOT EXISTS idx_supplier_claims_pin ON supplier_claims(supplier_pin_id)',
    'CREATE INDEX IF NOT EXISTS idx_supplier_claims_user ON supplier_claims(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_supplier_claims_status ON supplier_claims(status)'
  ];
  indexes.forEach(sql => { try { db.run(sql); } catch(e) {} });

  save();
  return db;
}

// Save database to disk
function save() {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(DB_PATH, buffer);
}

// Helper: run a query and return all rows as objects
function all(sql, params = []) {
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper: run a query and return first row as object
function get(sql, params = []) {
  const rows = all(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Helper: run an INSERT/UPDATE/DELETE
function run(sql, params = []) {
  db.run(sql, params);
  save();
  return { changes: db.getRowsModified() };
}

module.exports = { getDb, all, get, run, save };
