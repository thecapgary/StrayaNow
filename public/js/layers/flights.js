const COLORS = {
  civilian: Cesium.Color.fromCssColorString('#f9a825'),
  military: Cesium.Color.fromCssColorString('#ff4444'),
  unknown:  Cesium.Color.fromCssColorString('#aaaaaa'),
};

const STATE_LABEL = {
  0: 'On ground', 1: 'Airborne',
};

function buildPlaneIcon(headingDeg, color = '#f9a825') {
  const canvas = document.createElement('canvas');
  canvas.width = 32; canvas.height = 32;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.translate(16, 16);
  ctx.rotate(Cesium.Math.toRadians(headingDeg || 0));
  ctx.fillStyle = color;
  ctx.strokeStyle = 'rgba(0,0,0,0.6)';
  ctx.lineWidth = 1;
  // Fuselage
  ctx.beginPath();
  ctx.moveTo(0,-10); ctx.lineTo(2,0); ctx.lineTo(2,6); ctx.lineTo(0,5); ctx.lineTo(-2,6); ctx.lineTo(-2,0);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // Wings
  ctx.beginPath();
  ctx.moveTo(-2,-1); ctx.lineTo(-10,4); ctx.lineTo(-10,6); ctx.lineTo(0,2); ctx.lineTo(10,6); ctx.lineTo(10,4); ctx.lineTo(2,-1);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  // Tail
  ctx.beginPath();
  ctx.moveTo(-2,4); ctx.lineTo(-6,7); ctx.lineTo(-6,8); ctx.lineTo(0,6); ctx.lineTo(6,8); ctx.lineTo(6,7); ctx.lineTo(2,4);
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.restore();
  return canvas.toDataURL();
}

export class FlightLayer {
  constructor(viewer, onSelect) {
    this.viewer = viewer;
    this.onSelect = onSelect;
    this.entities = {};
    this.snapshots = [];
    this.currentIndex = 0;
    this.liveMode = false;
    this.liveTimer = null;
    this.enabled = true;
  }

  async load() {
    const data = await fetch('/api/flights/history').then(r => r.json());
    this.snapshots = data;
    if (this.snapshots.length > 0) {
      this.currentIndex = this.snapshots.length - 1;
      this.renderSnapshot(this.snapshots[this.currentIndex]);
    }
    return this.snapshots.length;
  }

  renderSnapshot(snapshot) {
    this._clear();
    const states = snapshot?.states_named || [];

    // Store current states for list rendering
    this._currentStates = states;
    // Notify data panel if it's listening
    this.onDataUpdate?.();
    for (const s of states) {
      if (s.longitude == null || s.latitude == null) continue;
      const alt = s.geo_altitude || s.baro_altitude || 0;
      const color = '#f9a825';
      const entity = this.viewer.entities.add({
        id: `flight_${s.icao24}`,
        show: this.enabled,
        position: Cesium.Cartesian3.fromDegrees(s.longitude, s.latitude, alt),
        billboard: {
          image: buildPlaneIcon(s.true_track, color),
          width: 28, height: 28,
          verticalOrigin: Cesium.VerticalOrigin.CENTER,
          eyeOffset: new Cesium.Cartesian3(0, 0, -100),
          scaleByDistance: new Cesium.NearFarScalar(5e4, 1.2, 3e6, 0.4),
          disableDepthTestDistance: 5e5,
        },
        label: {
          text: s.callsign?.trim() || s.icao24,
          font: '11px monospace',
          fillColor: Cesium.Color.fromCssColorString('#f9a825'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 1500000),
          disableDepthTestDistance: 5e5,
        },
        _data: { type: 'flight', ...s },
      });
      this.entities[s.icao24] = entity;
    }
    return states.length;
  }

  applyLiveUpdate(vessel) {
    // Called from WebSocket handler
    if (!this.enabled) return;
    const s = vessel;
    if (!s.longitude || !s.latitude) return;
    const alt = s.geo_altitude || s.baro_altitude || 0;
    const id = `flight_${s.icao24}`;
    let entity = this.viewer.entities.getById(id);
    if (entity) {
      entity.position = Cesium.Cartesian3.fromDegrees(s.longitude, s.latitude, alt);
    } else {
      this.renderSnapshot({ states_named: [s] });
    }
  }

  getListHTML() {
    const states = this._currentStates || [];
    if (states.length === 0) return '<p class="panel-empty">No aircraft in range</p>';
    return states.map(s => {
      const alt = s.baro_altitude ? (s.baro_altitude * 3.28084).toFixed(0) : '—';
      const spd = s.velocity ? (s.velocity * 1.94384).toFixed(0) : '—';
      return `<div class="list-card" data-action="flyto" data-lon="${s.longitude}" data-lat="${s.latitude}" data-entity="flight_${s.icao24}">
        <div class="list-card-title">${s.callsign?.trim() || s.icao24}</div>
        <div class="list-card-detail">Alt <span>${alt} ft</span> · Spd <span>${spd} kts</span></div>
        <div class="list-card-detail">Trk <span>${s.true_track?.toFixed(0) ?? '—'}°</span> · <span>${s.origin_country || ''}</span></div>
      </div>`;
    }).join('');
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="flyto"]').forEach(card => {
      card.addEventListener('click', () => {
        const lon = parseFloat(card.dataset.lon);
        const lat = parseFloat(card.dataset.lat);
        if (isNaN(lon) || isNaN(lat)) return;
        // flyToBoundingSphere with pitch=-90 so the target is exactly centred in view
        const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        this.viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(center, 1),
          { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 30000), duration: 1.5 }
        );
        const entity = this.viewer.entities.getById(card.dataset.entity);
        if (entity) this.viewer.selectedEntity = entity;
      });
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    for (const e of Object.values(this.entities)) e.show = enabled;
  }

  goToIndex(idx) {
    this.currentIndex = Math.max(0, Math.min(this.snapshots.length - 1, idx));
    return this.renderSnapshot(this.snapshots[this.currentIndex]);
  }

  get total() { return this.snapshots.length; }
  get index() { return this.currentIndex; }
  get currentTime() { return this.snapshots[this.currentIndex]?._collected_at; }

  _clear() {
    for (const e of Object.values(this.entities)) this.viewer.entities.remove(e);
    this.entities = {};
  }

  destroy() { this._clear(); }
}
