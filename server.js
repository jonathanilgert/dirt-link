require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./database/init');
const SQLiteSessionStore = require('./database/sessionStore');

const app = express();
const PORT = process.env.PORT || 3000;
const isProd = process.env.NODE_ENV === 'production';

// Trust Fly.io / reverse-proxy so secure cookies work over HTTPS
if (isProd) app.set('trust proxy', 1);

// Ensure uploads directories exist
fs.mkdirSync(path.join(__dirname, 'uploads', 'reports'), { recursive: true });
fs.mkdirSync(path.join(__dirname, 'uploads', 'photos'), { recursive: true });

// Stripe webhook needs raw body — must be before express.json()
app.use('/api/billing/webhook', express.raw({ type: 'application/json' }));

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(session({
  store: new SQLiteSessionStore(),
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: isProd, maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Static files — index: false so '/' doesn't auto-serve index.html
// `redirect: false` prevents express.static from issuing a 301 to add a
// trailing slash on directory paths (e.g. /calgary → /calgary/). We want
// our explicit LANDING_PAGES routes to handle `/calgary` directly.
app.use(express.static(path.join(__dirname, 'public'), { index: false, redirect: false }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Root → landing page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'landing.html'));
});

// App → SPA (handles /app and any /app/... path for client-side routing)
app.get(['/app', '/app/*'], (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Legal pages — clean URLs (no .html extension)
const LEGAL_SLUGS = ['terms','privacy','disclaimer','refunds','acceptable-use','cookies','copyright','open-data','sub-processors'];
LEGAL_SLUGS.forEach(slug => {
  app.get(`/legal/${slug}`, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'legal', `${slug}.html`));
  });
});

// Redirect bare /index.html to /app for anyone with old bookmarks
app.get('/index.html', (req, res) => res.redirect(301, '/app'));

// Public-readable rate sheet — served explicitly so the rest of /data
// (including dirtlink.db) stays private.
app.get('/data/calgary-rates.json', (req, res) => {
  res.sendFile(path.join(__dirname, 'data', 'calgary-rates.json'));
});


// Geocoding proxy (Nominatim blocks browser requests without proper User-Agent)
app.get('/api/geocode', async (req, res) => {
  const { q } = req.query;
  if (!q) return res.status(400).json({ error: 'Query required' });

  const headers = { 'User-Agent': 'DirtLink/1.0 (construction material marketplace)' };

  try {
    // Search within North America — try with Canada first, then US, then raw query
    const queries = [
      `${q}, Canada`,
      `${q}, United States`,
      q
    ];

    let data = [];
    for (const query of queries) {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1`;
      const response = await fetch(url, { headers });
      data = await response.json();
      if (data.length > 0) break;
    }

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: 'Geocoding failed' });
  }
});

// Admin dashboard
app.use('/admin', require('./routes/admin'));

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/pins', require('./routes/pins'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/keys', require('./routes/apiKeys'));
app.use('/api/external', require('./routes/externalApi'));
app.use('/api/inbound', require('./routes/inbound'));
app.use('/api/proximity', require('./routes/proximity'));
app.use('/api/leads', require('./routes/leads'));

// Unsubscribe from email notifications (token-based, no auth required)
app.get('/unsubscribe/:token', (req, res) => {
  const { get: dbGet, run: dbRun } = require('./database/init');
  const user = dbGet('SELECT id, email FROM users WHERE unsubscribe_token = ?', [req.params.token]);
  if (!user) {
    return res.send(`
      <html><head><title>DirtLink</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}</style></head>
      <body><div style="text-align:center;"><h2>Invalid or expired link</h2><p>This unsubscribe link is no longer valid.</p></div></body></html>
    `);
  }
  dbRun('UPDATE users SET email_notifications = 0 WHERE id = ?', [user.id]);
  res.send(`
    <html><head><title>DirtLink — Unsubscribed</title><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f9fafb;}</style></head>
    <body><div style="text-align:center;"><h2>Unsubscribed</h2><p>You will no longer receive email notifications from DirtLink.</p><p style="color:#6b7280;">You can re-enable them anytime in your DirtLink profile settings.</p></div></body></html>
  `);
});

// ── Admin: API key provisioning (secured by ADMIN_SECRET env var) ──
// Usage: curl -X POST https://dirtlink.ca/api/admin/create-key \
//   -H "Content-Type: application/json" \
//   -d '{"secret":"YOUR_ADMIN_SECRET","name":"Hubert Agent"}'
app.post('/api/admin/create-key', (req, res) => {
  const adminSecret = process.env.ADMIN_SECRET;
  if (!adminSecret) {
    return res.status(503).json({ error: 'ADMIN_SECRET not configured on server' });
  }
  const { secret, name } = req.body;
  if (!secret || secret !== adminSecret) {
    return res.status(403).json({ error: 'Invalid admin secret' });
  }
  if (!name || !name.trim()) {
    return res.status(400).json({ error: 'Key name is required' });
  }

  const { v4: uuidv4 } = require('uuid');
  const { generateApiKey } = require('./middleware/apiKey');
  const { run } = require('./database/init');

  const id = uuidv4();
  const { key, hash } = generateApiKey();
  run(
    `INSERT INTO api_keys (id, name, key_hash, created_by) VALUES (?, ?, ?, 'admin')`,
    [id, name.trim(), hash]
  );

  res.status(201).json({
    id,
    name: name.trim(),
    key,
    message: 'Store this key securely — it will not be shown again.'
  });
});

// ── /calgary/list-fill — calculator funnel into the pin-creation flow ──────
app.get('/calgary/list-fill', (req, res) => {
  const params = new URLSearchParams(req.query);
  params.set('action', 'list-fill');
  res.redirect(302, '/app?' + params.toString());
});

// ── Calgary landing pages (SEO surface) ─────────────────────────────────────
// Static HTML host pages, server-rendered through this handler so we can
// substitute shared partials and inject env vars at request time. These
// pages MUST be fully rendered server-side — they exist to capture organic
// search traffic, and SPA-rendered SEO pages consistently underperform.
const LANDING_PAGES = {
  '/calgary':                          'calgary/index.html',
  '/calgary/topsoil':                  'calgary/topsoil.html',
  '/calgary/gravel':                   'calgary/gravel.html',
  '/calgary/fill-dirt':                'calgary/fill-dirt.html',
  '/calgary/sand':                     'calgary/sand.html',
  '/calgary/landscape-rock':           'calgary/landscape-rock.html',
  '/calgary/dirt-disposal':            'calgary/dirt-disposal.html',
  '/calgary/free-fill-dirt':           'calgary/free-fill-dirt.html',
  '/calgary/landfill-tipping-fees':    'calgary/landfill-tipping-fees.html',
  '/calgary/mulch':                    'calgary/mulch.html',
  '/calgary/compost':                  'calgary/compost.html',
  '/calgary/road-crush':               'calgary/road-crush.html',
  '/calgary/pit-run':                  'calgary/pit-run.html',
  '/calgary/river-rock':               'calgary/river-rock.html',
  '/calgary/recycled-concrete':        'calgary/recycled-concrete.html',
  '/calgary/loam':                     'calgary/loam.html',
  '/calgary/boulders':                 'calgary/boulders.html',
  '/calgary/clean-fill-wanted':        'calgary/clean-fill-wanted.html',
  '/calgary/dirt-disposal-cost':       'calgary/dirt-disposal-cost.html'
};

// In-memory cache for shared partials. Headers/footers don't change per
// request, so we read them once at first use.
const PARTIAL_CACHE = {};
function readPartial(name) {
  if (PARTIAL_CACHE[name] !== undefined) return PARTIAL_CACHE[name];
  try {
    PARTIAL_CACHE[name] = fs.readFileSync(
      path.join(__dirname, 'public', 'calgary', '_partials', name + '.html'),
      'utf8'
    );
  } catch {
    PARTIAL_CACHE[name] = '';
  }
  return PARTIAL_CACHE[name];
}

function renderLandingPage(req, res, relPath) {
  const filePath = path.join(__dirname, 'public', relPath);
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(404).send('Not found');
    const gaId = process.env.GA_MEASUREMENT_ID || '';
    const out = html
      .replace(/\{\{GA_MEASUREMENT_ID\}\}/g, gaId)
      .replace(/\{\{GA_ENABLED\}\}/g, gaId ? 'true' : 'false')
      .replace(/\{\{HEADER\}\}/g, readPartial('header'))
      .replace(/\{\{FOOTER\}\}/g, readPartial('footer'));
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(out);
  });
}

Object.entries(LANDING_PAGES).forEach(([route, file]) => {
  app.get(route, (req, res) => renderLandingPage(req, res, file));
});

// Catch-all → redirect to landing (skip API and legal routes)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/legal/') || req.path.startsWith('/admin')) {
    return res.status(404).send('Not found');
  }
  res.redirect('/');
});

// Initialize database then start server
getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  DirtLink is running at http://localhost:${PORT}\n`);
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
