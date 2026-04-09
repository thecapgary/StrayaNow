const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const WebSocket = require('ws');
const router = express.Router();

const ENV_PATH = path.join(__dirname, '..', '..', '.env');

// Keys we expose to the settings UI
// validates:     has a live ping endpoint
// validatesWith: password fields defer to the paired username validator
const SETTINGS = [
  {
    id: 'cesium',
    label: 'Cesium Ion Token',
    key: 'CESIUM_TOKEN',
    hint: 'Required for terrain + Cesium base layers. Get one free at cesium.com/ion',
    layer: 'Globe',
    validates: true,
  },
  {
    id: 'google',
    label: 'Google Maps API Key',
    key: 'GOOGLE_MAPS_KEY',
    hint: 'Enables Google Photorealistic 3D Tiles. Needs "Map Tiles API" enabled in GCP.',
    layer: 'Map / 3D',
    validates: true,
  },
  {
    id: 'aisstream',
    label: 'AISStream API Key',
    key: 'AISSTREAM_KEY',
    hint: 'Live ship AIS positions over Australian waters. Free at aisstream.io',
    layer: 'Ships',
    validates: true,
  },
  {
    id: 'opensky_user',
    label: 'OpenSky Username',
    key: 'OPENSKY_USER',
    hint: 'Optional — increases flight API rate limits. Register at opensky-network.org',
    layer: 'Flights',
    validates: true,
  },
  {
    id: 'opensky_pass',
    label: 'OpenSky Password',
    key: 'OPENSKY_PASS',
    hint: 'OpenSky password (paired with username above).',
    layer: 'Flights',
    secret: true,
    validatesWith: 'opensky_user',
  },
  {
    id: 'spacetrack_user',
    label: 'Space-track.org Username',
    key: 'SPACETRACK_USER',
    hint: 'Higher-quality TLE satellite data. Free account at space-track.org',
    layer: 'Satellites',
    validates: true,
  },
  {
    id: 'spacetrack_pass',
    label: 'Space-track.org Password',
    key: 'SPACETRACK_PASS',
    hint: 'Space-track password (paired with username above).',
    layer: 'Satellites',
    secret: true,
    validatesWith: 'spacetrack_user',
  },
  {
    id: 'tomtom',
    label: 'TomTom API Key',
    key: 'TOMTOM_KEY',
    hint: 'Real-time traffic flow data. Free tier at developer.tomtom.com (2,500 req/day).',
    layer: 'Traffic',
    validates: true,
  },
  {
    id: 'osm_user',
    label: 'OpenStreetMap Email',
    key: 'OSM_USER',
    hint: 'Optional — Traffic uses public Overpass API (no login needed). OSM email for future Nominatim geocoding.',
    layer: 'Traffic / Maps',
  },
  {
    id: 'here_key_id',
    label: 'HERE Access Key ID',
    key: 'HERE_ACCESS_KEY_ID',
    hint: 'HERE OAuth 2.0 credential — from your HERE project → Access credentials. Used for Traffic Incidents.',
    layer: 'Incidents',
    validates: true,
  },
  {
    id: 'here_key_secret',
    label: 'HERE Access Key Secret',
    key: 'HERE_ACCESS_KEY_SECRET',
    hint: 'HERE OAuth 2.0 secret (paired with Access Key ID above).',
    layer: 'Incidents',
    secret: true,
    validatesWith: 'here_key_id',
  },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

function mask(val) {
  if (!val) return '';
  if (val.length <= 4) return '****';
  return '*'.repeat(Math.min(val.length - 4, 12)) + val.slice(-4);
}

function readEnv() {
  try {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    const map = {};
    for (const line of lines) {
      const m = line.match(/^([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) map[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
    return map;
  } catch { return {}; }
}

function writeEnvKey(key, value) {
  let content = '';
  try { content = fs.readFileSync(ENV_PATH, 'utf8'); } catch {}
  const lines = content.split('\n');
  const idx = lines.findIndex(l => l.match(new RegExp(`^${key}\\s*=`)));
  const newLine = `${key}=${value}`;
  if (idx >= 0) lines[idx] = newLine;
  else lines.push(newLine);
  fs.writeFileSync(ENV_PATH, lines.filter((l, i) => l || i < lines.length - 1).join('\n'));
}

// Simple HTTPS GET → resolves with { status, body, headers }
function httpsGet(url, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpsPost(url, postData, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname + urlObj.search,
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData), ...headers },
      // headers arg intentionally last so callers can override Content-Type
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body, headers: res.headers }));
    });
    req.on('error', reject);
    req.setTimeout(8000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(postData);
    req.end();
  });
}

// ── Validators ────────────────────────────────────────────────────────────────

async function validateCesium() {
  const token = process.env.CESIUM_TOKEN;
  if (!token) return { status: 'unset' };
  try {
    const r = await httpsGet('https://api.cesium.com/v1/me', { Authorization: `Bearer ${token}` });
    if (r.status === 200) return { status: 'ok', message: 'Cesium Ion connected' };
    if (r.status === 401) return { status: 'invalid', message: 'Token rejected (401)' };
    return { status: 'error', message: `HTTP ${r.status}` };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function validateGoogle() {
  const key = process.env.GOOGLE_MAPS_KEY;
  if (!key) return { status: 'unset' };
  try {
    // Validate via Map Tiles API createSession — the exact API StrayaNow uses
    const body = JSON.stringify({ mapType: 'roadmap', language: 'en-US', region: 'AU' });
    const r = await httpsPost(`https://tile.googleapis.com/v1/createSession?key=${key}`, body, {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    });
    const parsed = JSON.parse(r.body);
    if (r.status === 200 && parsed.session) return { status: 'ok', message: 'Map Tiles API connected' };
    if (r.status === 400 || r.status === 403) return { status: 'invalid', message: parsed.error?.message || `Key rejected (${r.status})` };
    return { status: 'error', message: `HTTP ${r.status}` };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function validateAIS() {
  const key = process.env.AISSTREAM_KEY;
  if (!key) return { status: 'unset' };
  return new Promise(resolve => {
    let done = false;
    const finish = (result) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try { ws.terminate(); } catch {}
      resolve(result);
    };

    const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
    // If no message within 10s, assume key is valid (no ships nearby is ok)
    const timer = setTimeout(() => finish({ status: 'ok', message: 'Connected (awaiting data)' }), 10000);

    ws.on('open', () => {
      ws.send(JSON.stringify({
        APIKey: key,
        BoundingBoxes: [[[-90, -180], [90, 180]]],
        FilterMessageTypes: ['PositionReport'],
      }));
    });
    ws.on('message', () => finish({ status: 'ok', message: 'Live AIS data received' }));
    ws.on('close', (code) => {
      if (!done) finish({ status: 'invalid', message: `Connection rejected (code ${code})` });
    });
    ws.on('error', e => finish({ status: 'error', message: e.message }));
  });
}

async function validateOpenSky() {
  const user = process.env.OPENSKY_USER;
  const pass = process.env.OPENSKY_PASS;
  if (!user) return { status: 'unset' };
  if (!pass) return { status: 'unverified', message: 'Username set — add password to verify' };
  try {
    const auth = Buffer.from(`${user}:${pass}`).toString('base64');
    // Tiny bbox around Hobart — just need a valid 200
    const r = await httpsGet(
      'https://opensky-network.org/api/states/all?lamin=-43&lamax=-42&lomin=147&lomax=148',
      { Authorization: `Basic ${auth}` }
    );
    if (r.status === 200) return { status: 'ok', message: 'OpenSky authenticated' };
    if (r.status === 401) return { status: 'invalid', message: 'Credentials rejected (401)' };
    if (r.status === 429) return { status: 'ok', message: 'Rate limited — but credentials valid' };
    return { status: 'error', message: `HTTP ${r.status}` };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function validateSpaceTrack() {
  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;
  if (!user) return { status: 'unset' };
  if (!pass) return { status: 'unverified', message: 'Username set — add password to verify' };
  try {
    const postData = `identity=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
    const r = await httpsPost('https://www.space-track.org/ajaxauth/login', postData);
    // Success: sets a session cookie and returns {}
    const hasCookie = (r.headers['set-cookie'] || []).some(c => c.includes('chocolatechip'));
    const body = JSON.parse(r.body || '{}');
    if (hasCookie || body.Login === 'success' || r.status === 200) {
      return { status: 'ok', message: 'Space-track login successful' };
    }
    return { status: 'invalid', message: 'Login failed — check credentials' };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function validateTomTom() {
  const key = process.env.TOMTOM_KEY;
  if (!key) return { status: 'unset' };
  try {
    const r = await httpsGet(
      `https://api.tomtom.com/traffic/services/4/flowSegmentData/absolute/10/json?point=-42.88,147.33&unit=KMPH&key=${key}`
    );
    if (r.status === 200) return { status: 'ok', message: 'TomTom traffic connected' };
    if (r.status === 403) return { status: 'invalid', message: 'API key rejected (403)' };
    if (r.status === 429) return { status: 'ok', message: 'Rate limited — but key valid' };
    return { status: 'error', message: `HTTP ${r.status}` };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

async function validateHere() {
  const id     = process.env.HERE_ACCESS_KEY_ID;
  const secret = process.env.HERE_ACCESS_KEY_SECRET;
  if (!id) return { status: 'unset' };
  if (!secret) return { status: 'unverified', message: 'Access Key ID set — add Secret to verify' };
  try {
    // Get OAuth token then hit a small Tasmania bbox
    const { getOAuthToken } = require('./here-oauth');
    const token = await getOAuthToken(id, secret);
    const r = await httpsGet(
      'https://data.traffic.hereapi.com/v7/incidents?in=bbox:147.0,-43.0,147.5,-42.5&locationReferencing=olr',
      { Authorization: `Bearer ${token}`, Accept: 'application/json' }
    );
    if (r.status === 200) return { status: 'ok', message: 'HERE Traffic connected via OAuth 2.0' };
    if (r.status === 401 || r.status === 403) return { status: 'invalid', message: `Credentials rejected (${r.status})` };
    return { status: 'error', message: `HTTP ${r.status}` };
  } catch (e) {
    return { status: 'error', message: e.message };
  }
}

const VALIDATORS = {
  cesium:          validateCesium,
  google:          validateGoogle,
  aisstream:       validateAIS,
  opensky_user:    validateOpenSky,
  spacetrack_user: validateSpaceTrack,
  tomtom:          validateTomTom,
  here_key_id:     validateHere,
};

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/', (req, res) => {
  const env = readEnv();
  res.json(SETTINGS.map(s => ({
    id:            s.id,
    label:         s.label,
    key:           s.key,
    hint:          s.hint,
    layer:         s.layer,
    set:           !!process.env[s.key],
    masked:        mask(process.env[s.key] || env[s.key]),
    secret:        !!s.secret,
    validates:     !!s.validates,
    validatesWith: s.validatesWith || null,
  })));
});

router.post('/', express.json(), (req, res) => {
  const { key, value } = req.body || {};
  const allowed = SETTINGS.map(s => s.key);
  if (!key || !allowed.includes(key)) return res.status(400).json({ error: 'Unknown key' });
  const trimmed = (value || '').trim();
  if (trimmed) {
    process.env[key] = trimmed;
    try { writeEnvKey(key, trimmed); } catch (e) { console.warn('Could not write .env:', e.message); }
  } else {
    delete process.env[key];
    try { writeEnvKey(key, ''); } catch {}
  }
  res.json({ ok: true, key, set: !!trimmed });
});

// GET /api/settings/validate?id=tomtom  →  { status, message }
// status: 'ok' | 'invalid' | 'error' | 'unset' | 'unverified'
router.get('/validate', async (req, res) => {
  const fn = VALIDATORS[req.query.id];
  if (!fn) return res.json({ status: 'unset', message: 'No validator for this service' });
  try {
    res.json(await fn());
  } catch (e) {
    res.json({ status: 'error', message: e.message });
  }
});

module.exports = router;
