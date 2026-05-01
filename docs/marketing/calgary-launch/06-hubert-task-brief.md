# Dirtlink Calgary Launch — Hubert Task Brief

Three tasks to dispatch to Hubert as part of the Calgary calculator launch. Each is self-contained, machine-actionable, and reportable. Pick them up in any order based on availability and dependencies.

> **Tasks Hubert is NOT being asked to handle right now (these are Jonathan's, not Hubert's):**
> - AWS SES production-access request (requires Jonathan's AWS console + AWS account history)
> - Setting `GA_MEASUREMENT_ID` in production .env (requires deploy access + the actual GA4 property)
> - Real-device Lighthouse on a physical phone (requires Jonathan's phone)
> - Running the page-build Claude Code prompt (requires Jonathan's review at each stage)

---

## Task 1 — Cross-browser smoke test of `/calgary/dirt-disposal-cost`

**Trigger:** Run once after the calculator deploys to production. Re-run after any major change to the `disposal-cost.js` bundle or the host page.

**Inputs:**
- URL under test: `https://dirtlink.ca/calgary/dirt-disposal-cost`
- Test email for the lead form: `hubert+test-YYYY-MM-DD@dirtlink.ca` (or any tagged address that won't pollute real lead data — flag the report if the form rejects the +alias)

**Steps:**
1. Open the URL in three browsers: Chrome, Safari, Firefox.
2. For each browser, capture screenshots at:
   - Full desktop (1440px wide)
   - Mobile viewport at 375px (DevTools emulation, iPhone SE preset is fine)
3. In each browser, exercise the calculator with all four material types — capture the result screen for each:
   - Clean Fill — 5 loads, SE quadrant
   - Has Sod — 5 loads, SE quadrant
   - Mixed / has debris — 5 loads, SE quadrant
   - Topsoil — 5 loads, SE quadrant
4. Click "Copy results link" — verify the URL is on the clipboard and that pasting it in a new tab pre-populates inputs correctly.
5. Submit the "Email me this estimate" form once with the test email. Confirm the UI success state appears (note: the email itself will not arrive until SES is out of sandbox; that's a separate launch blocker not for Hubert to resolve).
6. While exercising, note any of the following:
   - Visual layout breaks (overflow, misalignment, busted responsive behavior)
   - Browser console errors
   - Calculator inputs that don't update the result
   - CTAs that don't navigate
   - Form validation accepting bad input or rejecting valid input

**Success criteria:**
- All three browsers render the calculator without regressions at both viewports
- Calculator math is identical across browsers for the same inputs
- Form submits successfully (or returns a clear, intentional error)

**Output:**
- Save a markdown report to `marketing/calgary-launch/qa/cross-browser-YYYY-MM-DD.md` with:
  - Pass/fail summary per browser × viewport (matrix table)
  - Embedded screenshots (relative `.png` paths in the same folder)
  - Issue list with severity tags: `blocker` / `cosmetic` / `nit`
  - Browser console error log per browser
- Email Jonathan at `jonathanilgert@gmail.com` with subject `[Hubert] Cross-browser smoke test complete (YYYY-MM-DD)` linking to the report file.

**Failure handling:**
If the page itself fails to load, abort the test and ping Jonathan immediately with the error. Don't proceed assuming a partial broken state.

---

## Task 2 — Source a real Calgary tandem-hauler quote

**Trigger:** Run once before the calculator goes public. Re-run quarterly as part of the rate-refresh cycle.

**Why this matters:**
The current trucking placeholder in `data/calgary-rates.json` is $120/hour. That number directly drives the "Trucking" line in every calculator result, so a stale or wrong number distorts the savings claim across every page the widget appears on. We need a defensible average grounded in real Calgary rates.

**Inputs:**
- Definition: hourly rate for a tandem dump truck operating in the Calgary metro. Tandem = roughly 14-18 cubic yards per load, ~18 tonnes payload.
- Geographic scope: Calgary plus Airdrie, Cochrane, Okotoks, Chestermere, Strathmore.

**Steps:**
1. Search the web for Calgary tandem hauler rate sources. Check:
   - Calgary-area trucking and hauling company websites (look for published rate cards)
   - Industry directories (HaulHub, Truckstop, ConstructConnect)
   - Construction trade forums (r/Construction, contractor Facebook groups)
   - Local classifieds (Kijiji, Craigslist, Facebook Marketplace) for currently advertised hauling rates
2. Aggregate **at least 5 distinct quotes or rate cards**, all dated within the last 12 months.
3. Record per source: company name / hourly rate / minimum hours (commonly 2-3 hr minimums) / fuel surcharge if charged separately / date posted / source URL.
4. Compute a defensible average and a range (low–high).
5. Identify the most current single data point as a sanity check against the average.

**Success criteria:**
- Minimum 5 sources, all current within 12 months
- Both an average and a range reported, so Jonathan can choose conservative or aggressive
- Each source cited with URL so Jonathan can verify
- Recommendation block with a single suggested rate to drop into `data/calgary-rates.json` and reasoning

**Output:**
- Save a markdown report to `marketing/calgary-launch/research/calgary-trucking-rates-YYYY-MM-DD.md`:
  - Header table: Source / Company / Hourly Rate / Min Hours / Fuel Surcharge / Date / URL
  - "Recommended rate" section below the table with the proposed value and reasoning
- Email Jonathan at `jonathanilgert@gmail.com` with subject `[Hubert] Calgary trucking rate research complete (YYYY-MM-DD)`.

**Failure handling:**
If fewer than 5 sources are findable through web research, stop, report what was found, and recommend the next step (e.g., "call 3 local haulers directly for live quotes — list of suggested companies attached").

---

## Task 3 — Recurring quarterly Calgary tipping-rate validation

**Trigger:** Every 90 days. First run scheduled for 2026-07-28. Subsequent runs every 90 days from there.

**Why this matters:**
Calgary landfill rates change annually (and sometimes mid-year). The calculator and several of the SEO landing pages publish actual rate numbers ($0–$10/t for clean fill, $113/t for basic sanitary, $180/t for commercial surcharge, $25 small-load flat). Stale numbers undermine trust and authority. A heartbeat agent prevents quiet drift.

**Inputs:**
- Reference file in the dirtlink.ca repo: `data/calgary-rates.json`
- Source URLs to fetch:
  - `https://www.calgary.ca/waste/landfill/commercial-materials.html` (commercial rates)
  - `https://www.calgary.ca/waste/landfill/residential-materials.html` (residential / small-load rates)
  - If the City restructures the URL, pivot to whichever page has the current commercial materials and rates table.

**Steps:**
1. Fetch both source URLs.
2. Parse the current rates for:
   - Clean fill ($/tonne)
   - Loads under 250 kg (flat rate)
   - Basic sanitary waste ($/tonne)
   - Commercial disposal surcharge ($/tonne)
3. Compare each value against `data/calgary-rates.json` (`tipping.clean-fill`, `tipping.sod`, `tipping.mixed`, `smallLoadFlat`).
4. **If any value has changed:**
   - Open a PR in the dirtlink.ca repo updating `data/calgary-rates.json`.
   - Update the `ratesVerifiedDate` field to today's date.
   - Update `ratesSource` if the City has restructured the page.
   - PR title: `chore(rates): Calgary landfill rates updated YYYY-MM-DD`
   - PR body: a markdown table showing old → new per category, plus a link to each source page used.
   - Tag Jonathan as reviewer.
   - Email Jonathan: subject `[Hubert] Calgary rates CHANGED — PR opened (YYYY-MM-DD)`, body summarizing the diff and the PR link.
5. **If no values have changed:**
   - Send heartbeat email to `jonathanilgert@gmail.com`:
     - Subject: `[Hubert] Calgary rates check: no changes (YYYY-MM-DD)`
     - Body: "Quarterly check complete. Current Calgary rates match `data/calgary-rates.json`. Sources verified: [URLs]. Next check: YYYY-MM-DD."

**Success criteria:**
- A heartbeat email or a PR-notification email **always** lands. Never silent.
- PR is opened automatically when a diff is detected — never silently merged, never forgotten.
- Parse failures are surfaced as alerts, not swallowed.

**Output format:**
Either a PR + email, or a heartbeat email. Never neither, never both.

**Failure handling:**
If a source URL fails to fetch, or the rate table can't be parsed (page restructure, cloudflare block, etc.), send an immediate alert email:
- Subject: `[Hubert] Calgary rates check: PARSE FAILED (YYYY-MM-DD)`
- Body: error description, the URL that failed, and a "manual review needed" line.
- Do NOT open a PR with bad data. Do NOT count the run as successful.

---

## Reporting standard (all tasks)

- All notification emails go to `jonathanilgert@gmail.com`
- Subject prefix: `[Hubert]`
- File outputs saved to the paths specified per task
- Failures surfaced immediately, not held to end-of-batch
- If any task spec is ambiguous, **ask Jonathan before proceeding** — don't guess

---

## Quick handoff summary

For pasting directly to Hubert:

> **Hubert, three tasks for the Dirtlink Calgary calculator launch. Full specs in `marketing/calgary-launch/06-hubert-task-brief.md`. Summary:**
>
> 1. **Cross-browser smoke test** of https://dirtlink.ca/calgary/dirt-disposal-cost in Chrome, Safari, Firefox at 375px and desktop. Exercise calculator with all 4 material types, submit the email form, screenshot any breaks. Report to `marketing/calgary-launch/qa/`.
>
> 2. **Calgary trucking rate research** — find at least 5 current Calgary tandem-hauler hourly rates, recommend a value to replace the $120/hr placeholder in `data/calgary-rates.json`. Report to `marketing/calgary-launch/research/`.
>
> 3. **Quarterly rate-check agent** — every 90 days, diff Calgary's published landfill rates against `data/calgary-rates.json`, open a PR if anything changed, send a heartbeat email if not. First run 2026-07-28. Heartbeat ALWAYS sends, even when no changes.
>
> All output paths and failure handling are in the brief. Email me at jonathanilgert@gmail.com on completion or failure with subject prefix `[Hubert]`. Ask if anything's unclear.
