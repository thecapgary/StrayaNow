export class EntityDetail {
  constructor(viewer) {
    this.viewer = viewer;
    this.el = document.getElementById('entity-detail');
    this.tracking = null;
    this._setupClick();
  }

  _setupClick() {
    const handler = new Cesium.ScreenSpaceEventHandler(this.viewer.scene.canvas);
    handler.setInputAction(click => {
      const picked = this.viewer.scene.pick(click.position, 10, 10);
      if (!picked) {
        this.hide(); this.stopTracking(); this.onDeselect?.(); return;
      }
      // Entity or pseudo-entity click (ships, flights, seismic, infra, satellites…)
      if (picked.id?._data) {
        this.onDeselect?.();
        const data = picked.id._data;
        this.show(data);
        this.onShow?.(data);
        // Only track real Cesium entities (primitives with {_data} can't be tracked)
        if (picked.id instanceof Cesium.Entity) this.track(picked.id);
        return;
      }

      this.hide(); this.stopTracking(); this.onDeselect?.();
    }, Cesium.ScreenSpaceEventType.LEFT_CLICK);
  }

  show(data) {
    if (!this.el) return;
    const rows = this._formatData(data);
    this.el.innerHTML = `
      <div class="detail-header">
        <span class="detail-type">${(data.type || 'ENTITY').toUpperCase()}</span>
        <button class="detail-close" id="detail-close">✕</button>
      </div>
      <div class="detail-name">${this._primaryName(data)}</div>
      <div class="detail-rows">${rows}</div>
      <button class="detail-track-btn" id="track-btn">TRACK</button>
    `;
    this.el.style.display = 'block';
    document.getElementById('detail-close')?.addEventListener('click', () => {
      this.hide(); this.stopTracking();
    });
    document.getElementById('track-btn')?.addEventListener('click', () => {
      const btn = document.getElementById('track-btn');
      if (this.tracking) {
        this.stopTracking();
        btn.textContent = 'TRACK';
      } else if (this._trackedEntity) {
        this.track(this._trackedEntity);
        btn.textContent = 'UNTRACK';
      }
    });
  }

  hide() {
    if (this.el) this.el.style.display = 'none';
  }

  track(entity) {
    this._trackedEntity = entity;
    this.viewer.trackedEntity = entity;
    this.tracking = entity;
  }

  stopTracking() {
    this.viewer.trackedEntity = undefined;
    this.tracking = null;
  }

  _primaryName(data) {
    return data.callsign?.trim() || data.name || data.place || data.icao24 || data.mmsi || '—';
  }

  _formatData(data) {
    const fields = {
      flight: [
        ['Callsign', data.callsign?.trim()],
        ['ICAO24', data.icao24],
        ['Altitude', data.baro_altitude ? `${(data.baro_altitude * 3.28084).toFixed(0)} ft` : '—'],
        ['Speed', data.velocity ? `${(data.velocity * 1.94384).toFixed(0)} kts` : '—'],
        ['Track', data.true_track ? `${data.true_track.toFixed(0)}°` : '—'],
        ['V/S', data.vertical_rate ? `${(data.vertical_rate * 196.85).toFixed(0)} fpm` : '—'],
        ['Country', data.origin_country],
        ['Squawk', data.squawk],
      ],
      ship: [
        ['MMSI', data.mmsi],
        ['IMO', data.imo],
        ['Flag', data.flag],
        ['Speed', data.sog ? `${data.sog.toFixed(1)} kts` : '—'],
        ['Course', data.cog ? `${data.cog.toFixed(0)}°` : '—'],
        ['Type', data.type],
        ['Status', data.status],
      ],
      satellite: [
        ['Name',      data.name],
        ['Altitude',  data.altitude],
        ['Latitude',  data.latitude],
        ['Longitude', data.longitude],
      ],
      earthquake: [
        ['Magnitude', data.magnitude ? `M${data.magnitude.toFixed(1)}` : '—'],
        ['Location', data.place],
        ['Depth', data.depth],
        ['Time', data.time ? new Date(data.time).toLocaleString('en-AU') : '—'],
      ],
    };

    const rows = fields[data.type] || Object.entries(data).filter(([k]) => k !== 'type');
    return rows.filter(([, v]) => v != null && v !== '').map(([k, v]) =>
      `<div class="detail-row"><span class="detail-key">${k}</span><span class="detail-val">${v}</span></div>`
    ).join('');
  }
}
