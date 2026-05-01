# Dirtlink Calculator Design

Two calculators, simple by design. The disposal cost calculator is the marketing centerpiece. The volume calculator is a utility on material pages. Both are mobile-first, browser-only (no backend), and shareable via URL.

---

## Calculator 1: Disposal Cost Calculator

**Purpose:** Show a contractor or homeowner what dumping dirt actually costs — and how much listing it on Dirtlink saves.

**Where it lives:**
- Primary page: `/calgary/dirt-disposal-cost`
- Embedded on: `/calgary/dirt-disposal`, `/calgary/landfill-tipping-fees`, `/calgary/free-fill-dirt`, `/calgary/fill-dirt`, `/calgary/clean-fill-wanted`, `/calgary` (parent hub)

### Inputs (three only)

#### Input 1: How many loads of dirt?
- **Control:** Slider, range 1-30
- **Default:** 5
- **Live hint next to value:** "(≈ X cubic yards)" using 14 yd³ per load
- **Why:** "Loads" is the unit dirt-movers think in. Cubic yards confuses homeowners.

#### Input 2: What kind of fill?
- **Control:** Four big tappable buttons (single-select). The fourth is critical — sod is the surprise driver of disposal cost in Calgary.
  - Clean Fill (soil/clay/gravel meeting clean-fill spec)
  - Has Sod
  - Mixed / has debris
  - Topsoil
- **Default:** Clean Fill
- **Behavior:** Drives both the per-tonne rate used in the calculation and the savings narrative shown to the user:
  - **Clean Fill / Topsoil:** Tipping is cheap ($0–$10/tonne) — narrative emphasizes time saved + skipping the City's commercial clean-fill approval.
  - **Has Sod:** Charged at the basic sanitary rate ($113/tonne) at the landfill. Narrative emphasizes that sod is *not* clean fill at Calgary landfills and Dirtlink can rehome it free.
  - **Mixed / has debris:** Up to $180/tonne with the commercial surcharge. Narrative emphasizes the real dollar savings.

> **Important — small load handling:** If the calculated total weight is under 250 kg (550 lb), the landfill cost line uses the $25 flat residential rate instead of per-tonne math. This prevents the "$0 to dump" answer for tiny clean-fill loads where the City's flat-rate minimum applies.

#### Input 3: Where in Calgary?
- **Control:** Postal code field (3-character prefix is fine: T2X, T3K, etc.) OR quadrant picker (NE / NW / SE / SW)
- **Default:** SE (highest disposal volume in Calgary)
- **Why:** Determines closest landfill and trucking time. Postal code is precise; quadrant is the no-friction fallback.

### Output (one screen, live-updating)

**Example output for a 5-load tandem run with sod (5 loads × 18 tonnes = 90 tonnes at $113/tonne):**

```
┌───────────────────────────────────────────────┐
│                                               │
│   Estimated disposal cost                     │
│                                               │
│   $10,890                                     │
│   ──────                                      │
│                                               │
│   Tipping (basic sanitary, $113/t): $10,170   │
│   Trucking (5 trips × 1h × $120):    $720     │
│   Your time:                         ~5 hours │
│                                               │
│   ─────────────────────────────────────       │
│                                               │
│   ✓ With Dirtlink: $0 for the fill            │
│     You cover hauling only ($720)             │
│                                               │
│   You save: $10,170 (93%)                     │
│                                               │
│   [ List this fill — free → ]                 │
│   [ Email me this estimate ]                  │
│                                               │
└───────────────────────────────────────────────┘
```

**Example output for the same 5 loads as pure clean fill ($10/tonne):**

```
┌───────────────────────────────────────────────┐
│                                               │
│   Estimated disposal cost                     │
│                                               │
│   $1,620                                      │
│   ──────                                      │
│                                               │
│   Tipping (clean fill, $10/t):       $900     │
│   Trucking (5 trips × 1h × $120):    $720     │
│   Your time:                         ~5 hours │
│                                               │
│   ─────────────────────────────────────       │
│                                               │
│   ✓ With Dirtlink: $0 for the fill            │
│     You cover hauling only ($720)             │
│                                               │
│   You save: $900 + 5 hours of trucking time   │
│                                               │
│   Plus you skip Calgary's commercial          │
│   clean-fill approval process.                │
│                                               │
│   [ List this fill — free → ]                 │
│   [ Email me this estimate ]                  │
│                                               │
└───────────────────────────────────────────────┘
```

The takeaway: the dollar savings tell different stories per load type, and the calculator makes that *visible* to the user instead of overstating one number.

### Behavior details

- **Live updates** — no "calculate" button. Inputs update the result instantly.
- **No login required** to use the calculator. Email is only requested if the user wants the result emailed.
- **Mobile-first** — entire calculator fits on a 375px screen with no horizontal scrolling.
- **Sticky CTA on mobile** — primary CTA stays visible at the bottom as the user scrolls through inputs.

### Shareable URL pattern

Every input is encoded in the URL so results are linkable:

```
dirtlink.ca/calgary/dirt-disposal-cost?loads=5&type=clean-fill&zone=SE
```

Loading the URL pre-populates inputs and shows the result. A "Copy results link" button copies this URL to clipboard. This means:
- A contractor can send his partner the exact estimate by link
- Email-shared results re-render correctly
- Social shares (rare but possible) preserve context

### Lead capture

The "Email me this estimate" button:
- Captures email + (optional) name
- Sends a templated email with the estimate and a link to the results URL
- Tags the lead in your CRM/email tool with "calculator-disposal-cost-Calgary"
- Returns the user to the result with a "✓ Sent" confirmation — no page change

This is the pure lead magnet. The user doesn't have to commit to listing — they just want the number. You get a contact who has actively shown intent to dispose of fill in Calgary.

### Calculation logic

All math runs in the browser. Four pieces of static data:

1. **Tipping rate** ($/tonne, by material type) — from a small JSON config file
2. **Trucking rate** ($/hour) — single Calgary average
3. **Trip time** (hours, by quadrant) — round-trip estimate to closest landfill
4. **Small-load flat rate** — applies when total weight < 250 kg

Pseudo-code:

```js
const tonnesPerLoad = 18  // tandem averages ~18 tonnes of fill
const totalTonnes = loads * tonnesPerLoad
const tippingPerTonne = config.tipping[materialType]  // clean-fill: 10, sod: 113, mixed: 180, topsoil: 10
const truckingHourly = config.trucking.hourly
const tripHours = config.tripTime[quadrant]

// Calgary small-load minimum: under 250 kg = $25 flat
const tippingTotal = (totalTonnes * 1000 < 250)
  ? config.smallLoadFlat
  : totalTonnes * tippingPerTonne

const truckingTotal = loads * tripHours * truckingHourly
const yourTime = loads * tripHours

const landfillTotal = tippingTotal + truckingTotal

// Dirtlink path: tipping fee disappears, trucking remains
const dirtlinkTotal = truckingTotal
const savings = landfillTotal - dirtlinkTotal
const savingsPct = Math.round((savings / landfillTotal) * 100)

// Material-type-aware narrative
const narrative = {
  'clean-fill': 'Plus you skip Calgary\'s commercial clean-fill approval process.',
  'topsoil':    'Plus the topsoil ends up in someone\'s garden instead of the landfill.',
  'sod':        'Sod is charged at the basic sanitary rate ($113/tonne) — Dirtlink takers want it for landscaping.',
  'mixed':      'Mixed loads can hit the $180/tonne commercial surcharge. Dirtlink rehomes the usable portion.'
}[materialType]
```

### Maintenance

When tipping rates change (typically annually), update the single JSON config:

```json
{
  "tipping": {
    "clean-fill": 10,
    "topsoil": 10,
    "sod": 113,
    "mixed": 180
  },
  "smallLoadFlat": 25,
  "smallLoadThresholdKg": 250,
  "trucking": {
    "hourly": 120,
    "tonnesPerLoad": 18
  },
  "tripTime": {
    "NE": 1.5,
    "NW": 2.0,
    "SE": 1.0,
    "SW": 2.5
  },
  "ratesVerifiedDate": "2026-04-29",
  "ratesSource": "City of Calgary — Landfill Commercial materials and rates / Landfill and Eco Centre residential materials and rates"
}
```

> **Rate notes:**
> - Clean fill is published as $0–$10/tonne; we use the upper bound ($10) for honesty in worst-case estimates. Adjust to the day's first-load rate if needed.
> - Sod is correctly billed at the basic sanitary rate at Calgary landfills — confirmed.
> - Mixed uses the commercial surcharge ($180/tonne) as the conservative estimate for any load with recyclables/compostables. Use $113 if you want to estimate a basic-sanitary mixed load.
> - Trucking hourly ($120) is a placeholder — replace with your actual Calgary tandem hauler quote.

---

## Calculator 2: Volume Calculator

**Purpose:** Help buyers figure out how much material they need.

**Where it lives:** Embedded on every material page — topsoil, gravel, sand, mulch, compost, landscape rock, river rock, road crush, pit run, loam.

### Inputs (two only)

#### Input 1: Area
- **Control:** Two number inputs (Length ft × Width ft) with a small "Or enter sq ft directly" toggle
- **Default:** 10 × 10

#### Input 2: Depth
- **Control:** Slider in inches, plus three preset chips:
  - "Lawn top-dress (1″)"
  - "New lawn / driveway (4″)"
  - "Garden bed (12″)"
- **Default:** 4″

### Output

```
You need approximately

  3.5 cubic yards

That's about 1 tandem load.

[ Browse topsoil listings → ]
```

The CTA copy adapts to the page (browse [material] listings). No lead capture, no money math — it's a utility that builds trust and earns search traffic for `[material] calculator` queries.

### Calculation

```js
const sqFt = length * width
const cubicFt = sqFt * (depthInches / 12)
const cubicYards = cubicFt / 27
```

Display rounded to one decimal, with a "≈ X loads" hint when over 10 yd³.

---

## What's deliberately NOT in v1

Parked features — revisit only after launch traction:

| Feature | Why not now |
|---|---|
| Truck size selector | Tandem is the dominant case; estimating, not invoicing |
| User-input hourly truck rate | Defeats simplicity; sensible Calgary default works |
| Multi-stop routing | Way too much complexity for an estimator |
| Live landfill API integration | Rates change yearly; manual JSON is robust |
| Required account creation | Kills usage; lead capture via opt-in email is enough |
| Charts and visualizations | A big number + a savings line is more compelling than a pie |
| Multi-city scope | Calgary only for v1; expand once template proves out |

---

## Tech stack recommendation

- **Component:** A single self-contained React component (`<DumpFeeCalculator />` and `<VolumeCalculator />`)
- **State:** Local React state, URL-synced via the framework's router (Next.js `useSearchParams` + `useRouter`)
- **Config:** Static JSON files in `/data/calgary-rates.json`. Hot-reloadable. No DB.
- **Lead capture:** POST to whatever email/CRM endpoint you already use (or a simple form-submission service like Formspree / your existing API)
- **Analytics events:** Fire on input change (debounced), result view, "list" CTA, "email" CTA

## Lighthouse / performance targets

- First Contentful Paint < 1.5s on mobile
- Total component bundle < 30KB gzipped
- Zero blocking third-party scripts in the calculator critical path

---

## Acceptance criteria for v1

Before marking the calculator "done":

- [ ] Three inputs render correctly on a 375px viewport
- [ ] Inputs update results live (no submit button)
- [ ] Result clearly shows landfill cost vs. Dirtlink savings
- [ ] URL encodes/decodes inputs round-trip
- [ ] "Copy results link" works
- [ ] "Email me this estimate" captures and confirms
- [ ] "List this fill" CTA navigates to listing form pre-populated
- [ ] Volume calculator renders on all 13 material pages
- [ ] Both calculators score ≥90 on Lighthouse mobile performance
- [ ] Inputs are keyboard accessible
- [ ] All number inputs handle edge cases (0, very large numbers, decimal entries)
