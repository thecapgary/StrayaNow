export class SeismicLayer {
  constructor(viewer, onSelect) {
    this.viewer = viewer;
    this.onSelect = onSelect;
    this.entities = [];
    this.enabled = true;
    this.count = 0;
  }

  async load(region = 'aus', minmag = 2.5) {
    const data = await fetch(`/api/seismic?region=${region}&minmag=${minmag}`).then(r => r.json());
    this._clear();

    for (const feature of data.features || []) {
      const [lon, lat, depth] = feature.geometry.coordinates;
      const props = feature.properties;
      const mag = props.mag || 0;

      // Size scales with magnitude
      const radius = Math.pow(10, mag * 0.4) * 8000;
      const alpha = Math.min(0.15 + mag * 0.05, 0.6);

      const entity = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
        ellipse: {
          semiMinorAxis: radius,
          semiMajorAxis: radius,
          material: Cesium.Color.fromCssColorString('#ff5722').withAlpha(alpha),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString('#ff5722').withAlpha(0.8),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
        label: {
          text: `M${mag.toFixed(1)}`,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString('#ff5722'),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -12),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 2000000),
          disableDepthTestDistance: 5e5,
        },
        show: this.enabled,
        _data: {
          type: 'earthquake',
          magnitude: mag,
          place: props.place,
          time: new Date(props.time).toISOString(),
          depth: (depth || 0).toFixed(1) + ' km',
          url: props.url,
          lon, lat,
        },
      });
      this.entities.push(entity);
    }

    this.count = this.entities.length;
    return this.count;
  }

  getListHTML() {
    const events = this.entities.map(e => e._data).filter(Boolean)
      .sort((a, b) => b.magnitude - a.magnitude);
    if (events.length === 0) return '<p class="panel-empty">No seismic events</p>';
    return events.map(ev => `
      <div class="list-card" data-action="flyto" data-lon="${ev.lon}" data-lat="${ev.lat}" data-alt="200000">
        <div class="list-card-title" style="color:#ff5722">M${ev.magnitude?.toFixed(1)}</div>
        <div class="list-card-detail"><span>${ev.place || '—'}</span></div>
        <div class="list-card-detail">Depth <span>${ev.depth}</span> · <span>${ev.time ? new Date(ev.time).toLocaleDateString('en-AU') : ''}</span></div>
      </div>`).join('');
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="flyto"]').forEach(card => {
      card.addEventListener('click', () => {
        const lon = parseFloat(card.dataset.lon);
        const lat = parseFloat(card.dataset.lat);
        if (isNaN(lon) || isNaN(lat)) return;
        this.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(lon, lat, 200000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.5,
        });
      });
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    for (const e of this.entities) e.show = enabled;
  }

  _clear() {
    for (const e of this.entities) this.viewer.entities.remove(e);
    this.entities = [];
  }

  destroy() { this._clear(); }
}
