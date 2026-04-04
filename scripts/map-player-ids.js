/**
 * map-player-ids.js
 * Run once after getting your CricAPI key:
 *   CRICAPI_KEY=your_key_here node scripts/map-player-ids.js
 *
 * This script searches CricAPI for each player in data/players.json,
 * prints the best match, and writes the updated players.json with
 * cricApiPlayerId filled in where a confident match was found.
 *
 * Review the output carefully — player name spellings may differ.
 * Manually fix any mismatches in data/players.json before committing.
 */

const fetch       = require('node-fetch');
const fs          = require('fs');
const path        = require('path');
const CORRECTIONS = require('./name-corrections');

const API_KEY     = process.env.CRICAPI_KEY;
const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json');

if (!API_KEY) {
  console.error('ERROR: Set CRICAPI_KEY env variable first.\n  CRICAPI_KEY=your_key node scripts/map-player-ids.js');
  process.exit(1);
}

async function searchPlayer(name) {
  const encoded = encodeURIComponent(name);
  const url = `https://api.cricapi.com/v1/players?apikey=${API_KEY}&search=${encoded}`;
  const res  = await fetch(url);
  const data = await res.json();
  return data?.data ?? [];
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  const updated = [];
  let found = 0, notFound = 0;

  for (const player of players) {
    if (player.cricApiPlayerId) {
      // Already mapped
      updated.push(player);
      continue;
    }

    // Use corrected full name if available
    const searchName = CORRECTIONS[player.name] ?? player.name;
    const results = await searchPlayer(searchName);
    // Rate limit: CricAPI free tier — small delay between calls
    await sleep(400);

    if (results.length === 0) {
      console.log(`[NOT FOUND] ${player.name}`);
      updated.push(player);
      notFound++;
      continue;
    }

    // Take first result as best match (check name similarity)
    const best = results[0];
    const isGoodMatch = best.name.toLowerCase().includes(player.name.split(' ')[0].toLowerCase());

    if (isGoodMatch) {
      console.log(`[OK] "${player.name}" → "${best.name}" (${best.id})`);
      updated.push({ ...player, cricApiPlayerId: best.id });
      found++;
    } else {
      console.log(`[REVIEW] "${player.name}" → best match: "${best.name}" (${best.id}) — check manually`);
      updated.push({ ...player, cricApiPlayerId: best.id, _needsReview: true });
      found++;
    }
  }

  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(updated, null, 2));
  console.log(`\nDone. Mapped: ${found}, Not found: ${notFound}`);
  console.log('Review data/players.json for entries with _needsReview: true');
  console.log('Remove _needsReview flags and commit when satisfied.');
}

main().catch(err => { console.error(err); process.exit(1); });
