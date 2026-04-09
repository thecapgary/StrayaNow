import { createNVGStage } from '../shaders/nvg.js';
import { createFLIRStage } from '../shaders/flir.js';
import { createCRTStage } from '../shaders/crt.js';

const MODES = ['normal', 'nvg', 'flir', 'crt'];
const MODE_LABELS = { normal: 'NORMAL', nvg: 'NVG', flir: 'FLIR', crt: 'CRT' };
const MODE_COLORS = { normal: '#f9a825', nvg: '#00e676', flir: '#ff5722', crt: '#00e5ff' };

export class ModeSwitcher {
  constructor(viewer) {
    this.viewer = viewer;
    this.current = 'normal';
    this.stages = {};
    this._init();
  }

  _init() {
    // Create all stages once, keep disabled
    this.stages.nvg  = this.viewer.scene.postProcessStages.add(createNVGStage());
    this.stages.flir = this.viewer.scene.postProcessStages.add(createFLIRStage());
    this.stages.crt  = this.viewer.scene.postProcessStages.add(createCRTStage());
    for (const s of Object.values(this.stages)) s.enabled = false;

    // Keyboard 1/2/3/4
    document.addEventListener('keydown', e => {
      if (e.target.tagName === 'INPUT') return;
      const modeIndex = parseInt(e.key) - 1;
      if (modeIndex >= 0 && modeIndex < MODES.length) this.setMode(MODES[modeIndex]);
    });

    // Button clicks
    document.querySelectorAll('[data-mode]').forEach(btn => {
      btn.addEventListener('click', () => this.setMode(btn.dataset.mode));
    });
  }

  setMode(mode) {
    if (!MODES.includes(mode)) return;
    this.current = mode;

    // Toggle stages
    for (const [name, stage] of Object.entries(this.stages)) {
      stage.enabled = (name === mode);
    }

    // Update UI
    document.querySelectorAll('[data-mode]').forEach(btn => {
      const active = btn.dataset.mode === mode;
      btn.style.background = active ? MODE_COLORS[mode] : 'transparent';
      btn.style.color = active ? '#000' : '#aaa';
    });

    const indicator = document.getElementById('mode-indicator');
    if (indicator) {
      indicator.textContent = MODE_LABELS[mode];
      indicator.style.color = MODE_COLORS[mode];
    }
  }
}
