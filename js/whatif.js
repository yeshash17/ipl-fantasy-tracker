/**
 * whatif.js — What-If Swap Calculator
 * Swap a player between two teams and see how standings change.
 */

let allPlayers = [];
let teamsData  = [];
let globalPts  = {};

async function init() {
  const [players, ...teams] = await Promise.all([
    fetchJSON('data/players.json'),
    ...ALL_TEAM_IDS.map(id => fetchJSON(`data/teams/${id}.json`))
  ]);

  allPlayers = players;
  teamsData  = teams.filter(t => t && t.players?.length > 0);

  // Load points
  let manifest = [];
  try { manifest = await fetchJSON('data/scorecards/manifest.json'); } catch (e) {}
  if (manifest.length > 0) {
    const scorecards = await Promise.allSettled(manifest.map(id => fetchJSON(`data/scorecards/${id}.json`)));
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

  // Populate team dropdowns
  const selA = document.getElementById('team-a');
  const selB = document.getElementById('team-b');
  for (const t of teamsData) {
    selA.add(new Option(t.teamName, t.teamId));
    selB.add(new Option(t.teamName, t.teamId));
  }
}

function loadTeamPlayers(side) {
  const teamId = document.getElementById(`team-${side}`).value;
  const sel = document.getElementById(`player-${side}`);
  sel.innerHTML = '<option value="">Select player...</option>';

  if (!teamId) { sel.disabled = true; return; }

  const team = teamsData.find(t => t.teamId === teamId);
  if (!team) return;

  const sorted = [...team.players].sort((a, b) => {
    const pa = globalPts[a.name]?.points ?? 0;
    const pb = globalPts[b.name]?.points ?? 0;
    return pb - pa;
  });

  for (const p of sorted) {
    const pts = globalPts[p.name]?.points ?? 0;
    sel.add(new Option(`${p.name} (${pts} pts, ${p.price}L)`, p.name));
  }
  sel.disabled = false;
}

function simulateSwap() {
  const teamAId = document.getElementById('team-a').value;
  const teamBId = document.getElementById('team-b').value;
  const playerAName = document.getElementById('player-a').value;
  const playerBName = document.getElementById('player-b').value;

  if (!teamAId || !teamBId || !playerAName || !playerBName) {
    alert('Please select both teams and both players.');
    return;
  }
  if (teamAId === teamBId) {
    alert('Please select two different teams.');
    return;
  }

  const teamA = teamsData.find(t => t.teamId === teamAId);
  const teamB = teamsData.find(t => t.teamId === teamBId);
  const playerA = teamA.players.find(p => p.name === playerAName);
  const playerB = teamB.players.find(p => p.name === playerBName);

  if (!playerA || !playerB) return;

  const ptsA = globalPts[playerAName]?.points ?? 0;
  const ptsB = globalPts[playerBName]?.points ?? 0;

  // Calculate original team totals
  const origA = teamA.players.reduce((s, p) => s + (globalPts[p.name]?.points ?? 0), 0);
  const origB = teamB.players.reduce((s, p) => s + (globalPts[p.name]?.points ?? 0), 0);

  // After swap: A loses playerA, gains playerB; B loses playerB, gains playerA
  const newA = origA - ptsA + ptsB;
  const newB = origB - ptsB + ptsA;
  const diffA = newA - origA;
  const diffB = newB - origB;

  // Display results
  document.getElementById('swap-result').classList.remove('d-none');

  document.getElementById('result-a-name').textContent = teamA.teamName;
  document.getElementById('result-a-before').textContent = origA;
  document.getElementById('result-a-after').textContent = newA;
  setDiff('result-a-diff', diffA);
  document.getElementById('result-a-card').style.borderColor = diffA >= 0 ? '#198754' : '#dc3545';

  document.getElementById('result-b-name').textContent = teamB.teamName;
  document.getElementById('result-b-before').textContent = origB;
  document.getElementById('result-b-after').textContent = newB;
  setDiff('result-b-diff', diffB);
  document.getElementById('result-b-card').style.borderColor = diffB >= 0 ? '#198754' : '#dc3545';

  // Build new standings
  const standings = teamsData.map(t => {
    const orig = t.players.reduce((s, p) => s + (globalPts[p.name]?.points ?? 0), 0);
    let newPts = orig;
    if (t.teamId === teamAId) newPts = newA;
    if (t.teamId === teamBId) newPts = newB;
    return { name: t.teamName, teamId: t.teamId, orig, newPts, diff: newPts - orig };
  });
  standings.sort((a, b) => b.newPts - a.newPts);

  document.getElementById('new-standings').innerHTML = standings.map((s, i) => {
    const highlight = (s.teamId === teamAId || s.teamId === teamBId) ? 'table-info' : '';
    const diffStr = s.diff > 0 ? `<span class="text-success">+${s.diff}</span>`
                  : s.diff < 0 ? `<span class="text-danger">${s.diff}</span>`
                  : '<span class="text-muted">0</span>';
    return `<tr class="${highlight}">
      <td class="ps-3 fw-bold">${i + 1}</td>
      <td class="fw-semibold">${s.name}</td>
      <td class="text-end text-muted">${s.orig}</td>
      <td class="text-end fw-bold">${s.newPts}</td>
      <td class="text-end pe-3">${diffStr}</td>
    </tr>`;
  }).join('');
}

function setDiff(elId, diff) {
  const el = document.getElementById(elId);
  if (diff > 0) {
    el.textContent = '+' + diff;
    el.className = 'fs-4 fw-bold text-success';
  } else if (diff < 0) {
    el.textContent = String(diff);
    el.className = 'fs-4 fw-bold text-danger';
  } else {
    el.textContent = '0';
    el.className = 'fs-4 fw-bold text-muted';
  }
}

function resetSwap() {
  document.getElementById('team-a').value = '';
  document.getElementById('team-b').value = '';
  document.getElementById('player-a').innerHTML = '<option value="">Select player...</option>';
  document.getElementById('player-b').innerHTML = '<option value="">Select player...</option>';
  document.getElementById('player-a').disabled = true;
  document.getElementById('player-b').disabled = true;
  document.getElementById('swap-result').classList.add('d-none');
}

init();
