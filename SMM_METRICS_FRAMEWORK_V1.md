# SMART MONEY METRICS FRAMEWORK V2

## Whale Profiling & Signal Quality System for Polymarket

**Purpose:** For any screened market, rapidly identify who holds the biggest positions, whether they're smart or dumb money, and produce actionable trade parameters (entry, target, stop, avg smart money price).

**Three modes:**
- **AUTOMATED SCAN (~10 sec)** — Default. Runs via `node screener.mjs --smm`. Uses Polymarket Data API to pull holders, positions, PnL, and portfolio data. Auto-classifies wallets.
- **FIREPLACE SCAN (~1 min)** — Visual. Open Fireplace for the market, read pre-computed stats. Use when API is down or you want visual confirmation.
- **DEEP DIVE (30+ min)** — Use when a market passes screening AND Jang has a thesis AND you need full wallet profiling before sizing up.

---

## AUTOMATED SCAN: 10-SECOND EXECUTION (Recommended)

Run from terminal. Uses Polymarket Data API (no auth required).

### Usage

```bash
# Single market (by candidate number from last screening)
node screener.mjs --smm 20

# Single market (by text search)
node screener.mjs --smm "ceasefire march 31"

# All S-TIER and A-TIER markets (best per correlation group)
node screener.mjs --smm-all
```

### What It Does Automatically

1. **Fetches top 20 holders** per side (YES/NO) via `data-api.polymarket.com/holders`
2. **Profiles top 4 wallets per side** in parallel:
   - Portfolio value (`/value`)
   - Position count + total PnL (`/positions`)
   - Avg entry price + PnL on target market
3. **Classifies each wallet** as SMART MONEY / DUMB MONEY / WHALE (MIXED) / INSIDER/GAMBLER / NOISE
4. **Determines smart money side** using wallet count + market-specific PnL
5. **Cross-checks** against screening recommendation
6. **Outputs formatted report** with verdict: CONFIRMED or CONFLICT

### Classification Rules (Automated)

| Pattern | Classification | Logic |
|---|---|---|
| Portfolio > $500K, PnL ratio > -5% | **SMART MONEY** | Big wallet, not losing badly |
| Total PnL > $50K, 20+ positions | **SMART MONEY** | Proven profitable track record |
| Total PnL > $5K, 10+ positions | **SMART MONEY** | Consistent positive returns |
| PnL ratio < -30% AND PnL < -$10K | **DUMB MONEY** | Losing a large % of portfolio |
| Total PnL < -$100K | **DUMB MONEY** | Massive absolute losses |
| ≤ 5 positions, portfolio > $10K | **INSIDER/GAMBLER** | Fresh wallet, big bets |
| Portfolio > $200K, 30+ positions, mixed PnL | **WHALE (MIXED)** | Big player, unclear edge |
| Everything else | **NOISE** | Insufficient signal |

### Smart Money Verdict Logic

The verdict combines multiple signals:
1. **Wallet classification count**: Which side has more SMART MONEY + WHALE wallets?
2. **Market-specific PnL**: Which side's top holders are profiting on THIS market?
3. **Tie-break**: Market PnL wins when wallet counts are close

---

## FIREPLACE SCAN: 1-MINUTE VISUAL CHECK

Use Fireplace (fireplace.gg) when you want visual confirmation or the API is slow.

### What to Read (30 seconds)

| Fireplace Data | What It Tells You |
|---|---|
| Market Strength Score (Y% / N%) | Quick directional bias |
| TVL per side | Which side has more capital committed |
| Weighted PnL per side | Which side's holders are profitable overall |
| Avg PnL per side | Same signal, normalized |
| Holder Stats badges | Win rate / activity classification icons |

### Top Holders Table (30 seconds)

For each side, check the top 4-5 holders:
- **Name**: Click to see full profile on Polymarket
- **Shares**: Position size
- **Average**: Avg entry price (compare to current price)
- **Total PnL**: Green = winning, Red = losing

**Quick read**: If one side is almost all green and the other is almost all red, that's your signal.

---

## MANUAL RAPID SCAN: 5-MINUTE FALLBACK

Use this only when both automated and Fireplace approaches are unavailable.

### Step 1: Pull Top Holders (1 min)

Go to the **specific market page** on polymarket.com → scroll to **"Top Holders"** tab.

### Step 2: Profile Top 3-4 Wallets Per Side (3 min)

Click each username from the Top Holders list.

**30-Second Profile Assessment — grab these 5 data points:**

| Data Point | Where on Profile | What It Tells You |
|---|---|---|
| **Portfolio Value** | Left side stats | Whale ($100K+) vs fish ($1K). Size = conviction level. |
| **Prediction Count** | Left side stats | < 20 predictions = insufficient data, don't trust. > 100 = enough history. |
| **P&L Chart (1M)** | Top right card | Green trending up = currently hot. Red trending down = currently cold or gambler. |
| **Avg entry price** | Active Positions | Where they got in on our target market |
| **Other positions** | Active Positions | Reveals their broader thesis |

### Step 3: Compile Report (1 min)

Use the automated report format below as template.

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

## DATA SOURCES

### Automated (Used by `--smm` command)

| Endpoint | What It Returns | Auth |
|---|---|---|
| `data-api.polymarket.com/holders?market={conditionId}` | Top 20 holders per side: wallet address, pseudonym, name, amount, outcomeIndex | None (public) |
| `data-api.polymarket.com/positions?user={address}` | All open positions: size, avgPrice, cashPnl, realizedPnl, title, outcome | None (public) |
| `data-api.polymarket.com/value?user={address}` | Total portfolio value | None (public) |
| `gamma-api.polymarket.com/activity?user={address}` | Recent trades with timestamps | None (public) |

### Visual / Manual

| Source | What You Get | Best For |
|---|---|---|
| **Fireplace (fireplace.gg)** | Market strength score, TVL per side, weighted PnL, holder badges, top holder table | Quick visual confirmation |
| **Polymarket Top Holders tab** | Top holders with share counts | Manual fallback |
| **Polymarket Profile pages** | Portfolio value, prediction count, active positions | Deep dive on specific wallets |

### KNOWN QUIRKS

- **Positions endpoint caps at 100**: Heavy traders may have 100+ positions but API returns max 100. PnL may be understated for very active wallets.
- **Display names**: The `name` field from holders API matches Fireplace display names (e.g., "wan123", "anoin123"). The `pseudonym` field is the auto-generated anonymous name.
- **Rate limiting**: Data API has rate limits. The `--smm-all` command adds 300ms delays between markets. If you hit 429 errors, wait and retry.

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

### V2 → V3 Changes

| Aspect | V2 | V3 (Current) |
|---|---|---|
| **Default mode** | Manual Rapid Scan (5 min) | **Automated Scan (~10 sec)** via `node screener.mjs --smm` |
| **Data source** | Manual profile clicking on polymarket.com | **Polymarket Data API** — holders, positions, value endpoints. No auth needed. |
| **Wallet profiling** | Click each profile, read 5 data points manually | **Parallel API calls** — portfolio value, position count, total PnL, market-specific PnL, avg entry |
| **Classification** | Manual 5-type (Smart/Fading/Insider/Dumb/Noise) | **Automated 5-type** (Smart Money/Dumb Money/Whale Mixed/Insider-Gambler/Noise) using quantitative thresholds |
| **Verdict** | Human judgment call | **Algorithmic** — wallet count + market PnL determines smart money side, auto-checks against screening |
| **Batch mode** | N/A | **`--smm-all`** runs best-per-group for all S/A-tier candidates |
| **Fireplace** | Listed as "don't waste time" (login required) | **Documented as visual confirmation tool** — works, good for quick visual check |
| **Output** | Manual template fill | **Auto-generated report** saved to `SMM_REPORT_[date].md` |

### V1 → V2 Changes

| Aspect | V1 | V2 |
|---|---|---|
| **Structure** | Theory-first, 28 metrics then process | Process-first. Rapid Scan guide at the top, deep metrics as reference. |
| **Execution time** | 30+ min (all metrics, API-heavy) | 5 min default via Rapid Scan. Deep Dive optional. |
| **Output** | Wallet scorecard (academic) | Trade-ready report template with entry, target, stop, avg SM price. |
| **Quick classification** | Performance tiers only | 5-type classifier. |
| **Pipeline** | Separate from screening | Clear connection — Screening → Rapid Scan → User Decision → Deep Dive → Jang → Case Mapping. |

---

*Version 3.0 — March 2026*
*Companion to Screening System V2.2 and Trading Filter Rules V2*
