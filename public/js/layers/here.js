// HERE Traffic Incidents — crashes, roadworks, closures
// Pulls from /api/here/incidents (server proxies HERE Traffic v7 API)

const KIND_STYLE = {
  ACCIDENT:     { color: '#f44336', label: 'Accident'   },
  ROAD_CLOSED:  { color: '#9c27b0', label: 'Road Closed'},
  CONSTRUCTION: { color: '#ff9800', label: 'Roadworks'  },
  CONGESTION:   { color: '#ffeb3b', label: 'Congestion' },
  MASS_EVENT:   { color: '#00bcd4', label: 'Mass Event' },
  OTHER:        { color: '#8bc34a', label: 'Incident'   },
};

const CRIT_ORDER = ['CRITICAL', 'MAJOR', 'MINOR', 'LOW'];

function buildIncidentIcon(color, symbol) {
  const canvas = document.createElement('canvas');
  canvas.width = 22; canvas.height = 22;
  const ctx = canvas.getContext('2d');
  // Diamond shape
  ctx.save();
  ctx.translate(11, 11);
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.7)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.rect(-7, -7, 14, 14);
  ctx.fill(); ctx.stroke();
  ctx.restore();
  // Symbol text
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 10px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(symbol, 11, 11);
  return canvas.toDataURL();
}

const _iconCache = {};
function getIcon(kind, color) {
  if (_iconCache[kind]) return _iconCache[kind];
  const symbols = { ACCIDENT:'!', ROAD_CLOSED:'X', CONSTRUCTION:'C', CONGESTION:'~', MASS_EVENT:'E', OTHER:'?' };
  _iconCache[kind] = buildIncidentIcon(color, symbols[kind] || '?');
  return _iconCache[kind];
}

export class HereLayer {
  constructor(viewer, onSelect) {
    this.viewer     = viewer;
    this.onSelect   = onSelect;
    this.enabled    = false;
    this.count      = 0;
    this._incidents = [];
    this._entities  = [];
    this._loadError = null;  // last error message if fetch failed
    this._loaded    = false; // true once at least one successful fetch
    this.onDataUpdate = null;
  }

  async load() {
    try {
      const data = await fetch('/api/here/incidents').then(r => r.json());
      if (data.error) throw new Error(data.error);
      this._incidents = Array.isArray(data) ? data : [];
      this._loadError = null;
      this._loaded    = true;
      this.count = this._incidents.length;
      if (this.enabled) this._render();
      this.onDataUpdate?.();
      return this.count;
    } catch (e) {
      this._loadError = e.message;
      console.warn('[here] load error:', e.message);
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
    for (const inc of this._incidents) {
      const style = KIND_STYLE[inc.kind] || KIND_STYLE.OTHER;
      const entity = this.viewer.entities.add({
        id: `here_inc_${inc.id}`,
        position: Cesium.Cartesian3.fromDegrees(inc.lon, inc.lat, 200),
        billboard: {
          image:  getIcon(inc.kind, style.color),
          width:  22, height: 22,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          disableDepthTestDistance: 5e5,
          scaleByDistance: new Cesium.NearFarScalar(5e3, 1.4, 8e5, 0.6),
        },
        label: {
          text:       inc.description,
          font:       '10px monospace',
          fillColor:  Cesium.Color.fromCssColorString(style.color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -26),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 60000),
          disableDepthTestDistance: 5e5,
        },
        _data: { type: 'here_incident', ...inc },
      });
      this._entities.push(entity);
    }
  }

  _clear() {
    for (const e of this._entities) this.viewer.entities.remove(e);
    this._entities = [];
  }

  getListHTML() {
    // Not yet loaded — show error or setup instructions
    if (!this._loaded) {
      if (this._loadError) {
        return `
          <div style="padding:14px">
            <div style="font-size:10px;color:#555;margin-bottom:8px;letter-spacing:0.12em">HERE TRAFFIC · INCIDENTS</div>
            <div style="font-size:11px;color:#f44;line-height:1.6;margin-bottom:10px">
              ${this._loadError}
            </div>
            <p style="font-size:10px;color:#555;line-height:1.6">
              Add <strong style="color:#f9a825">HERE Access Key ID</strong> and
              <strong style="color:#f9a825">Access Key Secret</strong> in Settings (⚙)
              to enable live incident data.
            </p>
          </div>`;
      }
      return `
        <div style="padding:14px">
          <div style="font-size:10px;color:#555;margin-bottom:10px;letter-spacing:0.12em">HERE TRAFFIC · INCIDENTS</div>
          <p style="font-size:11px;color:#888;line-height:1.6">
            Add HERE OAuth credentials in Settings (⚙) to enable live crashes, roadworks and closures.
          </p>
          <p style="font-size:10px;color:#444;margin-top:8px;line-height:1.6">
            Free tier · developer.here.com<br>
            Save <em>Access Key ID</em> + <em>Access Key Secret</em>
          </p>
        </div>`;
    }

    if (!this._incidents.length) {
      return `
        <div style="padding:14px">
          <div style="font-size:10px;color:#555;margin-bottom:8px;letter-spacing:0.12em">HERE TRAFFIC · INCIDENTS</div>
          <p style="font-size:11px;color:#4caf50;line-height:1.6">Connected — no active incidents in Tasmania.</p>
          <p style="font-size:10px;color:#444;margin-top:8px;line-height:1.6">
            Incidents appear here automatically when HERE reports a crash,<br>
            roadworks, or closure in the state. Refreshes every 5 minutes.
          </p>
        </div>`;
    }

    // Sort: critical first, then by kind
    const sorted = [...this._incidents].sort((a, b) =>
      CRIT_ORDER.indexOf(a.criticality) - CRIT_ORDER.indexOf(b.criticality)
    );

    const cards = sorted.map(inc => {
      const style = KIND_STYLE[inc.kind] || KIND_STYLE.OTHER;
      const closed = inc.roadClosed
        ? `<span style="color:#f44;font-size:9px;margin-left:6px">ROAD CLOSED</span>` : '';
      const critColor = { CRITICAL:'#f44', MAJOR:'#ff9800', MINOR:'#ffeb3b', LOW:'#555' }[inc.criticality] || '#555';
      return `
        <div class="list-card" data-action="flyto-incident"
             data-lat="${inc.lat}" data-lon="${inc.lon}" data-id="${inc.id}"
             style="cursor:pointer">
          <div class="list-card-title" style="color:${style.color};display:flex;align-items:center;gap:6px">
            ${style.label}${closed}
            <span style="color:${critColor};font-size:9px;margin-left:auto">${inc.criticality}</span>
          </div>
          <div class="list-card-detail">${inc.description}</div>
        </div>`;
    }).join('');

    // Summary counts by kind
    const counts = {};
    for (const inc of this._incidents) counts[inc.kind] = (counts[inc.kind] || 0) + 1;
    const summary = Object.entries(counts).map(([kind, n]) => {
      const s = KIND_STYLE[kind] || KIND_STYLE.OTHER;
      return `<span style="color:${s.color};font-size:11px;margin-right:10px">◆ ${n} ${s.label}</span>`;
    }).join('');

    return `
      <div style="padding:8px 12px 4px">
        <div style="font-size:10px;color:#555;margin-bottom:6px">HERE TRAFFIC · INCIDENTS</div>
        <div style="margin-bottom:4px">${summary}</div>
      </div>
      ${cards}
    `;
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="flyto-incident"]').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat);
        const lon = parseFloat(el.dataset.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        this.viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, 0), 1),
          { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-60), 3000), duration: 1.5 }
        );
        const entity = this.viewer.entities.getById(`here_inc_${el.dataset.id}`);
        if (entity) this.viewer.selectedEntity = entity;
      });
    });
  }

  destroy() { this._clear(); }
}
