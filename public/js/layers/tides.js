// Tide predictions layer — Open-Meteo Marine sea level extrema
// Click anywhere on the coast to get next high/low tide

const TIDE_COLOR = '#29b6f6';

export class TidesLayer {
  constructor(viewer) {
    this.viewer   = viewer;
    this.enabled  = false;
    this.count    = 0;
    this._entities    = [];
    this._clickHandler = null;
    this._locations   = [];   // fetched from /api/tides/locations
    this._focused     = null; // currently shown location id
    this.onDataUpdate = null;
  }

  async load() {
    const locs = await fetch('/api/tides/locations').then(r => r.json()).catch(() => []);
    this._locations = locs;
    this.count = locs.length;
    if (this.enabled) {
      this._addMarkers();
      this._initClick();
    }
    return this.count;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      this._addMarkers();
      this._initClick();
    } else {
      this._removeMarkers();
      this._destroyClick();
    }
  }

  _addMarkers() {
    this._removeMarkers();
    if (!this._locations.length) return;
    for (const loc of this._locations) {
      const e = this.viewer.entities.add({
        id: `tide_${loc.id}`,
        position: Cesium.Cartesian3.fromDegrees(loc.lon, loc.lat, 10),
        point: {
          pixelSize: 7,
          color: Cesium.Color.fromCssColorString(TIDE_COLOR).withAlpha(0.85),
          outlineColor: Cesium.Color.fromCssColorString('#01579b'),
          outlineWidth: 1,
          scaleByDistance: new Cesium.NearFarScalar(5e4, 1.4, 4e6, 0.5),
          disableDepthTestDistance: 5e5,
        },
        label: {
          text: loc.name,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(TIDE_COLOR),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -14),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 600000),
          disableDepthTestDistance: 5e5,
        },
        _data: { type: 'tide_location', ...loc },
      });
      this._entities.push(e);
    }
  }

  _removeMarkers() {
    for (const e of this._entities) this.viewer.entities.remove(e);
    this._entities = [];
  }

  _initClick() {
    if (this._clickHandler) return;
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction(async click => {
      if (!this.enabled) return;

      // Check if a tide marker was clicked — use picked entity if so
      const picked = this.viewer.scene.pick(click.position);
      let lat, lon, locId;
      if (Cesium.defined(picked) && picked.id?._data?.type === 'tide_location') {
        const d = picked.id._data;
        lat = d.lat; lon = d.lon; locId = d.id;
      } else {
        // Globe click — derive lat/lon from ray intersection
        const ray = this.viewer.camera.getPickRay(click.position);
        const cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
        if (!cartesian) return;
        const carto = Cesium.Cartographic.fromCartesian(cartesian);
        lat = Cesium.Math.toDegrees(carto.latitude);
        lon = Cesium.Math.toDegrees(carto.longitude);
      }

      this._focused = locId || `${lat.toFixed(2)},${lon.toFixed(2)}`;
      this.onDataUpdate?.();

      // Fetch tide data for clicked point
      try {
        const data = await fetch(`/api/tides?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`).then(r => r.json());
        this._lastTideData = data;
        this.onDataUpdate?.();
      } catch {
        this._lastTideData = null;
        this.onDataUpdate?.();
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
    this._clickHandler = handler;
  }

  _destroyClick() {
    if (this._clickHandler) { this._clickHandler.destroy(); this._clickHandler = null; }
  }

  getListHTML() {
    // If we have tide data from a click, show it
    if (this._lastTideData) return this._renderTideData(this._lastTideData);

    // Otherwise show the locations list grouped by state
    const byState = {};
    for (const loc of this._locations) {
      if (!byState[loc.state]) byState[loc.state] = [];
      byState[loc.state].push(loc);
    }
    const STATE_ORDER = ['TAS', 'VIC', 'NSW', 'QLD', 'SA', 'WA', 'NT'];

    return `
      <div style="padding:6px 12px 4px;font-size:9px;color:#444;line-height:1.5">
        Click a location below or click anywhere on the coast to get tide predictions.
      </div>
      ${STATE_ORDER.filter(s => byState[s]).map(state => `
        <div style="padding:2px 0">
          <div style="padding:4px 12px 2px;font-size:8px;letter-spacing:0.18em;color:#555;text-transform:uppercase">${state}</div>
          ${byState[state].map(loc => `
            <div class="list-card" data-action="tide-location" data-lat="${loc.lat}" data-lon="${loc.lon}" data-id="${loc.id}"
              style="cursor:pointer;padding:4px 12px">
              <div class="list-card-title" style="color:${TIDE_COLOR}">${loc.name}</div>
            </div>
          `).join('')}
        </div>
      `).join('')}
    `;
  }

  _renderTideData(data) {
    const loc = data.nearest_location;
    const locName = loc
      ? `${loc.name}, ${loc.state}${data.nearest_km > 5 ? ` (${data.nearest_km} km)` : ''}`
      : `${data.lat.toFixed(3)}°, ${data.lon.toFixed(3)}°`;

    if (data.error || !data.extremes?.length) {
      return `
        <div style="padding:10px 12px">
          <div style="color:${TIDE_COLOR};font-size:10px;font-weight:700;margin-bottom:4px">${locName}</div>
          <p class="panel-empty">${data.error || 'No tide data available for this location.'}</p>
          <button class="list-card" data-action="tide-clear" style="width:100%;margin-top:6px;cursor:pointer;text-align:center;font-size:9px;color:#555">← Back to locations</button>
        </div>
      `;
    }

    const now = Date.now();
    // Determine current trend (rising / falling) from order of next two extremes
    const next = data.extremes[0];
    const trend = next?.type === 'HIGH' ? '↑ Rising' : '↓ Falling';
    const trendColor = next?.type === 'HIGH' ? '#29b6f6' : '#f9a825';

    const rows = data.extremes.map(e => {
      const d = new Date(e.time);
      const isHigh = e.type === 'HIGH';
      const dayStr = d.toLocaleDateString('en-AU', { weekday:'short', day:'numeric', month:'short' });
      const timeStr = d.toLocaleTimeString('en-AU', { hour:'2-digit', minute:'2-digit', hour12: false });
      const hPct = Math.min(100, Math.max(0, ((e.height + 0.5) / 2) * 100));
      return `
        <div style="padding:5px 12px;border-bottom:1px solid rgba(255,255,255,0.04)">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:10px;color:${isHigh ? '#29b6f6' : '#f9a825'};font-weight:700">
              ${isHigh ? '▲ HIGH' : '▽ LOW'}
            </span>
            <span style="font-size:11px;color:#ccc;font-family:monospace">${timeStr}</span>
            <span style="font-size:10px;color:#888">${dayStr}</span>
          </div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
            <div style="flex:1;height:3px;background:#111;border-radius:2px">
              <div style="width:${hPct}%;height:100%;background:${isHigh ? '#29b6f6' : '#546e7a'};border-radius:2px;transition:width 0.3s"></div>
            </div>
            <span style="font-size:10px;color:#888;width:42px;text-align:right">${e.height >= 0 ? '+' : ''}${e.height.toFixed(2)} m</span>
          </div>
        </div>
      `;
    }).join('');

    return `
      <div style="padding:8px 12px 6px;border-bottom:1px solid rgba(255,255,255,0.06)">
        <div style="color:${TIDE_COLOR};font-size:10px;font-weight:700;margin-bottom:2px">⚓ ${locName}</div>
        <div style="display:flex;justify-content:space-between">
          <span style="font-size:9px;color:${trendColor}">${trend}</span>
          <span style="font-size:9px;color:#444">${data.tz_abbrev}</span>
        </div>
      </div>
      ${rows}
      <div style="padding:6px 12px">
        <button class="list-card" data-action="tide-clear"
          style="width:100%;cursor:pointer;text-align:center;font-size:9px;color:#555">← Back to locations</button>
      </div>
    `;
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="tide-location"]').forEach(el => {
      el.addEventListener('click', async () => {
        const lat = parseFloat(el.dataset.lat);
        const lon = parseFloat(el.dataset.lon);
        this._focused = el.dataset.id;
        this._lastTideData = null;
        this.onDataUpdate?.();
        try {
          const data = await fetch(`/api/tides?lat=${lat}&lon=${lon}`).then(r => r.json());
          this._lastTideData = data;
        } catch {
          this._lastTideData = { error: 'Failed to fetch tide data', extremes: [] };
        }
        this.onDataUpdate?.();
      });
    });
    container.querySelectorAll('[data-action="tide-clear"]').forEach(el => {
      el.addEventListener('click', () => {
        this._lastTideData = null;
        this._focused = null;
        this.onDataUpdate?.();
      });
    });
  }

  destroy() {
    this._removeMarkers();
    this._destroyClick();
  }
}
