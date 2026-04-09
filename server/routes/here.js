// HERE Traffic Incidents v7 — crashes, roadworks, closures for Tasmania
// Supports HERE OAuth 2.0 (preferred) or API key fallback
const express          = require('express');
const https            = require('https');
const { getOAuthToken } = require('./here-oauth');
const router           = express.Router();

let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL = 5 * 60 * 1000;

const KIND_META = {
  ACCIDENT:     { label: 'Accident',   color: '#f44336' },
  ROAD_CLOSED:  { label: 'Road Closed',color: '#9c27b0' },
  CONSTRUCTION: { label: 'Roadworks',  color: '#ff9800' },
  CONGESTION:   { label: 'Congestion', color: '#ffeb3b' },
  MASS_EVENT:   { label: 'Mass Event', color: '#00bcd4' },
  OTHER:        { label: 'Incident',   color: '#8bc34a' },
};

function criticality(n) {
  if (n === 1) return 'CRITICAL';
  if (n === 2) return 'MAJOR';
  if (n === 3) return 'MINOR';
  return 'LOW';
}

// ── HTTPS GET helper ──────────────────────────────────────────────────────────

function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { 'User-Agent': 'StrayaNow/1.0', Accept: 'application/json', ...headers } }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('HERE timeout')); });
  });
}

// ── Incident fetch ────────────────────────────────────────────────────────────

function extractPoint(inc) {
  // shape locationReferencing — geometry as { lat, lng } point list
  const links  = inc.location?.shape?.links || [];
  const points = links[0]?.points || [];
  if (points[0]?.lat) return points[0];

  // Fallback: some responses use a flat point array
  const flatPts = inc.location?.shape?.points || [];
  if (flatPts[0]?.lat) return flatPts[0];

  // Last resort: look for a single anchor point
  const anchor = inc.location?.position || inc.location?.anchor;
  if (anchor?.lat) return anchor;

  return null;
}

function parseIncidents(data) {
  const raw = data.incidents || data.INCIDENTS || [];
  console.log(`[here] raw incidents count: ${raw.length}`);
  if (raw.length > 0) console.log('[here] sample incident keys:', Object.keys(raw[0]).join(', '));

  return raw.map(inc => {
    const det  = inc.incidentDetails || inc;
    const kind = det.type?.kind || 'OTHER';
    const meta = KIND_META[kind] || KIND_META.OTHER;
    const pt   = extractPoint(inc);
    if (!pt) return null;
    return {
      id:          det.id || inc.id || Math.random().toString(36).slice(2),
      kind,
      label:       meta.label,
      color:       meta.color,
      criticality: criticality(det.type?.criticality ?? 4),
      description: det.description?.value || det.summary?.value || meta.label,
      roadClosed:  !!det.roadClosed,
      startTime:   det.startTime || null,
      endTime:     det.endTime   || null,
      lat:         pt.lat,
      lon:         pt.lng,
    };
  }).filter(Boolean);
}

// HERE v7 limits bbox to 1°×1° max — tile Tasmania into 0.9° cells
// Covers populated road network; skips uninhabited wilderness/ocean
const TASMANIA_TILES = (() => {
  const boxes = [];
  const STEP = 0.9;
  for (let lon = 143.5; lon < 148.5; lon += STEP) {
    for (let lat = -44.0; lat < -39.5; lat += STEP) {
      boxes.push([
        lon.toFixed(3),
        lat.toFixed(3),
        Math.min(lon + STEP, 148.5).toFixed(3),
        Math.min(lat + STEP, -39.5).toFixed(3),
      ]);
    }
  }
  return boxes; // ~30 cells
})();

async function fetchOneTile(w, s, e, n, authHeaders, apiKey) {
  let url = `https://data.traffic.hereapi.com/v7/incidents?in=bbox:${w},${s},${e},${n}&locationReferencing=shape`;
  if (apiKey) url += `&apiKey=${encodeURIComponent(apiKey)}`;
  const res = await httpsGet(url, authHeaders);
  if (res.status === 401 || res.status === 403) throw new Error(`auth_${res.status}`);
  if (res.status !== 200) return []; // empty tile or transient error — skip
  try {
    return parseIncidents(JSON.parse(res.body));
  } catch { return []; }
}

async function fetchIncidents() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;

  const token = await getOAuthToken().catch(() => null);
  if (!token && !process.env.HERE_API_KEY) return [];

  const authHeaders = token ? { Authorization: `Bearer ${token}` } : {};
  const apiKey      = token ? null : process.env.HERE_API_KEY;

  // Query all tiles in parallel, deduplicate by incident ID
  const results = await Promise.allSettled(
    TASMANIA_TILES.map(([w, s, e, n]) =>
      fetchOneTile(w, s, e, n, authHeaders, apiKey)
    )
  );

  const seen = new Set();
  const incidents = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const inc of r.value) {
      if (!seen.has(inc.id)) { seen.add(inc.id); incidents.push(inc); }
    }
  }

  _cache   = incidents;
  _cacheTs = Date.now();
  console.log(`[here] ${incidents.length} incidents across ${TASMANIA_TILES.length} tiles`);
  return incidents;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/incidents', async (req, res) => {
  try {
    res.json(await fetchIncidents());
  } catch (e) {
    console.error('[here] error:', e.message);
    res.status(502).json({ error: e.message });
  }
});


module.exports = router;
