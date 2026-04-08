"""
scrape-lite.py — Lightweight scraper for GitHub Actions
Uses Playwright directly (no Scrapling/patchright dependency).
ESPNCricinfo doesn't block GitHub Actions IPs as aggressively as residential ones.

Usage:
  python scripts/scrape-lite.py
"""

import json
import os
import re
import time

SERIES_SLUG = "ipl-2026-1510719"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
SCORECARDS_DIR = os.path.join(PROJECT_DIR, "data", "scorecards")
os.makedirs(SCORECARDS_DIR, exist_ok=True)

def discover_matches(context):
    """Auto-discover all completed IPL 2026 match URLs from the results page."""
    print("[DISCOVER] Fetching match results page...")
    page = context.new_page()
    try:
        page.goto(
            f"https://www.espncricinfo.com/series/{SERIES_SLUG}/match-results",
            timeout=30000,
        )
        page.wait_for_selector("a[href*='full-scorecard']", timeout=15000)
        time.sleep(2)

        matches = []
        seen = set()
        for link in page.query_selector_all(f"a[href*='{SERIES_SLUG}']"):
            href = link.get_attribute("href") or ""
            if "/full-scorecard" not in href:
                continue
            # Extract match ID (last number in slug)
            m = re.search(r"-(\d+)/full-scorecard", href)
            if m and m.group(1) not in seen:
                match_id = m.group(1)
                slug = href.split(f"{SERIES_SLUG}/")[1].replace("/full-scorecard", "") if SERIES_SLUG in href else ""
                seen.add(match_id)
                matches.append((slug, match_id))

        print(f"[DISCOVER] Found {len(matches)} completed matches")
        return matches
    except Exception as e:
        print(f"[DISCOVER] Failed: {e}")
        return []
    finally:
        page.close()


# Fallback: hardcoded matches in case auto-discovery fails
FALLBACK_MATCHES = [
    ("royal-challengers-bengaluru-vs-sunrisers-hyderabad-1st-match-1527674", "1527674"),
    ("mumbai-indians-vs-kolkata-knight-riders-2nd-match-1527675", "1527675"),
    ("rajasthan-royals-vs-chennai-super-kings-3rd-match-1527676", "1527676"),
    ("punjab-kings-vs-gujarat-titans-4th-match-1527677", "1527677"),
    ("lucknow-super-giants-vs-delhi-capitals-5th-match-1527678", "1527678"),
    ("kolkata-knight-riders-vs-sunrisers-hyderabad-6th-match-1527679", "1527679"),
    ("chennai-super-kings-vs-punjab-kings-7th-match-1527680", "1527680"),
    ("delhi-capitals-vs-mumbai-indians-8th-match-1527681", "1527681"),
    ("gujarat-titans-vs-rajasthan-royals-9th-match-1527682", "1527682"),
    ("sunrisers-hyderabad-vs-lucknow-super-giants-10th-match-1527683", "1527683"),
    ("royal-challengers-bengaluru-vs-chennai-super-kings-11th-match-1527684", "1527684"),
    # Match 12 KKR vs PBKS - washed out, no scorecard
    ("rajasthan-royals-vs-mumbai-indians-13th-match-1527686", "1527686"),
    ("delhi-capitals-vs-gujarat-titans-14th-match-1527687", "1527687"),
    ("kolkata-knight-riders-vs-lucknow-super-giants-15th-match-1527688", "1527688"),
]


def get_cell_value(cell):
    """Get text from a cell, checking inner spans if direct text is empty."""
    text = cell.inner_text().strip()
    if text:
        return text
    # Check spans
    spans = cell.query_selector_all("span")
    for s in spans:
        t = s.inner_text().strip()
        if t:
            return t
    return ""


def parse_scorecard(page):
    """Parse batting and bowling from the rendered page."""
    tables = page.query_selector_all("table")
    if not tables:
        return None

    result = {"innings": []}

    for ti in range(0, len(tables), 2):
        batting_table = tables[ti] if ti < len(tables) else None
        bowling_table = tables[ti + 1] if ti + 1 < len(tables) else None
        innings = {"batting": [], "bowling": []}

        if batting_table:
            for row in batting_table.query_selector_all("tr"):
                link = row.query_selector("a[title]")
                tds = row.query_selector_all("td")
                if link and len(tds) >= 7:
                    name = link.get_attribute("title") or link.inner_text().strip()
                    try:
                        r = get_cell_value(tds[2])
                        b = get_cell_value(tds[3])
                        fours = get_cell_value(tds[5])
                        sixes = get_cell_value(tds[6])
                        innings["batting"].append({
                            "name": name,
                            "r": int(r) if r.isdigit() else 0,
                            "b": int(b) if b.isdigit() else 0,
                            "4s": int(fours) if fours.isdigit() else 0,
                            "6s": int(sixes) if sixes.isdigit() else 0,
                        })
                    except (IndexError, ValueError):
                        pass

        if bowling_table:
            for row in bowling_table.query_selector_all("tr"):
                link = row.query_selector("a[title]")
                tds = row.query_selector_all("td")
                if link and len(tds) >= 5:
                    name = link.get_attribute("title") or link.inner_text().strip()
                    name = re.sub(r"^View full profile of\s+", "", name)
                    try:
                        overs = get_cell_value(tds[1])
                        runs = get_cell_value(tds[3])
                        wickets = get_cell_value(tds[4])
                        innings["bowling"].append({
                            "name": name,
                            "o": overs,
                            "r": int(runs) if runs.isdigit() else 0,
                            "w": int(wickets) if wickets.isdigit() else 0,
                        })
                    except (IndexError, ValueError):
                        pass

        if innings["batting"] or innings["bowling"]:
            result["innings"].append(innings)

    return result if result["innings"] else None


def main():
    from playwright.sync_api import sync_playwright

    success = 0
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            user_agent="Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
        )

        # Auto-discover matches, fall back to hardcoded list
        matches = discover_matches(context) or FALLBACK_MATCHES

        for slug, match_id in matches:
            out_file = os.path.join(SCORECARDS_DIR, f"{match_id}.json")

            # Skip completed matches (already have final scorecard)
            if os.path.exists(out_file):
                try:
                    existing = json.load(open(out_file, encoding="utf-8"))
                    if existing.get("completed"):
                        print(f"[SKIP] {match_id} (completed)")
                        success += 1
                        continue
                    # File exists but not marked completed — re-scrape (live match)
                    print(f"[LIVE] Re-scraping {match_id}...")
                except Exception:
                    pass

            url = f"https://www.espncricinfo.com/series/{SERIES_SLUG}/{slug}/full-scorecard"
            print(f"[FETCH] {match_id}: {url}")

            try:
                page = context.new_page()
                page.goto(url, timeout=30000)
                page.wait_for_selector("table", timeout=15000)
                time.sleep(2)  # Extra wait for JS rendering

                scorecard = parse_scorecard(page)

                # Check if match is completed (status text contains "won" or "tied")
                is_completed = False
                try:
                    page_text = page.inner_text("body")[:2000].lower()
                    if "won by" in page_text or "match tied" in page_text or "no result" in page_text:
                        is_completed = True
                except Exception:
                    # If both innings are fully bowled out (20 overs each), likely completed
                    if scorecard and len(scorecard.get("innings", [])) >= 2:
                        is_completed = True

                page.close()

                if scorecard:
                    scorecard["matchId"] = match_id
                    scorecard["scrapedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")
                    scorecard["completed"] = is_completed
                    with open(out_file, "w", encoding="utf-8") as f:
                        json.dump(scorecard, f, indent=2, ensure_ascii=False)

                    bat_count = sum(len(inn["batting"]) for inn in scorecard["innings"])
                    bowl_count = sum(len(inn["bowling"]) for inn in scorecard["innings"])
                    wkt_count = sum(b["w"] for inn in scorecard["innings"] for b in inn["bowling"])
                    tag = "FINAL" if is_completed else "LIVE"
                    print(f"  [{tag}] {bat_count} batters, {bowl_count} bowlers, {wkt_count} wickets")
                    success += 1
                else:
                    print(f"  [WARN] No scorecard data")
            except Exception as e:
                print(f"  [ERROR] {e}")
            time.sleep(2)

        browser.close()

    print(f"\nDone. {success}/{len(matches)} matches.")


if __name__ == "__main__":
    main()
