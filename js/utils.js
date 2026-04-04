/**
 * utils.js — shared constants and helpers
 */

// ── Constants ──────────────────────────────────────────────────────────────
// Fill this in after calling /api/series-info and finding the IPL 2026 series.
// Run the site once, open DevTools > Network, look for the series-info response,
// find the entry whose name contains "Indian Premier League" or "IPL 2026", copy its id.
const IPL_SERIES_ID = '87c62aac-bc3c-4738-ab93-19da0690488f'; // IPL 2026

const TEAM_NAMES = {
  'dk':             'DK',
  'anand':          'Anand',
  'shash':          'Shash',
  'naveen-sujeeth': 'Naveen & Sujeeth',
  'roshan':         'Roshan',
  'yesh':           'Yesh',
  'siddharth':      'Siddharth',
  'na':             'NA',
};

const ALL_TEAM_IDS = Object.keys(TEAM_NAMES);

const ROLE_BADGE = {
  'Batsman':    { cls: 'bg-primary',   icon: 'bi-bat' },
  'Bowler':     { cls: 'bg-success',   icon: 'bi-record-circle' },
  'All-Rounder':{ cls: 'bg-warning text-dark', icon: 'bi-stars' },
  'Wkt Keeper': { cls: 'bg-purple',    icon: 'bi-shield-fill' },
};

// ── Points Calculation ─────────────────────────────────────────────────────

/**
 * Given a CricAPI scorecard response and the master players array,
 * returns an object: { [cricApiPlayerId]: { runs, wickets, points } }
 */
function calcPoints(scorecardData, players) {
  const result = {};

  // Build a quick lookup: cricApiPlayerId → player
  const playerById = {};
  for (const p of players) {
    if (p.cricApiPlayerId) playerById[p.cricApiPlayerId] = p;
  }

  const innings = scorecardData?.scorecard ?? [];

  for (const inn of innings) {
    // Batting: 1 run = 1 pt
    for (const batter of (inn.batting ?? [])) {
      const pid = batter?.batsman?.id;
      if (!pid || !playerById[pid]) continue;
      if (!result[pid]) result[pid] = { runs: 0, wickets: 0, points: 0 };
      const runs = Number(batter.r) || 0;
      result[pid].runs += runs;
      result[pid].points += runs;
    }

    // Bowling: 1 wicket = 25 pts
    for (const bowler of (inn.bowling ?? [])) {
      const pid = bowler?.bowler?.id;
      if (!pid || !playerById[pid]) continue;
      if (!result[pid]) result[pid] = { runs: 0, wickets: 0, points: 0 };
      const wkts = Number(bowler.w) || 0;
      result[pid].wickets += wkts;
      result[pid].points += wkts * 25;
    }
  }

  return result;
}

/**
 * Aggregate points across multiple scorecards for a single team's player list.
 * Returns { totalPoints, totalRuns, totalWickets, playerStats: [{...player, runs, wickets, points}] }
 */
function aggregateTeamPoints(teamPlayers, allScorecardPoints) {
  let totalPoints = 0, totalRuns = 0, totalWickets = 0;
  const playerStats = teamPlayers.map(p => {
    const s = allScorecardPoints[p.cricApiPlayerId] ?? { runs: 0, wickets: 0, points: 0 };
    totalPoints  += s.points;
    totalRuns    += s.runs;
    totalWickets += s.wickets;
    return { ...p, runs: s.runs, wickets: s.wickets, points: s.points };
  });
  return { totalPoints, totalRuns, totalWickets, playerStats };
}

// ── Caching Helpers ────────────────────────────────────────────────────────

const SESSION_TTL_MS  = 10 * 60 * 1000;  // 10 min — for live match data
const SERIES_INFO_KEY = 'ipl_series_info';
const SERIES_INFO_TS  = 'ipl_series_info_ts';

/** Fetch JSON from a URL, with optional sessionStorage caching (TTL in ms). */
async function fetchJSON(url, cacheTTL = 0) {
  if (cacheTTL > 0) {
    const cached = sessionStorage.getItem(url);
    const ts     = Number(sessionStorage.getItem(url + '_ts') || 0);
    if (cached && Date.now() - ts < cacheTTL) {
      return JSON.parse(cached);
    }
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const data = await res.json();
  if (cacheTTL > 0) {
    sessionStorage.setItem(url, JSON.stringify(data));
    sessionStorage.setItem(url + '_ts', String(Date.now()));
  }
  return data;
}

/**
 * Fetch a match scorecard.
 * Priority: 1) localStorage cache  2) static file in data/scorecards/  3) API call
 * Completed matches are cached permanently. Only live matches hit the API.
 */
async function fetchScorecard(matchId) {
  // 1. Check localStorage (browser cache from previous visits)
  const lsKey = `sc_${matchId}`;
  const cached = localStorage.getItem(lsKey);
  if (cached) {
    const parsed = JSON.parse(cached);
    if (parsed._completed) return parsed;
  }

  // 2. Try static cached file (committed to repo — 0 API calls)
  try {
    const staticData = await fetch(`data/scorecards/${matchId}.json`);
    if (staticData.ok) {
      const sc = await staticData.json();
      sc._completed = true;
      localStorage.setItem(lsKey, JSON.stringify(sc));
      return sc;
    }
  } catch (e) { /* static file doesn't exist, fall through to API */ }

  // 3. Live API call (only for matches not yet cached)
  try {
    const data = await fetchJSON(`/api/scorecard?matchId=${matchId}`);
    const sc = data?.data ?? data;

    if (sc?.matchEnded === true || sc?.status?.toLowerCase?.().includes('won')) {
      sc._completed = true;
      localStorage.setItem(lsKey, JSON.stringify(sc));
    }
    return sc;
  } catch (e) {
    console.warn(`Could not fetch scorecard for ${matchId}:`, e.message);
    return null;
  }
}

/** Fetch all IPL 2026 match IDs and their statuses from the series info endpoint. */
async function fetchSeriesMatches() {
  if (!IPL_SERIES_ID) return [];
  try {
    const data = await fetchJSON(`/api/series-info?seriesId=${IPL_SERIES_ID}`, SESSION_TTL_MS);
    if (data?.status === 'failure') {
      console.warn('Series API blocked:', data.reason);
      // Fall back to static match list if API is rate-limited
      try {
        const fallback = await fetch('data/matches.json');
        if (fallback.ok) return await fallback.json();
      } catch (e) {}
      return [];
    }
    return data?.data?.matchList ?? [];
  } catch (e) {
    console.warn('Series fetch error:', e.message);
    try {
      const fallback = await fetch('data/matches.json');
      if (fallback.ok) return await fallback.json();
    } catch (e2) {}
    return [];
  }
}

// ── Formatting ─────────────────────────────────────────────────────────────

function fmtCr(lakhs) {
  return (lakhs / 100).toFixed(2) + ' Cr';
}

function roleBadge(role) {
  const r = ROLE_BADGE[role] ?? { cls: 'bg-secondary', icon: 'bi-person' };
  return `<span class="badge ${r.cls} role-badge"><i class="bi ${r.icon} me-1"></i>${role}</span>`;
}

function rankIcon(rank) {
  if (rank === 1) return '<i class="bi bi-trophy-fill text-warning me-1"></i>';
  if (rank === 2) return '<i class="bi bi-award-fill text-secondary me-1"></i>';
  if (rank === 3) return '<i class="bi bi-award text-danger me-1"></i>';
  return `<span class="text-muted">${rank}</span>`;
}

function setLastUpdated() {
  const el = document.getElementById('last-updated');
  if (el) el.textContent = 'Updated ' + new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
}
