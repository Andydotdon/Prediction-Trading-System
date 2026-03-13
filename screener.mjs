#!/usr/bin/env node
/**
 * POLYMARKET SCREENING SYSTEM V2.2 — Automated Screener
 *
 * Automates Layers 1-4 + EDGE/GRIND scoring.
 * Probability (P1-P4) is manual input — user scores after seeing candidates.
 *
 * Usage:
 *   node screener.mjs                    # Full scan + dashboard (screening → Jang overlay → alpha ranking)
 *   node screener.mjs --keywords "iran,ceasefire,nuclear"  # Custom keywords
 *   node screener.mjs --probability      # Interactive mode: prompts for P1-P4 on top candidates
 *   node screener.mjs --cache            # Use cached data (skip API calls)
 *   node screener.mjs --smm "ceasefire march 31"           # SMM report for a specific market
 *   node screener.mjs --smm 3            # SMM report for candidate #3 from last screening
 *   node screener.mjs --smm-all          # SMM reports for all S-TIER and A-TIER candidates
 *   node screener.mjs --dashboard        # Dashboard only (uses last screening_data.json)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { createInterface } from 'readline';

// ═══════════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════════

const GAMMA_API = 'https://gamma-api.polymarket.com';
const CLOB_API = 'https://clob.polymarket.com';
const DATA_API = 'https://data-api.polymarket.com';
const CACHE_DIR = '.';
const CACHE_FILE = `${CACHE_DIR}/screening_cache.json`;
const TODAY = new Date();

// Bet sizing config — adjust to your bankroll
const MIN_BET = 2000;           // Minimum bet per market ($)
const MAX_BET = 10000;          // Maximum bet per market ($)
const MAX_GROUP_EXPOSURE = 25000; // Max total $ in one correlation group (2.5× MAX_BET)

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

const CORRELATION_GROUPS = [
  // Order matters — first match wins. More specific patterns go first.
  { id: 'G: Iran Strikes', patterns: [/iran strike/i, /iran strikes/i, /iran.*strike.*(?:abqaiq|ghawar|dimona|refinery|ruwais|ahmadi|zour)/i] },
  { id: 'H: Khamenei/Leadership', patterns: [/khamenei/i, /supreme leader/i, /mojtaba/i, /pezeshkian/i] },
  { id: 'I: Trump-Iran Ops', patterns: [/trump.*(?:military|operations|war|declare)/i, /end of military/i, /trump.*iran/i] },
  { id: 'A: US-Iran Ceasefire', patterns: [/us\s*x?\s*iran\s*ceasefire/i, /iran.*ceasefire/i, /conflict ends.*iran/i] },
  { id: 'J: Israel-Hamas Ceasefire', patterns: [/israel.*hamas.*ceasefire/i, /hamas.*ceasefire/i, /ceasefire.*phase/i] },
  { id: 'K: Gaza Intervention', patterns: [/intervention.*gaza/i, /gaza.*intervention/i] },
  { id: 'E: Israel-Hamas', patterns: [/hamas/i, /gaza/i] },
  { id: 'L: Russia-Ukraine', patterns: [/russia/i, /ukraine/i, /nato/i] },
  { id: 'B: Iran Regime Change', patterns: [/regime.*fall/i, /regime.*change/i, /pahlavi/i, /regime/i] },
  { id: 'C: Escalation', patterns: [/strike iran/i, /forces enter/i, /invade.*iran/i, /ground offensive/i, /annex/i, /country strike/i] },
  { id: 'D: Nuclear', patterns: [/nuclear/i, /enrichment/i, /uranium/i, /fordow/i, /strait of hormuz/i] },
  { id: 'F: Lebanon', patterns: [/lebanon/i, /hezbollah/i] },
  { id: 'M: Houthi/Yemen', patterns: [/houthi/i, /yemen/i] },
  { id: 'N: Netanyahu/Israel Politics', patterns: [/netanyahu/i, /israeli.*election/i, /knesset/i] },
  { id: 'O: US-Iran Diplomacy', patterns: [/us.*iran.*meeting/i, /iran.*deal/i, /iran.*negotiat/i, /cyberattack.*iran/i, /military support.*kurd/i] },
];

function assignCorrelationGroup(market) {
  const q = market.question || '';
  const eventTitle = market._eventTitle || '';
  const combined = q + ' ' + eventTitle;

  for (const group of CORRELATION_GROUPS) {
    if (group.patterns.some(p => p.test(combined))) {
      return group.id;
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
  const monthNames = ['january','february','march','april','may','june','july','august','september','october','november','december'];

  // Helper: parse a date string or components into days from today
  function parseEndDate(dateStr) {
    if (!dateStr) return null;
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return null;
    return Math.max(0, daysBetween(TODAY, d));
  }

  function fromMonthDay(monthStr, dayStr, yearStr) {
    const month = monthNames.indexOf(monthStr.toLowerCase());
    if (month === -1) return null;
    const day = parseInt(dayStr);
    let year = yearStr ? parseInt(yearStr) : TODAY.getFullYear();
    const candidate = new Date(year, month, day);
    if (!yearStr && candidate < TODAY) year++;
    return Math.max(0, daysBetween(TODAY, new Date(year, month, day)));
  }

  // 1. Try API end date fields
  const apiEnd = parseEndDate(market.endDateIso || market.endDate);

  // 2. Try to extract from question text
  const q = (market.question || '') + ' ' + (market._eventTitle || '');
  let textEnd = null;

  // "by March 31, 2026" or "by March 31?"
  const byMatch = q.match(/by\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
  if (byMatch) {
    textEnd = fromMonthDay(byMatch[1], byMatch[2], byMatch[3]);
  }

  // "on March 10?" or "on March 14?"
  if (textEnd === null) {
    const onMatch = q.match(/on\s+(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:\s*,?\s*(\d{4}))?/i);
    if (onMatch) {
      textEnd = fromMonthDay(onMatch[1], onMatch[2], onMatch[3]);
    }
  }

  // "by end of 2026" or "before 2027" or "in 2026"
  if (textEnd === null) {
    const yearMatch = q.match(/(?:before|in|by|by end of)\s+(\d{4})/i);
    if (yearMatch) {
      textEnd = parseEndDate(`${yearMatch[1]}-12-31`);
    }
  }

  // Use text-extracted date if API date is missing or clearly wrong (e.g., API says 19 days but question says June 30)
  // Prefer the MORE SPECIFIC source: text > API when text has month+day
  if (textEnd !== null && apiEnd !== null) {
    // If they differ by more than 7 days, prefer the text-extracted date
    // (API endDate is sometimes the market close date, not the resolution date)
    if (Math.abs(textEnd - apiEnd) > 7) {
      return textEnd;
    }
  }

  if (textEnd !== null) return textEnd;
  if (apiEnd !== null) return apiEnd;
  return 365; // Unknown
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
// JANG ANALYSIS PARSER
// ═══════════════════════════════════════════════════════════════════════

const JANG_DIR = 'C:/Users/Surface/Downloads/Telegram Desktop/Politics Prediction copy/Politics Prediction copy/Prediction Lead';
const JANG_KEO_FILE = `${JANG_DIR}/11-POLYMARKET-KEO.md`;
const JANG_TOANBO_FILE = `${JANG_DIR}/12-POLYMARKET-TOAN-BO.md`;

function parseJangKeo() {
  if (!existsSync(JANG_KEO_FILE)) return [];
  const content = readFileSync(JANG_KEO_FILE, 'utf8');
  const entries = [];

  // Split by --- separators, each block is a pick
  const blocks = content.split(/\n---\n/);

  for (const block of blocks) {
    // Skip header/instruction blocks
    if (!block.includes('**Market:**') && !block.includes('**Jang estimate:**')) continue;

    const entry = { source: 'KEO', priority: 0 };

    // Extract pick number (KEO SỐ 1, KEO SỐ 2, etc.)
    const pickMatch = block.match(/KÈO SỐ (\d+)/);
    if (pickMatch) entry.priority = parseInt(pickMatch[1]);

    // Also handle "CÁC KÈO KHÁC" section
    if (block.includes('CÁC KÈO KHÁC')) entry.priority = 99;

    // Extract market name
    const marketMatch = block.match(/\*\*Market:\*\*\s*(.+)/);
    if (marketMatch) entry.marketName = marketMatch[1].trim();

    // Extract link/slug
    const linkMatch = block.match(/polymarket\.com\/event\/([^\s\n*]+)/);
    if (linkMatch) entry.slug = linkMatch[1].trim();

    // Extract Jang estimate
    const estMatch = block.match(/Jang estimate.*?~?(\d+)%\s*(YES|NO)/i);
    if (estMatch) {
      entry.jangPct = parseInt(estMatch[1]);
      entry.jangSide = estMatch[2].toUpperCase();
    }

    // Also handle "tức ~65% NO" pattern
    const altEstMatch = block.match(/tức\s*~?(\d+)%\s*(YES|NO)/i);
    if (altEstMatch && !entry.jangPct) {
      entry.jangPct = parseInt(altEstMatch[1]);
      entry.jangSide = altEstMatch[2].toUpperCase();
    }

    // Extract edge
    const edgeMatch = block.match(/Edge:.*?\+(\d+)%/i);
    if (edgeMatch) entry.jangEdge = parseInt(edgeMatch[1]);

    // Extract direction
    const dirMatch = block.match(/Mua (YES|NO)/i);
    if (dirMatch) entry.direction = dirMatch[1].toUpperCase();

    // If we have jangSide but no direction, infer it
    if (!entry.direction && entry.jangSide) {
      entry.direction = entry.jangSide;
    }

    // Extract reasoning (bullet points after "Tại sao:")
    const whyMatch = block.match(/\*\*Tại sao.*?\*\*[:\s]*\n([\s\S]*?)(?=\n\*\*Rủi ro|$)/);
    if (whyMatch) {
      const bullets = whyMatch[1].split('\n')
        .filter(l => l.trim().startsWith('-'))
        .map(l => l.trim().replace(/^-\s*/, ''))
        .slice(0, 3);
      entry.reasoning = bullets.join('. ');
    }

    // Extract risk
    const riskMatch = block.match(/\*\*Rủi ro:\*\*\s*(.+)/);
    if (riskMatch) entry.risk = riskMatch[1].trim();

    if (entry.marketName || entry.slug) {
      entries.push(entry);
    }
  }

  return entries;
}

function parseJangToanBo() {
  if (!existsSync(JANG_TOANBO_FILE)) return [];
  const content = readFileSync(JANG_TOANBO_FILE, 'utf8');
  const entries = [];

  // Split by ### sections
  const sections = content.split(/(?=### [A-Z]\d+\.)/);

  for (const section of sections) {
    const headerMatch = section.match(/### ([A-Z]\d+)\.\s*(.+)/);
    if (!headerMatch) continue;

    const entry = {
      source: 'TOANBO',
      sectionId: headerMatch[1],
      sectionTitle: headerMatch[2].trim(),
      priority: 0,
    };

    // Extract all event slugs
    const slugMatches = [...section.matchAll(/polymarket\.com\/event\/([^\s\n*)+]+)/g)];
    entry.slugs = slugMatches.map(m => m[1].replace(/[)]+$/, ''));
    entry.slug = entry.slugs[0] || '';

    // Extract Jang line
    const jangMatch = section.match(/\*\*Jang:\*\*\s*(.+)/);
    if (jangMatch) entry.reasoning = jangMatch[1].trim();

    // Extract AI line for additional context
    const aiMatch = section.match(/\*\*AI:\*\*\s*(.+)/);
    if (aiMatch) entry.aiNote = aiMatch[1].trim();

    // Extract probability + direction + edge from BOTH Jang and AI lines
    const ai = entry.aiNote || '';
    const jang = entry.reasoning || '';
    const combined = jang + ' ' + ai;

    // 1. Extract Jang probability: "tin Jang ~45%", "Jang ~55-60%", "Jang estimate ~50%"
    const jangPctMatch = combined.match(/(?:tin\s+)?Jang\s*(?:estimate)?\s*~?(\d+)(?:-(\d+))?%/i);
    if (jangPctMatch) {
      // If range like "55-60%", take midpoint
      entry.jangPct = jangPctMatch[2]
        ? Math.round((parseInt(jangPctMatch[1]) + parseInt(jangPctMatch[2])) / 2)
        : parseInt(jangPctMatch[1]);
    }

    // 2. Extract direction from AI line: "NO by... có edge", "YES (...) có edge/underpriced"
    const dirEdgeMatch = ai.match(/(YES|NO)\s+(?:by\s+)?(?:\w+\s+){0,4}\([\d.]+[¢c]\)\s+(?:có\s+edge|underpriced|có\s+thể\s+underpriced)/i);
    if (dirEdgeMatch) {
      entry.direction = dirEdgeMatch[1].toUpperCase();
    }
    // Also check Jang line for direction
    if (!entry.direction) {
      const dirFromJang = jang.match(/\b(?:mua|bet|chọn|pick)\s+(YES|NO)\b/i)
        || jang.match(/→\s*(YES|NO)\b/i);
      if (dirFromJang) entry.direction = dirFromJang[1].toUpperCase();
    }
    // Infer direction from Vietnamese negation in Jang line (KHÔNG = NO thesis)
    if (!entry.direction && jang) {
      if (/^(?:(?!có thể|khả thi).)*KHÔNG\b/i.test(jang)) entry.direction = 'NO';
    }

    // 3. Extract edge from AI line: "edge ~20%", "edge ~+15%", "edge nhẹ"
    const edgeMatch = ai.match(/edge\s*~?\+?(\d+)%/i);
    if (edgeMatch) entry.jangEdge = parseInt(edgeMatch[1]);

    // 4. If AI line mentions "Jang ~N%" with YES/NO context, set jangPct + jangSide
    if (entry.jangPct && !entry.jangSide) {
      // Try to find which side the percentage refers to
      const sideMatch = combined.match(/~?\d+%\s*(YES|NO)/i);
      if (sideMatch) entry.jangSide = sideMatch[1].toUpperCase();
    }

    if (entry.slug || entry.sectionTitle) {
      entries.push(entry);
    }
  }

  return entries;
}

function matchJangToCandidate(candidate, jangEntries) {
  const cSlug = (candidate.slug || '').toLowerCase();
  const cQuestion = (candidate.question || '').toLowerCase();
  const cEventSlug = (candidate.eventSlug || '').toLowerCase();

  // Strip date suffixes for core slug matching: "regime-fall-by-the-end-of-2026" → "regime-fall"
  const stripDateSuffix = (s) => s.replace(/-by.*$/, '').replace(/-before.*$/, '').replace(/-in-\d{4}$/, '').replace(/-\d{3,}$/, '');
  const cSlugCore = stripDateSuffix(cSlug);
  const cEventSlugCore = stripDateSuffix(cEventSlug);

  for (const jang of jangEntries) {
    // Match by exact slug containment
    if (jang.slug && cSlug && cSlug.includes(jang.slug.toLowerCase())) return jang;
    if (jang.slug && cEventSlug && cEventSlug.includes(jang.slug.toLowerCase())) return jang;

    // Match by any slug in the list (TOANBO has multiple)
    if (jang.slugs) {
      for (const s of jang.slugs) {
        if (cSlug && cSlug.includes(s.toLowerCase())) return jang;
        if (cEventSlug && cEventSlug.includes(s.toLowerCase())) return jang;
      }
    }

    // Core slug matching: strip date suffixes and compare
    const allJangSlugs = [jang.slug, ...(jang.slugs || [])].filter(Boolean);
    for (const js of allJangSlugs) {
      const jCore = stripDateSuffix(js.toLowerCase());
      if (jCore.length > 8 && cSlugCore && (cSlugCore.includes(jCore) || jCore.includes(cSlugCore))) return jang;
      if (jCore.length > 8 && cEventSlugCore && (cEventSlugCore.includes(jCore) || jCore.includes(cEventSlugCore))) return jang;
    }

    // Fuzzy match by market name keywords (strict: 4+ char words, need 3+ matches)
    if (jang.marketName) {
      const stopWords = ['will', 'the', 'before', 'after', 'from', 'this', 'that', 'with', 'have', 'been'];
      const jWords = jang.marketName.toLowerCase().split(/\s+/).filter(w => w.length > 4 && !stopWords.includes(w));
      const matchCount = jWords.filter(w => cQuestion.includes(w)).length;
      if (jWords.length > 0 && matchCount >= 3) return jang;
    }
  }

  return null;
}

function buildDashboard(candidates, jangEntries) {
  // Attach Jang data to candidates
  const enriched = candidates.map(c => {
    const jang = matchJangToCandidate(c, jangEntries);
    const prices = c.prices || {};
    let betSide = c.grindDetails?.side || (prices.no > prices.yes ? 'NO' : 'YES');
    let betPrice = betSide === 'YES' ? prices.yes : prices.no;

    let jangEdge = null;
    // Override betSide with Jang's direction when available
    if (jang?.direction) {
      betSide = jang.direction;
      betPrice = betSide === 'YES' ? prices.yes : prices.no;
    }

    // Compute fair price (Jang's estimated value on bet side, in cents)
    let fairPrice = null;
    if (jang?.jangPct != null && jang?.direction) {
      // jangPct is the probability for jangSide (e.g., 35% YES)
      // Convert to win% on direction's side (e.g., if jangSide=YES @ 35%, direction=NO → win%=65%)
      const jangWinPct = (jang.jangSide && jang.jangSide !== jang.direction)
        ? (100 - jang.jangPct)
        : jang.jangPct;
      fairPrice = jangWinPct;
      const directionPrice = jang.direction === 'YES' ? (prices.yes || 0) : (prices.no || 0);
      jangEdge = jangWinPct - Math.round(directionPrice * 100);
    } else if (jang?.jangEdge && betPrice) {
      // Infer fair price from edge: fair = market price + edge
      fairPrice = Math.round(betPrice * 100) + jang.jangEdge;
      jangEdge = jang.jangEdge;
    }

    return {
      ...c,
      betSide,
      betPrice,
      fairPrice,
      jang,
      jangEdge,
    };
  });

  // Split into sections
  const jangPicks = enriched.filter(c => c.jang?.source === 'KEO' && c.jang.priority < 99);
  const jangCovered = enriched.filter(c => c.jang?.source === 'TOANBO' || (c.jang?.source === 'KEO' && c.jang.priority >= 99));
  const grindOnly = enriched.filter(c => !c.jang && c.tag === 'GRIND');
  const screeningOnly = enriched.filter(c => !c.jang && c.tag !== 'GRIND');

  // Sort each section
  jangPicks.sort((a, b) => (a.jang?.priority || 99) - (b.jang?.priority || 99));
  jangCovered.sort((a, b) => (b.composite || 0) - (a.composite || 0));
  grindOnly.sort((a, b) => (b.composite || 0) - (a.composite || 0));
  screeningOnly.sort((a, b) => (b.composite || 0) - (a.composite || 0));

  // Dedup: if a market appears in jangPicks, remove from jangCovered
  const pickIds = new Set(jangPicks.map(c => c.id));
  const dedupedCovered = jangCovered.filter(c => !pickIds.has(c.id));

  return { jangPicks, jangCovered: dedupedCovered, grindOnly, screeningOnly, total: enriched.length };
}

function formatDashboard(dashboard) {
  const reportDate = TODAY.toISOString().split('T')[0];
  const jangCount = dashboard.jangPicks.length + dashboard.jangCovered.length;

  // Merge all candidates, compute multi-factor alpha
  const all = [
    ...dashboard.jangPicks,
    ...dashboard.jangCovered,
    ...dashboard.grindOnly,
    ...dashboard.screeningOnly,
  ].map(c => {
    const priceInCents = c.betPrice ? Math.round(c.betPrice * 100) : null;
    const hasJang = !!c.jang;
    const days = c.daysToEnd != null ? c.daysToEnd : 30;
    const timeDecay = Math.min(1, days / 30);

    // ── MULTI-FACTOR ALPHA SCORE ──
    // Alpha = weighted blend of independent signals, each normalized to 0-100 scale
    // Factors:
    //   1. Jang edge: analyst disagrees with market price (strongest signal)
    //   2. GRIND return: annualized capital efficiency for fast-resolve bets
    //   3. Edge score: auto-estimated mispricing from screening layer
    //   4. Correlation group: multiple correlated bets = portfolio hedge opportunity
    //   5. Liquidity quality: volume/liquidity ratio — high ratio = active market

    let jangSignal = 0;
    if (c.fairPrice != null && priceInCents != null) {
      // Direct edge: Jang fair - market price
      jangSignal = Math.max(0, Math.min(100, (c.fairPrice - priceInCents) * 1.5));
    } else if (hasJang && priceInCents != null) {
      // Jang thesis but no exact fair → potential profit if Jang right
      jangSignal = Math.max(0, Math.min(100, (100 - priceInCents) * 0.8));
    }
    jangSignal *= timeDecay; // Jang thesis needs time to materialize

    let grindSignal = 0;
    if (c.grindDetails?.annualized) {
      // Annualized return capped at 1000%, normalized to 0-100
      grindSignal = Math.min(100, c.grindDetails.annualized / 10);
    }

    let edgeSignal = 0;
    if (c.edgeScore != null) {
      // Edge score from screening (already 0-100 scale)
      edgeSignal = Math.min(100, c.edgeScore);
    }

    let corrSignal = 0;
    if (c.correlationGroup) {
      // More correlated markets = more hedge/arb opportunity
      // Count how many markets share this group (approximate from data)
      const groupSize = c.timeSeries?.length || 1;
      corrSignal = Math.min(100, groupSize * 15);
    }

    let liqSignal = 0;
    if (c.volume && c.liquidity && c.liquidity > 0) {
      // Volume/liquidity ratio: high = active trading, good fills
      // Capped lower — liquidity is a qualifier, not an edge
      const ratio = c.volume / c.liquidity;
      liqSignal = Math.min(60, ratio * 8);
    }

    // Weighted blend — Jang & Edge are real edges; GRIND is capital efficiency; LIQ is a qualifier
    const weights = hasJang
      ? { jang: 0.50, grind: 0.15, edge: 0.15, corr: 0.10, liq: 0.10 }
      : { jang: 0.00, grind: 0.30, edge: 0.40, corr: 0.15, liq: 0.15 };

    const rawAlpha = Math.round(
      jangSignal * weights.jang +
      grindSignal * weights.grind +
      edgeSignal * weights.edge +
      corrSignal * weights.corr +
      liqSignal * weights.liq
    );

    // Cap alpha by potential profit — if you can only make 2c, alpha can't be 20
    const potentialProfit = priceInCents != null ? (100 - priceInCents) : 100;
    const alpha = Math.min(rawAlpha, potentialProfit);

    // ── ALPHA TYPE: which advantage is dominant? ──
    // Shows HOW you beat the market on this specific trade
    const signals = [
      { type: 'JANG',  val: jangSignal * weights.jang,  desc: 'Analyst disagrees w/ market' },
      { type: 'GRIND', val: grindSignal * weights.grind, desc: 'High annualized spread return' },
      { type: 'EDGE',  val: edgeSignal * weights.edge,   desc: 'Mispriced vs orderbook' },
      { type: 'CORR',  val: corrSignal * weights.corr,   desc: 'Correlated group hedge/arb' },
      { type: 'LIQ',   val: liqSignal * weights.liq,     desc: 'Active market, good fills' },
    ];
    signals.sort((a, b) => b.val - a.val);
    // Primary alpha type = strongest signal; secondary if close (within 30%)
    const topSignal = signals[0];
    let alphaType = topSignal.type;
    if (signals[1] && signals[1].val > topSignal.val * 0.7 && signals[1].val > 3) {
      alphaType += '+' + signals[1].type;
    }
    if (alpha === 0) alphaType = '-';

    // Conviction = composite (market quality) + alpha bonus
    // Alpha 0-100 → bonus -5 to +30 (only penalizes if alpha = 0 on a Jang market)
    const rawBonus = hasJang
      ? (alpha > 0 ? Math.min(30, alpha * 0.35) : -5)
      : Math.min(15, alpha * 0.2);
    const conviction = Math.round(Math.min(100, (c.composite || 0) + rawBonus));

    return { ...c, alpha, alphaType, hasJang, conviction };
  });

  // Sort: KEO top picks first (by priority), then rest by conviction
  all.sort((a, b) => {
    const aKeo = (a.jang?.source === 'KEO' && a.jang.priority < 99) ? a.jang.priority : 999;
    const bKeo = (b.jang?.source === 'KEO' && b.jang.priority < 99) ? b.jang.priority : 999;
    if (aKeo !== bKeo) return aKeo - bKeo;
    return (b.conviction || 0) - (a.conviction || 0);
  });

  // ── 5-RULE POSITION SIZING ──
  // Count markets per correlation group for Rule 2
  const groupCounts = {};
  all.forEach(c => {
    const g = c.correlationGroup || '_solo_' + c.id;
    groupCounts[g] = (groupCounts[g] || 0) + 1;
  });

  all.forEach(c => {
    const priceInCents = c.betPrice ? Math.round(c.betPrice * 100) : 50;

    // RULE 1: BASE SIZE FROM ALPHA
    // Alpha 30+ → $7K-$10K | 15-30 → $4K-$7K | 5-15 → $2K-$4K | <5 → SKIP
    let baseSize = 0;
    if (c.alpha >= 30) {
      baseSize = 7000 + (MAX_BET - 7000) * Math.min(1, (c.alpha - 30) / 20);
    } else if (c.alpha >= 15) {
      baseSize = 4000 + (7000 - 4000) * ((c.alpha - 15) / 15);
    } else if (c.alpha >= 5) {
      baseSize = MIN_BET + (4000 - MIN_BET) * ((c.alpha - 5) / 10);
    } else {
      baseSize = 0; // Alpha <5 → SKIP
    }

    // RULE 2: CORRELATION DISCOUNT
    // Cap total group exposure at MAX_GROUP_EXPOSURE
    const group = c.correlationGroup || '_solo_' + c.id;
    const groupSize = groupCounts[group] || 1;
    const groupCap = MAX_GROUP_EXPOSURE / groupSize;
    baseSize = Math.min(baseSize, groupCap);

    // RULE 3: LIQUIDITY CAP — never exceed 10% of market liquidity
    if (c.liquidity) {
      baseSize = Math.min(baseSize, c.liquidity * 0.10);
    }

    // RULE 4: DAYS ADJUSTMENT
    const days = c.daysToEnd != null ? c.daysToEnd : 30;
    let daysMult = 1.0;
    if (days < 3) daysMult = 0.5;
    else if (days > 90) daysMult = 0.75;
    baseSize *= daysMult;

    // RULE 5: PRICE-LEVEL ADJUSTMENT
    let priceMult = 1.0;
    if (priceInCents <= 20) priceMult = 0.5;       // Long shots
    else if (priceInCents >= 90) priceMult = 0.75;  // Grinds (tiny profit/share)
    baseSize *= priceMult;

    // Final: round to nearest $100, enforce min/skip
    c.sizeVal = Math.round(baseSize / 100) * 100;
    if (c.sizeVal > 0 && c.sizeVal < MIN_BET) c.sizeVal = MIN_BET;
    if (c.sizeVal > MAX_BET) c.sizeVal = MAX_BET;
  });

  let out = '';
  out += `  TRADING DASHBOARD — ${reportDate}  |  ${all.length} markets  |  Jang: ${jangCount} covered\n`;
  out += '  ═══════════════════════════════════════════════════════════════════════════════════════════════════════════════\n';
  out += '  #   Market                                       Bet  Price  Alpha  Type        Days  Conv     Size  Notes\n';
  out += '  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────\n';

  all.forEach((c, i) => {
    const q = (c.question || '').substring(0, 45).padEnd(45);
    const bet = (c.betSide || '?').padEnd(3);
    const price = c.betPrice ? `${(c.betPrice * 100).toFixed(0)}c`.padStart(4) : '   ?';
    const days = c.daysToEnd != null ? `${c.daysToEnd}d`.padStart(4) : '   ?';
    const conv = String(c.conviction || 0).padStart(3);

    // Alpha column: multi-factor score (0-100)
    const alpha = c.alpha != null ? String(c.alpha).padStart(5) : '    -';

    // Alpha Type: which advantage drives this trade
    const atype = (c.alphaType || '-').padEnd(10);

    // Size from 5-rule framework
    const size = c.sizeVal > 0 ? `$${c.sizeVal.toLocaleString()}`.padStart(7) : '  SKIP';

    // Notes: does market agree or disagree with Jang?
    let notes = '';
    if (c.jang) {
      const bp = c.betPrice ? Math.round(c.betPrice * 100) : 50;
      if (bp < 30) notes = 'Against Jang';
      else if (bp < 60) notes = 'Split';
      else notes = 'Agrees w/ Jang';
    } else {
      notes = (c.correlationGroup || '').substring(0, 25);
    }

    out += `  ${String(i + 1).padStart(2)}  ${q} ${bet} ${price}  ${alpha}  ${atype} ${days}  ${conv}  ${size}  ${notes}\n`;
  });

  out += '  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────\n';
  out += '  Alpha Type: JANG=analyst edge | EDGE=mispriced | GRIND=spread return | CORR=hedge/arb | LIQ=active market\n';

  return out;
}

async function handleDashboard() {
  if (!existsSync('screening_data.json')) {
    console.log('  ERROR: No screening_data.json found. Run screening first: node screener.mjs');
    process.exit(1);
  }

  const data = JSON.parse(readFileSync('screening_data.json', 'utf8'));
  const candidates = data.candidates || [];

  console.log('  Loading Jang analysis...');
  const keoEntries = parseJangKeo();
  const toanBoEntries = parseJangToanBo();
  const allJang = [...keoEntries, ...toanBoEntries];
  console.log(`  Parsed: ${keoEntries.length} picks from KEO + ${toanBoEntries.length} sections from TOAN BO`);

  const dashboard = buildDashboard(candidates, allJang);
  const output = formatDashboard(dashboard);

  console.log(output);

  const reportFile = `DASHBOARD_${TODAY.toISOString().split('T')[0]}.md`;
  writeFileSync(reportFile, output);
  console.log(`\n  Dashboard saved to ${reportFile}`);
}

// ═══════════════════════════════════════════════════════════════════════
// SMM: SMART MONEY METRICS (Automated via Data API)
// ═══════════════════════════════════════════════════════════════════════

const SMM_CACHE = {};

async function fetchWithRetry(url, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    try {
      const resp = await fetch(url);
      if (resp.status === 429) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      if (!resp.ok) return null;
      return resp.json();
    } catch {
      if (i === retries) return null;
      await new Promise(r => setTimeout(r, 500));
    }
  }
  return null;
}

async function fetchTopHolders(conditionId) {
  const url = `${DATA_API}/holders?market=${conditionId}&limit=20`;
  return fetchWithRetry(url);
}

async function fetchUserPositions(address) {
  const url = `${DATA_API}/positions?user=${address}`;
  return fetchWithRetry(url);
}

async function fetchUserValue(address) {
  const url = `${DATA_API}/value?user=${address}`;
  return fetchWithRetry(url);
}

async function fetchUserActivity(address) {
  const url = `${GAMMA_API}/activity?user=${address}&limit=50`;
  return fetchWithRetry(url);
}

function classifyWallet(profile) {
  const { totalPnl, positionCount, portfolioValue, targetMarketPnl } = profile;

  // Use PnL as % of portfolio for relative assessment
  const pnlRatio = portfolioValue > 0 ? totalPnl / portfolioValue : 0;

  // Whale with strong track record (absolute)
  if (totalPnl > 50000 && positionCount > 20) return 'SMART MONEY';
  if (totalPnl > 10000 && positionCount > 30) return 'SMART MONEY';

  // Large portfolio + positive PnL ratio
  if (portfolioValue > 500000 && pnlRatio > -0.05) return 'SMART MONEY';
  if (portfolioValue > 100000 && totalPnl > 5000 && positionCount > 15) return 'SMART MONEY';

  // Moderate positive PnL + experience
  if (totalPnl > 5000 && positionCount > 10) return 'SMART MONEY';
  if (portfolioValue > 50000 && totalPnl > 0 && positionCount > 15) return 'SMART MONEY';

  // Heavily negative PnL relative to portfolio = dumb money
  if (pnlRatio < -0.30 && totalPnl < -10000) return 'DUMB MONEY';
  if (totalPnl < -100000) return 'DUMB MONEY';
  if (totalPnl < -20000 && positionCount < 15) return 'DUMB MONEY';

  // Fresh wallet with big position = insider or gambler
  if (positionCount <= 5 && portfolioValue > 10000) return 'INSIDER/GAMBLER';

  // Large portfolio but mixed results — still has signal weight
  if (portfolioValue > 200000 && positionCount > 30) return 'WHALE (MIXED)';

  return 'NOISE';
}

// ── WALLET PROFILE CACHE ──
// Persists to disk so profiles survive across sessions
const WALLET_CACHE_FILE = 'wallet_cache.json';
const WALLET_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

function loadWalletCache() {
  if (existsSync(WALLET_CACHE_FILE)) {
    try {
      return JSON.parse(readFileSync(WALLET_CACHE_FILE, 'utf8'));
    } catch { return {}; }
  }
  return {};
}

function saveWalletCache(cache) {
  writeFileSync(WALLET_CACHE_FILE, JSON.stringify(cache, null, 2));
}

const walletCache = loadWalletCache();

async function profileWallet(address, pseudonym, targetConditionId = null) {
  // Check cache for base profile (everything except target-market-specific fields)
  const cacheKey = address.toLowerCase();
  const cached = walletCache[cacheKey];
  const now = Date.now();

  let positions;
  let baseProfile;

  if (cached && (now - cached._ts) < WALLET_CACHE_TTL) {
    // Cache hit — reuse base profile, only fetch positions if we need target market data
    baseProfile = cached;
    if (targetConditionId) {
      // Need to look up target market position — fetch positions
      positions = await fetchUserPositions(address);
    }
  } else {
    // Cache miss — fetch positions (no more value endpoint)
    positions = await fetchUserPositions(address);

    const positionCount = Array.isArray(positions) ? positions.length : 0;

    // Compute portfolio value from positions (sum of current value of all positions)
    let portfolioValue = 0;
    let totalPnl = 0;
    let wins = 0;
    let losses = 0;
    const categoryHits = {};

    const cats = [
      [/iran|tehran|irgc|khamenei|persian/i, 'Iran/ME'],
      [/ceasefire|peace|war|conflict|military/i, 'War/Conflict'],
      [/trump|biden|election|president|congress|gop|democrat/i, 'US Politics'],
      [/crypto|bitcoin|btc|eth|solana|defi/i, 'Crypto'],
      [/israel|gaza|hamas|hezbollah|netanyahu/i, 'Israel/Palestine'],
      [/russia|ukraine|putin|zelensky/i, 'Russia/Ukraine'],
      [/oil|gas|energy|opec|hormuz/i, 'Energy/Oil'],
      [/recession|gdp|fed|inflation|economy/i, 'Economy'],
      [/nuclear|weapon|missile/i, 'Nuclear'],
      [/china|taiwan|xi/i, 'China/Asia'],
    ];

    if (Array.isArray(positions)) {
      for (const pos of positions) {
        const pnl = parseFloat(pos.cashPnl || 0) + parseFloat(pos.realizedPnl || 0);
        totalPnl += pnl;

        // Portfolio value: sum current market value of open positions
        const size = parseFloat(pos.size || 0);
        const curPrice = parseFloat(pos.curPrice || pos.currentPrice || 0);
        portfolioValue += size * curPrice;

        // Win/loss tracking
        if (Math.abs(pnl) > 1) {
          if (pnl > 0) wins++;
          else losses++;
        }

        // Expertise
        const slug = (pos.slug || pos.title || pos.question || '').toLowerCase();
        for (const [re, cat] of cats) {
          if (re.test(slug)) {
            categoryHits[cat] = (categoryHits[cat] || 0) + 1;
          }
        }
      }
    }

    const totalBets = wins + losses;
    const winRate = totalBets > 0 ? Math.round((wins / totalBets) * 100) : null;
    const expertise = Object.entries(categoryHits)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([cat, count]) => `${cat} (${count})`);

    baseProfile = {
      address,
      pseudonym: pseudonym || address.substring(0, 10) + '...',
      positionCount,
      portfolioValue,
      totalPnl,
      winRate,
      wins,
      losses,
      expertise,
      _ts: now,
    };

    // Save to cache
    walletCache[cacheKey] = baseProfile;
    saveWalletCache(walletCache);
  }

  // Extract target market data from positions (always fresh, not cached)
  let targetMarketPnl = 0;
  let targetMarketAvgPrice = 0;
  let targetMarketSize = 0;
  let targetMarketSide = null;

  if (targetConditionId && Array.isArray(positions)) {
    for (const pos of positions) {
      if (pos.conditionId === targetConditionId) {
        targetMarketPnl = parseFloat(pos.cashPnl || 0) + parseFloat(pos.realizedPnl || 0);
        targetMarketAvgPrice = parseFloat(pos.avgPrice || 0);
        targetMarketSize = parseFloat(pos.size || 0);
        targetMarketSide = pos.outcome || (pos.outcomeIndex === 0 ? 'Yes' : 'No');
        break;
      }
    }
  }

  return {
    ...baseProfile,
    targetMarketPnl,
    targetMarketAvgPrice,
    targetMarketSize,
    targetMarketSide,
  };
}

async function runSMMReport(market) {
  const conditionId = market.conditionId;
  if (!conditionId) {
    console.log('  ERROR: No conditionId for this market. Cannot fetch holders.');
    return null;
  }

  console.log(`\n  Fetching top holders for: ${market.question}`);
  console.log(`  Condition ID: ${conditionId}`);

  const holdersData = await fetchTopHolders(conditionId);
  if (!holdersData || !Array.isArray(holdersData) || holdersData.length === 0) {
    console.log('  ERROR: Could not fetch holders data. API may be down or conditionId invalid.');
    return null;
  }

  // Parse holders into YES/NO sides
  const yesSide = [];
  const noSide = [];

  function makeHolderEntry(h) {
    return {
      address: h.proxyWallet || h.address || '',
      name: h.name || '',
      pseudonym: h.pseudonym || h.name || (h.proxyWallet || '').substring(0, 12) + '...',
      amount: parseFloat(h.amount) || 0,
      outcomeIndex: h.outcomeIndex,
    };
  }

  // Split by outcomeIndex: 0 = YES, 1 = NO
  for (const tokenGroup of holdersData) {
    const holders = tokenGroup.holders || [];
    for (const h of holders) {
      const entry = makeHolderEntry(h);
      if (h.outcomeIndex === 0) {
        yesSide.push(entry);
      } else {
        noSide.push(entry);
      }
    }
  }

  // Fallback: if outcomeIndex wasn't present, use array position (first group = YES, second = NO)
  if (yesSide.length === 0 && noSide.length === 0 && holdersData.length >= 2) {
    for (const h of (holdersData[0]?.holders || [])) yesSide.push(makeHolderEntry(h));
    for (const h of (holdersData[1]?.holders || [])) noSide.push(makeHolderEntry(h));
  }

  // Sort by amount
  yesSide.sort((a, b) => b.amount - a.amount);
  noSide.sort((a, b) => b.amount - a.amount);

  const yesTotalShares = yesSide.reduce((s, h) => s + h.amount, 0);
  const noTotalShares = noSide.reduce((s, h) => s + h.amount, 0);
  const dominantSide = yesTotalShares >= noTotalShares ? 'YES' : 'NO';
  const ratio = dominantSide === 'YES'
    ? (yesTotalShares / (noTotalShares || 1)).toFixed(1)
    : (noTotalShares / (yesTotalShares || 1)).toFixed(1);

  // Profile top wallets from each side (parallel)
  console.log('  Profiling top wallets...');
  const topYes = yesSide.slice(0, 4);
  const topNo = noSide.slice(0, 4);
  const allToProfile = [...topYes, ...topNo];

  const profiles = await Promise.all(
    allToProfile.map(h => profileWallet(h.address, h.pseudonym, conditionId))
  );

  // Merge profile data back
  const profileMap = {};
  for (const p of profiles) {
    profileMap[p.address] = p;
  }

  function enrichHolder(h) {
    const p = profileMap[h.address] || {};
    const classification = classifyWallet({
      totalPnl: p.totalPnl || 0,
      positionCount: p.positionCount || 0,
      portfolioValue: p.portfolioValue || 0,
    });
    return {
      ...h,
      ...p,
      displayName: h.name || h.pseudonym,
      classification,
    };
  }

  const enrichedYes = topYes.map(enrichHolder);
  const enrichedNo = topNo.map(enrichHolder);

  // Determine smart money side using weighted scoring
  const smartTypes = ['SMART MONEY', 'WHALE (MIXED)'];
  const yesSmartCount = enrichedYes.filter(h => smartTypes.includes(h.classification)).length;
  const noSmartCount = enrichedNo.filter(h => smartTypes.includes(h.classification)).length;
  const yesSmartPnl = enrichedYes.filter(h => smartTypes.includes(h.classification)).reduce((s, h) => s + (h.totalPnl || 0), 0);
  const noSmartPnl = enrichedNo.filter(h => smartTypes.includes(h.classification)).reduce((s, h) => s + (h.totalPnl || 0), 0);

  // Also look at aggregate market-specific PnL (who's winning on THIS market)
  const yesMktPnl = enrichedYes.reduce((s, h) => s + (h.targetMarketPnl || 0), 0);
  const noMktPnl = enrichedNo.reduce((s, h) => s + (h.targetMarketPnl || 0), 0);

  let smartMoneySide;
  if (noSmartCount > yesSmartCount + 1) smartMoneySide = 'NO';
  else if (yesSmartCount > noSmartCount + 1) smartMoneySide = 'YES';
  else if (noSmartCount > yesSmartCount) smartMoneySide = noMktPnl > yesMktPnl ? 'NO' : 'YES';
  else if (yesSmartCount > noSmartCount) smartMoneySide = yesMktPnl > noMktPnl ? 'YES' : 'NO';
  else smartMoneySide = noMktPnl > yesMktPnl ? 'NO' : 'YES'; // Tie-break by market PnL

  // Determine recommended side based on screening + SMM
  const prices = market.prices || parseOutcomePrices(market);
  const screeningSide = market.grindDetails?.side || (prices && prices.no > prices.yes ? 'NO' : 'YES');

  const smmConfirms = smartMoneySide === screeningSide;

  // Build report
  const report = {
    market: market.question,
    conditionId,
    date: TODAY.toISOString().split('T')[0],
    prices,
    volume: market.volume || market.volumeNum || 0,
    yesSide: { totalShares: yesTotalShares, holders: enrichedYes },
    noSide: { totalShares: noTotalShares, holders: enrichedNo },
    dominantSide,
    dominantRatio: ratio,
    smartMoneySide,
    screeningSide,
    smmConfirms,
    yesSmartCount,
    noSmartCount,
    yesMktPnl,
    noMktPnl,
    tier: market.tier || getTier(market.composite || market._composite || 0),
    tag: market.tag || market._tag,
    composite: market.composite || market._composite,
  };

  return report;
}

function formatSMMReport(report) {
  if (!report) return '  No data available.\n';

  const p = report.prices || {};
  const yesP = ((p.yes || 0) * 100).toFixed(1);
  const noP = ((p.no || 0) * 100).toFixed(1);

  let out = '';
  out += '\n═══════════════════════════════════════════════════════════\n';
  out += `  SMM REPORT: ${report.market}\n`;
  out += `  Date: ${report.date} | Screening: ${report.tier} (${report.tag}) | Composite: ${report.composite}\n`;
  out += '═══════════════════════════════════════════════════════════\n\n';

  out += '  MARKET DATA\n';
  out += `    YES price: ${yesP}c | NO price: ${noP}c\n`;
  out += `    Volume: $${Math.round(report.volume).toLocaleString()}\n\n`;

  out += '  HOLDER DISTRIBUTION (Top 20)\n';
  out += `    YES total shares: ${Math.round(report.yesSide.totalShares).toLocaleString()}\n`;
  out += `    NO total shares:  ${Math.round(report.noSide.totalShares).toLocaleString()}\n`;
  out += `    Dominant side: ${report.dominantSide} by ${report.dominantRatio}x\n\n`;

  function formatHolder(h) {
    let rawName = h.displayName || h.pseudonym || '';
    // Truncate long hex addresses
    if (rawName.length > 20) rawName = rawName.substring(0, 18) + '..';
    const name = rawName.padEnd(22);
    const shares = Math.round(h.amount).toLocaleString().padStart(12);
    const totalPnlVal = h.totalPnl || 0;
    const totalPnlStr = totalPnlVal >= 0
      ? `+$${Math.round(totalPnlVal).toLocaleString()}`
      : `-$${Math.round(Math.abs(totalPnlVal)).toLocaleString()}`;
    const mktPnlVal = h.targetMarketPnl || 0;
    const mktPnlStr = mktPnlVal >= 0
      ? `+$${Math.round(mktPnlVal).toLocaleString()}`
      : `-$${Math.round(Math.abs(mktPnlVal)).toLocaleString()}`;
    const avgEntry = h.targetMarketAvgPrice
      ? `${(h.targetMarketAvgPrice * 100).toFixed(1)}c`
      : '?';
    const portStr = h.portfolioValue
      ? `$${Math.round(h.portfolioValue).toLocaleString()}`
      : '?';

    // Win rate
    const winRateStr = h.winRate != null ? `${h.winRate}% (${h.wins}W/${h.losses}L)` : '?';

    // Expertise
    const expertiseStr = h.expertise && h.expertise.length > 0 ? h.expertise.join(', ') : 'Mixed';

    let line = `    ${name} ${shares} shares  [${h.classification}]\n`;
    line += `      → Portfolio: ${portStr} | ${h.positionCount || 0} positions | Total PnL: ${totalPnlStr}\n`;
    line += `      → Win rate: ${winRateStr} | Expertise: ${expertiseStr}\n`;
    if (h.targetMarketAvgPrice) {
      line += `      → This market: avg entry ${avgEntry}, PnL ${mktPnlStr}\n`;
    }
    return line;
  }

  // YES side wallets
  out += '  TOP YES HOLDERS\n';
  for (const h of report.yesSide.holders) {
    out += formatHolder(h);
  }

  out += '\n  TOP NO HOLDERS\n';
  for (const h of report.noSide.holders) {
    out += formatHolder(h);
  }

  // Verdict
  const fmtPnl = v => v >= 0 ? `+$${Math.round(v).toLocaleString()}` : `-$${Math.round(Math.abs(v)).toLocaleString()}`;

  out += '\n  ─────────────────────────────────────────────────\n';
  out += '  SMART MONEY VERDICT\n';
  out += `    Smart/whale wallets: YES ${report.yesSmartCount} | NO ${report.noSmartCount}\n`;
  out += `    Market PnL (top holders): YES ${fmtPnl(report.yesMktPnl)} | NO ${fmtPnl(report.noMktPnl)}\n`;
  out += `    Smart money favors: ${report.smartMoneySide}\n`;
  out += `    Screening suggests: ${report.screeningSide}\n`;
  const confirmStr = report.smmConfirms ? 'CONFIRMED — SMM aligns with screening' : 'CONFLICT — SMM disagrees with screening';
  out += `    Verdict: ${confirmStr}\n`;
  out += '  ─────────────────────────────────────────────────\n';

  // TRADE RECOMMENDATION: entry, target, stoploss
  const side = report.smartMoneySide;
  const currentPrice = side === 'YES' ? (p.yes || 0) : (p.no || 0);
  const currentPriceCents = Math.round(currentPrice * 100);

  // Smart money avg entry on the recommended side
  const sideHolders = side === 'YES' ? report.yesSide.holders : report.noSide.holders;
  const smartHolders = sideHolders.filter(h => ['SMART MONEY', 'WHALE (MIXED)'].includes(h.classification));
  const allSideHolders = sideHolders.filter(h => h.targetMarketAvgPrice > 0);

  // Smart money avg entry (weighted by shares)
  let smartAvgEntry = null;
  if (smartHolders.length > 0) {
    const totalShares = smartHolders.reduce((s, h) => s + h.amount, 0);
    smartAvgEntry = smartHolders.reduce((s, h) => s + (h.targetMarketAvgPrice || 0) * h.amount, 0) / (totalShares || 1);
  }

  // All holders avg entry (for reference)
  let allAvgEntry = null;
  if (allSideHolders.length > 0) {
    const totalShares = allSideHolders.reduce((s, h) => s + h.amount, 0);
    allAvgEntry = allSideHolders.reduce((s, h) => s + (h.targetMarketAvgPrice || 0) * h.amount, 0) / (totalShares || 1);
  }

  // Entry price: buy at or below smart money avg entry (if available), else current price
  const entryPrice = smartAvgEntry
    ? Math.min(currentPriceCents, Math.round(smartAvgEntry * 100))
    : currentPriceCents;

  // Target price: for active exit traders — take profit at 85-90% of max (don't hold to resolution)
  // If current price is already high (>85c), target is 95c
  const targetPrice = currentPriceCents >= 85 ? 95 : Math.min(95, currentPriceCents + Math.round((100 - currentPriceCents) * 0.7));

  // Stoploss: if price drops below entry by more than the potential profit, cut losses
  // Risk:reward at least 1:2 — stoploss = entry - (target - entry) / 2
  const potentialProfit = targetPrice - entryPrice;
  const stopDistance = Math.max(5, Math.round(potentialProfit / 2)); // min 5c stop
  const stoplossPrice = Math.max(1, entryPrice - stopDistance);

  out += '\n  TRADE RECOMMENDATION\n';
  out += `    Side: ${side}\n`;
  out += `    Current price: ${currentPriceCents}c\n`;
  if (smartAvgEntry) {
    out += `    Smart money avg entry: ${Math.round(smartAvgEntry * 100)}c\n`;
  }
  out += `    Recommended entry: ${entryPrice}c (limit order)\n`;
  out += `    Target price: ${targetPrice}c (take profit — active exit)\n`;
  out += `    Stoploss: ${stoplossPrice}c (cut loss — ${stopDistance}c risk for ${potentialProfit}c reward, R:R 1:${(potentialProfit / stopDistance).toFixed(1)})\n`;

  // Position size from dashboard rules
  out += '  ─────────────────────────────────────────────────\n';

  return out;
}

function findMarketByQuery(candidates, query) {
  // Try exact number match first (candidate #N)
  const num = parseInt(query);
  if (!isNaN(num) && num >= 1 && num <= candidates.length) {
    return candidates[num - 1];
  }

  // Fuzzy text match
  const q = query.toLowerCase();
  const matches = candidates.filter(c => {
    const text = (c.question || '').toLowerCase();
    return q.split(/\s+/).every(word => text.includes(word));
  });

  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    console.log(`  Multiple matches found:`);
    matches.forEach((m, i) => console.log(`    ${i + 1}. ${m.question}`));
    console.log(`  Using first match.`);
    return matches[0];
  }

  console.log(`  No market found matching "${query}". Available candidates:`);
  candidates.slice(0, 10).forEach((c, i) => console.log(`    ${i + 1}. ${c.question}`));
  return null;
}

async function handleSMMCommand(args) {
  // Load screening data
  if (!existsSync('screening_data.json')) {
    console.log('  ERROR: No screening_data.json found. Run a screening first.');
    process.exit(1);
  }
  const data = JSON.parse(readFileSync('screening_data.json', 'utf8'));
  const candidates = data.candidates || [];

  if (candidates.length === 0) {
    console.log('  ERROR: No candidates in screening data.');
    process.exit(1);
  }

  const smmAllMode = args.includes('--smm-all');

  if (smmAllMode) {
    // Run SMM on all S-TIER and A-TIER candidates (best per correlation group)
    const targetTiers = ['S-TIER', 'A-TIER'];
    const grouped = {};
    for (const c of candidates) {
      if (!targetTiers.includes(c.tier)) continue;
      const group = c.correlationGroup || 'Z';
      if (!grouped[group] || c.composite > grouped[group].composite) {
        grouped[group] = c;
      }
    }
    const targets = Object.values(grouped);
    console.log(`\n  Running SMM on ${targets.length} markets (best per correlation group)...\n`);

    let allReports = '';
    for (const market of targets) {
      const report = await runSMMReport(market);
      const formatted = formatSMMReport(report);
      console.log(formatted);
      allReports += formatted;
      // Small delay between markets to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    }

    const reportFile = `SMM_REPORT_${TODAY.toISOString().split('T')[0]}.md`;
    writeFileSync(reportFile, allReports);
    console.log(`\n  All SMM reports saved to ${reportFile}`);
    return;
  }

  // Single market mode
  const smmIdx = args.indexOf('--smm');
  const query = args[smmIdx + 1];
  if (!query) {
    console.log('  Usage: node screener.mjs --smm "search term" or --smm <number>');
    console.log('  Available candidates:');
    candidates.slice(0, 15).forEach((c, i) => console.log(`    ${i + 1}. [${c.tier}] ${c.question}`));
    process.exit(1);
  }

  const market = findMarketByQuery(candidates, query);
  if (!market) process.exit(1);

  const report = await runSMMReport(market);
  const formatted = formatSMMReport(report);
  console.log(formatted);

  const reportFile = `SMM_REPORT_${TODAY.toISOString().split('T')[0]}.md`;
  writeFileSync(reportFile, formatted);
  console.log(`\n  Report saved to ${reportFile}`);
}

// ═══════════════════════════════════════════════════════════════════════
// MAIN PIPELINE
// ═══════════════════════════════════════════════════════════════════════

async function main() {
  const args = process.argv.slice(2);

  // Handle dashboard command
  if (args.includes('--dashboard')) {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  POLYMARKET TRADING DASHBOARD — Screening + Jang     ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    await handleDashboard();
    return;
  }

  // Handle SMM commands before screening
  if (args.includes('--smm') || args.includes('--smm-all')) {
    console.log('╔══════════════════════════════════════════════════════╗');
    console.log('║  POLYMARKET SMM — Smart Money Metrics (Automated)    ║');
    console.log('╚══════════════════════════════════════════════════════╝');
    await handleSMMCommand(args);
    return;
  }

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

  // Automatically run dashboard after screening
  console.log('\n╔══════════════════════════════════════════════════════╗');
  console.log('║  TRADING DASHBOARD — Screening + Jang Analysis       ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  await handleDashboard();
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
