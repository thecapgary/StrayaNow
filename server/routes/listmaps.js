// Server-side proxy for LIST ArcGIS identify queries (avoids browser CORS)
const express = require('express');
const https = require('https');
const router = express.Router();

const LIST_BASE = 'https://services.thelist.tas.gov.au/arcgis/rest/services';

// Allowlist of services we'll proxy identify requests to
const ALLOWED_SERVICES = new Set([
  'Public/CadastreAndAdministrative',
  'Public/CadastreParcels',
  'Public/Planning',
  'Public/NaturalEnvironment',
  'Public/MarineAndCoastal',
  'Public/WildFisheries',
  'Public/Infrastructure',
  'Basemaps/Topographic',
]);

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

// GET /api/listmaps/identify?lon=x&lat=y&services=svc1,svc2&extent=w,s,e,n&width=W&height=H
router.get('/identify', async (req, res) => {
  const { lon, lat, services: servicesStr, extent, width = 1200, height = 800 } = req.query;
  if (!lon || !lat) return res.status(400).json({ error: 'lon and lat required' });

  const services = (servicesStr || '').split(',').map(s => s.trim()).filter(s => ALLOWED_SERVICES.has(s));
  if (!services.length) return res.json({ results: [] });

  const mapExtent = extent || `${parseFloat(lon)-1},${parseFloat(lat)-1},${parseFloat(lon)+1},${parseFloat(lat)+1}`;

  const allResults = [];

  await Promise.allSettled(services.map(async (service) => {
    const params = new URLSearchParams({
      geometry: `${lon},${lat}`,
      geometryType: 'esriGeometryPoint',
      sr: '4326',
      layers: 'all',
      tolerance: '8',
      mapExtent,
      imageDisplay: `${width},${height},96`,
      returnGeometry: 'false',
      f: 'json',
    });

    try {
      const url = `${LIST_BASE}/${service}/MapServer/identify?${params}`;
      const data = await fetchJSON(url);
      if (data.results?.length) {
        // Deduplicate by layerName and limit per service
        const seen = new Set();
        for (const r of data.results) {
          if (allResults.length >= 15) break;
          const attrs = {};
          for (const [k, v] of Object.entries(r.attributes || {})) {
            if (v !== null && v !== 'Null' && v !== '' && String(v).trim() !== ''
                && !k.startsWith('OBJECTID') && !k.startsWith('SHAPE') && !k.startsWith('SE_')) {
              attrs[k] = v;
            }
          }
          if (!Object.keys(attrs).length) continue;
          const key = r.layerName + JSON.stringify(attrs);
          if (!seen.has(key)) {
            seen.add(key);
            allResults.push({ layerName: r.layerName, service, attributes: attrs });
          }
        }
      }
    } catch { /* ignore per-service failures */ }
  }));

  res.json({ results: allResults });
});

module.exports = router;
