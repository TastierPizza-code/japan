// Pixel-Figuren für die Schlacht, zur Laufzeit in einen Textur-Atlas gezeichnet.
// Alle Figuren schauen nach rechts (+x); gedreht wird beim Zeichnen.

export interface Frame {
  /** Position im Atlas (Pixel) */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Größe in Welteinheiten */
  ww: number;
  wh: number;
}

interface Palette {
  uni: string;
  uniDark: string;
  uniLight: string;
  helmet: string;
  helmetHi: string;
  accent: string;
  skin: string;
  gear: string;
  wood: string;
  metal: string;
  metalHi: string;
  paint: string;
  paintDark: string;
}

// Seite 0: feldgrau mit hellblauer Kennung. Seite 1: khaki mit roter Kennung.
const PALETTES: Palette[] = [
  {
    uni: "#6f86a6",
    uniDark: "#48586e",
    uniLight: "#93a9c6",
    helmet: "#4d5a66",
    helmetHi: "#8494a3",
    accent: "#a9d6ff",
    skin: "#d8ab86",
    gear: "#5b4632",
    wood: "#6e4b2a",
    metal: "#33373b",
    metalHi: "#6a7075",
    paint: "#65706a",
    paintDark: "#434b46",
  },
  {
    uni: "#a8845a",
    uniDark: "#77593a",
    uniLight: "#c7a276",
    helmet: "#6f6450",
    helmetHi: "#a2967a",
    accent: "#ff6a4a",
    skin: "#d8ab86",
    gear: "#5b4632",
    wood: "#6e4b2a",
    metal: "#33373b",
    metalHi: "#6a7075",
    paint: "#7a6e4e",
    paintDark: "#544b33",
  },
];

export type FrameName =
  | "stand"
  | "run1"
  | "run2"
  | "prone"
  | "trench"
  | "dead1"
  | "dead2"
  | "mg"
  | "at"
  | "flame"
  | "storm"
  | "stormRun1"
  | "stormRun2"
  | "mage"
  | "tank"
  | "gun"
  | "tankWreck"
  | "gunWreck"
  | "shell"
  | "mine";

export class SpriteAtlas {
  canvas: HTMLCanvasElement;
  /** frames[side][name] */
  frames: Record<FrameName, Frame>[] = [];
  private ctx: CanvasRenderingContext2D;
  private cx = 0;
  private cy = 0;
  private rowH = 0;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = 512;
    this.canvas.height = 256;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    for (let s = 0; s < 2; s++) this.frames.push(this.drawSide(PALETTES[s], s));
    // Dunkler Umriss um jede Figur: hebt sie vom Boden ab
    for (const side of this.frames) for (const f of Object.values(side)) this.outline(f);
  }

  private outline(f: Frame) {
    const img = this.ctx.getImageData(f.x, f.y, f.w, f.h);
    const d = img.data;
    const src = new Uint8ClampedArray(d);
    const a = (x: number, y: number) => (x < 0 || y < 0 || x >= f.w || y >= f.h ? 0 : src[(y * f.w + x) * 4 + 3]);
    for (let y = 0; y < f.h; y++) {
      for (let x = 0; x < f.w; x++) {
        const k = (y * f.w + x) * 4;
        if (src[k + 3] > 0) continue;
        if (a(x + 1, y) || a(x - 1, y) || a(x, y + 1) || a(x, y - 1)) {
          d[k] = 16;
          d[k + 1] = 15;
          d[k + 2] = 12;
          d[k + 3] = 200;
        }
      }
    }
    this.ctx.putImageData(img, f.x, f.y);
  }

  private alloc(w: number, h: number, ww: number, wh: number): Frame {
    if (this.cx + w + 1 > this.canvas.width) {
      this.cx = 0;
      this.cy += this.rowH + 1;
      this.rowH = 0;
    }
    const f = { x: this.cx, y: this.cy, w, h, ww, wh };
    this.cx += w + 1;
    this.rowH = Math.max(this.rowH, h);
    return f;
  }

  private drawSide(p: Palette, side: number): Record<FrameName, Frame> {
    const S = 0.42; // Welteinheiten pro Pixel für Fußtruppen (etwas größer als echt, damit man sie erkennt)
    const out = {} as Record<FrameName, Frame>;
    const make = (name: FrameName, w: number, h: number, scale: number, draw: (px: Px) => void) => {
      const f = this.alloc(w, h, w * scale, h * scale);
      draw(new Px(this.ctx, f.x, f.y));
      out[name] = f;
    };
    // --- Soldat, stehend/kniend im Anschlag
    make("stand", 16, 16, S, (d) => {
      soldierBody(d, p, 0);
      rifle(d, p, 8, 10, 15);
    });
    make("run1", 16, 16, S, (d) => {
      d.px(2, 6, p.uniDark);
      d.px(3, 6, p.uniDark);
      d.px(4, 10, p.gear);
      soldierBody(d, p, 0);
      rifleDiag(d, p);
    });
    make("run2", 16, 16, S, (d) => {
      d.px(4, 6, p.gear);
      d.px(2, 10, p.uniDark);
      d.px(3, 10, p.uniDark);
      soldierBody(d, p, 0);
      rifleDiag(d, p);
    });
    // --- liegend in Deckung
    make("prone", 16, 16, S, (d) => {
      d.rect(1, 6, 3, 1, p.uniDark); // Beine
      d.rect(1, 9, 3, 1, p.uniDark);
      d.rect(3, 6, 6, 4, p.uni);
      d.rect(3, 6, 6, 1, p.uniLight);
      d.rect(4, 7, 2, 2, p.gear);
      helmet(d, p, 10, 7.5, 2.2);
      rifle(d, p, 10, 9, 15);
    });
    // --- im Graben: nur Helm und Schultern über der Brustwehr
    make("trench", 16, 16, S, (d) => {
      d.rect(6, 5, 3, 6, p.uniDark);
      helmet(d, p, 8.5, 8, 2.4);
      rifle(d, p, 9, 10, 15);
    });
    // --- Gefallene
    make("dead1", 16, 16, S, (d) => {
      d.rect(3, 7, 7, 3, p.uniDark);
      d.rect(2, 6, 2, 1, p.uniDark);
      d.rect(2, 10, 2, 1, p.uniDark);
      d.rect(9, 5, 2, 2, p.uniDark);
      helmet(d, p, 12, 9, 1.8);
      d.line(5, 13, 13, 12, p.wood);
    });
    make("dead2", 16, 16, S, (d) => {
      d.rect(4, 6, 6, 4, p.uniDark);
      d.rect(3, 4, 1, 3, p.uniDark);
      d.rect(9, 10, 3, 1, p.uniDark);
      d.px(11, 7, p.skin);
      d.px(12, 7, p.skin);
      helmet(d, p, 3, 11, 1.8);
    });
    // --- MG mit zwei Mann Bedienung
    make("mg", 24, 24, S, (d) => {
      d.line(9, 12, 6, 7, p.metal); // Lafette
      d.line(9, 12, 6, 17, p.metal);
      d.line(9, 12, 13, 12, p.metal);
      d.rect(9, 10, 8, 4, p.metal); // Kühlmantel
      d.rect(9, 10, 8, 1, p.metalHi);
      d.rect(17, 11, 5, 2, p.metal); // Lauf
      d.rect(6, 15, 3, 3, p.gear); // Munitionskasten
      // Schütze liegend dahinter
      d.rect(1, 10, 6, 4, p.uni);
      helmet(d, p, 7, 12, 2);
      // Ladeschütze daneben
      d.rect(3, 17, 5, 3, p.uni);
      helmet(d, p, 8, 18.5, 1.8);
      d.px(1, 12, p.accent);
    });
    // --- Tankgewehr: sehr langer Lauf, Zweibein, zwei Mann
    make("at", 22, 16, S, (d) => {
      d.rect(1, 6, 7, 4, p.uni);
      helmet(d, p, 8, 8, 2);
      d.line(8, 9, 21, 9, p.metal);
      d.line(9, 9, 20, 9, p.metalHi);
      d.line(16, 9, 15, 12, p.metal);
      d.line(16, 9, 17, 12, p.metal);
      d.rect(2, 11, 5, 3, p.uniDark);
      helmet(d, p, 7, 12.5, 1.7);
      d.px(1, 8, p.accent);
    });
    // --- Flammenwerfer: Tanks auf dem Rücken
    make("flame", 16, 16, S, (d) => {
      d.rect(1, 5, 3, 3, "#8a8f93");
      d.rect(1, 9, 3, 3, "#8a8f93");
      d.px(1, 5, "#b9bec2");
      d.px(1, 9, "#b9bec2");
      soldierBody(d, p, 1);
      d.line(8, 10, 14, 9, p.metal);
      d.px(15, 9, "#ff9a3a");
    });
    // --- Stoßtrupp: kein Tornister, Karabiner, Sandsäcke voller Stielhandgranaten
    const stormTrooper = (d: Px, legs: number) => {
      if (legs === 1) {
        d.px(2, 6, p.uniDark);
        d.px(3, 6, p.uniDark);
      } else if (legs === 2) {
        d.px(2, 10, p.uniDark);
        d.px(3, 10, p.uniDark);
      }
      soldierBody(d, p, 1);
      // Granatsäcke über der Brust
      d.rect(5, 5, 2, 2, p.gear);
      d.rect(5, 9, 2, 2, p.gear);
      // Stielhandgranaten am Koppel
      d.px(4, 4, p.wood);
      d.px(4, 12, p.wood);
      d.px(3, 4, p.metal);
      d.px(3, 12, p.metal);
      if (legs === 0) d.line(9, 10, 13, 10, p.metal);
      else d.line(7, 11, 11, 6, p.metal);
    };
    make("storm", 16, 16, S, (d) => stormTrooper(d, 0));
    make("stormRun1", 16, 16, S, (d) => stormTrooper(d, 1));
    make("stormRun2", 16, 16, S, (d) => stormTrooper(d, 2));
    // --- Magier mit Umhang
    make("mage", 16, 16, S * 1.1, (d) => {
      d.rect(2, 4, 5, 9, p.accent);
      d.rect(1, 6, 1, 5, p.accent);
      d.rect(4, 5, 5, 7, p.uniDark);
      d.circle(9, 8.5, 2.2, p.skin);
      d.rect(8, 6, 3, 2, "#e8d9a8");
      d.line(9, 11, 14, 12, p.wood);
      d.px(15, 12, "#dffcff");
    });
    // --- Panzer (Rhombus-Typ), von oben
    make("tank", 48, 30, 0.46, (d) => {
      // Ketten
      for (const ty of [2, 22]) {
        d.rect(1, ty, 46, 6, "#2a2a26");
        for (let x = 2; x < 46; x += 3) d.rect(x, ty, 1, 6, "#44443d");
      }
      // Wanne
      d.rect(5, 8, 38, 14, p.paint);
      d.rect(5, 8, 38, 2, p.paintDark);
      d.rect(5, 20, 38, 2, p.paintDark);
      // Tarnflecken
      d.rect(10, 10, 6, 4, p.paintDark);
      d.rect(26, 15, 7, 4, p.paintDark);
      d.rect(34, 10, 4, 3, "#8a8263");
      // Seitenerker mit Kanonen
      d.rect(18, 0, 10, 4, p.paint);
      d.rect(18, 26, 10, 4, p.paint);
      d.rect(26, 0, 6, 1, p.metal);
      d.rect(26, 29, 6, 1, p.metal);
      // Fahrerkabine vorn
      d.rect(36, 11, 6, 8, p.paintDark);
      d.rect(41, 13, 2, 4, "#1a1a18");
      // Auspuff und Kennung
      d.rect(8, 14, 3, 2, "#1d1d1b");
      d.circle(22, 15, 2.5, p.accent);
    });
    // --- Feldgeschütz mit Schild, Rädern und Bedienung
    make("gun", 32, 26, 0.44, (d) => {
      d.line(3, 9, 14, 13, p.wood); // Lafettenholme
      d.line(3, 17, 14, 13, p.wood);
      d.rect(12, 3, 4, 5, "#2b2a26"); // Räder
      d.rect(12, 18, 4, 5, "#2b2a26");
      d.rect(15, 7, 3, 12, p.paintDark); // Schild
      d.rect(15, 7, 1, 12, p.paint);
      d.rect(14, 11, 16, 4, p.metal); // Rohr
      d.rect(14, 11, 16, 1, p.metalHi);
      d.rect(29, 11, 2, 4, p.metal);
      // Bedienung
      for (const [x, y] of [
        [6, 4],
        [5, 20],
        [9, 13],
      ]) {
        d.rect(x - 2, y - 1, 3, 3, p.uni);
        helmet(d, p, x + 1, y + 0.5, 1.5);
      }
      d.rect(1, 12, 3, 3, p.gear);
    });
    make("tankWreck", 48, 30, 0.46, (d) => {
      for (const ty of [3, 21]) d.rect(2, ty, 44, 6, "#1d1c1a");
      d.rect(5, 8, 38, 14, "#2e2c28");
      d.rect(12, 10, 10, 8, "#1a1918");
      d.rect(28, 12, 8, 6, "#4a3525");
      d.rect(18, 1, 8, 3, "#2e2c28");
    });
    make("gunWreck", 32, 26, 0.44, (d) => {
      d.line(3, 9, 14, 14, "#3a2a1c");
      d.rect(12, 4, 4, 5, "#1d1c1a");
      d.rect(15, 8, 3, 10, "#2a2926");
      d.line(14, 13, 27, 17, "#2a2926");
    });
    make("shell", 6, 3, 0.8, (d) => {
      d.rect(0, 0, 5, 3, "#3b3a36");
      d.rect(5, 1, 1, 1, "#6b6a60");
      d.rect(1, 0, 3, 1, "#77756a");
    });
    make("mine", 5, 5, 0.9, (d) => {
      d.circle(2.5, 2.5, 2.2, "#3a3a34");
      d.px(2, 2, p.accent);
    });
    void side;
    return out;
  }
}

/** Kleine Zeichenhilfe mit Versatz im Atlas */
class Px {
  private ctx: CanvasRenderingContext2D;
  private ox: number;
  private oy: number;
  constructor(ctx: CanvasRenderingContext2D, ox: number, oy: number) {
    this.ctx = ctx;
    this.ox = ox;
    this.oy = oy;
  }
  px(x: number, y: number, c: string) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(this.ox + Math.floor(x), this.oy + Math.floor(y), 1, 1);
  }
  rect(x: number, y: number, w: number, h: number, c: string) {
    this.ctx.fillStyle = c;
    this.ctx.fillRect(this.ox + x, this.oy + y, w, h);
  }
  line(x0: number, y0: number, x1: number, y1: number, c: string) {
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
    for (let i = 0; i <= n; i++) this.px(x0 + ((x1 - x0) * i) / n, y0 + ((y1 - y0) * i) / n, c);
  }
  circle(cx: number, cy: number, r: number, c: string) {
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        if ((x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2 <= r * r) this.px(x, y, c);
      }
    }
  }
}

function helmet(d: Px, p: Palette, x: number, y: number, r: number) {
  d.circle(x, y, r, p.helmet);
  d.px(x - 0.5, y - r * 0.6, p.helmetHi);
  d.px(x + 0.3, y - r * 0.6, p.helmetHi);
}

function soldierBody(d: Px, p: Palette, variant: number) {
  // Tornister
  if (variant === 0) d.rect(3, 6, 3, 4, p.gear);
  // Schultern und Rumpf
  d.rect(5, 4, 4, 8, p.uni);
  d.rect(5, 4, 4, 1, p.uniLight);
  d.rect(5, 11, 4, 1, p.uniDark);
  d.rect(4, 5, 1, 6, p.uniDark);
  // Kennung auf den Schultern (Seite gut erkennbar)
  d.px(6, 4, p.accent);
  d.px(6, 11, p.accent);
  // Arme nach vorn
  d.rect(9, 5, 2, 1, p.uni);
  d.rect(9, 10, 2, 1, p.uni);
  d.px(11, 5, p.skin);
  d.px(11, 10, p.skin);
  helmet(d, p, 8, 8, 2.6);
}

function rifle(d: Px, p: Palette, x0: number, y: number, x1: number) {
  d.line(x0, y, x1 - 2, y, p.wood);
  d.line(x1 - 2, y, x1, y, p.metal);
}

function rifleDiag(d: Px, p: Palette) {
  d.line(6, 12, 12, 4, p.wood);
  d.px(13, 3, p.metal);
}
