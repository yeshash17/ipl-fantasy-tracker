@echo off
echo ================================
echo  IPL Fantasy Tracker - Update
echo ================================
echo.

cd /d "%~dp0"

echo [1/3] Scraping latest scorecards...
set PYTHONIOENCODING=utf-8
python scripts/scrape-scorecards.py
if errorlevel 1 (
    echo ERROR: Scraping failed!
    pause
    exit /b 1
)

echo.
echo [2/3] Updating manifest...
node -e "const fs=require('fs');const d='data/scorecards';const f=fs.readdirSync(d).filter(x=>x.endsWith('.json')&&x!=='manifest.json');fs.writeFileSync(d+'/manifest.json',JSON.stringify(f.map(x=>x.replace('.json','')),null,2));console.log('Manifest:',f.length,'matches');"

echo.
echo [3/3] Committing and pushing...
git add data/scorecards/
git diff --staged --quiet
if errorlevel 1 (
    git commit -m "Update scorecards"
    git push
    echo.
    echo SUCCESS! Pushed to GitHub.
    echo Now go to Netlify dashboard and click "Trigger deploy"
    echo Or wait for auto-deploy if enabled.
) else (
    echo No new matches to commit.
)

echo.
pause
