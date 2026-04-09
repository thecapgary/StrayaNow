export class LayerPanel {
  constructor(layers, { onFocus, onToggle } = {}) {
    this.layers = layers; // { id, label, layer, color }[]
    this.el = document.getElementById('layer-panel');
    this.onFocus = onFocus;   // (id) => void
    this.onToggle = onToggle; // (id, enabled) => void
    this._render();
  }

  _render() {
    if (!this.el) return;
    this.el.innerHTML = this.layers.map(({ id, label, color, defaultEnabled = true }) => `
      <div class="layer-row" data-id="${id}" title="Click to view data">
        <div class="layer-dot" id="dot-${id}" style="background:${color};opacity:${defaultEnabled ? 1 : 0.3}"></div>
        <label class="layer-label">
          <input type="checkbox" class="layer-toggle" data-id="${id}" ${defaultEnabled ? 'checked' : ''} />
          ${label}
        </label>
        <span class="layer-count" id="count-${id}">—</span>
      </div>
    `).join('');

    this.el.querySelectorAll('.layer-toggle').forEach(cb => {
      cb.addEventListener('change', e => {
        const id = e.target.dataset.id;
        const entry = this.layers.find(l => l.id === id);
        if (entry?.layer?.setEnabled) entry.layer.setEnabled(e.target.checked);
        document.getElementById(`dot-${id}`).style.opacity = e.target.checked ? '1' : '0.3';
        this.onToggle?.(id, e.target.checked);
      });
    });

    // Click on the row text (not the checkbox) to focus data panel
    this.el.querySelectorAll('.layer-row').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.type === 'checkbox') return; // ignore checkbox clicks
        this.onFocus?.(row.dataset.id);
        this.el.querySelectorAll('.layer-row').forEach(r => r.classList.remove('layer-row-active'));
        row.classList.add('layer-row-active');
      });
    });
  }

  // Programmatically enable a layer (checks the checkbox, fires change event)
  enable(id) {
    const cb = this.el?.querySelector(`.layer-toggle[data-id="${id}"]`);
    if (cb && !cb.checked) {
      cb.checked = true;
      cb.dispatchEvent(new Event('change'));
    }
  }

  setCount(id, count) {
    const el = document.getElementById(`count-${id}`);
    if (el) el.textContent = count > 0 ? count : '—';
  }

  setStatus(id, status) {
    // status: 'live' | 'stale' | 'error' | 'loading'
    const dot = document.getElementById(`dot-${id}`);
    if (!dot) return;
    const entry = this.layers.find(l => l.id === id);
    const baseColor = entry?.color || '#fff';
    const states = {
      live:    { color: baseColor, animation: 'pulse 2s infinite' },
      stale:   { color: '#888',    animation: 'none' },
      error:   { color: '#f44',    animation: 'none' },
      loading: { color: '#ffeb3b', animation: 'pulse 0.5s infinite' },
    };
    const s = states[status] || states.stale;
    dot.style.background = s.color;
    dot.style.animation = s.animation;
  }
}
