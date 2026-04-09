// BOM Weather Radar — transparent PNG overlay tiles, animated
// BOM publishes frames over HTTP at predictable URLs; we proxy for CORS
// Station list + loop timestamps from BOM product pages
const express = require('express');
const https   = require('https');
const http    = require('http');
const router  = express.Router();

// Tasmania + nearby stations with geographic bounding boxes
// bbox from BOM published extents for each 128km IDR product
const STATIONS = {
  IDR023: { name: 'Hobart',      lat: -43.117, lon: 147.502, range: 128,
             bbox: { west: 145.919, south: -44.268, east: 149.085, north: -41.966 } },
  IDR032: { name: 'Campania',    lat: -42.617, lon: 147.367, range: 128,
             bbox: { west: 145.248, south: -43.769, east: 149.486, north: -41.465 } },
  IDR053: { name: 'Yarrawonga', lat: -36.029, lon: 146.021, range: 128,
             bbox: { west: 143.700, south: -37.281, east: 148.342, north: -34.777 } },
};

// Timestamp list cache per station: { ts: YYYYMMDDHHMMSS, age }
const _tsCache   = {};
const TS_TTL     = 5 * 60 * 1000; // 5 min

// PNG buffer cache: Map of url → Buffer (keeps last ~60 frames across all stations)
const _pngCache  = new Map();
const PNG_LIMIT  = 60;

// ── HTTP fetch helper (supports http + https) ─────────────────────────────────

function fetch(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url, {
      headers: { 'User-Agent': 'StrayaNow/1.0 (+github.com/strayanow)', ...opts.headers },
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(opts.timeout || 12000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

// ── Parse BOM loop page for available frame timestamps ────────────────────────
// BOM loop.shtml contains: theFrames = ["IDR023.T.202604090000.png", ...]

async function fetchTimestamps(stationId) {
  const cached = _tsCache[stationId];
  if (cached && Date.now() - cached.age < TS_TTL) return cached.frames;

  const url = `http://www.bom.gov.au/products/${stationId}.loop.shtml`;
  const res = await fetch(url);
  const html = res.body.toString('utf8');

  // Extract frame filenames from the JavaScript array in the HTML
  const match = html.match(/theFrames\s*=\s*\[([^\]]+)\]/s)
             || html.match(/var frames\s*=\s*\[([^\]]+)\]/s);

  let frames = [];
  if (match) {
    frames = [...match[1].matchAll(/"([^"]+\.png)"/g)]
      .map(m => {
        const ts = m[1].match(/\.T\.(\d{12,14})\./)?.[1]?.slice(0, 12);
        return ts ? { ts, filename: m[1] } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.ts.localeCompare(b.ts));
  }

  console.log(`[radar] ${stationId}: ${frames.length} frames found`);
  _tsCache[stationId] = { frames, age: Date.now() };
  return frames;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/stations', (req, res) => {
  res.json(Object.entries(STATIONS).map(([id, s]) => ({ id, ...s })));
});

router.get('/frames/:id', async (req, res) => {
  const id = req.params.id;
  if (!STATIONS[id]) return res.status(404).json({ error: 'Unknown station' });
  try {
    const frames = await fetchTimestamps(id);
    res.json(frames.map(f => ({
      ts:  f.ts,
      url: `/api/radar/png/${id}/${f.ts}`,
    })));
  } catch (e) {
    console.error('[radar] frames error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

// Proxy a single radar PNG frame from BOM (handles CORS + caching)
router.get('/png/:id/:ts', async (req, res) => {
  const { id, ts } = req.params;
  if (!STATIONS[id]) return res.status(404).end();

  const cacheKey = `${id}/${ts}`;
  if (_pngCache.has(cacheKey)) {
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    return res.send(_pngCache.get(cacheKey));
  }

  try {
    const filename = `${id}.T.${ts}00.png`; // BOM appends seconds '00'
    const url = `http://www.bom.gov.au/radar/${filename}`;
    const r = await fetch(url);
    if (r.status !== 200) return res.status(r.status).end();

    // Evict oldest if cache is full
    if (_pngCache.size >= PNG_LIMIT) {
      _pngCache.delete(_pngCache.keys().next().value);
    }
    _pngCache.set(cacheKey, r.body);

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(r.body);
  } catch (e) {
    console.error('[radar] png error:', e.message);
    res.status(502).end();
  }
});

module.exports = router;
