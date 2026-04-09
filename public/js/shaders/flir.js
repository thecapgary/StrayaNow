export function createFLIRStage() {
  return new Cesium.PostProcessStage({
    name: 'strayanow_flir',
    fragmentShader: `
      uniform sampler2D colorTexture;
      in vec2 v_textureCoordinates;

      vec3 thermalColor(float t) {
        t = clamp(t, 0.0, 1.0);
        if (t < 0.25) return mix(vec3(0.0,0.0,0.0), vec3(0.0,0.0,1.0), t/0.25);
        if (t < 0.5)  return mix(vec3(0.0,0.0,1.0), vec3(0.0,1.0,0.0), (t-0.25)/0.25);
        if (t < 0.75) return mix(vec3(0.0,1.0,0.0), vec3(1.0,1.0,0.0), (t-0.5)/0.25);
        return mix(vec3(1.0,1.0,0.0), vec3(1.0,0.0,0.0), (t-0.75)/0.25);
      }

      void main() {
        vec4 color = texture(colorTexture, v_textureCoordinates);
        float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float heat = pow(clamp(lum, 0.0, 1.0), 0.6);
        vec3 thermal = thermalColor(heat);
        float scanline = mod(floor(v_textureCoordinates.y * czm_viewport.w), 2.0) < 1.0 ? 0.88 : 1.0;
        out_FragColor = vec4(thermal * scanline, 1.0);
      }
    `,
  });
}
