// Tasmania LIST (Land Information System Tasmania)
// Basemaps/* use tile cache (UrlTemplate); Public/* use ArcGIS export (dynamic)
const LIST_BASE = 'https://services.thelist.tas.gov.au/arcgis/rest/services';

export const LISTMAPS_LAYERS = {
  // ── Imagery (tile-cached, fast) ──────────────────────────────
  aerial: {
    label: 'State Aerial Photography',
    group: 'Imagery',
    color: '#4fc3f7',
    tileUrl: `${LIST_BASE}/Basemaps/Orthophoto/MapServer/tile/{z}/{y}/{x}`,
    alpha: 1.0,
  },
  topo: {
    label: 'Topographic',
    group: 'Imagery',
    color: '#81c784',
    tileUrl: `${LIST_BASE}/Basemaps/Topographic/MapServer/tile/{z}/{y}/{x}`,
    alpha: 0.9,
  },

  // ── Land & Planning (ArcGIS dynamic) ────────────────────────
  cadastral: {
    label: 'Cadastral Parcels',
    group: 'Land',
    color: '#ffeb3b',
    arcgisUrl: `${LIST_BASE}/Public/CadastreParcels/MapServer`,
    alpha: 0.75,
    service: 'Public/CadastreAndAdministrative',
  },
  planning: {
    label: 'Planning Zones',
    group: 'Land',
    color: '#ff7043',
    arcgisUrl: `${LIST_BASE}/Public/Planning/MapServer`,
    alpha: 0.5,
    service: 'Public/Planning',
  },

  // ── Parks & Environment ──────────────────────────────────────
  natural_env: {
    label: 'National Parks & Natural Areas',
    group: 'Parks',
    color: '#66bb6a',
    arcgisUrl: `${LIST_BASE}/Public/NaturalEnvironment/MapServer`,
    alpha: 0.55,
    service: 'Public/NaturalEnvironment',
  },

  // ── Marine ───────────────────────────────────────────────────
  marine: {
    label: 'Marine & Coastal Zones',
    group: 'Marine',
    color: '#29b6f6',
    arcgisUrl: `${LIST_BASE}/Public/MarineAndCoastal/MapServer`,
    alpha: 0.5,
    service: 'Public/MarineAndCoastal',
  },
  fisheries: {
    label: 'Wild Fisheries & Restrictions',
    group: 'Marine',
    color: '#00bcd4',
    arcgisUrl: `${LIST_BASE}/Public/WildFisheries/MapServer`,
    alpha: 0.5,
    service: 'Public/WildFisheries',
  },
};

const GROUP_ORDER = ['Imagery', 'Land', 'Parks', 'Marine'];

export class ListmapsLayer {
  constructor(viewer) {
    this.viewer = viewer;
    this.imageryLayers = {};  // key → Cesium ImageryLayer
    this.alphas = {};          // key → current alpha %
    this._loading = new Set(); // keys currently loading
    this.enabled = true;
    this.count = Object.keys(LISTMAPS_LAYERS).length;
    this._clickHandler = null;
    this._initClickHandler();
  }

  async load() { return this.count; }

  async toggleSublayer(key, visible) {
    const def = LISTMAPS_LAYERS[key];
    if (!def) return;

    if (!visible) {
      const layer = this.imageryLayers[key];
      if (layer) {
        this.viewer.imageryLayers.remove(layer, false);
        delete this.imageryLayers[key];
        delete this.alphas[key];
      }
      return;
    }

    if (this.imageryLayers[key] || this._loading.has(key)) return;

    this._loading.add(key);
    try {
      let provider;
      if (def.arcgisUrl) {
        provider = await Cesium.ArcGisMapServerImageryProvider.fromUrl(def.arcgisUrl);
      } else {
        provider = new Cesium.UrlTemplateImageryProvider({
          url: def.tileUrl,
          credit: '© The LIST, State of Tasmania',
          maximumLevel: 20,
        });
      }
      const layer = this.viewer.imageryLayers.addImageryProvider(provider);
      layer.alpha = def.alpha;
      this.imageryLayers[key] = layer;
      this.alphas[key] = Math.round(def.alpha * 100);
    } catch (e) {
      console.warn(`LIST layer "${key}" failed:`, e.message);
    } finally {
      this._loading.delete(key);
    }
  }

  setAlpha(key, pct) {
    this.alphas[key] = pct;
    const layer = this.imageryLayers[key];
    if (layer) layer.alpha = pct / 100;
  }

  getListHTML() {
    const byGroup = {};
    for (const [key, def] of Object.entries(LISTMAPS_LAYERS)) {
      if (!byGroup[def.group]) byGroup[def.group] = [];
      byGroup[def.group].push({ key, def });
    }

    const sections = GROUP_ORDER.map(group => {
      const items = byGroup[group] || [];
      return `
        <div style="padding:2px 0">
          <div style="padding:5px 12px 2px;font-size:8px;letter-spacing:0.18em;color:#555;text-transform:uppercase">${group}</div>
          ${items.map(({ key, def }) => {
            const on = !!this.imageryLayers[key];
            const loading = this._loading.has(key);
            const alpha = this.alphas[key] ?? Math.round(def.alpha * 100);
            return `
              <div class="list-card" style="padding:6px 12px">
                <div style="display:flex;align-items:center;gap:8px;cursor:pointer"
                     data-action="toggle-listmap" data-key="${key}">
                  <div style="width:9px;height:9px;border-radius:50%;flex-shrink:0;transition:all 0.2s;
                    background:${loading ? '#888' : on ? def.color : '#2a2a2a'};
                    border:1px solid ${on || loading ? def.color : '#444'};
                    ${loading ? 'animation:pulse 0.8s infinite' : ''}"></div>
                  <div class="list-card-title" style="color:${on ? def.color : loading ? '#888' : '#555'};font-size:11px">
                    ${def.label}${loading ? ' …' : ''}
                  </div>
                </div>
                ${on ? `
                <div style="display:flex;align-items:center;gap:6px;margin-top:5px;padding-left:17px">
                  <span style="font-size:9px;color:#444;width:10px">α</span>
                  <input type="range" min="0" max="100" value="${alpha}"
                    style="flex:1;height:3px;accent-color:${def.color};cursor:pointer"
                    data-action="set-alpha" data-key="${key}" />
                  <span class="alpha-val-${key}" style="font-size:9px;color:#555;width:28px;text-align:right">${alpha}%</span>
                </div>` : ''}
              </div>`;
          }).join('')}
        </div>`;
    }).join('');

    return `<div>
      <div style="padding:6px 12px 4px;font-size:9px;color:#444;line-height:1.5">
        Toggle layers. Click the globe to identify features when layers are active.
      </div>
      ${sections}
    </div>`;
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="toggle-listmap"]').forEach(row => {
      row.addEventListener('click', async () => {
        const key = row.dataset.key;
        const on = !!this.imageryLayers[key];
        await this.toggleSublayer(key, !on);
        this.onDataUpdate?.(); // single refresh once toggle is complete
      });
    });

    container.querySelectorAll('[data-action="set-alpha"]').forEach(slider => {
      slider.addEventListener('input', () => {
        const key = slider.dataset.key;
        const pct = parseInt(slider.value);
        this.setAlpha(key, pct);
        const label = container.querySelector(`.alpha-val-${key}`);
        if (label) label.textContent = pct + '%';
      });
    });
  }

  // ── Click-to-identify ─────────────────────────────────────────
  _initClickHandler() {
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction(async (click) => {
      if (!this.enabled) return;

      const activeServices = [...new Set(
        Object.keys(this.imageryLayers)
          .map(k => LISTMAPS_LAYERS[k]?.service)
          .filter(Boolean)
      )];
      if (!activeServices.length) return;

      // Don't intercept entity clicks
      const picked = this.viewer.scene.pick(click.position);
      if (Cesium.defined(picked) && picked.id) return;

      const ray = this.viewer.camera.getPickRay(click.position);
      const cartesian = this.viewer.scene.globe.pick(ray, this.viewer.scene);
      if (!cartesian) return;

      const carto = Cesium.Cartographic.fromCartesian(cartesian);
      const lon = Cesium.Math.toDegrees(carto.longitude);
      const lat = Cesium.Math.toDegrees(carto.latitude);

      const rect = this.viewer.camera.computeViewRectangle(this.viewer.scene.globe.ellipsoid);
      const extent = rect
        ? [rect.west, rect.south, rect.east, rect.north].map(Cesium.Math.toDegrees).join(',')
        : `${lon - 1},${lat - 1},${lon + 1},${lat + 1}`;

      const { width, height } = this.viewer.scene.canvas;

      showIdentifyPopup(lon, lat, null);

      const params = new URLSearchParams({
        lon: lon.toFixed(6), lat: lat.toFixed(6),
        services: activeServices.join(','),
        extent, width, height,
      });

      try {
        const data = await fetch(`/api/listmaps/identify?${params}`).then(r => r.json());
        showIdentifyPopup(lon, lat, data.results || []);
      } catch {
        showIdentifyPopup(lon, lat, []);
      }
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

    this._clickHandler = handler;
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    for (const layer of Object.values(this.imageryLayers)) layer.show = enabled;
  }

  destroy() {
    if (this._clickHandler) this._clickHandler.destroy();
    for (const layer of Object.values(this.imageryLayers)) {
      this.viewer.imageryLayers.remove(layer, false);
    }
    this.imageryLayers = {};
  }
}

// ── Identify popup ────────────────────────────────────────────────
function showIdentifyPopup(lon, lat, results) {
  const popup = document.getElementById('identify-popup');
  const body  = document.getElementById('identify-body');
  const coord = document.getElementById('identify-coord');
  if (!popup) return;

  popup.style.display = 'flex';
  if (coord) coord.textContent =
    `${Math.abs(lat).toFixed(4)}°${lat < 0 ? 'S' : 'N'}  ${Math.abs(lon).toFixed(4)}°${lon < 0 ? 'W' : 'E'}`;

  if (results === null) {
    body.innerHTML = '<div class="id-loading">Identifying features…</div>';
    return;
  }
  if (!results.length) {
    body.innerHTML = '<div class="id-empty">No features found at this location.</div>';
    return;
  }
  body.innerHTML = results.map(r => {
    const rows = Object.entries(r.attributes)
      .map(([k, v]) => `<div class="id-attr"><span class="id-key">${k}</span><span class="id-val">${v}</span></div>`)
      .join('');
    return `<div class="id-result">
      <div class="id-layer-name">${r.layerName}</div>
      ${rows}
    </div>`;
  }).join('');
}

document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('identify-close')?.addEventListener('click', () => {
    const p = document.getElementById('identify-popup');
    if (p) p.style.display = 'none';
  });
});
