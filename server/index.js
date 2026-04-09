require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const http = require('http');
const path = require('path');
const WebSocket = require('ws');

const flightsRouter = require('./routes/flights');
const satellitesRouter = require('./routes/satellites');
const seismicRouter = require('./routes/seismic');
const shipsRouter = require('./routes/ships');
const infrastructureRouter = require('./routes/infrastructure');
const tracerouteRouter = require('./routes/traceroute');
const settingsRouter   = require('./routes/settings');
const weatherRouter    = require('./routes/weather');
const listmapsRouter   = require('./routes/listmaps');
const { router: tidesRouter } = require('./routes/tides');
const trafficflowRouter = require('./routes/trafficflow');
const tasroadsRouter    = require('./routes/tasroads');
const railwaysRouter    = require('./routes/railways');
const hereRouter        = require('./routes/here');
const radarRouter       = require('./routes/radar');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;

app.use(express.json());
// Static files
app.use(express.static(path.join(__dirname, '..', 'public')));

// Config endpoint — exposes tokens to frontend
app.get('/api/config', (req, res) => {
  res.json({
    cesiumToken: process.env.CESIUM_TOKEN || '',
    googleMapsKey: process.env.GOOGLE_MAPS_KEY || '',
  });
});

// API routes
app.use('/api/flights', flightsRouter);
flightsRouter.startPoller(); // background OpenSky collector
app.use('/api/satellites', satellitesRouter);
app.use('/api/seismic', seismicRouter);
app.use('/api/ships', shipsRouter);
app.use('/api/infrastructure', infrastructureRouter);
app.use('/api/traceroute', tracerouteRouter);
app.use('/api/settings',  settingsRouter);
app.use('/api/weather',   weatherRouter);
app.use('/api/listmaps',  listmapsRouter);
app.use('/api/tides',       tidesRouter);
app.use('/api/trafficflow', trafficflowRouter);
app.use('/api/tasroads',   tasroadsRouter);
app.use('/api/railways',   railwaysRouter);
app.use('/api/here',       hereRouter);
app.use('/api/radar',      radarRouter);

// WebSocket server — broadcasts ship + flight updates to all connected browsers
const wss = new WebSocket.Server({ noServer: true });
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
});

// Device WebSocket — receives GPS from /gps mobile page, relays to viewer clients
const wssDevice = new WebSocket.Server({ noServer: true });
let _lastGps = null;

wssDevice.on('connection', (ws) => {
  console.log('[gps] Device connected');
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw));
      if (msg.type === 'gps') {
        _lastGps = { ...msg, serverTs: Date.now() };
        broadcast('gps', _lastGps);
      } else if (msg.type === 'gps_stop') {
        broadcast('gps_stop', {});
      }
    } catch {}
  });
  ws.on('close', () => {
    console.log('[gps] Device disconnected');
    broadcast('gps_stop', {});
  });
});

// Last known GPS position (for clients that connect after device is already tracking)
app.get('/api/gps/last', (req, res) => {
  res.json(_lastGps || { lat: null, lon: null });
});

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/ws') {
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  } else if (req.url === '/ws/device') {
    wssDevice.handleUpgrade(req, socket, head, ws => wssDevice.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});

// Broadcast a message to all connected browser clients
function broadcast(type, payload) {
  const msg = JSON.stringify({ type, payload, ts: Date.now() });
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(msg);
  }
}

// Start AIS ship collector if key is available
if (process.env.AISSTREAM_KEY) {
  startAISCollector(broadcast, shipsRouter.updateCache);
}

function startAISCollector(broadcast, updateCache) {
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
  ws.on('open', () => {
    console.log('AIS stream connected');
    ws.send(JSON.stringify({
      APIKey: process.env.AISSTREAM_KEY,
      BoundingBoxes: [
        // Australian waters: Bass Strait, Torres Strait, Coral Sea, Indian Ocean approach
        [[-44.0, 112.0], [-10.0, 154.0]],
      ],
      FilterMessageTypes: ['PositionReport', 'StandardClassBPositionReport'],
    }));
  });

  let _aisCount = 0;
  ws.on('message', (raw) => {
    try {
      // ws v8 delivers Buffer — convert to string
      const str = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw);
      const msg = JSON.parse(str);

      // Log first few raw messages for debugging
      if (_aisCount < 3) {
        console.log(`[AIS msg #${++_aisCount}] type=${msg.MessageType} meta=${JSON.stringify(msg.MetaData?.MMSI)}`);
      } else {
        _aisCount++;
      }

      const pos = msg.Message?.PositionReport || msg.Message?.StandardClassBPositionReport;
      if (!pos) return;

      const vessel = {
        mmsi: msg.MetaData?.MMSI,
        name: (msg.MetaData?.ShipName || '').trim() || `MMSI-${msg.MetaData?.MMSI}`,
        lat: pos.Latitude,
        lon: pos.Longitude,
        sog: pos.Sog,
        cog: pos.Cog,
        heading: pos.TrueHeading,
        status: pos.NavigationalStatus,
        ts: msg.MetaData?.time_utc,
        type: msg.MetaData?.ShipType,
        flag: msg.MetaData?.flag,
        imo: msg.MetaData?.IMO,
      };

      broadcast('ship', vessel);

      // Accumulate into ships route cache
      if (typeof shipsRouter.updateCache === 'function') {
        // Build snapshot update (handled via in-memory accumulation)
        if (!global._shipVessels) global._shipVessels = {};
        global._shipVessels[vessel.mmsi] = vessel;
        // Periodically flush to disk
        if (!global._shipFlushTimer) {
          global._shipFlushTimer = setInterval(() => {
            if (global._shipVessels && Object.keys(global._shipVessels).length > 0) {
              shipsRouter.updateCache(global._shipVessels);
            }
          }, 10000);
        }
      }
    } catch (e) { /* ignore parse errors */ }
  });

  ws.on('close', () => {
    console.log('AIS stream closed, reconnecting in 10s...');
    setTimeout(() => startAISCollector(broadcast, updateCache), 10000);
  });

  ws.on('error', (err) => console.error('AIS error:', err.message));
}

server.listen(PORT, () => {
  console.log(`StrayaNow running at http://localhost:${PORT}`);
  if (process.env.GOOGLE_MAPS_KEY) console.log('  Google 3D Tiles: enabled');
  if (process.env.AISSTREAM_KEY)   console.log('  AIS ship stream: enabled');
  if (process.env.CESIUM_TOKEN)    console.log('  Cesium Ion: enabled');
});

module.exports = { broadcast };
