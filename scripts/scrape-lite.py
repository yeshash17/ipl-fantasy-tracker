"""
scrape-lite.py — Downloads IPL 2026 data from Cricsheet (cricsheet.org)
No scraping needed — just downloads a ZIP of structured JSON files.
Works perfectly on GitHub Actions with zero dependencies beyond Python stdlib.

Usage:
  python scripts/scrape-lite.py
"""

import json
import os
import io
import re
import time
import urllib.request
import zipfile

CRICSHEET_URL = "https://cricsheet.org/downloads/ipl_json.zip"

# Cricsheet abbreviated name -> our standard fantasy name
NAME_MAP = {
    "A Badoni": "Ayush Badoni", "A Kamboj": "Anshul Kamboj", "A Mhatre": "Ayush Mhatre",
    "A Nortje": "Anrich Nortje", "A Raghuvanshi": "Angkrish Raghuvanshi",
    "AK Markram": "Aiden Markram", "AM Rahane": "Ajinkya Rahane",
    "AR Patel": "Axar Patel", "B Kumar": "Bhuvneshwar Kumar",
    "B Sai Sudharsan": "Sai Sudharsan", "C Bosch": "Corbin Bosch",
    "C Connolly": "Cooper Connolly", "C Green": "Cameron Green",
    "CV Varun": "Varun Chakravarthy",
    "D Ferreira": "Donovan Ferreira", "D Padikkal": "Devdutt Padikkal",
    "DA Miller": "David Miller", "DL Chahar": "Deepak Chahar",
    "DS Rathi": "Digvesh Rathi", "FH Allen": "Finn Allen",
    "GD Phillips": "Glenn Phillips", "H Klaasen": "Heinrich Klaasen",
    "HH Pandya": "Hardik Pandya", "HV Patel": "Harshal Patel",
    "JA Duffy": "Jacob Duffy", "JC Archer": "Jofra Archer",
    "JC Buttler": "Jos Buttler", "JJ Bumrah": "Jasprit Bumrah",
    "K Rabada": "Kagiso Rabada", "KH Pandya": "Krunal Pandya",
    "KK Ahmed": "Khaleel Ahmed", "L Ngidi": "Lungi Ngidi",
    "LS Livingstone": "Liam Livingstone", "M Jansen": "Marco Jansen",
    "M Markande": "Mayank Markande", "M Prasidh Krishna": "Prasidh Krishna",
    "MD Choudhary": "Mukul Choudhary", "MJ Henry": "Matt Henry",
    "MJ Santner": "Mitchell Santner", "MP Stoinis": "Marcus Stoinis",
    "MR Marsh": "Mitchell Marsh", "Mukesh Kumar": "Mukesh Kumar",
    "N Burger": "Nandre Burger", "N Pooran": "Nicholas Pooran",
    "N Rana": "Nitish Rana", "N Wadhera": "Nehal Wadhera",
    "Nithish Kumar Reddy": "Nitish Kumar Reddy",
    "P Nissanka": "Pathum Nissanka", "P Simran Singh": "Prabhsimran Singh",
    "PD Salt": "Phil Salt", "PR Veer": "Prashant Veer",
    "R Parag": "Riyan Parag", "R Shepherd": "Romario Shepherd",
    "R Tewatia": "Rahul Tewatia", "RA Jadeja": "Ravindra Jadeja",
    "RD Chahar": "Deepak Chahar", "RD Gaikwad": "Ruturaj Gaikwad",
    "RD Rickelton": "Ryan Rickelton", "RG Sharma": "Rohit Sharma",
    "RM Patidar": "Rajat Patidar", "RR Pant": "Rishabh Pant",
    "S Dube": "Shivam Dube", "SA Yadav": "Suryakumar Yadav",
    "SN Khan": "M Shahrukh Khan", "SN Thakur": "Shardul Thakur",
    "SO Hetmyer": "Shimron Hetmyer", "SP Narine": "Sunil Narine",
    "SS Iyer": "Shreyas Iyer", "SV Samson": "Sanju Samson",
    "T Stubbs": "Tristan Stubbs", "TA Boult": "Trent Boult",
    "TH David": "Tim David", "TM Head": "Travis Head",
    "TU Deshpande": "Tushar Deshpande",
    "V Kohli": "Virat Kohli", "V Nigam": "Vipraj Nigam",
    "V Suryavanshi": "Vaibhav Sooryavanshi",
    "VG Arora": "Vaibhav Arora", "XC Bartlett": "Xavier Bartlett",
    "YBK Jaiswal": "Yashasvi Jaiswal", "YS Chahal": "Yuzvendra Chahal",
}
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_DIR = os.path.dirname(SCRIPT_DIR)
SCORECARDS_DIR = os.path.join(PROJECT_DIR, "data", "scorecards")
os.makedirs(SCORECARDS_DIR, exist_ok=True)


def aggregate_scorecard(match_data):
    """Convert Cricsheet ball-by-ball JSON into our scorecard format."""
    info = match_data.get("info", {})
    innings_data = match_data.get("innings", [])

    # Only process IPL 2026 matches
    event = info.get("event", {})
    dates = info.get("dates", [])
    if not dates or not dates[0].startswith("2026"):
        return None

    result = {"innings": []}

    for inning in innings_data:
        team = inning.get("team", "")
        overs = inning.get("overs", [])

        batting = {}  # player -> {r, b}
        bowling = {}  # player -> {r, w, balls}

        for over_data in overs:
            for delivery in over_data.get("deliveries", []):
                batter = delivery.get("batter", "")
                bowler = delivery.get("bowler", "")
                runs = delivery.get("runs", {})
                batter_runs = runs.get("batter", 0)
                total_runs = runs.get("total", 0)

                # Map names to our standard format
                batter = NAME_MAP.get(batter, batter)
                bowler = NAME_MAP.get(bowler, bowler)

                # Batting
                if batter not in batting:
                    batting[batter] = {"r": 0, "b": 0}
                batting[batter]["r"] += batter_runs
                batting[batter]["b"] += 1

                # Bowling
                if bowler not in bowling:
                    bowling[bowler] = {"r": 0, "w": 0, "b": 0}
                bowling[bowler]["r"] += runs.get("total", 0) - runs.get("extras", 0)
                # Count legal deliveries for overs
                extras = delivery.get("extras", {})
                if "wides" not in extras and "noballs" not in extras:
                    bowling[bowler]["b"] += 1

                # Wickets
                for wicket in delivery.get("wickets", []):
                    kind = wicket.get("kind", "")
                    if kind not in ("run out", "retired hurt", "retired out", "obstructing the field"):
                        bowling[bowler]["w"] += 1

        innings_entry = {
            "batting": [{"name": name, "r": stats["r"], "b": stats["b"]} for name, stats in batting.items()],
            "bowling": [
                {
                    "name": name,
                    "o": f"{stats['b'] // 6}.{stats['b'] % 6}" if stats['b'] % 6 else str(stats['b'] // 6),
                    "r": stats["r"],
                    "w": stats["w"],
                }
                for name, stats in bowling.items()
            ],
        }
        result["innings"].append(innings_entry)

    # Match outcome
    outcome = info.get("outcome", {})
    is_completed = bool(outcome.get("winner") or outcome.get("result"))

    result["completed"] = is_completed
    result["matchId"] = str(info.get("registry", {}).get("people", {}).get("", ""))
    result["scrapedAt"] = time.strftime("%Y-%m-%dT%H:%M:%S")

    return result


def main():
    print(f"Downloading Cricsheet IPL data from {CRICSHEET_URL}...")
    req = urllib.request.Request(CRICSHEET_URL, headers={"User-Agent": "Mozilla/5.0"})
    response = urllib.request.urlopen(req, timeout=60)
    zip_data = io.BytesIO(response.read())
    print(f"Downloaded {zip_data.getbuffer().nbytes / 1024 / 1024:.1f} MB")

    success = 0
    skipped = 0
    total = 0

    with zipfile.ZipFile(zip_data) as zf:
        for name in sorted(zf.namelist()):
            if not name.endswith(".json"):
                continue

            match_id = name.replace(".json", "")
            out_file = os.path.join(SCORECARDS_DIR, f"{match_id}.json")

            # Skip already completed matches
            if os.path.exists(out_file):
                try:
                    existing = json.load(open(out_file, encoding="utf-8"))
                    if existing.get("completed"):
                        skipped += 1
                        continue
                except Exception:
                    pass

            # Parse match data
            raw = json.loads(zf.read(name))
            info = raw.get("info", {})
            dates = info.get("dates", [])

            # Only IPL 2026 matches
            if not dates or not dates[0].startswith("2026"):
                continue

            total += 1
            scorecard = aggregate_scorecard(raw)
            if not scorecard:
                continue

            scorecard["matchId"] = match_id
            match_num = info.get("event", {}).get("match_number", "?")
            teams = " vs ".join(info.get("teams", []))

            with open(out_file, "w", encoding="utf-8") as f:
                json.dump(scorecard, f, indent=2, ensure_ascii=False)

            tag = "FINAL" if scorecard["completed"] else "LIVE"
            bat_count = sum(len(inn["batting"]) for inn in scorecard["innings"])
            wkt_count = sum(b["w"] for inn in scorecard["innings"] for b in inn["bowling"])
            print(f"  [{tag}] M{match_num}: {teams} — {bat_count} batters, {wkt_count} wkts")
            success += 1

    print(f"\nDone. New: {success}, Skipped: {skipped}, Total IPL 2026: {total + skipped}")


if __name__ == "__main__":
    main()
