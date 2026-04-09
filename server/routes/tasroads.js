// Tasmania traffic counting stations — Drakewell/DoT data
// API requires an ASP session cookie established from the public map page first.
const express = require('express');
const https   = require('https');
const router  = express.Router();

const BASE     = 'tasmaniatrafficdata.drakewell.com';
const REFERRER = 'https://tasmaniatrafficdata.drakewell.com/publicmultinodemap.asp';
const UA       = 'Mozilla/5.0 (compatible; StrayaNow/1.0)';

// In-memory session + cache
let _sessionCookie = null;
let _sessionAge    = 0;
const SESSION_TTL  = 15 * 60 * 1000; // ASP sessions expire ~20min; refresh every 15

let _sitesCache    = null;
let _sitesCacheTs  = 0;
const SITES_TTL    = 60 * 60 * 1000; // sites don't move — cache 1 hour

// ── HTTP helpers ──────────────────────────────────────────────────────────────

function httpsGet(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get({ hostname: BASE, path, headers }, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
  });
}

function httpsPost(path, data, headers = {}) {
  const body = JSON.stringify(data);
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: BASE, path, method: 'POST',
      headers: {
        'Content-Type':    'application/json',
        'Content-Length':  Buffer.byteLength(body),
        'X-Requested-With': 'XMLHttpRequest',
        'User-Agent':      UA,
        ...headers,
      },
    }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: buf }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(body);
    req.end();
  });
}

// ── Session management ────────────────────────────────────────────────────────

async function ensureSession() {
  if (_sessionCookie && Date.now() - _sessionAge < SESSION_TTL) return _sessionCookie;

  const res = await httpsGet('/publicmultinodemap.asp', { 'User-Agent': UA });
  const setCookie = res.headers['set-cookie'] || [];
  const cookie = setCookie.map(c => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('No session cookie from Drakewell');

  _sessionCookie = cookie;
  _sessionAge    = Date.now();
  console.log('[tasroads] New ASP session established');
  return cookie;
}

// ── Data fetching ─────────────────────────────────────────────────────────────

// Speed limit comes in as mm/s-ish internal units — multiply by jsSpeedFactor (0.0036) → km/h
function toKmh(raw) {
  if (!raw || raw <= 0) return null;
  return Math.round(raw * 0.0036);
}

const NODE_LABELS = {
  TAS_PERM:   'Permanent CCS',
  TAS_SHORT:  'Short-term',
  TAS_ACTIVE: 'Active Travel',
};

async function fetchSites() {
  if (_sitesCache && Date.now() - _sitesCacheTs < SITES_TTL) return _sitesCache;

  const cookie = await ensureSession();
  const res = await httpsPost('/dataserver/sites', { array: true }, {
    Cookie:  cookie,
    Referer: REFERRER,
  });

  if (!res.body.startsWith('{')) {
    // Session probably expired despite TTL — clear and retry once
    _sessionCookie = null;
    const cookie2 = await ensureSession();
    const res2 = await httpsPost('/dataserver/sites', { array: true }, {
      Cookie:  cookie2,
      Referer: REFERRER,
    });
    res.body = res2.body;
  }

  const json = JSON.parse(res.body);
  const raw  = json.data || [];

  // Filter to active, located stations
  const sites = raw
    .filter(s =>
      s.location?.lat && s.location?.lng &&
      !s.isDisabled
    )
    .map(s => ({
      id:          s.id,
      name:        s.name,
      description: s.description,
      node:        s.node,
      nodeLabel:   NODE_LABELS[s.node] || s.node,
      lat:         s.location.lat,
      lon:         s.location.lng,
      bearing:     s.bearing || 0,
      speedLimit:  toKmh(s.speedLimit),
      tz:          s.parameters?.tz || 'Australia/Tasmania',
    }));

  _sitesCache   = sites;
  _sitesCacheTs = Date.now();
  console.log(`[tasroads] ${sites.length} active stations loaded`);
  return sites;
}

// ── Routes ────────────────────────────────────────────────────────────────────

router.get('/sites', async (req, res) => {
  try {
    res.json(await fetchSites());
  } catch (e) {
    console.error('[tasroads] sites error:', e.message);
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
