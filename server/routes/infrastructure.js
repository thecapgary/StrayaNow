const express = require('express');
const path = require('path');
const router = express.Router();

const DATA_DIR = path.join(__dirname, '..', '..', 'data', 'infrastructure');

// Serve infrastructure GeoJSON files by name
router.get('/:layer', (req, res) => {
  const file = path.join(DATA_DIR, `${req.params.layer}.geojson`);
  res.sendFile(file, err => {
    if (err) res.status(404).json({ error: `Layer '${req.params.layer}' not found` });
  });
});

// List available layers
router.get('/', (req, res) => {
  const fs = require('fs');
  try {
    const files = fs.readdirSync(DATA_DIR).filter(f => f.endsWith('.geojson'));
    res.json({ layers: files.map(f => f.replace('.geojson', '')) });
  } catch {
    res.json({ layers: [] });
  }
});

module.exports = router;
