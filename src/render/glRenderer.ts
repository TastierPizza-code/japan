import type { Battle } from "../sim/battle.ts";
import { STATS, UNIT_AT, UNIT_FLAME, UNIT_GUN, UNIT_MAGE, UNIT_MG, UNIT_RIFLE, UNIT_STORM, UNIT_TANK } from "../sim/config.ts";
import { K_BUNKER, K_TRENCH } from "../sim/terrain.ts";
import type { Camera } from "./camera.ts";
import { SpriteAtlas, type Frame, type FrameName } from "./sprites.ts";

/** Darstellungsvarianten der Einheiten */
export type RenderStyle = "klassisch" | "deutlich" | "punkte";
export const STYLE_NAMES: Record<RenderStyle, string> = {
  klassisch: "Klassisch",
  deutlich: "Deutlich",
  punkte: "Punkte",
};

const VS = `#version 300 es
layout(location=0) in vec2 a_corner;
layout(location=1) in vec4 a_pos;   // x, y, w, h
layout(location=2) in vec4 a_uv;    // u0, v0, u1, v1
layout(location=3) in vec4 a_color;
layout(location=4) in vec2 a_rm;    // Winkel, Modus
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_view;
out vec2 v_uv;
out vec2 v_local;
out vec4 v_color;
flat out float v_mode;
void main() {
  float c = cos(a_rm.x), s = sin(a_rm.x);
  vec2 l = a_corner * a_pos.zw;
  vec2 w = a_pos.xy + vec2(l.x * c - l.y * s, l.x * s + l.y * c);
  vec2 p = (w - u_cam) * u_zoom;
  gl_Position = vec4(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0, 0.0, 1.0);
  v_uv = mix(a_uv.xy, a_uv.zw, a_corner + 0.5);
  v_local = a_corner * 2.0;
  v_color = a_color;
  v_mode = a_rm.y;
}`;

const FS = `#version 300 es
precision mediump float;
uniform sampler2D u_tex;
in vec2 v_uv;
in vec2 v_local;
in vec4 v_color;
flat in float v_mode;
out vec4 o;
void main() {
  vec4 c;
  float r = length(v_local);
  if (v_mode < 0.5) {            // Sprite aus dem Atlas
    c = texture(u_tex, v_uv) * v_color;
    if (c.a < 0.05) discard;
  } else if (v_mode < 1.5) {     // weicher Kreis (Rauch, Staub)
    if (r > 1.0) discard;
    c = v_color; c.a *= 1.0 - r * r;
  } else if (v_mode < 2.5) {     // Balken (Leuchtspur)
    c = v_color; c.a *= 1.0 - smoothstep(0.4, 1.0, abs(v_local.y));
  } else if (v_mode < 3.5) {     // Ring (Druckwelle, Markierung)
    float a = 1.0 - smoothstep(0.0, 0.14, abs(r - 0.86));
    if (a <= 0.01) discard;
    c = v_color; c.a *= a;
  } else if (v_mode < 4.5) {     // harter Punkt
    if (r > 1.0) discard;
    c = v_color;
  } else {                       // leuchtend (additiv)
    if (r > 1.0) discard;
    float a = v_color.a * (1.0 - r) * (1.0 - r);
    o = vec4(v_color.rgb * a, 0.0);
    return;
  }
  o = vec4(c.rgb * c.a, c.a);
}`;

const STRIDE = 14;
const MAX_INST = 60000;
const M_SPRITE = 0;
const M_SOFT = 1;
const M_BAR = 2;
const M_RING = 3;
const M_DOT = 4;
const M_GLOW = 5;

/** Partikel: kurze Effekte ohne Einfluss auf die Simulation */
interface P {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  g: number;
  drag: number;
  t: number;
  life: number;
  s0: number;
  s1: number;
  r: number;
  gC: number;
  b: number;
  a: number;
  mode: number;
  /** über den Einheiten zeichnen */
  top: boolean;
}

interface Tracer {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  life: number;
  kind: number;
  side: number;
}

const SIDE_TINT = [
  [0.55, 0.75, 1],
  [1, 0.55, 0.45],
];
const MAGE_COLOR = [
  [0.45, 0.95, 1.0],
  [1.0, 0.5, 0.95],
];

export class GlRenderer {
  atlas = new SpriteAtlas();
  style: RenderStyle = "klassisch";
  selected = -1;
  /** Seite, deren Minen sichtbar sind */
  viewerSide = 0;
  /** Stärke des Kamerawackelns (wird von Explosionen erhöht) */
  shake = 0;
  /** Ton-Rückruf: Art, Position, Größe */
  onSound: ((kind: string, x: number, y: number, big?: number) => void) | null = null;

  private gl: WebGL2RenderingContext;
  private canvas: HTMLCanvasElement;
  private inst = new Float32Array(MAX_INST * STRIDE);
  private n = 0;
  private buf: WebGLBuffer;
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private parts: P[] = [];
  private tracers: Tracer[] = [];
  private time = 0;
  private whistled = new WeakSet<object>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl2", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) throw new Error("WebGL2 wird nicht unterstützt");
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    gl.useProgram(prog);
    for (const u of ["u_cam", "u_zoom", "u_view", "u_tex"]) this.loc[u] = gl.getUniformLocation(prog, u);

    const vao = gl.createVertexArray();
    gl.bindVertexArray(vao);
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-0.5, -0.5, 0.5, -0.5, -0.5, 0.5, 0.5, 0.5]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.inst.byteLength, gl.DYNAMIC_DRAW);
    const attr = (loc: number, size: number, off: number) => {
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, size, gl.FLOAT, false, STRIDE * 4, off * 4);
      gl.vertexAttribDivisor(loc, 1);
    };
    attr(1, 4, 0);
    attr(2, 4, 4);
    attr(3, 4, 8);
    attr(4, 2, 12);

    const tex = gl.createTexture();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.atlas.canvas);
    gl.uniform1i(this.loc.u_tex, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  reset() {
    this.parts = [];
    this.tracers = [];
    this.shake = 0;
  }

  // ============================================================ Ereignisse

  /** Neue Schüsse, Treffer und Explosionen aus der Simulation übernehmen. */
  ingest(b: Battle, blood: (x: number, y: number, size: number) => void) {
    const e = b.events;
    const rnd = Math.random;
    for (let i = 0; i < e.shots.length; i += 6) {
      const [x1, y1, x2, y2, type, side] = [e.shots[i], e.shots[i + 1], e.shots[i + 2], e.shots[i + 3], e.shots[i + 4], e.shots[i + 5]];
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const speed = type === UNIT_MAGE ? 380 : 1100;
      this.tracers.push({ x1, y1, x2, y2, t: 0, life: Math.max(0.05, dist / speed), kind: type, side });
      if (type !== UNIT_MAGE) {
        const a = Math.atan2(y2 - y1, x2 - x1);
        const big = type === UNIT_AT ? 1.6 : type === UNIT_MG || type === UNIT_TANK ? 1 : 0.8;
        this.part(x1 + Math.cos(a) * 4, y1 + Math.sin(a) * 4, 0, 0, 0, { life: 0.07, s0: 4 * big, s1: 5 * big, c: [1, 0.85, 0.45, 1], mode: M_GLOW, top: true });
        if (rnd() < 0.5) this.part(x1 + Math.cos(a) * 5, y1 + Math.sin(a) * 5, 0, Math.cos(a) * 6, Math.sin(a) * 6, { life: 0.9, s0: 2, s1: 6 * big, c: [0.75, 0.73, 0.7, 0.25], mode: M_SOFT });
        this.onSound?.(type === UNIT_MG || type === UNIT_TANK ? "mg" : type === UNIT_AT ? "at" : "rifle", x1, y1);
      } else this.onSound?.("magic", x1, y1);
    }
    for (let i = 0; i < e.hits.length; i += 3) {
      const [x, y, k] = [e.hits[i], e.hits[i + 1], e.hits[i + 2]];
      if (k === 0) {
        for (let j = 0; j < 4; j++) this.part(x, y, 2, (rnd() - 0.5) * 30, (rnd() - 0.5) * 30, { vz: 20 + rnd() * 20, g: 120, life: 0.35, s0: 1.2, s1: 0.8, c: [0.55, 0.05, 0.04, 1], mode: M_DOT });
        blood(x, y, 1.2 + rnd());
      } else if (k === 1) {
        for (let j = 0; j < 5; j++) this.part(x, y, 3, (rnd() - 0.5) * 80, (rnd() - 0.5) * 80, { life: 0.18, s0: 1.4, s1: 0.4, c: [1, 0.9, 0.5, 1], mode: M_GLOW, top: true });
      } else if (k === 2) {
        for (let j = 0; j < 3; j++) this.part(x, y, 0, (rnd() - 0.5) * 16, (rnd() - 0.5) * 16, { vz: 15 + rnd() * 20, g: 90, life: 0.4, s0: 1.6, s1: 2.5, c: [0.35, 0.3, 0.22, 0.8], mode: M_SOFT });
      } else {
        this.part(x, y, 6, 0, 0, { life: 0.25, s0: 4, s1: 9, c: [0.6, 0.95, 1, 0.9], mode: M_RING, top: true });
      }
    }
    for (let i = 0; i < e.deaths.length; i += 5) {
      const type = e.deaths[i + 3];
      if (type !== UNIT_TANK && type !== UNIT_GUN && type !== UNIT_MAGE) blood(e.deaths[i], e.deaths[i + 1], 3 + rnd() * 2);
    }
    for (let i = 0; i < e.blasts.length; i += 4) this.explosion(e.blasts[i], e.blasts[i + 1], e.blasts[i + 2], e.blasts[i + 3]);
    for (let i = 0; i < e.gunfire.length; i += 4) {
      const [x, y, a, k] = [e.gunfire[i], e.gunfire[i + 1], e.gunfire[i + 2], e.gunfire[i + 3]];
      const mx = x + Math.cos(a) * (k === 0 ? 10 : 12);
      const my = y + Math.sin(a) * (k === 0 ? 10 : 12);
      this.part(mx, my, 0, 0, 0, { life: 0.12, s0: 22, s1: 30, c: [1, 0.8, 0.4, 1], mode: M_GLOW, top: true });
      for (let j = 0; j < 7; j++) {
        const sa = a + (rnd() - 0.5) * 1.6;
        this.part(mx, my, 1, Math.cos(sa) * (20 + rnd() * 30), Math.sin(sa) * (20 + rnd() * 30), { drag: 1.5, life: 2 + rnd() * 1.5, s0: 5, s1: 16, c: [0.78, 0.76, 0.72, 0.4], mode: M_SOFT, top: true });
      }
      this.part(x, y, 0, 0, 0, { life: 0.4, s0: 6, s1: 40, c: [0.8, 0.75, 0.6, 0.35], mode: M_RING });
      this.onSound?.("gun", x, y);
    }
    for (let i = 0; i < e.signals.length; i += 3) this.onSound?.(e.signals[i + 2] === 0 ? "whistleSignal" : "gasAlarm", e.signals[i], e.signals[i + 1]);
    for (let i = 0; i < e.flames.length; i += 3) {
      const [x, y, a] = [e.flames[i], e.flames[i + 1], e.flames[i + 2]];
      for (let j = 0; j < 5; j++) {
        const sa = a + (rnd() - 0.5) * 0.5;
        const sp = 90 + rnd() * 60;
        this.part(x + Math.cos(a) * 5, y + Math.sin(a) * 5, 1, Math.cos(sa) * sp, Math.sin(sa) * sp, { drag: 2.5, life: 0.35 + rnd() * 0.15, s0: 2.5, s1: 9, c: [1, 0.55 + rnd() * 0.3, 0.15, 0.9], mode: M_GLOW, top: true });
      }
      if (rnd() < 0.4) this.part(x + Math.cos(a) * 25, y + Math.sin(a) * 25, 3, 3, -4, { life: 2.5, s0: 4, s1: 14, c: [0.12, 0.1, 0.09, 0.45], mode: M_SOFT, top: true });
      if (rnd() < 0.3) this.onSound?.("flame", x, y);
    }
  }

  private explosion(x: number, y: number, r: number, kind: number) {
    const rnd = Math.random;
    if (kind === 1) {
      // Magie
      this.part(x, y, 0, 0, 0, { life: 0.3, s0: r * 1.5, s1: r * 3, c: [0.6, 0.95, 1, 1], mode: M_GLOW, top: true });
      this.part(x, y, 0, 0, 0, { life: 0.4, s0: r, s1: r * 3.5, c: [0.6, 0.95, 1, 0.7], mode: M_RING, top: true });
      this.onSound?.("magicBoom", x, y);
      return;
    }
    if (kind === 8) {
      // Gasgranate: kaum Knall, gelbgrüner Schwall
      for (let j = 0; j < 8; j++) {
        const a = rnd() * Math.PI * 2;
        const sp = 8 + rnd() * 20;
        this.part(x, y, 1, Math.cos(a) * sp, Math.sin(a) * sp, { drag: 1.2, life: 2.5 + rnd() * 2, s0: 6, s1: 24, c: [0.7, 0.78, 0.3, 0.45], mode: M_SOFT, top: true });
      }
      this.onSound?.("smokePop", x, y);
      return;
    }
    if (kind === 7) {
      // Nebelgranate: dumpfer Knall, weißer Qualm quillt auf (die Wolke selbst zeichnet drawSmoke)
      for (let j = 0; j < 10; j++) {
        const a = rnd() * Math.PI * 2;
        const sp = 10 + rnd() * 25;
        this.part(x, y, 2, Math.cos(a) * sp, Math.sin(a) * sp, { drag: 1.2, life: 2.5 + rnd() * 2, s0: 6, s1: 26, c: [0.9, 0.9, 0.88, 0.55], mode: M_SOFT, top: true });
      }
      this.part(x, y, 0, 0, 0, { life: 0.12, s0: 10, s1: 14, c: [1, 0.85, 0.6, 0.8], mode: M_GLOW, top: true });
      this.onSound?.("smokePop", x, y);
      return;
    }
    if (kind === 6) {
      // Handgranate: kleiner, harter Blitz, Dreck und etwas Rauch
      this.part(x, y, 0, 0, 0, { life: 0.1, s0: r * 3, s1: r * 4, c: [1, 0.85, 0.55, 1], mode: M_GLOW, top: true });
      for (let j = 0; j < 8; j++) {
        const a = rnd() * Math.PI * 2;
        const sp = 15 + rnd() * 40;
        this.part(x, y, 1, Math.cos(a) * sp, Math.sin(a) * sp, { vz: 30 + rnd() * 50, g: 260, life: 0.7 + rnd() * 0.3, s0: 1.4, s1: 1.1, c: [0.27, 0.22, 0.16, 1], mode: M_DOT, top: true });
      }
      this.part(x, y, 0, 0, 0, { life: 0.25, s0: r, s1: r * 4, c: [0.9, 0.85, 0.75, 0.4], mode: M_RING, top: true });
      for (let j = 0; j < 3; j++) this.part(x + (rnd() - 0.5) * r, y + (rnd() - 0.5) * r, 3, 3 + (rnd() - 0.5) * 6, -2, { drag: 0.4, life: 2 + rnd() * 2, s0: r, s1: r * 3, c: [0.4, 0.38, 0.34, 0.45], mode: M_SOFT, top: true });
      this.onSound?.("grenade", x, y);
      return;
    }
    const big = kind === 0 || kind === 4 ? 1 : kind === 2 ? 0.7 : 0.45;
    const R = r * (kind === 4 ? 1.4 : 1);
    this.part(x, y, 0, 0, 0, { life: 0.14, s0: R * 3.5, s1: R * 4.5, c: [1, 0.85, 0.55, 1], mode: M_GLOW, top: true });
    for (let j = 0; j < 6 * big + 2; j++) {
      this.part(x + (rnd() - 0.5) * R, y + (rnd() - 0.5) * R, 2, (rnd() - 0.5) * 30, (rnd() - 0.5) * 30, { drag: 2, life: 0.5 + rnd() * 0.3, s0: R * 0.8, s1: R * 1.6, c: [1, 0.45 + rnd() * 0.25, 0.1, 0.9], mode: M_GLOW, top: true });
    }
    // Erdbrocken fliegen hoch und fallen zurück
    for (let j = 0; j < 22 * big; j++) {
      const a = rnd() * Math.PI * 2;
      const sp = 20 + rnd() * 70;
      this.part(x, y, 2, Math.cos(a) * sp, Math.sin(a) * sp, { vz: 60 + rnd() * 120, g: 260, life: 1 + rnd() * 0.6, s0: 1.8, s1: 1.4, c: [0.27, 0.22, 0.16, 1], mode: M_DOT, top: true });
    }
    // Druckwelle
    this.part(x, y, 0, 0, 0, { life: 0.35, s0: R, s1: R * 6, c: [0.9, 0.85, 0.75, 0.5], mode: M_RING, top: true });
    // Rauchsäule, die langsam verweht
    const smoke = kind === 4 ? [0.08, 0.07, 0.06, 0.6] : [0.42, 0.39, 0.34, 0.5];
    for (let j = 0; j < 7 * big + 2; j++) {
      this.part(x + (rnd() - 0.5) * R, y + (rnd() - 0.5) * R, 4, 4 + (rnd() - 0.5) * 8, -3 + (rnd() - 0.5) * 8, { drag: 0.3, life: 4 + rnd() * 4, s0: R * 0.8, s1: R * 3, c: smoke, mode: M_SOFT, top: true });
    }
    this.shake = Math.min(1, this.shake + 0.25 * big);
    this.onSound?.(kind === 2 ? "mine" : kind === 3 ? "cannonHit" : "boom", x, y, big);
  }

  private part(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    o: { vz?: number; g?: number; drag?: number; life: number; s0: number; s1: number; c: number[]; mode: number; top?: boolean },
  ) {
    if (this.parts.length > 9000) return;
    this.parts.push({
      x,
      y,
      z,
      vx,
      vy,
      vz: o.vz ?? 0,
      g: o.g ?? 0,
      drag: o.drag ?? 0,
      t: 0,
      life: o.life,
      s0: o.s0,
      s1: o.s1,
      r: o.c[0],
      gC: o.c[1],
      b: o.c[2],
      a: o.c[3],
      mode: o.mode,
      top: o.top ?? false,
    });
  }

  // ============================================================ Zeichnen

  private push(x: number, y: number, w: number, h: number, u0: number, v0: number, u1: number, v1: number, r: number, g: number, b: number, a: number, angle: number, mode: number) {
    if (this.n >= MAX_INST) return;
    const d = this.inst;
    const o = this.n * STRIDE;
    d[o] = x;
    d[o + 1] = y;
    d[o + 2] = w;
    d[o + 3] = h;
    d[o + 4] = u0;
    d[o + 5] = v0;
    d[o + 6] = u1;
    d[o + 7] = v1;
    d[o + 8] = r;
    d[o + 9] = g;
    d[o + 10] = b;
    d[o + 11] = a;
    d[o + 12] = angle;
    d[o + 13] = mode;
    this.n++;
  }

  private sprite(f: Frame, x: number, y: number, angle: number, scale: number, r = 1, g = 1, b = 1, a = 1) {
    const W = this.atlas.canvas.width;
    const H = this.atlas.canvas.height;
    this.push(x, y, f.ww * scale, f.wh * scale, f.x / W, f.y / H, (f.x + f.w) / W, (f.y + f.h) / H, r, g, b, a, angle, M_SPRITE);
  }

  private shape(x: number, y: number, size: number, mode: number, r: number, g: number, b: number, a: number, angle = 0, h = size) {
    this.push(x, y, size, h, 0, 0, 0, 0, r, g, b, a, angle, mode);
  }

  render(b: Battle, cam: Camera, dpr: number, simDt: number) {
    const gl = this.gl;
    this.time += simDt;
    const w = this.canvas.width;
    const h = this.canvas.height;
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(this.loc.u_cam, cam.x, cam.y);
    gl.uniform1f(this.loc.u_zoom, cam.zoom * dpr);
    gl.uniform2f(this.loc.u_view, w, h);
    this.n = 0;

    // Sichtbereich (etwas größer), damit nur Sichtbares gezeichnet wird
    const vx0 = cam.x - 40;
    const vy0 = cam.y - 40;
    const vx1 = cam.x + cam.viewW / cam.zoom + 40;
    const vy1 = cam.y + cam.viewH / cam.zoom + 40;
    const inView = (x: number, y: number) => x > vx0 && x < vx1 && y > vy0 && y < vy1;

    // --- Partikel unter den Einheiten (Staub, Blutstropfen)
    this.drawParticles(false, inView);

    // --- eigene Minen (nur für die eigene Seite sichtbar)
    if (cam.zoom > 0.9) {
      for (const m of b.terrain.mines) {
        if (!m.alive || m.side !== this.viewerSide || !inView(m.x, m.y)) continue;
        this.sprite(this.atlas.frames[m.side].mine, m.x, m.y, 0, 1, 1, 1, 1, 0.8);
      }
    }

    // --- Einheiten
    const style = this.style;
    const scale = style === "deutlich" ? 1.35 : 1;
    const pass = (types: (t: number) => boolean) => {
      for (let i = 0; i < b.n; i++) {
        if (!b.alive[i] || !types(b.type[i])) continue;
        const x = b.x[i];
        const y = b.y[i];
        if (!inView(x, y)) continue;
        this.drawUnit(b, i, x, y, scale, style);
      }
    };
    pass((t) => t === UNIT_GUN);
    pass((t) => t !== UNIT_GUN && t !== UNIT_TANK && t !== UNIT_MAGE);
    pass((t) => t === UNIT_TANK);

    // --- Brände
    for (const f of b.fires) {
      if (!inView(f.x, f.y)) continue;
      for (let k = 0; k < 3; k++) {
        const fx = f.x + Math.sin(this.time * 7 + k * 2.1 + f.x) * f.r * 0.6;
        const fy = f.y + Math.cos(this.time * 5 + k * 1.7 + f.y) * f.r * 0.4;
        this.shape(fx, fy, f.r * (1 + 0.3 * Math.sin(this.time * 11 + k)), M_GLOW, 1, 0.5, 0.12, 0.9);
      }
      if (Math.random() < simDt * 4) this.part(f.x, f.y, 3, 3, -6, { life: 3, s0: 4, s1: 14, c: [0.1, 0.09, 0.08, 0.4], mode: M_SOFT, top: true });
    }

    // --- Leuchtspuren
    for (const t of this.tracers) {
      const k = t.t / t.life;
      const len = Math.hypot(t.x2 - t.x1, t.y2 - t.y1) || 1;
      const a = Math.atan2(t.y2 - t.y1, t.x2 - t.x1);
      const hx = t.x1 + (t.x2 - t.x1) * k;
      const hy = t.y1 + (t.y2 - t.y1) * k;
      if (t.kind === UNIT_MAGE) {
        const c = MAGE_COLOR[t.side];
        this.shape(hx, hy, 8, M_GLOW, c[0], c[1], c[2], 1);
        const tail = Math.min(40, len * k);
        this.shape(hx - (Math.cos(a) * tail) / 2, hy - (Math.sin(a) * tail) / 2, tail, M_BAR, c[0], c[1], c[2], 0.8, a, 2);
      } else {
        const tail = Math.min(t.kind === UNIT_RIFLE ? 10 : 16, len * k);
        const alpha = t.kind === UNIT_MG || t.kind === UNIT_TANK ? 0.85 : t.kind === UNIT_AT ? 1 : 0.5;
        this.shape(hx - (Math.cos(a) * tail) / 2, hy - (Math.sin(a) * tail) / 2, tail, M_BAR, 1, 0.88, 0.55, alpha, a, t.kind === UNIT_AT ? 1.4 : 0.8);
      }
    }

    // --- Granaten im Flug (Bogen mit Schatten am Boden)
    for (const s of b.shells) {
      const k = Math.min(1, (b.time - s.t0) / s.dur);
      const gx = s.sx + (s.tx - s.sx) * k;
      const gy = s.sy + (s.ty - s.sy) * k;
      const dist = Math.hypot(s.tx - s.sx, s.ty - s.sy);
      const hgt = s.direct ? 2 : 4 * dist * 0.18 * k * (1 - k);
      const a = Math.atan2(s.ty - s.sy - (s.direct ? 0 : dist * 0.72 * (1 - 2 * k)), s.tx - s.sx);
      if (!s.direct && b.time - s.t0 > s.dur - 1.3 && !this.whistled.has(s)) {
        this.whistled.add(s);
        this.onSound?.("whistle", s.tx, s.ty);
      }
      if (!inView(gx, gy - hgt)) continue;
      if (s.kind === "grenade") {
        // Stielhandgranate: kleiner, sich überschlagender Punkt
        this.shape(gx, gy, 1.6, M_SOFT, 0, 0, 0, 0.35);
        this.shape(gx, gy - hgt, 1.8, M_BAR, 0.22, 0.2, 0.16, 1, b.time * 14, 0.9);
        continue;
      }
      this.shape(gx, gy, 4 + hgt * 0.02, M_SOFT, 0, 0, 0, 0.4);
      if (!s.direct) this.shape(gx, gy - hgt, 7, M_GLOW, 1, 0.8, 0.5, 0.25);
      this.sprite(this.atlas.frames[s.side].shell, gx, gy - hgt, a, 1.6 + hgt * 0.004);
    }

    // --- Partikel über den Einheiten (Explosionen, Rauch, Feuer)
    this.drawParticles(true, inView);

    // --- Nebelwände
    this.drawSmoke(b, inView);

    // --- Magier schweben über allem
    for (let s = 0; s < 2; s++) {
      for (const i of b.unitsOf(s, UNIT_MAGE)) {
        if (!b.alive[i] || !inView(b.x[i], b.y[i])) continue;
        this.drawUnit(b, i, b.x[i], b.y[i], scale, style);
      }
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.inst.subarray(0, this.n * STRIDE));
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.n);

    // Effekte altern lassen
    if (simDt > 0) this.step(simDt);
    this.shake = Math.max(0, this.shake - simDt * 2.5);
  }

  /** Nebelwolken: mehrere weiche Schwaden je Wolke, die langsam wabern und im Wind treiben */
  private drawSmoke(b: Battle, inView: (x: number, y: number) => boolean) {
    for (const sm of b.smokes) {
      if (!inView(sm.x, sm.y) && !inView(sm.x + sm.r, sm.y) && !inView(sm.x - sm.r, sm.y)) continue;
      const age = b.time - sm.t0;
      const fade = Math.min(1, age / 3) * Math.min(1, (sm.until - b.time) / 10);
      if (fade <= 0) continue;
      const grow = 0.6 + 0.4 * Math.min(1, age / 4);
      const seed = sm.t0 * 13.7 + sm.y;
      for (let k = 0; k < 6; k++) {
        const ph = seed + k * 2.39;
        const ox = Math.cos(ph) * sm.r * 0.45 + Math.sin(this.time * 0.3 + ph) * 4;
        const oy = Math.sin(ph * 1.3) * sm.r * 0.35 + Math.cos(this.time * 0.25 + ph) * 3;
        const size = sm.r * grow * (1.1 + 0.25 * Math.sin(ph * 3.1));
        const g = 0.84 + 0.06 * Math.sin(ph * 5);
        if (sm.gas) this.shape(sm.x + ox, sm.y + oy, size * 2, M_SOFT, 0.72 * g, 0.8 * g, 0.3 * g, 0.26 * fade);
        else this.shape(sm.x + ox, sm.y + oy, size * 2, M_SOFT, g, g, g * 0.97, 0.32 * fade);
      }
    }
  }

  private drawUnit(b: Battle, i: number, x: number, y: number, scale: number, style: RenderStyle) {
    const side = b.side[i];
    const type = b.type[i];
    const c = b.companies[b.comp[i]];
    const sel = c.id === this.selected;
    const frames = this.atlas.frames[side];
    const tint = SIDE_TINT[side];
    const ang = b.ang[i];

    if (style === "punkte") {
      const size = type === UNIT_TANK ? 12 : type === UNIT_GUN ? 9 : type === UNIT_MG ? 5 : type === UNIT_MAGE ? 5 : 3;
      const f = sel ? 1.25 : 1;
      this.shape(x, y, size + 1.2, M_DOT, 0.05, 0.05, 0.05, 0.8);
      this.shape(x, y, size, M_DOT, Math.min(1, tint[0] * f), Math.min(1, tint[1] * f), Math.min(1, tint[2] * f), 1);
      if (type === UNIT_MAGE) this.shape(x, y, 14, M_GLOW, MAGE_COLOR[side][0], MAGE_COLOR[side][1], MAGE_COLOR[side][2], 0.6);
      return;
    }

    // Unterlage: im „Deutlich“-Stil ein farbiger Ring, sonst nur bei Auswahl
    const radius = STATS[type].radius;
    if (style === "deutlich" && type !== UNIT_MAGE) {
      // kleiner Farbpunkt unter der Figur statt großem Ring: bleibt auch in dichten Reihen lesbar
      if (type === UNIT_TANK || type === UNIT_GUN) this.shape(x, y, radius * 2.4, M_RING, tint[0], tint[1], tint[2], sel ? 1 : 0.7);
      else this.shape(x, y, radius * 1.9 * scale, M_DOT, tint[0], tint[1], tint[2], sel ? 0.9 : 0.55);
    } else if (sel) {
      this.shape(x, y, radius * 2.8, M_RING, 1, 1, 1, 0.9);
    }

    let frame: FrameName = "stand";
    let s = scale;
    let bright = sel ? 1.3 : 1;
    if (type === UNIT_TANK) {
      frame = "tank";
      s = 1;
      this.shape(x + 2, y + 3, 26, M_SOFT, 0, 0, 0, 0.35, ang, 18);
      if (b.moving[i] && Math.random() < 0.06) {
        this.part(x - Math.cos(ang) * 12, y - Math.sin(ang) * 12, 2, -Math.cos(ang) * 5 + 2, -Math.sin(ang) * 5 - 2, { life: 1.6, s0: 3, s1: 9, c: [0.2, 0.2, 0.2, 0.35], mode: M_SOFT, top: true });
      }
    } else if (type === UNIT_GUN) {
      frame = "gun";
      s = 1;
    } else if (type === UNIT_MG) frame = "mg";
    else if (type === UNIT_AT) frame = "at";
    else if (type === UNIT_FLAME) frame = "flame";
    else if (type === UNIT_MAGE) {
      frame = "mage";
      const bob = Math.sin(this.time * 3 + i) * 2;
      const mc = MAGE_COLOR[side];
      this.shape(x + 3, y + 10, 6, M_SOFT, 0, 0, 0, 0.3);
      this.shape(x, y + bob, 20, M_GLOW, mc[0], mc[1], mc[2], 0.55);
      y += bob;
    } else {
      // Schützen und Stoßtrupps: Haltung je nach Lage
      const kind = b.terrain.kindAt(x, y);
      const storm = type === UNIT_STORM;
      if (storm) frame = "storm";
      if (b.moving[i]) frame = Math.floor(this.time * 6 + i) % 2 ? (storm ? "stormRun1" : "run1") : storm ? "stormRun2" : "run2";
      else if (kind === K_TRENCH || kind === K_BUNKER) frame = "trench";
      else if (b.suppress[i] > 0.4 || b.pinned[i] || b.terrain.coverAt(x, y) > 0.3) frame = "prone";
      if (c.order === "rout") bright *= 0.75 + 0.25 * Math.sin(this.time * 9 + i);
    }
    if (type !== UNIT_TANK && type !== UNIT_GUN && type !== UNIT_MAGE && b.suppress[i] > 0.6) bright *= 0.85;
    this.sprite(frames[frame], x, y, ang, s, bright, bright, bright, 1);
  }

  private drawParticles(top: boolean, inView: (x: number, y: number) => boolean) {
    for (const p of this.parts) {
      if (p.top !== top) continue;
      const k = p.t / p.life;
      const x = p.x;
      const y = p.y - p.z;
      if (!inView(x, y)) continue;
      const size = p.s0 + (p.s1 - p.s0) * k;
      const fade = p.mode === M_GLOW ? 1 - k : 1 - k * k;
      this.shape(x, y, size, p.mode, p.r, p.gC, p.b, p.a * fade);
    }
  }

  private step(dt: number) {
    for (const p of this.parts) {
      p.t += dt;
      const damp = Math.max(0, 1 - p.drag * dt);
      p.vx *= damp;
      p.vy *= damp;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vz -= p.g * dt;
      p.z = Math.max(0, p.z + p.vz * dt);
    }
    this.parts = this.parts.filter((p) => p.t < p.life);
    for (const t of this.tracers) t.t += dt;
    this.tracers = this.tracers.filter((t) => t.t < t.life);
  }
}

function shader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}
