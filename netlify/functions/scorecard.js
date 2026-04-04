/**
 * Netlify Function: /api/scorecard?matchId=MATCH_ID
 * Proxies to CricAPI match_scorecard endpoint.
 * Protects the API key and adds appropriate Cache-Control headers.
 */

exports.handler = async (event) => {
  const { matchId } = event.queryStringParameters || {};

  if (!matchId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'matchId is required' }) };
  }

  const apiKey = process.env.CRICAPI_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'CRICAPI_KEY environment variable not set' })
    };
  }

  try {
    const url = `https://api.cricapi.com/v1/match_scorecard?apikey=${apiKey}&id=${matchId}`;
    const res = await fetch(url);
    const data = await res.json();

    // Cache completed matches for a year (scores never change).
    // Cache live matches for 10 minutes (our poll interval).
    const isCompleted = data?.data?.matchEnded === true
      || String(data?.data?.status ?? '').toLowerCase().includes('won');

    const cacheControl = isCompleted
      ? 'public, max-age=31536000, immutable'
      : 'public, max-age=600';

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': cacheControl,
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Upstream error: ' + err.message }),
    };
  }
};
