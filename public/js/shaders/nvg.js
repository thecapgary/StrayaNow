export function createNVGStage() {
  return new Cesium.PostProcessStage({
    name: 'strayanow_nvg',
    fragmentShader: `
      uniform sampler2D colorTexture;
      in vec2 v_textureCoordinates;

      float rand(vec2 co) {
        return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
      }

      void main() {
        vec4 color = texture(colorTexture, v_textureCoordinates);
        float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
        float green = pow(clamp(lum, 0.0, 1.0), 0.75);
        vec3 nvg = vec3(0.0, green, green * 0.12);
        float noise = rand(v_textureCoordinates + vec2(fract(float(czm_frameNumber) * 0.01))) * 0.04;
        nvg += noise;
        vec2 uv = v_textureCoordinates - 0.5;
        float vign = 1.0 - dot(uv, uv) * 2.2;
        nvg *= clamp(vign, 0.0, 1.0);
        out_FragColor = vec4(nvg, 1.0);
      }
    `,
  });
}
