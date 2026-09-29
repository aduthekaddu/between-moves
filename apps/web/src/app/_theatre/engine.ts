/**
 * The shadow theatre: one lamp behind one cloth screen, and cut-paper puppets between them.
 *
 * Physically, a puppet at distance z from the screen (as a fraction of the lamp's distance)
 * casts a shadow magnified by 1 / (1 - z) about the lamp's position and blurred by the lamp's
 * size times z / (1 - z). Pressed against the screen it is sharp and its tissue windows glow in
 * colour; pulled back towards the lamp it grows, softens and loses its colour. Sprites multiply
 * the screen's light (card lets almost nothing through, tissue lets its colour through), so the
 * order they are drawn in never matters.
 *
 * Everything is in CSS pixels with the origin at the top left of the viewport.
 */
import { SPRITES, type SpriteKey } from './assets';

export interface SpriteDraw {
  readonly key: SpriteKey;
  /** Anchor on the screen at the resting lamp position, CSS px. */
  readonly x: number;
  readonly y: number;
  /** Height on the screen, CSS px. Width follows the sprite's aspect. */
  readonly h: number;
  /** 0 pressed against the screen … 0.85 close to the lamp. */
  readonly z: number;
  /** Anchor inside the sprite, 0..1 (default bottom centre). */
  readonly ax?: number;
  readonly ay?: number;
  readonly rot?: number;
  readonly flip?: boolean;
  readonly alpha?: number;
}

export interface Lamp {
  /** Lamp position projected on the screen, CSS px. */
  x: number;
  y: number;
  /** Where the lamp was when the scene was blocked; shadows are placed against it. */
  restX: number;
  restY: number;
  /** 0 dark … 1 fully lit. */
  power: number;
  /** Flame size in CSS px; decides how soft distant shadows are. */
  size: number;
}

export interface ScreenLook {
  /** The dye of the cloth, 0..1 sRGB. */
  tint: readonly [number, number, number];
  /** Global fade to black, 0 black … 1 open. */
  open: number;
}

const QUAD = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);

const VERT_FULL = `#version 300 es
layout(location=0) in vec2 aPos;
void main(){ gl_Position = vec4(aPos * 2.0 - 1.0, 0.0, 1.0); }`;

const FRAG_SCREEN = `#version 300 es
precision highp float;
uniform vec2 uRes;      // device px
uniform float uScale;   // device px per CSS px
uniform vec2 uLamp;     // CSS px
uniform float uPower;
uniform vec3 uTint;
uniform float uTime;
out vec4 outColor;
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float a = hash(i), b = hash(i + vec2(1.0, 0.0)), c = hash(i + vec2(0.0, 1.0)), d = hash(i + vec2(1.0, 1.0));
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 p){ float v = 0.0, a = 0.5; for (int i = 0; i < 4; i++){ v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main(){
  vec2 px = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;
  vec2 view = uRes / uScale;
  vec2 d = (px - uLamp) / max(view.x, view.y);
  float r2 = dot(d, d);
  // a broad ambient wash plus the lamp's hot spot, which is what the eye follows
  float glow = uPower * (0.42 / (1.0 + r2 * 9.0) + 0.16 / (1.0 + r2 * 60.0));
  float ambient = 0.58 + 0.2 * uPower;
  float crease = fbm(px / vec2(520.0, 300.0) + vec2(3.1, 7.7));
  float weave = sin(px.x * 1.7) * sin(px.y * 1.7);
  float light = (ambient + glow) * (0.95 + 0.07 * crease) * (1.0 + 0.012 * weave);
  vec3 hot = vec3(1.0, 0.972, 0.9);
  vec3 col = uTint * light;
  col = mix(col, hot, clamp((glow - 0.3) * 1.3, 0.0, 0.55));
  // the stage frame: the cloth falls into darkness at its edges
  vec2 uv = px / view;
  float frame = smoothstep(0.0, 0.1, uv.x) * smoothstep(1.0, 0.9, uv.x) * smoothstep(0.0, 0.08, uv.y) * smoothstep(1.0, 0.9, uv.y);
  col *= mix(0.62, 1.0, frame);
  outColor = vec4(col, 1.0);
}`;

const VERT_SPRITE = `#version 300 es
layout(location=0) in vec2 aPos;
uniform vec4 uRect;     // x, y, w, h in CSS px (expanded for blur)
uniform vec4 uUv;       // u0, v0, u1, v1
uniform vec2 uPivot;    // CSS px
uniform float uRot;
uniform vec2 uView;     // CSS px
out vec2 vUv;
void main(){
  vec2 p = uRect.xy + aPos * uRect.zw - uPivot;
  float c = cos(uRot), s = sin(uRot);
  p = uPivot + vec2(c * p.x - s * p.y, s * p.x + c * p.y);
  gl_Position = vec4(p.x / uView.x * 2.0 - 1.0, 1.0 - p.y / uView.y * 2.0, 0.0, 1.0);
  vUv = mix(uUv.xy, uUv.zw, aPos);
}`;

const FRAG_SPRITE = `#version 300 es
precision highp float;
in vec2 vUv;
uniform sampler2D uTex;
uniform float uLod;
uniform vec2 uTap;      // blur radius in uv units
uniform float uAlpha;
uniform float uFar;     // 0 pressed … 1 far shadow
out vec4 outColor;
void main(){
  // a golden-angle disk: twelve taps spread evenly over the penumbra
  vec4 acc = textureLod(uTex, vUv, uLod) * 0.12;
  float weight = 0.12;
  for (int i = 1; i < 13; i++) {
    float r = sqrt(float(i) / 12.0);
    float a = float(i) * 2.39996;
    float w = 1.0 - r * 0.45;
    acc += textureLod(uTex, vUv + vec2(cos(a), sin(a)) * r * uTap, uLod) * w;
    weight += w;
  }
  acc /= weight;
  float a = clamp(acc.a, 0.0, 1.0);
  vec3 rgb = a > 0.002 ? acc.rgb / a : vec3(0.0);
  float lum = dot(rgb, vec3(0.299, 0.587, 0.114));
  // tissue passes its colour when it touches the cloth; far away the light mixes and greys
  vec3 pass = mix(rgb * 1.18, vec3(lum * 0.35 + 0.06) * vec3(1.3, 1.0, 0.72), uFar);
  vec3 through = max(pass, vec3(0.035));
  float density = a * uAlpha * mix(1.0, 0.7, uFar);
  outColor = vec4(mix(vec3(1.0), through, density), 1.0);
}`;

const FRAG_POST = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uTime;
uniform float uOpen;
out vec4 outColor;
float hash(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p.yx + 19.19); return fract((p.x + p.y) * p.x); }
void main(){
  vec2 uv = gl_FragCoord.xy / uRes;
  vec3 c = texture(uScene, uv).rgb;
  float g = hash(gl_FragCoord.xy + floor(uTime * 24.0) * 17.13) - 0.5;
  c += g * 0.045 * (0.35 + 0.65 * c);
  outColor = vec4(c * uOpen, 1.0);
}`;

interface LoadedTexture {
  readonly texture: WebGLTexture;
  readonly width: number;
  readonly height: number;
}

function compile(gl: WebGL2RenderingContext, vert: string, frag: string): WebGLProgram {
  const program = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, vert],
    [gl.FRAGMENT_SHADER, frag],
  ] as const) {
    const shader = gl.createShader(type);
    if (shader === null) throw new Error('shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      throw new Error(gl.getShaderInfoLog(shader) ?? 'shader compile failed');
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) ?? 'program link failed');
  }
  return program;
}

function uniforms(gl: WebGL2RenderingContext, program: WebGLProgram, names: readonly string[]) {
  return Object.fromEntries(
    names.map((name) => [name, gl.getUniformLocation(program, name)]),
  ) as Record<string, WebGLUniformLocation | null>;
}

export class Theatre {
  private readonly gl: WebGL2RenderingContext;
  private readonly screen: WebGLProgram;
  private readonly sprite: WebGLProgram;
  private readonly post: WebGLProgram;
  private readonly uScreen: Record<string, WebGLUniformLocation | null>;
  private readonly uSprite: Record<string, WebGLUniformLocation | null>;
  private readonly uPost: Record<string, WebGLUniformLocation | null>;
  private readonly vao: WebGLVertexArrayObject;
  private readonly textures = new Map<SpriteKey, LoadedTexture>();
  private readonly loading = new Set<SpriteKey>();
  private fbo: WebGLFramebuffer | null = null;
  private target: WebGLTexture | null = null;
  private width = 1;
  private height = 1;
  private scale = 1;
  private destroyed = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly preferSmall: boolean,
  ) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
      powerPreference: 'high-performance',
    });
    if (gl === null) throw new Error('WebGL2 unavailable');
    this.gl = gl;
    this.screen = compile(gl, VERT_FULL, FRAG_SCREEN);
    this.sprite = compile(gl, VERT_SPRITE, FRAG_SPRITE);
    this.post = compile(gl, VERT_FULL, FRAG_POST);
    this.uScreen = uniforms(gl, this.screen, [
      'uRes',
      'uScale',
      'uLamp',
      'uPower',
      'uTint',
      'uTime',
    ]);
    this.uSprite = uniforms(gl, this.sprite, [
      'uRect',
      'uUv',
      'uPivot',
      'uRot',
      'uView',
      'uTex',
      'uLod',
      'uTap',
      'uAlpha',
      'uFar',
    ]);
    this.uPost = uniforms(gl, this.post, ['uScene', 'uRes', 'uTime', 'uOpen']);
    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, QUAD, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.vao = vao;
  }

  /** Match the drawing buffer to the canvas's CSS size at a capped pixel ratio. */
  resize(cssWidth: number, cssHeight: number, pixelRatio: number): void {
    const gl = this.gl;
    this.scale = pixelRatio;
    this.width = Math.max(1, Math.round(cssWidth * pixelRatio));
    this.height = Math.max(1, Math.round(cssHeight * pixelRatio));
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    if (this.target !== null) gl.deleteTexture(this.target);
    if (this.fbo !== null) gl.deleteFramebuffer(this.fbo);
    this.target = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.width,
      this.height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      null,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.target, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  /** Start fetching sprites; resolves once each has been uploaded (or failed quietly). */
  load(keys: readonly SpriteKey[]): Promise<void> {
    const pending = keys
      .filter((key) => !this.textures.has(key) && !this.loading.has(key))
      .map(async (key) => {
        this.loading.add(key);
        const asset = SPRITES[key];
        const image = new Image();
        image.decoding = 'async';
        image.src = this.preferSmall && asset.small !== null ? asset.small : asset.src;
        try {
          await image.decode();
        } catch {
          this.loading.delete(key);
          return;
        }
        if (this.destroyed) return;
        const gl = this.gl;
        const texture = gl.createTexture();
        gl.bindTexture(gl.TEXTURE_2D, texture);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
        gl.generateMipmap(gl.TEXTURE_2D);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        this.textures.set(key, { texture, width: image.naturalWidth, height: image.naturalHeight });
        this.loading.delete(key);
      });
    return Promise.all(pending).then(() => undefined);
  }

  has(key: SpriteKey): boolean {
    return this.textures.has(key);
  }

  /** Draw one frame: the lit cloth, every puppet's shadow on it, then grain. */
  render(draws: readonly SpriteDraw[], lamp: Lamp, look: ScreenLook, time: number): void {
    const gl = this.gl;
    const viewW = this.width / this.scale;
    const viewH = this.height / this.scale;
    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.width, this.height);

    gl.disable(gl.BLEND);
    gl.useProgram(this.screen);
    gl.uniform2f(this.uScreen.uRes ?? null, this.width, this.height);
    gl.uniform1f(this.uScreen.uScale ?? null, this.scale);
    gl.uniform2f(this.uScreen.uLamp ?? null, lamp.x, lamp.y);
    gl.uniform1f(this.uScreen.uPower ?? null, lamp.power);
    gl.uniform3f(this.uScreen.uTint ?? null, look.tint[0], look.tint[1], look.tint[2]);
    gl.uniform1f(this.uScreen.uTime ?? null, time);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.DST_COLOR, gl.ZERO);
    gl.useProgram(this.sprite);
    gl.uniform2f(this.uSprite.uView ?? null, viewW, viewH);
    gl.uniform1i(this.uSprite.uTex ?? null, 0);
    gl.activeTexture(gl.TEXTURE0);
    for (const draw of draws) {
      const loaded = this.textures.get(draw.key);
      if (loaded === undefined || (draw.alpha ?? 1) <= 0.003 || draw.h <= 1) continue;
      const asset = SPRITES[draw.key];
      const z = Math.min(0.88, Math.max(0, draw.z));
      const m = 1 / (1 - z);
      // the anchor was blocked against the resting lamp; re-project it through the live lamp
      const baseX = lamp.restX + (draw.x - lamp.restX) / m;
      const baseY = lamp.restY + (draw.y - lamp.restY) / m;
      const px = lamp.x + (baseX - lamp.x) * m;
      const py = lamp.y + (baseY - lamp.y) * m;
      const h = draw.h;
      const w = (h * asset.w) / asset.h;
      const ax = draw.ax ?? 0.5;
      const ay = draw.ay ?? 1;
      const left = px - w * ax;
      const top = py - h * ay;
      const blur = lamp.size * (z / (1 - z));
      const margin = blur * 1.2 + 2;
      const u0 = -margin / w;
      const v0 = -margin / h;
      const flip = draw.flip === true;
      gl.bindTexture(gl.TEXTURE_2D, loaded.texture);
      gl.uniform4f(
        this.uSprite.uRect ?? null,
        left - margin,
        top - margin,
        w + margin * 2,
        h + margin * 2,
      );
      gl.uniform4f(this.uSprite.uUv ?? null, flip ? 1 - u0 : u0, v0, flip ? u0 : 1 - u0, 1 - v0);
      gl.uniform2f(this.uSprite.uPivot ?? null, px, py);
      gl.uniform1f(this.uSprite.uRot ?? null, draw.rot ?? 0);
      const texelsPerPx = loaded.width / (w * this.scale);
      const blurTexels = blur * this.scale * texelsPerPx;
      gl.uniform1f(
        this.uSprite.uLod ?? null,
        Math.max(0, Math.log2(Math.max(1, blurTexels * 0.3))),
      );
      gl.uniform2f(this.uSprite.uTap ?? null, blur / w, blur / h);
      gl.uniform1f(this.uSprite.uAlpha ?? null, draw.alpha ?? 1);
      gl.uniform1f(this.uSprite.uFar ?? null, Math.min(1, z * 2.2));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    gl.disable(gl.BLEND);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.width, this.height);
    gl.useProgram(this.post);
    gl.bindTexture(gl.TEXTURE_2D, this.target);
    gl.uniform1i(this.uPost.uScene ?? null, 0);
    gl.uniform2f(this.uPost.uRes ?? null, this.width, this.height);
    gl.uniform1f(this.uPost.uTime ?? null, time);
    gl.uniform1f(this.uPost.uOpen ?? null, look.open);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /**
   * Free this theatre's GPU resources. The context itself stays alive: a canvas has only one,
   * and a remount (React's strict mode runs effects twice) builds the next theatre on it.
   */
  destroy(): void {
    this.destroyed = true;
    const gl = this.gl;
    for (const loaded of this.textures.values()) gl.deleteTexture(loaded.texture);
    this.textures.clear();
    if (this.target !== null) gl.deleteTexture(this.target);
    if (this.fbo !== null) gl.deleteFramebuffer(this.fbo);
    for (const program of [this.screen, this.sprite, this.post]) gl.deleteProgram(program);
    gl.deleteVertexArray(this.vao);
  }
}
