# POLYMARKET SCREENING SYSTEM V2.2

## Geopolitical Event Markets — Iran & Middle East Focus

**Purpose:** Filter 200+ active markets down to 5-15 ranked candidates using quantitative scoring. Every market gets a Composite Score (0-100) so you can compare apples to apples.

**Two types of opportunities:**
- **EDGE** — Market is likely mispriced. Our analysis can find an advantage the crowd missed.
- **GRIND** — Market is efficiently priced but high-probability with fast resolution. We buy consensus and grind capital turnover.

**The Flow:**
```
STEP 1: SCREENING (this document)
    → Score every market quantitatively
    → Tag as EDGE or GRIND (or both)
    → Rank by Composite Score (0-100)
    → Output: Top 5-15 candidates

STEP 2: DEEP DIVE (SMM_METRICS_FRAMEWORK + Jang Analysis)
    → EDGE markets: full whale + analyst analysis
    → GRIND markets: quick confirmation scan only
    → Output: Case mapping, entry/exit plan, position sizing
```

---

## SYSTEM OVERVIEW

4 sequential layers + Composite Score. A market must pass all 4 layers, then gets ranked by its Composite Score.

```
INPUT: All active Iran/ME markets on Polymarket (~200+)
                    │
              LAYER 1: TRADEABILITY (Pass/Fail gate)
              "Can I get in, get out, and get paid?"
                    │
              LAYER 2: OPPORTUNITY SCORE (0-10)
              "Is there edge OR capital efficiency here?"
              Two paths: EDGE (mispricing) or GRIND (high-prob fast resolve)
                    │
              LAYER 3: RESOLUTION QUALITY (0-5)
              "If I win, will I actually get paid?"
                    │
              LAYER 4: CORRELATION (Group & flag)
              "Am I double-betting the same scenario?"
                    │
              PROBABILITY ESTIMATION (0-10)
              "How confident am I in the winning side?"
                    │
              COMPOSITE SCORE (0-100)
              = Opportunity × Resolution × Probability × Capital Efficiency
                    │
OUTPUT: 5-15 ranked candidates sorted by Composite Score
        Each tagged: EDGE / GRIND / BOTH
        → User selects which ones to deep-dive
        → Triggers SMM_METRICS_FRAMEWORK for chosen markets
```

---

## LAYER 1: TRADEABILITY

**Question:** "Can I get in, get out, and is the market structurally sound?"

This layer is a hard gate. Pass or fail. No grey area. If a market fails here, it doesn't matter how mispriced it is — you can't trade it profitably.

### 4 Hard Rules

```
RULE 1: STRUCTURAL  → Is the market itself working properly?
RULE 2: SETTLEMENT  → Will this bet settle if I win?
RULE 3: EXECUTION   → Can I get in at a fair price?
RULE 4: EXIT        → Can I get out when I want to?
```

**Order matters.** Rules 1-2 are instant checks (no data needed). If a market fails those, don't waste time pulling order book data for Rules 3-4.

---

### RULE 1: STRUCTURAL — "Is the market working?"

**HARD FAIL if ANY are true:**

| Check | What to Look For | Why |
|---|---|---|
| Market is frozen or paused | Trading halted by Polymarket | Can't trade |
| Market already resolved | Settled but still showing on listings | Nothing to trade |
| Arbitrage exists | YES + NO prices sum to > $1.03 or < $0.97 | Market mechanics are broken |
| Creator manipulation suspected | Same creator has overlapping markets with conflicting resolution criteria | One resolves YES, other resolves NO on same event |
| Outcome already determined | "Will X happen by yesterday?" still trading | It's a settlement timing bet, not a prediction |

**Data Source:** Polymarket API market status fields. Quick price check (YES + NO sum).

---

### RULE 2: SETTLEMENT — "Will this bet settle correctly?"

**HARD FAIL if ANY are true:**

| Check | What to Look For | Why |
|---|---|---|
| Resolution source undefined | "Resolved by Polymarket" with no specific criteria | They can resolve however they want |
| Key term undefined | "Strike" doesn't specify kinetic, cyber, proxy, etc. | You can be right and still lose |
| Active UMA dispute history | This market or similar ones by same creator have been disputed | Pattern of problematic resolution |
| Multi-interpretation outcome | "Will tensions escalate?" — reasonable people disagree on what this means | No objective resolution possible |

**Data Source:** Polymarket market page → resolution description. Community forums for dispute history.

---

### RULE 3: EXECUTION — "Can I get in at a fair price?"

The displayed price is NOT always the price you'll get. What matters is order book depth.

**The Metric: Effective Execution Cost**

```
Effective Execution Cost = Slippage + Half-Spread

Where:
  Slippage    = Difference between displayed price and actual fill price
                at a reasonable position size ($500-$2,000)
  Half-Spread = (Ask Price - Bid Price) / 2
```

**Decision:**

| Execution Cost | Action |
|---|---|
| < 5c | **PASS** — tradeable |
| 5c - 10c | **PASS-FLAGGED** — thin book, note as a constraint |
| > 10c | **HARD FAIL** — execution cost would eat any realistic edge |

**Data Source:** Polymarket CLOB API → `Get Order Book` → check depth at $1,000 order size.

---

### RULE 4: EXIT — "Can I get out when I want to?"

Getting in is half the problem. Getting out is where people get killed.

**The Metric: Exit Liquidity Ratio**

```
Exit Liquidity Ratio = Bid-side depth within 5c of current price
                       ÷ $1,000 (reference position size)
```

| Exit Liquidity Ratio | Action |
|---|---|
| > 3x | **PASS** — clean exit available |
| 1x - 3x | **PASS-FLAGGED** — exit possible but may move price |
| < 1x | **HARD FAIL** — cannot exit without crashing the price |

**Data Source:** Polymarket CLOB API → `Get Order Book` → bid-side depth within 5c.

---

### Layer 1 Decision Flow

```
Market found on Polymarket
    │
    ▼
RULE 1: STRUCTURAL CHECK
    ├─ Frozen / resolved / arb / manipulation → FAIL → DEAD LIST
    └─ Clean → continue
    │
    ▼
RULE 2: SETTLEMENT CHECK
    ├─ Undefined source/terms / disputes / ambiguity → FAIL → DEAD LIST
    └─ Clean → continue
    │
    ▼
RULE 3: EXECUTION CHECK
    ├─ Pull order book → calculate execution cost
    ├─ > 10c → FAIL → DEAD LIST
    ├─ 5-10c → PASS-FLAGGED (thin market)
    └─ < 5c → PASS
    │
    ▼
RULE 4: EXIT CHECK
    ├─ Calculate exit liquidity ratio
    ├─ < 1x → FAIL → DEAD LIST
    ├─ 1-3x → PASS-FLAGGED (constrained exit)
    └─ > 3x → PASS
    │
    ▼
MARKET IS TRADEABLE → proceed to Layer 2
```

### Layer 1 Output

Each market gets one label:
- **PASS** — All 4 rules clean. No constraints.
- **PASS-FLAGGED** — Tradeable but with execution or exit constraints. Note the flags.
- **FAIL** — Untradeable. Logged to DEAD LIST with reason.

---

## LAYER 2: OPPORTUNITY SCORE

**Question:** "Is there a reason to trade this market — either mispricing OR capital efficiency?"

A market can qualify via TWO paths. It doesn't need both — either is sufficient.

### PATH A: EDGE (Mispricing) — Score 0-10

The market price is likely WRONG. Our analysis can find an advantage.

| Signal | Points | Logic |
|--------|--------|-------|
| **New market (< 48h old)** | +3 | Price discovery incomplete. Like a new betting line before sharp action. |
| **Recent catalyst (< 24h)** | +3 | Breaking news not yet fully priced in. Strongest inefficiency window. |
| **Price moved > 10c in 24h** | +2 | Volatility = uncertainty = potential overreaction in either direction. |
| **Low volume relative to event importance** | +2 | Major event, under-traded. The crowd hasn't arrived yet. |
| **Volume spike (3x daily average)** | +1 | Unusual activity may indicate information asymmetry. |
| **Multi-outcome market** | +1 | Individual outcomes within multi-outcome markets are frequently mispriced. |
| **Market near 50c (40-60c range)** | +1 | Maximum uncertainty. Highest chance our analysis finds edge. |
| **Approaching deadline** | +1 | Deadline forces convergence. Creates acceleration in price movement. |

**Anti-signals (deductions):**

| Signal | Points | Logic |
|--------|--------|-------|
| **Stable < 3c movement for > 7 days** | -2 | Market has found consensus. Unlikely mispriced without new info. |
| **Very high volume (> $50M) AND old (> 30 days)** | -2 | Heavily traded, well-known. Smart money already corrected any mispricing. |
| **Price at extreme (< 10c or > 90c) for > 7 days** | -1 | Extreme prices that stay extreme are usually correct. |

**EDGE pass threshold: ≥ 4**

---

### PATH B: GRIND (Capital Efficiency) — Score 0-10

The market price is likely CORRECT, but we can profit by buying the consensus side for quick capital turnover.

**Capital Efficiency Formula:**

```
Expected Return per $1 = (Win Prob × Profit) - (Loss Prob × Cost)

Where:
  Profit = 100c - Entry Price (per share, hold to resolution)
  Cost   = Entry Price (per share, if wrong)
  Win Prob = from Probability Estimation (see below)

Daily Return = Expected Return / Days to Resolution
Annualized Return = Daily Return × 365

Capital Efficiency Score:
  Annualized Return > 200%   →  10
  Annualized Return 150-200% →   9
  Annualized Return 100-150% →   8
  Annualized Return 75-100%  →   7
  Annualized Return 50-75%   →   6
  Annualized Return 30-50%   →   5
  Annualized Return 15-30%   →   4
  Annualized Return 5-15%    →   3
  Annualized Return 0-5%     →   2
  Annualized Return < 0%     →   1
```

**Example: March 31 NO at 74c (19 days, ~90% win probability)**
```
Expected Return = (0.90 × 26c) - (0.10 × 74c) = 23.4 - 7.4 = 16c per share
Return per $1 = 16c / 74c = 21.6%
Daily Return = 21.6% / 19 = 1.14% per day
Annualized = 1.14% × 365 = 415%
Capital Efficiency Score = 10
```

**Example: May 31 NO at 39c (80 days, ~60% win probability)**
```
Expected Return = (0.60 × 61c) - (0.40 × 39c) = 36.6 - 15.6 = 21c per share
Return per $1 = 21c / 39c = 53.8%
Daily Return = 53.8% / 80 = 0.67% per day
Annualized = 0.67% × 365 = 245%
Capital Efficiency Score = 10
```

**Example: June 30 NO at 34c (110 days, ~55% win probability)**
```
Expected Return = (0.55 × 66c) - (0.45 × 34c) = 36.3 - 15.3 = 21c per share
Return per $1 = 21c / 34c = 61.8%
Daily Return = 61.8% / 110 = 0.56% per day
Annualized = 0.56% × 365 = 205%
Capital Efficiency Score = 10
```

**GRIND pass threshold: ≥ 6** (requires annualized return > 50%)

**GRIND minimum requirements (additional gates):**
- Win probability ≥ 70% (from Probability Estimation)
- Days to resolution ≤ 45
- These ensure we're only grinding HIGH-confidence, FAST-resolve markets

---

### 2.3 Layer 2 Decision

A market passes Layer 2 if it meets EITHER threshold:

| Condition | Tag | Action |
|-----------|-----|--------|
| EDGE ≥ 4 AND GRIND ≥ 6 | **BOTH** | Best of both worlds. Priority candidate. |
| EDGE ≥ 4, GRIND < 6 | **EDGE** | Mispricing opportunity. Full analysis needed. |
| EDGE < 4, GRIND ≥ 6 | **GRIND** | Capital efficiency play. Quick confirmation scan only. |
| EDGE < 4 AND GRIND < 6 | — | WATCHLIST or DEAD LIST. |

### 2.4 Layer 2 Output

Each passing market gets:
- EDGE Score (0-10)
- GRIND Score (0-10)
- Strategy Tag: EDGE / GRIND / BOTH
- Opportunity Score = max(EDGE, GRIND) — used in Composite Score
- Which signals triggered (audit trail)
- Capital Efficiency breakdown (expected return, daily return, annualized)

---

## LAYER 3: RESOLUTION QUALITY

**Question:** "If my bet wins, will I actually get paid correctly and unambiguously?"

Layer 1 Rule 2 caught the worst cases (hard fail). This layer does DETAILED scoring for markets that passed the initial check. Some markets look clean at first glance but have hidden traps.

### 3.1 Resolution Clarity Checklist

| # | Check | YES | NO |
|---|-------|-----|----|
| 1 | **Source defined?** Resolution source explicitly stated? | "Per Reuters/AP reporting" = YES | "To be determined" = NO |
| 2 | **Trigger defined?** Exact event that triggers YES/NO is unambiguous? | "US initiates air strike on Iranian soil" = YES | "US takes action against Iran" = NO |
| 3 | **Edge cases addressed?** Resolution handles grey areas? | "Intercepted missiles do not count" = YES | No mention of edge cases = NO |
| 4 | **Time boundary clear?** Exact date/time for resolution? | "By March 31, 2026, 11:59 PM ET" = YES | "By end of March" = NO |
| 5 | **No double-resolution risk?** Only one way to interpret outcome? | Single clear outcome = YES | Multiple interpretations possible = NO |

### 3.2 Common Resolution Traps in Geopolitical Markets

| Trap | Example | Risk |
|------|---------|------|
| **"Credible reporting" without definition** | "Resolves per credible reporting" — who decides credible? | UMA dispute likely |
| **Proxy vs direct action ambiguity** | "Iran strikes Israel" — does Hezbollah count? IRGC-funded groups? | Can be right but lose the bet |
| **Regime change definition** | "Regime falls" — what if IRGC survives but Supreme Leader office dissolves? | Partial changes = ambiguous |
| **"Ceasefire" definition** | Temporary pause? Needs formal announcement from both sides? | Check exact wording |
| **Multi-outcome overlap** | "Which country strikes Iran" — what if a coalition strikes together? | Multiple outcomes resolve YES? |

### 3.3 Decision

| Score (out of 5) | Rating | Action |
|---|---|---|
| **5/5** | **CLEAR** | Full confidence. No flag. |
| **4/5** | **ACCEPTABLE** | Minor ambiguity. Note the specific risk. |
| **3/5** | **RISKY** | Significant ambiguity. Flag prominently. |
| **2/5 or below** | **FAIL** | Too ambiguous. Move to DEAD LIST. |

**Minimum score to pass: 3/5**

### 3.4 Layer 3 Output

Each passing market gets:
- Resolution Clarity Score (out of 5)
- Rating (CLEAR / ACCEPTABLE / RISKY)
- Specific ambiguity notes (if any)
- Trap flags identified

---

## LAYER 4: CORRELATION

**Question:** "Am I about to put multiple markets on the same underlying scenario?"

This prevents the screened list from being 10 variations of the same bet. You want diversity in your candidates so your deep-dive analysis covers different scenarios.

### 4.1 Correlation Groups

Markets that resolve based on the SAME underlying scenario are correlated. Group them.

**Example groups for Iran/ME:**

| Group | Underlying Scenario | Example Markets |
|-------|-------------------|-----------------|
| **A: US-Iran Ceasefire** | US stops military operations against Iran | Ceasefire by X, Trump ends ops by X, Conflict ends by X |
| **B: Iran Regime Change** | Islamic Republic governing structures collapse | Regime fall by X, Leadership change by X, Pahlavi enters Iran |
| **C: Escalation** | Conflict widens beyond US-Iran | US invade Iran, Countries strike Iran, Houthi strike Israel |
| **D: Diplomatic** | Negotiated settlement or deal | Nuclear deal by X, US-Iran diplomatic meeting |
| **E: Iran Nuclear** | Iran develops nuclear weapon | Iran nuke before 2027 |

### 4.2 Correlation Rules

| Rule | Description |
|------|-------------|
| **Flag duplicates** | If multiple candidates are in the same correlation group, flag them. |
| **Rank within group** | Pick the BEST candidate per group (highest inefficiency score + clearest resolution). |
| **Cross-group is fine** | Having candidates from Group A and Group C is good — different scenarios. |
| **Flag contradictions** | YES on "ceasefire" AND YES on "escalation" = contradictory thesis. Note it. |

### 4.3 Time-Series Correlation

Same event across timeframes (e.g., "Ceasefire by Mar 15 / Mar 31 / Apr 30 / Jun 30"):

| Rule | Description |
|------|-------------|
| **Flag the series** | Note all timeframes available so the deep-dive can pick the best one. |
| **Don't eliminate yet** | Which timeframe is best depends on analysis (Jang + SMM), so keep them all in the screened list but mark as a series. |

### 4.4 Layer 4 Output

Each passing market gets:
- Correlation Group assignment (A, B, C, D, E, etc.)
- Flag if multiple markets share the same group
- "Best in group" or "Redundant — see [other market]"
- Time-series flag if applicable

---

## PROBABILITY ESTIMATION MODEL

**Question:** "How confident am I that the winning side will win?"

This is the quantitative backbone. Every market gets a Probability Score (0-10) based on 4 weighted inputs. No gut feelings — score each input, multiply by weight, sum.

### Inputs & Weights

| # | Input | Weight | What It Measures | Score 1-10 |
|---|-------|--------|------------------|------------|
| P1 | **Base Rate** | 30% | Historical precedent — how often does this type of event happen in this timeframe? | 1 = unprecedented, 5 = 50/50 historically, 10 = happens almost always |
| P2 | **Time Factor** | 25% | Is there mechanically enough time for the event to occur (or NOT occur)? | 1 = plenty of time for surprise, 5 = tight but possible, 10 = physically impossible in remaining time |
| P3 | **Current Trajectory** | 25% | What direction are news, diplomacy, military actions pointing RIGHT NOW? | 1 = strong signals against our side, 5 = mixed/unclear, 10 = all signals confirm our side |
| P4 | **Analyst Input** | 20% | Jang's thesis + any other credible analyst views (if available) | 1 = strong disagreement with our side, 5 = no input available, 10 = strong confirmation |

### Calculation

```
Probability Score = (P1 × 0.30) + (P2 × 0.25) + (P3 × 0.25) + (P4 × 0.20)
```

### Score → Probability Conversion

| Probability Score | Estimated Win % | Confidence Level |
|-------------------|----------------|------------------|
| 9.0 - 10.0 | 90-97% | VERY HIGH |
| 7.5 - 8.9 | 80-90% | HIGH |
| 6.0 - 7.4 | 65-80% | MODERATE-HIGH |
| 4.5 - 5.9 | 50-65% | MODERATE |
| 3.0 - 4.4 | 35-50% | LOW-MODERATE |
| 1.5 - 2.9 | 20-35% | LOW |
| 1.0 - 1.4 | < 20% | VERY LOW |

### Example: Ceasefire March 31 NO

| Input | Score | Reasoning |
|-------|-------|-----------|
| P1: Base Rate | 9 | Active bombing campaigns almost never produce ceasefires in < 3 weeks without prior diplomatic framework |
| P2: Time Factor | 10 | 19 days. Ceasefire requires back-channel → negotiation → announcement → implementation. Mechanically near-impossible. |
| P3: Trajectory | 9 | US operations continuing, no diplomatic signals, Iran not negotiating |
| P4: Analyst (Jang) | 8 | Jang's thesis: escalation continues, no ceasefire coming |

```
Score = (9 × 0.30) + (10 × 0.25) + (9 × 0.25) + (8 × 0.20) = 2.7 + 2.5 + 2.25 + 1.6 = 9.05
→ Estimated Win %: ~90%  |  Confidence: VERY HIGH
```

### Example: Ceasefire May 31 NO

| Input | Score | Reasoning |
|-------|-------|-----------|
| P1: Base Rate | 7 | 80 days is more time, but still no historical precedent for fast ceasefire without active diplomacy |
| P2: Time Factor | 6 | 80 days — physically possible if secret talks started soon. Not mechanically impossible like March 31. |
| P3: Trajectory | 8 | Same trajectory as March 31 but more time for trajectory to CHANGE. Discount slightly. |
| P4: Analyst (Jang) | 7 | Jang says no ceasefire near-term, but hasn't specifically ruled out May timeframe |

```
Score = (7 × 0.30) + (6 × 0.25) + (8 × 0.25) + (7 × 0.20) = 2.1 + 1.5 + 2.0 + 1.4 = 7.0
→ Estimated Win %: ~70%  |  Confidence: MODERATE-HIGH
```

### Edge Calculation

Once you have the Probability Score, calculate Edge:

```
Edge = Our Estimated Win % - Market Implied Win %

Where:
  Market Implied Win % = Price of the side we're betting (in cents)
  Our Estimated Win % = from the Probability Score conversion table
```

| Edge | Interpretation |
|------|---------------|
| > 20 points | Massive edge. Either we're very right or very wrong. Double-check inputs. |
| 10-20 points | Strong edge. This is where the money is. |
| 5-10 points | Moderate edge. Profitable but requires good execution. |
| 0-5 points | Thin edge. Barely worth the effort after execution costs. |
| < 0 points | Negative edge. The market is smarter than our estimate. Don't trade. |

**Example:**
```
March 31 NO: Our estimate 90%, Market price 74c (implies 74% for NO)
Edge = 90 - 74 = +16 points → Strong edge

May 31 NO: Our estimate 70%, Market price 39c (implies 39% for NO)
Edge = 70 - 39 = +31 points → Massive edge (but lower confidence)
```

---

## COMPOSITE SCORE (0-100)

The single number that ranks every candidate market. Combines all quantitative inputs using an **additive weighted formula** that naturally spreads scores across the 0-100 range.

### Formula

```
Composite Score = Opportunity + Probability + Resolution + Edge Bonus + CE Adjustment

Five components:

  1. OPPORTUNITY (0-30 pts)
     = (max(EDGE score, GRIND score) / 10) × 30

  2. PROBABILITY (0-30 pts)
     = (Probability Score / 10) × 30

  3. RESOLUTION (0-20 pts)
     = (Resolution Score / 5) × 20

  4. EDGE BONUS (0-10 pts)
     = (min(Edge points, 30) / 30) × 10
     Where Edge points = Our Estimated Win % - Market Implied Win %
     Rewards markets where our analysis disagrees with the crowd.

  5. CE ADJUSTMENT (-8 to +10 pts)
     Fast-resolve bonus / slow-resolve penalty:
     - Days to resolution ≤ 14:    +10
     - Days to resolution 15-30:   +8
     - Days to resolution 31-45:   +5
     - Days to resolution 46-60:   +2
     - Days to resolution 61-90:    0
     - Days to resolution 91-120:  -4
     - Days to resolution > 120:   -8

Theoretical max: 30 + 30 + 20 + 10 + 10 = 100
Theoretical min: 0 + 0 + 0 + 0 + (-8) = -8 (treated as 0)
```

**No cap needed.** The additive formula naturally stays within 0-100.

### Example Calculations

**March 31 NO:**
```
Opportunity:  GRIND 10 → (10/10) × 30 = 30.0
Probability:  9.05     → (9.05/10) × 30 = 27.2
Resolution:   5/5      → (5/5) × 20 = 20.0
Edge Bonus:   +16 pts  → (16/30) × 10 = 5.3
CE Adjustment: 19 days → +8
Composite = 30.0 + 27.2 + 20.0 + 5.3 + 8 = 90.5 → S-TIER
Tag: GRIND
```

**May 31 NO:**
```
Opportunity:  EDGE 6, GRIND 10 → max 10 → (10/10) × 30 = 30.0
Probability:  7.0      → (7.0/10) × 30 = 21.0
Resolution:   5/5      → (5/5) × 20 = 20.0
Edge Bonus:   +31 pts  → (min(31,30)/30) × 10 = 10.0
CE Adjustment: 80 days → 0
Composite = 30.0 + 21.0 + 20.0 + 10.0 + 0 = 81.0 → S-TIER
Tag: BOTH
```

**June 30 NO (hypothetical, ~55% prob, 110 days):**
```
Opportunity:  GRIND 10  → (10/10) × 30 = 30.0
Probability:  6.0       → (6.0/10) × 30 = 18.0
Resolution:   5/5       → (5/5) × 20 = 20.0
Edge Bonus:   +21 pts   → (21/30) × 10 = 7.0
CE Adjustment: 110 days → -4
Composite = 30.0 + 18.0 + 20.0 + 7.0 + (-4) = 71.0 → A-TIER
Tag: EDGE
```

**A new market with catalyst, moderate probability:**
```
Opportunity:  EDGE 5    → (5/10) × 30 = 15.0
Probability:  5.5       → (5.5/10) × 30 = 16.5
Resolution:   4/5       → (4/5) × 20 = 16.0
Edge Bonus:   +5 pts    → (5/30) × 10 = 1.7
CE Adjustment: 45 days  → +5
Composite = 15.0 + 16.5 + 16.0 + 1.7 + 5 = 54.2 → B-TIER
Tag: EDGE
```

**Weak candidate (barely passed screening):**
```
Opportunity:  EDGE 4    → (4/10) × 30 = 12.0
Probability:  4.0       → (4.0/10) × 30 = 12.0
Resolution:   3/5       → (3/5) × 20 = 12.0
Edge Bonus:   +2 pts    → (2/30) × 10 = 0.7
CE Adjustment: 90 days  → 0
Composite = 12.0 + 12.0 + 12.0 + 0.7 + 0 = 36.7 → C-TIER
Tag: EDGE
```

### What Drives the Score

| Component | Weight | What It Rewards |
|-----------|--------|----------------|
| Opportunity (30) | Largest | Markets with clear mispricing signals OR strong capital efficiency |
| Probability (30) | Largest | Higher confidence in the winning side |
| Resolution (20) | Medium | Clean, unambiguous resolution criteria |
| Edge Bonus (10) | Small | Disagreement between our estimate and the market — the bigger the edge, the more upside |
| CE Adjustment (±10) | Swing | Fast markets get boosted, slow markets get penalized. Rewards capital turnover. |

### Ranking Tiers

| Composite Score | Tier | Action |
|-----------------|------|--------|
| **85-100** | **S-TIER** | Immediate deep-dive. Best opportunities available. |
| **70-84** | **A-TIER** | Strong candidate. Analyze in priority order. |
| **50-69** | **B-TIER** | Decent candidate. Analyze if time permits. |
| **30-49** | **C-TIER** | Marginal. Only trade if nothing better available. |
| **< 30** | **WATCHLIST** | Not worth analysis time right now. Monitor. |

---

## CAPITAL SPLIT STRATEGY (Same Market, Multiple Timeframes)

When a correlation group contains multiple timeframes of the same bet (e.g., ceasefire by Mar 31 / May 31 / Jun 30), you can split capital across them instead of picking just one.

### Why Split?

| Single Bet | Split Across Timeframes |
|------------|------------------------|
| All-or-nothing on one deadline | Diversified across time |
| Capital locked until resolution | Fastest bet resolves → recycle capital |
| If wrong on timing, lose everything | If wrong on timing, later bets still live |

### The 3-Bucket Framework

Divide your total allocation for a correlation group into 3 buckets:

```
BUCKET 1: ANCHOR (40-50% of capital)
  → The timeframe you're MOST confident in
  → Usually the fastest-resolve market with highest probability
  → This is your capital recycling engine

BUCKET 2: CORE (30-40% of capital)
  → The best risk/reward timeframe
  → Usually medium-term with the biggest edge (our estimate vs market price)
  → This is where the real money is made

BUCKET 3: TAIL (10-20% of capital)
  → The longest timeframe as insurance
  → Cheapest entry, biggest payout if thesis holds
  → Skip this bucket if capital is < $1,500 total
```

### Allocation Rules

```
RULE 1: MINIMUM BET SIZE
  Each bucket must be ≥ $300 (below this, execution costs eat the edge)
  If total capital < $900, pick ONE timeframe only — don't split

RULE 2: ANCHOR SELECTION
  Pick the timeframe with: highest Composite Score AND ≤ 30 days to resolution
  If no timeframe is ≤ 30 days, the shortest available becomes Anchor

RULE 3: CORE SELECTION
  Pick the timeframe with: highest Edge Bonus (biggest disagreement with market)
  This is where our analysis adds the most value

RULE 4: TAIL SELECTION
  Pick the longest timeframe IF:
    - Entry price ≤ 50c (cheap enough for asymmetric payoff)
    - Our probability estimate ≥ 55%
  If neither condition met, redistribute Tail capital to Core
```

### Cascade Plan (Capital Recycling)

The key advantage of splitting: when fast bets resolve, you recycle capital into later bets.

```
SCENARIO A: ANCHOR WINS (most likely)
  → Collect payout from Bucket 1
  → Reinvest 50-100% of proceeds into Core (Bucket 2)
  → Core position now larger, improving R/R
  → Effective cost basis of Core drops

SCENARIO B: ANCHOR LOSES (thesis broken early)
  → STOP. Re-evaluate entire thesis before touching Buckets 2 & 3
  → If thesis is dead: exit Core and Tail immediately (cut losses)
  → If thesis is delayed, not dead: hold Core and Tail, no new capital

SCENARIO C: ANCHOR WINS, CORE IN PROGRESS
  → Anchor payout arrives while Core is still running
  → Add to Core position if:
    (a) Edge has NOT decreased since entry
    (b) News/trajectory still supports thesis
  → If edge has decreased: bank the Anchor profit, let Core ride alone
```

### Example: $2,000 on Ceasefire NO (March 2026)

```
Available markets:
  March 31 NO — 74c, 19 days, Composite 90.5 (S-TIER, GRIND)
  May 31 NO   — 39c, 80 days, Composite 81.0 (S-TIER, BOTH)
  June 30 NO  — 34c, 110 days, Composite 71.0 (A-TIER, EDGE)

ALLOCATION:
  Bucket 1 ANCHOR: $900 (45%) → March 31 NO at 74c
    Why: Highest composite, fastest resolve, 90% probability
    Shares: ~1,216 NO shares
    If wins: +$316 profit in 19 days

  Bucket 2 CORE: $800 (40%) → May 31 NO at 39c
    Why: Biggest edge (+31 pts), best risk/reward
    Shares: ~2,051 NO shares
    If wins: +$1,251 profit

  Bucket 3 TAIL: $300 (15%) → June 30 NO at 34c
    Why: Cheapest entry, insurance if May 31 is too tight
    Shares: ~882 NO shares
    If wins: +$582 profit

CASCADE PLAN:
  Day 19 — March 31 resolves NO (expected):
    → Collect $1,216 ($316 profit)
    → Reinvest $600 into May 31 NO (now ~1,538 additional shares at ~39c)
    → Bank $616 as realized profit
    → Core position now: 2,051 + 1,538 = 3,589 shares

  Day 80 — May 31 resolves NO (if thesis holds):
    → Collect $3,589 from Core + $882 from Tail = $4,471
    → Total invested: $2,000 + $600 reinvested = $2,000 original capital
    → Total returned: $316 banked + $4,471 = $4,787
    → Net profit: $2,787 (139% return on $2,000)
```

### Split vs Single Comparison

```
SINGLE BET: $2,000 all on May 31 NO at 39c
  Shares: 5,128 | If wins: +$3,128 profit (156%)
  Risk: If ceasefire happens April 15, lose $2,000

SPLIT (as above):
  If ALL win: +$2,787 profit (139%)
  If March wins but May loses: +$316 profit minus May/Jun losses
  If March loses (thesis broken): exit all, smaller total loss

Split sacrifices ~17% upside for:
  ✓ Capital recycling (money working sooner)
  ✓ Early thesis validation (March 31 confirms before committing more)
  ✓ Reduced max drawdown (not all capital at risk simultaneously)
```

### When NOT to Split

- Total capital for this group < $900 (buckets too small)
- Only 2 timeframes available and both are > 60 days (no fast Anchor)
- Timeframes are > 6 months apart (too disconnected to correlate)
- You have strong conviction on ONE specific timeframe (just go all-in on it)

---

## FINAL OUTPUT: SCREENING REPORT

After all 4 layers, the system produces a ranked candidate list.

### Section A: CANDIDATE MARKETS (Passed all 4 layers, ranked by Composite Score)

```
┌───────────────────────────────────────────────────────────────────────────────┐
│ SCREENING REPORT — [DATE]                                                     │
│ Scanned: [N] markets | Candidates: [N] | Watchlist: [N]                      │
├───────────────────────────────────────────────────────────────────────────────┤
│                                                                               │
│  #  Market              Price  Days  Type   Edge  Grind  Prob  Comp  Group   │
│                                             /10   /10    /10   /100          │
│  1  [Market name]       XXc    XX    GRIND  X     X      X.X   XX    A      │
│  2  [Market name]       XXc    XX    EDGE   X     X      X.X   XX    B      │
│  3  [Market name]       XXc    XX    BOTH   X     X      X.X   XX    C      │
│  ...                                                                          │
│                                                                               │
│  PROBABILITY BREAKDOWN (top 3):                                               │
│  #1: P1=X P2=X P3=X P4=X → Score X.X → Est. XX% → Edge +XX pts             │
│  #2: P1=X P2=X P3=X P4=X → Score X.X → Est. XX% → Edge +XX pts             │
│  #3: P1=X P2=X P3=X P4=X → Score X.X → Est. XX% → Edge +XX pts             │
│                                                                               │
│  CAPITAL EFFICIENCY (top 3):                                                  │
│  #1: Entry XXc × XX days → Exp. Return XX% → Annual. XXX% → GRIND score X   │
│  #2: Entry XXc × XX days → Exp. Return XX% → Annual. XXX% → GRIND score X   │
│                                                                               │
│  FLAGS:                                                                       │
│  - [Market X]: thin order book (exec cost 5-8c)                              │
│  - [Market Y]: resolution ambiguity on "ceasefire" definition                │
│  - [Markets 2 & 4]: same correlation group (B), pick one                     │
│  - [Markets 3, 5, 7]: time-series (ceasefire by Mar/Apr/Jun)                 │
│                                                                               │
│  NEXT STEP:                                                                   │
│  EDGE markets → Full SMM_METRICS_FRAMEWORK + Jang analysis                   │
│  GRIND markets → Quick SMM confirmation scan (2 min)                         │
│  BOTH markets → Full analysis, highest priority                              │
│                                                                               │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Ranked by:** Composite Score (0-100). Tiebreaker: BOTH > EDGE > GRIND.

### Section B: WATCHLIST (Failed Layer 2, score 1-3)

Tradeable markets that currently lack inefficiency signals. Re-screen if:
- New catalyst drops
- Price moves > 10c
- Jang publishes new analysis covering this market

### Section C: DEAD LIST (Failed Layer 1 or Layer 3)

Markets eliminated for structural, settlement, execution, exit, or resolution reasons. Only re-screen if:
- Order book depth improves significantly (execution/exit fail)
- Resolution criteria are updated/clarified (settlement/resolution fail)
- Market is unfrozen or re-listed (structural fail)

---

## HOW SCREENING CONNECTS TO THE PIPELINE

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│  STEP 1: SCREENING (this document)                             │
│      Input:  All active Iran/ME markets                         │
│      Output: 5-15 ranked candidates + watchlist                 │
│                                                                 │
│                          │                                      │
│                          ▼                                      │
│                                                                 │
│  USER DECISION: Pick which candidates to analyze               │
│                                                                 │
│                          │                                      │
│                          ▼                                      │
│                                                                 │
│  STEP 2-4: DEEP DIVE                                           │
│      → SMM_METRICS_FRAMEWORK: Whale profiling on chosen market │
│      → Jang's Analysis: YouTube transcript extraction          │
│      → News/OSINT: Twitter monitoring for catalysts            │
│                                                                 │
│                          │                                      │
│                          ▼                                      │
│                                                                 │
│  STEP 5: CASE MAPPING                                          │
│      → Cross-reference Jang + SMM + News                       │
│      → Determine cases (A/B/C/D)                               │
│      → NOW calculate R/R, targets, stops, position sizes       │
│                                                                 │
│                          │                                      │
│                          ▼                                      │
│                                                                 │
│  STEP 6+: Entry, Monitor, Exit, Feedback Loop                  │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Key principle:** Screening finds markets worth YOUR TIME. It does NOT tell you how to trade them. Trade planning (targets, stops, R/R, sizing) requires analysis inputs that don't exist yet at the screening stage.

---

## EXECUTION RULES

### Frequency
- **Full scan:** Once daily (all active Iran/ME markets)
- **Quick scan:** On breaking news (only markets related to the news event)
- **Re-screen:** When Jang publishes new analysis (may unlock new efficiency signals)

### Data Required Per Market

| Data Point | Source | Required for Layer |
|-----------|--------|-------------------|
| Market title/question | Polymarket Gamma API | All |
| Current YES/NO price | Polymarket CLOB API: `Get Market Price` | 1, 2 |
| Order book (bid/ask depth) | Polymarket CLOB API: `Get Order Book` | 1 (Rules 3 & 4) |
| Bid-ask spread | Polymarket CLOB API: `Get Spread` | 1 (Rule 3) |
| Total volume | Polymarket Gamma API | 2 |
| 24h volume | Polymarket Gamma API | 2 |
| Market creation date | Polymarket Gamma API | 2 |
| End date | Polymarket Gamma API | 2 |
| Resolution description | Polymarket Gamma API | 1 (Rule 2), 3 |
| Price history (7 day) | Polymarket CLOB API: `Get Prices History` | 2 |
| Market status | Polymarket API: status fields | 1 (Rule 1) |
| Related markets | Manual grouping | 4 |

### Decision Log

Every screening run logs:
- Date and time
- Total markets scanned
- Pass / watchlist / dead count per layer
- Specific rule that caused each elimination
- Flags on passing markets
- Correlation group assignments

---

## QUICK REFERENCE CARD

```
LAYER 1 — TRADEABILITY (Pass/Fail)
  Rule 1: Structural
    [ ] Active? (not frozen/resolved)
    [ ] No arbitrage? (YES + NO ≈ $1.00)
    [ ] No creator manipulation?
    [ ] No already-determined outcome?
  Rule 2: Settlement
    [ ] Resolution source defined?
    [ ] Key terms defined?
    [ ] No UMA dispute history?
    [ ] No multi-interpretation risk?
  Rule 3: Execution
    [ ] Order book depth at $1,000 size
    [ ] Execution cost < 10c?
  Rule 4: Exit
    [ ] Bid-side depth within 5c ÷ $1,000
    [ ] Exit liquidity ratio > 1x?

LAYER 2 — OPPORTUNITY SCORE (EDGE ≥ 4 OR GRIND ≥ 6 to pass)
  PATH A: EDGE Score
    [ ] New market < 48h?                    (+3)
    [ ] Recent catalyst < 24h?              (+3)
    [ ] Price moved > 10c in 24h?           (+2)
    [ ] Low volume vs event importance?     (+2)
    [ ] Volume spike 3x daily avg?          (+1)
    [ ] Multi-outcome market?               (+1)
    [ ] Near 50c (40-60c)?                  (+1)
    [ ] Approaching deadline?               (+1)
    [ ] Stable > 7 days < 3c movement?      (-2)
    [ ] High volume + old market?           (-2)
    [ ] Extreme price > 7 days?             (-1)
    EDGE SCORE: ___/10
  PATH B: GRIND Score
    [ ] Win probability ≥ 70%?              (required)
    [ ] Days to resolution ≤ 45?            (required)
    [ ] Calculate: Expected Return = (WinProb × Profit) - (LossProb × Cost)
    [ ] Calculate: Annualized = (ExpReturn / EntryPrice) × (365 / Days) × 100
    [ ] Look up GRIND score from annualized return table
    GRIND SCORE: ___/10
  TAG: [ ] EDGE  [ ] GRIND  [ ] BOTH

LAYER 3 — RESOLUTION QUALITY (Score ≥ 3/5 to pass)
  [ ] Source defined?
  [ ] Trigger defined?
  [ ] Edge cases addressed?
  [ ] Time boundary clear?
  [ ] No double-resolution risk?

LAYER 4 — CORRELATION (Group & flag)
  [ ] Assign correlation group
  [ ] Flag duplicates within same group
  [ ] Flag time-series markets
  [ ] Flag contradictory bets

PROBABILITY ESTIMATION
  [ ] P1 Base Rate:         ___/10  × 0.30 = ___
  [ ] P2 Time Factor:       ___/10  × 0.25 = ___
  [ ] P3 Current Trajectory: ___/10  × 0.25 = ___
  [ ] P4 Analyst Input:     ___/10  × 0.20 = ___
  PROBABILITY SCORE: ___ → Est. Win %: ___% → Edge: +___ pts

COMPOSITE SCORE (additive, 0-100)
  [ ] Opportunity: ___/10 × 3 = ___/30
  [ ] Probability: ___/10 × 3 = ___/30
  [ ] Resolution:  ___/5  × 4 = ___/20
  [ ] Edge Bonus:  min(___ pts, 30) / 30 × 10 = ___/10
  [ ] CE Adjust:   ___ days → ___  (≤14: +10, 15-30: +8, 31-45: +5, 46-60: +2, 61-90: 0, 91-120: -4, >120: -8)
  COMPOSITE: ___ + ___ + ___ + ___ + ___ = ___/100
```

---

## CHANGELOG

### V2.1 → V2.2 Changes

| Aspect | V2.1 | V2.2 (Current) |
|---|---|---|
| **Composite Score** | Multiplicative formula: `(Opp/10) × (Res/2.5) × (Prob/5) × CE × 100`. Produced raw scores 200-470, all capped at 100. No differentiation. | **Additive weighted formula** with 5 components: Opportunity (30), Probability (30), Resolution (20), Edge Bonus (10), CE Adjustment (±10). Natural 0-100 spread. |
| **Edge Bonus** | Not a separate component | **Dedicated 0-10 bonus** rewarding markets where our analysis disagrees most with the crowd. Bigger edge = more points. |
| **CE Adjustment** | Multiplier (0.8x to 1.5x) | **Additive bonus/penalty** (-8 to +10). More granular: 7 tiers instead of 5. Fast markets boosted, slow markets penalized. |
| **Tier thresholds** | S: 80-100, A: 60-79 | **S: 85-100, A: 70-84**. Adjusted for additive formula's score distribution. |
| **Capital Split** | Not supported | **3-Bucket Framework** for splitting capital across timeframes within the same correlation group. Anchor (40-50%) + Core (30-40%) + Tail (10-20%). Includes cascade recycling plan. |

### V2.0 → V2.1 Changes

| Aspect | V2.0 | V2.1 (Current) |
|---|---|---|
| **Layer 2** | Inefficiency only (EDGE plays) | **Opportunity Score with two paths:** EDGE (mispricing) + GRIND (capital efficiency). Markets can qualify via either path. |
| **GRIND strategy** | Not supported — high-prob fast-resolve markets were filtered out | **Fully supported.** Markets like March 31 NO (74c, 19 days, 90% probability) now score highly via Capital Efficiency formula. |
| **Probability** | Qualitative ("is it plausible?") | **Quantitative 4-input model** with weights: Base Rate (30%), Time Factor (25%), Current Trajectory (25%), Analyst Input (20%). Outputs a score 0-10 and estimated win %. |
| **Edge calculation** | Not formalized | **Edge = Our Estimated Win % - Market Implied Win %**. Quantified in points. |
| **Capital Efficiency** | Not measured | **Annualized expected return** calculated per market. Fast-resolve markets get CE Multiplier boost (up to 1.5x for ≤14 days). |
| **Composite Score** | Ranked by Inefficiency Score only | **Composite Score (0-100)** combining Opportunity × Resolution × Probability × CE Multiplier. Single number to rank all candidates. |
| **Market tags** | None | **EDGE / GRIND / BOTH** — determines how much analysis each market needs. GRIND = quick confirmation, EDGE = full deep-dive. |
| **Output** | Simple ranked list | **Full quantitative dashboard** with score breakdowns, probability inputs, capital efficiency math, and edge calculations. |
| **Philosophy** | "Find mispriced markets" | **"Find the best risk-adjusted returns per unit of time."** Includes both mispricing AND consensus grinding. |

### V1.2 → V2.0 Changes

| Aspect | V1.2 | V2.0 |
|---|---|---|
| **Layers** | 5 layers | 4 layers. Removed R/R layer. |
| **Scope** | Screening + pre-trade planning | Screening ONLY. |
| **Output** | Trade-ready cards | Ranked candidate list. |

---

*Version 2.2 — March 2026*
*Companion to SMM_METRICS_FRAMEWORK_V2 and Trading Filter Rules V2*
