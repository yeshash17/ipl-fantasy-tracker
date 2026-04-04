/**
 * map-remaining.js — maps the remaining unmapped players via individual search
 * Uses ~48 API calls for the unmapped players.
 *
 * Run: CRICAPI_KEY=your_key node scripts/map-remaining.js
 */

const fetch = require('node-fetch');
const fs    = require('fs');
const path  = require('path');

const API_KEY      = process.env.CRICAPI_KEY;
const PLAYERS_FILE = path.join(__dirname, '..', 'data', 'players.json');
const TEAMS_DIR    = path.join(__dirname, '..', 'data', 'teams');

if (!API_KEY) { console.error('Set CRICAPI_KEY'); process.exit(1); }

// Exact search names for every unmapped player
const SEARCH_MAP = {
  'J Hazlewood':      'Josh Hazlewood',
  'H Brar':           'Harpreet Brar',
  'V Chakaravarthy':  'Varun Chakaravarthy',
  'Ashutosh Sharma':  'Ashutosh Sharma',
  'Chameera':         'Dushmantha Chameera',
  'QDC':              'Quinton de Kock',
  'Tim Seifert':      'Tim Seifert',
  'H Klassen':        'Heinrich Klassen',
  'Hasaranga':        'Wanindu Hasaranga',
  'Karun nair':       'Karun Nair',
  'Lockie Ferguson':  'Lockie Ferguson',
  'M Pandey':         'Manish Pandey',
  'Noor Ahmed':       'Noor Ahmad',
  'Sai Kishore':      'Sai Kishore',
  'S Hetmyer':        'Shimron Hetmyer',
  'Ashwini Kumar':    'Ashwini Kumar',
  'Rachin Ravindra':  'Rachin Ravindra',
  'S Ahmed':          'Shahbaz Ahmed',
  'D Rathi':          'Dhruv Rathi',
  'Brewis':           'Dewald Brevis',
  'Dube':             'Shivam Dube',
  'Abhishek Porel':   'Abhishek Porel',
  'V Suryavanshi':    'Vaibhav Suryavanshi',
  'M Chowdary':       'Maheesh Chowdary',
  'Auqib nabi':       'Auqib Nabi',
  'A Omarzai':        'Azmatullah Omarzai',
  'MS Dhoni':         'MS Dhoni',
  'D Ferreira':       'Donovan Ferreira',
  'Avesh Khan':       'Avesh Khan',
  'I Sharma':         'Ishant Sharma',
  'A Raghuvanshi':    'Ayush Raghuvanshi',
  'R Tripathi':       'Rahul Tripathi',
  'S Mavi':           'Shivam Mavi',
  'Urvil Patel':      'Urvil Patel',
  'W Jacks':          'Will Jacks',
  'P Singh':          'Pratham Singh',
  'Pat Cummins':      'Pat Cummins',
  'Liam Livingstone': 'Liam Livingstone',
  'Akeal Hosein':     'Akeal Hosein',
  'Zak Foulkes':      'Zak Foulkes',
  'Starc':            'Mitchell Starc',
  'Rizvi':            'Abbas Rizvi',
  'J Holder':         'Jason Holder',
  'J Bethell':        'Jacob Bethell',
  'V Iyer':           'Venkatesh Iyer',
  'T Deshpande':      'Tushar Deshpande',
  'Satner':           'Mitchell Santner',
  'Yash Thakur':      'Yash Thakur',
};

async function searchPlayer(name) {
  const url = `https://api.cricapi.com/v1/players?apikey=${API_KEY}&search=${encodeURIComponent(name)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'failure') {
    console.error(`API Error for "${name}": ${data.reason || JSON.stringify(data)}`);
    return null;
  }
  return data?.data ?? [];
}

function norm(s) {
  return String(s).toLowerCase().replace(/[.\s'-]/g, '');
}

function bestMatch(searchName, results) {
  if (!results || results.length === 0) return null;
  const n = norm(searchName);

  // Exact match first
  const exact = results.find(r => norm(r.name) === n);
  if (exact) return exact;

  // Contains match
  const contains = results.find(r => {
    const rn = norm(r.name);
    return rn.includes(n) || n.includes(rn);
  });
  if (contains) return contains;

  // Last name match
  const lastName = norm(searchName.split(' ').pop());
  if (lastName.length >= 4) {
    const lastMatch = results.find(r => norm(r.name).includes(lastName));
    if (lastMatch) return lastMatch;
  }

  // First result as fallback (flag for review)
  return { ...results[0], _fuzzy: true };
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  const players = JSON.parse(fs.readFileSync(PLAYERS_FILE, 'utf8'));
  const unmapped = players.filter(p => !p.cricApiPlayerId);

  console.log(`Searching for ${unmapped.length} unmapped players...\n`);

  let mapped = 0, notFound = 0, apiErrors = 0;

  for (const player of unmapped) {
    const searchName = SEARCH_MAP[player.name] ?? player.name;
    const results = await searchPlayer(searchName);
    await sleep(600); // Stay safe on rate limits

    if (results === null) {
      console.log(`[API ERROR] "${player.name}" — skipped`);
      apiErrors++;
      continue;
    }

    if (results.length === 0) {
      // Try alternate search with just last name
      const lastName = searchName.split(' ').pop();
      if (lastName !== searchName && lastName.length >= 4) {
        console.log(`  Retrying "${player.name}" with "${lastName}"...`);
        const retry = await searchPlayer(lastName);
        await sleep(600);

        if (retry && retry.length > 0) {
          const match = bestMatch(searchName, retry);
          if (match && !match._fuzzy) {
            console.log(`[OK] "${player.name}" → "${match.name}" (${match.id})`);
            player.cricApiPlayerId = match.id;
            mapped++;
            continue;
          } else if (match) {
            console.log(`[REVIEW] "${player.name}" → "${match.name}" (${match.id}) — fuzzy`);
            player.cricApiPlayerId = match.id;
            mapped++;
            continue;
          }
        }
      }
      console.log(`[NOT FOUND] "${player.name}" (searched: "${searchName}")`);
      notFound++;
      continue;
    }

    const match = bestMatch(searchName, results);
    if (match) {
      const tag = match._fuzzy ? 'REVIEW' : 'OK';
      console.log(`[${tag}] "${player.name}" → "${match.name}" (${match.id})`);
      player.cricApiPlayerId = match.id;
      mapped++;
    } else {
      console.log(`[NOT FOUND] "${player.name}"`);
      notFound++;
    }
  }

  // Save updated players.json
  fs.writeFileSync(PLAYERS_FILE, JSON.stringify(players, null, 2));

  // Sync team files
  for (const file of fs.readdirSync(TEAMS_DIR)) {
    const fp = path.join(TEAMS_DIR, file);
    const team = JSON.parse(fs.readFileSync(fp, 'utf8'));
    team.players = team.players.map(p => {
      const match = players.find(u => u.name === p.name && u.team === p.team);
      return match ? { ...p, cricApiPlayerId: match.cricApiPlayerId } : p;
    });
    fs.writeFileSync(fp, JSON.stringify(team, null, 2));
  }

  const totalMapped = players.filter(p => p.cricApiPlayerId).length;
  console.log(`\n=== RESULTS ===`);
  console.log(`This run: Mapped ${mapped}, Not found: ${notFound}, API errors: ${apiErrors}`);
  console.log(`Overall: ${totalMapped} / ${players.length} players mapped`);
}

main().catch(err => { console.error(err); process.exit(1); });
