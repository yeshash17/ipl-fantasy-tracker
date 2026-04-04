/**
 * map-via-scorecards.js — maps player IDs using scorecard data from completed matches
 * Only uses ~8-10 API calls total (one per completed match).
 *
 * Run: CRICAPI_KEY=your_key node scripts/map-via-scorecards.js
 */

const fetch       = require('node-fetch');
const fs          = require('fs');
const path        = require('path');

const API_KEY      = process.env.CRICAPI_KEY;
const SERIES_ID    = '87c62aac-bc3c-4738-ab93-19da0690488f';
const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json');
const TEAMS_DIR    = path.join(__dirname, '..', 'data', 'teams');

let CORRECTIONS = {};
try { CORRECTIONS = require('./name-corrections'); } catch (e) {}

if (!API_KEY) {
  console.error('Set CRICAPI_KEY env variable first.');
  process.exit(1);
}

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[.\s'-]/g, '').replace(/^(dr|mr|mrs)/, '');
}

// Multiple matching strategies
function findMatch(excelName, lookup) {
  const searchName = CORRECTIONS[excelName] ?? excelName;
  const n = norm(searchName);

  // 1. Exact normalised match
  if (lookup[n]) return lookup[n];

  // 2. Check if normalised name is contained in any API name or vice versa (min 5 chars)
  if (n.length >= 5) {
    for (const [key, val] of Object.entries(lookup)) {
      if (key.includes(n) || n.includes(key)) return val;
    }
  }

  // 3. Last name match (for single-word names like "Jadeja", "Hasaranga")
  const lastWord = norm(searchName.split(' ').pop());
  if (lastWord.length >= 5) {
    for (const [key, val] of Object.entries(lookup)) {
      if (key.includes(lastWord)) return val;
    }
  }

  // 4. First + last name initials match (e.g. "KL Rahul" → matches "kl" + "rahul")
  const words = searchName.split(/\s+/).map(w => norm(w)).filter(w => w.length > 0);
  if (words.length >= 2) {
    for (const [key, val] of Object.entries(lookup)) {
      if (words.every(w => key.includes(w))) return val;
    }
  }

  return null;
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Step 1: Get series info to find completed match IDs
  console.log('Fetching series match list...');
  const seriesRes = await fetch(
    `https://api.cricapi.com/v1/series_info?apikey=${API_KEY}&id=${SERIES_ID}`
  );
  const seriesData = await seriesRes.json();
  await sleep(500);

  const matchList = seriesData?.data?.matchList ?? [];
  const completedMatches = matchList.filter(m => m.matchEnded === true);
  console.log(`Found ${completedMatches.length} completed matches out of ${matchList.length} total.`);

  // Step 2: Fetch each completed match scorecard and extract player IDs
  const masterLookup = {}; // norm(name) → { id, name }

  for (let i = 0; i < completedMatches.length; i++) {
    const match = completedMatches[i];
    console.log(`  [${i + 1}/${completedMatches.length}] Fetching: ${match.name}...`);

    const scRes = await fetch(
      `https://api.cricapi.com/v1/match_scorecard?apikey=${API_KEY}&id=${match.id}`
    );
    const scData = await scRes.json();
    await sleep(500);

    const innings = scData?.data?.scorecard ?? scData?.scorecard ?? [];
    for (const inn of innings) {
      for (const batter of (inn.batting ?? [])) {
        if (batter?.batsman?.id && batter?.batsman?.name) {
          masterLookup[norm(batter.batsman.name)] = {
            id: batter.batsman.id,
            name: batter.batsman.name
          };
        }
      }
      for (const bowler of (inn.bowling ?? [])) {
        if (bowler?.bowler?.id && bowler?.bowler?.name) {
          masterLookup[norm(bowler.bowler.name)] = {
            id: bowler.bowler.id,
            name: bowler.bowler.name
          };
        }
      }
    }
  }

  console.log(`\nMaster lookup built: ${Object.keys(masterLookup).length} unique players from scorecards.`);

  // Step 3: Match fantasy players to CricAPI IDs
  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  let mapped = 0, notFound = 0;

  const updated = players.map(player => {
    const match = findMatch(player.name, masterLookup);
    if (match) {
      console.log(`[OK] "${player.name}" → "${match.name}" (${match.id})`);
      mapped++;
      return { ...player, cricApiPlayerId: match.id };
    }
    console.log(`[NOT FOUND] "${player.name}" (correction: "${CORRECTIONS[player.name] ?? 'none'}")`);
    notFound++;
    return { ...player, cricApiPlayerId: null };
  });

  // Step 4: Write updated players.json
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(updated, null, 2));

  // Step 5: Also update individual team JSONs
  for (const teamFile of fs.readdirSync(TEAMS_DIR)) {
    const teamPath = path.join(TEAMS_DIR, teamFile);
    const team = JSON.parse(fs.readFileSync(teamPath, 'utf8'));
    team.players = team.players.map(p => {
      const updatedPlayer = updated.find(u => u.name === p.name && u.team === p.team);
      return updatedPlayer ?? p;
    });
    fs.writeFileSync(teamPath, JSON.stringify(team, null, 2));
  }

  console.log(`\n=== RESULTS ===`);
  console.log(`Mapped: ${mapped} / ${players.length}`);
  console.log(`Not found: ${notFound}`);
  if (notFound > 0) {
    console.log(`\nNOT FOUND players haven't appeared in a completed match yet.`);
    console.log(`They will be auto-matched as more matches complete, or`);
    console.log(`re-run this script after more matches are played.`);
  }
}

main().catch(err => { console.error(err); process.exit(1); });
