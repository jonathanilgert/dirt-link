# Calgary Suppliers Directory — Post-launch Follow-ups

Tracked work items carried out of the 6-stage build (Stages 1-6 shipped 2026-05-03).
Priorities: **P1** = next sprint · **P2** = within 60 days · **P3** = backlog.

---

## P1

### 1. Profile-page Lighthouse mobile performance

Currently 83-84 on the three sample profile pages — 1-2 points short of the
brief's ≥85 floor. Directory page already clears at 86. Three structural
fixes, in increasing effort order:

- **Self-host the two Google Fonts** (Inter Tight, JetBrains Mono). Eliminates
  the `fonts.gstatic.com` round-trip and ~75 KB of woff2 transfer over a
  cross-origin connection. Estimated +2-3 perf points.
- **Split `public/css/calgary.css` into per-surface bundles.** The current
  single sheet is 60% unused on a profile page (16 KB out of 26 KB). Splitting
  into `calgary-landing.css` / `calgary-directory.css` / `calgary-profile.css`
  / `calgary-claim.css` would each ship only what the page uses. Est. +3-4
  perf points.
- **Replace embedded Leaflet with a static map image** + "Click to interact"
  overlay. Eliminates the 43 KB JS + 15 KB CSS + tile fetches entirely. Est.
  +5-7 perf points but a UX regression (no pan/zoom by default).

Recommended order: self-host fonts first (smallest blast radius, ships
without UX change), then assess whether CSS split is needed.

Owner: TBD · ETA: next sprint.

---

## P2

### 2. Powerhouse-tier lead-routing rotation

Today every matched Powerhouse supplier in a lead's area+category is notified
in parallel at the 15-min delay. The brief's "deterministic daily rotation"
language was applied to directory-page sort order only; routing currently
notifies all matched Powerhouse listings.

When this changes, drop the algorithm into
`services/lead-routing.js` → `pickPowerhouseRotation()`. Flag
`LEAD_ROUTING_POWERHOUSE_ROTATION=1` is already wired, the call-site already
runs, and the function is currently a no-op passthrough. One-function swap.

Owner: TBD · ETA: post-launch, decided after first 2 weeks of lead-traffic
data.

### 3. Lat/lng + radius service-area matching

Per C4 confirmation: launch with string-contains over the controlled vocab,
upgrade to lat/lng + radius within 60 days. Schema columns to add:
`permanent_pins.service_radius_km` (REAL, default 50) and possibly a
centroid map for the controlled vocab. Migration is straightforward —
the vocab already maps cleanly to centroids.

### 4. In-app notifications inbox

Stage 5 schema has `supplier_lead_notifications.in_app_opened_at` and
`channel='both'` ready, but no in-app surface exists yet. Build a per-user
inbox that polls/SSE-streams new notifications, marks `in_app_opened_at` on
view, supports clicks-through to lead detail.

### 5. Real photo upload pipeline for the wizard

Stage 4 wizard accepts `logo_url` and `photos[]` as URLs. Build the
multer-backed file upload (E2 default: local `uploads/photos/` — same
pattern as existing pin photos in `routes/pins.js`). Add the `Migrate to
object storage when supplier-photo volume exceeds ~500 photos or 2 GB total`
comment per E2.

### 6. SES production access

Carried since Stage 1. Claim verification email and lead-routing email both
fall back gracefully today (claim → manual review queue; lead → DB row stays
durable, email logged but not delivered). Once SES exits sandbox, no code
change required — both paths activate automatically.

### 7. Stripe `customer.subscription.updated` webhook handler

Current sync (`routes/billing.js`) covers `checkout.session.completed` and
`customer.subscription.deleted` only. Plan upgrades that arrive via
`subscription.updated` mid-cycle aren't yet mirrored to `users.user_type`
or piped through `syncTierForUser`. Existing webhook had this same gap, so
Stage 4 didn't widen the contract — but worth closing.

### 8. Owner profile analytics

Powerhouse+ profiles render an "owner-only" analytics block (Stage 3) with
zeros and a `Live numbers ship in lead-routing rollout` note. To populate:
add a lightweight events table (`profile_views`, `profile_link_clicks`)
seeded by GA4-mirrored fires from the existing client-side event hooks.

---

## P3

### 9. Per-surface CSS chunks

Same opportunity as P1 #1 but treated as a refactor: introduce a build step
that emits one CSS file per route family. Defer until either (a) we add a
JS bundler for any other reason or (b) the perf gap reopens after #1.

### 10. Hubert ingestion API: scope-management endpoint

Today, granting a key the `external:supplier-ingest` or `admin:read` scope
requires a direct SQL update against `api_keys.scopes`. Add an admin-only
HTTP endpoint to issue keys with scopes attached.

### 11. Pin-classification CSV → admin UI

Today: `node scripts/inspect-pins.js` against production data produces the
CSV, you mark `decision` per row in Excel, commit. A future admin UI could
expose the same dataset with checkboxes that flip `directory_listing` and
write back, eliminating the CSV round-trip.

### 12. Drop the unused `lead_notifications` table

Stage 2 introduced `lead_notifications` for the scheduler queue. Stage 5
superseded it with `supplier_lead_notifications` (which doubles as both
queue and notification log). The old table is empty and unreferenced —
safe to `DROP TABLE` in a future migration once we're confident no rows
exist anywhere.

### 13. Vocabulary expansion

Service-area vocab is locked at 13 entries (Calgary Metro + 5 quadrants +
7 surrounding markets). When DirtLink expands beyond Calgary metro,
`lib/area-vocab.js` becomes the single source for new entries.
