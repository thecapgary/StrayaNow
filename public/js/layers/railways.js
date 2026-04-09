// Tasmania railway network — OpenStreetMap via Overpass API
// Renders track polylines (clamped to ground) + station/halt markers

const STATION_STYLE = {
  station:  { label: 'Station',  color: '#4fc3f7' },
  halt:     { label: 'Halt',     color: '#81c784' },
  yard:     { label: 'Yard',     color: '#ffb74d' },
  junction: { label: 'Junction', color: '#ce93d8' },
};

function buildStationIcon(color) {
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext('2d');
  // Outer filled circle
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.65)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(8, 8, 6, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  // Inner white dot
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  ctx.arc(8, 8, 2.5, 0, Math.PI * 2);
  ctx.fill();
  return canvas.toDataURL();
}

export class RailwayLayer {
  constructor(viewer, onSelect) {
    this.viewer    = viewer;
    this.onSelect  = onSelect;
    this.enabled   = false;
    this.count     = 0;
    this._tracks   = [];
    this._stations = [];
    this._trackEntities   = [];
    this._stationEntities = [];
    this.onDataUpdate = null;
  }

  async load() {
    try {
      const data = await fetch('/api/railways/data').then(r => r.json());
      if (data.error) throw new Error(data.error);
      this._tracks   = data.tracks   || [];
      this._stations = data.stations || [];
      this.count = this._stations.length;
      if (this.enabled) this._render();
      return this.count;
    } catch (e) {
      console.warn('[railways] load error:', e.message);
      return 0;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this._render();
    else this._clear();
  }

  _render() {
    this._clear();

    // ── Track polylines ──
    for (const t of this._tracks) {
      // Elevate slightly so polylines are never clipped into terrain.
      // depthFailMaterial keeps them visible when the camera looks at a low angle.
      const positions = t.coords.map(([lon, lat]) =>
        Cesium.Cartesian3.fromDegrees(lon, lat, 150)
      );
      const isDimmed = t.railway === 'disused' || t.railway === 'abandoned';
      const color = Cesium.Color.fromCssColorString(t.color).withAlpha(isDimmed ? 0.45 : 0.9);
      const entity = this.viewer.entities.add({
        id: `railway_track_${t.id}`,
        polyline: {
          positions,
          width:            isDimmed ? 1.5 : (t.usage === 'main' ? 3.5 : 2.5),
          material:         color,
          depthFailMaterial: color,
          arcType:          Cesium.ArcType.GEODESIC,
        },
        _data: { type: 'railway_track', ...t },
      });
      this._trackEntities.push(entity);
    }

    // ── Station markers ──
    for (const s of this._stations) {
      const style = STATION_STYLE[s.railway] || STATION_STYLE.station;
      const entity = this.viewer.entities.add({
        id: `railway_station_${s.id}`,
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 15),
        billboard: {
          image:  buildStationIcon(style.color),
          width:  16, height: 16,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          disableDepthTestDistance: 5e5,
          scaleByDistance: new Cesium.NearFarScalar(8e3, 1.4, 8e5, 0.5),
        },
        label: {
          text:       s.name,
          font:       '10px monospace',
          fillColor:  Cesium.Color.fromCssColorString(style.color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 150000),
          disableDepthTestDistance: 5e5,
        },
        _data: { type: 'railway_station', ...s },
      });
      this._stationEntities.push(entity);
    }
  }

  _clear() {
    for (const e of this._trackEntities)   this.viewer.entities.remove(e);
    for (const e of this._stationEntities) this.viewer.entities.remove(e);
    this._trackEntities   = [];
    this._stationEntities = [];
  }

  getListHTML() {
    if (!this._tracks.length && !this._stations.length) {
      return '<p class="panel-empty">Loading railway data…</p>';
    }

    // Track type summary
    const trackGroups = {};
    for (const t of this._tracks) {
      if (!trackGroups[t.label]) trackGroups[t.label] = { count: 0, color: t.color };
      trackGroups[t.label].count++;
    }
    const trackSummary = Object.entries(trackGroups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([label, { count, color }]) =>
        `<span style="color:${color};font-size:11px;margin-right:10px">─ ${count} ${label}</span>`
      ).join('');

    // Stations grouped by type
    const stationGroups = {};
    for (const s of this._stations) {
      if (!stationGroups[s.railway]) stationGroups[s.railway] = [];
      stationGroups[s.railway].push(s);
    }

    const ORDER = ['station', 'halt', 'yard', 'junction'];
    const stationCards = ORDER.filter(t => stationGroups[t]).map(type => {
      const style = STATION_STYLE[type];
      const list  = stationGroups[type].sort((a, b) => a.name.localeCompare(b.name));
      return `
        <div style="font-size:10px;color:${style.color};letter-spacing:0.12em;
                    padding:4px 12px 2px;border-top:1px solid rgba(255,255,255,0.06)">
          ${style.label.toUpperCase()}S · ${list.length}
        </div>
        ${list.map(s => `
          <div class="list-card" data-action="flyto-rail-station"
               data-lat="${s.lat}" data-lon="${s.lon}" data-id="${s.id}"
               style="cursor:pointer">
            <div class="list-card-title" style="color:${style.color}">${s.name}</div>
            ${s.operator ? `<div class="list-card-detail">${s.operator}</div>` : ''}
          </div>`
        ).join('')}`;
    }).join('');

    return `
      <div style="padding:8px 12px 4px">
        <div style="font-size:10px;color:#555;margin-bottom:6px">
          RAILWAY NETWORK · OpenRailwayMap / OSM
        </div>
        <div style="margin-bottom:5px">${trackSummary}</div>
        <div style="font-size:10px;color:#444">
          ${this._tracks.length} track segments · ${this._stations.length} operating sites
        </div>
      </div>
      ${stationCards}
    `;
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="flyto-rail-station"]').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat);
        const lon = parseFloat(el.dataset.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        this.viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, 0), 1),
          { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 3000), duration: 1.5 }
        );
        const entity = this.viewer.entities.getById(`railway_station_${el.dataset.id}`);
        if (entity) this.viewer.selectedEntity = entity;
      });
    });
  }

  destroy() { this._clear(); }
}
