# SMART MONEY METRICS FRAMEWORK V2

## Whale Profiling & Signal Quality System for Polymarket

**Purpose:** For any screened market, rapidly identify who holds the biggest positions, whether they're smart or dumb money, and produce actionable trade parameters (entry, target, stop, avg smart money price).

**Two modes:**
- **RAPID SCAN (5 min)** — Use this by default. Covers 80% of what you need.
- **DEEP DIVE (30+ min)** — Use when a market passes screening AND Jang has a thesis AND you need full wallet profiling before sizing up.

---

## RAPID SCAN: 5-MINUTE EXECUTION GUIDE

This is the standard process. Run this for every market that passes screening.

### Step 1: Pull Top Holders (1 min)

Go to the **specific market page** on polymarket.com → scroll to **"Top Holders"** tab.

Capture:
- Top 7 YES holders (username + share count)
- Top 7 NO holders (username + share count)
- Note the total share imbalance (which side has more concentrated holdings?)

### Step 2: Profile Top 3-4 Wallets Per Side (3 min)

Click each username from the Top Holders list (NOT by guessing @URLs — display names often don't match handles).

**30-Second Profile Assessment — grab these 5 data points:**

| Data Point | Where on Profile | What It Tells You |
|---|---|---|
| **Join Date** | Below username | Fresh (< 3 months) = suspicious. Old (> 1 year) = track record exists. |
| **Portfolio Value** | Left side stats | Whale ($100K+) vs fish ($1K). Size = conviction level. |
| **Biggest Win** | Left side stats | One big win + small portfolio = lucky once. Multiple big wins = skill. |
| **Prediction Count** | Left side stats | < 20 predictions = insufficient data, don't trust. > 100 = enough history. |
| **P&L Chart (1M)** | Top right card | Green trending up = currently hot. Red trending down = currently cold or gambler. |

Then scroll to **Active Positions** and check:
- What other markets are they in? (reveals their thesis)
- Are their positions in profit or loss? (green % = winning, red % = losing)
- What's their **avg entry price** on our target market?

**Quick Classification:**

| Pattern | Classification | Action |
|---|---|---|
| Old account + high prediction count + green P&L + diversified positions | **SMART MONEY** | Weight their signal heavily |
| Old account + high prediction count + red P&L on this category | **FADING EDGE** | They may have been good before but wrong now |
| Fresh account + huge positions + few predictions | **INSIDER OR GAMBLER** | Flag — could be very valuable signal OR total noise |
| Any account + massive negative P&L (millions in red) | **DUMB MONEY** | Their position is ANTI-signal — consider fading |
| Moderate account + many predictions + mixed P&L | **NOISE** | Ignore — no clear edge |

### Step 3: Compile Report (1 min)

Fill in the output template below using what you found.

---

## REPORT OUTPUT TEMPLATE

```
═══════════════════════════════════════════════════════════
  SMM REPORT: [Market Name] — [YOUR DIRECTION: YES/NO]
  Date: [Date]
═══════════════════════════════════════════════════════════

  MARKET DATA
    Current YES price:     XXc
    Current NO price:      XXc
    Spread:                Xc
    Volume:                $XXX,XXX
    Trend:                 [up/down X% from peak, momentum direction]

  SMART MONEY POSITIONING
    YES side total shares: XXX,XXX (top 7 holders)
    NO side total shares:  XXX,XXX (top 7 holders)
    Dominant side:         [YES/NO] by [ratio]

  KEY WALLETS — YOUR SIDE ([YES/NO])
    #1 [Name]: [shares] shares, entry ~[XX]c, [smart/dumb/noise]
       → [1-line reason: e.g., "$385K portfolio, 88 predictions, +1% on this market"]
    #2 [Name]: [shares] shares, entry ~[XX]c, [smart/dumb/noise]
       → [1-line reason]
    #3 [Name]: [shares] shares, entry ~[XX]c, [smart/dumb/noise]
       → [1-line reason]

  KEY WALLETS — OPPOSING SIDE ([YES/NO])
    #1 [Name]: [shares] shares, entry ~[XX]c, [smart/dumb/noise]
       → [1-line reason]
    #2 [Name]: [shares] shares, entry ~[XX]c, [smart/dumb/noise]
       → [1-line reason]

  TRADE PARAMETERS
    Recommended entry:     XXc [NO/YES]
    Avg smart money entry: XXc (weighted avg of credible wallets on your side)
    Opposing side cost basis: XXc (where big holders on the other side break even)
    Target 1 (conservative): XXc — [rationale]
    Target 2 (moderate):     XXc — [rationale]
    Target 3 (full thesis):  XXc — [rationale]
    Stop loss:               XXc — [rationale]
    R/R to Target 2:         X.X:1

  INSIGHTS
    1. [Most important finding about smart money positioning]
    2. [Key risk or opportunity from whale behavior]
    3. [What opposing side's cost basis means for price action]
    4. [Jang alignment check if available]
    5. [Bottom line: conviction level LOW / MEDIUM / HIGH]

═══════════════════════════════════════════════════════════
```

**How to set trade parameters from whale data:**

| Parameter | How to Derive |
|---|---|
| **Entry price** | Current market price. If spread > 3c, use limit order at mid. |
| **Avg smart money entry** | From "Active Positions" on credible wallet profiles — shows avg entry price per market. Weight by share count. Ignore dumb money wallets. |
| **Opposing cost basis** | Avg entry of the top 2-3 opposing wallets. This is where they break even — if price crosses this, they may panic-sell, accelerating your direction. |
| **Target 1** | Opposing cost basis + 3-5c beyond it (their stop-loss trigger zone). |
| **Target 2** | The "maximum uncertainty" point — typically near 50c for either side. |
| **Target 3** | Full thesis win — where your side would trade if your scenario plays out completely. |
| **Stop loss** | 5-8c against your entry, OR just beyond the nearest support/resistance level visible on the chart. |

---

## DATA SOURCES: WHAT WORKS vs WHAT DOESN'T

### USE THESE (Fast, Free, No Login)

| Source | What You Get | How to Access |
|---|---|---|
| **Polymarket Top Holders tab** | Top YES/NO holders with share counts per market | Market page → scroll to Top Holders tab |
| **Polymarket Profile pages** | Portfolio value, biggest win, prediction count, join date, active positions with avg entry + P&L % | Click username from Top Holders (or polymarket.com/@username) |
| **Polymarket Activity tab** | Recent trades with timestamps, sides, sizes | Market page → Activity tab |
| **CLOB API: Order Book** | Bid/ask depth, spread, liquidity | `clob.polymarket.com/book?token_id=[id]` |
| **CLOB API: Price History** | Price chart data | `clob.polymarket.com/prices-history?...` |
| **Gamma API** | Market metadata, volume, dates, resolution rules | `gamma-api.polymarket.com/markets?slug=[slug]` |

### DON'T WASTE TIME ON THESE (All Require Login/Auth)

| Tool | Why It Doesn't Work for Rapid Scan |
|---|---|
| Fireplace (fireplace.gg) | Institutional terminal, not publicly accessible |
| Polywhaler (polywhaler.com) | Dashboard shows $0 placeholders without login |
| PolyMonit (polymonit.com) | Requires account; PnL "planned but not yet available" |
| Polymarket Analytics (polymarketanalytics.com) | Requires live browser session for dynamic data |
| Unusual Whales Predictions | Requires login |
| HashDive (hashdive.com) | Wallet lookup only — need address first, no leaderboard |

### KNOWN QUIRKS

- **Display names ≠ @handles**: The username shown in Top Holders often doesn't match the profile URL. Always click from the market page, don't guess URLs.
- **PnL chart sometimes doesn't render**: Especially without login. Use the P&L number shown instead.
- **data-api.polymarket.com requires wallet address**: No public leaderboard endpoint. `/positions` needs `?user=[address]`. Useful for deep dive on specific wallets only.
- **Some profiles return 404**: The wallet exists on-chain but has no public Polymarket profile page. Skip these.

---

## DEEP DIVE: FULL 28-METRIC ANALYSIS

Use this when you need maximum confidence before a large position. The rapid scan identifies WHO to deep-dive; this section defines HOW.

### The 6 Metric Categories

```
[A] IDENTITY          Who is this wallet?
[B] PERFORMANCE       Are they profitable?
[C] EDGE QUALITY      Do they actually have skill?
[D] BEHAVIOR          How do they trade?
[E] SPECIALIZATION    What are they good at?
[F] SIGNAL VALUE      How useful is their signal to US?
```

### Category A: Identity (6 metrics)

| # | Metric | Definition | Source |
|---|--------|-----------|--------|
| A1 | Wallet Address | Proxy wallet on Polygon | Profile page or `/trades` → `proxyWallet` |
| A2 | Display Name | Pseudonym if available | Profile page |
| A3 | Total Portfolio Value | USD value of all open positions | Profile page |
| A4 | Total Volume Traded | Lifetime USD volume | Profile page (prediction count × avg size) |
| A5 | Account Age | Time since first trade | Profile page → "Joined [date]" |
| A6 | Fresh Wallet Flag | Age < 3 months AND position > $5,000 | Derived from A5 + position size |

### Category B: Performance (8 metrics)

| # | Metric | Definition | Source |
|---|--------|-----------|--------|
| B1 | Win Rate | % of resolved positions profitable | Profile → Closed positions tab |
| B2 | Total P&L | Lifetime profit/loss | Profile → P&L chart (ALL timeframe) |
| B3 | ROI % | P&L / Capital deployed | Derived |
| B4 | Recent P&L (30-day) | P&L last month only | Profile → P&L chart (1M) |
| B5 | Adjusted Win Rate | Win rate including expired-worthless as losses | Derived — check Closed positions for $0 redemptions |
| B6 | Largest Win | Biggest single win | Profile → "Biggest Win" stat |
| B7 | Largest Loss | Biggest single loss | Closed positions → worst P&L |
| B8 | Max Drawdown | Largest peak-to-trough | P&L chart visual inspection |

**Performance Tier:**

| Tier | P&L | Classification |
|------|-----|----------------|
| S | > +$100K, consistent green | Elite. Strongest signal. |
| A | +$20K-$100K, mostly green | Strong. Reliable signal. |
| B | +$5K-$20K, mixed | Decent. Confirmation only. |
| C | $0-$5K, flat | Marginal. Low signal. |
| D | Negative, red trend | Losing trader. Consider fading. |

### Category C: Edge Quality (6 metrics)

| # | Metric | Definition | Why It Matters |
|---|--------|-----------|----------------|
| C1 | **CLV (Closing Line Value)** | Avg (resolution price - entry price) across resolved positions | **#1 predictor of skill.** CLV > +10c = genuinely sharp. |
| C2 | Entry Timing Score | How early vs the final price move | Early = information edge. Late = chasing. |
| C3 | Edge Consistency | Stdev of per-trade returns | Low variance + positive = skill. High variance = luck. |
| C4 | Sample Size | Number of resolved positions | < 20 = noise. > 50 = reliable. |
| C5 | Streak Analysis | Longest win/loss streaks | Long streaks both ways = situational, not consistent. |
| C6 | Profit Factor | Gross profit / Gross loss | > 1.5 = strong. > 2.0 = elite. < 1.0 = losing. |

### Category D: Behavior (6 metrics)

| # | Metric | Definition | Why It Matters |
|---|--------|-----------|----------------|
| D1 | Avg Position Size | Mean USD per position | Baseline for conviction detection |
| D2 | **Conviction Ratio** | Win rate on positions > 2x average | **Gold metric.** High conviction win rate = follow only their big bets. |
| D3 | Avg Hold Time | Entry to exit duration | Short = news trader. Long = thesis trader. |
| D4 | Exit Behavior | % active sell vs hold-to-resolution | Active sellers manage risk better. |
| D5 | Timing Pattern | Time of day/week they trade | Business hours = institutional. 3am = retail. |
| D6 | Position Concentration | Max single position as % of portfolio | > 50% = either very confident or reckless. |

### Category E: Specialization (5 metrics)

| # | Metric | Definition | Why It Matters |
|---|--------|-----------|----------------|
| E1 | Category Win Rate | Win rate by market category | We only care about geopolitics performance. |
| E2 | Sub-Category Focus | Which topics within geopolitics | Good at elections ≠ good at Iran/ME. |
| E3 | Market Count by Category | How many markets per category | < 5 in our category = no track record. |
| E4 | **Category CLV** | CLV on Iran/ME markets only | **The metric that matters most for us.** |
| E5 | Expertise Score | E1 × E4 × log(E3) | Single composite number. |

### Category F: Signal Value (6 metrics)

| # | Metric | Definition | Why It Matters |
|---|--------|-----------|----------------|
| F1 | Signal Hit Rate | % of time market moves >5c in their direction within 48h | Practical: does following them make money? |
| F2 | Signal Speed | Time between their entry and market move | < 1h = too fast to follow. 12-24h = ideal. |
| F3 | Crowdedness | How many other whales entered within 24h | Many whales = price already moved. |
| F4 | Our Overlap Score | Do they trade our screened markets? | High overlap = directly relevant. |
| F5 | Jang Alignment | Does their direction match Jang? | Ultimate cross-validation. |
| F6 | Contrarian Score | % of entries on minority side (<40%) | Contrarian + profitable = sees what others don't. |

---

## WALLET SIGNAL RATING SYSTEM

| Rating | Quick Assessment (Rapid Scan) | Full Assessment (Deep Dive) |
|--------|-------------------------------|----------------------------|
| **5/5** | Old account + huge portfolio + green P&L + high prediction count + specialized in our category | CLV > +20c, Adj Win Rate > 58%, Conviction Ratio > 70%, Sample > 30 |
| **4/5** | Old account + solid portfolio + mostly green + good prediction count | CLV > +15c, Adj Win Rate > 55%, Sample > 20 |
| **3/5** | Mixed signals — decent history but unclear edge | CLV > +10c, Adj Win Rate > 52%, Sample > 15 |
| **2/5** | Low prediction count OR new account OR flat P&L | CLV near 0, insufficient sample, no specialization |
| **1/5** | Massive losses OR fresh wallet with huge bets OR obvious gambler | CLV < 0, Adj Win Rate < 48%, or fresh whale |

---

## HOW TO READ COMMON WHALE PATTERNS

### Pattern: Big Holder on Your Side is Dumb Money
**Example:** anoin123 holds 106K NO shares but has -$6.3M P&L.
**Meaning:** Their position is NOT validation for NO. They bet NO on everything. This is anti-signal — if anything, it slightly favors the other side.
**Action:** Subtract their shares mentally when assessing NO-side conviction.

### Pattern: Opposing Whales are at Breakeven
**Example:** Top YES holders entered at 62-63c, current price is 61c.
**Meaning:** They're barely holding. One more push down and they go red, which can trigger panic-selling and accelerate the move.
**Action:** Their cost basis (62-63c YES = 37-38c NO) becomes your key support level. If NO breaks above 40c and holds, they're underwater.

### Pattern: Both Sides Have Same Thesis Combo
**Example:** Both #1 and #2 YES holders also hold regime-fall NO.
**Meaning:** They're playing a package: ceasefire + stability. If EITHER leg breaks, they may unwind everything — creating correlated selling pressure across multiple markets.
**Action:** Monitor the related markets. A break in one can cascade.

### Pattern: Fresh Whale with Huge Position
**Example:** Account joined 2 weeks ago, $400K in positions, biggest win $255K.
**Meaning:** Either insider knowledge, lucky gambler who's doubling down, or sophisticated trader using a new wallet. Need more data.
**Action:** Check their closed positions — if biggest win was recent and on a related market, they may have edge. If no closed positions, treat with extreme caution.

### Pattern: High Prediction Count Wallet Losing on This Category
**Example:** 1,260 predictions, $150K portfolio, but losing on Iran markets specifically.
**Meaning:** They have experience but may not have edge in THIS category. Their signal is weaker than their overall stats suggest.
**Action:** Downweight their signal for Iran/ME markets specifically.

---

## PIPELINE CONNECTION

```
STEP 1: Screening System         → Identifies 5-15 candidate markets
                                     │
STEP 2: SMM RAPID SCAN (this doc) → For each candidate, 5-min whale check
                                   → Produces: entry, target, stop, avg SM price
                                   → Flags which markets have smart money alignment
                                     │
USER DECISION                      → Pick which markets to trade or deep-dive
                                     │
STEP 3: SMM DEEP DIVE (optional)  → Full 28-metric analysis on specific wallets
                                   → Only for high-conviction, larger positions
                                     │
STEP 4: Jang Analysis             → Cross-reference with analyst thesis
                                     │
STEP 5: Case Mapping              → SM + Jang alignment matrix:
                                     • Jang YES + SM YES = CASE A (strongest)
                                     • Jang YES + SM NO  = FLAG (conflicting)
                                     • No Jang + SM conviction bet = WATCH
                                     │
STEP 6+: Entry, Monitor, Exit
```

---

## METRICS PRIORITY RANKING

If you can only check a few things, prioritize in this order:

| Priority | What to Check | Time | Source |
|---|---|---|---|
| 1 | **Top Holders tab** — who holds what, which side is heavier | 30 sec | Market page |
| 2 | **P&L of top 3 holders per side** — green or red? | 2 min | Profile pages |
| 3 | **Avg entry price on target market** — where did they get in? | 1 min | Profile → Active Positions |
| 4 | **Join date + prediction count** — experienced or fresh? | 30 sec | Profile header |
| 5 | **Other active positions** — what's their thesis combo? | 1 min | Profile → Active Positions |

Everything beyond this is deep dive territory.

---

## CHANGELOG

### V1 → V2 Changes

| Aspect | V1 | V2 (Current) |
|---|---|---|
| **Structure** | Theory-first, 28 metrics then process | **Process-first.** Rapid Scan guide at the top, deep metrics as reference. |
| **Execution time** | 30+ min (all metrics, API-heavy) | **5 min default** via Rapid Scan. Deep Dive optional. |
| **Data sources** | Assumed API access for everything | **Documented what works vs doesn't.** External tools all need login — use Polymarket native pages. |
| **Output** | Wallet scorecard (academic) | **Trade-ready report template** with entry, target, stop, avg SM price. |
| **Profile assessment** | 28 metrics per wallet | **5 data points in 30 seconds** per wallet for rapid scan. |
| **Whale patterns** | Not included | **5 common patterns** with real examples and action items. |
| **Quick classification** | Performance tiers only | **5-type classifier** (Smart Money / Fading Edge / Insider or Gambler / Dumb Money / Noise). |
| **Pipeline** | Separate from screening | **Clear connection** — Screening → Rapid Scan → User Decision → Deep Dive → Jang → Case Mapping. |

---

*Version 2.0 — March 2026*
*Companion to Screening System V2.0 and Trading Filter Rules V2*
