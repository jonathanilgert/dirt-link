# DirtLink Platform Overview
**Date:** April 11, 2026
**Version:** 1.0 (Pre-launch)
**Repository:** github.com/jonathanilgert/dirt-link

---

## Table of Contents

1. [What Is DirtLink](#1-what-is-dirtlink)
2. [Tech Stack](#2-tech-stack)
3. [Project Structure](#3-project-structure)
4. [Features — Complete Breakdown](#4-features--complete-breakdown)
5. [Pricing & Monetization](#5-pricing--monetization)
6. [Database Schema](#6-database-schema)
7. [API Reference Summary](#7-api-reference-summary)
8. [Deployment & Infrastructure](#8-deployment--infrastructure)
9. [Manual Testing Walkthrough](#9-manual-testing-walkthrough)
10. [Items That Still Need Attention](#10-items-that-still-need-attention)

---

## 1. What Is DirtLink

DirtLink is a web platform that connects construction and excavation sites that **have** earth material with sites that **need** earth material. It is an interactive map-based marketplace centered on Calgary, AB and surrounding areas.

**The problem:** Trucking dirt is expensive — $85-135/hr per dump truck. When a downtown condo excavation produces 10,000 cubic yards of clean fill, and a residential development 8 km away needs exactly that, both sides lose money if they don't find each other. The excavation pays to dump at a landfill, and the residential site pays to import fill from a gravel pit 40 km away.

**The solution:** DirtLink puts both sites on a shared map. The excavation drops a "HAVE" pin. The residential site drops a "NEED" pin. They see each other, message directly, and save thousands in trucking costs.

**Core principle:** Free to list, pay to connect. The map must be full of pins to be valuable, so posting is always free. Revenue comes from charging the demand side (people finding and reaching out to connect).

---

## 2. Tech Stack

| Layer | Technology |
|-------|-----------|
| **Backend** | Node.js 20, Express 4.21 |
| **Database** | sql.js (SQLite in-process, persisted to disk) |
| **Frontend** | Vanilla JavaScript (no framework), Leaflet 1.9.4 maps |
| **Auth** | express-session (cookie-based), bcryptjs password hashing |
| **Payments** | Stripe (subscriptions + one-time purchases) |
| **Email** | Nodemailer (SMTP), inbound reply parsing via webhook |
| **SMS** | Twilio |
| **File uploads** | Multer (disk storage, max 10MB per file) |
| **Maps** | Leaflet + OpenStreetMap tiles, Nominatim geocoding, Overpass API for natural features |
| **Deployment** | Docker, Fly.io (production), GitHub Actions CI/CD to DigitalOcean |
| **Font** | Figtree (Google Fonts) |

**Dev mode:** The app runs fully without Stripe, SMTP, or Twilio credentials. Subscriptions are applied immediately, email/SMS are logged to console.

---

## 3. Project Structure

```
dirt-link/
  server.js                  Main Express entry point (port 3001)
  config/
    pricing.js               Plan tiers, reveals, overage rates
  database/
    init.js                  SQLite schema, migrations, helpers
  middleware/
    auth.js                  Session-based auth (requireAuth)
    apiKey.js                API key validation + generation
    rateLimit.js             In-memory sliding-window rate limiter
    auditLog.js              Request logging for external API
  routes/
    auth.js                  Register, login, logout, profile, notifications
    pins.js                  CRUD pins, photos, claim, inquire, reveals
    messages.js              Conversations and messaging
    billing.js               Stripe checkout, webhooks, history
    apiKeys.js               API key generation, rotation, revocation
    externalApi.js           Permit pins, permanent pins, bulk import
    inbound.js               Email reply webhook
    proximity.js             Proximity alert settings + notifications
  services/
    notifications.js         Email/SMS batching for messages
    proximity.js             Haversine detection, batch digest, alert delivery
  public/
    index.html               Single-page app shell (all modals)
    css/style.css            Full design system (~2,600 lines)
    js/app.js                Main app logic (~1,550 lines)
    js/map.js                Leaflet map, markers, Overpass queries
    js/materials.js          Material categories, colors, lookup tables
    js/messaging.js          Messaging UI logic
  uploads/
    photos/                  Pin photos (jpg, png, webp, heic)
    reports/                 Test reports (pdf, doc, images)
  data/
    dirtlink.db              SQLite database file
  test-proximity.js          Proximity alerts test suite (41 tests)
  Dockerfile                 Node 20 Alpine container
  docker-compose.yml         Local dev with persistent volumes
  fly.toml                   Fly.io deployment config (SEA region)
  .github/workflows/
    deploy.yml               CI/CD: push to master -> SSH deploy
  .env.example               Environment variable template
  API.md                     Full API documentation with curl examples
```

---

## 4. Features -- Complete Breakdown

### 4.1 User Accounts

- **Registration:** Email, password (min 6 chars), company name, contact name, phone (required).
- **Login:** Email + password, session cookie (7-day expiry, secure in production).
- **Profile editing:** Company name, contact name, phone. Email is read-only after registration.
- **Password change:** Requires current password verification.
- **Plan tiers:** free, pro, powerhouse, enterprise (see Section 5).

### 4.2 The Map

- **Interactive Leaflet map** with OpenStreetMap base tiles.
- **Default location:** Calgary, AB. On first visit, a welcome modal prompts for city/province or browser geolocation.
- **Geocoding:** Nominatim proxy (`/api/geocode`) tries Canada, then US, then raw query. Handles postal codes, city names, addresses.
- **Natural features overlay:** Parks, forests, gardens (green) and rivers, streams, canals (blue) loaded from Overpass API at zoom level 9+. Re-queried on pan/zoom with 600ms debounce.
- **Three pin types on map:**
  - **User pins** (triangles) — color-coded by material category, pointing up for HAVE, down for NEED
  - **Permit pins** (opaque development permits) — amber/orange markers, show permit number and type
  - **Permanent pins** (landfills, transfer stations) — distinct markers showing site name and type

### 4.3 Material Categories

Four main categories, each with subcategories:

| Category | Color (Have/Need) | Subcategories |
|----------|--------------------|--------------|
| **Fill / Soil** | Green / Teal | Clean fill, topsoil, clay, peat, contaminated soil |
| **Aggregate** | Orange / Blue | Gravel, sand, crushed concrete, crushed asphalt, road base, pit run |
| **Organic** | Brown / Purple | Mulch, compost, wood chips, sod |
| **Rock & Rubble** | Red / Indigo | Rip rap, field stone, concrete rubble, asphalt rubble |

Each pin on the map is color-coded by its material category and have/need type. The sidebar legend is clickable — click a category to filter the map.

### 4.4 Dropping a Pin

1. Click "Drop a Pin" button in the sidebar.
2. A crosshair overlay appears on the map center with an instruction bar.
3. Pan/zoom the map to position the crosshair over the desired location.
4. Click "Place Pin" — a draggable marker appears. Drag to fine-tune.
5. Click "Continue" — the pin creation form opens as a modal.
6. Fill in: pin type (HAVE/NEED), material type, title, description, quantity + unit, address (optional), timeline (Now button or date picker), tested checkbox (reveals report upload field), photos (up to 5).
7. Submit creates the pin and it appears on the map immediately.

### 4.5 Pin Management (My Pins)

- View all your pins in card format with full details.
- **Edit:** Opens the drop pin form pre-filled with existing data. Can change any field, add new photos.
- **Reposition:** Switches to map view with the pin marker set to draggable. Move it and confirm.
- **Mark Complete:** Soft-deactivates the pin (is_active = 0). Pin disappears from the public map.
- **Reactivate:** Brings a completed pin back to active.
- **Delete:** Soft delete (sets is_active = 0).
- **Monitor** (Powerhouse/Enterprise only): Enables proximity alerts for that pin. See Section 4.10.

### 4.6 Permit Pins (External Data)

Development permits are loaded into DirtLink via the external API (e.g., by the Hubert AI agent scraping municipal permit databases).

- **Opaque by default:** Permit pins show on the map as amber markers with permit number, type, date, and project description — but no company contact info.
- **Two user actions on a permit pin:**
  1. **"This Is My Site" (Claim):** The permit holder can claim ownership, converting it into a full pin with material type, photos, test reports, etc. The permit pin is marked as claimed.
  2. **"I'd Like to Connect" (Inquire):** Other users can request an introduction to the permit holder. This consumes 1 reveal credit.
- **Bulk import:** Up to 500 permit pins per API request, with validation and duplicate checking.

### 4.7 Permanent Pins

Landfills, transfer stations, disposal sites — loaded via the external API.

- Always visible on the map.
- Display: site name, type, address, contact info, hours, accepted materials, rates, website.
- Not claimable or removable by regular users.

### 4.8 Messaging

- **Start a conversation:** Click "Message" on any pin detail view. Creates a conversation thread between the viewer and the pin owner.
- **Real-time feel:** Messages appear immediately on send. Unread count badge on the Messages nav button polls every 15 seconds.
- **Email notifications:** When you receive a message, you get a branded HTML email with the message content, sender name, and pin address. Single messages get a specific subject line; multiple rapid messages are batched into one digest email (1-minute batching window).
- **Reply via email:** Each notification email has a reply-to address in the format `reply+{conversationId}@dirtlink.ca`. Replying to the email posts the response back into the conversation (via inbound webhook).
- **SMS notifications:** Brief text alert with a link to the app. Requires Twilio credentials.
- **Unsubscribe:** Token-based link at the bottom of every email. Works without login — disables email_notifications for that user.

### 4.9 Reveal System

Reveals are the core monetization mechanic. When a user wants to inquire about a permit pin (connect with the permit holder), it costs 1 reveal.

- **Free:** 3 reveals/month, $4.99 per extra.
- **Pro:** 10 reveals/month, $2.99 per extra.
- **Powerhouse:** 40 reveals/month, $1.49 per extra.
- **Enterprise:** Unlimited reveals.

**Monthly reset:** Reveals reset to 0 used on the 1st of each month (checked automatically on `/api/auth/me`).

**Smart nudge:** If a Free user has spent money on overage reveals, the billing tab shows a nudge: "You've spent $X on reveals this month — the Pro plan would save you $Y."

**Reveal gate:** When a user tries to inquire with 0 reveals remaining, a modal offers: "Buy 1 Reveal — $X.XX" or "Upgrade to [next tier]".

### 4.10 Proximity Alerts (Powerhouse & Enterprise)

When a Powerhouse or Enterprise user has active pins on the map, they can monitor for new activity nearby.

**How it works:**
1. Go to My Pins and click "Monitor" on any active pin.
2. The system watches for new pins (material listings or development permits) that appear within your configured radius.
3. When a match is found, you receive notifications via your chosen channels.

**Detection engine:**
- Uses the **Haversine formula** for accurate great-circle distance calculation.
- **Bounding-box pre-filter** eliminates distant pins cheaply before running trig functions.
- Excludes the user's own new pins (no self-notification).
- Respects plan gating (only Powerhouse/Enterprise), per-pin pause, and global pause.

**Notification delivery:**
- **In-app:** Bell icon in the header with unread count badge. Click to see recent alerts in a dropdown panel. Polls every 30 seconds.
- **Email:** Branded HTML email: "A new [Material listing/Development permit] at [address], approximately [X] km from your site at [your pin address]."
- **SMS:** Brief text with distance and link.

**Batch deduplication:** When the external API bulk-imports 50 new development permits at once, the system groups them by monitored pin and sends **one digest notification per recipient**: "12 new sites appeared near your listing at [address] today." Not 12 separate alerts.

**User settings (Profile > Notifications tab):**
- Default monitoring radius: 5, 10, 25, or 50 km.
- Global pause: Temporarily disable all proximity alerts.
- Per-pin controls: Individual radius, pause, and channel toggles (email, SMS, in-app).
- Remove monitoring from any pin.

### 4.11 API Keys & External API

For programmatic access (e.g., the Hubert AI agent loading permit data):

- **Generate keys:** In-app key generation. Key shown once as `dl_` + 32-byte hex. Stored as SHA256 hash.
- **Rotate keys:** Revokes old key, creates new one with same name.
- **Rate limiting:** 60 requests per minute per API key.
- **Audit logging:** Every external API call logged with method, path, status, duration, request body, IP.
- **Endpoints:** Create/read permit pins, create/read permanent pins, bulk import (up to 500 per type per request).

### 4.12 Billing & Stripe Integration

- **Checkout flow:** User clicks "Upgrade to [Plan]" -> app creates Stripe checkout session -> redirect to Stripe -> on success, redirect back with `?billing=success&plan=X`.
- **Webhook processing:** Handles checkout completion, subscription updates, cancellations, invoice payments.
- **Dev mode:** Without Stripe keys, subscriptions are applied immediately (no redirect). Useful for local testing.
- **Billing history:** All transactions (subscriptions, reveal purchases, cancellations) logged and viewable in Profile > Billing tab.
- **Cancel subscription:** Sets cancel_at_period_end in Stripe. User keeps plan until end of billing period, then downgrades to Free.

---

## 5. Pricing & Monetization

### Plan Comparison

| Feature | Free | Pro ($29/mo) | Powerhouse ($59/mo) | Enterprise ($149/mo) |
|---------|------|-------------|--------------------|--------------------|
| Post unlimited pins | Yes | Yes | Yes | Yes |
| Browse the full map | Yes | Yes | Yes | Yes |
| Reveals per month | 3 | 10 | 40 | Unlimited |
| Extra reveal cost | $4.99 | $2.99 | $1.49 | N/A |
| Proximity alerts | -- | -- | Yes | Yes |
| Configurable monitoring radius | -- | -- | 5-50 km | 5-50 km |
| Email/SMS/in-app proximity notifications | -- | -- | Yes | Yes (priority) |
| Private map view | -- | -- | -- | Yes |
| Unlimited outreach | -- | -- | -- | Yes |

### Revenue Model

1. **Subscriptions:** Monthly recurring revenue from Pro, Powerhouse, and Enterprise members.
2. **Overage reveal purchases:** One-time payments when users exceed their included reveals.
3. **Smart nudges:** Automated upsell suggestions based on actual overage spending patterns.

### Key Insight

Never charge the supply side (people posting material). Charge the demand side (people finding and connecting). Supply filling the map is what makes the platform valuable.

---

## 6. Database Schema

14 tables, 30 indexes. Full schema managed via `database/init.js` with CREATE TABLE IF NOT EXISTS and ALTER TABLE migrations.

### Core Tables

| Table | Purpose | Key Columns |
|-------|---------|-------------|
| **users** | User accounts + subscription state | email, password_hash, company_name, user_type, reveals_used, stripe_customer_id, proximity_radius_km |
| **pins** | User-created material listings | user_id, pin_type (have/need), material_type, lat/lng, title, is_active, timeline_date |
| **pin_photos** | Photos attached to pins | pin_id, file_path |
| **conversations** | Message threads between users | pin_id, initiator_id, owner_id |
| **messages** | Individual messages | conversation_id, sender_id, body, is_read |
| **permit_pins** | External development permits | lat/lng, address, permit_number, status (unclaimed/claimed), claimed_by |
| **permanent_pins** | Landfills, transfer stations | lat/lng, site_name, site_type, accepted_materials, rates_fees |
| **inquiries** | User requests to connect with permit holders | permit_pin_id, user_id, status |

### Billing Tables

| Table | Purpose |
|-------|---------|
| **reveal_purchases** | One-time overage buys (amount in cents, Stripe payment ID) |
| **billing_history** | All billing events (subscriptions, purchases, cancellations) |

### Infrastructure Tables

| Table | Purpose |
|-------|---------|
| **api_keys** | External API credentials (name, key_hash, is_active) |
| **audit_log** | API request logging (method, path, status, duration, IP) |
| **notification_queue** | Email/SMS batching queue for messages |
| **proximity_alert_settings** | Per-pin monitoring config (user_id, pin_id, radius_km, channels, pause) |
| **proximity_notifications** | In-app proximity alert records |

---

## 7. API Reference Summary

Full details with curl examples are in `API.md` in the project root.

| Group | Endpoints | Auth |
|-------|-----------|------|
| **Auth** | POST /register, /login, /logout; GET /me; PUT /me, /password, /notifications | Session |
| **Pins** | GET /, /:id, /user/mine, /permits, /permanent, /reveals; POST /, /claim/:permitId, /inquire/:permitId; PUT /:id; PATCH /:id; DELETE /:id | Session |
| **Messages** | POST /conversations, /conversations/:id/messages; GET /conversations, /conversations/:id/messages, /unread-count | Session |
| **Billing** | GET /status, /plans, /history; POST /checkout, /buy-reveal, /cancel, /webhook | Session (webhook: Stripe signature) |
| **API Keys** | POST /, /:id/rotate; GET /; DELETE /:id | Session |
| **External API** | POST /permit-pins, /permanent-pins, /bulk; GET /permit-pins, /permanent-pins | API Key (X-API-Key header) |
| **Inbound** | POST /email | Webhook (no auth) |
| **Proximity** | GET /settings, /notifications, /notifications/count; PUT /settings, /monitor/:id; POST /monitor/:pinId, /notifications/read; DELETE /monitor/:id | Session + Plan gate |
| **Geocode** | GET /api/geocode?q=... | Public |
| **Unsubscribe** | GET /unsubscribe/:token | Public (token) |

---

## 8. Deployment & Infrastructure

### Local Development

```bash
cd dirt-link
cp .env.example .env           # Edit as needed (works without Stripe/SMTP/Twilio)
npm install
node server.js                 # http://localhost:3001
```

### Docker

```bash
docker-compose up --build      # Builds and runs with persistent volumes
```

### Production (Fly.io)

- **Region:** SEA (Seattle)
- **Resources:** 512MB RAM, 1 shared CPU, auto-scaling
- **Storage:** Persistent mounts — 1GB for SQLite DB, 3GB for uploads
- **HTTPS:** Enforced automatically

### CI/CD (GitHub Actions)

Push to `master` triggers automatic deployment:
1. SSH into DigitalOcean droplet
2. `git pull` latest code
3. `npm install --production`
4. `pm2 restart dirtlink`

### Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| PORT | No (default 3000) | Server port |
| NODE_ENV | No | 'production' enables secure cookies, trust proxy |
| SESSION_SECRET | Yes (for production) | Session encryption key |
| APP_URL | No | Base URL for links in emails/SMS |
| STRIPE_SECRET_KEY | No | Enables Stripe billing |
| STRIPE_WEBHOOK_SECRET | No | Stripe webhook signature verification |
| STRIPE_PRO_PRICE_ID | No | Stripe price ID for Pro plan |
| STRIPE_POWERHOUSE_PRICE_ID | No | Stripe price ID for Powerhouse plan |
| STRIPE_ENTERPRISE_PRICE_ID | No | Stripe price ID for Enterprise plan |
| SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS | No | Enables email notifications |
| FROM_EMAIL | No | Sender address (default: messages@dirtlink.ca) |
| TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER | No | Enables SMS notifications |

---

## 9. Manual Testing Walkthrough

This section walks through every feature so you can verify the platform works before selling memberships. Run the app locally with `node server.js`.

### 9.1 First-Time Experience

1. Open `http://localhost:3001` in your browser.
2. The welcome modal should appear asking for your city/province.
3. Type "Calgary, AB" and click "Go to My Area" — the map should center on Calgary.
4. Alternatively, click "Skip" to use browser geolocation.
5. The map should show OpenStreetMap tiles. Zoom in to level 9+ and you should see green parks and blue waterways appear.

### 9.2 Registration & Login

1. Click "Sign Up" in the header.
2. Fill in: Company Name, Your Name, Email, Phone, Password.
3. Click "Create Account" — you should be logged in immediately.
4. Verify the header shows your company name and a profile avatar (first letter).
5. Click "Log Out" — auth buttons should reappear.
6. Click "Log In" — enter your email and password. Verify successful login.

### 9.3 Dropping Pins

1. Click "+ Drop a Pin" in the sidebar.
2. The crosshair should appear over the map with an instruction bar.
3. Pan the map to a location, click "Place Pin" — a marker should appear.
4. Drag the marker to fine-tune, then click "Continue".
5. The pin form modal opens. Fill in:
   - Select "HAVE material to get rid of"
   - Material: Clean Fill (under Fill/Soil)
   - Title: "Test Excavation Site"
   - Description: anything
   - Quantity: 500, Unit: Cubic Yards
   - Click "Now" for timeline
   - Optionally upload a photo
6. Click "Drop Pin" (or the submit button).
7. The pin should appear on the map as a colored triangle pointing up (HAVE).
8. Click the pin on the map — a detail modal should show all the info you entered.

Repeat to create a "NEED" pin at a different location. It should be a downward triangle.

### 9.4 Filtering

1. In the sidebar, click "Have" filter — only HAVE pins should show.
2. Click "Need" — only NEED pins should show.
3. Click "All" — all pins visible.
4. Use the Material Category dropdown — selecting a category should filter pins.
5. Click a category in the legend — same effect.
6. Check "Tested materials only" — only pins with is_tested should show.

### 9.5 My Pins Management

1. Click "My Pins" in the nav bar.
2. You should see cards for both pins you created.
3. Click "Edit" on a pin — form should pre-fill with existing data. Make a change and save.
4. Click "Reposition" — map view should open with a draggable marker. Move it and confirm.
5. Click "Mark Complete" — pin should show as "Closed" and disappear from the public map.
6. Click "Reactivate" — pin comes back.

### 9.6 Messaging

1. Open a second browser (or incognito window) and register a second user.
2. As User 2, find User 1's pin on the map and click it.
3. In the pin detail, click "Message" (or equivalent).
4. Type a message and send it.
5. Switch to User 1's browser — check the Messages nav button for an unread badge.
6. Click Messages — the conversation should appear in the list.
7. Click into it — you should see User 2's message.
8. Reply back. Switch to User 2 and verify the reply appears.
9. Check the server console for email/SMS log messages (SMTP/Twilio not configured = console output).

### 9.7 Billing & Plans (Dev Mode)

Without Stripe keys, billing works in dev mode (immediate plan changes, no actual charges).

1. Click your profile avatar > Billing tab.
2. You should see "Free" as your current plan, with 3 reveals remaining.
3. You should see 4 plan cards: Free, Pro, Powerhouse, Enterprise.
4. Click "Upgrade to Pro" — in dev mode, the plan should change immediately.
5. Verify the billing tab now shows "Pro" with 10 reveals.
6. Go back and click "Upgrade to Powerhouse" — verify the change.
7. Check billing history — entries should appear for each change.

### 9.8 Reveal System

1. Ensure you're on the Free plan (or manually set in DB).
2. Go to the map and click on a permit pin (if any exist — see 9.10 to create some).
3. Click "I'd Like to Connect With This Site."
4. The inquiry confirmation should show your reveal count.
5. Click "Confirm — Use 1 Reveal."
6. Verify reveals_used incremented (check Profile > Billing > reveal bar).
7. Use all 3 reveals, then try to inquire again.
8. The "No Reveals Remaining" gate should appear with "Buy 1 Reveal" and "Upgrade" options.
9. In dev mode, clicking "Buy 1 Reveal" should grant it immediately.

### 9.9 Permit Pin Claim Flow

1. Create a permit pin via the API (see 9.10).
2. In the browser, find the permit pin on the map (amber marker).
3. Click it — the permit modal should show permit details.
4. Click "This Is My Site."
5. Fill in the claim form: pin type, material, quantity, etc.
6. Submit — the permit should now show as "Claimed" and a new user pin should appear at that location.

### 9.10 External API Testing

1. First, generate an API key: Profile > (you'd need to add API key management to the UI, or use curl):

```bash
# Register/login and get session cookie, then:
curl -X POST http://localhost:3001/api/keys \
  -H "Content-Type: application/json" \
  -H "Cookie: YOUR_SESSION_COOKIE" \
  -d '{"name": "Test Key"}'
```

Or manually insert one via the DB. Once you have a key:

```bash
# Create a single permit pin
curl -X POST http://localhost:3001/api/external/permit-pins \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "latitude": 51.0450,
    "longitude": -114.0600,
    "address": "123 Test Ave SW, Calgary",
    "permit_number": "DP2026-001",
    "permit_type": "Residential",
    "permit_date": "2026-04-11",
    "project_description": "New single-family home construction"
  }'

# Create a permanent pin (landfill)
curl -X POST http://localhost:3001/api/external/permanent-pins \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "latitude": 51.1200,
    "longitude": -114.1500,
    "site_name": "Spyhill Landfill",
    "site_type": "landfill",
    "address": "11808 85 St NW, Calgary",
    "accepted_materials": "Clean fill, concrete, asphalt",
    "hours_of_operation": "Mon-Sat 7am-5pm",
    "rates_fees": "$15/tonne clean fill"
  }'

# Bulk import
curl -X POST http://localhost:3001/api/external/bulk \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "permit_pins": [
      {"latitude": 51.046, "longitude": -114.061, "address": "456 Batch St", "permit_number": "DP2026-002", "permit_type": "Commercial", "permit_date": "2026-04-11"},
      {"latitude": 51.047, "longitude": -114.062, "address": "789 Batch Ave", "permit_number": "DP2026-003", "permit_type": "Commercial", "permit_date": "2026-04-11"},
      {"latitude": 51.048, "longitude": -114.063, "address": "101 Batch Rd", "permit_number": "DP2026-004", "permit_type": "Residential", "permit_date": "2026-04-11"}
    ]
  }'
```

Refresh the map — new permit pins should appear.

### 9.11 Proximity Alerts

1. Ensure you're on the Powerhouse or Enterprise plan (manually set if needed):

```bash
node -e "
const { getDb, run } = require('./database/init');
getDb().then(() => run(\"UPDATE users SET user_type = 'powerhouse' WHERE email = 'YOUR_EMAIL'\"));
"
```

2. Refresh the page. The **bell icon** should now appear in the header next to your profile.
3. Go to **My Pins** — each active pin should now have a **"Monitor"** button.
4. Click "Monitor" on a pin — it should change to "Monitoring" (green).
5. Go to **Profile > Notifications tab** — you should see the "Proximity Alerts" section with your monitored pin listed, radius selector, and pause toggle.
6. Now trigger an alert — create a nearby permit pin via the API (within 10km of your monitored pin):

```bash
curl -X POST http://localhost:3001/api/external/permit-pins \
  -H "Content-Type: application/json" \
  -H "X-API-Key: YOUR_API_KEY" \
  -d '{
    "latitude": YOUR_PIN_LAT_PLUS_0.01,
    "longitude": YOUR_PIN_LNG,
    "address": "Nearby Test Site",
    "permit_number": "PROX-TEST-001",
    "permit_type": "Residential",
    "permit_date": "2026-04-11"
  }'
```

7. Click the bell icon — a notification should appear: "New site near [your pin title]" with distance.
8. Click the notification to mark it as read.
9. Test "Mark all read" button.
10. Test batch: use the bulk import endpoint to add 5 nearby permits and verify you get a single digest notification.

### 9.12 Automated Test Suite

Run the proximity alerts test suite (41 tests):

```bash
cd ~/projects/dirt-link
node test-proximity.js
```

This tests: plan eligibility, Haversine math, bounding box, monitoring CRUD, nearby/far/self notifications, pause states, batch deduplication, custom radius, and plan gating. All tests should pass with 0 failures.

### 9.13 Notification Settings

1. Profile > Notifications tab:
   - Toggle email notifications on/off. Save.
   - Toggle SMS notifications on/off. Save. (SMS hint should show your phone or prompt to add one.)
2. Proximity section (Powerhouse+ only):
   - Change default radius to 25 km. Save.
   - Toggle "Pause all proximity alerts." Save. Verify no alerts fire while paused.
   - Per-pin: change radius, pause individual monitoring, remove monitoring.

---

## 10. Items That Still Need Attention

### Critical (Must fix before selling memberships)

1. **Stripe price IDs not configured.** The `.env` needs `STRIPE_PRO_PRICE_ID`, `STRIPE_POWERHOUSE_PRICE_ID`, and `STRIPE_ENTERPRISE_PRICE_ID` set to actual Stripe product prices. Without these, real billing doesn't work (only dev mode).

2. **No SMTP provider configured.** Email notifications (messages + proximity) log to console but don't actually send. Need to configure SMTP credentials (SendGrid, Mailgun, Postmark, etc.) in `.env`.

3. **No Twilio credentials configured.** SMS notifications log to console but don't send. Need `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER` in `.env`.

4. **Inbound email reply-to requires mail provider setup.** The reply-via-email feature needs a mail provider (SendGrid Inbound Parse, Mailgun Routes, or Postmark Inbound) configured to POST parsed emails to `/api/inbound/email`. This isn't just an env var — it requires provider-side configuration.

5. **SESSION_SECRET is using a dev default.** For production, `SESSION_SECRET` must be a strong random string. The current fallback is `'dev-secret'`.

### Important (Should address before launch)

6. **Session storage is in-memory.** Sessions are lost on server restart. For production, should add a persistent session store (e.g., connect-sqlite3 or Redis) if running behind a process manager that restarts.

7. **Rate limiting is in-memory only.** Works for single-instance but won't persist across restarts or scale to multiple instances. Consider Redis-backed rate limiting for production.

8. **No password reset flow.** If a user forgets their password, there's no "Forgot password?" link or email-based reset mechanism. They'd need manual intervention.

9. **No email verification on registration.** Users can register with any email address without verifying ownership. This means someone could register with someone else's email.

10. **API key management has no frontend UI.** API keys can only be created/managed via curl or direct API calls. There is no UI panel for users to manage their API keys in the browser. (The routes exist at `/api/keys`, but there's no corresponding tab or modal in the frontend.)

11. **Photo deletion not implemented.** Users can add photos to pins but cannot remove individual photos. The only way to remove photos is to delete the entire pin.

12. **No image optimization or CDN.** Photos are served directly from the `/uploads/` directory. For production, consider resizing images on upload and/or serving through a CDN (CloudFront, Bunny, etc.).

13. **Private map view (Enterprise feature) not implemented on the frontend.** The pricing config lists "Private map view (your sites only)" as an Enterprise feature, and the "My company only" filter checkbox exists in the sidebar, but the full private map experience (isolated view showing only the user's pins) is not a distinct mode — it's just a filter checkbox.

### Nice to Have (Post-launch)

14. **No real-time WebSocket messaging.** Messages use polling (every 15 seconds for unread count). Users won't see new messages instantly — there's a 15-second delay. WebSocket support would make conversations feel instant.

15. **No admin dashboard.** There's no way for an admin to view all users, manage plans, moderate content, or review audit logs without direct database queries.

16. **No user blocking or content moderation tools.** No ability to report pins, block users, or flag inappropriate content.

17. **Proximity alerts poll at 30-second intervals.** In-app proximity notifications use polling, not push. A 30-second delay is acceptable but WebSocket push would be more responsive.

18. **No analytics or dashboard for users.** No visualizations of material supply/demand trends, pricing trends, or connection activity — features mentioned in the original monetization plan for Pro+ tiers.

19. **Database is SQLite (single-file).** Fine for initial launch and moderate traffic, but won't support multiple server instances or heavy concurrent writes. Plan for migration to PostgreSQL if scaling beyond a single server.

20. **Permanent pins have no frontend management.** Permanent pins (landfills, etc.) can only be created via the external API. There's no way for admins to create, edit, or remove them through the web UI.

---

*This document was generated as a pre-launch reference for the DirtLink team. For API-specific details with curl examples, see `API.md` in the project root.*
