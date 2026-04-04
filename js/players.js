/**
 * players.js — renders all players with search/filter and live points
 */

let allPlayersData = [];
let globalPts = {};

async function init() {
  try {
    const players = await fetchJSON('data/players.json');
    allPlayersData = players;

    // Load points from scraped scorecards
    globalPts = await loadGlobalPoints(players);

    document.getElementById('loading').classList.add('d-none');
    document.getElementById('players-section').classList.remove('d-none');

    filterPlayers();

  } catch (err) {
    document.getElementById('loading').classList.add('d-none');
    document.getElementById('players-section').classList.remove('d-none');
    console.error(err);
    filterPlayers(); // still render without points
  }
}

async function loadGlobalPoints(players) {
  const pts = {};

  let manifest = [];
  try { manifest = await fetchJSON('data/scorecards/manifest.json'); } catch (e) {}

  if (manifest.length > 0) {
    const scorecards = await Promise.allSettled(
      manifest.map(id => fetchJSON(`data/scorecards/${id}.json`))
    );
    for (const result of scorecards) {
      if (result.status !== 'fulfilled' || !result.value) continue;
      const sc = calcPoints(result.value, players);
      for (const [name, stat] of Object.entries(sc)) {
        if (!pts[name]) pts[name] = { runs: 0, wickets: 0, points: 0 };
        pts[name].runs     += stat.runs;
        pts[name].wickets  += stat.wickets;
        pts[name].points   += stat.points;
      }
    }
  }

  return pts;
}

function filterPlayers() {
  const search    = (document.getElementById('search-input')?.value ?? '').toLowerCase();
  const roleFilter = document.getElementById('role-filter')?.value ?? '';
  const teamFilter = document.getElementById('team-filter')?.value ?? '';

  let filtered = allPlayersData.filter(p => {
    const matchName = p.name.toLowerCase().includes(search);
    const matchRole = !roleFilter || p.role === roleFilter;
    const matchTeam = !teamFilter || p.team === teamFilter;
    return matchName && matchRole && matchTeam;
  });

  // Enrich with points and sort by points desc
  const enriched = filtered.map(p => ({
    ...p,
    ...(globalPts[p.name] ?? { runs: 0, wickets: 0, points: 0 })
  })).sort((a, b) => b.points - a.points);

  const tbody = document.getElementById('players-body');
  tbody.innerHTML = enriched.map((p, i) => `
    <tr>
      <td class="ps-3 text-muted">${i + 1}</td>
      <td class="fw-semibold">${p.name}</td>
      <td>${roleBadge(p.role)}</td>
      <td>
        <a href="teams.html?team=${p.team}" class="text-decoration-none text-dark">
          ${TEAM_NAMES[p.team] ?? p.team}
        </a>
      </td>
      <td class="text-end">${p.price}</td>
      <td class="text-end">${p.runs}</td>
      <td class="text-end">${p.wickets}</td>
      <td class="text-end pe-3 fw-bold text-primary">${p.points}</td>
    </tr>`).join('');

  document.getElementById('players-count').textContent =
    `Showing ${enriched.length} of ${allPlayersData.length} players`;
}

init();
