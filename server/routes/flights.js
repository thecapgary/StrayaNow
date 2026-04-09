const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');

const router = express.Router();
const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'flights');

// airplanes.live — free community ADS-B, covers all of Australia, no auth needed
// Point + radius endpoint: /v2/point/{lat}/{lon}/{radius_nm}
// Australia centre -27, 134 — 2500nm radius covers the continent + surrounding waters
const ADSBX_URL = 'https://api.airplanes.live/v2/point/-27/134/2500';

// Normalise an airplanes.live aircraft object to the OpenSky field names
// used throughout the rest of the codebase
function normalise(ac) {
  const ftToM = ft => ft == null ? null : Math.round(ft * 0.3048);
  const ktsToMs = kts => kts == null ? null : parseFloat((kts * 0.514444).toFixed(1));
  return {
    icao24:         ac.hex || '',
    callsign:       (ac.flight || ac.r || '').trim(),
    origin_country: ac.r || '',           // registration prefix (best proxy)
    longitude:      ac.lon ?? null,
    latitude:       ac.lat ?? null,
    baro_altitude:  ftToM(ac.alt_baro === 'ground' ? 0 : ac.alt_baro),
    geo_altitude:   ftToM(ac.alt_geom),
    on_ground:      ac.alt_baro === 'ground',
    velocity:       ktsToMs(ac.gs),
    true_track:     ac.track ?? null,
    vertical_rate:  ac.baro_rate != null ? parseFloat((ac.baro_rate * 0.00508).toFixed(2)) : null,
    squawk:         ac.squawk || null,
    // extras
    aircraft_type:  ac.t  || null,
    aircraft_desc:  ac.desc || null,
    registration:   ac.r  || null,
  };
}

function fetchAdsbx() {
  return new Promise((resolve, reject) => {
    const req = https.get(ADSBX_URL, { headers: { 'User-Agent': 'StrayaNow/1.0' } }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          const states_named = (parsed.ac || [])
            .filter(ac => ac.lat != null && ac.lon != null)
            .map(normalise);
          resolve({ states_named, _source: 'airplanes.live', _collected_at: new Date().toISOString() });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

// All snapshots with aircraft, for playback
router.get('/history', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
    const snapshots = files
      .map(f => { try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), 'utf8')); } catch { return null; } })
      .filter(s => s && s.states_named && s.states_named.length > 0);
    res.json(snapshots);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Most recent snapshot
router.get('/latest', (req, res) => {
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
    for (let i = files.length - 1; i >= 0; i--) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(DATA_DIR, files[i]), 'utf8'));
        if (data.states_named && data.states_named.length > 0) return res.json(data);
      } catch {}
    }
    res.json({ states_named: [], time: null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Background poller — fetches from airplanes.live every 60s, saves to disk
let _pollTimer = null;
router.startPoller = function () {
  if (_pollTimer) return;
  async function poll() {
    try {
      const snapshot = await fetchAdsbx();
      if (snapshot.states_named.length > 0) {
        const fname = `flights_${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
        fs.writeFileSync(path.join(DATA_DIR, fname), JSON.stringify(snapshot));
        // Keep only last 60 snapshots
        const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.json')).sort();
        if (files.length > 60) files.slice(0, files.length - 60).forEach(f => {
          try { fs.unlinkSync(path.join(DATA_DIR, f)); } catch {}
        });
        console.log(`[flights] ${snapshot.states_named.length} aircraft (airplanes.live)`);
      }
    } catch (e) {
      console.warn('[flights] poll error:', e.message);
    }
  }
  poll();
  _pollTimer = setInterval(poll, 60 * 1000);
};

// Live proxy — instant fetch
router.get('/live', async (req, res) => {
  try {
    const snapshot = await fetchAdsbx();
    res.json(snapshot);
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});

module.exports = router;
