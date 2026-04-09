const express = require('express');
const https = require('https');
const router = express.Router();

let cache = null;
let cacheTime = 0;
const CACHE_TTL = 300000; // 5 minutes

// USGS Earthquake API — past 7 days, magnitude 2.5+ globally (Australia + region)
function fetchUSGS(params) {
  return new Promise((resolve, reject) => {
    const query = new URLSearchParams({
      format: 'geojson',
      orderby: 'time',
      limit: '200',
      ...params,
    });
    const url = `https://earthquake.usgs.gov/fdsnws/event/1/query?${query}`;
    https.get(url, { headers: { 'User-Agent': 'StrayaNow/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// GET /api/seismic?period=week&minmag=2.5&region=aus
router.get('/', async (req, res) => {
  const period = req.query.period || 'week';
  const minmag = parseFloat(req.query.minmag) || 2.5;
  const region = req.query.region || 'global';

  const now = Date.now();
  const cacheKey = `${period}-${minmag}-${region}`;

  if (cache?.key === cacheKey && (now - cacheTime) < CACHE_TTL) {
    return res.json(cache.data);
  }

  const params = {
    minmagnitude: minmag,
    starttime: new Date(now - (period === 'day' ? 86400000 : period === 'month' ? 2592000000 : 604800000)).toISOString(),
  };

  // Filter to Australia + surrounding region
  if (region === 'aus') {
    Object.assign(params, { minlatitude: -50, maxlatitude: -5, minlongitude: 100, maxlongitude: 165 });
  }

  try {
    const data = await fetchUSGS(params);
    cache = { key: cacheKey, data };
    cacheTime = now;
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: 'USGS fetch failed', detail: err.message });
  }
});

module.exports = router;
