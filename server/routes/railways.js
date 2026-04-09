// Tasmania railway network — OpenStreetMap data via Overpass API
// Track geometry + stations/halts for OpenRailwayMap-style rendering
const express = require('express');
const https   = require('https');
const router  = express.Router();

let _cache   = null;
let _cacheTs = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours — OSM data rarely changes

// ── HTTP helper ────────────────────────────────────────────────────────────────

function overpassPost(query) {
  return new Promise((resolve, reject) => {
    const body = `data=${encodeURIComponent(query)}`;
    const req = https.request({
      hostname: 'overpass-api.de',
      path:     '/api/interpreter',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent':     'StrayaNow/1.0',
      },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve(buf));
    });
    req.on('error', reject);
    req.setTimeout(35000, () => { req.destroy(); reject(new Error('Overpass timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Styling helpers ────────────────────────────────────────────────────────────

function trackColor(tags) {
  const rwy = tags.railway || '';
  if (rwy === 'abandoned') return '#777';
  if (rwy === 'disused')   return '#999';
  if (rwy === 'preserved') return '#c8a265';
  const usage = tags.usage || '';
  if (usage === 'main') return '#ff8c00';
  return '#ffd700'; // branch / industrial / unclassified
}

function trackLabel(tags) {
  const rwy = tags.railway || '';
  if (rwy === 'abandoned') return 'Abandoned';
  if (rwy === 'disused')   return 'Disused';
  if (rwy === 'preserved') return 'Preserved';
  const usage = tags.usage || '';
  if (usage === 'main')   return 'Main line';
  if (usage === 'branch') return 'Branch line';
  return 'Branch line';
}

// ── Data fetch ─────────────────────────────────────────────────────────────────

async function fetchRailData() {
  if (_cache && Date.now() - _cacheTs < CACHE_TTL) return _cache;

  // Tasmania bounding box: S -44, W 143.5, N -39.5, E 148.5
  const query = `
[out:json][timeout:30][bbox:-44,143.5,-39.5,148.5];
(
  way["railway"~"^(rail|narrow_gauge|preserved|disused|abandoned|light_rail)$"];
  node["railway"~"^(station|halt|yard|junction)$"];
);
out body;
>;
out skel qt;
`;

  const raw  = await overpassPost(query);
  if (!raw.startsWith('{')) throw new Error(`Overpass returned unexpected: ${raw.slice(0, 80)}`);
  const json = JSON.parse(raw);

  // Build node ID → coordinate lookup
  const nodeMap = {};
  for (const el of json.elements) {
    if (el.type === 'node') nodeMap[el.id] = el;
  }

  const tracks   = [];
  const stations = [];

  for (const el of json.elements) {
    if (el.type === 'way') {
      const coords = (el.nodes || [])
        .map(id => nodeMap[id])
        .filter(Boolean)
        .map(n => [n.lon, n.lat]);
      if (coords.length >= 2) {
        const tags = el.tags || {};
        tracks.push({
          id:      el.id,
          coords,
          name:    tags.name || tags.ref || '',
          railway: tags.railway || 'rail',
          usage:   tags.usage  || '',
          color:   trackColor(tags),
          label:   trackLabel(tags),
        });
      }
    } else if (el.type === 'node') {
      const tags = el.tags || {};
      const rwy  = tags.railway || '';
      if (['station', 'halt', 'yard', 'junction'].includes(rwy)) {
        stations.push({
          id:       el.id,
          name:     tags.name || tags.ref || `${rwy} #${el.id}`,
          railway:  rwy,
          lat:      el.lat,
          lon:      el.lon,
          operator: tags.operator || '',
          network:  tags.network  || '',
        });
      }
    }
  }

  _cache   = { tracks, stations };
  _cacheTs = Date.now();
  console.log(`[railways] ${tracks.length} track segments, ${stations.length} operating sites loaded`);
  return _cache;
}

// ── Routes ─────────────────────────────────────────────────────────────────────

router.get('/data', async (req, res) => {
  try {
    res.json(await fetchRailData());
  } catch (e) {
    console.error('[railways] error:', e.stack || e.message || e);
    res.status(502).json({ error: e.message || String(e) });
  }
});

module.exports = router;
