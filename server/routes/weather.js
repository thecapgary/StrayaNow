const express = require('express');
const https = require('https');
const router = express.Router();

const CITIES = [
  { name: 'Sydney',        state: 'NSW', lat: -33.87, lon: 151.21 },
  { name: 'Melbourne',     state: 'VIC', lat: -37.81, lon: 144.96 },
  { name: 'Brisbane',      state: 'QLD', lat: -27.47, lon: 153.02 },
  { name: 'Perth',         state: 'WA',  lat: -31.95, lon: 115.86 },
  { name: 'Adelaide',      state: 'SA',  lat: -34.93, lon: 138.60 },
  { name: 'Darwin',        state: 'NT',  lat: -12.46, lon: 130.84 },
  { name: 'Hobart',        state: 'TAS', lat: -42.88, lon: 147.33 },
  { name: 'Canberra',      state: 'ACT', lat: -35.28, lon: 149.13 },
  { name: 'Cairns',        state: 'QLD', lat: -16.92, lon: 145.77 },
  { name: 'Townsville',    state: 'QLD', lat: -19.26, lon: 146.82 },
  { name: 'Gold Coast',    state: 'QLD', lat: -28.02, lon: 153.40 },
  { name: 'Alice Springs', state: 'NT',  lat: -23.70, lon: 133.88 },
  { name: 'Broome',        state: 'WA',  lat: -17.96, lon: 122.24 },
  { name: 'Launceston',    state: 'TAS', lat: -41.43, lon: 147.13 },
  { name: 'Port Hedland',  state: 'WA',  lat: -20.31, lon: 118.58 },
];

// WMO weather code → [description, emoji]
const WX = {
  0:  ['Clear Sky',           '☀'],
  1:  ['Mainly Clear',        '🌤'],
  2:  ['Partly Cloudy',       '⛅'],
  3:  ['Overcast',            '☁'],
  45: ['Fog',                 '🌫'],
  48: ['Rime Fog',            '🌫'],
  51: ['Light Drizzle',       '🌦'],
  53: ['Drizzle',             '🌦'],
  55: ['Heavy Drizzle',       '🌧'],
  61: ['Light Rain',          '🌧'],
  63: ['Rain',                '🌧'],
  65: ['Heavy Rain',          '🌧'],
  71: ['Light Snow',          '🌨'],
  73: ['Snow',                '❄'],
  75: ['Heavy Snow',          '❄'],
  80: ['Showers',             '🌦'],
  81: ['Heavy Showers',       '🌧'],
  82: ['Violent Showers',     '⛈'],
  95: ['Thunderstorm',        '⛈'],
  96: ['Thunderstorm + Hail', '⛈'],
  99: ['Heavy Thunderstorm',  '⛈'],
};

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 8000 }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data)); } catch (e) { reject(e); } });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// Cache for 10 minutes
let _cache = null;
let _cacheTime = 0;

router.get('/', async (req, res) => {
  const now = Date.now();
  if (_cache && now - _cacheTime < 600000) return res.json(_cache);

  const lats = CITIES.map(c => c.lat).join(',');
  const lons = CITIES.map(c => c.lon).join(',');
  const url = 'https://api.open-meteo.com/v1/forecast?' +
    `latitude=${lats}&longitude=${lons}` +
    '&current=temperature_2m,apparent_temperature,precipitation,wind_speed_10m,wind_direction_10m,weather_code' +
    '&timezone=auto&forecast_days=1';

  try {
    const raw = await fetchJSON(url);
    const results = Array.isArray(raw) ? raw : [raw];

    const cities = CITIES.map((city, i) => {
      const cur = results[i]?.current || {};
      const code = cur.weather_code ?? 0;
      const [desc, icon] = WX[code] || ['Unknown', '?'];
      return {
        name: city.name,
        state: city.state,
        lat: city.lat,
        lon: city.lon,
        temp: Math.round(cur.temperature_2m ?? 0),
        feels: Math.round(cur.apparent_temperature ?? 0),
        precip: +(cur.precipitation ?? 0).toFixed(1),
        wind: Math.round(cur.wind_speed_10m ?? 0),
        wind_dir: Math.round(cur.wind_direction_10m ?? 0),
        code,
        desc,
        icon,
      };
    });

    _cache = { cities, collected_at: new Date().toISOString() };
    _cacheTime = now;
    res.json(_cache);
  } catch (e) {
    if (_cache) return res.json(_cache);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
