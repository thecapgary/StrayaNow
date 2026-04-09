import { getConfig } from './config.js';

export let viewer = null;

export const MAP_PROVIDERS = {
  osm:        { label: 'Street (OSM)' },
  hybrid:     { label: 'Hybrid (Satellite+Labels)' },
  satellite:  { label: 'Satellite' },
  dark:       { label: 'Dark' },
  google3d:   { label: 'Google 3D Tiles' },
};

export async function initViewer() {
  const cfg = await getConfig();
  if (cfg.cesiumToken) Cesium.Ion.defaultAccessToken = cfg.cesiumToken;

  viewer = new Cesium.Viewer('cesiumContainer', {
    animation: false,
    baseLayerPicker: false,
    fullscreenButton: false,
    geocoder: false,
    homeButton: false,
    infoBox: false,
    sceneModePicker: false,
    selectionIndicator: false,
    timeline: false,
    navigationHelpButton: false,
    imageryProvider: false,
    // Cesium World Terrain when token available
    ...(cfg.cesiumToken ? { terrain: Cesium.Terrain.fromWorldTerrain() } : {}),
  });

  viewer.scene.skyAtmosphere.show = true;
  viewer.scene.globe.enableLighting = false;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString('#05070d');

  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(134.0, -27.0, 4500000),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-60), roll: 0 },
  });

  viewer._cfg = cfg;

  // Default: OSM (always works, synchronous, labelled)
  await setMapProvider('osm', cfg);

  return viewer;
}

// Persistent Google 3D tileset
let _google3dTileset = null;

export async function setMapProvider(providerKey, cfg) {
  cfg = cfg || viewer?._cfg || {};

  viewer.imageryLayers.removeAll();

  // Hide Google 3D tiles unless we're switching to it
  if (_google3dTileset) _google3dTileset.show = false;
  viewer.scene.globe.show = true;

  if (providerKey === 'google3d') {
    if (!cfg.googleMapsKey) {
      console.warn('No Google Maps key — using satellite fallback');
      providerKey = 'satellite';
    } else {
      viewer.scene.globe.show = false;
      try {
        if (!_google3dTileset) {
          _google3dTileset = await Cesium.Cesium3DTileset.fromUrl(
            `https://tile.googleapis.com/v1/3dtiles/root.json?key=${cfg.googleMapsKey}`
          );
          viewer.scene.primitives.add(_google3dTileset);
        } else {
          _google3dTileset.show = true;
        }
        updateProviderUI('google3d');
        return;
      } catch (e) {
        console.warn('Google 3D Tiles failed:', e.message);
        viewer.scene.globe.show = true;
        providerKey = 'satellite';
      }
    }
  }

  // All 2D providers use UrlTemplateImageryProvider (synchronous, stable in Cesium 1.115)
  // ESRI ArcGIS providers changed to async fromUrl() in Cesium 1.104 — use XYZ tile URLs instead
  const ESRI_IMAGERY = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
  const ESRI_REFERENCE = 'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}';
  const ESRI_DARK = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}';
  const OSM = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

  const providers = {
    osm: [
      { url: OSM, credit: '© OpenStreetMap contributors' },
    ],
    hybrid: [
      { url: ESRI_IMAGERY, credit: '© Esri, Maxar' },
      { url: ESRI_REFERENCE, credit: '© Esri', alpha: 0.9 },
    ],
    satellite: [
      { url: ESRI_IMAGERY, credit: '© Esri, Maxar' },
    ],
    dark: [
      { url: ESRI_DARK, credit: '© Esri' },
    ],
  };

  const layers = providers[providerKey] || providers.osm;

  for (const def of layers) {
    const provider = new Cesium.UrlTemplateImageryProvider({
      url: def.url,
      credit: def.credit || '',
      maximumLevel: 19,
    });
    const layer = viewer.imageryLayers.addImageryProvider(provider);
    if (def.alpha != null) layer.alpha = def.alpha;
  }

  updateProviderUI(providerKey);
}

function updateProviderUI(activeKey) {
  document.querySelectorAll('[data-provider]').forEach(btn => {
    const active = btn.dataset.provider === activeKey;
    btn.style.background = active ? 'rgba(249,168,37,0.2)' : 'transparent';
    btn.style.color = active ? '#f9a825' : '#555';
    btn.style.borderColor = active ? 'rgba(249,168,37,0.5)' : 'rgba(255,255,255,0.1)';
  });
}
