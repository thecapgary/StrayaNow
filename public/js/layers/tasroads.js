// Tasmania traffic counting stations — DoT / Drakewell data
// Shows permanent, short-term, and active-travel sensor locations across the state.

const NODE_STYLE = {
  TAS_PERM:      { color: '#69f0ae', label: 'Permanent CCS',  shape: 'triangle' },
  TAS_SHORT:     { color: '#00e5ff', label: 'Short-term',     shape: 'circle'   },
  TAS_ACTIVE:    { color: '#e040fb', label: 'Active Travel',  shape: 'circle'   },
  TASMANIA_PERM: { color: '#69f0ae', label: 'Permanent CCS',  shape: 'triangle' },
  TASMANIA_SHORT:{ color: '#00e5ff', label: 'Short-term',     shape: 'circle'   },
};

function buildStationIcon(shape, color) {
  const canvas = document.createElement('canvas');
  canvas.width = 16; canvas.height = 16;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;

  if (shape === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(8, 1);
    ctx.lineTo(15, 14);
    ctx.lineTo(1, 14);
    ctx.closePath();
  } else {
    ctx.beginPath();
    ctx.arc(8, 8, 6, 0, Math.PI * 2);
  }
  ctx.fill(); ctx.stroke();
  return canvas.toDataURL();
}

export class TasRoadsLayer {
  constructor(viewer, onSelect) {
    this.viewer   = viewer;
    this.onSelect = onSelect;
    this.enabled  = false;
    this.count    = 0;
    this._sites   = [];
    this._entities = [];
    this._searchTerm = '';
    this.onDataUpdate = null;
  }

  async load() {
    try {
      const data = await fetch('/api/tasroads/sites').then(r => r.json());
      if (data.error) throw new Error(data.error);
      this._sites = data;
      this.count  = data.length;
      if (this.enabled) this._addMarkers();
      return this.count;
    } catch (e) {
      console.warn('[tasroads] load error:', e.message);
      return 0;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) this._addMarkers();
    else this._removeMarkers();
  }

  _addMarkers() {
    this._removeMarkers();
    if (!this._sites.length) return;
    for (const s of this._sites) {
      const style = NODE_STYLE[s.node] || NODE_STYLE.TAS_PERM;
      const entity = this.viewer.entities.add({
        id: `tasroads_${s.id}`,
        position: Cesium.Cartesian3.fromDegrees(s.lon, s.lat, 5),
        billboard: {
          image: buildStationIcon(style.shape, style.color),
          width: 14, height: 14,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          scaleByDistance: new Cesium.NearFarScalar(5e3, 1.6, 8e5, 0.4),
          disableDepthTestDistance: 5e5,
        },
        label: {
          text: s.description || s.name,
          font: '9px monospace',
          fillColor: Cesium.Color.fromCssColorString(style.color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -16),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 80000),
          disableDepthTestDistance: 5e5,
        },
        _data: { type: 'tasroads_station', ...s },
      });
      this._entities.push(entity);
    }
  }

  _removeMarkers() {
    for (const e of this._entities) this.viewer.entities.remove(e);
    this._entities = [];
  }

  getListHTML() {
    if (!this._sites.length) return '<p class="panel-empty">Loading stations…</p>';

    // Summary by node type
    const counts = {};
    for (const s of this._sites) counts[s.node] = (counts[s.node] || 0) + 1;

    const summary = Object.entries(counts).map(([node, n]) => {
      const style = NODE_STYLE[node] || NODE_STYLE.TAS_PERM;
      return `<span style="color:${style.color};font-size:11px;margin-right:12px">● ${n} ${style.label}</span>`;
    }).join('');

    // Group by node type
    const groups = {};
    for (const s of this._sites) {
      if (!groups[s.node]) groups[s.node] = [];
      groups[s.node].push(s);
    }

    const ORDER = ['TAS_PERM', 'TASMANIA_PERM', 'TAS_SHORT', 'TASMANIA_SHORT', 'TAS_ACTIVE'];
    const cards = ORDER.filter(n => groups[n]).map(node => {
      const style = NODE_STYLE[node];
      const sites = groups[node].sort((a, b) =>
        (a.description || a.name).localeCompare(b.description || b.name)
      );
      return `
        <div style="font-size:10px;color:${style.color};letter-spacing:0.12em;
                    padding:4px 12px 2px;border-top:1px solid rgba(255,255,255,0.06)">
          ${style.label.toUpperCase()} · ${sites.length}
        </div>
        ${sites.map(s => {
          const sl = s.speedLimit ? `${s.speedLimit} km/h` : '';
          return `
            <div class="list-card" data-action="flyto-station"
                data-lat="${s.lat}" data-lon="${s.lon}" data-id="${s.id}"
                style="cursor:pointer">
              <div class="list-card-title" style="color:${style.color}">
                ${s.description || s.name}
              </div>
              <div class="list-card-detail">
                <span>${s.name}</span>${sl ? ` · <span>${sl} zone</span>` : ''}
              </div>
            </div>`;
        }).join('')}`;
    }).join('');

    return `
      <div style="padding:8px 12px 4px">
        <div style="font-size:10px;color:#555;margin-bottom:6px">
          SENSOR NETWORK · Tasmania DoT
        </div>
        <div style="margin-bottom:6px">${summary}</div>
        <div style="font-size:10px;color:#444">
          Click any station to locate it on the map.
        </div>
      </div>
      ${cards}
    `;
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="flyto-station"]').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat);
        const lon = parseFloat(el.dataset.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        this.viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(center, 1),
          { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 1500), duration: 1.5 }
        );
        // Highlight the entity
        const entity = this.viewer.entities.getById(`tasroads_${el.dataset.id}`);
        if (entity) this.viewer.selectedEntity = entity;
      });
    });
  }

  destroy() { this._removeMarkers(); }
}
