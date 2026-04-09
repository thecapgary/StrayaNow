// Weather layer — BOM observations via Open-Meteo, displayed as globe entities
export class WeatherLayer {
  constructor(viewer, onSelect) {
    this.viewer = viewer;
    this.onSelect = onSelect;
    this.entities = [];
    this.enabled = false;
    this.count = 0;
    this._data = [];
  }

  async load() {
    try {
      const data = await fetch('/api/weather').then(r => r.json());
      this._data = data.cities || [];
    } catch (e) {
      console.warn('Weather load error:', e);
      this._data = [];
    }
    this._render();
    this.count = this._data.length;
    this.onDataUpdate?.();
    return this.count;
  }

  _render() {
    for (const e of this.entities) this.viewer.entities.remove(e);
    this.entities = [];

    for (const city of this._data) {
      const color = this._tempColor(city.temp);
      const entity = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(city.lon, city.lat, 8000),
        label: {
          text: `${city.icon} ${city.temp}°\n${city.name}`,
          font: '11px "Courier New", monospace',
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
          pixelOffset: new Cesium.Cartesian2(0, -10),
          disableDepthTestDistance: 5e5,
          scaleByDistance: new Cesium.NearFarScalar(400000, 1.1, 6000000, 0.65),
          translucencyByDistance: new Cesium.NearFarScalar(200000, 1.0, 8000000, 0.6),
        },
        point: {
          pixelSize: 7,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK.withAlpha(0.8),
          outlineWidth: 2,
          disableDepthTestDistance: 5e5,
          scaleByDistance: new Cesium.NearFarScalar(200000, 1.2, 6000000, 0.6),
        },
        show: this.enabled,
        _data: { type: 'weather', ...city },
      });
      this.entities.push(entity);
    }
  }

  _tempColor(temp) {
    if (temp >= 40) return '#ff1744';
    if (temp >= 35) return '#ff5722';
    if (temp >= 28) return '#f9a825';
    if (temp >= 20) return '#ffeb3b';
    if (temp >= 12) return '#69f0ae';
    if (temp >= 4)  return '#4fc3f7';
    return '#ce93d8';
  }

  _windArrow(deg) {
    const dirs = ['N','NE','E','SE','S','SW','W','NW'];
    return dirs[Math.round(deg / 45) % 8];
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    for (const e of this.entities) e.show = enabled;
    if (enabled && this._data.length === 0) this.load();
  }

  getListHTML() {
    if (!this._data.length) {
      return '<p class="panel-empty">Loading weather data...</p>';
    }
    const rows = this._data.map((c, i) => {
      const col = this._tempColor(c.temp);
      return `<div class="list-card" data-wx-idx="${i}">
        <div class="list-card-title" style="color:${col}">${c.icon} ${c.name} <span style="color:#444;font-size:10px">${c.state}</span></div>
        <div class="list-card-detail">${c.temp}°C &nbsp;·&nbsp; feels ${c.feels}°C &nbsp;·&nbsp; ${c.desc}</div>
        <div class="list-card-detail">💨 ${c.wind} km/h ${this._windArrow(c.wind_dir)} &nbsp;💧 ${c.precip}mm</div>
      </div>`;
    }).join('');
    return `<div style="padding:0">
      <div style="padding:6px 12px 2px;font-size:9px;color:#444;letter-spacing:0.1em">CURRENT CONDITIONS — SOURCE: OPEN-METEO / BOM</div>
      ${rows}
    </div>`;
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-wx-idx]').forEach(card => {
      card.addEventListener('click', () => {
        const city = this._data[parseInt(card.dataset.wxIdx)];
        if (!city) return;
        this.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(city.lon, city.lat, 350000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.5,
        });
      });
    });
  }

  destroy() {
    for (const e of this.entities) this.viewer.entities.remove(e);
    this.entities = [];
  }
}
