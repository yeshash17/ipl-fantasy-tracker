/**
 * leaderboard.js — loads all team data + scorecards, computes standings,
 * renders charts, match-by-match table, MVP, role breakdown, and live-polls
 */

const TEAM_COLORS = ['#003087','#e63946','#2a9d8f','#e9c46a','#f4a261','#264653','#6a4c93','#457b9d'];

let allPlayers = [];
let teamsData  = [];
let globalPlayerPoints = {};
let perMatchPoints = {}; // { matchId: { playerName: { runs, wickets, points } } }
let matchOrder = [];     // ordered list of match IDs

async function init() {
  try {
    const [players, ...teams] = await Promise.all([
      fetchJSON('data/players.json'),
      ...ALL_TEAM_IDS.map(id => fetchJSON(`data/teams/${id}.json`))
    ]);

    allPlayers = players;
    teamsData  = teams.filter(t => t && t.players?.length > 0);

    await loadAllScorecards();

    renderLeaderboard();
    renderTopPerformers();
    renderMatchByMatch();
    renderProgressionChart();
    renderMVP();
    renderRoleBreakdown();
    setLastUpdated();

    document.getElementById('loading').classList.add('d-none');
    document.getElementById('leaderboard-section').classList.remove('d-none');
  } catch (err) {
    document.getElementById('loading').classList.add('d-none');
    showError('Could not load data: ' + err.message);
    console.error(err);
  }
}

async function loadAllScorecards() {
  globalPlayerPoints = {};
  perMatchPoints = {};
  matchOrder = [];

  let manifest = [];
  try { manifest = await fetchJSON('data/scorecards/manifest.json'); } catch (e) {}

  if (manifest.length > 0) {
    const scorecards = await Promise.allSettled(
      manifest.map(id => fetchJSON(`data/scorecards/${id}.json`))
    );

    for (let i = 0; i < scorecards.length; i++) {
      if (scorecards[i].status !== 'fulfilled' || !scorecards[i].value) continue;
      const sc = scorecards[i].value;
      const matchId = manifest[i];
      matchOrder.push(matchId);

      const pts = calcPoints(sc, allPlayers);
      perMatchPoints[matchId] = pts;

      for (const [name, stat] of Object.entries(pts)) {
        if (!globalPlayerPoints[name]) globalPlayerPoints[name] = { runs: 0, wickets: 0, points: 0 };
        globalPlayerPoints[name].runs     += stat.runs;
        globalPlayerPoints[name].wickets  += stat.wickets;
        globalPlayerPoints[name].points   += stat.points;
      }
    }
  }
}

// ── Leaderboard ────────────────────────────────────────────────────────────

function renderLeaderboard() {
  const rows = teamsData.map(team => {
    const agg = aggregateTeamPoints(team.players, globalPlayerPoints, 15);
    return { team, totalPoints: agg.totalPoints, top15Points: agg.top15Points };
  });
  // Sort by Best 15 points
  rows.sort((a, b) => b.top15Points - a.top15Points);

  document.getElementById('leaderboard-body').innerHTML = rows.map((row, i) => {
    const rank = i + 1;
    const t = row.team;
    const spentCr = (t.budgetSpent / 100).toFixed(1);
    const rowClass = rank === 1 ? 'table-warning' : '';
    return `
      <tr class="${rowClass}">
        <td class="ps-3 fw-bold">${rankIcon(rank)}</td>
        <td>
          <a href="teams.html?team=${t.teamId}" class="fw-semibold text-decoration-none text-dark">${t.teamName}</a>
          <div class="text-muted small d-md-none">${t.players.length} players</div>
        </td>
        <td class="text-end fw-bold fs-5 text-primary">${row.top15Points.toLocaleString()}</td>
        <td class="text-end d-none d-md-table-cell text-muted">${row.totalPoints.toLocaleString()}</td>
        <td class="text-end d-none d-md-table-cell">${t.players.length}</td>
        <td class="text-end pe-3 d-none d-sm-table-cell text-muted">${spentCr} Cr</td>
      </tr>`;
  }).join('');
}

// ── Top Performers ─────────────────────────────────────────────────────────

function renderTopPerformers() {
  const enriched = allPlayers
    .filter(p => globalPlayerPoints[p.name])
    .map(p => ({ ...p, ...globalPlayerPoints[p.name] }));

  const topBatters = [...enriched].sort((a, b) => b.runs - a.runs).slice(0, 5);
  document.getElementById('top-batters').innerHTML = topBatters.length
    ? topBatters.map((p, i) => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <div><span class="text-muted me-2">${i + 1}.</span><strong>${p.name}</strong>
          <span class="text-muted small ms-2">${TEAM_NAMES[p.team] ?? p.team}</span></div>
          <span class="badge bg-primary rounded-pill">${p.runs} runs</span>
        </li>`).join('')
    : '<li class="list-group-item text-muted">No data yet</li>';

  const topBowlers = [...enriched].sort((a, b) => b.wickets - a.wickets).slice(0, 5);
  document.getElementById('top-bowlers').innerHTML = topBowlers.length
    ? topBowlers.map((p, i) => `
        <li class="list-group-item d-flex justify-content-between align-items-center">
          <div><span class="text-muted me-2">${i + 1}.</span><strong>${p.name}</strong>
          <span class="text-muted small ms-2">${TEAM_NAMES[p.team] ?? p.team}</span></div>
          <span class="badge bg-danger rounded-pill">${p.wickets} wkts</span>
        </li>`).join('')
    : '<li class="list-group-item text-muted">No data yet</li>';
}

// ── Match-by-Match Table ───────────────────────────────────────────────────

function renderMatchByMatch() {
  if (matchOrder.length === 0) return;

  const header = document.getElementById('match-header');
  matchOrder.forEach((_, i) => {
    const th = document.createElement('th');
    th.className = 'text-end';
    th.textContent = `M${i + 1}`;
    th.title = `Match ${i + 1}`;
    header.appendChild(th);
  });
  const totalTh = document.createElement('th');
  totalTh.className = 'text-end pe-3 fw-bold';
  totalTh.textContent = 'Total';
  header.appendChild(totalTh);

  const teamRows = teamsData.map(team => {
    let total = 0;
    const matchPts = matchOrder.map(matchId => {
      let pts = 0;
      for (const p of team.players) {
        pts += perMatchPoints[matchId]?.[p.name]?.points ?? 0;
      }
      total += pts;
      return pts;
    });
    return { team, matchPts, total };
  });
  teamRows.sort((a, b) => b.total - a.total);

  const maxPerMatch = matchOrder.map((_, i) => Math.max(...teamRows.map(r => r.matchPts[i])));

  document.getElementById('match-body').innerHTML = teamRows.map(row => {
    const cells = row.matchPts.map((pts, i) => {
      const isTop = pts === maxPerMatch[i] && pts > 0;
      return `<td class="text-end ${isTop ? 'fw-bold text-success' : 'text-muted'}">${pts}</td>`;
    }).join('');
    return `<tr>
      <td class="ps-3 fw-semibold">${row.team.teamName}</td>
      ${cells}
      <td class="text-end pe-3 fw-bold text-primary">${row.total}</td>
    </tr>`;
  }).join('');
}

// ── Points Progression Chart ───────────────────────────────────────────────

function renderProgressionChart() {
  if (matchOrder.length === 0) return;

  const labels = matchOrder.map((_, i) => `M${i + 1}`);
  const datasets = teamsData.map((team, ti) => {
    let cumulative = 0;
    const data = matchOrder.map(matchId => {
      let pts = 0;
      for (const p of team.players) pts += perMatchPoints[matchId]?.[p.name]?.points ?? 0;
      cumulative += pts;
      return cumulative;
    });
    return {
      label: team.teamName,
      data,
      borderColor: TEAM_COLORS[ti % TEAM_COLORS.length],
      backgroundColor: TEAM_COLORS[ti % TEAM_COLORS.length] + '20',
      tension: 0.3,
      pointRadius: 4,
      borderWidth: 2,
    };
  });

  new Chart(document.getElementById('progression-chart'), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 15 } },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: {
        y: { beginAtZero: true, title: { display: true, text: 'Cumulative Points' } },
        x: { title: { display: true, text: 'Match' } },
      },
    },
  });
}

// ── MVP (Best Value) ───────────────────────────────────────────────────────

function renderMVP() {
  const enriched = allPlayers
    .filter(p => globalPlayerPoints[p.name] && globalPlayerPoints[p.name].points > 0)
    .map(p => ({
      ...p,
      ...globalPlayerPoints[p.name],
      ptsPerLakh: p.price > 0 ? (globalPlayerPoints[p.name].points / p.price).toFixed(2) : 0,
    }));

  const top10 = [...enriched].sort((a, b) => b.ptsPerLakh - a.ptsPerLakh).slice(0, 10);

  document.getElementById('mvp-body').innerHTML = top10.length
    ? top10.map((p, i) => `
      <tr class="${i === 0 ? 'table-warning' : ''}">
        <td class="ps-3">${i + 1}</td>
        <td class="fw-semibold">${p.name}</td>
        <td class="text-muted">${TEAM_NAMES[p.team] ?? p.team}</td>
        <td class="text-end">${p.points}</td>
        <td class="text-end">${p.price}</td>
        <td class="text-end pe-3 fw-bold text-success">${p.ptsPerLakh}</td>
      </tr>`).join('')
    : '<tr><td colspan="6" class="text-muted text-center py-3">No data yet</td></tr>';
}

// ── Role-wise Breakdown ────────────────────────────────────────────────────

function renderRoleBreakdown() {
  const roleColors = {
    'Batsman': '#0d6efd',
    'Bowler': '#198754',
    'All rounder': '#ffc107',
    'All-Rounder': '#ffc107',
    'Wkt Keeper': '#6f42c1',
  };

  // Aggregate per team per role
  const teamRoleData = teamsData.map(team => {
    const roles = {};
    for (const p of team.players) {
      const role = p.role || 'Other';
      const pts = globalPlayerPoints[p.name]?.points ?? 0;
      roles[role] = (roles[role] || 0) + pts;
    }
    return { teamName: team.teamName, roles };
  }).sort((a, b) => {
    const aTotal = Object.values(a.roles).reduce((s, v) => s + v, 0);
    const bTotal = Object.values(b.roles).reduce((s, v) => s + v, 0);
    return bTotal - aTotal;
  });

  // Collect all unique roles
  const allRoles = [...new Set(teamsData.flatMap(t => t.players.map(p => p.role || 'Other')))];

  const datasets = allRoles.map(role => ({
    label: role,
    data: teamRoleData.map(t => t.roles[role] || 0),
    backgroundColor: roleColors[role] || '#6c757d',
  }));

  new Chart(document.getElementById('role-chart'), {
    type: 'bar',
    data: {
      labels: teamRoleData.map(t => t.teamName),
      datasets,
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom', labels: { boxWidth: 12, padding: 10 } },
        tooltip: { mode: 'index' },
      },
      scales: {
        x: { stacked: true },
        y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Points' } },
      },
    },
  });
}

function showError(msg) {
  document.getElementById('error-msg').textContent = msg;
  document.getElementById('error-box').classList.remove('d-none');
}

init();
