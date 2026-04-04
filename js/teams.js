/**
 * teams.js — renders a single team's squad with live points
 */

const TEAM_IDS_ORDER = [
  { id: 'dk',             label: 'DK' },
  { id: 'anand',          label: 'Anand' },
  { id: 'shash',          label: 'Shash' },
  { id: 'naveen-sujeeth', label: 'Naveen & S' },
  { id: 'roshan',         label: 'Roshan' },
  { id: 'yesh',           label: 'Yesh' },
  { id: 'siddharth',      label: 'Siddharth' },
  { id: 'na',             label: 'NA' },
];

async function init() {
  const params = new URLSearchParams(location.search);
  const teamId = params.get('team') || 'dk';

  // Render nav pills
  const navEl = document.getElementById('team-nav-pills');
  navEl.innerHTML = TEAM_IDS_ORDER.map(t =>
    `<a href="teams.html?team=${t.id}" class="btn btn-sm ${t.id === teamId ? 'btn-primary' : 'btn-outline-secondary'}">${t.label}</a>`
  ).join('');

  try {
    const [team, allPlayers] = await Promise.all([
      fetchJSON(`data/teams/${teamId}.json`),
      fetchJSON('data/players.json'),
    ]);

    document.getElementById('team-title').textContent = team.teamName + ' — Squad';
    document.title = team.teamName + ' — IPL 2026 Fantasy';

    // Load global player points
    const globalPts = await loadPointsForPlayers(team.players, allPlayers);

    const { totalPoints, playerStats } = aggregateTeamPoints(team.players, globalPts);

    // Budget stats
    const spentCr = (team.budgetSpent / 100).toFixed(2);
    const leftCr  = ((team.budgetTotal - team.budgetSpent) / 100).toFixed(2);
    const pct     = Math.round((team.budgetSpent / team.budgetTotal) * 100);

    document.getElementById('stat-spent').textContent  = spentCr;
    document.getElementById('stat-left').textContent   = leftCr;
    document.getElementById('stat-points').textContent = totalPoints.toLocaleString();
    document.getElementById('budget-pct').textContent  = pct + '%';
    document.getElementById('budget-bar').style.width  = pct + '%';

    // Role badge summary
    const roleCounts = {};
    for (const p of team.players) {
      roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
    }
    document.getElementById('role-badges').innerHTML = Object.entries(roleCounts)
      .map(([role, count]) => `${roleBadge(role)} <span class="badge bg-light text-dark border">${count}</span>`)
      .join(' ');

    // Player table sorted by points desc
    const sorted = [...playerStats].sort((a, b) => b.points - a.points);
    document.getElementById('squad-body').innerHTML = sorted.map((p, i) => `
      <tr>
        <td class="ps-3 text-muted">${i + 1}</td>
        <td class="fw-semibold">${p.name}</td>
        <td>${roleBadge(p.role)}</td>
        <td class="text-end">${p.price}</td>
        <td class="text-end">${p.runs ?? 0}</td>
        <td class="text-end">${p.wickets ?? 0}</td>
        <td class="text-end pe-3 fw-bold text-primary">${p.points ?? 0}</td>
      </tr>`).join('');

    document.getElementById('loading').classList.add('d-none');
    document.getElementById('team-section').classList.remove('d-none');

  } catch (err) {
    document.getElementById('loading').classList.add('d-none');
    document.getElementById('error-box').classList.remove('d-none');
    document.getElementById('error-msg').textContent = 'Could not load team: ' + err.message;
    console.error(err);
  }
}

async function loadPointsForPlayers(teamPlayers, allPlayers) {
  if (!IPL_SERIES_ID) return {};

  let matches = [];
  try { matches = await fetchSeriesMatches(); } catch (e) { return {}; }

  const allMatchIds = matches
    .filter(m => m.matchStarted)
    .map(m => m.id);

  const scorecards = await Promise.allSettled(allMatchIds.map(id => fetchScorecard(id)));

  const globalPts = {};
  for (const result of scorecards) {
    if (result.status !== 'fulfilled' || !result.value) continue;
    const pts = calcPoints(result.value, allPlayers);
    for (const [pid, stat] of Object.entries(pts)) {
      if (!globalPts[pid]) globalPts[pid] = { runs: 0, wickets: 0, points: 0 };
      globalPts[pid].runs     += stat.runs;
      globalPts[pid].wickets  += stat.wickets;
      globalPts[pid].points   += stat.points;
    }
  }
  return globalPts;
}

init();
