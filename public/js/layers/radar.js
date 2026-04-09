// Weather Radar — RainViewer global radar tiles (includes BOM Australian data)
// API: https://api.rainviewer.com/public/weather-maps.json
// Tiles: https://tilecache.rainviewer.com{path}/512/{z}/{x}/{y}/4/1_1.png

const RAINVIEWER_API  = 'https://api.rainviewer.com/public/weather-maps.json';
const TILE_BASE       = 'https://tilecache.rainviewer.com';
const FRAME_INTERVAL  = 500; // ms per frame during animation
const OPACITY_DEFAULT = 0.7;

// Color scheme: 4 = original NOAA, 2 = universal blue→red, 6 = titan
const COLOR_SCHEME = 4;

export class RadarLayer {
  constructor(viewer) {
    this.viewer   = viewer;
    this.enabled  = false;
    this.count    = 0;

    this._frames    = []; // [{time, path}] sorted oldest→newest
    this._frameIdx  = 0;
    this._layer     = null;
    this._playing   = false;
    this._playTimer = null;
    this._opacity   = OPACITY_DEFAULT;
    this._loaded    = false;
    this._loadError = null;

    this.onDataUpdate = null;
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  async load() {
    try {
      const data = await fetch(RAINVIEWER_API).then(r => r.json());
      // Combine past + nowcast frames, sorted oldest→newest
      this._frames = [
        ...(data.radar?.past     || []),
        ...(data.radar?.nowcast  || []),
      ].sort((a, b) => a.time - b.time);

      this._frameIdx = this._frames.length - 1; // start at latest
      this._loaded   = true;
      this.count     = this._frames.length;

      if (this.enabled && this._frames.length) {
        this._showFrame(this._frameIdx);
      }
      return this.count;
    } catch (e) {
      this._loadError = e.message;
      console.warn('[radar] load error:', e.message);
      return 0;
    }
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    if (enabled) {
      if (this._frames.length) this._showFrame(this._frameIdx);
    } else {
      this._stopPlay();
      this._removeLayer();
    }
  }

  // ── Frame management ────────────────────────────────────────────────────────

  _showFrame(idx) {
    if (!this._frames.length) return;
    idx = Math.max(0, Math.min(idx, this._frames.length - 1));
    this._frameIdx = idx;

    const frame = this._frames[idx];
    this._removeLayer();

    this._layer = this.viewer.imageryLayers.addImageryProvider(
      new Cesium.UrlTemplateImageryProvider({
        url: `${TILE_BASE}${frame.path}/512/{z}/{x}/{y}/${COLOR_SCHEME}/1_1.png`,
        tileWidth:    512,
        tileHeight:   512,
        minimumLevel: 0,
        maximumLevel: 12,
        credit:       new Cesium.Credit('RainViewer / BOM', false),
      })
    );
    this._layer.alpha = this._opacity;
    this.onDataUpdate?.();
  }

  _removeLayer() {
    if (this._layer) {
      this.viewer.imageryLayers.remove(this._layer, true);
      this._layer = null;
    }
  }

  // ── Playback ────────────────────────────────────────────────────────────────

  _startPlay() {
    this._playing = true;
    this._playTimer = setInterval(() => {
      const next = (this._frameIdx + 1) % this._frames.length;
      this._showFrame(next);
    }, FRAME_INTERVAL);
    this.onDataUpdate?.();
  }

  _stopPlay() {
    this._playing = false;
    clearInterval(this._playTimer);
    this._playTimer = null;
  }

  // ── List panel ──────────────────────────────────────────────────────────────

  getListHTML() {
    if (!this._loaded) {
      if (this._loadError) {
        return `<div style="padding:14px"><p style="color:#f44;font-size:11px">${this._loadError}</p></div>`;
      }
      return '<p class="panel-empty">Loading radar…</p>';
    }

    if (!this._frames.length) {
      return '<p class="panel-empty">No radar frames available.</p>';
    }

    const frame   = this._frames[this._frameIdx] || {};
    const isNowcast = frame.time > (this._frames.find(f => !f.nowcast)?.time || Infinity);
    const timeStr = frame.time
      ? new Date(frame.time * 1000).toLocaleString('en-AU', {
          timeZone: 'Australia/Hobart',
          day: '2-digit', month: 'short',
          hour: '2-digit', minute: '2-digit', hour12: false,
        })
      : '—';

    // Split frames into past vs nowcast
    const past     = this._frames.filter(f => !f.nowcast);
    const nowcast  = this._frames.filter(f => f.nowcast);

    return `
      <div style="padding:10px 12px">
        <div style="font-size:10px;color:#555;margin-bottom:10px;letter-spacing:0.12em">
          WEATHER RADAR · RainViewer / BOM
        </div>

        <!-- Current frame -->
        <div style="background:rgba(255,255,255,0.04);border-radius:3px;padding:8px 10px;margin-bottom:10px">
          <div style="font-size:9px;color:#444;letter-spacing:0.1em;margin-bottom:2px">
            ${isNowcast ? 'FORECAST (NOWCAST)' : 'OBSERVED'} · AEST
          </div>
          <div style="font-size:13px;color:${isNowcast ? '#81c784' : '#4fc3f7'}">${timeStr}</div>
          <div style="font-size:9px;color:#444;margin-top:2px">
            Frame ${this._frameIdx + 1} of ${this._frames.length}
            ${past.length ? ` · ${past.length} observed` : ''}
            ${nowcast.length ? ` · ${nowcast.length} forecast` : ''}
          </div>
        </div>

        <!-- Playback controls -->
        <div style="display:flex;gap:6px;margin-bottom:10px">
          <button data-action="radar-prev"
            style="flex:1;padding:7px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                   color:#ccc;font-family:monospace;font-size:14px;border-radius:3px;cursor:pointer">‹</button>
          <button data-action="radar-play"
            style="flex:2;padding:7px;background:${this._playing ? 'rgba(79,195,247,0.15)' : 'rgba(255,255,255,0.06)'};
                   border:1px solid ${this._playing ? 'rgba(79,195,247,0.5)' : 'rgba(255,255,255,0.1)'};
                   color:${this._playing ? '#4fc3f7' : '#ccc'};font-family:monospace;font-size:11px;
                   letter-spacing:0.08em;border-radius:3px;cursor:pointer">
            ${this._playing ? '◼ STOP' : '▶ LOOP'}
          </button>
          <button data-action="radar-next"
            style="flex:1;padding:7px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                   color:#ccc;font-family:monospace;font-size:14px;border-radius:3px;cursor:pointer">›</button>
          <button data-action="radar-latest"
            style="flex:2;padding:7px;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
                   color:#888;font-family:monospace;font-size:10px;letter-spacing:0.06em;
                   border-radius:3px;cursor:pointer">REFRESH</button>
        </div>

        <!-- Opacity -->
        <div style="margin-bottom:12px">
          <div style="font-size:9px;color:#444;letter-spacing:0.1em;margin-bottom:5px"
               id="radar-opacity-label">OPACITY · ${Math.round(this._opacity * 100)}%</div>
          <input type="range" data-action="radar-opacity" min="0" max="100"
            value="${Math.round(this._opacity * 100)}"
            style="width:100%;accent-color:#4fc3f7">
        </div>

        <!-- Intensity legend -->
        <div style="font-size:9px;color:#444;margin-bottom:5px;letter-spacing:0.1em">RAIN INTENSITY</div>
        <div style="display:flex;height:8px;border-radius:2px;overflow:hidden;margin-bottom:4px">
          ${['#b3d1ff','#6db6ff','#00a0ff','#00cc00','#ffff00','#ff8800','#ff4400','#cc0000','#aa00ff']
            .map(c => `<div style="flex:1;background:${c}"></div>`).join('')}
        </div>
        <div style="display:flex;justify-content:space-between;font-size:8px;color:#444">
          <span>Light</span><span>Moderate</span><span>Heavy</span><span>Extreme</span>
        </div>
      </div>`;
  }

  bindListClicks(container) {
    container.querySelector('[data-action="radar-play"]')?.addEventListener('click', () => {
      this._playing ? this._stopPlay() : this._startPlay();
      this.onDataUpdate?.();
    });
    container.querySelector('[data-action="radar-prev"]')?.addEventListener('click', () => {
      this._stopPlay();
      this._showFrame(this._frameIdx - 1);
    });
    container.querySelector('[data-action="radar-next"]')?.addEventListener('click', () => {
      this._stopPlay();
      this._showFrame(this._frameIdx + 1);
    });
    container.querySelector('[data-action="radar-latest"]')?.addEventListener('click', async () => {
      this._stopPlay();
      await this.load();
      this.onDataUpdate?.();
    });
    container.querySelector('[data-action="radar-opacity"]')?.addEventListener('input', e => {
      this._opacity = parseInt(e.target.value) / 100;
      if (this._layer) this._layer.alpha = this._opacity;
      const lbl = container.querySelector('#radar-opacity-label');
      if (lbl) lbl.textContent = `OPACITY · ${Math.round(this._opacity * 100)}%`;
    });
  }

  destroy() {
    this._stopPlay();
    this._removeLayer();
  }
}
