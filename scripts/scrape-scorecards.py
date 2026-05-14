"""
scrape-scorecards.py — Scrapes IPL 2026 scorecards from ESPNCricinfo using Scrapling.
No API key needed. No rate limits. Run anytime.

Usage:
  python scripts/scrape-scorecards.py              # scrape all completed matches
  python scripts/scrape-scorecards.py --push        # scrape + git commit + push

Saves to data/scorecards/ as JSON files. Frontend reads these as static files (0 API calls).
"""

import json
import os
import sys
import time
import subprocess
import re

# ESPNCricinfo IPL 2026 match URLs
# Format: https://www.espncricinfo.com/series/ipl-2026-{seriesId}/{slug}-{matchId}/full-scorecard
SERIES_SLUG = "ipl-2026-1510719"

# Match list: add new matches here as the tournament progresses
# Or auto-discover from the schedule page
MATCHES = {}  # Will be populated from schedule page

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
SCORECARDS_DIR = os.path.join(PROJECT_DIR, "data", "scorecards")
MATCHES_FILE = os.path.join(PROJECT_DIR, "data", "matches_espn.json")

os.makedirs(SCORECARDS_DIR, exist_ok=True)


def fetch_page(url):
    """Fetch a page using Scrapling's StealthyFetcher (bypasses anti-bot)."""
    from scrapling.fetchers import StealthyFetcher
    return StealthyFetcher.fetch(url, headless=True, wait=5000, wait_selector="table")


def get_cell_value(td):
    """Get text from a table cell, checking spans if direct text is empty."""
    text = td.text.strip()
    if text:
        return text
    spans = td.css("span")
    for s in spans:
        t = s.text.strip()
        if t:
            return t
    return ""


def parse_scorecard(page):
    """Parse batting and bowling data from an ESPNCricinfo scorecard page.

    ESPNCricinfo table layout:
      Batting: [Name, Dismissal, R, B, M, 4s, 6s, SR]
      Bowling: [Name, O, M, R, W, ECON, 0s, WD, NB]
    Some cells (like W) have values inside <span> tags, not direct text.
    """
    tables = page.css("table")
    if not tables:
        return None

    result = {"innings": []}

    for ti in range(0, len(tables), 2):
        batting_table = tables[ti] if ti < len(tables) else None
        bowling_table = tables[ti + 1] if ti + 1 < len(tables) else None

        innings = {"batting": [], "bowling": []}

        # Parse batting: [Name, Dismissal, R, B, M, 4s, 6s, SR]
        if batting_table:
            for row in batting_table.css("tr"):
                link = row.css("a[title]")
                tds = row.css("td")
                if link and len(tds) >= 7:
                    name = link[0].attrib.get("title", "").strip()
                    if not name:
                        name = link[0].text.strip()
                    try:
                        runs = int(get_cell_value(tds[2]) or 0)
                        balls = int(get_cell_value(tds[3]) or 0)
                        fours = int(get_cell_value(tds[5]) or 0)
                        sixes = int(get_cell_value(tds[6]) or 0)
                        innings["batting"].append({
                            "name": name, "r": runs, "b": balls, "4s": fours, "6s": sixes
                        })
                    except (IndexError, ValueError):
                        pass

        # Parse bowling: [Name, O, M, R, W, ECON, 0s, WD, NB]
        # W (wickets) is in td[4] — value often inside a <span>
        if bowling_table:
            for row in bowling_table.css("tr"):
                link = row.css("a[title]")
                tds = row.css("td")
                if link and len(tds) >= 5:
                    name = link[0].attrib.get("title", "").strip()
                    if not name:
                        name = link[0].text.strip()
                    name = re.sub(r"^View full profile of\s+", "", name)
                    try:
                        overs = get_cell_value(tds[1])
                        runs = int(get_cell_value(tds[3]) or 0)
                        wickets = int(get_cell_value(tds[4]) or 0)
                        innings["bowling"].append({
                            "name": name, "o": overs, "r": runs, "w": wickets
                        })
                    except (IndexError, ValueError):
                        pass

        if innings["batting"] or innings["bowling"]:
            result["innings"].append(innings)

    return result if result["innings"] else None


def fetch_schedule():
    """Fetch IPL 2026 match schedule from ESPNCricinfo."""
    print("Fetching IPL 2026 schedule...")
    from scrapling.fetchers import StealthyFetcher
    page = StealthyFetcher.fetch(
        f"https://www.espncricinfo.com/series/{SERIES_SLUG}/match-results",
        headless=True, wait=5000
    )

    matches = []
    links = page.css("a[href*='/full-scorecard']")
    if not links:
        # Try finding match links differently
        links = page.css(f"a[href*='{SERIES_SLUG}']")

    seen = set()
    for link in links:
        href = link.attrib.get("href", "")
        if "/full-scorecard" in href or "match" in href.lower():
            # Extract match slug from URL
            if href not in seen:
                seen.add(href)
                title = link.attrib.get("title", link.text.strip())
                matches.append({"url": href, "title": title})

    return matches


def scrape_match(url, match_id):
    """Scrape a single match scorecard."""
    out_file = os.path.join(SCORECARDS_DIR, f"{match_id}.json")

    # Skip if already cached
    if os.path.exists(out_file):
        print(f"  [SKIP] Already cached: {match_id}")
        return True

    full_url = f"https://www.espncricinfo.com{url}" if url.startswith("/") else url
    if "/full-scorecard" not in full_url:
        full_url = full_url.rstrip("/") + "/full-scorecard"

    print(f"  [FETCH] {full_url}")
    page = fetch_page(full_url)
    scorecard = parse_scorecard(page)

    if scorecard:
        # Add match metadata
        scorecard["matchId"] = match_id
        scorecard["url"] = full_url
        scorecard["scrapedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")

        with open(out_file, "w", encoding="utf-8") as f:
            json.dump(scorecard, f, indent=2, ensure_ascii=False)
        print(f"  [OK] Saved {len(scorecard['innings'])} innings -> {match_id}.json")
        return True
    else:
        print(f"  [WARN] No scorecard data found")
        return False


def get_match_id_from_url(url):
    """Extract a match ID from an ESPNCricinfo URL."""
    # URL pattern: /series/slug/team1-vs-team2-Nth-match-MATCHID/full-scorecard
    parts = url.rstrip("/").split("/")
    for part in reversed(parts):
        if part == "full-scorecard":
            continue
        # The match slug contains the numeric ID at the end
        match = re.search(r"-(\d+)$", part)
        if match:
            return match.group(1)
        return part
    return None


def main():
    auto_push = "--push" in sys.argv

    # Known completed match URLs (ESPNCricinfo)
    # Add more as the tournament progresses
    known_matches = [
        ("/series/ipl-2026-1510719/royal-challengers-bengaluru-vs-sunrisers-hyderabad-1st-match-1527674/full-scorecard", "1527674"),
        ("/series/ipl-2026-1510719/mumbai-indians-vs-kolkata-knight-riders-2nd-match-1527675/full-scorecard", "1527675"),
        ("/series/ipl-2026-1510719/rajasthan-royals-vs-chennai-super-kings-3rd-match-1527676/full-scorecard", "1527676"),
        ("/series/ipl-2026-1510719/punjab-kings-vs-gujarat-titans-4th-match-1527677/full-scorecard", "1527677"),
        ("/series/ipl-2026-1510719/lucknow-super-giants-vs-delhi-capitals-5th-match-1527678/full-scorecard", "1527678"),
        ("/series/ipl-2026-1510719/kolkata-knight-riders-vs-sunrisers-hyderabad-6th-match-1527679/full-scorecard", "1527679"),
        ("/series/ipl-2026-1510719/chennai-super-kings-vs-punjab-kings-7th-match-1527680/full-scorecard", "1527680"),
        ("/series/ipl-2026-1510719/delhi-capitals-vs-mumbai-indians-8th-match-1527681/full-scorecard", "1527681"),
        ("/series/ipl-2026-1510719/gujarat-titans-vs-rajasthan-royals-9th-match-1527682/full-scorecard", "1527682"),
        ("/series/ipl-2026-1510719/sunrisers-hyderabad-vs-lucknow-super-giants-10th-match-1527683/full-scorecard", "1527683"),
        ("/series/ipl-2026-1510719/royal-challengers-bengaluru-vs-chennai-super-kings-11th-match-1527684/full-scorecard", "1527684"),
        # Match 12 KKR vs PBKS - washed out, no scorecard
        ("/series/ipl-2026-1510719/rajasthan-royals-vs-mumbai-indians-13th-match-1527686/full-scorecard", "1527686"),
        ("/series/ipl-2026-1510719/delhi-capitals-vs-gujarat-titans-14th-match-1527687/full-scorecard", "1527687"),
        ("/series/ipl-2026-1510719/kolkata-knight-riders-vs-lucknow-super-giants-15th-match-1527688/full-scorecard", "1527688"),
        ("/series/ipl-2026-1510719/rajasthan-royals-vs-royal-challengers-bengaluru-16th-match-1527689/full-scorecard", "1527689"),
        ("/series/ipl-2026-1510719/punjab-kings-vs-sunrisers-hyderabad-17th-match-1527690/full-scorecard", "1527690"),
        ("/series/ipl-2026-1510719/gujarat-titans-vs-kolkata-knight-riders-25th-match-1529268/full-scorecard", "1529268"),
        ("/series/ipl-2026-1510719/royal-challengers-bengaluru-vs-delhi-capitals-26th-match-1529269/full-scorecard", "1529269"),
        ("/series/ipl-2026-1510719/sunrisers-hyderabad-vs-chennai-super-kings-27th-match-1529270/full-scorecard", "1529270"),
        ("/series/ipl-2026-1510719/kolkata-knight-riders-vs-rajasthan-royals-28th-match-1529271/full-scorecard", "1529271"),
        ("/series/ipl-2026-1510719/29th-match-1529272/full-scorecard", "1529272"),
        ("/series/ipl-2026-1510719/gujarat-titans-vs-mumbai-indians-30th-match-1529273/full-scorecard", "1529273"),
        ("/series/ipl-2026-1510719/sunrisers-hyderabad-vs-delhi-capitals-31st-match-1529274/full-scorecard", "1529274"),
        ("/series/ipl-2026-1510719/lucknow-super-giants-vs-rajasthan-royals-32nd-match-1529275/full-scorecard", "1529275"),
        ("/series/ipl-2026-1510719/mumbai-indians-vs-chennai-super-kings-33rd-match-1529276/full-scorecard", "1529276"),
        ("/series/ipl-2026-1510719/34th-match-1529277/full-scorecard", "1529277"),
        ("/series/ipl-2026-1510719/delhi-capitals-vs-punjab-kings-35th-match-1529278/full-scorecard", "1529278"),
        ("/series/ipl-2026-1510719/rajasthan-royals-vs-sunrisers-hyderabad-36th-match-1529279/full-scorecard", "1529279"),
        ("/series/ipl-2026-1510719/chennai-super-kings-vs-gujarat-titans-37th-match-1529280/full-scorecard", "1529280"),
        ("/series/ipl-2026-1510719/lucknow-super-giants-vs-kolkata-knight-riders-38th-match-1529281/full-scorecard", "1529281"),
        ("/series/ipl-2026-1510719/delhi-capitals-vs-royal-challengers-bengaluru-39th-match-1529282/full-scorecard", "1529282"),
        ("/series/ipl-2026-1510719/punjab-kings-vs-rajasthan-royals-40th-match-1529283/full-scorecard", "1529283"),
        ("/series/ipl-2026-1510719/mumbai-indians-vs-sunrisers-hyderabad-41st-match-1529284/full-scorecard", "1529284"),
        ("/series/ipl-2026-1510719/gujarat-titans-vs-royal-challengers-bengaluru-42nd-match-1529285/full-scorecard", "1529285"),
        ("/series/ipl-2026-1510719/rajasthan-royals-vs-delhi-capitals-43rd-match-1529286/full-scorecard", "1529286"),
        ("/series/ipl-2026-1510719/chennai-super-kings-vs-mumbai-indians-44th-match-1529287/full-scorecard", "1529287"),
        ("/series/ipl-2026-1510719/sunrisers-hyderabad-vs-kolkata-knight-riders-45th-match-1529288/full-scorecard", "1529288"),
        ("/series/ipl-2026-1510719/gujarat-titans-vs-punjab-kings-46th-match-1529289/full-scorecard", "1529289"),
        ("/series/ipl-2026-1510719/mumbai-indians-vs-lucknow-super-giants-47th-match-1529290/full-scorecard", "1529290"),
        ("/series/ipl-2026-1510719/delhi-capitals-vs-chennai-super-kings-48th-match-1529291/full-scorecard", "1529291"),
        ("/series/ipl-2026-1510719/sunrisers-hyderabad-vs-punjab-kings-49th-match-1529292/full-scorecard", "1529292"),
        ("/series/ipl-2026-1510719/lucknow-super-giants-vs-royal-challengers-bengaluru-50th-match-1529293/full-scorecard", "1529293"),
        ("/series/ipl-2026-1510719/51st-match-1529294/full-scorecard", "1529294"),
        ("/series/ipl-2026-1510719/52nd-match-1529295/full-scorecard", "1529295"),
        ("/series/ipl-2026-1510719/53rd-match-1529296/full-scorecard", "1529296"),
        ("/series/ipl-2026-1510719/54th-match-1529297/full-scorecard", "1529297"),
        ("/series/ipl-2026-1510719/55th-match-1529298/full-scorecard", "1529298"),
        ("/series/ipl-2026-1510719/56th-match-1529299/full-scorecard", "1529299"),
        ("/series/ipl-2026-1510719/57th-match-1529300/full-scorecard", "1529300"),
        ("/series/ipl-2026-1510719/58th-match-1529301/full-scorecard", "1529301"),
        ("/series/ipl-2026-1510719/59th-match-1529302/full-scorecard", "1529302"),
        ("/series/ipl-2026-1510719/60th-match-1529303/full-scorecard", "1529303"),
        ("/series/ipl-2026-1510719/61st-match-1529304/full-scorecard", "1529304"),
        ("/series/ipl-2026-1510719/62nd-match-1529305/full-scorecard", "1529305"),
        ("/series/ipl-2026-1510719/63rd-match-1529306/full-scorecard", "1529306"),
        ("/series/ipl-2026-1510719/64th-match-1529307/full-scorecard", "1529307"),
        ("/series/ipl-2026-1510719/65th-match-1529308/full-scorecard", "1529308"),
        ("/series/ipl-2026-1510719/66th-match-1529309/full-scorecard", "1529309"),
        ("/series/ipl-2026-1510719/67th-match-1529310/full-scorecard", "1529310"),
        ("/series/ipl-2026-1510719/68th-match-1529311/full-scorecard", "1529311"),
        ("/series/ipl-2026-1510719/69th-match-1529312/full-scorecard", "1529312"),
        ("/series/ipl-2026-1510719/70th-match-1529313/full-scorecard", "1529313"),
    ]

    print(f"Scraping {len(known_matches)} IPL 2026 matches...\n")
    success = 0
    for url, match_id in known_matches:
        try:
            if scrape_match(url, match_id):
                success += 1
            time.sleep(2)  # Be nice to the server
        except Exception as e:
            print(f"  [ERROR] {match_id}: {e}")

    print(f"\nDone. {success}/{len(known_matches)} matches scraped.")

    if auto_push and success > 0:
        print("\nCommitting and pushing...")
        os.chdir(PROJECT_DIR)
        subprocess.run(["git", "add", "data/scorecards/"], check=True)
        subprocess.run(["git", "commit", "-m", "Update cached scorecards"], check=True)
        subprocess.run(["git", "push"], check=True)
        print("Pushed to GitHub. Netlify will auto-deploy.")


if __name__ == "__main__":
    main()
