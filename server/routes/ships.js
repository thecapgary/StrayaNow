const express = require('express');
const fs = require('fs');
const path = require('path');
const router = express.Router();

const SHIPS_FILE = path.join(__dirname, '..', '..', 'data', 'ships', 'latest.json');

// In-memory ship cache — updated by the WebSocket collector
let shipCache = { vessels: {}, updated_at: null };

function loadFromDisk() {
  try {
    if (fs.existsSync(SHIPS_FILE)) {
      shipCache = JSON.parse(fs.readFileSync(SHIPS_FILE, 'utf8'));
    }
  } catch (e) { /* ignore */ }
}

loadFromDisk();

// Allow the WebSocket collector (in index.js) to push updates
router.updateCache = (vessels) => {
  shipCache = { vessels, updated_at: new Date().toISOString() };
  fs.writeFileSync(SHIPS_FILE, JSON.stringify(shipCache), 'utf8');
};

router.get('/latest', (req, res) => {
  const vessels = Object.values(shipCache.vessels || {});
  res.json({
    count: vessels.length,
    vessels,
    updated_at: shipCache.updated_at,
  });
});

module.exports = router;
