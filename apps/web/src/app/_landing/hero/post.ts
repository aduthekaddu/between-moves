import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/** Miniature-photograph focus: sharp across the board, softening above and below it. */
function tiltShift(direction: [number, number]) {
  return {
    name: 'PaperTiltShift',
    uniforms: {
      tDiffuse: { value: null },
      texel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      direction: { value: new THREE.Vector2(...direction) },
      focus: { value: 0.45 },
      band: { value: 0.16 },
      amount: { value: 2.6 },
    },
    vertexShader,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform vec2 texel;
      uniform vec2 direction;
      uniform float focus;
      uniform float band;
      uniform float amount;
      varying vec2 vUv;
      void main() {
        float away = max(0.0, abs(vUv.y - focus) - band);
        float radius = amount * smoothstep(0.0, 0.42, away);
        vec2 stepSize = direction * texel * radius;
        vec4 sum = texture2D(tDiffuse, vUv) * 0.1633;
        sum += (texture2D(tDiffuse, vUv + stepSize) + texture2D(tDiffuse, vUv - stepSize)) * 0.1531;
        sum += (texture2D(tDiffuse, vUv + 2.0 * stepSize) + texture2D(tDiffuse, vUv - 2.0 * stepSize)) * 0.12245;
        sum += (texture2D(tDiffuse, vUv + 3.0 * stepSize) + texture2D(tDiffuse, vUv - 3.0 * stepSize)) * 0.0918;
        sum += (texture2D(tDiffuse, vUv + 4.0 * stepSize) + texture2D(tDiffuse, vUv - 4.0 * stepSize)) * 0.051;
        gl_FragColor = sum;
      }
    `,
  };
}

/** Vignette toward the lamp pool and grain that re-seeds on twos, like the pieces. */
const grainShader = {
  name: 'PaperGrain',
  uniforms: {
    tDiffuse: { value: null },
    resolution: { value: new THREE.Vector2(1024, 1024) },
    frame: { value: 0 },
    centre: { value: new THREE.Vector2(0.62, 0.5) },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 resolution;
    uniform float frame;
    uniform vec2 centre;
    varying vec2 vUv;
    float hash(vec2 p) {
      p = fract(p * vec2(123.34, 456.21));
      p += dot(p, p + 45.32);
      return fract(p.x * p.y);
    }
    void main() {
      vec4 colour = texture2D(tDiffuse, vUv);
      vec2 q = (vUv - centre) * vec2(resolution.x / resolution.y, 1.0);
      float vignette = smoothstep(1.15, 0.2, length(q));
      colour.rgb *= mix(0.62, 1.0, vignette);
      float grain = hash(floor(vUv * resolution / 1.5) + frame * 17.0) - 0.5;
      colour.rgb += grain * 0.045 * (1.0 - colour.rgb * 0.6);
      gl_FragColor = colour;
    }
  `,
};

export interface PaperPost {
  render(frame: number): void;
  setSize(width: number, height: number, pixelRatio: number): void;
  setFocus(uvY: number, centre: THREE.Vector2): void;
  dispose(): void;
}

export function createPost(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PaperPost {
  const target = new THREE.WebGLRenderTarget(1, 1, {
    type: THREE.HalfFloatType,
    samples: 4,
  });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  const horizontal = new ShaderPass(tiltShift([1, 0]));
  const vertical = new ShaderPass(tiltShift([0, 1]));
  composer.addPass(horizontal);
  composer.addPass(vertical);
  composer.addPass(new OutputPass());
  const grain = new ShaderPass(grainShader);
  composer.addPass(grain);

  return {
    render(frame) {
      grain.uniforms.frame!.value = frame;
      composer.render();
    },
    setSize(width, height, pixelRatio) {
      composer.setPixelRatio(pixelRatio);
      composer.setSize(width, height);
      const texel = new THREE.Vector2(1 / (width * pixelRatio), 1 / (height * pixelRatio));
      horizontal.uniforms.texel!.value = texel;
      vertical.uniforms.texel!.value = texel;
      grain.uniforms.resolution!.value = new THREE.Vector2(width * pixelRatio, height * pixelRatio);
    },
    setFocus(uvY, centre) {
      horizontal.uniforms.focus!.value = uvY;
      vertical.uniforms.focus!.value = uvY;
      grain.uniforms.centre!.value = centre;
    },
    dispose() {
      composer.dispose();
      target.dispose();
    },
  };
}
