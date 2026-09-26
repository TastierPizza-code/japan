import type { Battle } from "../sim/battle.ts";
import { UNIT_MAGE, UNIT_MG } from "../sim/config.ts";
import type { Camera } from "./camera.ts";

const VS = `
attribute vec2 a_pos;
attribute float a_size;
attribute vec4 a_color;
attribute float a_kind;
uniform vec2 u_cam;
uniform float u_zoom;
uniform vec2 u_view;
varying vec4 v_color;
varying float v_kind;
varying float v_size;
void main() {
  vec2 p = (a_pos - u_cam) * u_zoom;
  gl_Position = vec4(p.x / u_view.x * 2.0 - 1.0, 1.0 - p.y / u_view.y * 2.0, 0.0, 1.0);
  float s = max(a_size * u_zoom, a_kind > 0.5 ? 3.0 : 1.6);
  gl_PointSize = s;
  v_size = s;
  v_color = a_color;
  v_kind = a_kind;
}`;

const FS = `
precision mediump float;
varying vec4 v_color;
varying float v_kind;
varying float v_size;
void main() {
  vec4 c = v_color;
  if (v_kind > 0.5) {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    c.a *= 1.0 - r * r;
  } else if (v_size > 5.0) {
    // dunkler Rand, damit einzelne Soldaten lesbar bleiben (Pixel-Look)
    vec2 pc = gl_PointCoord;
    float e = 1.2 / v_size;
    if (pc.x < e || pc.x > 1.0 - e || pc.y < e || pc.y > 1.0 - e) c.rgb *= 0.45;
    // "Kopf": hellerer Punkt oben
    if (pc.y < 0.4 && abs(pc.x - 0.5) < 0.2) c.rgb = mix(c.rgb, vec3(0.93, 0.82, 0.68), 0.6);
  }
  gl_FragColor = vec4(c.rgb * c.a, c.a);
}`;

const STRIDE = 8; // x, y, size, r, g, b, a, kind

interface Fx {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  t: number;
  life: number;
  kind: number; // 0 Kugel, 1 MG, 2 Magie, 3 Mündungsfeuer, 4 Explosion, 5 Rauch, 6 Magie-Explosion
  side: number;
  r: number;
}

const SIDE_COLOR = [
  [0.55, 0.72, 0.95],
  [0.9, 0.5, 0.42],
];
const MG_COLOR = [
  [0.75, 0.88, 1.0],
  [1.0, 0.72, 0.55],
];
const MAGE_COLOR = [
  [0.45, 0.95, 1.0],
  [1.0, 0.5, 0.95],
];

export class GlRenderer {
  private gl: WebGLRenderingContext;
  private buf: WebGLBuffer;
  private data = new Float32Array(STRIDE * 40000);
  private loc: Record<string, WebGLUniformLocation | null> = {};
  private fx: Fx[] = [];
  selected = -1;
  private time = 0;

  private canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const gl = canvas.getContext("webgl", { premultipliedAlpha: true, antialias: false, alpha: true });
    if (!gl) throw new Error("WebGL wird nicht unterstützt");
    this.gl = gl;
    const prog = gl.createProgram()!;
    gl.attachShader(prog, shader(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, shader(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? "link");
    gl.useProgram(prog);
    this.buf = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    const attr = (name: string, size: number, offset: number) => {
      const l = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, gl.FLOAT, false, STRIDE * 4, offset * 4);
    };
    attr("a_pos", 2, 0);
    attr("a_size", 1, 2);
    attr("a_color", 4, 3);
    attr("a_kind", 1, 7);
    for (const u of ["u_cam", "u_zoom", "u_view"]) this.loc[u] = gl.getUniformLocation(prog, u);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /** Neue Schüsse und Explosionen aus der Simulation übernehmen. */
  ingest(b: Battle) {
    const s = b.events.shots;
    for (let i = 0; i < s.length; i += 6) {
      const [x1, y1, x2, y2, type, side] = [s[i], s[i + 1], s[i + 2], s[i + 3], s[i + 4], s[i + 5]];
      const dist = Math.hypot(x2 - x1, y2 - y1);
      const kind = type === UNIT_MAGE ? 2 : type === UNIT_MG ? 1 : 0;
      const speed = kind === 2 ? 350 : 900;
      this.fx.push({ x1, y1, x2, y2, t: 0, life: Math.max(0.05, dist / speed), kind, side, r: 0 });
      if (kind !== 2) this.fx.push({ x1, y1, x2: x1, y2: y1, t: 0, life: 0.08, kind: 3, side, r: 3 });
    }
    const bl = b.events.blasts;
    for (let i = 0; i < bl.length; i += 4) {
      const [x, y, r, kind] = [bl[i], bl[i + 1], bl[i + 2], bl[i + 3]];
      if (kind === 0) {
        this.fx.push({ x1: x, y1: y, x2: x, y2: y, t: 0, life: 0.45, kind: 4, side: 0, r: r * 3 });
        for (let k = 0; k < 4; k++) {
          const ox = (Math.random() - 0.5) * r * 1.5;
          const oy = (Math.random() - 0.5) * r * 1.5;
          this.fx.push({ x1: x + ox, y1: y + oy, x2: x + ox + 6, y2: y + oy - 14, t: 0, life: 2.5 + Math.random() * 2, kind: 5, side: 0, r: r * 2.2 });
        }
      } else {
        this.fx.push({ x1: x, y1: y, x2: x, y2: y, t: 0, life: 0.35, kind: 6, side: 0, r: r * 2.4 });
      }
    }
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

    const d = this.data;
    let n = 0;
    const push = (x: number, y: number, size: number, r: number, g: number, bl: number, a: number, kind: number) => {
      if (n >= d.length / STRIDE) return;
      const o = n * STRIDE;
      d[o] = x;
      d[o + 1] = y;
      d[o + 2] = size;
      d[o + 3] = r;
      d[o + 4] = g;
      d[o + 5] = bl;
      d[o + 6] = a;
      d[o + 7] = kind;
      n++;
    };

    // --- Rauch unter den Einheiten
    for (const f of this.fx) {
      if (f.kind !== 5) continue;
      const k = f.t / f.life;
      const g = 0.35 + k * 0.1;
      push(f.x1 + (f.x2 - f.x1) * k, f.y1 + (f.y2 - f.y1) * k, f.r * (0.6 + k), g, g, g * 0.95, 0.35 * (1 - k), 1);
    }

    // --- Soldaten
    for (let i = 0; i < b.n; i++) {
      if (!b.alive[i]) continue;
      const side = b.side[i];
      const type = b.type[i];
      const c = b.companies[b.comp[i]];
      let col = type === UNIT_MAGE ? MAGE_COLOR[side] : type === UNIT_MG ? MG_COLOR[side] : SIDE_COLOR[side];
      let shade = 1 - b.suppress[i] * 0.35;
      if (c.order === "rout") shade *= 0.7 + 0.3 * Math.sin(this.time * 8 + i);
      if (c.id === this.selected) {
        col = [col[0] * 0.5 + 0.5, col[1] * 0.5 + 0.5, col[2] * 0.5 + 0.5];
      }
      if (type === UNIT_MAGE) {
        const bob = Math.sin(this.time * 3 + i) * 2;
        push(b.x[i], b.y[i] + bob + 8, 5, 0, 0, 0, 0.35, 1); // Schatten
        push(b.x[i], b.y[i] + bob, 16, col[0], col[1], col[2], 0.35, 1); // Schimmer
        push(b.x[i], b.y[i] + bob, 5, col[0], col[1], col[2], 1, 0);
      } else {
        const size = type === UNIT_MG ? 5 : 2.4;
        push(b.x[i], b.y[i], size, col[0] * shade, col[1] * shade, col[2] * shade, 1, 0);
      }
    }

    // --- Mündungsfeuer, Explosionen, Magie
    for (const f of this.fx) {
      const k = f.t / f.life;
      if (f.kind === 3) push(f.x1, f.y1, f.r, 1, 0.9, 0.5, 1 - k, 1);
      else if (f.kind === 4) {
        push(f.x1, f.y1, f.r * (0.5 + k * 0.6), 1, 0.75 - k * 0.4, 0.3 - k * 0.2, 1 - k, 1);
        push(f.x1, f.y1, f.r * 0.35, 1, 1, 0.8, Math.max(0, 1 - k * 2.5), 1);
      } else if (f.kind === 6) {
        push(f.x1, f.y1, f.r * (0.5 + k), 0.7, 0.95, 1, 1 - k, 1);
      } else if (f.kind === 2) {
        const c = MAGE_COLOR[f.side];
        push(f.x1 + (f.x2 - f.x1) * k, f.y1 + (f.y2 - f.y1) * k, 7, c[0], c[1], c[2], 1, 1);
      }
    }
    const points = n;

    // --- Leuchtspuren als Linien
    for (const f of this.fx) {
      if (f.kind > 2) continue;
      const k = f.t / f.life;
      const len = Math.hypot(f.x2 - f.x1, f.y2 - f.y1) || 1;
      const tail = Math.min(1, (f.kind === 2 ? 40 : 14) / len);
      const k0 = Math.max(0, k - tail);
      const a = f.kind === 0 ? 0.45 : f.kind === 1 ? 0.8 : 1;
      const c = f.kind === 2 ? MAGE_COLOR[f.side] : [1, 0.88, 0.55];
      push(f.x1 + (f.x2 - f.x1) * k0, f.y1 + (f.y2 - f.y1) * k0, 1, c[0], c[1], c[2], 0, 0);
      push(f.x1 + (f.x2 - f.x1) * k, f.y1 + (f.y2 - f.y1) * k, 1, c[0], c[1], c[2], a, 0);
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, d.subarray(0, n * STRIDE));
    if (points > 0) gl.drawArrays(gl.POINTS, 0, points);
    if (n > points) gl.drawArrays(gl.LINES, points, n - points);

    // Effekte altern lassen
    if (simDt > 0) {
      for (const f of this.fx) f.t += simDt;
      this.fx = this.fx.filter((f) => f.t < f.life);
    }
  }
}

function shader(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}
