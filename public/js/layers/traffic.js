// Road traffic particle system using OSM road geometry + TomTom live flow data
const CITIES = {
  tasmania:   { lat: -42.16, lon: 147.23, name: 'Tasmania',   radiusKm: 80  },
  hobart:     { lat: -42.88, lon: 147.33, name: 'Hobart',     radiusKm: 8   },
  launceston: { lat: -41.43, lon: 147.14, name: 'Launceston', radiusKm: 6   },
  sydney:     { lat: -33.87, lon: 151.21, name: 'Sydney' },
  melbourne:  { lat: -37.81, lon: 144.96, name: 'Melbourne' },
  brisbane:   { lat: -27.47, lon: 153.02, name: 'Brisbane' },
  perth:      { lat: -31.95, lon: 115.86, name: 'Perth' },
  adelaide:   { lat: -34.93, lon: 138.60, name: 'Adelaide' },
};

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

async function fetchRoads(lat, lon, radiusKm = 6) {
  const r = radiusKm * 1000;
  const query = `[out:json][timeout:25];
way["highway"~"^(motorway|trunk|primary|secondary)$"](around:${r},${lat},${lon});
out geom;`;
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    body: `data=${encodeURIComponent(query)}`,
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
  });
  return res.json();
}

function buildRoadSegments(osmData) {
  const segments = [];
  for (const element of osmData.elements || []) {
    if (element.type !== 'way' || !element.geometry) continue;
    const coords = element.geometry.map(n => [n.lon, n.lat]);
    for (let i = 0; i < coords.length - 1; i++) {
      segments.push({ from: coords[i], to: coords[i + 1] });
    }
  }
  return segments;
}

// Congestion ratio → color (mirrors server-side logic)
function congestionColor(ratio) {
  if (ratio >= 0.85) return '#4caf50'; // green  — free flow
  if (ratio >= 0.60) return '#ff9800'; // amber  — moderate
  return '#f44336';                    // red    — congested
}

// Build road segments from TomTom's own geometry — each segment carries its real congestion data
function buildTomTomSegments(flowData) {
  const segs = [];
  for (const f of flowData) {
    if (!f.coords || f.coords.length < 2) continue;
    for (let i = 0; i < f.coords.length - 1; i++) {
      segs.push({ from: f.coords[i], to: f.coords[i + 1], ratio: f.ratio, color: f.color });
    }
  }
  return segs;
}

class Particle {
  constructor(segment, flowRatio = 1.0) {
    this.segment = segment;
    this.t = Math.random();
    // Slower particles on congested roads (range: 40–100% of base speed)
    const speedScale = 0.4 + flowRatio * 0.6;
    this.speed = (0.0015 + Math.random() * 0.002) * speedScale;
    // Use pre-computed color from TomTom segment if available, otherwise derive from ratio
    this.color = segment.color ?? congestionColor(flowRatio);
  }

  get position() {
    const [fx, fy] = this.segment.from;
    const [tx, ty] = this.segment.to;
    return [fx + (tx - fx) * this.t, fy + (ty - fy) * this.t];
  }

  advance() {
    this.t += this.speed;
    if (this.t > 1) this.t = 0;
  }
}

export class TrafficLayer {
  constructor(viewer) {
    this.viewer = viewer;
    this.segments = [];
    this.particles = [];
    this._collection = null;
    this._points = [];
    this._flowData = [];       // TomTom flow data (cached)
    this._flowCity = null;     // city key for cached flow
    this.enabled = false;
    this.animFrame = null;
    this.count = 0;
    this.loadedCity = null;
  }

  async load(cityKey = 'tasmania') {
    const city = CITIES[cityKey];
    if (!city) return 0;
    if (this.loadedCity === cityKey) return this.count;

    this._clear();
    this.loadedCity = cityKey;

    // Fetch TomTom flow first — its geometry determines whether we need OSM at all
    await this._fetchFlow(cityKey);

    const hasTomTomGeo = this._flowData.some(f => f.coords?.length >= 2);

    if (hasTomTomGeo) {
      // Real data mode: use only the roads TomTom actually measured — no OSM
      this.segments = buildTomTomSegments(this._flowData);
    } else {
      // Decorative fallback: fetch OSM road geometry
      try {
        const osmData = await fetchRoads(city.lat, city.lon, city.radiusKm || 6);
        this.segments = buildRoadSegments(osmData);
      } catch (e) {
        console.warn('Traffic load error:', e.message);
        return 0;
      }
    }

    if (this.segments.length === 0) return 0;

    // TomTom segments are fewer but longer — use more particles per segment for good density
    const ppm = hasTomTomGeo ? 8 : 3;
    const maxParticles = Math.min(this.segments.length * ppm, 3000);
    for (let i = 0; i < maxParticles; i++) {
      const seg = this.segments[i % this.segments.length];
      // TomTom segments carry ratio/color directly; OSM fallback uses default (yellow, free-flow)
      this.particles.push(new Particle(seg, seg.ratio ?? 1.0));
    }

    this._collection = new Cesium.PointPrimitiveCollection();
    this._collection.show = this.enabled;
    this.viewer.scene.primitives.add(this._collection);

    for (const p of this.particles) {
      const [lon, lat] = p.position;
      this._points.push(this._collection.add({
        position: Cesium.Cartesian3.fromDegrees(lon, lat, 5),
        color: Cesium.Color.fromCssColorString(p.color).withAlpha(0.85),
        pixelSize: 3,
      }));
    }

    this.count = this.particles.length;
    if (this.enabled) this._startAnimation();
    return this.count;
  }

  async _fetchFlow(cityKey) {
    if (this._flowCity === cityKey && this._flowData.length) return;
    try {
      const res = await fetch(`/api/trafficflow?city=${cityKey}`);
      if (res.ok) {
        this._flowData = await res.json();
        this._flowCity = cityKey;
        console.log(`[traffic] flow data: ${this._flowData.length} TomTom points`);
      }
    } catch (e) {
      console.warn('[traffic] TomTom flow unavailable:', e.message);
      this._flowData = [];
    }
  }

  _startAnimation() {
    const animate = () => {
      if (!this.enabled) return;
      for (let i = 0; i < this.particles.length; i++) {
        this.particles[i].advance();
        const [lon, lat] = this.particles[i].position;
        this._points[i].position = Cesium.Cartesian3.fromDegrees(lon, lat, 5);
      }
      this.animFrame = requestAnimationFrame(animate);
    };
    animate();
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (this._collection) this._collection.show = enabled;
    if (enabled && !this.animFrame) {
      if (this.particles.length === 0) this.load('tasmania');
      else this._startAnimation();
    } else if (!enabled && this.animFrame) {
      cancelAnimationFrame(this.animFrame);
      this.animFrame = null;
    }
  }

  _clear() {
    if (this.animFrame) { cancelAnimationFrame(this.animFrame); this.animFrame = null; }
    if (this._collection) this.viewer.scene.primitives.remove(this._collection);
    this._collection = null;
    this._points = [];
    this.particles = [];
    this.segments = [];
  }

  getListHTML() {
    const cityKeys = Object.keys(CITIES);
    const hasFlow = this._flowData.length > 0;

    // Build congestion summary from flow data
    let flowSummary = '';
    if (hasFlow) {
      const congested = this._flowData.filter(f => f.ratio < 0.60).length;
      const moderate  = this._flowData.filter(f => f.ratio >= 0.60 && f.ratio < 0.85).length;
      const flowing   = this._flowData.filter(f => f.ratio >= 0.85).length;
      const roadCards = this._flowData
        .sort((a, b) => a.ratio - b.ratio) // worst first
        .map(f => {
          const bar = Math.round(f.ratio * 60);
          return `<div class="list-card" data-action="flyto-road"
              data-lat="${f.lat}" data-lon="${f.lon}"
              style="display:flex;align-items:center;gap:8px;padding:4px 2px;
                     border-bottom:1px solid rgba(255,255,255,0.05);cursor:pointer">
            <div style="width:8px;height:8px;border-radius:50%;background:${f.color};flex-shrink:0"></div>
            <div style="flex:1;font-size:11px;color:#ccc">${f.desc}</div>
            <div style="width:60px;height:4px;background:rgba(255,255,255,0.1);border-radius:2px">
              <div style="width:${bar}px;height:4px;background:${f.color};border-radius:2px"></div>
            </div>
            <div style="font-size:11px;color:${f.color};width:36px;text-align:right">${f.currentSpeed}km/h</div>
          </div>`;
        }).join('');

      flowSummary = `
        <div style="margin:8px 0;padding:8px;background:rgba(255,255,255,0.04);border-radius:6px">
          <div style="font-size:11px;color:#888;margin-bottom:6px">LIVE CONGESTION · TomTom</div>
          <div style="display:flex;gap:12px;margin-bottom:8px">
            <span style="color:#4caf50;font-size:11px">● ${flowing} free flow</span>
            <span style="color:#ff9800;font-size:11px">● ${moderate} moderate</span>
            <span style="color:#f44336;font-size:11px">● ${congested} congested</span>
          </div>
          ${roadCards}
        </div>`;
    } else {
      flowSummary = `<p class="list-card-detail" style="margin:4px 0 8px">Add TomTom API key in Settings for live congestion colours.</p>`;
    }

    return `<div style="padding:8px 12px">
      ${flowSummary}
      <div style="font-size:11px;color:#888;margin:8px 0 4px">LOAD REGION</div>
      ${cityKeys.map(k => {
        const c = CITIES[k];
        const active = this.loadedCity === k;
        return `<div class="list-card" data-action="load-city" data-city="${k}" style="cursor:pointer">
          <div class="list-card-title" style="color:${active ? '#ffeb3b' : '#aaa'}">${c.name}${c.radiusKm >= 50 ? ' · state-wide' : ''}</div>
          <div class="list-card-detail">${active ? '● Active — ' + this.count + ' particles' : 'Click to load'}</div>
        </div>`;
      }).join('')}
    </div>`;
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="flyto-road"]').forEach(el => {
      el.addEventListener('click', () => {
        const lat = parseFloat(el.dataset.lat);
        const lon = parseFloat(el.dataset.lon);
        if (isNaN(lat) || isNaN(lon)) return;
        const center = Cesium.Cartesian3.fromDegrees(lon, lat, 0);
        this.viewer.camera.flyToBoundingSphere(
          new Cesium.BoundingSphere(center, 1),
          { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), 4000), duration: 1.5 }
        );
      });
    });

    container.querySelectorAll('[data-action="load-city"]').forEach(el => {
      el.addEventListener('click', () => {
        const city = el.dataset.city;
        this._clear();
        this.loadedCity = null; // allow reload
        this._flowCity = null;  // force flow re-fetch for new city
        this.load(city).then(() => {
          if (this.enabled) this.setEnabled(true);
          this.onDataUpdate?.();
        });
      });
    });
  }

  destroy() { this._clear(); }
}
