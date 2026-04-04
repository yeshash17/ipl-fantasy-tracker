/**
 * cache-scorecards.js — fetches completed match scorecards and saves them as static JSON
 * This eliminates API calls for completed matches entirely.
 *
 * Run: CRICAPI_KEY=your_key node scripts/cache-scorecards.js
 * Then commit data/scorecards/*.json and push.
 */

const fetch = require('node-fetch');
const fs    = require('fs');
const path  = require('path');

const API_KEY      = process.env.CRICAPI_KEY;
const SERIES_ID    = '87c62aac-bc3c-4738-ab93-19da0690488f';
const SCORECARDS_DIR = path.join(__dirname, '..', 'data', 'scorecards');

if (!API_KEY) { console.error('Set CRICAPI_KEY'); process.exit(1); }
if (!fs.existsSync(SCORECARDS_DIR)) fs.mkdirSync(SCORECARDS_DIR, { recursive: true });

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  // Get match list
  console.log('Fetching series info...');
  const seriesRes = await fetch(
    `https://api.cricapi.com/v1/series_info?apikey=${API_KEY}&id=${SERIES_ID}`
  );
  const seriesData = await seriesRes.json();

  if (seriesData.status === 'failure') {
    console.error('API Error:', seriesData.reason);
    process.exit(1);
  }

  const matches = seriesData?.data?.matchList ?? [];
  const completed = matches.filter(m => m.matchEnded === true);
  console.log(`${completed.length} completed matches found.\n`);

  let cached = 0, skipped = 0, errors = 0;

  for (const match of completed) {
    const filePath = path.join(SCORECARDS_DIR, `${match.id}.json`);

    // Skip if already cached
    if (fs.existsSync(filePath)) {
      console.log(`[SKIP] ${match.name} — already cached`);
      skipped++;
      continue;
    }

    console.log(`[FETCH] ${match.name}...`);
    await sleep(500);

    const scRes = await fetch(
      `https://api.cricapi.com/v1/match_scorecard?apikey=${API_KEY}&id=${match.id}`
    );
    const scData = await scRes.json();

    if (scData.status === 'failure') {
      console.log(`  ERROR: ${scData.reason}`);
      errors++;
      continue;
    }

    fs.writeFileSync(filePath, JSON.stringify(scData.data, null, 2));
    console.log(`  Saved → data/scorecards/${match.id}.json`);
    cached++;
  }

  // Also save the match list as a static fallback
  const matchListPath = path.join(__dirname, '..', 'data', 'matches.json');
  fs.writeFileSync(matchListPath, JSON.stringify(matches, null, 2));
  console.log(`\nSaved match list → data/matches.json (${matches.length} matches)`);

  console.log(`Done. Cached: ${cached}, Skipped: ${skipped}, Errors: ${errors}`);
  console.log('Commit data/scorecards/ and data/matches.json, then push to deploy.');
}

main().catch(err => { console.error(err); process.exit(1); });
