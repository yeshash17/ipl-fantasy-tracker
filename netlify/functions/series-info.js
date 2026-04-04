/**
 * Netlify Function: /api/series-info?seriesId=SERIES_ID
 * Returns all matches in an IPL series with their statuses.
 * Cached for 10 minutes on CDN.
 */

exports.handler = async (event) => {
  const { seriesId } = event.queryStringParameters || {};

  if (!seriesId) {
    return { statusCode: 400, body: JSON.stringify({ error: 'seriesId is required' }) };
  }

  const apiKey = process.env.CRICAPI_KEY;
  if (!apiKey) {
    return {
      statusCode: 503,
      body: JSON.stringify({ error: 'CRICAPI_KEY environment variable not set' })
    };
  }

  try {
    const url = `https://api.cricapi.com/v1/series_info?apikey=${apiKey}&id=${seriesId}`;
    const res = await fetch(url);
    const data = await res.json();

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Cache-Control': 'public, max-age=600',  // 10 minutes
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
