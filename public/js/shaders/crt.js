export function createCRTStage() {
  return new Cesium.PostProcessStage({
    name: 'strayanow_crt',
    fragmentShader: `
      uniform sampler2D colorTexture;
      in vec2 v_textureCoordinates;

      vec2 barrel(vec2 uv, float s) {
        vec2 c = uv - 0.5;
        return uv + c * dot(c,c) * s;
      }

      void main() {
        vec2 uv = barrel(v_textureCoordinates, 0.10);
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
          out_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
          return;
        }
        vec4 color = texture(colorTexture, uv);
        float scan = sin(uv.y * czm_viewport.w * 3.14159) * 0.5 + 0.5;
        color.rgb *= mix(0.55, 1.0, pow(scan, 0.35));
        float r = texture(colorTexture, uv + vec2(0.0012, 0.0)).r;
        float b = texture(colorTexture, uv - vec2(0.0012, 0.0)).b;
        color.rgb = vec3(r, color.g, b);
        color.rgb *= vec3(0.82, 1.0, 0.78);
        vec2 vig = uv - 0.5;
        color.rgb *= clamp(1.0 - dot(vig,vig) * 2.5, 0.0, 1.0);
        float bright = dot(color.rgb, vec3(0.33));
        color.rgb += color.rgb * bright * 0.35;
        out_FragColor = vec4(color.rgb, 1.0);
      }
    `,
  });
}
