// Generic right-side data panel with tab bar — one tab per registered layer
export class DataPanel {
  constructor() {
    this.el     = document.getElementById('right-panel');
    this.tabsEl = document.getElementById('right-panel-tabs');
    this.listEl = document.getElementById('data-list');
    this.focused = null;
    this.layers  = {};
    this._order  = [];
    this._searchTerm = '';
    this._injectSearch();
  }

  register(id, label, color, layer) {
    const SHORT = {
      flights:    'FLT',
      ships:      'AIS',
      sats:       'SAT',
      seismic:    'SIS',
      traffic:    'TRF',
      infra:      'INF',
      listmaps:   'TAS',
      traceroute: 'NET',
      weather:    'WX',
      tides:      'TDS',
      tasroads:   'DOT',
      railways:   'RLW',
      here:       'INC',
      gps:        'GPS',
      radar:      'RDR',
    };
    this.layers[id] = { label, shortLabel: SHORT[id] || label.slice(0, 4).toUpperCase(), color, layer };
    this._order.push(id);
    this._renderTabs();
  }

  _renderTabs() {
    if (!this.tabsEl) return;
    this.tabsEl.innerHTML = this._order.map(id => {
      const { shortLabel, color, label } = this.layers[id];
      const active = this.focused === id;
      return `<button class="tab-btn${active ? ' tab-active' : ''}" data-tab="${id}" title="${label}"
        style="${active ? `color:${color};border-bottom:2px solid ${color}` : ''}"
        >${shortLabel}</button>`;
    }).join('');

    this.tabsEl.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.focus(btn.dataset.tab);
        this.onTabClick?.(btn.dataset.tab);
      });
    });
  }

  // ── Search bar ────────────────────────────────────────────────────────────

  _injectSearch() {
    if (!this.tabsEl || !this.listEl) return;

    const wrap = document.createElement('div');
    wrap.id = 'data-search-wrap';
    wrap.style.cssText = [
      'padding:5px 8px',
      'border-bottom:1px solid rgba(255,255,255,0.06)',
      'position:relative',
    ].join(';');
    wrap.innerHTML = `
      <input id="data-search-input" type="text"
        placeholder="Search…"
        spellcheck="false" autocomplete="off"
        style="width:100%;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.1);
               border-radius:3px;padding:4px 26px 4px 8px;color:#ccc;font:11px monospace;
               outline:none;box-sizing:border-box;transition:border-color 0.15s">
      <span id="data-search-clear"
        style="position:absolute;right:14px;top:50%;transform:translateY(-50%);
               color:#555;cursor:pointer;font-size:13px;line-height:1;display:none"
        title="Clear search">✕</span>
    `;

    // Insert between tabs and list
    this.tabsEl.parentNode.insertBefore(wrap, this.listEl);

    this._searchEl = wrap.querySelector('#data-search-input');
    this._clearEl  = wrap.querySelector('#data-search-clear');

    this._searchEl.addEventListener('input', () => {
      this._searchTerm = this._searchEl.value.toLowerCase().trim();
      this._clearEl.style.display = this._searchTerm ? 'block' : 'none';
      this._applyFilter();
    });

    this._searchEl.addEventListener('focus', () => {
      this._searchEl.style.borderColor = 'rgba(255,255,255,0.25)';
    });
    this._searchEl.addEventListener('blur', () => {
      this._searchEl.style.borderColor = 'rgba(255,255,255,0.1)';
    });
    this._searchEl.addEventListener('keydown', e => {
      if (e.key === 'Escape') this._clearSearch();
    });

    this._clearEl.addEventListener('click', () => this._clearSearch());
  }

  _clearSearch() {
    this._searchTerm = '';
    if (this._searchEl) this._searchEl.value = '';
    if (this._clearEl) this._clearEl.style.display = 'none';
    this._applyFilter();
  }

  _applyFilter() {
    if (!this.listEl) return;
    const q = this._searchTerm;
    const cards = this.listEl.querySelectorAll('.list-card');

    let matched = 0;
    cards.forEach(card => {
      const text = card.textContent.toLowerCase();
      const hit  = !q || text.includes(q);
      card.style.display = hit ? '' : 'none';
      if (hit) matched++;
    });

    // Show a "no results" note if nothing matched and we have a query
    let noResultEl = this.listEl.querySelector('#search-no-result');
    if (q && matched === 0 && cards.length > 0) {
      if (!noResultEl) {
        noResultEl = document.createElement('p');
        noResultEl.id = 'search-no-result';
        noResultEl.className = 'panel-empty';
        noResultEl.style.padding = '10px 12px';
        this.listEl.appendChild(noResultEl);
      }
      noResultEl.textContent = `No results for "${this._searchEl.value}"`;
      noResultEl.style.display = '';
    } else if (noResultEl) {
      noResultEl.style.display = 'none';
    }
  }

  // ── Core panel ────────────────────────────────────────────────────────────

  focus(id) {
    this.focused = id;
    this._clearSearch(); // reset search on tab change
    // Update placeholder to match the tab context
    if (this._searchEl) {
      const HINTS = {
        flights: 'Search callsign or country…',
        ships:   'Search vessel name or MMSI…',
        sats:    'Search satellite name…',
        infra:   'Search port or base…',
        seismic: 'Search location…',
      };
      this._searchEl.placeholder = HINTS[id] || 'Search…';
    }
    this._renderTabs();
    this.refresh();
    this.show();
  }

  refresh() {
    if (!this.focused || !this.listEl) return;
    const entry = this.layers[this.focused];
    if (!entry?.layer?.getListHTML) {
      this.listEl.innerHTML = '<p class="panel-empty">No data available.</p>';
      return;
    }
    this.listEl.innerHTML = entry.layer.getListHTML();
    entry.layer.bindListClicks?.(this.listEl);
    this._applyFilter(); // re-apply any active search after content refresh
  }

  show() { if (this.el) this.el.style.display = 'flex'; }
  hide() { if (this.el) this.el.style.display = 'none'; }

  setVisible(id, visible) {
    if (this.focused === id) visible ? this.show() : this.hide();
  }
}
