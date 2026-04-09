// View controls: reset, current location, pan/zoom/rotate
const START_LOCATION_KEY = 'strayanow_start_location';

const DEFAULT_VIEW = {
  lon: 134.0, lat: -27.0, alt: 4500000,
  heading: 0, pitch: -60,
};

export function initViewControls(viewer) {
  const saved = loadStartLocation();
  const startView = saved || DEFAULT_VIEW;

  // ── Reset View ──
  document.getElementById('btn-reset-view')?.addEventListener('click', () => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(startView.lon, startView.lat, startView.alt),
      orientation: {
        heading: Cesium.Math.toRadians(startView.heading || 0),
        pitch: Cesium.Math.toRadians(startView.pitch || -60),
        roll: 0,
      },
      duration: 1.8,
    });
  });

  // ── Current Location ──
  document.getElementById('btn-my-location')?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Geolocation not available');
      return;
    }
    showToast('Locating...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { longitude, latitude } = pos.coords;
        viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromDegrees(longitude, latitude, 80000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-45), roll: 0 },
          duration: 1.5,
        });
        // Offer to save
        showSaveLocationPrompt(longitude, latitude);
      },
      err => showToast('Location error: ' + err.message),
      { timeout: 8000 }
    );
  });

  // ── Zoom ──
  document.getElementById('btn-zoom-in')?.addEventListener('click', () => {
    viewer.camera.zoomIn(viewer.camera.positionCartographic.height * 0.4);
  });
  document.getElementById('btn-zoom-out')?.addEventListener('click', () => {
    viewer.camera.zoomOut(viewer.camera.positionCartographic.height * 0.6);
  });

  // ── Pan ──
  const PAN_FRACTION = 0.15;
  document.getElementById('btn-pan-n')?.addEventListener('click', () => pan(viewer, 0, PAN_FRACTION));
  document.getElementById('btn-pan-s')?.addEventListener('click', () => pan(viewer, 0, -PAN_FRACTION));
  document.getElementById('btn-pan-e')?.addEventListener('click', () => pan(viewer, PAN_FRACTION, 0));
  document.getElementById('btn-pan-w')?.addEventListener('click', () => pan(viewer, -PAN_FRACTION, 0));

  // ── Rotate ──
  document.getElementById('btn-rotate-l')?.addEventListener('click', () => {
    viewer.camera.rotateLeft(Cesium.Math.toRadians(15));
  });
  document.getElementById('btn-rotate-r')?.addEventListener('click', () => {
    viewer.camera.rotateRight(Cesium.Math.toRadians(15));
  });

  // ── Tilt ──
  document.getElementById('btn-tilt-up')?.addEventListener('click', () => {
    viewer.camera.lookUp(Cesium.Math.toRadians(10));
  });
  document.getElementById('btn-tilt-down')?.addEventListener('click', () => {
    viewer.camera.lookDown(Cesium.Math.toRadians(10));
  });

  // ── Compass: click to north-up ──
  document.getElementById('btn-north-up')?.addEventListener('click', () => {
    viewer.camera.flyTo({
      destination: viewer.camera.positionWC,
      orientation: {
        heading: 0,
        pitch: viewer.camera.pitch,
        roll: 0,
      },
      duration: 0.5,
    });
  });

  // Update compass needle
  viewer.scene.postRender.addEventListener(() => {
    const needle = document.getElementById('compass-needle');
    if (needle) {
      const deg = Cesium.Math.toDegrees(viewer.camera.heading);
      needle.style.transform = `rotate(${deg}deg)`;
    }
  });
}

function pan(viewer, lonFrac, latFrac) {
  const cart = viewer.camera.positionCartographic;
  const alt = cart.height;
  const spread = alt * 0.00001; // degrees per meter at this altitude
  const lon = Cesium.Math.toDegrees(cart.longitude) + lonFrac * spread * 800;
  const lat = Math.max(-85, Math.min(85, Cesium.Math.toDegrees(cart.latitude) + latFrac * spread * 800));
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(lon, lat, alt),
    orientation: {
      heading: viewer.camera.heading,
      pitch: viewer.camera.pitch,
      roll: 0,
    },
    duration: 0.4,
  });
}

function showSaveLocationPrompt(lon, lat) {
  const el = document.getElementById('save-location-prompt');
  if (!el) return;
  el.style.display = 'flex';
  el.querySelector('#btn-save-location')?.addEventListener('click', () => {
    saveStartLocation({ lon, lat, alt: 80000, heading: 0, pitch: -45 });
    showToast('Start location saved');
    el.style.display = 'none';
  }, { once: true });
  el.querySelector('#btn-skip-location')?.addEventListener('click', () => {
    el.style.display = 'none';
  }, { once: true });
}

function showToast(msg, duration = 2500) {
  let el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el._timer);
  el._timer = setTimeout(() => { el.style.opacity = '0'; }, duration);
}

function saveStartLocation(loc) {
  localStorage.setItem(START_LOCATION_KEY, JSON.stringify(loc));
}

function loadStartLocation() {
  try {
    const s = localStorage.getItem(START_LOCATION_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
