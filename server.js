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

// Dynamic sitemap MUST be registered BEFORE express.static so the
// generated XML wins over any stale public/sitemap.xml file.
app.get('/sitemap.xml', (req, res) => {
  const { all: dbAll2 } = require('./database/init');
  let base = '';
  try {
    base = fs.readFileSync(path.join(__dirname, 'public', 'sitemap.xml'), 'utf8');
  } catch {
    base = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n</urlset>\n`;
  }
  let suppliers = [];
  try {
    suppliers = dbAll2(
      `SELECT slug, updated_at FROM permanent_pins
        WHERE is_active = 1 AND entity_kind = 'supplier'
          AND directory_listing = 1 AND slug IS NOT NULL`
    );
  } catch (e) {
    suppliers = [];
  }
  const supplierUrls = suppliers.map(s => {
    const lastmod = (s.updated_at || '').slice(0, 10) || '2026-05-03';
    return `  <url><loc>https://dirtlink.ca/calgary/suppliers/${encodeURIComponent(s.slug)}</loc><lastmod>${lastmod}</lastmod><changefreq>monthly</changefreq><priority>0.5</priority></url>`;
  }).join('\n');
  const out = supplierUrls
    ? base.replace('</urlset>', `\n  <!-- Calgary supplier profiles (dynamic) -->\n${supplierUrls}\n</urlset>`)
    : base;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.send(out);
});

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
app.use('/api/claims', require('./routes/claims'));

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

// ── /calgary/suppliers — directory of Calgary dirt suppliers & trades ─────
// Server-rendered (NOT a SPA view): the DB is queried at request time and
// the full supplier list is interpolated into the HTML before sending, so
// every supplier name appears in the raw response and is curl-testable for
// SEO purposes. Profile pages at /calgary/suppliers/:slug land in Stage 3.
const directoryRender = require('./lib/directory-render');
const { all: dbAll } = require('./database/init');

app.get('/calgary/suppliers', (req, res) => {
  const filePath = path.join(__dirname, 'public', 'calgary', 'suppliers.html');
  fs.readFile(filePath, 'utf8', (err, html) => {
    if (err) return res.status(500).send('Directory unavailable');

    // Source of truth: permanent_pins WHERE entity_kind='supplier' AND
    // directory_listing=1. Reference sites (landfills, transfer stations)
    // and unflipped suppliers stay out until Jonathan opts them in.
    const suppliers = dbAll(
      `SELECT pp.id, pp.slug, pp.site_name, pp.category, pp.tier, pp.tier_expires_at,
              pp.description, pp.logo_url, pp.service_area, pp.claimed_by,
              pp.public_phone, pp.public_address
         FROM permanent_pins pp
        WHERE pp.is_active = 1
          AND pp.entity_kind = 'supplier'
          AND pp.directory_listing = 1
          AND pp.slug IS NOT NULL`
    );

    const gaId = process.env.GA_MEASUREMENT_ID || '';
    const out = html
      .replace(/\{\{GA_MEASUREMENT_ID\}\}/g, gaId)
      .replace(/\{\{GA_ENABLED\}\}/g, gaId ? 'true' : 'false')
      .replace(/\{\{HEADER\}\}/g, readPartial('header'))
      .replace(/\{\{FOOTER\}\}/g, readPartial('footer'))
      .replace(/\{\{SUPPLIER_DIRECTORY\}\}/g, directoryRender.renderDirectoryBody(suppliers))
      .replace(/\{\{BREADCRUMB_SCHEMA\}\}/g, directoryRender.renderBreadcrumbSchema())
      .replace(/\{\{ITEMLIST_SCHEMA\}\}/g, directoryRender.renderItemListSchema(suppliers))
      .replace(/\{\{FAQ_SCHEMA\}\}/g, directoryRender.renderFAQSchema());

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(out);
  });
});

// ── /calgary/suppliers/:slug — supplier profile pages ────────────────────
// Server-rendered with tier-gated fields. Vanity URL handler is registered
// FIRST so /v/ doesn't get treated as a slug. Reserved-slug guard prevents
// a supplier with name "API" or similar from colliding with route prefixes.
const profileRender = require('./lib/profile-render');
const { isReservedSlug } = require('./lib/directory-categories');
const PROFILE_TEMPLATE_PATH = path.join(__dirname, 'lib', 'templates', 'profile.html');
let PROFILE_TEMPLATE_CACHE = null;
function readProfileTemplate() {
  if (PROFILE_TEMPLATE_CACHE != null) return PROFILE_TEMPLATE_CACHE;
  PROFILE_TEMPLATE_CACHE = fs.readFileSync(PROFILE_TEMPLATE_PATH, 'utf8');
  return PROFILE_TEMPLATE_CACHE;
}

function fetchSupplierBy(field, value) {
  return dbAll(
    `SELECT pp.*, u.company_name AS claimed_company
       FROM permanent_pins pp
       LEFT JOIN users u ON pp.claimed_by = u.id
      WHERE pp.is_active = 1
        AND pp.entity_kind = 'supplier'
        AND pp.directory_listing = 1
        AND pp.${field} = ?
      LIMIT 1`,
    [value]
  )[0] || null;
}

function fetchSiblings(supplier) {
  if (!supplier.category) return [];
  return dbAll(
    `SELECT id, slug, site_name, tier, category
       FROM permanent_pins
      WHERE is_active = 1
        AND entity_kind = 'supplier'
        AND directory_listing = 1
        AND category = ?
        AND id != ?
        AND slug IS NOT NULL`,
    [supplier.category, supplier.id]
  );
}

function renderProfile(req, res, supplier) {
  const siblings = profileRender.pickSiblings(fetchSiblings(supplier), supplier.slug);
  const viewer = { userId: req.session ? req.session.userId : null };
  const body = profileRender.renderProfileBody(supplier, siblings, viewer);
  const schemas = profileRender.renderProfileSchemas(supplier);
  const tpl = readProfileTemplate();
  const gaId = process.env.GA_MEASUREMENT_ID || '';
  const title = `${supplier.site_name} — Calgary Supplier Profile | DirtLink`;
  const meta = supplier.description && profileRender.tierAtLeast(supplier.tier, 'pro')
    ? supplier.description.slice(0, 200)
    : `${supplier.site_name} — Calgary supplier listing on DirtLink. View location, service area, and contact info.`;
  const out = tpl
    .replace(/\{\{TITLE\}\}/g, title.replace(/&/g, '&amp;'))
    .replace(/\{\{META_DESCRIPTION\}\}/g, meta.replace(/"/g, '&quot;').replace(/&/g, '&amp;'))
    .replace(/\{\{OG_TITLE\}\}/g, `${supplier.site_name} — Calgary`.replace(/&/g, '&amp;'))
    .replace(/\{\{OG_IMAGE\}\}/g, supplier.logo_url && profileRender.tierAtLeast(supplier.tier, 'pro')
      ? supplier.logo_url
      : 'https://dirtlink.ca/images/calgary/suppliers-og.jpg')
    .replace(/\{\{CANONICAL_URL\}\}/g, `https://dirtlink.ca/calgary/suppliers/${encodeURIComponent(supplier.slug)}`)
    .replace(/\{\{GA_MEASUREMENT_ID\}\}/g, gaId)
    .replace(/\{\{HEADER\}\}/g, readPartial('header'))
    .replace(/\{\{FOOTER\}\}/g, readPartial('footer'))
    .replace(/\{\{BREADCRUMB_SCHEMA\}\}/g, schemas.breadcrumb)
    .replace(/\{\{LOCALBUSINESS_SCHEMA\}\}/g, schemas.localBusiness)
    .replace(/\{\{PLACE_SCHEMA\}\}/g, schemas.place)
    .replace(/\{\{PROFILE_BODY\}\}/g, body);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(out);
}

// Vanity URL: Enterprise tier suppliers get /calgary/suppliers/v/:vanityUrl.
// Registered BEFORE the slug route so 'v' is never treated as a slug.
app.get('/calgary/suppliers/v/:vanityUrl', (req, res) => {
  const vanity = String(req.params.vanityUrl || '').toLowerCase();
  if (!vanity || isReservedSlug(vanity)) return res.status(404).send('Not found');
  const supplier = fetchSupplierBy('vanity_url', vanity);
  if (!supplier || supplier.tier !== 'enterprise') return res.status(404).send('Not found');
  renderProfile(req, res, supplier);
});

app.get('/calgary/suppliers/:slug', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!slug || isReservedSlug(slug)) return res.status(404).send('Not found');
  const supplier = fetchSupplierBy('slug', slug);
  if (!supplier) return res.status(404).send('Supplier not found');
  renderProfile(req, res, supplier);
});

// ── Claim flow + post-claim wizard pages ──────────────────────────────
const claimRender = require('./lib/claim-render');
const { verifyClaimByToken } = require('./services/claims');
const CLAIM_TEMPLATE_PATH = path.join(__dirname, 'lib', 'templates', 'claim.html');
let CLAIM_TEMPLATE_CACHE = null;
function readClaimTemplate() {
  if (CLAIM_TEMPLATE_CACHE != null) return CLAIM_TEMPLATE_CACHE;
  CLAIM_TEMPLATE_CACHE = fs.readFileSync(CLAIM_TEMPLATE_PATH, 'utf8');
  return CLAIM_TEMPLATE_CACHE;
}

function sendClaimPage(req, res, { title, body }) {
  const tpl = readClaimTemplate();
  const out = tpl
    .replace(/\{\{TITLE\}\}/g, (title || 'Claim — DirtLink').replace(/&/g, '&amp;'))
    .replace(/\{\{META_DESCRIPTION\}\}/g, 'Claim and manage your DirtLink directory listing.')
    .replace(/\{\{GA_MEASUREMENT_ID\}\}/g, process.env.GA_MEASUREMENT_ID || '')
    .replace(/\{\{HEADER\}\}/g, readPartial('header'))
    .replace(/\{\{FOOTER\}\}/g, readPartial('footer'))
    .replace(/\{\{BODY\}\}/g, body);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(out);
}

app.get('/claim/:slug', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!slug || isReservedSlug(slug)) return res.status(404).send('Not found');
  const supplier = fetchSupplierBy('slug', slug);
  if (!supplier) return res.status(404).send('Supplier not found');
  const viewer = req.session && req.session.userId
    ? { userId: req.session.userId, email: req.session.userEmail || '' }
    : null;
  const body = claimRender.renderClaimLanding({ supplier, viewer });
  sendClaimPage(req, res, { title: `Claim ${supplier.site_name} — DirtLink`, body });
});

app.get('/claim/:slug/verify/:token', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  const token = String(req.params.token || '');
  if (!slug || isReservedSlug(slug)) return res.status(404).send('Not found');
  const supplier = fetchSupplierBy('slug', slug);
  if (!supplier) return res.status(404).send('Supplier not found');

  if (!req.session || !req.session.userId) {
    // Token requires the claim's user to be logged in. Bounce to sign-in
    // and come back here.
    const continueUrl = `/claim/${encodeURIComponent(slug)}/verify/${encodeURIComponent(token)}`;
    return res.redirect(`/app?action=sign-in&redirect=${encodeURIComponent(continueUrl)}`);
  }

  const result = verifyClaimByToken({ token, userId: req.session.userId });
  let body;
  if (result.ok) {
    body = claimRender.renderClaimVerified({ supplier: result.supplier || supplier, alreadyApproved: !!result.alreadyApproved });
  } else {
    body = claimRender.renderClaimError({ reason: result.reason, supplier });
  }
  sendClaimPage(req, res, { title: `Verify — DirtLink`, body });
});

app.get('/claim/:slug/wizard', (req, res) => {
  const slug = String(req.params.slug || '').toLowerCase();
  if (!slug || isReservedSlug(slug)) return res.status(404).send('Not found');
  const supplier = fetchSupplierBy('slug', slug);
  if (!supplier) return res.status(404).send('Supplier not found');

  if (!req.session || !req.session.userId) {
    return res.redirect(`/app?action=sign-in&redirect=${encodeURIComponent('/claim/' + slug + '/wizard')}`);
  }
  if (supplier.claimed_by !== req.session.userId) {
    return res.status(403).send('You do not own this listing.');
  }

  const claim = dbAll(
    `SELECT * FROM supplier_claims WHERE supplier_pin_id = ? AND user_id = ? AND status = 'approved'
       ORDER BY approved_at DESC LIMIT 1`,
    [supplier.id, req.session.userId]
  )[0] || null;
  if (!claim) return res.status(403).send('No approved claim for this listing.');

  const userRow = dbAll(`SELECT user_type FROM users WHERE id = ?`, [req.session.userId])[0];
  const userTier = (userRow && userRow.user_type) || 'free';
  const step = parseInt(req.query.step, 10) || 1;
  const body = claimRender.renderWizardStep({
    supplier,
    viewer: { userId: req.session.userId, claimId: claim.id },
    userTier,
    step
  });
  sendClaimPage(req, res, { title: `${supplier.site_name} — editor — DirtLink`, body });
});

// ── /upgrade — hold-page stub for the wizard's unlock CTAs ────────────
app.get('/upgrade', (req, res) => {
  const plan = String(req.query.plan || '').toLowerCase();
  const supplierSlug = String(req.query.supplier || '').toLowerCase();
  const fromStep = String(req.query.from || '');
  let supplierName = '';
  if (supplierSlug && !isReservedSlug(supplierSlug)) {
    const s = fetchSupplierBy('slug', supplierSlug);
    if (s) supplierName = s.site_name;
  }
  const body = claimRender.renderUpgradeHoldPage({ plan, supplierSlug, supplierName, fromStep });
  sendClaimPage(req, res, { title: `Upgrade — DirtLink`, body });
});

// Catch-all → redirect to landing (skip API and legal routes)
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/') || req.path.startsWith('/legal/') || req.path.startsWith('/admin')) {
    return res.status(404).send('Not found');
  }
  // Password reset links land here — serve the app so JS can pick up the token
  if (req.path === '/reset-password') {
    return res.sendFile(path.join(__dirname, 'public', 'index.html'));
  }
  res.redirect('/');
});

// Initialize database then start server
getDb().then(() => {
  app.listen(PORT, () => {
    console.log(`\n  DirtLink is running at http://localhost:${PORT}\n`);
    // Re-arm any pending supplier_lead_notifications scheduled before
    // the last restart. Skipped automatically when LEAD_ROUTING_ENABLED
    // is unset/false. See services/lead-routing.js for the contract.
    try {
      const { recoverPendingNotifications } = require('./services/lead-routing');
      const r = recoverPendingNotifications();
      if (r && !r.skipped) {
        console.log(`  Recovered ${r.recovered} pending supplier notifications (${r.immediate} sent, ${r.deferred} deferred)`);
      }
    } catch (e) {
      console.error('  recoverPendingNotifications failed:', e.message);
    }
  });
}).catch(err => {
  console.error('Failed to initialize database:', err);
  process.exit(1);
});
