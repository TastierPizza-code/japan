import { WORLD_H, WORLD_W } from "../sim/config.ts";
import { Rng } from "../sim/rng.ts";
import type { Biome, Pt, Terrain } from "../sim/terrain.ts";
import type { SpriteAtlas } from "./sprites.ts";

interface Pal {
  ground: [number, number, number];
  dark: [number, number, number];
  light: [number, number, number];
  mud: [number, number, number];
  spoil: string;
  spoilDark: string;
  trench: string;
  floor: string;
  bag: string;
  road: string;
  water: string;
  waterHi: string;
  canopy: string;
  canopyHi: string;
  stump: string;
  wall: string;
  wallDark: string;
  rubble: string;
  craterRim: string;
  craterIn: string;
  craterWater: string | null;
  speck: string;
}

const PALETTES: Record<Biome, Pal> = {
  flandern: {
    ground: [92, 86, 64],
    dark: [66, 60, 45],
    light: [112, 106, 78],
    mud: [74, 64, 50],
    spoil: "#7b6f58",
    spoilDark: "#5a5040",
    trench: "#2b241b",
    floor: "#4d3e2a",
    bag: "#9a8a66",
    road: "#6f6552",
    water: "#3a4a4c",
    waterHi: "#566a6a",
    canopy: "#465532",
    canopyHi: "#5d6e3e",
    stump: "#4e3b28",
    wall: "#8f8272",
    wallDark: "#5c5247",
    rubble: "#6e655a",
    craterRim: "rgba(120,106,82,0.7)",
    craterIn: "rgba(46,39,30,0.95)",
    craterWater: "rgba(58,74,78,0.9)",
    speck: "rgba(40,36,28,0.35)",
  },
  dorf: {
    ground: [96, 94, 66],
    dark: [70, 66, 46],
    light: [118, 114, 82],
    mud: [80, 70, 54],
    spoil: "#7f735b",
    spoilDark: "#5d5342",
    trench: "#2b241b",
    floor: "#4d3e2a",
    bag: "#9a8a66",
    road: "#77705e",
    water: "#3a4a4c",
    waterHi: "#566a6a",
    canopy: "#4a5b34",
    canopyHi: "#627445",
    stump: "#4e3b28",
    wall: "#a0917e",
    wallDark: "#655a4d",
    rubble: "#7a7064",
    craterRim: "rgba(124,112,86,0.7)",
    craterIn: "rgba(48,41,32,0.95)",
    craterWater: "rgba(58,74,78,0.8)",
    speck: "rgba(40,36,28,0.3)",
  },
  champagne: {
    ground: [176, 170, 150],
    dark: [146, 140, 120],
    light: [200, 195, 178],
    mud: [150, 142, 124],
    spoil: "#e0dccd",
    spoilDark: "#b7b1a0",
    trench: "#5e584c",
    floor: "#8a8270",
    bag: "#c8bea2",
    road: "#cfc8b2",
    water: "#5e7076",
    waterHi: "#7d9096",
    canopy: "#6d7746",
    canopyHi: "#858f58",
    stump: "#6b5a44",
    wall: "#d2cabb",
    wallDark: "#9a9283",
    rubble: "#bab2a2",
    craterRim: "rgba(225,220,205,0.8)",
    craterIn: "rgba(120,114,100,0.9)",
    craterWater: null,
    speck: "rgba(110,104,90,0.25)",
  },
  argonnen: {
    ground: [74, 72, 50],
    dark: [52, 50, 34],
    light: [92, 90, 62],
    mud: [64, 56, 40],
    spoil: "#6b604a",
    spoilDark: "#4c4434",
    trench: "#261f17",
    floor: "#46392a",
    bag: "#8a7c5c",
    road: "#6a604a",
    water: "#34423f",
    waterHi: "#4e5f5a",
    canopy: "#35502c",
    canopyHi: "#4c6a37",
    stump: "#5a4430",
    wall: "#857866",
    wallDark: "#554b40",
    rubble: "#645b50",
    craterRim: "rgba(104,92,70,0.7)",
    craterIn: "rgba(40,34,26,0.95)",
    craterWater: "rgba(52,66,62,0.7)",
    speck: "rgba(30,28,20,0.35)",
  },
  winter: {
    ground: [214, 220, 226],
    dark: [184, 192, 202],
    light: [236, 240, 244],
    mud: [134, 128, 118],
    spoil: "#8d8478",
    spoilDark: "#6b6358",
    trench: "#4a4238",
    floor: "#6b5f50",
    bag: "#b4a98f",
    road: "#b5b3ae",
    water: "#aecbdc",
    waterHi: "#d8ebf5",
    canopy: "#2e4a3b",
    canopyHi: "#3f5f4c",
    stump: "#5a4636",
    wall: "#a49c90",
    wallDark: "#6d665c",
    rubble: "#8f887e",
    craterRim: "rgba(150,142,130,0.8)",
    craterIn: "rgba(92,84,74,0.9)",
    craterWater: null,
    speck: "rgba(150,160,175,0.35)",
  },
};

/**
 * Malt das Schlachtfeld einmal in ein Offscreen-Canvas (1 Pixel = 1 Welteinheit).
 * Trichter, Gefallene, Panzerspuren und Wracks werden später hineingestempelt.
 */
export class TerrainPainter {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private rng: Rng;
  private pal: Pal;
  private terrain: Terrain;
  private atlas: SpriteAtlas;

  constructor(terrain: Terrain, atlas: SpriteAtlas) {
    this.terrain = terrain;
    this.atlas = atlas;
    this.pal = PALETTES[terrain.biome];
    this.rng = new Rng(terrain.seed);
    this.canvas = document.createElement("canvas");
    this.canvas.width = WORLD_W;
    this.canvas.height = WORLD_H;
    this.ctx = this.canvas.getContext("2d")!;
    this.ctx.imageSmoothingEnabled = false;
    this.paintGround();
    this.paintRoads();
    this.paintCreeks();
    for (const c of terrain.craters) this.crater(c.x, c.y, c.r);
    this.paintWrecks();
    this.paintTrenches();
    this.paintBunkers();
    this.paintBuildings();
    this.paintWire();
    this.paintTrees();
  }

  // ------------------------------------------------------------ Boden

  private paintGround() {
    const t = this.terrain;
    const img = this.ctx.createImageData(WORLD_W, WORLD_H);
    const d = img.data;
    const p = this.pal;
    const seed = t.seed;
    // grobe Rauschgitter vorberechnen (schnell)
    const n1 = noiseGrid(seed, WORLD_W, WORLD_H, 64);
    const n2 = noiseGrid(seed + 7, WORLD_W, WORLD_H, 16);
    const hgt = noiseGrid(seed + 13, WORLD_W, WORLD_H, 180);
    const rnd = new Rng(seed + 3);
    const winter = t.biome === "winter";
    for (let y = 0; y < WORLD_H; y++) {
      // Niemandsland ist zerwühlt: Anteil „Schlamm“
      for (let x = 0; x < WORLD_W; x++) {
        const k = (y * WORLD_W + x) * 4;
        const a = n1(x, y);
        const b = n2(x, y);
        // Hangschattierung aus Höhenrauschen
        const shade = (hgt(x + 3, y + 3) - hgt(x, y)) * 60;
        const nml = y > t.wireY(1, x) - 30 && y < t.wireY(0, x) + 30;
        const churn = nml ? 0.55 + a * 0.45 : a * 0.25;
        const mix = Math.min(1, Math.max(0, b * 0.8 + (a - 0.5) * 0.6));
        let r = p.dark[0] + (p.light[0] - p.dark[0]) * mix;
        let g = p.dark[1] + (p.light[1] - p.dark[1]) * mix;
        let bl = p.dark[2] + (p.light[2] - p.dark[2]) * mix;
        const m = winter ? churn * 0.55 : churn * 0.6;
        r = r * (1 - m) + p.mud[0] * m;
        g = g * (1 - m) + p.mud[1] * m;
        bl = bl * (1 - m) + p.mud[2] * m;
        const grain = (rnd.next() - 0.5) * 10;
        d[k] = r + shade + grain;
        d[k + 1] = g + shade + grain;
        d[k + 2] = bl + shade + grain * 0.8;
        d[k + 3] = 255;
      }
    }
    this.ctx.putImageData(img, 0, 0);
    // Grasbüschel / Steinchen / Schneeglitzern
    const ctx = this.ctx;
    ctx.fillStyle = p.speck;
    for (let i = 0; i < 26000; i++) {
      const x = rnd.next() * WORLD_W;
      const y = rnd.next() * WORLD_H;
      ctx.fillRect(x | 0, y | 0, 1 + (rnd.next() < 0.3 ? 1 : 0), 1);
    }
  }

  private paintRoads() {
    const ctx = this.ctx;
    for (const r of this.terrain.roads) {
      if (r.sunken) {
        stroke(ctx, r.pts, r.width + 8, this.pal.spoilDark);
        stroke(ctx, r.pts, r.width, shadeHex(this.pal.road, -0.25));
      } else {
        stroke(ctx, r.pts, r.width + 2, shadeHex(this.pal.road, -0.15));
        stroke(ctx, r.pts, r.width, this.pal.road);
        // Fahrspuren
        ctx.setLineDash([6, 5]);
        stroke(ctx, offset(r.pts, -2.5), 1, shadeHex(this.pal.road, -0.2));
        stroke(ctx, offset(r.pts, 2.5), 1, shadeHex(this.pal.road, -0.2));
        ctx.setLineDash([]);
      }
    }
  }

  private paintCreeks() {
    const ctx = this.ctx;
    for (const c of this.terrain.creeks) {
      stroke(ctx, c.pts, c.width + 5, this.pal.spoilDark);
      stroke(ctx, c.pts, c.width, this.pal.water);
      stroke(ctx, offset(c.pts, -c.width * 0.2), 1.5, this.pal.waterHi);
    }
  }

  private paintTrenches() {
    const ctx = this.ctx;
    const p = this.pal;
    const rnd = new Rng(this.terrain.seed + 11);
    // Aufwurf (Brustwehr/Rückenwehr) unter allen Gräben
    for (const t of this.terrain.trenches) stroke(ctx, t.pts, t.width + 10, p.spoil, "miter");
    for (const t of this.terrain.trenches) stroke(ctx, t.pts, t.width + 4, p.spoilDark, "miter");
    for (const t of this.terrain.trenches) stroke(ctx, t.pts, t.width, p.trench, "miter");
    // Laufroste
    for (const t of this.terrain.trenches) {
      stroke(ctx, t.pts, Math.max(2, t.width * 0.35), p.floor, "miter");
      ctx.strokeStyle = shadeHex(p.floor, -0.3);
      ctx.lineWidth = 1;
      walk(t.pts, 4, (x, y, a) => {
        const nx = -Math.sin(a) * t.width * 0.18;
        const ny = Math.cos(a) * t.width * 0.18;
        ctx.beginPath();
        ctx.moveTo(x - nx, y - ny);
        ctx.lineTo(x + nx, y + ny);
        ctx.stroke();
      });
    }
    // Sandsäcke auf der feindwärts gerichteten Seite der Frontgräben
    for (const t of this.terrain.trenches) {
      if (t.kind !== "front" && t.kind !== "sap") continue;
      const toward = t.side === 0 ? -1 : 1;
      walk(t.pts, 3.2, (x, y, a) => {
        let nx = -Math.sin(a);
        let ny = Math.cos(a);
        if (ny * toward < 0) {
          nx = -nx;
          ny = -ny;
        }
        const off = t.width / 2 + 1.5;
        const bx = x + nx * off;
        const by = y + ny * off;
        ctx.fillStyle = rnd.next() < 0.5 ? p.bag : shadeHex(p.bag, -0.12);
        ctx.save();
        ctx.translate(bx, by);
        ctx.rotate(a);
        ctx.fillRect(-1.6, -1, 3.2, 2.2);
        ctx.restore();
      });
    }
  }

  private paintBunkers() {
    const ctx = this.ctx;
    for (const b of this.terrain.bunkers) {
      ctx.fillStyle = "rgba(0,0,0,0.35)";
      ctx.fillRect(b.x - 9 + 2, b.y - 6.5 + 2, 18, 13);
      ctx.fillStyle = "#8d8f8a";
      ctx.fillRect(b.x - 9, b.y - 6.5, 18, 13);
      ctx.fillStyle = "#a9aba5";
      ctx.fillRect(b.x - 9, b.y - 6.5, 18, 2);
      ctx.fillStyle = "#1c1c1a";
      const slitY = b.side === 0 ? b.y - 5 : b.y + 3.5;
      ctx.fillRect(b.x - 6, slitY, 12, 1.5);
    }
  }

  private paintBuildings() {
    const ctx = this.ctx;
    const p = this.pal;
    for (const b of this.terrain.buildings) {
      const r = new Rng(b.seed);
      ctx.save();
      ctx.translate(b.x, b.y);
      ctx.rotate(b.angle);
      // Schatten und Boden aus Schutt
      ctx.fillStyle = "rgba(0,0,0,0.25)";
      ctx.fillRect(-b.w / 2 + 3, -b.h / 2 + 3, b.w, b.h);
      ctx.fillStyle = p.rubble;
      ctx.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      for (let i = 0; i < b.w * b.h * 0.12; i++) {
        ctx.fillStyle = r.next() < 0.5 ? shadeHex(p.rubble, -0.2) : shadeHex(p.rubble, 0.15);
        ctx.fillRect(-b.w / 2 + r.next() * b.w, -b.h / 2 + r.next() * b.h, 1 + r.next() * 2, 1 + r.next() * 2);
      }
      // Reste des Dachs bei wenig zerstörten Häusern
      if (b.ruin < 0.55) {
        ctx.fillStyle = "#7b4a38";
        ctx.fillRect(-b.w / 2 + 3, -b.h / 2 + 3, b.w * (0.3 + r.next() * 0.4), b.h - 6);
        ctx.fillStyle = "#5e382b";
        for (let yy = -b.h / 2 + 4; yy < b.h / 2 - 3; yy += 3) ctx.fillRect(-b.w / 2 + 3, yy, b.w * 0.3, 1);
      }
      // Mauern mit Breschen
      const wall = (x0: number, y0: number, x1: number, y1: number) => {
        const len = Math.hypot(x1 - x0, y1 - y0);
        const steps = Math.ceil(len / 3);
        for (let i = 0; i < steps; i++) {
          if (r.next() < b.ruin * 0.35) continue;
          const k = i / steps;
          const x = x0 + (x1 - x0) * k;
          const y = y0 + (y1 - y0) * k;
          ctx.fillStyle = p.wallDark;
          ctx.fillRect(x - 1.5, y - 1.5, 3.5, 3.5);
          ctx.fillStyle = p.wall;
          ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
        }
      };
      const hw = b.w / 2 - 1.5;
      const hh = b.h / 2 - 1.5;
      wall(-hw, -hh, hw, -hh);
      wall(hw, -hh, hw, hh);
      wall(hw, hh, -hw, hh);
      wall(-hw, hh, -hw, -hh);
      ctx.restore();
      // Trümmer drumherum
      for (let i = 0; i < 14 * b.ruin; i++) {
        ctx.fillStyle = r.next() < 0.5 ? p.wall : p.wallDark;
        ctx.fillRect(b.x + r.range(-b.w, b.w) * 0.8, b.y + r.range(-b.h, b.h) * 0.8, 1 + r.next() * 2, 1 + r.next() * 2);
      }
    }
  }

  private paintWire() {
    const ctx = this.ctx;
    const rnd = new Rng(this.terrain.seed + 5);
    const winter = this.terrain.biome === "winter";
    for (const w of this.terrain.wires) {
      ctx.strokeStyle = winter || this.terrain.biome === "champagne" ? "rgba(60,60,64,0.6)" : "rgba(175,175,168,0.55)";
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      walk(w.pts, 3, (x, y) => {
        const ox = (rnd.next() - 0.5) * 8;
        const oy = (rnd.next() - 0.5) * 10;
        ctx.moveTo(x + ox, y + oy);
        ctx.quadraticCurveTo(x + ox + 3, y + oy - 4, x + ox + 5, y + oy + (rnd.next() - 0.5) * 8);
      });
      ctx.stroke();
      ctx.fillStyle = "#3a2e22";
      walk(w.pts, 12, (x, y) => ctx.fillRect(x - 0.5, y - 1.5, 1.5, 3));
    }
  }

  private paintTrees() {
    const ctx = this.ctx;
    const p = this.pal;
    const rnd = new Rng(this.terrain.seed + 9);
    for (const t of this.terrain.trees) {
      if (t.dead) {
        // zersplitterter Stumpf mit Schatten
        ctx.fillStyle = "rgba(0,0,0,0.3)";
        ctx.fillRect(t.x + 1, t.y + 1, t.r * 1.2, t.r * 0.8);
        ctx.fillStyle = p.stump;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r * 0.7, 0, Math.PI * 2);
        ctx.fill();
        if (rnd.next() < 0.5) {
          ctx.strokeStyle = p.stump;
          ctx.lineWidth = 1.2;
          const a = rnd.next() * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(t.x, t.y);
          ctx.lineTo(t.x + Math.cos(a) * t.r * 4, t.y + Math.sin(a) * t.r * 4);
          ctx.stroke();
        }
      } else {
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.beginPath();
        ctx.arc(t.x + t.r * 0.4, t.y + t.r * 0.5, t.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.canopy;
        ctx.beginPath();
        ctx.arc(t.x, t.y, t.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = p.canopyHi;
        ctx.beginPath();
        ctx.arc(t.x - t.r * 0.3, t.y - t.r * 0.3, t.r * 0.55, 0, Math.PI * 2);
        ctx.fill();
        if (this.terrain.biome === "winter" && rnd.next() < 0.7) {
          ctx.fillStyle = "rgba(240,244,248,0.8)";
          ctx.fillRect(t.x - t.r * 0.4, t.y - t.r * 0.5, t.r * 0.6, t.r * 0.4);
        }
      }
    }
  }

  private paintWrecks() {
    for (const w of this.terrain.wrecks) {
      if (w.kind === "tank") this.stampSprite("tankWreck", 1, w.x, w.y, w.angle, 1);
      else if (w.kind === "gun") this.stampSprite("gunWreck", 0, w.x, w.y, w.angle, 1);
      else {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(w.x, w.y);
        ctx.rotate(w.angle);
        ctx.fillStyle = "#3a2c1e";
        ctx.fillRect(-8, -4, 16, 8);
        ctx.fillStyle = "#1e1914";
        ctx.fillRect(-9, -6, 4, 2);
        ctx.fillRect(4, 4, 4, 2);
        ctx.restore();
      }
    }
  }

  // ------------------------------------------------------------ Laufende Schlacht

  crater(x: number, y: number, r: number) {
    const ctx = this.ctx;
    const p = this.pal;
    ctx.fillStyle = p.craterRim;
    ctx.beginPath();
    ctx.arc(x, y, r + 2.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.craterIn;
    ctx.beginPath();
    ctx.arc(x + 0.5, y + 0.5, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.beginPath();
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.7, 0, Math.PI * 2);
    ctx.fill();
    if (p.craterWater && r > 6 && this.rng.next() < 0.45) {
      ctx.fillStyle = p.craterWater;
      ctx.beginPath();
      ctx.arc(x + 1, y + 1, r * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    // Erdspritzer um den Trichter
    ctx.fillStyle = p.craterRim;
    for (let i = 0; i < r * 1.5; i++) {
      const a = this.rng.next() * Math.PI * 2;
      const d = r + 2 + this.rng.next() * r * 0.8;
      ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.5, 1.5);
    }
  }

  corpse(x: number, y: number, side: number, angle: number) {
    this.stampSprite(this.rng.next() < 0.5 ? "dead1" : "dead2", side, x, y, angle + (this.rng.next() - 0.5), 0.85);
  }

  track(x: number, y: number, angle: number) {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = "rgba(35,30,24,0.16)";
    for (const oy of [-9, 7]) {
      ctx.fillRect(-3, oy, 6, 3);
      ctx.fillStyle = "rgba(35,30,24,0.1)";
    }
    ctx.restore();
  }

  wreck(x: number, y: number, angle: number, kind: number) {
    this.stampSprite(kind === 1 ? "tankWreck" : "gunWreck", 0, x, y, angle, 1);
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(15,12,10,0.35)";
    ctx.beginPath();
    ctx.arc(x, y, 16, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Alles nachtragen, was in einer schon laufenden Schlacht passiert ist */
  replay(corpses: number[], scars: number[]) {
    for (let i = 0; i < scars.length; i += 4) {
      if (scars[i] === 0) this.track(scars[i + 1], scars[i + 2], scars[i + 3]);
      else this.wreck(scars[i + 1], scars[i + 2], scars[i + 3], scars[i]);
    }
    for (let i = 0; i < corpses.length; i += 5) this.corpse(corpses[i], corpses[i + 1], corpses[i + 2], corpses[i + 4]);
  }

  private stampSprite(name: "dead1" | "dead2" | "tankWreck" | "gunWreck", side: number, x: number, y: number, angle: number, alpha: number) {
    const f = this.atlas.frames[side][name];
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.drawImage(this.atlas.canvas, f.x, f.y, f.w, f.h, -f.ww / 2, -f.wh / 2, f.ww, f.wh);
    ctx.restore();
  }
}

/** Blutflecken auf einer eigenen Ebene, die mit der Zeit verblasst */
export class BloodLayer {
  canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private acc = 0;
  static SCALE = 0.5;

  constructor() {
    this.canvas = document.createElement("canvas");
    this.canvas.width = WORLD_W * BloodLayer.SCALE;
    this.canvas.height = WORLD_H * BloodLayer.SCALE;
    this.ctx = this.canvas.getContext("2d")!;
  }

  splat(x: number, y: number, size: number) {
    const s = BloodLayer.SCALE;
    const ctx = this.ctx;
    ctx.fillStyle = `rgba(${100 + Math.random() * 30},12,10,${0.45 + Math.random() * 0.3})`;
    ctx.beginPath();
    ctx.ellipse(x * s, y * s, size * s * (0.8 + Math.random() * 0.5), size * s * (0.6 + Math.random() * 0.4), Math.random() * 3, 0, Math.PI * 2);
    ctx.fill();
  }

  /** Blut wäscht sich langsam aus (nach etwa `fadeSeconds` fast weg) */
  fade(dt: number, fadeSeconds: number) {
    this.acc += dt;
    if (this.acc < 2) return;
    const a = Math.min(1, (this.acc / fadeSeconds) * 3.5);
    this.acc = 0;
    const ctx = this.ctx;
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = `rgba(0,0,0,${a})`;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.globalCompositeOperation = "source-over";
  }
}

// ---------------------------------------------------------------- Hilfen

function stroke(ctx: CanvasRenderingContext2D, pts: Pt[], width: number, color: string, join: CanvasLineJoin = "round") {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = join;
  ctx.lineCap = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
}

function offset(pts: Pt[], d: number): Pt[] {
  return pts.map((p, i) => {
    const a = pts[Math.min(i + 1, pts.length - 1)];
    const b = pts[Math.max(i - 1, 0)];
    const ang = Math.atan2(a.y - b.y, a.x - b.x);
    return { x: p.x - Math.sin(ang) * d, y: p.y + Math.cos(ang) * d };
  });
}

/** Läuft in gleichmäßigen Schritten an einer Linie entlang */
function walk(pts: Pt[], step: number, fn: (x: number, y: number, angle: number) => void) {
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    let d = carry;
    while (d < len) {
      fn(a.x + ((b.x - a.x) * d) / len, a.y + ((b.y - a.y) * d) / len, ang);
      d += step;
    }
    carry = d - len;
  }
}

function shadeHex(hex: string, f: number) {
  const n = parseInt(hex.slice(1), 16);
  const ch = (v: number) => Math.max(0, Math.min(255, Math.round(v + (f > 0 ? (255 - v) * f : v * f))));
  return `rgb(${ch((n >> 16) & 255)},${ch((n >> 8) & 255)},${ch(n & 255)})`;
}

/** Wertrauschen auf einem groben Gitter mit weicher Interpolation */
function noiseGrid(seed: number, w: number, h: number, cell: number) {
  const gw = Math.ceil(w / cell) + 2;
  const gh = Math.ceil(h / cell) + 2;
  const r = new Rng(seed);
  const g = new Float32Array(gw * gh);
  for (let i = 0; i < g.length; i++) g[i] = r.next();
  return (x: number, y: number) => {
    const fx = x / cell;
    const fy = y / cell;
    const x0 = Math.min(gw - 2, Math.max(0, Math.floor(fx)));
    const y0 = Math.min(gh - 2, Math.max(0, Math.floor(fy)));
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = g[y0 * gw + x0];
    const b = g[y0 * gw + x0 + 1];
    const c = g[(y0 + 1) * gw + x0];
    const d = g[(y0 + 1) * gw + x0 + 1];
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  };
}
