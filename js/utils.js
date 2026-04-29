/**
 * utils.js — shared constants and helpers
 */

// ── Constants ──────────────────────────────────────────────────────────────

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
 * Given a scorecard (scraped or CricAPI) and the master players array,
 * returns an object keyed by player name: { [name]: { runs, wickets, points } }
 * Supports both scraped format (innings[].batting/bowling) and CricAPI format (scorecard[]).
 */
function calcPoints(scorecardData, players) {
  const result = {};

  // Build name lookup: normalised name → player
  const playerByName = {};
  for (const p of players) {
    playerByName[normName(p.name)] = p;
  }

  // Support both scraped format and CricAPI format
  const innings = scorecardData?.innings ?? scorecardData?.scorecard ?? [];

  for (const inn of innings) {
    // Batting: 1 run = 1 pt
    for (const batter of (inn.batting ?? [])) {
      const name = batter?.name ?? batter?.batsman?.name ?? '';
      const player = findPlayer(name, playerByName);
      if (!player) continue;
      const key = player.name;
      if (!result[key]) result[key] = { runs: 0, wickets: 0, points: 0 };
      const runs = Number(batter.r) || 0;
      result[key].runs += runs;
      result[key].points += runs;
    }

    // Bowling: 1 wicket = 25 pts
    for (const bowler of (inn.bowling ?? [])) {
      const name = bowler?.name ?? bowler?.bowler?.name ?? '';
      const player = findPlayer(name, playerByName);
      if (!player) continue;
      const key = player.name;
      if (!result[key]) result[key] = { runs: 0, wickets: 0, points: 0 };
      const wkts = Number(bowler.w) || 0;
      result[key].wickets += wkts;
      result[key].points += wkts * 25;
    }
  }

  return result;
}

/** Normalise a name for matching: lowercase, remove dots/hyphens/extra spaces */
function normName(s) {
  return String(s ?? '').toLowerCase().replace(/[.\-']/g, '').replace(/\s+/g, ' ').trim();
}

/** Find a player in the lookup by exact normalised name match only.
 *  No fuzzy matching — all fantasy player names must match ESPNCricinfo exactly. */
function findPlayer(scrapedName, playerByName) {
  return playerByName[normName(scrapedName)] ?? null;
}

/**
 * Aggregate points across multiple scorecards for a single team's player list.
 * If topN is set, only the top N players by points are counted toward team totals.
 * Returns { totalPoints, totalRuns, totalWickets, top15Points, playerStats: [{...player, runs, wickets, points, inTop15}] }
 */
function aggregateTeamPoints(teamPlayers, allScorecardPoints, topN = 0) {
  const playerStats = teamPlayers.map(p => {
    const s = allScorecardPoints[p.name] ?? allScorecardPoints[p.cricApiPlayerId] ?? { runs: 0, wickets: 0, points: 0 };
    return { ...p, runs: s.runs, wickets: s.wickets, points: s.points };
  });

  // Sort by points desc to determine top N
  const sorted = [...playerStats].sort((a, b) => b.points - a.points);
  const topSet = new Set(sorted.slice(0, topN || playerStats.length).map(p => p.name));

  let totalPoints = 0, totalRuns = 0, totalWickets = 0;
  let top15Points = 0;

  for (const p of playerStats) {
    totalPoints  += p.points;
    totalRuns    += p.runs;
    totalWickets += p.wickets;
    p.inTop15 = topSet.has(p.name);
    if (p.inTop15) top15Points += p.points;
  }

  return { totalPoints, totalRuns, totalWickets, top15Points, playerStats };
}

// ── Caching Helpers ────────────────────────────────────────────────────────

/** Fetch JSON from a URL. */
async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.json();
}

/**
 * Fetch a match scorecard from static file only.
 */
async function fetchScorecard(matchId) {
  try {
    const res = await fetch(`data/scorecards/${matchId}.json`);
    if (res.ok) return await res.json();
  } catch (e) {}
  return null;
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
