// MMSI starting with 111 = aircraft (SAR / offshore helicopter) per ITU allocation
function isAircraftMMSI(mmsi) {
  return String(mmsi).startsWith('111');
}

function buildShipIcon(cogDeg, color = '#00bcd4') {
  const canvas = document.createElement('canvas');
  canvas.width = 24; canvas.height = 24;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(12, 12);
  ctx.rotate(Cesium.Math.toRadians(cogDeg || 0));
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, -9);
  ctx.lineTo(5, 6);
  ctx.lineTo(0, 3);
  ctx.lineTo(-5, 6);
  ctx.closePath();
  ctx.fill(); ctx.stroke();
  ctx.restore();
  return canvas.toDataURL();
}

// Top-down rotor cross — used for aircraft appearing on the AIS feed
function buildHelicopterIcon(cogDeg, color = '#e040fb') {
  const canvas = document.createElement('canvas');
  canvas.width = 28; canvas.height = 28;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(14, 14);
  ctx.rotate(Cesium.Math.toRadians(cogDeg || 0));

  // Two rotor blades (perpendicular ellipses)
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.55)';
  ctx.lineWidth = 1.2;
  for (let i = 0; i < 2; i++) {
    ctx.save();
    ctx.rotate(i * Math.PI / 2);
    ctx.beginPath();
    ctx.ellipse(0, 0, 12, 3, 0, 0, Math.PI * 2);
    ctx.fill(); ctx.stroke();
    ctx.restore();
  }

  // Hub
  ctx.beginPath();
  ctx.arc(0, 0, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  ctx.fill();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  ctx.restore();
  return canvas.toDataURL();
}

const SHIP_TYPE_COLORS = {
  tanker:   '#ff6b35',
  cargo:    '#00bcd4',
  military: '#ff4444',
  passenger:'#ab47bc',
  tug:      '#ffeb3b',
  aircraft: '#e040fb',   // violet — AIS-equipped helicopters / SAR aircraft
  default:  '#4fc3f7',
};

function shipColor(type) {
  if (!type) return SHIP_TYPE_COLORS.default;
  const t = type.toLowerCase();
  if (t === 'aircraft') return SHIP_TYPE_COLORS.aircraft;
  if (t.includes('tanker')) return SHIP_TYPE_COLORS.tanker;
  if (t.includes('cargo') || t.includes('bulk')) return SHIP_TYPE_COLORS.cargo;
  if (t.includes('military') || t.includes('naval')) return SHIP_TYPE_COLORS.military;
  if (t.includes('passenger') || t.includes('ferry')) return SHIP_TYPE_COLORS.passenger;
  if (t.includes('tug')) return SHIP_TYPE_COLORS.tug;
  return SHIP_TYPE_COLORS.default;
}

export class ShipLayer {
  constructor(viewer, onSelect) {
    this.viewer = viewer;
    this.onSelect = onSelect;
    this.entities = {};
    this.enabled = true;
    this.count = 0;
  }

  async load() {
    const data = await fetch('/api/ships/latest').then(r => r.json()).catch(() => ({ vessels: [] }));
    const vessels = Array.isArray(data.vessels) ? data.vessels : Object.values(data.vessels || {});
    this.renderVessels(vessels);
    return vessels.length;
  }

  renderVessels(vessels) {
    // Update or add
    const seen = new Set();
    for (const v of vessels) {
      if (!v.lat || !v.lon || !v.mmsi) continue;
      seen.add(String(v.mmsi));
      this._upsertVessel(v);
    }
    // Remove stale
    for (const [id, entity] of Object.entries(this.entities)) {
      if (!seen.has(id)) {
        this.viewer.entities.remove(entity);
        delete this.entities[id];
      }
    }
    this.count = seen.size;
  }

  _upsertVessel(v) {
    const id = String(v.mmsi);
    const aircraft = isAircraftMMSI(v.mmsi);
    const resolvedType = aircraft ? 'aircraft' : (v.type || 'ship');
    const color = aircraft ? SHIP_TYPE_COLORS.aircraft : shipColor(v.type);
    const position = Cesium.Cartesian3.fromDegrees(v.lon, v.lat, aircraft ? 300 : 0);

    if (this.entities[id]) {
      this.entities[id].position = position;
      return;
    }

    const entity = this.viewer.entities.add({
      id: `ship_${id}`,
      position,
      billboard: {
        image: aircraft ? buildHelicopterIcon(v.cog, color) : buildShipIcon(v.cog, color),
        width: aircraft ? 24 : 20,
        height: aircraft ? 24 : 20,
        verticalOrigin: Cesium.VerticalOrigin.CENTER,
        scaleByDistance: new Cesium.NearFarScalar(1e4, 1.5, 2e6, 0.4),
        disableDepthTestDistance: 5e5,
      },
      label: {
        text: v.name || id,
        font: '10px monospace',
        fillColor: Cesium.Color.fromCssColorString(color),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(0, -18),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 500000),
        disableDepthTestDistance: 5e5,
      },
      _data: { type: resolvedType, isAircraft: aircraft, ...v },
    });
    this.entities[id] = entity;
  }

  // Called from WebSocket broadcast
  updateVessel(v) {
    if (!this.enabled) return;
    if (!v.lat || !v.lon || !v.mmsi) return;
    this._upsertVessel(v);
    this.count = Object.keys(this.entities).length;
  }

  getListHTML() {
    const vessels = Object.values(this.entities).map(e => e._data).filter(Boolean);
    if (vessels.length === 0) return '<p class="panel-empty">No vessels in range</p>';

    // Sort: aircraft first, then by name
    const sorted = [...vessels].sort((a, b) => {
      if (a.isAircraft && !b.isAircraft) return -1;
      if (!a.isAircraft && b.isAircraft) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });

    return sorted.map(v => {
      const color = v.isAircraft ? '#e040fb' : '#00bcd4';
      const prefix = v.isAircraft ? '✦ ' : '';
      const typeLabel = v.isAircraft ? 'AIRCRAFT · AIS' : (v.type || 'ship').toUpperCase();
      return `
        <div class="list-card" data-action="flyto" data-lon="${v.lon}" data-lat="${v.lat}" data-alt="50000" data-entity="ship_${v.mmsi}">
          <div class="list-card-title" style="color:${color}">${prefix}${v.name || v.mmsi}</div>
          <div class="list-card-detail">SOG <span>${v.sog?.toFixed(1) ?? '—'} kts</span> · COG <span>${v.cog?.toFixed(0) ?? '—'}°</span></div>
          <div class="list-card-detail"><span style="color:${color};opacity:0.7">${typeLabel}</span> · MMSI <span>${v.mmsi}</span></div>
        </div>`;
    }).join('');
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="flyto"]').forEach(card => {
      card.addEventListener('click', () => {
        const lon = parseFloat(card.dataset.lon);
        const lat = parseFloat(card.dataset.lat);
        if (isNaN(lon) || isNaN(lat)) return;
        this.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 50000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.5,
        });
        const entity = this.viewer.entities.getById(card.dataset.entity);
        if (entity) this.viewer.selectedEntity = entity;
      });
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    for (const e of Object.values(this.entities)) e.show = enabled;
  }

  destroy() {
    for (const e of Object.values(this.entities)) this.viewer.entities.remove(e);
    this.entities = {};
  }
}
