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
    'CREATE INDEX IF NOT EXISTS idx_audit_log_key ON audit_log(api_key_id)',
    'CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_inquiries_permit ON inquiries(permit_pin_id)',
    'CREATE INDEX IF NOT EXISTS idx_inquiries_user ON inquiries(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_permit_pins_claimed ON permit_pins(claimed_by)',
    'CREATE INDEX IF NOT EXISTS idx_reveal_purchases_user ON reveal_purchases(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_reveal_purchases_created ON reveal_purchases(created_at)',
    'CREATE INDEX IF NOT EXISTS idx_billing_history_user ON billing_history(user_id)',
    'CREATE INDEX IF NOT EXISTS idx_users_stripe_customer ON users(stripe_customer_id)',
    'CREATE INDEX IF NOT EXISTS idx_notification_queue_recipient ON notification_queue(recipient_id, sent_at)',
    'CREATE INDEX IF NOT EXISTS idx_users_unsubscribe ON users(unsubscribe_token)'
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
