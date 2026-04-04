/**
 * excel-to-json.js
 * Run once locally: node scripts/excel-to-json.js
 * Converts IPL auction-2026.xlsx into data/teams/*.json and data/players.json
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

const EXCEL_FILE = path.join(__dirname, '..', 'IPL auction-2026.xlsx');
const DATA_DIR = path.join(__dirname, '..', 'data');
const TEAMS_DIR = path.join(DATA_DIR, 'teams');

// Team sheet names in the Excel file mapped to URL-friendly IDs
const TEAM_MAP = {
  'DK':              { id: 'dk',              name: 'DK' },
  'Anand':           { id: 'anand',           name: 'Anand' },
  'Shash':           { id: 'shash',           name: 'Shash' },
  'Naveen + Sujeeth':  { id: 'naveen-sujeeth',  name: 'Naveen & Sujeeth' },
  'Roshan':          { id: 'roshan',          name: 'Roshan' },
  'Yesh':            { id: 'yesh',            name: 'Yesh' },
  'Siddharth':       { id: 'siddharth',       name: 'Siddharth' },
  'NA':              { id: 'na',              name: 'NA' },
};

const BUDGET_TOTAL_LAKHS = 2000; // 20 Cr = 2000 Lakhs

// Ensure output directories exist
[DATA_DIR, TEAMS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

const workbook = XLSX.readFile(EXCEL_FILE);
const allPlayers = [];
const unsoldPlayers = [];

// Process each team sheet
for (const [sheetName, teamInfo] of Object.entries(TEAM_MAP)) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    console.warn(`Sheet "${sheetName}" not found — skipping`);
    continue;
  }

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const players = [];
  let budgetSpent = 0;

  for (const row of rows) {
    // Row format: [Sl.No, Player Name, Price (L), Role]
    const slNo = row[0];
    const playerName = String(row[1] || '').trim();
    const price = parseFloat(row[2]) || 0;
    const role = String(row[3] || '').trim();

    // Skip header rows and empty rows
    if (!playerName || !slNo || isNaN(Number(slNo))) continue;
    // Skip rows that look like summary/total rows
    if (playerName.toLowerCase().includes('total') || playerName.toLowerCase().includes('budget')) continue;

    const player = {
      name: playerName,
      price,       // in Lakhs
      role,
      team: teamInfo.id,
      cricApiPlayerId: null  // filled in by map-player-ids.js
    };

    players.push(player);
    allPlayers.push(player);
    budgetSpent += price;
  }

  const teamJson = {
    teamId: teamInfo.id,
    teamName: teamInfo.name,
    budgetTotal: BUDGET_TOTAL_LAKHS,
    budgetSpent: Math.round(budgetSpent * 100) / 100,
    players
  };

  const outPath = path.join(TEAMS_DIR, `${teamInfo.id}.json`);
  fs.writeFileSync(outPath, JSON.stringify(teamJson, null, 2));
  console.log(`✓ ${teamInfo.name}: ${players.length} players, ${budgetSpent.toFixed(0)}L spent → ${outPath}`);
}

// Process Unsold sheet
const unsoldSheet = workbook.Sheets['Unsold'];
if (unsoldSheet) {
  const rows = XLSX.utils.sheet_to_json(unsoldSheet, { header: 1, defval: '' });
  for (const row of rows) {
    const playerName = String(row[0] || '').trim();
    const originalTeam = String(row[1] || '').trim();
    if (!playerName || playerName.toLowerCase() === 'unsold player') continue;
    unsoldPlayers.push({ name: playerName, originalTeam });
  }
  fs.writeFileSync(path.join(DATA_DIR, 'unsold.json'), JSON.stringify(unsoldPlayers, null, 2));
  console.log(`✓ Unsold: ${unsoldPlayers.length} players → data/unsold.json`);
}

// Write master players.json (all purchased players across all teams)
fs.writeFileSync(
  path.join(DATA_DIR, 'players.json'),
  JSON.stringify(allPlayers, null, 2)
);
console.log(`✓ Master players list: ${allPlayers.length} players → data/players.json`);
console.log('\nDone! Next step: run "node scripts/map-player-ids.js" after getting your CricAPI key.');
