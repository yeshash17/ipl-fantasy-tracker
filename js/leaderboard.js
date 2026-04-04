/**
 * leaderboard.js — loads all team data + scorecards, computes standings, live-polls
 */

const POLL_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

let allPlayers = [];
let teamsData  = [];
let liveMatchIds = [];

// Merged points across all matches: { cricApiPlayerId: { runs, wickets, points } }
let globalPlayerPoints = {};

async function init() {
  try {
    // Load master player list and all team JSONs in parallel
    const [players, ...teams] = await Promise.all([
      fetchJSON('data/players.json'),
      ...ALL_TEAM_IDS.map(id => fetchJSON(`data/teams/${id}.json`))
    ]);

    allPlayers = players;
    teamsData  = teams.filter(t => t && t.players?.length > 0);

    // Fetch match list and scorecards
    await loadAllScorecards();

    // Render
    renderLeaderboard();
    renderTopPerformers();
    setLastUpdated();

    document.getElementById('loading').classList.add('d-none');
    document.getElementById('leaderboard-section').classList.remove('d-none');

    // Start live polling if there are live matches
    if (liveMatchIds.length > 0) {
      document.getElementById('live-badge').classList.remove('d-none');
      schedulePoll();
    }

  } catch (err) {
    document.getElementById('loading').classList.add('d-none');
    showError('Could not load data: ' + err.message);
    console.error(err);
  }
}

async function loadAllScorecards() {
  globalPlayerPoints = {};

  // 1. Try loading scraped scorecards from manifest (no API needed)
  let manifest = [];
  try {
    manifest = await fetchJSON('data/scorecards/manifest.json');
  } catch (e) {
    console.warn('No scraped scorecard manifest found:', e.message);
  }

  if (manifest.length > 0) {
    // Load all scraped scorecards in parallel
    const scorecards = await Promise.allSettled(
      manifest.map(id => fetchJSON(`data/scorecards/${id}.json`))
    );

    for (const result of scorecards) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const pts = calcPoints(result.value, allPlayers);
      for (const [name, stat] of Object.entries(pts)) {
        if (!globalPlayerPoints[name]) globalPlayerPoints[name] = { runs: 0, wickets: 0, points: 0 };
        globalPlayerPoints[name].runs     += stat.runs;
        globalPlayerPoints[name].wickets  += stat.wickets;
        globalPlayerPoints[name].points   += stat.points;
      }
    }
  }

  // 2. Also try CricAPI for any live matches (if series ID is set)
  if (IPL_SERIES_ID) {
    try {
      const matches = await fetchSeriesMatches();
      liveMatchIds = [];
      for (const match of matches) {
        if (match.matchStarted && !match.matchEnded) {
          liveMatchIds.push(match.id);
        }
      }
      // Only fetch live matches from API (completed ones come from scraped files)
      const liveScorecards = await Promise.allSettled(
        liveMatchIds.map(id => fetchScorecard(id))
      );
      for (const result of liveScorecards) {
        if (result.status !== 'fulfilled' || !result.value) continue;
        const pts = calcPoints(result.value, allPlayers);
        for (const [name, stat] of Object.entries(pts)) {
          if (!globalPlayerPoints[name]) globalPlayerPoints[name] = { runs: 0, wickets: 0, points: 0 };
          globalPlayerPoints[name].runs     += stat.runs;
          globalPlayerPoints[name].wickets  += stat.wickets;
          globalPlayerPoints[name].points   += stat.points;
        }
      }
    } catch (e) {
      console.warn('CricAPI unavailable:', e.message);
    }
  }
}

function renderLeaderboard() {
  const rows = teamsData.map(team => {
    const { totalPoints } = aggregateTeamPoints(team.players, globalPlayerPoints);
    return { team, totalPoints };
  });

  rows.sort((a, b) => b.totalPoints - a.totalPoints);

  const tbody = document.getElementById('leaderboard-body');
  tbody.innerHTML = rows.map((row, i) => {
    const rank = i + 1;
    const t = row.team;
    const spentCr = (t.budgetSpent / 100).toFixed(1);
    const leftCr  = ((t.budgetTotal - t.budgetSpent) / 100).toFixed(1);
    const teamUrl = `teams.html?team=${t.teamId}`;

    const rowClass = rank === 1 ? 'table-warning' : '';

    return `
      <tr class="${rowClass}">
        <td class="ps-3 fw-bold">${rankIcon(rank)}</td>
        <td>
          <a href="${teamUrl}" class="fw-semibold text-decoration-none text-dark">${t.teamName}</a>
          <div class="text-muted small d-md-none">${t.players.length} players · ${spentCr} Cr</div>
        </td>
        <td class="text-end fw-bold fs-5 text-primary">${row.totalPoints.toLocaleString()}</td>
        <td class="text-end d-none d-md-table-cell text-muted">${liveMatchIds.length > 0 ? '<span class="badge bg-danger">LIVE</span>' : '—'}</td>
        <td class="text-end d-none d-md-table-cell">${t.players.length}</td>
        <td class="text-end pe-3 d-none d-sm-table-cell text-muted">${spentCr} Cr</td>
      </tr>`;
  }).join('');
}

function renderTopPerformers() {
  // Combine player data with points
  const enriched = allPlayers
    .filter(p => p.cricApiPlayerId && globalPlayerPoints[p.cricApiPlayerId])
    .map(p => ({
      ...p,
      ...globalPlayerPoints[p.cricApiPlayerId]
    }));

  // Top 5 run scorers
  const topBatters = [...enriched].sort((a, b) => b.runs - a.runs).slice(0, 5);
  document.getElementById('top-batters').innerHTML = topBatters.length
    ? topBatters.map((p, i) => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <div>
            <span class="text-muted me-2">${i + 1}.</span>
            <strong>${p.name}</strong>
            <span class="text-muted small ms-2">${TEAM_NAMES[p.team] ?? p.team}</span>
          </div>
          <span class="badge bg-primary rounded-pill">${p.runs} runs</span>
        </li>`).join('')
    : '<li class="list-group-item text-muted">No data yet</li>';

  // Top 5 wicket takers
  const topBowlers = [...enriched].sort((a, b) => b.wickets - a.wickets).slice(0, 5);
  document.getElementById('top-bowlers').innerHTML = topBowlers.length
    ? topBowlers.map((p, i) => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <div>
            <span class="text-muted me-2">${i + 1}.</span>
            <strong>${p.name}</strong>
            <span class="text-muted small ms-2">${TEAM_NAMES[p.team] ?? p.team}</span>
          </div>
          <span class="badge bg-danger rounded-pill">${p.wickets} wkts</span>
        </li>`).join('')
    : '<li class="list-group-item text-muted">No data yet</li>';
}

function schedulePoll() {
  setTimeout(async () => {
    try {
      await loadAllScorecards();
      renderLeaderboard();
      renderTopPerformers();
      setLastUpdated();

      // Stop polling if no more live matches
      if (liveMatchIds.length === 0) {
        document.getElementById('live-badge').classList.add('d-none');
        return;
      }
    } catch (e) {
      console.warn('Poll error:', e.message);
    }
    schedulePoll(); // schedule next poll
  }, POLL_INTERVAL_MS);
}

function showError(msg) {
  const box = document.getElementById('error-box');
  document.getElementById('error-msg').textContent = msg;
  box.classList.remove('d-none');
}

// Start
init();
