// Settings panel — API credentials manager with live connection verification
export class SettingsPanel {
  constructor() {
    this.el      = document.getElementById('settings-modal');
    this.listEl  = document.getElementById('settings-list');
    this._open   = false;
    this._settings = [];

    document.getElementById('btn-settings')?.addEventListener('click', () => this.toggle());
    document.getElementById('settings-close')?.addEventListener('click', () => this.close());
    this.el?.addEventListener('click', e => { if (e.target === this.el) this.close(); });
  }

  async toggle() { this._open ? this.close() : await this.open(); }

  async open() {
    if (!this.el) return;
    this._open = true;
    this.el.style.display = 'flex';
    await this._load();
  }

  close() {
    if (!this.el) return;
    this._open = false;
    this.el.style.display = 'none';
  }

  async _load() {
    if (!this.listEl) return;
    this.listEl.innerHTML = '<p style="color:#555;font-size:11px;padding:8px">Loading…</p>';
    try {
      this._settings = await fetch('/api/settings').then(r => r.json());
      this._render();
      // Auto-verify all set keys in parallel (non-blocking)
      this._autoVerifyAll();
    } catch {
      this.listEl.innerHTML = '<p style="color:#f44;font-size:11px;padding:8px">Failed to load settings.</p>';
    }
  }

  _render() {
    if (!this.listEl) return;

    const groups = {};
    for (const s of this._settings) {
      if (!groups[s.layer]) groups[s.layer] = [];
      groups[s.layer].push(s);
    }

    this.listEl.innerHTML = Object.entries(groups).map(([groupName, items]) => `
      <div class="settings-group">
        <div class="settings-group-title">${groupName}</div>
        ${items.map(s => this._rowHTML(s)).join('')}
      </div>
    `).join('');

    this.listEl.querySelectorAll('.settings-save-btn').forEach(btn => {
      btn.addEventListener('click', () => this._save(btn.dataset.key, btn.dataset.id));
    });
    this.listEl.querySelectorAll('.settings-ping-btn').forEach(btn => {
      btn.addEventListener('click', () => this._verify(btn.dataset.id));
    });
    this.listEl.querySelectorAll('.settings-input').forEach(input => {
      input.addEventListener('keydown', e => {
        if (e.key === 'Enter') this.listEl.querySelector(`.settings-save-btn[data-key="${input.dataset.key}"]`)?.click();
      });
    });
  }

  _rowHTML(s) {
    // Determine which id drives this row's verification (passwords defer to username)
    const verifyId = s.validatesWith || (s.validates ? s.id : null);

    // Initial dot state: unset → gray, set → amber (unverified until ping runs)
    const dotColor  = s.set ? '#ff9800' : '#444';
    const dotTitle  = s.set ? 'Set — click PING to verify' : 'Not set';
    const statusTxt = s.set ? 'SET' : 'NOT SET';

    return `
      <div class="settings-row" id="srow-${s.id}">
        <div class="settings-row-header">
          <span class="settings-label">${s.label}</span>
          <span class="settings-conn" id="sconn-${s.id}">
            <span class="sdot" id="sdot-${s.id}"
              style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${dotColor};margin-right:4px;vertical-align:middle"
              title="${dotTitle}"></span>
            <span id="sstatus-${s.id}" style="font-size:9px;color:#555;vertical-align:middle">${statusTxt}</span>
          </span>
        </div>
        <div class="settings-hint">${s.hint}</div>
        <div class="settings-input-row">
          <input class="settings-input" type="${s.secret ? 'password' : 'text'}"
            placeholder="${s.masked ? '(' + s.masked + ')' : 'Enter value…'}"
            data-key="${s.key}"
            autocomplete="${s.secret ? 'new-password' : 'off'}"
            spellcheck="false" />
          <button class="settings-save-btn" data-key="${s.key}" data-id="${s.id}">SAVE</button>
          ${verifyId ? `<button class="settings-ping-btn" data-id="${verifyId}" title="Test live connection" style="margin-left:4px">PING</button>` : ''}
        </div>
      </div>
    `;
  }

  // Update the dot + status text for a given settings id
  _setDot(id, status, message) {
    const dot    = document.getElementById(`sdot-${id}`);
    const text   = document.getElementById(`sstatus-${id}`);
    if (!dot || !text) return;

    const STATES = {
      unset:      { color: '#444',    label: 'NOT SET'    },
      unverified: { color: '#ff9800', label: 'UNVERIFIED' },
      ok:         { color: '#4caf50', label: 'CONNECTED'  },
      invalid:    { color: '#f44336', label: 'REJECTED'   },
      error:      { color: '#f44336', label: 'ERROR'      },
      checking:   { color: '#ff9800', label: 'CHECKING…'  },
    };
    const state = STATES[status] || STATES.unverified;
    dot.style.background   = state.color;
    dot.title              = message || state.label;
    text.textContent       = state.label;
    text.style.color       = state.color === '#444' ? '#555' : state.color;

    // Also update password-row dot if this is a username (e.g. opensky_user → opensky_pass)
    const paired = this._settings.find(s => s.validatesWith === id);
    if (paired) {
      const pd = document.getElementById(`sdot-${paired.id}`);
      const pt = document.getElementById(`sstatus-${paired.id}`);
      if (pd) { pd.style.background = state.color; pd.title = dot.title; }
      if (pt) { pt.textContent = state.label; pt.style.color = text.style.color; }
    }
  }

  async _verify(id) {
    const pingBtn = this.listEl?.querySelector(`.settings-ping-btn[data-id="${id}"]`);
    if (pingBtn) { pingBtn.textContent = '…'; pingBtn.disabled = true; }
    this._setDot(id, 'checking');

    try {
      const result = await fetch(`/api/settings/validate?id=${id}`).then(r => r.json());
      this._setDot(id, result.status, result.message);
    } catch (e) {
      this._setDot(id, 'error', e.message);
    } finally {
      if (pingBtn) { pingBtn.textContent = 'PING'; pingBtn.disabled = false; }
    }
  }

  _autoVerifyAll() {
    // Verify all services that have a validator and are currently set
    const toVerify = this._settings.filter(s => s.validates && s.set);
    for (const s of toVerify) {
      // Small staggered delay so they don't all hammer at once
      setTimeout(() => this._verify(s.id), 200 * toVerify.indexOf(s));
    }
  }

  async _save(key, id) {
    const input = this.listEl.querySelector(`.settings-input[data-key="${key}"]`);
    const btn   = this.listEl.querySelector(`.settings-save-btn[data-key="${key}"]`);
    if (!input) return;

    const value = input.value.trim();
    btn.textContent = '…';
    btn.disabled = true;

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value }),
      }).then(r => r.json());

      input.value = '';
      input.placeholder = value ? '(' + ('*'.repeat(Math.min(value.length - 4, 12)) + value.slice(-4)) + ')' : 'Enter value…';
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = 'SAVE'; btn.disabled = false; }, 1500);

      // Dot goes amber (saved but unverified), then auto-ping if this id has a validator
      const setting = this._settings.find(s => s.key === key);
      const verifyId = setting?.validatesWith || (setting?.validates ? setting?.id : null);
      if (res.set && verifyId) {
        this._setDot(verifyId, 'unverified', 'Saved — verifying…');
        setTimeout(() => this._verify(verifyId), 800);
      } else if (!res.set) {
        this._setDot(id, 'unset');
      }
    } catch {
      btn.textContent = 'ERR';
      setTimeout(() => { btn.textContent = 'SAVE'; btn.disabled = false; }, 1500);
    }
  }
}
