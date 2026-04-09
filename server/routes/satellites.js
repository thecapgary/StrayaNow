const express = require('express');
const https = require('https');
const router = express.Router();

// Space-track.org queries — requires credentials from .env
const ST_BASE = 'www.space-track.org';

// TLE group queries — use format/3le for name + 2 TLE lines
// DECAY_DATE/null-val = still in orbit; RCS_SIZE/LARGE = big/visible objects
const ST_QUERIES = {
  visual:   '/basicspacedata/query/class/gp/OBJECT_TYPE/PAYLOAD/DECAY_DATE/null-val/PERIOD/%3C128/RCS_SIZE/LARGE/orderby/NORAD_CAT_ID/limit/400/format/3le',
  stations: '/basicspacedata/query/class/gp/NORAD_CAT_ID/25544,41765,48274,54216,57166/format/3le',
  starlink: '/basicspacedata/query/class/gp/OBJECT_NAME/STARLINK~~%25/DECAY_DATE/null-val/PERIOD/%3C128/orderby/NORAD_CAT_ID/limit/400/format/3le',
  active:   '/basicspacedata/query/class/gp/OBJECT_TYPE/PAYLOAD/DECAY_DATE/null-val/PERIOD/%3C128/orderby/NORAD_CAT_ID/limit/600/format/3le',
};

let tleCache = {};      // cleared on restart — format changed to 3le
let tleCacheTime = {};
let sessionCookie = null;
let sessionExpiry = 0;
const CACHE_TTL  = 3600000; // 1 hour TLE cache
const SESSION_TTL = 3600000 * 6; // 6 hour session

function httpsPost(host, path, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host, path, method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
        'User-Agent': 'StrayaNow/1.0',
      },
    }, res => {
      let data = '';
      const cookies = res.headers['set-cookie'] || [];
      res.on('data', c => data += c);
      res.on('end', () => resolve({ data, cookies, status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });
}

function httpsGet(host, path, cookie) {
  return new Promise((resolve, reject) => {
    const req = https.get({ host, path,
      headers: { Cookie: cookie, 'User-Agent': 'StrayaNow/1.0' },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve({ data, status: res.statusCode }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

async function login() {
  const user = process.env.SPACETRACK_USER;
  const pass = process.env.SPACETRACK_PASS;
  if (!user || !pass) throw new Error('SPACETRACK_USER / SPACETRACK_PASS not set');

  const body = `identity=${encodeURIComponent(user)}&password=${encodeURIComponent(pass)}`;
  const res = await httpsPost(ST_BASE, '/ajaxauth/login', body);
  if (res.status !== 200) throw new Error(`Login failed: HTTP ${res.status}`);

  // Extract session cookie
  const cookie = res.cookies
    .map(c => c.split(';')[0])
    .join('; ');
  if (!cookie) throw new Error('No session cookie returned');

  sessionCookie = cookie;
  sessionExpiry = Date.now() + SESSION_TTL;
  return cookie;
}

async function getSession() {
  if (sessionCookie && Date.now() < sessionExpiry) return sessionCookie;
  return login();
}

function parseTLE(text) {
  const lines = text.trim().split('\n').map(l => l.trim()).filter(Boolean);
  const sats = [];
  for (let i = 0; i < lines.length - 2; i += 3) {
    if (!lines[i+1]?.startsWith('1 ') || !lines[i+2]?.startsWith('2 ')) continue;
    // Strip leading "0 " catalog prefix from 3le name lines
    const name = lines[i].replace(/^0\s+/, '').trim() || `NORAD-${lines[i+1].substring(2,7).trim()}`;
    sats.push({ name, tle1: lines[i+1], tle2: lines[i+2] });
  }
  return sats;
}

async function fetchTLE(group) {
  const query = ST_QUERIES[group] || ST_QUERIES.visual;
  const cookie = await getSession();
  const res = await httpsGet(ST_BASE, query, cookie);
  if (res.status === 401) {
    // Session expired mid-flight — re-login once
    sessionCookie = null;
    const cookie2 = await login();
    const res2 = await httpsGet(ST_BASE, query, cookie2);
    if (res2.status !== 200) throw new Error(`Space-track fetch failed: ${res2.status}`);
    return parseTLE(res2.data);
  }
  if (res.status !== 200) throw new Error(`Space-track fetch failed: ${res.status}`);
  return parseTLE(res.data);
}

// GET /api/satellites?group=visual&limit=500
router.get('/', async (req, res) => {
  const group = (req.query.group || 'visual');
  const limit = Math.min(parseInt(req.query.limit) || 500, 2000);

  if (!process.env.SPACETRACK_USER || !process.env.SPACETRACK_PASS) {
    return res.json({ group, count: 0, satellites: [], error: 'Space-track credentials not configured' });
  }

  const now = Date.now();
  if (!tleCache[group] || (now - (tleCacheTime[group] || 0)) > CACHE_TTL) {
    try {
      tleCache[group] = await fetchTLE(group);
      tleCacheTime[group] = now;
    } catch (err) {
      console.warn('Satellites fetch error:', err.message);
      // Return stale cache if available, else error
      if (tleCache[group]?.length) {
        return res.json({ group, count: tleCache[group].length, satellites: tleCache[group].slice(0, limit),
          cached_at: new Date(tleCacheTime[group]).toISOString(), stale: true });
      }
      return res.status(502).json({ error: 'Failed to fetch TLE data', detail: err.message });
    }
  }

  res.json({
    group,
    count: tleCache[group].length,
    satellites: tleCache[group].slice(0, limit),
    cached_at: new Date(tleCacheTime[group]).toISOString(),
  });
});

module.exports = router;
