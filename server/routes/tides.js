// Tide predictions via Open-Meteo Marine API
// Fetches hourly sea_level_height_msl and detects local extrema (highs/lows)
// Works for any coastal lat/lon click — no API key required
const express = require('express');
const https = require('https');
const dns = require('dns');
const router = express.Router();

// Key Australian coastal tide reference locations shown in the panel
const LOCATIONS = [
  // TAS
  { id: 'hobart',        name: 'Hobart',          state: 'TAS', lat: -42.88, lon: 147.33 },
  { id: 'launceston',    name: 'Launceston',       state: 'TAS', lat: -41.43, lon: 147.14 },
  { id: 'spring-bay',    name: 'Spring Bay',       state: 'TAS', lat: -42.55, lon: 147.93 },
  { id: 'strahan',       name: 'Strahan',          state: 'TAS', lat: -42.15, lon: 145.33 },
  // VIC
  { id: 'williamstown',  name: 'Williamstown',     state: 'VIC', lat: -37.87, lon: 144.90 },
  { id: 'geelong',       name: 'Geelong',          state: 'VIC', lat: -38.13, lon: 144.38 },
  { id: 'portland',      name: 'Portland',         state: 'VIC', lat: -38.35, lon: 141.62 },
  // NSW
  { id: 'sydney',        name: 'Sydney',           state: 'NSW', lat: -33.86, lon: 151.21 },
  { id: 'newcastle',     name: 'Newcastle',        state: 'NSW', lat: -32.93, lon: 151.78 },
  { id: 'eden',          name: 'Eden',             state: 'NSW', lat: -37.07, lon: 149.90 },
  // QLD
  { id: 'brisbane',      name: 'Brisbane',         state: 'QLD', lat: -27.37, lon: 153.18 },
  { id: 'gladstone',     name: 'Gladstone',        state: 'QLD', lat: -23.85, lon: 151.27 },
  { id: 'mackay',        name: 'Mackay',           state: 'QLD', lat: -21.10, lon: 149.22 },
  { id: 'townsville',    name: 'Townsville',       state: 'QLD', lat: -19.25, lon: 146.83 },
  { id: 'cairns',        name: 'Cairns',           state: 'QLD', lat: -16.92, lon: 145.78 },
  { id: 'thursday-is',   name: 'Thursday Island',  state: 'QLD', lat: -10.58, lon: 142.22 },
  // SA
  { id: 'port-adelaide', name: 'Port Adelaide',    state: 'SA',  lat: -34.85, lon: 138.50 },
  { id: 'port-pirie',    name: 'Port Pirie',       state: 'SA',  lat: -33.18, lon: 138.02 },
  { id: 'thevenard',     name: 'Thevenard',        state: 'SA',  lat: -32.15, lon: 133.65 },
  // WA
  { id: 'fremantle',     name: 'Fremantle',        state: 'WA',  lat: -32.05, lon: 115.73 },
  { id: 'albany',        name: 'Albany',           state: 'WA',  lat: -35.03, lon: 117.88 },
  { id: 'geraldton',     name: 'Geraldton',        state: 'WA',  lat: -28.77, lon: 114.62 },
  { id: 'carnarvon',     name: 'Carnarvon',        state: 'WA',  lat: -24.88, lon: 113.65 },
  { id: 'port-hedland',  name: 'Port Hedland',     state: 'WA',  lat: -20.32, lon: 118.58 },
  { id: 'broome',        name: 'Broome',           state: 'WA',  lat: -18.00, lon: 122.23 },
  { id: 'wyndham',       name: 'Wyndham',          state: 'WA',  lat: -15.47, lon: 128.10 },
  // NT
  { id: 'darwin',        name: 'Darwin',           state: 'NT',  lat: -12.47, lon: 130.85 },
];

const GROUP_ORDER = ['TAS', 'VIC', 'NSW', 'QLD', 'SA', 'WA', 'NT'];

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    // Force IPv4 — Node.js tries IPv6 first which may be unreachable
    const req = https.get(url, { family: 4, headers: { 'User-Agent': 'StrayaNow/1.0' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Find local extrema in a series, with smoothing to avoid false peaks on flat plateaus
function findExtrema(times, values) {
  const extremes = [];
  // Use a window of 3 to detect genuine peaks/troughs
  for (let i = 2; i < values.length - 2; i++) {
    if (values[i] == null) continue;
    const v = values[i];
    const neighbors = [values[i-2], values[i-1], values[i+1], values[i+2]].filter(x => x != null);
    const isHigh = neighbors.every(n => v >= n);
    const isLow  = neighbors.every(n => v <= n);
    if (isHigh || isLow) {
      // Avoid duplicates within 2 hours
      const last = extremes[extremes.length - 1];
      if (last && i - last._idx < 2) continue;
      extremes.push({
        type:   isHigh ? 'HIGH' : 'LOW',
        time:   times[i],
        height: Math.round(v * 100) / 100,
        _idx:   i,
      });
    }
  }
  return extremes.map(({ _idx, ...e }) => e);
}

// Tide cache: key = "lat,lon" rounded to 0.1° → { data, fetched_at }
const cache = {};
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

async function getTides(lat, lon) {
  const key = `${lat.toFixed(1)},${lon.toFixed(1)}`;
  const cached = cache[key];
  if (cached && Date.now() - cached.fetched_at < CACHE_TTL) return cached.data;

  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}`
    + `&hourly=sea_level_height_msl&timezone=auto&forecast_days=3`;
  const raw = await fetchJSON(url);

  const times  = raw.hourly?.time || [];
  const levels = raw.hourly?.sea_level_height_msl || [];
  const extremes = findExtrema(times, levels);

  // Only future extremes (from now, with 30 min buffer)
  const now = Date.now() - 30 * 60 * 1000;
  const upcoming = extremes.filter(e => new Date(e.time).getTime() > now).slice(0, 8);

  const data = {
    lat, lon,
    timezone:     raw.timezone,
    tz_abbrev:    raw.timezone_abbreviation,
    extremes:     upcoming,
    // Current sea level (nearest hour)
    current_level: levels[0] ?? null,
  };

  cache[key] = { data, fetched_at: Date.now() };
  return data;
}

// GET /api/tides/locations
router.get('/locations', (req, res) => res.json(LOCATIONS));

// GET /api/tides?lat=&lon=
router.get('/', async (req, res) => {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) return res.status(400).json({ error: 'lat and lon required' });
  try {
    const data = await getTides(lat, lon);
    // Find nearest named location
    let nearest = null, nearestDist = Infinity;
    for (const loc of LOCATIONS) {
      const d = Math.hypot(loc.lat - lat, loc.lon - lon);
      if (d < nearestDist) { nearestDist = d; nearest = loc; }
    }
    res.json({ ...data, nearest_location: nearest, nearest_km: Math.round(nearestDist * 111) });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = { router, LOCATIONS, GROUP_ORDER };
