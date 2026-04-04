/**
 * map-via-squads.js — smarter player ID mapping
 * Uses only ~12 API calls instead of 140:
 *   1 call: fetch IPL 2026 series info (gets all team squad IDs)
 *  10 calls: fetch each IPL team's squad (all players with their IDs)
 *   1 call: verify
 *
 * Run: CRICAPI_KEY=your_key node scripts/map-via-squads.js
 */

const fetch       = require('node-fetch');
const fs          = require('fs');
const path        = require('path');

const API_KEY      = process.env.CRICAPI_KEY;
const SERIES_ID    = '87c62aac-bc3c-4738-ab93-19da0690488f';
const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json');

if (!API_KEY) {
  console.error('Set CRICAPI_KEY env variable first.');
  process.exit(1);
}

// Name normalisation: lowercase, remove dots/spaces for fuzzy matching
function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[.\s'-]/g, '');
}

// Check if two names are close enough to match
function isMatch(excelName, apiName) {
  const e = norm(excelName);
  const a = norm(apiName);
  if (e === a) return true;
  // Partial: every word of the shorter name appears in the longer
  const eWords = e.match(/.{3,}/g) ?? [];
  return eWords.every(w => a.includes(w));
}

async function get(url) {
  const res = await fetch(url);
  return res.json();
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('Fetching IPL 2026 series info...');
  const seriesData = await get(
    `https://api.cricapi.com/v1/series_info?apikey=${API_KEY}&id=${SERIES_ID}`
  );
  await sleep(500);

  const squadMeta = seriesData?.data?.squads ?? [];
  if (!squadMeta.length) {
    console.error('No squads found in series. Response:', JSON.stringify(seriesData, null, 2));
    process.exit(1);
  }

  console.log(`Found ${squadMeta.length} squads. Fetching player lists...`);

  // Build a master lookup: normalisedName → { id, name }
  const masterLookup = {};
  let squadsFetched = 0;

  for (const squad of squadMeta) {
    const squadData = await get(
      `https://api.cricapi.com/v1/series_squad?apikey=${API_KEY}&id=${SERIES_ID}&squad_id=${squad.id}`
    );
    await sleep(400);

    const players = squadData?.data?.players ?? [];
    for (const p of players) {
      masterLookup[norm(p.name)] = { id: p.id, name: p.name };
      // Also index by last name alone for single-name entries like "Jadeja"
      const parts = p.name.split(' ');
      if (parts.length > 1) {
        masterLookup[norm(parts[parts.length - 1])] = { id: p.id, name: p.name };
      }
    }
    squadsFetched++;
    console.log(`  [${squadsFetched}/${squadMeta.length}] ${squad.name}: ${players.length} players`);
  }

  console.log(`\nMaster lookup built: ${Object.keys(masterLookup).length} entries`);

  // Load corrections for abbreviated names
  let CORRECTIONS = {};
  try { CORRECTIONS = require('./name-corrections'); } catch (e) {}

  // Now match each fantasy player
  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  let mapped = 0, notFound = 0;

  const updated = players.map(player => {
    // Use corrected name if available
    const searchName = CORRECTIONS[player.name] ?? player.name;

    // Try exact normalised match first
    const exactKey = norm(searchName);
    if (masterLookup[exactKey]) {
      const match = masterLookup[exactKey];
      console.log(`[OK] "${player.name}" → "${match.name}" (${match.id})`);
      mapped++;
      return { ...player, cricApiPlayerId: match.id };
    }

    // Try fuzzy match against all entries
    const fuzzyMatch = Object.values(masterLookup).find(m => isMatch(searchName, m.name));
    if (fuzzyMatch) {
      console.log(`[FUZZY] "${player.name}" → "${fuzzyMatch.name}" (${fuzzyMatch.id})`);
      mapped++;
      return { ...player, cricApiPlayerId: fuzzyMatch.id, _needsReview: true };
    }

    console.log(`[NOT FOUND] "${player.name}" (searched: "${searchName}")`);
    notFound++;
    return player;
  });

  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(updated, null, 2));
  console.log(`\nDone. Mapped: ${mapped}, Not found: ${notFound}`);
  if (notFound > 0) {
    console.log('For remaining NOT FOUND players, add them to scripts/name-corrections.js and re-run.');
  }
}

main().catch(err => { console.error(err); process.exit(1); });
