// Live GPS beacon layer — receives position from /gps mobile page via WebSocket relay
// Shows a blue "you are here" dot + accuracy ring on the globe

const GPS_COLOR   = '#4285f4'; // Google Maps blue
const GPS_OUTLINE = '#fff';

export class GpsLayer {
  constructor(viewer) {
    this.viewer      = viewer;
    this._entity     = null;   // blue dot
    this._accEntity  = null;   // accuracy ellipse
    this._lastPos    = null;
    this._connected  = false;
    this._listRefresh = null;  // callback set by main.js
  }

  // Called from main.js WS handler when type === 'gps'
  update({ lat, lon, acc, heading, speed, ts }) {
    this._lastPos   = { lat, lon, acc, heading, speed, ts };
    this._connected = true;

    const pos = Cesium.Cartesian3.fromDegrees(lon, lat, 80);

    if (!this._entity) {
      this._entity = this.viewer.entities.add({
        id: 'gps_dot',
        position: new Cesium.ConstantPositionProperty(pos),
        point: {
          pixelSize:  16,
          color:      Cesium.Color.fromCssColorString(GPS_COLOR),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 3,
          disableDepthTestDistance: 5e5,
          scaleByDistance: new Cesium.NearFarScalar(1e3, 1.2, 1e6, 0.6),
        },
        label: {
          text:       'MY LOCATION',
          font:       '10px monospace',
          fillColor:  Cesium.Color.fromCssColorString(GPS_COLOR),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style:      Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(0, -22),
          distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 200000),
          disableDepthTestDistance: 5e5,
        },
      });
    } else {
      this._entity.position = new Cesium.ConstantPositionProperty(pos);
    }

    // Accuracy ring — draw as ground ellipse approximation
    const accMeters = acc || 20;
    if (!this._accEntity) {
      this._accEntity = this.viewer.entities.add({
        id: 'gps_accuracy',
        position: new Cesium.ConstantPositionProperty(
          Cesium.Cartesian3.fromDegrees(lon, lat, 10)
        ),
        ellipse: {
          semiMajorAxis: accMeters,
          semiMinorAxis: accMeters,
          material: Cesium.Color.fromCssColorString(GPS_COLOR).withAlpha(0.15),
          outline: true,
          outlineColor: Cesium.Color.fromCssColorString(GPS_COLOR).withAlpha(0.5),
          outlineWidth: 1,
          heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
        },
      });
    } else {
      this._accEntity.position = new Cesium.ConstantPositionProperty(
        Cesium.Cartesian3.fromDegrees(lon, lat, 10)
      );
      this._accEntity.ellipse.semiMajorAxis = new Cesium.ConstantProperty(accMeters);
      this._accEntity.ellipse.semiMinorAxis = new Cesium.ConstantProperty(accMeters);
    }

    // Refresh the data panel list if it's showing our tab
    this._listRefresh?.();
  }

  // Called when device disconnects
  setDisconnected() {
    this._connected = false;
    this._listRefresh?.();
  }

  flyTo() {
    if (!this._lastPos) return;
    const { lat, lon } = this._lastPos;
    this.viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(Cesium.Cartesian3.fromDegrees(lon, lat, 0), 1),
      { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-45), 4000), duration: 2 }
    );
  }

  _clear() {
    if (this._entity)    { this.viewer.entities.remove(this._entity);    this._entity    = null; }
    if (this._accEntity) { this.viewer.entities.remove(this._accEntity); this._accEntity = null; }
  }

  // Minimal load() so it fits the layer registration pattern
  async load() { return 0; }

  setEnabled(enabled) {
    if (!enabled) this._clear();
    // When re-enabled, dot reappears on next GPS update
  }

  getListHTML() {
    const p = this._lastPos;

    const deviceUrl = `${location.protocol}//${location.host}/gps`;

    if (!p) {
      return `
        <div style="padding:14px">
          <div style="font-size:10px;color:#555;margin-bottom:12px;letter-spacing:0.12em">GPS BEACON</div>
          <p style="font-size:11px;color:#888;line-height:1.7;margin-bottom:16px">
            Open the beacon page on your phone to broadcast your live location to this map.
          </p>
          <div style="background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);
                      border-radius:4px;padding:10px 12px;margin-bottom:10px">
            <div style="font-size:9px;color:#555;margin-bottom:4px;letter-spacing:0.1em">BEACON URL</div>
            <div style="font-size:12px;color:#4285f4;word-break:break-all">${deviceUrl}</div>
          </div>
          <p style="font-size:10px;color:#444;line-height:1.6">
            Open this URL in your phone's browser.<br>
            Allow location access when prompted.<br>
            Your live position will appear on the globe.
          </p>
        </div>`;
    }

    const age     = Math.round((Date.now() - p.ts) / 1000);
    const ageStr  = age < 60 ? `${age}s ago` : `${Math.round(age/60)}m ago`;
    const spdStr  = p.speed != null && p.speed > 0
      ? `${(p.speed * 3.6).toFixed(1)} km/h` : 'Stationary';
    const hdgStr  = p.heading != null ? `${Math.round(p.heading)}°` : '—';
    const accStr  = p.acc != null ? `±${Math.round(p.acc)} m` : '—';
    const connColor = this._connected ? '#4caf50' : '#888';
    const connLabel = this._connected ? 'LIVE' : 'LAST KNOWN';

    return `
      <div style="padding:12px 14px">
        <div style="font-size:10px;color:#555;margin-bottom:12px;letter-spacing:0.12em;
                    display:flex;align-items:center;gap:8px">
          GPS BEACON
          <span style="color:${connColor};font-size:9px">${connLabel}</span>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
          ${[
            ['LAT',      p.lat.toFixed(6)],
            ['LON',      p.lon.toFixed(6)],
            ['ACCURACY', accStr],
            ['UPDATED',  ageStr],
            ['SPEED',    spdStr],
            ['HEADING',  hdgStr],
          ].map(([k,v]) => `
            <div style="background:rgba(255,255,255,0.04);border-radius:3px;padding:7px 9px">
              <div style="font-size:9px;color:#444;letter-spacing:0.1em;margin-bottom:2px">${k}</div>
              <div style="font-size:12px;color:#4285f4">${v}</div>
            </div>`
          ).join('')}
        </div>

        <button data-action="gps-flyto"
          style="width:100%;padding:8px;background:rgba(66,133,244,0.14);
                 border:1px solid rgba(66,133,244,0.4);color:#4285f4;
                 font-family:monospace;font-size:11px;letter-spacing:0.1em;
                 border-radius:4px;cursor:pointer;margin-bottom:12px">
          FLY TO MY LOCATION
        </button>

        <div style="font-size:9px;color:#333;border-top:1px solid rgba(255,255,255,0.05);
                    padding-top:10px;word-break:break-all">
          Beacon: <span style="color:#444">${deviceUrl}</span>
        </div>
      </div>`;
  }

  bindListClicks(container) {
    container.querySelector('[data-action="gps-flyto"]')
      ?.addEventListener('click', () => this.flyTo());
  }

  destroy() { this._clear(); }
}
