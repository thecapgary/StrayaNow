const LAYER_STYLES = {
  aus_ports: {
    color: '#00bcd4',
    icon: '⚓',
    size: 16,
  },
  raaf_bases: {
    color: '#ff4444',
    icon: '✈',
    size: 18,
  },
  lng_terminals: {
    color: '#ff9800',
    icon: '🔥',
    size: 14,
  },
};

export class InfrastructureLayer {
  constructor(viewer, onSelect) {
    this.viewer = viewer;
    this.onSelect = onSelect;
    this.entities = {};
    this.enabled = true;
    this.count = 0;
  }

  async load(layers = ['aus_ports', 'raaf_bases', 'lng_terminals']) {
    this._clear();
    let total = 0;

    for (const layerName of layers) {
      try {
        const data = await fetch(`/api/infrastructure/${layerName}`).then(r => r.json());
        const style = LAYER_STYLES[layerName] || { color: '#fff', size: 14 };

        for (const feature of data.features || []) {
          const [lon, lat] = feature.geometry.coordinates;
          const props = feature.properties;

          const entity = this.viewer.entities.add({
            position: Cesium.Cartesian3.fromDegrees(lon, lat, 0),
            billboard: {
              image: this._buildIcon(style),
              width: style.size * 2,
              height: style.size * 2,
              verticalOrigin: Cesium.VerticalOrigin.BOTTOM,
              disableDepthTestDistance: 5e5,
              scaleByDistance: new Cesium.NearFarScalar(1e4, 1.5, 3e6, 0.4),
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            label: {
              text: props.name,
              font: '10px monospace',
              fillColor: Cesium.Color.fromCssColorString(style.color),
              outlineColor: Cesium.Color.BLACK,
              outlineWidth: 2,
              style: Cesium.LabelStyle.FILL_AND_OUTLINE,
              pixelOffset: new Cesium.Cartesian2(0, -style.size * 2 - 4),
              distanceDisplayCondition: new Cesium.DistanceDisplayCondition(0, 800000),
              disableDepthTestDistance: 5e5,
              heightReference: Cesium.HeightReference.CLAMP_TO_GROUND,
            },
            show: this.enabled,
            _data: { type: layerName, ...props },
          });

          if (!this.entities[layerName]) this.entities[layerName] = [];
          this.entities[layerName].push(entity);
          total++;
        }
      } catch (e) {
        console.warn(`Failed to load ${layerName}:`, e.message);
      }
    }

    this.count = total;
    return total;
  }

  _buildIcon(style) {
    const canvas = document.createElement('canvas');
    const s = style.size * 2;
    canvas.width = s; canvas.height = s;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = style.color;
    ctx.beginPath();
    ctx.arc(s/2, s/2, s/2 - 2, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    return canvas.toDataURL();
  }

  getListHTML() {
    const all = Object.entries(this.entities).flatMap(([layer, ents]) =>
      ents.map(e => ({ layer, data: e._data, pos: e.position?.getValue(Cesium.JulianDate.now()) }))
    ).filter(item => item.data);
    if (all.length === 0) return '<p class="panel-empty">No infrastructure loaded</p>';
    const typeColors = { aus_ports: '#00bcd4', raaf_bases: '#ff4444', lng_terminals: '#ff9800' };
    return all.map(({ layer, data }) => {
      const color = typeColors[layer] || '#aaa';
      return `<div class="list-card" data-action="flyto" data-name="${data.name}" data-layer="${layer}">
        <div class="list-card-title" style="color:${color}">${data.name}</div>
        <div class="list-card-detail"><span>${data.note || data.operator || data.type || ''}</span></div>
        ${data.capacity_mtpa ? `<div class="list-card-detail">Capacity <span>${data.capacity_mtpa} Mtpa</span></div>` : ''}
      </div>`;
    }).join('');
  }

  bindListClicks(container) {
    container.querySelectorAll('[data-action="flyto"]').forEach(card => {
      card.addEventListener('click', () => {
        const name = card.dataset.name;
        const layer = card.dataset.layer;
        const ents = this.entities[layer] || [];
        const entity = ents.find(e => e._data?.name === name);
        if (!entity) return;
        const pos = entity.position?.getValue(Cesium.JulianDate.now());
        if (!pos) return;
        const cart = Cesium.Cartographic.fromCartesian(pos);
        this.viewer.camera.flyTo({
          destination: Cesium.Cartesian3.fromRadians(cart.longitude, cart.latitude, 15000),
          orientation: { heading: 0, pitch: Cesium.Math.toRadians(-90), roll: 0 },
          duration: 1.5,
        });
        this.viewer.selectedEntity = entity;
      });
    });
  }

  setEnabled(enabled) {
    this.enabled = enabled;
    for (const group of Object.values(this.entities)) {
      for (const e of group) e.show = enabled;
    }
  }

  _clear() {
    for (const group of Object.values(this.entities)) {
      for (const e of group) this.viewer.entities.remove(e);
    }
    this.entities = {};
  }

  destroy() { this._clear(); }
}
