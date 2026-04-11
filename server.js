require('dotenv').config();
const express = require('express');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { getDb } = require('./database/init');

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
  secret: process.env.SESSION_SECRET || 'dev-secret',
  resave: false,
  saveUninitialized: false,
  cookie: { secure: isProd, maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

// Static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

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

// Routes
app.use('/api/auth', require('./routes/auth'));
app.use('/api/pins', require('./routes/pins'));
app.use('/api/messages', require('./routes/messages'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/keys', require('./routes/apiKeys'));
app.use('/api/external', require('./routes/externalApi'));

// SPA fallback
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
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
