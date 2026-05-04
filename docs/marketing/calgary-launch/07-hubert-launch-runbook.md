# Calgary Suppliers Directory — Launch Runbook (Hubert tasks)

You are verifying and setting up DirtLink's Calgary suppliers directory after Jonathan deploys the 6 stages to production. The build is documented in `docs/marketing/calgary-launch/follow-ups.md` (P1-P3 follow-ups) and across commits `e70831b..9aff05c` on the `calgary-seo-pages` branch (or whatever branch the server is now tracking after Jonathan's merge).

---

## Important constraints — read first

- **You do not SSH.** Your harness denies outbound SSH to production hosts and that's intentional. Every task in this runbook is reachable from `https://dirtlink.ca` over HTTPS. If you find yourself wanting to run an `ssh` command, stop — that's Jonathan's job and he handles it out-of-band.
- **You do not edit the production database.** Schema migrations apply automatically on `pm2 restart` (Jonathan's side). Runtime DB edits (granting key scopes, flipping `directory_listing=1`, approving stalled claims) are Jonathan's via `sqlite3` after `pm2 stop` / `pm2 start`.
- **There is no other runbook.** If anyone references "T1-T6", "STOP A/B/C", or `Hubert_Calgary_Suppliers_Deploy.md` — those are not real artifacts. The tasks below are L0 through L8. Confirm with Jonathan if you see references to anything else.
- **You have an existing DirtLink API key from the April 2026 provisioning.** Use it for any task that needs the `/api/external/*` surface, except L5 step 2 and L6 onward which require a new admin-scoped key Jonathan will provision specifically.
- **Coordination protocol:** Jonathan tells you "run L0" / "run L1" etc. as he completes each deploy step. You execute exactly that task, post a one-paragraph result with **PROCEED** or **ROLL BACK** as the last line, and stop. He decides the next move.

If any task fails partway, abort that task, post the error and the last successful step, and tag the report `BLOCKER`. Do not improvise around a 5xx — they break user trust faster than a delayed launch.

All output reports save to `marketing/calgary-launch/qa/launch-{YYYY-MM-DD}-{task-id}.md` and email Jonathan at `jonathanilgert@gmail.com` with subject `[Hubert] Stage <N> launch verification — {PASS|FAIL}`.

---

## Task L0 — Pre-deploy baseline (run BEFORE any deploy)

**This is your first action when Jonathan says "begin launch verification" or similar. Do NOT run any pre-flight server checks beyond what's in this task.**

**Trigger:** Once, before Jonathan starts the stage rollout.

**Inputs:**
- Production base: `https://dirtlink.ca`

**Steps:**
1. Capture HTTP status + size for these 8 URLs as the pre-deploy baseline:
   - `/`
   - `/calgary`
   - `/calgary/topsoil`
   - `/calgary/dirt-disposal-cost`
   - `/app`
   - `/sitemap.xml`
   - `/robots.txt`
   - `/api/pins/permanent` (proves the existing API still serves)
2. Save the response sizes — Stage 2 introduces small additions (sitemap, hub, cross-links) and you'll diff against this baseline.

**Success criteria:** All 8 URLs return 200 with non-zero size. Baseline saved.

**Output:** `launch-{date}-L0.md` with the URL/status/size table.

---

## Task L1 — Stage 2 verification (data model + directory page)

**Trigger:** Jonathan says "stage 2 deployed."

**Steps:**
1. `GET /calgary/suppliers` — expect 200. Body must contain ALL of:
   - `<h1>Calgary Dirt Suppliers, Earthworks Contractors &amp; Trades</h1>`
   - 10 occurrences of `class="directory-section"` (one per category)
   - Three `<script type="application/ld+json">` blocks containing `"@type":"ItemList"`, `"@type":"FAQPage"`, and `"@type":"BreadcrumbList"` respectively
2. `GET /calgary` — body must contain `data-cta="hub-suppliers-directory"` exactly once.
3. `GET /calgary/topsoil` — must contain `data-cta="material-to-directory"` exactly once. Spot-check 3 more material pages (`gravel`, `recycled-concrete`, `landfill-tipping-fees`) for the same.
4. `GET /sitemap.xml` — must contain `<loc>https://dirtlink.ca/calgary/suppliers</loc>`.
5. `GET /api/pins/permanent` — fetch JSON and confirm at least one record has the new fields `slug`, `directory_listing`, `entity_kind`, `tier`. (They'll all be NULL/0/'reference'/'free' on prod's existing rows — that's correct.)
6. Regression: `GET /calgary/topsoil`, `/calgary/gravel`, `/calgary` must still return 200 with size within ±15% of the L0 baseline (the cross-link adds ~6 bytes per page; size shouldn't change meaningfully).

**Success criteria:** All 6 steps pass. Directory page renders 10 empty-category placeholders (no real suppliers in the directory yet — that's expected).

**Output:** `launch-{date}-L1.md`. Include a screenshot of the rendered directory page for visual sanity check. Last line: `PROCEED` or `ROLL BACK`.

**Failure handling:** Any 5xx → tag `BLOCKER` and stop. Missing schema fields in the API payload → migrations didn't apply on restart; tell Jonathan to check `pm2 logs <process>` for `getDb()` errors.

---

## Task L2 — Stage 3 verification (profile pages + map link)

**Trigger:** "stage 3 deployed."

**Steps:**
1. `GET /calgary/suppliers/api` — expect **404** (reserved-slug guard).
2. `GET /calgary/suppliers/v/anything` — expect **404** (no Enterprise vanity URLs set yet).
3. `GET /calgary/suppliers/spyhill-landfill` (or any real `permanent_pins.slug` from the L0 API dump) — expect **404**. Profile pages stay invisible until `directory_listing=1` is flipped (later step).
4. `GET /api/pins/permanent` — confirm `directory_listing` is in the JSON keys for at least one record.
5. Open `/app` in a headless browser. Open the SPA map. Click any landfill/transfer-station pin (e.g., Spyhill). Confirm the popup renders without a "View full profile →" link (because `directory_listing=0` on those reference pins). Capture screenshot.
6. Regression: `/calgary/topsoil`, `/calgary/dirt-disposal-cost` still 200.

**Success criteria:** All steps pass. Reserved slugs and unflipped suppliers correctly 404.

**Output:** `launch-{date}-L2.md` with the popup screenshot. `PROCEED` / `ROLL BACK`.

---

## Task L3 — Stage 4 verification (claim + wizard + upgrade)

**Trigger:** "stage 4 deployed."

**Steps:**
1. `GET /claim/nonexistent-slug` — expect **404**.
2. `GET /claim/api` — expect **404** (reserved-slug guard).
3. `GET /upgrade?from=test&plan=pro&supplier=anything` — expect **200**. Body must contain `id="upgrade-continue-btn"` and `$29/mo`.
4. `GET /upgrade?plan=powerhouse&supplier=anything` — expect **200**, body contains `$59/mo`.
5. `GET /upgrade?plan=invalid` — expect **200** with body containing `Plan not recognised` (graceful unknown-plan handling).
6. `POST /api/claims/start` with `{"supplier_slug":"anything"}` and NO session cookie — expect **401**.
7. Open `/upgrade?from=test&plan=pro&supplier=foothills-pit-co` in a headless browser. Confirm the page renders, click **Continue to checkout** — expect a network request to `POST /api/billing/checkout` and (since Stripe is in test mode) either a redirect attempt or the fallback `<p id="upgrade-fallback">` block becoming visible. Either is acceptable.

**Success criteria:** Steps 1-6 pass. Step 7's fallback works whichever way the billing endpoint behaves.

**Output:** `launch-{date}-L3.md`. `PROCEED` / `ROLL BACK`.

---

## Task L4 — Stage 5 verification (lead routing + ingestion)

**Trigger:** "stage 5 deployed, flag OFF."

**Steps (flag OFF phase):**
1. `POST /api/leads` with the calculator payload:
   ```json
   {"email":"hubert+stage5-flagoff@dirtlink.ca","source":"calculator-disposal-cost-Calgary","inputs":{"loads":3,"materialType":"clean-fill","quadrant":"SE"}}
   ```
   Expect **201**. Response body must include `"matched_suppliers":0`.
2. Confirm the admin alert email landed in `jonathanilgert@gmail.com` within 60 seconds (use whatever inbox-poll mechanism you have, or wait 90 seconds and ask Jonathan to confirm).
3. `POST /api/leads/profile` with `{"email":"hubert+test@dirtlink.ca","supplier_slug":"definitely-not-a-supplier"}` — expect **404** `supplier_not_found`.
4. `POST /api/external/suppliers/ingest` with NO `X-API-Key` header — expect **401**.
5. `POST /api/external/suppliers/ingest` with your existing DirtLink API key and body `[]` — expect **200** with `{"summary":{"created":0,"updated":0,"rejected":0},"results":[]}`.
6. `POST /api/external/suppliers/ingest` with a 101-record array — expect **413**.
7. Tell Jonathan: "Stage 5 flag-OFF passed. Ready for `LEAD_ROUTING_ENABLED=1` flip."

**Trigger:** "stage 5 flag flipped to 1, restart complete."

**Steps (flag ON phase):**
1. Repeat step 1 from above (calculator submission). Expect **201** with `"matched_suppliers":0` (still 0 because no suppliers have `directory_listing=1`). Admin email still fires.
2. Validation test: `POST /api/external/suppliers/ingest` with a deliberately-bad batch:
   ```json
   [
     {"name":"","category":"aggregate-pits","serviceArea":["SE Calgary"]},
     {"name":"Bad Cat","category":"not-a-category","serviceArea":["SE Calgary"]},
     {"name":"Bad Area","category":"aggregate-pits","serviceArea":["Mars"]}
   ]
   ```
   Expect **200** with `summary: {created:0, updated:0, rejected:3}` and each result entry having a populated `errors[]`.

**Success criteria:** Both phases pass. The flag transition produces no behavior change on the smoke surface (because no directory listings exist yet) — that's the correct outcome.

**Output:** `launch-{date}-L4.md`. `PROCEED` / `ROLL BACK`.

---

## Task L5 — Stage 6 verification (admin endpoint + perf)

**Trigger:** "stage 6 deployed."

**Steps:**
1. `GET /api/external/admin/inspect-pins` with NO key — expect **401**.
2. `GET /api/external/admin/inspect-pins` with your existing DirtLink API key — depending on whether your key has `admin:read` scope or NULL scopes, expect either **200** (with the JSON dump) or **403** (key missing required scope). Both outcomes are acceptable; report which one.
3. Lighthouse mobile via headless Chrome on `https://dirtlink.ca/calgary/suppliers`. Capture the four scores (Performance / Accessibility / Best Practices / SEO). Save the full HTML report to `marketing/calgary-launch/qa/lighthouse-prod-suppliers-{date}.html`.
4. Repeat step 3 for `/calgary/topsoil` (regression check vs. existing landing-page Lighthouse history if any).
5. Open `/calgary/suppliers` in a headless browser and confirm in the network tab:
   - `leaflet.js` is **NOT** loaded (Stage 6 lazy-load — only profiles load Leaflet, and only when scrolled into the map's vicinity).
   - `fonts.googleapis.com` and `fonts.gstatic.com` requests appear (font-loading is unchanged).

**Success criteria:** All steps pass. Lighthouse Performance on `/calgary/suppliers` should be in the 80-90 range; below 75 is concerning. Profile-page Lighthouse is deferred until L6 has flipped a real supplier.

**Output:** `launch-{date}-L5.md` with the Lighthouse score table. `PROCEED` / `ROLL BACK`.

---

## Task L6 — Post-deploy: mint admin key, dump prod pins, build the classification CSV

**Trigger:** All 5 deploy stages have passed L1-L5. Jonathan is ready to start activating real suppliers.

**Inputs:**
- `ADMIN_SECRET` — Jonathan provides via secure channel (don't log it).

**Steps:**
1. `POST /api/admin/create-key` with `{"secret":"<ADMIN_SECRET>","name":"directory-launch-inspect-{date}"}`. Save the returned `key` value securely (it's only shown once).
2. **Stop here.** Tell Jonathan: "Admin key minted, name `directory-launch-inspect-{date}`. Need you to grant the `admin:read` scope via SSH:
   ```
   pm2 stop <process>
   sqlite3 /opt/dirt-link/data/dirtlink.db "UPDATE api_keys SET scopes='[\"admin:read\"]' WHERE name='directory-launch-inspect-{date}';"
   pm2 start <process>
   ```
   Confirm when done."
3. **Trigger:** Jonathan says "scope granted."
4. `GET /api/external/admin/inspect-pins?entity_kind=supplier` with the new key. Save the JSON response.
5. Transform the JSON into the classification CSV format from `docs/marketing/calgary-launch/pin-classification-review.csv`:
   ```
   pin_id, business_name, current_entity_type, suggested_category, decision, notes
   ```
   Use the heuristics in `scripts/inspect-pins.js` (`suggestCategory()`) for any supplier rows missing a `category`. Leave `decision` and `notes` blank for Jonathan to fill in.
6. Save the CSV to `marketing/calgary-launch/qa/prod-pins-{date}.csv` AND email it to Jonathan as an attachment.

**Success criteria:** Admin endpoint returns the full pin set. CSV emitted with one row per supplier-shaped pin.

**Output:** `launch-{date}-L6.md` summarizing pin counts by category + the path to the CSV.

**Failure handling:** If step 4 returns 403, the scope grant didn't take — ask Jonathan to verify the SQL update applied and the process restarted.

---

## Task L7 — Activation smoke test (after Jonathan flips the first batch)

**Trigger:** Jonathan says "I've flipped `directory_listing=1` on N suppliers, restart complete." He'll tell you which slugs.

**Steps:**
1. `GET /calgary/suppliers` — body now contains every flipped supplier's name (count must equal N).
2. For each flipped slug, `GET /calgary/suppliers/<slug>` — expect 200, body contains `<h1>` with the supplier name. Count must equal N.
3. `GET /sitemap.xml` — must contain a `<loc>` for every flipped slug.
4. Lighthouse mobile on the first flipped Powerhouse-tier slug (or Pro, or whichever is the highest tier in the batch). Compare scores to L5 baselines for `/calgary/suppliers`.
5. Send a calculator submission with a quadrant matching one of the flipped suppliers' service areas:
   ```json
   {"email":"hubert+activation-{date}@dirtlink.ca","source":"calculator-disposal-cost-Calgary","inputs":{"loads":5,"materialType":"clean-fill","quadrant":"SE"}}
   ```
   Expect `"matched_suppliers"` > 0 IF any flipped supplier (a) has `tier ≠ 'free'` AND (b) matches the area+category. If `matched_suppliers: 0`, that's correct only when no paid+matching supplier was flipped — note this in the report.
6. After step 5, query `GET /api/external/admin/inspect-pins?entity_kind=supplier` to get the latest state. Then ask Jonathan to share the count from his side (he can run `sqlite3 ... SELECT COUNT(*) FROM supplier_lead_notifications WHERE lead_id = '<id from step 5>'`). The count should be > 0 for the matching paid suppliers, 0 for free.

**Success criteria:** Directory + profiles render the new suppliers; sitemap is current; routing fires for paid matches.

**Output:** `launch-{date}-L7.md`. This is the launch sign-off — include a screenshot of `/calgary/suppliers` rendering the activated suppliers.

---

## Task L8 — Ongoing monitoring (optional, schedule weekly)

**Trigger:** Set up after L7 passes. Run weekly thereafter.

**Steps:**
1. Re-run L1 + L2 + L4 + L5 smoke tests (calculator path included).
2. Pull the latest pins via the admin endpoint. Compare to the previous week's snapshot. Flag any: new supplier with `directory_listing=1` but no `category` (looks like missing follow-through), suppliers with `tier='enterprise'` but `vanity_url IS NULL` (Enterprise tier paid but vanity URL not set), claims with `status='manual_review_pending'` older than 7 days (overdue manual queue).
3. Diff Lighthouse mobile scores against last week's. Anything that drops >5 points → flag.
4. Email summary to Jonathan with subject `[Hubert] Calgary directory weekly health — {YYYY-MM-DD}`.

**Success criteria:** All smoke tests still pass; no flagged anomalies.

**Output:** `marketing/calgary-launch/qa/weekly-{date}.md`.

---

## What is NOT in this runbook (these are Jonathan's, not yours)

- The actual deploy: `git pull`, `pm2 restart`, `.env` edits.
- Direct DB writes: granting scopes on `api_keys`, flipping `directory_listing=1` on suppliers, manually approving stalled `supplier_claims` rows.
- Pre-deploy server-state checks (`cat .git/HEAD`, `pm2 list`, `grep .env`) — Jonathan runs these from his own terminal before he starts. Don't try to run them.
- SES production-access request (still a launch blocker for the email-delivery path; the codebase already falls back gracefully).
- Decisions on the pin-classification CSV (which suppliers to approve / change-to / exclude).
- Stripe production wiring (the upgrade hold-page falls back to mailto when `/api/billing/checkout` isn't ready).

If you find yourself drafting an `ssh` command, an `sqlite3` command, or a shell command for execution on `159.89.125.8`, stop — that's Jonathan's surface and your harness will deny it (correctly). Hand the command back to him in your report and let him run it.
