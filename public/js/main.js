import { initViewer, setMapProvider } from './cesium-init.js';
import { initLandmarks } from './landmarks.js';
import { LandmarksEditor } from './ui/landmarks-editor.js';
import { FlightLayer } from './layers/flights.js';
import { ShipLayer } from './layers/ships.js';
import { SatelliteLayer } from './layers/satellites.js';
import { SeismicLayer } from './layers/seismic.js';
import { TrafficLayer } from './layers/traffic.js';
import { InfrastructureLayer } from './layers/infrastructure.js';
import { ListmapsLayer } from './layers/listmaps.js';
import { TracerouteLayer } from './layers/traceroute.js';
import { WeatherLayer } from './layers/weather.js';
import { TidesLayer } from './layers/tides.js';
import { TasRoadsLayer } from './layers/tasroads.js';
import { RailwayLayer } from './layers/railways.js';
import { HereLayer } from './layers/here.js';
import { GpsLayer } from './layers/gps.js';
import { RadarLayer } from './layers/radar.js';
import { ModeSwitcher } from './ui/mode-switcher.js';
import { LayerPanel } from './ui/layer-panel.js';
import { EntityDetail } from './ui/entity-detail.js';
import { DataPanel } from './ui/data-panel.js';
import { initViewControls } from './ui/view-controls.js';
import { SettingsPanel } from './ui/settings-panel.js';

async function main() {
  // Boot globe
  const viewer = await initViewer();

  // Entity detail / click-to-track
  const detail = new EntityDetail(viewer);

  // Data layers
  const flights   = new FlightLayer(viewer, detail.show.bind(detail));
  const ships     = new ShipLayer(viewer, detail.show.bind(detail));
  const sats      = new SatelliteLayer(viewer, detail.show.bind(detail));
  const seismic   = new SeismicLayer(viewer, detail.show.bind(detail));
  const traffic   = new TrafficLayer(viewer);
  const infra     = new InfrastructureLayer(viewer, detail.show.bind(detail));
  const listmaps   = new ListmapsLayer(viewer);
  const traceroute = new TracerouteLayer(viewer);
  const weather    = new WeatherLayer(viewer, detail.show.bind(detail));
  const tides      = new TidesLayer(viewer);
  const tasroads   = new TasRoadsLayer(viewer, detail.show.bind(detail));
  const railways   = new RailwayLayer(viewer, detail.show.bind(detail));
  const here       = new HereLayer(viewer, detail.show.bind(detail));
  const gps        = new GpsLayer(viewer);
  const radar      = new RadarLayer(viewer);

  // ── Data panel (right side) ──
  const dataPanel = new DataPanel();
  dataPanel.register('flights',   'Live Flights',    '#f9a825', flights);
  dataPanel.register('ships',     'Ships / AIS',     '#00bcd4', ships);
  dataPanel.register('sats',      'Satellites',      '#4fc3f7', sats);
  dataPanel.register('seismic',   'Seismic',         '#ff5722', seismic);
  dataPanel.register('traffic',   'Traffic',         '#ffeb3b', traffic);
  dataPanel.register('infra',     'Infrastructure',  '#ab47bc', infra);
  dataPanel.register('listmaps',  'LIST Maps (TAS)', '#81c784', listmaps);
  dataPanel.register('traceroute','Traceroute',      '#00e5ff', traceroute);
  dataPanel.register('weather',   'Weather / BOM',   '#4fc3f7', weather);
  dataPanel.register('tides',     'Tides',           '#29b6f6', tides);
  dataPanel.register('tasroads',  'TAS Road Sensors','#69f0ae', tasroads);
  dataPanel.register('railways',  'Railways',        '#ff8c00', railways);
  dataPanel.register('here',      'HERE Incidents',  '#f44336', here);
  dataPanel.register('gps',       'My Location',     '#4285f4', gps);
  dataPanel.register('radar',     'Radar',           '#4fc3f7', radar);

  // When any entity/pseudo-entity is selected, handle satellite-specific UI
  detail.onShow = (data) => {
    if (data.type !== 'satellite') return;
    const idx = data.idx;
    sats.highlightIdx(idx);
    panel.enable('sats');
    dataPanel.focus('sats');
    setTimeout(() => {
      const card = document.querySelector(`[data-action="sat-flyto"][data-idx="${idx}"]`);
      if (!card) return;
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      card.style.background = 'rgba(79,195,247,0.12)';
      card.style.outline = '1px solid rgba(79,195,247,0.4)';
      setTimeout(() => { card.style.background = ''; card.style.outline = ''; }, 2500);
    }, 50);
  };
  detail.onDeselect = () => sats.clearHighlight();

  // onDataUpdate hooks — layers call this to refresh the panel when their data changes
  const refreshPanel = (id) => () => {
    if (dataPanel.focused === id) dataPanel.refresh();
  };
  flights.onDataUpdate    = refreshPanel('flights');
  ships.onDataUpdate      = refreshPanel('ships');
  sats.onDataUpdate       = refreshPanel('sats');
  seismic.onDataUpdate    = refreshPanel('seismic');
  infra.onDataUpdate      = refreshPanel('infra');
  listmaps.onDataUpdate   = refreshPanel('listmaps');
  traceroute.onDataUpdate = refreshPanel('traceroute');
  weather.onDataUpdate    = refreshPanel('weather');
  tides.onDataUpdate      = refreshPanel('tides');
  radar.onDataUpdate      = refreshPanel('radar');

  // ── Layer panel config ──
  const layerDefs = [
    { id: 'flights',    label: 'Flights',         color: '#f9a825', layer: flights,    defaultEnabled: true  },
    { id: 'ships',      label: 'Ships / AIS',     color: '#00bcd4', layer: ships,      defaultEnabled: true  },
    { id: 'sats',       label: 'Satellites',      color: '#4fc3f7', layer: sats,       defaultEnabled: false },
    { id: 'seismic',    label: 'Seismic',         color: '#ff5722', layer: seismic,    defaultEnabled: false },
    { id: 'traffic',    label: 'Traffic',         color: '#ffeb3b', layer: traffic,    defaultEnabled: true  },
    { id: 'infra',      label: 'Infrastructure',  color: '#ab47bc', layer: infra,      defaultEnabled: false },
    { id: 'listmaps',   label: 'LIST Maps (TAS)', color: '#81c784', layer: listmaps,   defaultEnabled: false },
    { id: 'traceroute', label: 'Traceroute',      color: '#00e5ff', layer: traceroute, defaultEnabled: false },
    { id: 'weather',    label: 'Weather / BOM',   color: '#4fc3f7', layer: weather,    defaultEnabled: false },
  { id: 'tides',      label: 'Tides',           color: '#29b6f6', layer: tides,      defaultEnabled: false },
  { id: 'tasroads',  label: 'TAS Road Sensors',color: '#69f0ae', layer: tasroads,   defaultEnabled: false },
  { id: 'railways',  label: 'Railways',        color: '#ff8c00', layer: railways,   defaultEnabled: false },
  { id: 'here',      label: 'HERE Incidents',  color: '#f44336', layer: here,       defaultEnabled: false },
  { id: 'gps',       label: 'My Location',     color: '#4285f4', layer: gps,        defaultEnabled: true  },
  { id: 'radar',     label: 'Radar',           color: '#4fc3f7', layer: radar,      defaultEnabled: false },
  ];

  // Apply initial enabled state
  for (const def of layerDefs) {
    if (!def.defaultEnabled) def.layer.setEnabled?.(false);
  }

  // Track which layers are currently enabled (for tab-switching logic)
  const enabledIds = new Set(layerDefs.filter(d => d.defaultEnabled).map(d => d.id));

  const panel = new LayerPanel(layerDefs, {
    onFocus: (id) => {
      dataPanel.focus(id);
      dataPanel.show();
    },
    onToggle: (id, enabled) => {
      if (enabled) {
        enabledIds.add(id);
        // Auto-switch tab to the layer just enabled
        dataPanel.focus(id);
        dataPanel.show();
      } else {
        enabledIds.delete(id);
        // If we just disabled the active tab, switch to another enabled layer
        if (dataPanel.focused === id) {
          const next = [...enabledIds][0];
          if (next) dataPanel.focus(next);
          // Panel stays visible — never auto-hide
        }
      }
    },
  });

  // Clicking a tab also enables that layer if it isn't already
  dataPanel.onTabClick = (id) => panel.enable(id);

  // ── Settings panel ──
  new SettingsPanel();

  // ── Visual modes ──
  const modes = new ModeSwitcher(viewer);

  // ── View controls ──
  initViewControls(viewer);

  // ── Landmark keyboard shortcuts + editor ──
  // initLandmarks renders the list itself and handles keyboard shortcuts
  initLandmarks(viewer);
  new LandmarksEditor(viewer);

  // ── Map provider buttons ──
  document.querySelectorAll('[data-provider]').forEach(btn => {
    btn.addEventListener('click', () => setMapProvider(btn.dataset.provider));
  });
  const defaultBtn = document.querySelector('[data-provider="osm"]');
  if (defaultBtn) {
    defaultBtn.style.background = 'rgba(249,168,37,0.2)';
    defaultBtn.style.color = '#f9a825';
    defaultBtn.style.borderColor = 'rgba(249,168,37,0.5)';
  }

  // ── Load all data layers in parallel ──
  panel.setStatus('flights',   'loading');
  panel.setStatus('ships',     'loading');
  panel.setStatus('sats',      'loading');
  panel.setStatus('seismic',   'loading');
  panel.setStatus('infra',     'loading');

  const [flightCount, shipCount, satCount, seismicCount, trafficCount, infraCount, listCount, wxCount, tideCount, tasroadsCount, railCount, hereCount, radarCount] =
    await Promise.allSettled([
      flights.load(),
      ships.load(),
      sats.load('visual', 400),
      seismic.load('aus', 2.5),
      traffic.load('tasmania').catch(() => 0),
      infra.load(['aus_ports', 'raaf_bases', 'lng_terminals']),
      listmaps.load(),
      weather.load(),
      tides.load(),
      tasroads.load(),
      railways.load(),
      here.load(),
      radar.load(),
    ]).then(results => results.map(r => r.status === 'fulfilled' ? r.value : 0));

  panel.setCount('flights',    flightCount);
  panel.setCount('ships',      shipCount);
  panel.setCount('sats',       satCount);
  panel.setCount('seismic',    seismicCount);
  // Traffic: particles were loaded but animation/visibility not yet started — enable now
  if (trafficCount > 0) traffic.setEnabled(true);

  panel.setCount('traffic',    trafficCount);
  panel.setCount('infra',      infraCount);
  panel.setCount('listmaps',   listCount);
  panel.setCount('traceroute', 0);
  panel.setCount('weather',    wxCount);
  panel.setCount('tides',      tideCount);
  panel.setCount('tasroads',   tasroadsCount);
  panel.setCount('railways',   railCount);
  panel.setCount('here',       hereCount);
  panel.setCount('gps',        0);
  panel.setCount('radar',      radarCount);

  panel.setStatus('flights',    flightCount   > 0 ? 'live'  : 'stale');
  panel.setStatus('ships',      shipCount     > 0 ? 'live'  : 'stale');
  panel.setStatus('sats',       satCount      > 0 ? 'live'  : 'error');
  panel.setStatus('seismic',    seismicCount  > 0 ? 'stale' : 'error');
  panel.setStatus('traffic',    trafficCount  > 0 ? 'live'  : 'stale');
  panel.setStatus('infra',      infraCount    > 0 ? 'stale' : 'error');
  panel.setStatus('listmaps',   'stale');
  panel.setStatus('traceroute', 'stale');
  panel.setStatus('weather',    wxCount       > 0 ? 'live'  : 'error');
  panel.setStatus('tides',      tideCount     > 0 ? 'live'  : 'error');
  panel.setStatus('tasroads',   tasroadsCount > 0 ? 'stale' : 'error');
  panel.setStatus('railways',   railCount     > 0 ? 'stale' : 'error');
  panel.setStatus('here',       process.env?.HERE_API_KEY ? (hereCount > 0 ? 'live' : 'stale') : 'stale');
  panel.setStatus('gps',        'stale');
  panel.setStatus('radar',      radarCount > 0 ? 'live' : 'stale');

  // ── Playback controls for flights ──
  const timeEl     = document.getElementById('snapshot-time');
  const counterEl  = document.getElementById('snapshot-counter');
  let playInterval = null;

  function updatePlaybackUI() {
    if (timeEl) timeEl.textContent = formatTime(flights.currentTime);
    if (counterEl) counterEl.textContent = `${flights.index + 1} / ${flights.total}`;
  }

  function formatTime(iso) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString('en-AU', {
      timeZone: 'Australia/Sydney',
      day: '2-digit', month: 'short',
      hour: '2-digit', minute: '2-digit',
      hour12: false,
    }) + ' AEST';
  }

  document.getElementById('btn-prev')?.addEventListener('click', () => {
    if (playInterval) { clearInterval(playInterval); playInterval = null; }
    flights.goToIndex(flights.index - 1);
    updatePlaybackUI();
  });

  document.getElementById('btn-next')?.addEventListener('click', () => {
    if (playInterval) { clearInterval(playInterval); playInterval = null; }
    flights.goToIndex(flights.index + 1);
    updatePlaybackUI();
  });

  document.getElementById('btn-play')?.addEventListener('click', () => {
    const btn = document.getElementById('btn-play');
    if (playInterval) {
      clearInterval(playInterval); playInterval = null;
      btn.innerHTML = '&#9654;';
    } else {
      btn.innerHTML = '&#9646;&#9646;';
      playInterval = setInterval(() => {
        flights.goToIndex(flights.index >= flights.total - 1 ? 0 : flights.index + 1);
        updatePlaybackUI();
      }, 1200);
    }
  });

  updatePlaybackUI();

  // GPS layer refresh callback — fires when a new position arrives
  gps._listRefresh = () => {
    if (dataPanel.focused === 'gps') dataPanel.refresh();
    panel.setStatus('gps', 'live');
  };

  // Seed GPS from last known position (device was already tracking before page load)
  fetch('/api/gps/last').then(r => r.json()).then(p => {
    if (p?.lat) gps.update(p);
  }).catch(() => {});

  // ── WebSocket — live ship + flight + GPS updates ──
  const ws = new WebSocket(`ws://${location.host}/ws`);
  ws.onmessage = (e) => {
    try {
      const { type, payload } = JSON.parse(e.data);
      if (type === 'ship') {
        ships.updateVessel(payload);
        panel.setStatus('ships', 'live');
        panel.setCount('ships', ships.count);
        if (dataPanel.focused === 'ships') dataPanel.refresh();
      } else if (type === 'flight') {
        flights.applyLiveUpdate(payload);
      } else if (type === 'gps') {
        gps.update(payload);
      } else if (type === 'gps_stop') {
        gps.setDisconnected();
        panel.setStatus('gps', 'stale');
      }
    } catch {}
  };
  ws.onopen = () => console.log('WS connected');
  ws.onerror = e => console.warn('WS error', e);

  // ── Live flights polling ──
  async function fetchLiveFlights() {
    const ctrl = new AbortController();
    const timeout = setTimeout(() => ctrl.abort(), 20000);
    try {
      panel.setStatus('flights', 'loading');
      const data = await fetch('/api/flights/live', { signal: ctrl.signal }).then(r => r.json());
      clearTimeout(timeout);
      if (data.states_named?.length > 0) {
        flights.renderSnapshot(data);
        panel.setCount('flights', data.states_named.length);
        panel.setStatus('flights', 'live');
        if (timeEl) timeEl.textContent = formatTime(data._collected_at);
        if (dataPanel.focused === 'flights') dataPanel.refresh();
      } else {
        panel.setStatus('flights', 'stale');
      }
    } catch (e) {
      clearTimeout(timeout);
      panel.setStatus('flights', e.name === 'AbortError' ? 'stale' : 'error');
    }
  }

  setTimeout(fetchLiveFlights, 3000);
  setInterval(fetchLiveFlights, 90000);
  document.getElementById('btn-live')?.addEventListener('click', fetchLiveFlights);

  // ── Focus flights panel by default ──
  dataPanel.focus('flights');
  dataPanel.show();

  console.log('StrayaNow ready');
}

main().catch(console.error);
