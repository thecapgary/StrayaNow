// Network Traceroute layer — animated arcs between geolocated hops
export class TracerouteLayer {
  constructor(viewer) {
    this.viewer = viewer;
    this.enabled = true;
    this.traces = []; // { target, hops: [{ip, lat, lon, city, country, rtt, hop}] }
    this.entities = [];
    this.count = 0;
    this._animFrame = null;
    this._pulsePhase = 0;
  }

  async load() { return 0; }

  async runTrace(target) {
    if (!target) return;

    // Clear previous trace for this target
    this.clearTrace(target);

    // POST to backend SSE endpoint
    const res = await fetch('/api/traceroute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target }),
    }).catch(e => { console.warn('Traceroute error:', e); return null; });

    if (!res?.ok) return;

    const data = await res.json();
    const hops = (data.hops || []).filter(h => h.lat && h.lon);
    if (hops.length < 2) return;

    this.traces.push({ target, hops });
    this._renderTrace(target, hops);
    this.count = this.traces.length;
    this.onDataUpdate?.();
  }

  _renderTrace(target, hops) {
    const colors = ['#f9a825','#00e5ff','#69f0ae','#ff6d00','#e040fb'];
    const color = colors[this.traces.length % colors.length];

    for (let i = 0; i < hops.length - 1; i++) {
      const from = hops[i];
      const to = hops[i + 1];
      const mid = {
        lon: (from.lon + to.lon) / 2,
        lat: (from.lat + to.lat) / 2,
        alt: 200000 + i * 30000,
      };

      // Arc polyline
      const positions = this._greatCircleArc(
        [from.lon, from.lat], [to.lon, to.lat], 20, mid.alt
      );

      const arc = this.viewer.entities.add({
        polyline: {
          positions,
          width: 2,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.2,
            color: Cesium.Color.fromCssColorString(color).withAlpha(0.8),
          }),
          clampToGround: false,
        },
        _data: { type: 'traceroute', target, hop: i },
      });
      this.entities.push(arc);

      // Hop point
      const pt = this.viewer.entities.add({
        position: Cesium.Cartesian3.fromDegrees(to.lon, to.lat, mid.alt),
        point: {
          pixelSize: 8,
          color: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.WHITE,
          outlineWidth: 1,
          disableDepthTestDistance: 5e5,
        },
        label: {
          text: `${i + 1}. ${to.city || to.ip}\n${to.rtt ? to.rtt + 'ms' : ''}`,
          font: '10px monospace',
          fillColor: Cesium.Color.fromCssColorString(color),
          outlineColor: Cesium.Color.BLACK,
          outlineWidth: 2,
          style: Cesium.LabelStyle.FILL_AND_OUTLINE,
          pixelOffset: new Cesium.Cartesian2(12, 0),
          disableDepthTestDistance: 5e5,
        },
        _data: { type: 'traceroute_hop', ...to, hop: i + 1 },
      });
      this.entities.push(pt);
    }
  }

  _greatCircleArc([lon1, lat1], [lon2, lat2], steps, altitude) {
    const pts = [];
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const lon = lon1 + (lon2 - lon1) * t;
      const lat = lat1 + (lat2 - lat1) * t;
      // Parabolic altitude arc
      const h = altitude * Math.sin(t * Math.PI);
      pts.push(Cesium.Cartesian3.fromDegrees(lon, lat, h));
    }
    return pts;
  }

  clearTrace(target) {
    this.traces = this.traces.filter(t => t.target !== target);
    // Remove associated entities (remove all for simplicity)
    for (const e of this.entities) this.viewer.entities.remove(e);
    this.entities = [];
    this.count = this.traces.length;
  }

  clearAll() {
    for (const e of this.entities) this.viewer.entities.remove(e);
    this.entities = [];
    this.traces = [];
    this.count = 0;
    this.onDataUpdate?.();
  }

  getListHTML() {
    return `
      <div style="padding:8px 12px;">
        <div style="margin-bottom:8px">
          <div style="font-size:10px;color:#555;margin-bottom:4px;letter-spacing:0.08em">TARGET HOST / IP</div>
          <div style="display:flex;gap:6px">
            <input id="traceroute-input" type="text" placeholder="8.8.8.8 or hostname"
              style="flex:1;background:#0a0a14;border:1px solid rgba(0,229,255,0.3);color:#ccc;
                     padding:5px 8px;font-family:monospace;font-size:11px;border-radius:2px;outline:none" />
            <button id="traceroute-run"
              style="background:rgba(0,229,255,0.15);border:1px solid rgba(0,229,255,0.4);
                     color:#00e5ff;padding:5px 10px;font-family:monospace;font-size:10px;
                     cursor:pointer;border-radius:2px;letter-spacing:0.08em">TRACE</button>
          </div>
        </div>
        ${this.traces.length === 0
          ? '<p class="panel-empty">No traces yet. Enter a target and click TRACE.</p>'
          : this.traces.map(t => `
              <div class="list-card">
                <div class="list-card-title" style="color:#00e5ff">${t.target}</div>
                <div class="list-card-detail">${t.hops.length} hops resolved</div>
                ${t.hops.map((h, i) =>
                  `<div class="list-card-detail">${i + 1}. <span>${h.ip}</span> ${h.city ? '— ' + h.city + ', ' + h.country : ''} ${h.rtt ? h.rtt + 'ms' : ''}</div>`
                ).join('')}
                <button data-action="clear-trace" data-target="${t.target}"
                  style="margin-top:4px;background:none;border:1px solid #333;color:#555;
                         font-size:9px;padding:2px 6px;cursor:pointer;font-family:monospace">CLEAR</button>
              </div>`
          ).join('')}
      </div>`;
  }

  bindListClicks(container) {
    const input = container.querySelector('#traceroute-input');
    const btn = container.querySelector('#traceroute-run');

    btn?.addEventListener('click', async () => {
      const target = input?.value?.trim();
      if (!target) return;
      btn.textContent = 'TRACING...';
      btn.disabled = true;
      await this.runTrace(target);
      btn.textContent = 'TRACE';
      btn.disabled = false;
      this.onDataUpdate?.();
    });

    input?.addEventListener('keydown', e => {
      if (e.key === 'Enter') btn?.click();
    });

    container.querySelectorAll('[data-action="clear-trace"]').forEach(b => {
      b.addEventListener('click', () => {
        this.clearTrace(b.dataset.target);
        this.onDataUpdate?.();
      });
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    for (const e of this.entities) e.show = enabled;
  }

  destroy() {
    for (const e of this.entities) this.viewer.entities.remove(e);
    this.entities = [];
  }
}
