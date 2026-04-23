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

    const { totalPoints, top15Points, playerStats } = aggregateTeamPoints(team.players, globalPts, 15);

    // Budget stats
    const spentCr = (team.budgetSpent / 100).toFixed(2);
    const leftCr  = ((team.budgetTotal - team.budgetSpent) / 100).toFixed(2);
    const pct     = Math.round((team.budgetSpent / team.budgetTotal) * 100);

    document.getElementById('stat-spent').textContent  = spentCr;
    document.getElementById('stat-left').textContent   = leftCr;
    document.getElementById('stat-points').textContent = top15Points.toLocaleString() + ' (All: ' + totalPoints.toLocaleString() + ')';
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

    // Player table sorted by points desc, top 15 highlighted
    const sorted = [...playerStats].sort((a, b) => b.points - a.points);
    document.getElementById('squad-body').innerHTML = sorted.map((p, i) => {
      const rowClass = !p.inTop15 ? 'table-light text-muted' : '';
      const badge = !p.inTop15 ? ' <span class="badge bg-secondary ms-1">bench</span>' : '';
      return `
      <tr class="${rowClass}">
        <td class="ps-3">${i + 1}</td>
        <td class="fw-semibold">${p.name}${badge}</td>
        <td>${roleBadge(p.role)}</td>
        <td class="text-end">${p.price}</td>
        <td class="text-end">${p.runs ?? 0}</td>
        <td class="text-end">${p.wickets ?? 0}</td>
        <td class="text-end pe-3 fw-bold ${p.inTop15 ? 'text-primary' : ''}">${p.points ?? 0}</td>
      </tr>`;
    }).join('');

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
  const globalPts = {};

  // Load scraped scorecards
  let manifest = [];
  try { manifest = await fetchJSON('data/scorecards/manifest.json'); } catch (e) {}

  if (manifest.length > 0) {
    const scorecards = await Promise.allSettled(
      manifest.map(id => fetchJSON(`data/scorecards/${id}.json`))
    );
    for (const result of scorecards) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const pts = calcPoints(result.value, allPlayers);
      for (const [name, stat] of Object.entries(pts)) {
        if (!globalPts[name]) globalPts[name] = { runs: 0, wickets: 0, points: 0 };
        globalPts[name].runs     += stat.runs;
        globalPts[name].wickets  += stat.wickets;
        globalPts[name].points   += stat.points;
      }
    }
  }

  return globalPts;
}

init();
