#!/usr/bin/env node
/**
 * POLYMARKET SCREENING SYSTEM V2.2 — Automated Screener
 *
 * Automates Layers 1-4 + EDGE/GRIND scoring.
 * Probability (P1-P4) is manual input — user scores after seeing candidates.
 *
 * Usage:
 *   node screener.mjs                    # Full scan, default keywords
 *   node screener.mjs --keywords "iran,ceasefire,nuclear"  # Custom keywords
 *   node screener.mjs --probability      # Interactive mode: prompts for P1-P4 on top candidates
 *   node screener.mjs --cache            # Use cached data (skip API calls)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

// ═══════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const CACHE_DIR = '.';
const CACHE_FILE = `${CACHE_DIR}/screening_cache.json`;
const TODAY = new Date();

// Default geopolitical keywords for Iran/ME focus
const DEFAULT_KEYWORDS = [
  'iran', 'ceasefire', 'israel', 'houthi', 'hezbollah', 'nuclear',
  'gaza', 'hamas', 'lebanon', 'syria', 'yemen', 'middle east',
  'annex', 'tehran', 'khamenei', 'airstrike', 'netanyahu', 'saudi',
  'iraq', 'regime', 'pahlavi', 'irgc', 'strait of hormuz',
  'conflict ends', 'strike iran', 'forces enter iran', 'ground offensive'
];

// Exclude noise (Nobel Peace Prize individual markets, sports, etc.)
const EXCLUDE_PATTERNS = [
  /nobel peace prize/i,
  /world baseball/i,
  /nhl|nba|nfl|mlb|fifa/i,
  /oscar|academy award/i,
  /gta vi/i,
  /counter-strike/i,
  /elon musk.*tweet/i,
];

// ═══════════════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════════════

async function fetchJSON(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`API ${resp.status}: ${url}`);
  return resp.json();
}

async function fetchEvents(limit = 200) {
  const all = [];
  for (let offset = 0; offset < 600; offset += limit) {
    const url = `${GAMMA_API}/events?closed=false&active=true&limit=${limit}&order=volume&ascending=false&offset=${offset}`;
    const batch = await fetchJSON(url);
    if (batch.length === 0) break;
    all.push(...batch);
  }
  return all;
}

async function fetchOrderBook(tokenId) {
  try {
    const url = `${CLOB_API}/book?token_id=${tokenId}`;
    const data = await fetchJSON(url);
    return data;
  } catch (e) {
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 1: TRADEABILITY
// ═══════════════════════════════════════════════════════════════════════

function checkLayer1(market) {
  const result = { pass: true, flags: [], failReason: null };

  // Rule 1: Structural
  if (!market.active || market.closed) {
    result.pass = false;
    result.failReason = 'STRUCTURAL: Market inactive or closed';
    return result;
  }

  const prices = parseOutcomePrices(market);
  if (prices) {
    const sum = prices.yes + prices.no;
    if (sum > 1.03 || sum < 0.97) {
      result.pass = false;
      result.failReason = `STRUCTURAL: Arbitrage (YES+NO = ${sum.toFixed(3)})`;
      return result;
    }
  }

  // Rule 2: Settlement — check resolution description
  const desc = (market.description || '').toLowerCase();
  const resSource = market.resolutionSource || '';
  const settlementFlags = checkSettlement(desc, resSource);
  if (settlementFlags.fail) {
    result.pass = false;
    result.failReason = `SETTLEMENT: ${settlementFlags.reason}`;
    return result;
  }
  if (settlementFlags.flags.length > 0) {
    result.flags.push(...settlementFlags.flags);
  }

  // Rule 3: Execution — check spread
  const spread = market.spread || 0;
  if (spread > 0.10) {
    result.pass = false;
    result.failReason = `EXECUTION: Spread too wide (${(spread * 100).toFixed(1)}c)`;
    return result;
  }
  if (spread > 0.05) {
    result.flags.push(`Thin spread (${(spread * 100).toFixed(1)}c)`);
  }

  // Rule 3+4: Liquidity check
  const liq = market.liquidityNum || 0;
  if (liq < 500) {
    result.pass = false;
    result.failReason = `EXIT: No liquidity ($${Math.round(liq)})`;
    return result;
  }
  if (liq < 5000) {
    result.flags.push(`Low liquidity ($${Math.round(liq)})`);
  }

  // Volume check (minimum tradeable)
  const vol = market.volumeNum || 0;
  if (vol < 10000) {
    result.pass = false;
    result.failReason = `EXECUTION: Volume too low ($${Math.round(vol)})`;
    return result;
  }

  return result;
}

function checkSettlement(desc, resSource) {
  const result = { fail: false, reason: '', flags: [] };

  if (!desc || desc.length < 20) {
    result.fail = true;
    result.reason = 'No resolution description';
    return result;
  }

  // Check for ambiguous resolution language
  if (desc.includes('to be determined') || desc.includes('tbd')) {
    result.fail = true;
    result.reason = 'Resolution source TBD';
    return result;
  }

  // Flag "credible reporting" without specific source
  if (desc.includes('credible reporting') && !desc.includes('reuters') && !desc.includes('ap ') && !desc.includes('official')) {
    result.flags.push('Relies on "credible reporting" (undefined)');
  }

  // Flag consensus-based resolution
  if (desc.includes('consensus') && desc.includes('credible')) {
    result.flags.push('Consensus-based resolution');
  }

  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 2: OPPORTUNITY SCORE (EDGE + GRIND)
// ═══════════════════════════════════════════════════════════════════════

function scoreEdge(market) {
  let score = 0;
  const signals = [];

  const prices = parseOutcomePrices(market);
  const vol = market.volumeNum || 0;
  const vol24h = market.volume24hr || 0;
  const vol1wk = market.volume1wk || 0;
  const daysOld = daysBetween(new Date(market.createdAt || market.startDate), TODAY);
  const daysToEnd = daysToResolution(market);

  // New market < 48h
  if (daysOld <= 2) {
    score += 3;
    signals.push('+3 New market');
  }

  // Price moved > 10c in 24h
  const priceChange1d = Math.abs(market.oneDayPriceChange || 0);
  if (priceChange1d > 0.10) {
    score += 2;
    signals.push(`+2 Price moved ${(priceChange1d * 100).toFixed(0)}c/24h`);
  }

  // Volume spike (rough: 24h vol > avg daily vol * 3)
  const avgDailyVol = daysOld > 0 ? vol / daysOld : vol;
  if (vol24h > avgDailyVol * 3 && vol24h > 5000) {
    score += 1;
    signals.push('+1 Volume spike');
  }

  // Near 50c (40-60c range)
  if (prices) {
    const yesPrice = prices.yes;
    if (yesPrice >= 0.40 && yesPrice <= 0.60) {
      score += 1;
      signals.push('+1 Near 50c (max uncertainty)');
    }
  }

  // Approaching deadline (< 14 days)
  if (daysToEnd > 0 && daysToEnd <= 14) {
    score += 1;
    signals.push('+1 Approaching deadline');
  }

  // Low volume relative to event importance (high-vol events have > $1M)
  if (vol < 100000 && daysOld > 7) {
    score += 2;
    signals.push('+2 Low volume vs event importance');
  }

  // Multi-outcome market within a time-series event
  if (market._eventTitle && /by\b/i.test(market._eventTitle)) {
    score += 1;
    signals.push('+1 Time-series event');
  }

  // High-volume event (event-level volume > $5M = major geopolitical market)
  if (market._eventVolume && market._eventVolume > 5000000) {
    score += 2;
    signals.push('+2 Major event (>$5M vol)');
  } else if (market._eventVolume && market._eventVolume > 1000000) {
    score += 1;
    signals.push('+1 Significant event (>$1M vol)');
  }

  // Anti-signals
  const priceChange1w = Math.abs(market.oneWeekPriceChange || 0);
  // Don't penalize stability for markets near 50c — uncertainty IS the signal
  const isNear50c = prices && prices.yes >= 0.35 && prices.yes <= 0.65;
  if (priceChange1w < 0.03 && daysOld > 7 && vol > 100000 && !isNear50c) {
    score -= 2;
    signals.push('-2 Stable >7 days (high vol, not near 50c)');
  }
  if (vol > 50000000 && daysOld > 30) {
    score -= 2;
    signals.push('-2 Very high volume + old');
  }

  // Extreme price for > 7 days
  if (prices && daysOld > 7) {
    const yesPrice = prices.yes;
    if ((yesPrice < 0.10 || yesPrice > 0.90) && priceChange1w < 0.05) {
      score -= 1;
      signals.push('-1 Extreme price, stable');
    }
  }

  return { score: Math.max(0, Math.min(10, score)), signals };
}

function scoreGrind(market, winProb = null) {
  // GRIND requires probability estimate. If not provided, use market price as proxy.
  const prices = parseOutcomePrices(market);
  if (!prices) return { score: 0, signals: ['No price data'], details: null };

  const daysToEnd = daysToResolution(market);
  if (daysToEnd <= 0) return { score: 0, signals: ['Already expired'], details: null };

  // Determine which side to bet and the probability
  // For GRIND: we pick the side with higher probability (consensus side)
  const yesPrice = prices.yes;
  const noPrice = prices.no;
  const bettingSide = yesPrice >= noPrice ? 'YES' : 'NO';
  const entryPrice = bettingSide === 'YES' ? yesPrice : noPrice;
  const marketImpliedProb = entryPrice; // Market price = implied probability

  // Use provided winProb, or apply consensus premium for auto-estimation.
  // GRIND logic: if the market is heavily one-sided and stable, actual probability
  // is likely HIGHER than the price (markets under-price near-certainties due to
  // capital cost and time value). Apply a conservative premium.
  let usedProb;
  if (winProb) {
    usedProb = winProb;
  } else {
    // Consensus premium: the more one-sided, the more the market under-prices
    let premium;
    if (marketImpliedProb >= 0.95) premium = 0.02;
    else if (marketImpliedProb >= 0.90) premium = 0.04;
    else if (marketImpliedProb >= 0.80) premium = 0.08;
    else if (marketImpliedProb >= 0.70) premium = 0.12;
    else premium = 0;
    usedProb = Math.min(0.99, marketImpliedProb + premium);
  }

  // GRIND gates
  if (usedProb < 0.70) {
    return { score: 0, signals: ['Win prob < 70% (GRIND gate)'], details: null };
  }
  if (daysToEnd > 45) {
    return { score: 0, signals: [`${daysToEnd} days > 45 (GRIND gate)`], details: null };
  }

  // Capital Efficiency calculation
  const profit = 1 - entryPrice; // Profit per $1 share if correct
  const expectedReturn = (usedProb * profit) - ((1 - usedProb) * entryPrice);
  const returnPerDollar = expectedReturn / entryPrice;
  const dailyReturn = returnPerDollar / daysToEnd;
  const annualizedReturn = dailyReturn * 365;

  // Map to score
  let score;
  if (annualizedReturn > 2.0) score = 10;
  else if (annualizedReturn > 1.5) score = 9;
  else if (annualizedReturn > 1.0) score = 8;
  else if (annualizedReturn > 0.75) score = 7;
  else if (annualizedReturn > 0.50) score = 6;
  else if (annualizedReturn > 0.30) score = 5;
  else if (annualizedReturn > 0.15) score = 4;
  else if (annualizedReturn > 0.05) score = 3;
  else if (annualizedReturn > 0) score = 2;
  else score = 1;

  return {
    score,
    signals: [`${bettingSide} at ${(entryPrice * 100).toFixed(1)}c, ${(annualizedReturn * 100).toFixed(0)}% ann.`],
    details: {
      side: bettingSide,
      entryPrice,
      expectedReturn: (expectedReturn * 100).toFixed(1),
      annualized: (annualizedReturn * 100).toFixed(0),
      daysToEnd,
      winProb: usedProb
    }
  };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 3: RESOLUTION QUALITY
// ═══════════════════════════════════════════════════════════════════════

function scoreResolution(market) {
  let score = 0;
  const flags = [];
  const desc = (market.description || '').toLowerCase();

  // 1. Source defined?
  if (desc.includes('official') || desc.includes('reuters') || desc.includes('ap ') ||
      desc.includes('court records') || desc.includes('credible reporting') ||
      desc.includes('government') || desc.includes('on-chain')) {
    score += 1;
  } else {
    flags.push('No resolution source defined');
  }

  // 2. Trigger defined?
  if (desc.includes('will resolve to "yes" if') || desc.includes('resolve to yes if') ||
      desc.includes('resolves to "yes"') || desc.includes('this market will resolve')) {
    score += 1;
  } else {
    flags.push('Trigger not clearly defined');
  }

  // 3. Edge cases addressed?
  if (desc.includes('will not count') || desc.includes('does not count') ||
      desc.includes('not qualify') || desc.includes('for the purposes of') ||
      desc.includes('excluding') || desc.includes('will not be considered')) {
    score += 1;
  } else {
    flags.push('Edge cases not addressed');
  }

  // 4. Time boundary clear?
  if (market.endDateIso || desc.match(/\d{4}.*(?:am|pm|et|utc)/i) ||
      desc.match(/by\s+\w+\s+\d{1,2},?\s+\d{4}/i) || desc.match(/11:59\s*pm/i)) {
    score += 1;
  } else {
    flags.push('Time boundary unclear');
  }

  // 5. No double-resolution risk?
  // Multi-outcome markets within events have higher risk
  const outcomes = safeParseJSON(market.outcomes);
  if (!outcomes || outcomes.length <= 2) {
    score += 1;
  } else {
    flags.push('Multi-outcome: double-resolution risk');
  }

  return { score, flags };
}

// ═══════════════════════════════════════════════════════════════════════
// LAYER 4: CORRELATION
// ═══════════════════════════════════════════════════════════════════════

const CORRELATION_GROUPS = {
  'A: US-Iran Ceasefire': ['ceasefire', 'conflict ends'],
  'B: Iran Regime Change': ['regime fall', 'regime change', 'pahlavi'],
  'C: Escalation': ['strike iran', 'forces enter', 'invade', 'ground offensive', 'annex'],
  'D: Nuclear': ['nuclear', 'enrichment', 'uranium', 'strait of hormuz'],
  'E: Israel-Hamas': ['hamas', 'gaza'],
  'F: Lebanon': ['lebanon', 'hezbollah'],
  'G: Iran Strikes': ['iran strike', 'iran strikes'],
};

function assignCorrelationGroup(market) {
  const q = (market.question || '').toLowerCase();
  const eventTitle = (market._eventTitle || '').toLowerCase();
  const combined = q + ' ' + eventTitle;

  for (const [group, keywords] of Object.entries(CORRELATION_GROUPS)) {
    if (keywords.some(k => combined.includes(k))) {
      return group;
    }
  }
  return 'Z: Other';
}

function detectTimeSeries(candidates) {
  // Group by event, flag time-series
  const byEvent = {};
  for (const c of candidates) {
    const eid = c._eventId || 'standalone';
    if (!byEvent[eid]) byEvent[eid] = [];
    byEvent[eid].push(c);
  }

  for (const [eid, markets] of Object.entries(byEvent)) {
    if (markets.length > 1) {
      markets.forEach(m => {
        m._timeSeries = true;
        m._seriesCount = markets.length;
      });
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════
// COMPOSITE SCORE (V2.2 Additive Formula)
// ═══════════════════════════════════════════════════════════════════════

function calcComposite(market, probScore = null, winProb = null) {
  const oppScore = Math.max(market._edgeScore || 0, market._grindScore || 0);
  const resScore = market._resolutionScore || 0;

  // If no probability provided, estimate from market price for ranking
  const prob = probScore || estimateProbFromPrice(market);
  const prices = parseOutcomePrices(market);
  const marketImpliedWin = prices ? Math.max(prices.yes, prices.no) : 0.5;
  const ourWinPct = probToWinPct(prob);
  const edgePoints = ourWinPct - (marketImpliedWin * 100);

  const daysToEnd = daysToResolution(market);

  // 1. Opportunity (0-30)
  const opportunity = (oppScore / 10) * 30;

  // 2. Probability (0-30)
  const probability = (prob / 10) * 30;

  // 3. Resolution (0-20)
  const resolution = (resScore / 5) * 20;

  // 4. Edge Bonus (0-10)
  const edgeBonus = (Math.min(Math.max(edgePoints, 0), 30) / 30) * 10;

  // 5. CE Adjustment (-8 to +10)
  let ceAdj = 0;
  if (daysToEnd <= 14) ceAdj = 10;
  else if (daysToEnd <= 30) ceAdj = 8;
  else if (daysToEnd <= 45) ceAdj = 5;
  else if (daysToEnd <= 60) ceAdj = 2;
  else if (daysToEnd <= 90) ceAdj = 0;
  else if (daysToEnd <= 120) ceAdj = -4;
  else ceAdj = -8;

  const composite = Math.max(0, opportunity + probability + resolution + edgeBonus + ceAdj);

  return {
    composite: Math.round(composite * 10) / 10,
    breakdown: {
      opportunity: Math.round(opportunity * 10) / 10,
      probability: Math.round(probability * 10) / 10,
      resolution: Math.round(resolution * 10) / 10,
      edgeBonus: Math.round(edgeBonus * 10) / 10,
      ceAdj,
      edgePoints: Math.round(edgePoints * 10) / 10,
      probScore: prob,
      daysToEnd
    }
  };
}

function estimateProbFromPrice(market) {
  // Rough auto-estimate: use market price as base, convert to 0-10 scale
  const prices = parseOutcomePrices(market);
  if (!prices) return 5;
  const highSide = Math.max(prices.yes, prices.no);
  // Map 0.50-1.0 → 5.0-10.0
  return Math.min(10, Math.max(1, highSide * 10));
}

function probToWinPct(probScore) {
  // Score 0-10 → Win % approximation
  if (probScore >= 9.0) return 93;
  if (probScore >= 7.5) return 85;
  if (probScore >= 6.0) return 72;
  if (probScore >= 4.5) return 57;
  if (probScore >= 3.0) return 42;
  if (probScore >= 1.5) return 27;
  return 15;
}

function getTier(score) {
  if (score >= 85) return 'S-TIER';
  if (score >= 70) return 'A-TIER';
  if (score >= 50) return 'B-TIER';
  if (score >= 30) return 'C-TIER';
  return 'WATCH';
}

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function parseOutcomePrices(market) {
  try {
    const p = typeof market.outcomePrices === 'string'
      ? JSON.parse(market.outcomePrices)
      : market.outcomePrices;
    if (p && p.length >= 2) {
      return { yes: parseFloat(p[0]) || 0, no: parseFloat(p[1]) || 0 };
    }
  } catch {}
  return null;
}

function safeParseJSON(str) {
  try { return typeof str === 'string' ? JSON.parse(str) : str; } catch { return null; }
}

function daysBetween(d1, d2) {
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

function daysToResolution(market) {
  // Try endDateIso first, then endDate
  let end = market.endDateIso || market.endDate;

  // If no end date, try to extract from question text
  if (!end) {
    const q = market.question || '';
    // Match patterns like "by March 31?" "by June 30?" "by April 30?"
    const dateMatch = q.match(/by\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
    if (dateMatch) {
      const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
      const month = monthNames.indexOf(dateMatch[1].toLowerCase());
      const day = parseInt(dateMatch[2]);
      // Assume current year or next year
      let year = TODAY.getFullYear();
      const candidate = new Date(year, month, day);
      if (candidate < TODAY) year++; // If date already passed this year, assume next year
      end = new Date(year, month, day).toISOString();
    }
    // Match patterns like "on March 10?" "on March 14?"
    if (!end) {
      const onMatch = q.match(/on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})/i);
      if (onMatch) {
        const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];
        const month = monthNames.indexOf(onMatch[1].toLowerCase());
        const day = parseInt(onMatch[2]);
        let year = TODAY.getFullYear();
        const candidate = new Date(year, month, day);
        if (candidate < TODAY) year++;
        end = new Date(year, month, day).toISOString();
      }
    }
    // Match "before 2027" or "in 2026"
    if (!end) {
      const yearMatch = q.match(/(?:before|in|by)\s+(\d{4})/i);
      if (yearMatch) {
        end = `${yearMatch[1]}-12-31`;
      }
    }
  }

  if (!end) return 365;
  return Math.max(0, daysBetween(TODAY, new Date(end)));
}

function matchesKeywords(text, keywords) {
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k));
}

function isExcluded(text) {
  return EXCLUDE_PATTERNS.some(p => p.test(text));
}

// ═══════════════════════════════════════════════════════════════════════
// INTERACTIVE PROBABILITY INPUT
// ═══════════════════════════════════════════════════════════════════════

function createRL() {
  return createInterface({ input: process.stdin, output: process.stdout });
}

async function askQuestion(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

async function interactiveProbability(candidates) {
  const rl = createRL();
  console.log('\n══════════════════════════════════════════════════');
  console.log('  PROBABILITY SCORING (manual input for top candidates)');
  console.log('  Score each P1-P4 from 1-10. Press Enter to skip (uses auto-estimate).');
  console.log('══════════════════════════════════════════════════\n');

  for (const c of candidates.slice(0, 10)) {
    const prices = parseOutcomePrices(c);
    const side = prices ? (prices.yes >= prices.no ? 'YES' : 'NO') : '?';
    const sidePrice = prices ? (side === 'YES' ? prices.yes : prices.no) : 0;

    console.log(`\n─── ${c.question} ───`);
    console.log(`  Side: ${side} at ${(sidePrice * 100).toFixed(1)}c | Days: ${daysToResolution(c)} | Vol: $${Math.round(c.volumeNum).toLocaleString()}`);

    const p1 = await askQuestion(rl, '  P1 Base Rate (1-10): ');
    const p2 = await askQuestion(rl, '  P2 Time Factor (1-10): ');
    const p3 = await askQuestion(rl, '  P3 Trajectory (1-10): ');
    const p4 = await askQuestion(rl, '  P4 Analyst/Jang (1-10): ');

    if (p1 || p2 || p3 || p4) {
      const s1 = parseFloat(p1) || 5;
      const s2 = parseFloat(p2) || 5;
      const s3 = parseFloat(p3) || 5;
      const s4 = parseFloat(p4) || 5;
      const probScore = (s1 * 0.30) + (s2 * 0.25) + (s3 * 0.25) + (s4 * 0.20);
      const winPct = probToWinPct(probScore);
      c._manualProbScore = probScore;
      c._manualWinPct = winPct;
      c._probInputs = { p1: s1, p2: s2, p3: s3, p4: s4 };
      console.log(`  → Prob Score: ${probScore.toFixed(2)} → Est. Win: ${winPct}%`);

      // Recalculate composite with manual probability
      const comp = calcComposite(c, probScore, winPct / 100);
      c._composite = comp.composite;
      c._compositeBreakdown = comp.breakdown;

      // Recalculate GRIND with actual probability
      const grind = scoreGrind(c, winPct / 100);
      if (grind.score > c._grindScore) {
        c._grindScore = grind.score;
        c._grindDetails = grind.details;
      }
    }
  }

  rl.close();
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);
  const useCache = args.includes('--cache');
  const interactiveMode = args.includes('--probability');
  const kwArg = args.find(a => a.startsWith('--keywords'));
  const keywords = kwArg
    ? args[args.indexOf(kwArg) + 1]?.split(',').map(k => k.trim().toLowerCase())
    : DEFAULT_KEYWORDS;

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  POLYMARKET SCREENING SYSTEM V2.2 — Automated Scan  ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log(`  Date: ${TODAY.toISOString().split('T')[0]}`);
  console.log(`  Keywords: ${keywords.length} terms`);
  console.log(`  Mode: ${useCache ? 'CACHED' : 'LIVE API'} | ${interactiveMode ? 'Interactive Probability' : 'Auto-estimate'}`);
  console.log('');

  // ── Step 1: Fetch all events ──
  let events;
  if (useCache && existsSync(CACHE_FILE)) {
    console.log('  Loading cached data...');
    events = JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  } else {
    console.log('  Fetching events from Gamma API...');
    events = await fetchEvents();
    writeFileSync(CACHE_FILE, JSON.stringify(events, null, 2));
    console.log(`  Cached ${events.length} events.`);
  }

  // ── Step 2: Filter for geopolitical markets ──
  console.log('  Filtering for Iran/ME geopolitical markets...');
  const allMarkets = [];

  for (const event of events) {
    const eventText = (event.title || '') + ' ' + (event.description || '');
    const eventMatches = matchesKeywords(eventText, keywords);

    const markets = event.markets || [];
    for (const m of markets) {
      const marketText = (m.question || '') + ' ' + (m.description || '');
      const matches = eventMatches || matchesKeywords(marketText, keywords);

      if (matches && !isExcluded(marketText) && !isExcluded(eventText)) {
        m._eventId = event.id;
        m._eventTitle = event.title || '';
        m._eventVolume = event.volume || 0;
        allMarkets.push(m);
      }
    }
  }

  // Dedup by market id
  const seen = new Set();
  const uniqueMarkets = allMarkets.filter(m => {
    if (seen.has(m.id)) return false;
    seen.add(m.id);
    return true;
  });

  console.log(`  Found ${uniqueMarkets.length} markets across ${events.length} events.\n`);

  // ── Step 3: Run Layer 1 on all markets ──
  console.log('  ── LAYER 1: TRADEABILITY ──');
  const tradeable = [];
  const deadList = [];

  for (const m of uniqueMarkets) {
    const l1 = checkLayer1(m);
    if (l1.pass) {
      m._l1flags = l1.flags;
      tradeable.push(m);
    } else {
      deadList.push({ id: m.id, question: m.question, reason: l1.failReason });
    }
  }
  console.log(`  PASS: ${tradeable.length} | FAIL: ${deadList.length}`);

  // ── Step 4: Run Layer 2 (EDGE + GRIND) ──
  console.log('  ── LAYER 2: OPPORTUNITY SCORE ──');
  const candidates = [];
  const watchlist = [];

  for (const m of tradeable) {
    const edge = scoreEdge(m);
    const grind = scoreGrind(m);

    m._edgeScore = edge.score;
    m._edgeSignals = edge.signals;
    m._grindScore = grind.score;
    m._grindSignals = grind.signals;
    m._grindDetails = grind.details;

    const passEdge = edge.score >= 4;
    const passGrind = grind.score >= 6;

    if (passEdge && passGrind) m._tag = 'BOTH';
    else if (passEdge) m._tag = 'EDGE';
    else if (passGrind) m._tag = 'GRIND';
    else m._tag = null;

    if (m._tag) {
      candidates.push(m);
    } else {
      watchlist.push(m);
    }
  }
  console.log(`  CANDIDATES: ${candidates.length} | WATCHLIST: ${watchlist.length}`);

  // ── Step 5: Run Layer 3 (Resolution Quality) ──
  console.log('  ── LAYER 3: RESOLUTION QUALITY ──');
  const qualified = [];
  for (const m of candidates) {
    const res = scoreResolution(m);
    m._resolutionScore = res.score;
    m._resolutionFlags = res.flags;

    if (res.score >= 3) {
      qualified.push(m);
    } else {
      watchlist.push(m);
    }
  }
  console.log(`  QUALIFIED: ${qualified.length}`);

  // ── Step 6: Layer 4 (Correlation) ──
  console.log('  ── LAYER 4: CORRELATION ──');
  for (const m of qualified) {
    m._correlationGroup = assignCorrelationGroup(m);
  }
  detectTimeSeries(qualified);

  // ── Step 7: Composite Score ──
  console.log('  ── COMPOSITE SCORE ──\n');
  for (const m of qualified) {
    const comp = calcComposite(m);
    m._composite = comp.composite;
    m._compositeBreakdown = comp.breakdown;
  }

  // Sort by composite
  qualified.sort((a, b) => b._composite - a._composite);

  // ── Interactive probability mode ──
  if (interactiveMode && qualified.length > 0) {
    await interactiveProbability(qualified);
    qualified.sort((a, b) => b._composite - a._composite);
  }

  // ═══════════════════════════════════════════════════════════════════
  // OUTPUT
  // ═══════════════════════════════════════════════════════════════════

  const reportDate = TODAY.toISOString().split('T')[0];
  let report = '';

  report += '┌──────────────────────────────────────────────────────────────────────────────┐\n';
  report += `│ SCREENING REPORT — ${reportDate}                                              │\n`;
  report += `│ Scanned: ${uniqueMarkets.length} markets | Candidates: ${qualified.length} | Watchlist: ${watchlist.length} | Dead: ${deadList.length}       │\n`;
  report += '├──────────────────────────────────────────────────────────────────────────────┤\n\n';

  if (qualified.length === 0) {
    report += '  No candidates found. All markets failed screening.\n\n';
  } else {
    report += '  #   Market                                          Price  Days  Tag    Edge  Grind  Res  Comp  Tier    Group\n';
    report += '  ─── ─────────────────────────────────────────────── ───── ────  ─────  ────  ─────  ───  ────  ──────  ──────\n';

    qualified.forEach((m, i) => {
      const prices = parseOutcomePrices(m);
      const side = prices ? (prices.yes >= prices.no ? 'YES' : 'NO') : '?';
      const sidePrice = prices ? (side === 'YES' ? prices.yes : prices.no) : 0;
      const days = daysToResolution(m);
      const tag = (m._tag || '').padEnd(5);
      const edgeS = String(m._edgeScore || 0).padStart(4);
      const grindS = String(m._grindScore || 0).padStart(5);
      const resS = `${m._resolutionScore}/5`;
      const comp = String(m._composite).padStart(4);
      const tier = getTier(m._composite).padEnd(6);
      const group = (m._correlationGroup || 'Z').substring(0, 20);
      const ts = m._timeSeries ? ' [SERIES]' : '';
      const qTrunc = (m.question || '').substring(0, 49).padEnd(49);

      report += `  ${String(i + 1).padStart(2)}  ${qTrunc} ${(sidePrice * 100).toFixed(0).padStart(3)}c  ${String(days).padStart(3)}d  ${tag}  ${edgeS}  ${grindS}  ${resS}  ${comp}  ${tier}  ${group}${ts}\n`;
    });

    // Probability breakdown for top candidates
    report += '\n  PROBABILITY BREAKDOWN:\n';
    qualified.slice(0, 5).forEach((m, i) => {
      const bd = m._compositeBreakdown;
      if (m._probInputs) {
        const pi = m._probInputs;
        report += `  #${i + 1}: P1=${pi.p1} P2=${pi.p2} P3=${pi.p3} P4=${pi.p4} → Score ${m._manualProbScore?.toFixed(1)} → Est. ${m._manualWinPct}% → Edge +${bd.edgePoints} pts\n`;
      } else {
        report += `  #${i + 1}: Auto-estimate → Prob ${bd.probScore?.toFixed(1)} → Edge +${bd.edgePoints} pts (run with --probability for manual scoring)\n`;
      }
    });

    // Capital efficiency for GRIND/BOTH candidates
    const grindCandidates = qualified.filter(m => m._grindDetails);
    if (grindCandidates.length > 0) {
      report += '\n  CAPITAL EFFICIENCY (GRIND candidates):\n';
      grindCandidates.slice(0, 5).forEach((m, i) => {
        const d = m._grindDetails;
        report += `  ${m.question?.substring(0, 40)}: ${d.side} at ${(d.entryPrice * 100).toFixed(0)}c × ${d.daysToEnd}d → Exp.Ret ${d.expectedReturn}c → Ann. ${d.annualized}% → GRIND ${m._grindScore}/10\n`;
      });
    }

    // Flags
    const flaggedMarkets = qualified.filter(m => (m._l1flags?.length > 0) || (m._resolutionFlags?.length > 0));
    if (flaggedMarkets.length > 0) {
      report += '\n  FLAGS:\n';
      flaggedMarkets.forEach(m => {
        const allFlags = [...(m._l1flags || []), ...(m._resolutionFlags || [])];
        allFlags.forEach(f => {
          report += `  - ${m.question?.substring(0, 40)}: ${f}\n`;
        });
      });
    }

    // Correlation groups
    const groups = {};
    qualified.forEach(m => {
      const g = m._correlationGroup;
      if (!groups[g]) groups[g] = [];
      groups[g].push(m);
    });
    const multiGroups = Object.entries(groups).filter(([_, ms]) => ms.length > 1);
    if (multiGroups.length > 0) {
      report += '\n  CORRELATION GROUPS (multiple candidates):\n';
      multiGroups.forEach(([group, ms]) => {
        report += `  ${group}: ${ms.map(m => m.question?.substring(0, 35)).join(' | ')}\n`;
      });
    }

    report += '\n  NEXT STEP:\n';
    report += '  EDGE markets → Full SMM_METRICS_FRAMEWORK + Jang analysis\n';
    report += '  GRIND markets → Quick SMM confirmation scan (2 min)\n';
    report += '  BOTH markets → Full analysis, highest priority\n';
    report += '  Run with --probability to manually score P1-P4 for accurate composite\n';
  }

  report += '\n└──────────────────────────────────────────────────────────────────────────────┘\n';

  // Watchlist summary
  if (watchlist.length > 0) {
    report += '\n  WATCHLIST (passed Layer 1, failed Layer 2/3):\n';
    watchlist.slice(0, 10).forEach(m => {
      const prices = parseOutcomePrices(m);
      const yesP = prices ? (prices.yes * 100).toFixed(0) : '?';
      report += `  - ${m.question?.substring(0, 60)} (YES ${yesP}c, EDGE ${m._edgeScore || '?'}/10)\n`;
    });
  }

  // Dead list summary
  if (deadList.length > 0) {
    report += '\n  DEAD LIST (failed Layer 1):\n';
    deadList.slice(0, 10).forEach(d => {
      report += `  - ${d.question?.substring(0, 50)}: ${d.reason}\n`;
    });
    if (deadList.length > 10) {
      report += `  ... and ${deadList.length - 10} more\n`;
    }
  }

  // Print to console
  console.log(report);

  // Save report
  const reportFile = `SCREENING_REPORT_${reportDate}.md`;
  writeFileSync(reportFile, report);
  console.log(`\nReport saved to ${reportFile}`);

  // Save structured data for downstream use
  const structuredOutput = {
    date: reportDate,
    scanned: uniqueMarkets.length,
    candidates: qualified.map(m => ({
      id: m.id,
      question: m.question,
      eventId: m._eventId,
      eventTitle: m._eventTitle,
      prices: parseOutcomePrices(m),
      volume: m.volumeNum,
      liquidity: m.liquidityNum,
      daysToEnd: daysToResolution(m),
      endDate: m.endDateIso,
      tag: m._tag,
      edgeScore: m._edgeScore,
      grindScore: m._grindScore,
      resolutionScore: m._resolutionScore,
      composite: m._composite,
      tier: getTier(m._composite),
      correlationGroup: m._correlationGroup,
      timeSeries: m._timeSeries || false,
      probInputs: m._probInputs || null,
      grindDetails: m._grindDetails || null,
      clobTokenIds: m.clobTokenIds,
      conditionId: m.conditionId,
      slug: m.slug,
    })),
    watchlist: watchlist.slice(0, 20).map(m => ({
      id: m.id,
      question: m.question,
      edgeScore: m._edgeScore,
      grindScore: m._grindScore,
    })),
    deadCount: deadList.length,
  };
  writeFileSync('screening_data.json', JSON.stringify(structuredOutput, null, 2));
  console.log('Structured data saved to screening_data.json');
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
