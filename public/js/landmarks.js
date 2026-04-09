// Australian landmark presets — keyboard shortcuts
const DEFAULT_LANDMARKS = [
  { key: 'q', name: 'All Australia',        lon: 134.0,  lat: -27.0,  alt: 4500000 },
  { key: 'w', name: 'Sydney Harbour',        lon: 151.21, lat: -33.85, alt: 15000   },
  { key: 'e', name: 'Melbourne Port',        lon: 144.93, lat: -37.83, alt: 12000   },
  { key: 'r', name: 'Darwin Port',           lon: 130.84, lat: -12.46, alt: 10000   },
  { key: 't', name: 'Torres Strait',         lon: 142.2,  lat: -10.6,  alt: 120000  },
  { key: 'y', name: 'Bass Strait',           lon: 146.0,  lat: -40.5,  alt: 250000  },
  { key: 'u', name: 'Newcastle Coal Port',   lon: 151.78, lat: -32.92, alt: 8000    },
  { key: 'i', name: 'Pine Gap',              lon: 133.74, lat: -23.8,  alt: 6000    },
  { key: 'o', name: 'RAAF Tindal',           lon: 132.37, lat: -14.52, alt: 8000    },
  { key: 'p', name: 'Strait of Malacca',     lon: 103.8,  lat: 2.5,    alt: 300000  },
];

const LS_KEY = 'strayanow_landmarks';

export function loadLandmarks() {
  try {
    const saved = localStorage.getItem(LS_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return DEFAULT_LANDMARKS.map(l => ({ ...l }));
}

export function saveLandmarks(list) {
  localStorage.setItem(LS_KEY, JSON.stringify(list));
}

export function resetLandmarks() {
  localStorage.removeItem(LS_KEY);
  return DEFAULT_LANDMARKS.map(l => ({ ...l }));
}

// Exported so editor can read defaults
export { DEFAULT_LANDMARKS };

export function initLandmarks(viewer) {
  const infoEl = document.getElementById('landmark-name');
  let landmarks = loadLandmarks();

  function flyTo(landmark) {
    const center = Cesium.Cartesian3.fromDegrees(landmark.lon, landmark.lat, 0);
    viewer.camera.flyToBoundingSphere(
      new Cesium.BoundingSphere(center, 1),
      { offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-90), landmark.alt), duration: 2.0 }
    );
    if (infoEl) {
      infoEl.textContent = landmark.name;
      infoEl.style.opacity = '1';
      setTimeout(() => { infoEl.style.opacity = '0'; }, 2500);
    }
  }

  function rebuildKeyMap() {
    landmarks = loadLandmarks();
    renderLandmarkList();
    return landmarks.reduce((m, lm) => { m[lm.key] = lm; return m; }, {});
  }

  let keyMap = rebuildKeyMap();

  function renderLandmarkList() {
    const listEl = document.getElementById('landmark-list');
    if (!listEl) return;
    listEl.innerHTML = landmarks.map(lm =>
      `<button class="landmark-btn" data-key="${lm.key}">[${lm.key.toUpperCase()}] ${lm.name}</button>`
    ).join('');
    listEl.querySelectorAll('.landmark-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const lm = keyMap[btn.dataset.key];
        if (lm) flyTo(lm);
      });
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    const lm = keyMap[e.key.toLowerCase()];
    if (lm) { e.preventDefault(); flyTo(lm); }
  });

  // Listen for landmark updates from the editor
  window.addEventListener('landmarks-updated', () => {
    keyMap = rebuildKeyMap();
  });

  return { flyTo, rebuildKeyMap };
}
