import { loadLandmarks, saveLandmarks, resetLandmarks, DEFAULT_LANDMARKS } from '../landmarks.js';

const KEYS = 'qwertyuiop'.split('');

export class LandmarksEditor {
  constructor(viewer) {
    this.viewer = viewer;
    this.el = document.getElementById('landmarks-modal');
    this._open = false;

    document.getElementById('btn-edit-landmarks')?.addEventListener('click', () => this.toggle());
    document.getElementById('landmarks-close')?.addEventListener('click', () => this.close());
    this.el?.addEventListener('click', e => { if (e.target === this.el) this.close(); });
  }

  toggle() { this._open ? this.close() : this.open(); }

  open() {
    if (!this.el) return;
    this._open = true;
    this.el.style.display = 'flex';
    this._render();
  }

  close() {
    if (!this.el) return;
    this._open = false;
    this.el.style.display = 'none';
  }

  _render() {
    const body = document.getElementById('landmarks-body');
    if (!body) return;
    const landmarks = loadLandmarks();

    body.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <span style="font-size:9px;color:#444;letter-spacing:0.1em">EDIT LANDMARK SHORTCUTS</span>
        <button id="lm-reset-btn" style="font-size:9px;font-family:monospace;padding:2px 8px;
          background:transparent;border:1px solid #333;color:#555;cursor:pointer;border-radius:2px">RESET DEFAULTS</button>
      </div>
      <div id="lm-rows">
        ${landmarks.map((lm, idx) => this._rowHTML(lm, idx)).join('')}
      </div>
      <div style="margin-top:10px;display:flex;gap:6px">
        <button id="lm-add-btn" style="flex:1;font-size:9px;font-family:monospace;padding:4px 8px;
          background:transparent;border:1px solid rgba(0,188,212,0.3);color:#00bcd4;cursor:pointer;border-radius:2px">+ ADD LANDMARK</button>
        <button id="lm-capture-btn" style="flex:1;font-size:9px;font-family:monospace;padding:4px 8px;
          background:transparent;border:1px solid rgba(249,168,37,0.3);color:#f9a825;cursor:pointer;border-radius:2px">⊙ CAPTURE VIEW</button>
      </div>
    `;

    this._bindRows(body, landmarks);
    body.querySelector('#lm-reset-btn').addEventListener('click', () => {
      if (!confirm('Reset all landmarks to defaults?')) return;
      resetLandmarks();
      window.dispatchEvent(new Event('landmarks-updated'));
      this._render();
    });
    body.querySelector('#lm-add-btn').addEventListener('click', () => {
      const lms = loadLandmarks();
      const usedKeys = new Set(lms.map(l => l.key));
      const nextKey = KEYS.find(k => !usedKeys.has(k)) || '';
      lms.push({ key: nextKey, name: 'New Landmark', lon: 134.0, lat: -27.0, alt: 500000 });
      saveLandmarks(lms);
      window.dispatchEvent(new Event('landmarks-updated'));
      this._render();
      // Scroll to bottom
      setTimeout(() => { body.querySelector('#lm-rows').lastElementChild?.scrollIntoView({ behavior: 'smooth' }); }, 50);
    });
    body.querySelector('#lm-capture-btn').addEventListener('click', () => {
      const cam = this.viewer.camera;
      const carto = Cesium.Cartographic.fromCartesian(cam.position);
      const lon = Cesium.Math.toDegrees(carto.longitude).toFixed(5);
      const lat = Cesium.Math.toDegrees(carto.latitude).toFixed(5);
      const alt = Math.round(carto.height);
      const lms = loadLandmarks();
      const usedKeys = new Set(lms.map(l => l.key));
      const nextKey = KEYS.find(k => !usedKeys.has(k)) || '';
      lms.push({ key: nextKey, name: 'Captured View', lon: parseFloat(lon), lat: parseFloat(lat), alt });
      saveLandmarks(lms);
      window.dispatchEvent(new Event('landmarks-updated'));
      this._render();
    });
  }

  _rowHTML(lm, idx) {
    return `
      <div class="lm-row" data-idx="${idx}" style="display:grid;grid-template-columns:28px 1fr 70px 70px 80px 28px;
        gap:4px;align-items:center;padding:3px 0;border-bottom:1px solid rgba(255,255,255,0.04)">
        <select class="lm-key" style="font-size:9px;font-family:monospace;background:#0a0d15;border:1px solid #222;
          color:#f9a825;padding:2px;border-radius:2px;width:100%">
          ${KEYS.map(k => `<option value="${k}" ${k === lm.key ? 'selected' : ''}>${k.toUpperCase()}</option>`).join('')}
        </select>
        <input class="lm-name" value="${lm.name}" style="font-size:9px;font-family:monospace;background:#0a0d15;
          border:1px solid #222;color:#ccc;padding:2px 4px;border-radius:2px;width:100%" />
        <input class="lm-lon" value="${lm.lon}" style="font-size:9px;font-family:monospace;background:#0a0d15;
          border:1px solid #222;color:#888;padding:2px 4px;border-radius:2px;width:100%" placeholder="Lon" />
        <input class="lm-lat" value="${lm.lat}" style="font-size:9px;font-family:monospace;background:#0a0d15;
          border:1px solid #222;color:#888;padding:2px 4px;border-radius:2px;width:100%" placeholder="Lat" />
        <input class="lm-alt" value="${lm.alt}" style="font-size:9px;font-family:monospace;background:#0a0d15;
          border:1px solid #222;color:#888;padding:2px 4px;border-radius:2px;width:100%" placeholder="Alt (m)" />
        <button class="lm-del" style="font-size:11px;background:transparent;border:none;color:#444;cursor:pointer;
          padding:0;line-height:1;transition:color 0.15s" title="Delete">✕</button>
      </div>`;
  }

  _bindRows(body, landmarks) {
    const save = () => {
      const rows = body.querySelectorAll('.lm-row');
      const updated = [];
      rows.forEach(row => {
        const idx = parseInt(row.dataset.idx);
        updated.push({
          key:  row.querySelector('.lm-key').value,
          name: row.querySelector('.lm-name').value.trim() || landmarks[idx]?.name || 'Landmark',
          lon:  parseFloat(row.querySelector('.lm-lon').value) || 0,
          lat:  parseFloat(row.querySelector('.lm-lat').value) || 0,
          alt:  parseInt(row.querySelector('.lm-alt').value)   || 10000,
        });
      });
      saveLandmarks(updated);
      window.dispatchEvent(new Event('landmarks-updated'));
    };

    body.querySelectorAll('.lm-row').forEach(row => {
      row.querySelectorAll('input, select').forEach(el => {
        el.addEventListener('change', save);
        el.addEventListener('blur', save);
      });
      row.querySelector('.lm-del').addEventListener('click', () => {
        const idx = parseInt(row.dataset.idx);
        const lms = loadLandmarks();
        lms.splice(idx, 1);
        saveLandmarks(lms);
        window.dispatchEvent(new Event('landmarks-updated'));
        this._render();
      });
    });
  }
}
