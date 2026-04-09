// Satellite tracking using satellite.js (loaded via CDN) + Space-track TLEs
export class SatelliteLayer {
  constructor(viewer, onSelect) {
    this.viewer = viewer;
    this.onSelect = onSelect;  // (data, idx) => void — called on globe click
    this.satrecs = [];
    this._points  = [];
    this._labels  = [];
    this.enabled  = true;
    this.animFrame = null;
    this._pointCollection = null;
    this._labelCollection = null;
    this.count = 0;
  }

  async load(group = 'visual', limit = 500) {
    const data = await fetch(`/api/satellites?group=${group}&limit=${limit}`).then(r => r.json());
    if (!data.satellites) return 0;

    this.satrecs = [];
    for (const sat of data.satellites) {
      try {
        const satrec = satellite.twoline2satrec(sat.tle1, sat.tle2);
        this.satrecs.push({ satrec, name: sat.name });
      } catch { /* skip bad TLEs */ }
    }

    this.count = this.satrecs.length;
    this._initPoints();
    if (this.enabled) this._startAnimation();
    return this.count;
  }

  _initPoints() {
    if (this._pointCollection) this.viewer.scene.primitives.remove(this._pointCollection);
    if (this._labelCollection) this.viewer.scene.primitives.remove(this._labelCollection);

    this._pointCollection = new Cesium.PointPrimitiveCollection();
    this._pointCollection.show = this.enabled;
    this.viewer.scene.primitives.add(this._pointCollection);

    this._labelCollection = new Cesium.LabelCollection();
    this._labelCollection.show = this.enabled;
    this.viewer.scene.primitives.add(this._labelCollection);

    this._points = [];
    this._labels = [];
    const pos0 = Cesium.Cartesian3.fromDegrees(0, 0, 400000);

    for (let i = 0; i < this.satrecs.length; i++) {
      const name = this.satrecs[i].name;
      // Give each point an id shaped like { _data } so EntityDetail's click handler
      // recognises it without needing a separate ScreenSpaceEventHandler
      this._points.push(this._pointCollection.add({
        id: { _data: { type: 'satellite', name, idx: i } },
        position: pos0,
        color: Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.9),
        pixelSize: 4,
        scaleByDistance: new Cesium.NearFarScalar(1e6, 2.5, 1e8, 0.8),
        // No disableDepthTestDistance — Earth correctly occludes satellites behind it
      }));
      this._labels.push(this._labelCollection.add({
        position: pos0,
        text: name,
        font: '10px monospace',
        fillColor: Cesium.Color.fromCssColorString('#4fc3f7'),
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
        style: Cesium.LabelStyle.FILL_AND_OUTLINE,
        pixelOffset: new Cesium.Cartesian2(6, -8),
        distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 3000000),
      }));
    }
  }

  _startAnimation() {
    if (this.animFrame) return;
    const propagate = () => {
      if (!this.enabled || !this._pointCollection) return;
      const now = new Date();
      for (let i = 0; i < this.satrecs.length; i++) {
        try {
          const posVel = satellite.propagate(this.satrecs[i].satrec, now);
          if (!posVel?.position) continue;
          const gmst = satellite.gstime(now);
          const geo  = satellite.eciToGeodetic(posVel.position, gmst);
          const alt  = geo.height * 1000;
          if (alt < 0 || alt > 50000000) continue;
          const pos = Cesium.Cartesian3.fromRadians(geo.longitude, geo.latitude, alt);
          this._points[i].position = pos;
          if (this._labels[i]) this._labels[i].position = pos;
        } catch { /* skip */ }
      }
      this.animFrame = requestAnimationFrame(propagate);
    };
    propagate();
  }

  // Get current geodetic position for a satrec
  _currentGeo(satrec) {
    const now = new Date();
    const posVel = satellite.propagate(satrec, now);
    if (!posVel?.position) return null;
    const gmst = satellite.gstime(now);
    return satellite.eciToGeodetic(posVel.position, gmst);
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this._pointCollection) this._pointCollection.show = enabled;
    if (this._labelCollection) this._labelCollection.show = enabled;
    if (enabled && !this.animFrame && this.satrecs.length > 0) {
      this._startAnimation();
    } else if (!enabled && this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  highlightIdx(idx) {
    const normal   = Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.9);
    const selected = Cesium.Color.fromCssColorString('#ffffff').withAlpha(1.0);
    this._points.forEach((p, i) => {
      p.color     = i === idx ? selected : normal;
      p.pixelSize = i === idx ? 9 : 4;
    });
  }

  clearHighlight() {
    const normal = Cesium.Color.fromCssColorString('#4fc3f7').withAlpha(0.9);
    this._points.forEach(p => { p.color = normal; p.pixelSize = 4; });
  }

  getListHTML() {
    if (!this.satrecs.length) return '<p class="panel-empty">No satellites loaded.</p>';
    return this.satrecs.slice(0, 200).map(({ satrec, name }, i) => {
      let altKm = '—', latStr = '—', lonStr = '—';
      try {
        const geo = this._currentGeo(satrec);
        if (geo) {
          altKm  = Math.round(geo.height) + ' km';
          latStr = Cesium.Math.toDegrees(geo.latitude).toFixed(1) + '°';
          lonStr = Cesium.Math.toDegrees(geo.longitude).toFixed(1) + '°';
        }
      } catch {}
      return `<div class="list-card" data-action="sat-flyto" data-idx="${i}" style="cursor:pointer">
        <div class="list-card-title">${name}</div>
        <div class="list-card-detail">Alt <span>${altKm}</span> · <span>${latStr}</span> <span>${lonStr}</span></div>
      </div>`;
    }).join('');
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="sat-flyto"]').forEach(card => {
      card.addEventListener('click', () => {
        const idx = parseInt(card.dataset.idx);
        const { satrec, name } = this.satrecs[idx] || {};
        if (!satrec) return;
        try {
          const geo = this._currentGeo(satrec);
          if (!geo) return;
          const lat = Cesium.Math.toDegrees(geo.latitude);
          const lon = Cesium.Math.toDegrees(geo.longitude);
          const alt = geo.height * 1000;
          const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
          this.viewer.camera.flyToBoundingSphere(
            new Cesium.BoundingSphere(center, 1),
            { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), alt + 500000), duration: 1.5 }
          );
          this.highlightIdx(idx);
          // Fire onSelect so entity detail also pops up
          this.onSelect?.({ type: 'satellite', name,
            altitude:  Math.round(geo.height) + ' km',
            latitude:  lat.toFixed(3) + '°',
            longitude: lon.toFixed(3) + '°',
          }, idx);
        } catch (e) { console.warn('sat flyto error', e); }
      });
    });
  }

  destroy() {
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    if (this._pointCollection) this.viewer.scene.primitives.remove(this._pointCollection);
    if (this._labelCollection) this.viewer.scene.primitives.remove(this._labelCollection);
  }
}
