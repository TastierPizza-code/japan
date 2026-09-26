import { Rng } from "./rng.ts";
import { FORWARD, FRONT_BASE, SUPPORT_OFFSET, WIRE_OFFSET, WORLD_H, WORLD_W } from "./config.ts";

// ----------------------------------------------------------------------------
// Gelände einer Schlacht: wird zufällig erzeugt (Landschaftstyp, Gräben, Ruinen …)
// und als feines Raster für Deckung, Bewegung und Belegung gespeichert.
// Die Geometrie-Listen braucht nur der Renderer zum Malen.
// ----------------------------------------------------------------------------

export type Biome = "flandern" | "champagne" | "argonnen" | "winter" | "dorf";
export const BIOMES: Biome[] = ["flandern", "champagne", "argonnen", "winter", "dorf"];
export const BIOME_NAMES: Record<Biome, string> = {
  flandern: "Flandern – Schlamm, Ruinen, Wasser in den Trichtern",
  champagne: "Champagne – offene Kreide-Ebene",
  argonnen: "Argonnen – zerschossener Wald",
  winter: "Karpaten – Schnee und Nadelwald",
  dorf: "Dorfkampf – Ruinen im Niemandsland",
};

export const CELL = 4;
export const GW = Math.ceil(WORLD_W / CELL);
export const GH = Math.ceil(WORLD_H / CELL);

// Geländearten je Rasterzelle
export const K_GROUND = 0;
export const K_ROAD = 1;
export const K_WIRE = 2;
export const K_WATER = 3;
export const K_CRATER = 4;
export const K_TREE = 5;
export const K_RUBBLE = 6;
export const K_WRECK = 7;
export const K_SUNKEN = 8;
export const K_TRENCH = 9;
export const K_WALL = 10;
export const K_BUNKER = 11;

/** Deckung (0..1, Anteil abgewehrter Treffer) und Bewegungsfaktor für Fußtruppen */
const PROPS: Record<number, { cover: number; slow: number; tank: number }> = {
  [K_GROUND]: { cover: 0, slow: 1, tank: 1 },
  [K_ROAD]: { cover: 0, slow: 1.15, tank: 1.15 },
  [K_WIRE]: { cover: 0, slow: 0.3, tank: 1 },
  [K_WATER]: { cover: 0.05, slow: 0.35, tank: 0.3 },
  [K_CRATER]: { cover: 0.45, slow: 0.85, tank: 0.7 },
  [K_TREE]: { cover: 0.35, slow: 0.8, tank: 0.45 },
  [K_RUBBLE]: { cover: 0.5, slow: 0.7, tank: 0.6 },
  [K_WRECK]: { cover: 0.65, slow: 0.4, tank: 0.2 },
  [K_SUNKEN]: { cover: 0.55, slow: 1, tank: 0.8 },
  [K_TRENCH]: { cover: 0.75, slow: 0.95, tank: 0.45 },
  [K_WALL]: { cover: 0.7, slow: 0.45, tank: 0.5 },
  [K_BUNKER]: { cover: 0.9, slow: 0.6, tank: 0.15 },
};

export type Pt = { x: number; y: number };

export interface TrenchLine {
  pts: Pt[];
  width: number;
  kind: "front" | "support" | "comm" | "sap";
  side: number;
}
export interface WireBelt {
  pts: Pt[];
  side: number;
}
export interface Crater {
  x: number;
  y: number;
  r: number;
}
export interface Building {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  /** 0 = fast unversehrt, 1 = nur noch Schutt */
  ruin: number;
  seed: number;
}
export interface Tree {
  x: number;
  y: number;
  r: number;
  dead: boolean;
}
export interface Road {
  pts: Pt[];
  width: number;
  sunken: boolean;
}
export interface Creek {
  pts: Pt[];
  width: number;
  frozen: boolean;
}
export interface Bunker {
  x: number;
  y: number;
  side: number;
}
export interface Wreck {
  x: number;
  y: number;
  angle: number;
  kind: "tank" | "cart" | "gun";
}
export interface Mine {
  x: number;
  y: number;
  side: number;
  alive: boolean;
}

const SAMPLE = 8; // Abstand der Stützstellen für die Grabenverläufe

export class Terrain {
  biome: Biome;
  seed: number;
  cover = new Float32Array(GW * GH);
  slow = new Float32Array(GW * GH).fill(1);
  kind = new Uint8Array(GW * GH);
  /** Welcher Soldat diese Zelle als Standplatz beansprucht (-1 = frei) */
  claim = new Int32Array(GW * GH).fill(-1);

  trenches: TrenchLine[] = [];
  wires: WireBelt[] = [];
  craters: Crater[] = [];
  buildings: Building[] = [];
  trees: Tree[] = [];
  roads: Road[] = [];
  creeks: Creek[] = [];
  bunkers: Bunker[] = [];
  wrecks: Wreck[] = [];
  mines: Mine[] = [];

  private front: Float32Array[] = [];
  private support: Float32Array[] = [];
  private rng: Rng;

  constructor(rng: Rng, biome?: Biome) {
    this.rng = rng;
    this.seed = Math.floor(rng.next() * 1e9);
    this.biome = biome ?? BIOMES[Math.floor(rng.next() * BIOMES.length)];
    this.generate();
  }

  // ================================================================ Abfragen

  /** y des vorderen Grabens einer Seite an Position x (Grundlinie ohne Zacken) */
  frontY(side: number, x: number) {
    return sampleLine(this.front[side], x);
  }
  supportY(side: number, x: number) {
    return sampleLine(this.support[side], x);
  }
  wireY(side: number, x: number) {
    return this.frontY(side, x) + FORWARD[side] * WIRE_OFFSET;
  }

  cellAt(x: number, y: number) {
    const cx = Math.floor(x / CELL);
    const cy = Math.floor(y / CELL);
    if (cx < 0 || cy < 0 || cx >= GW || cy >= GH) return -1;
    return cy * GW + cx;
  }
  coverAt(x: number, y: number) {
    const c = this.cellAt(x, y);
    return c < 0 ? 0 : this.cover[c];
  }
  slowAt(x: number, y: number) {
    const c = this.cellAt(x, y);
    return c < 0 ? 1 : this.slow[c];
  }
  kindAt(x: number, y: number) {
    const c = this.cellAt(x, y);
    return c < 0 ? K_GROUND : this.kind[c];
  }
  tankSlowAt(x: number, y: number) {
    return PROPS[this.kindAt(x, y)].tank;
  }

  /**
   * Freien Standplatz mit guter Deckung in der Nähe suchen und für `who` reservieren.
   * Gibt die Zelle zurück (-1 = nichts frei), Position landet in out.
   */
  findSpot(x: number, y: number, radius: number, who: number, out: Pt, preferCover = true): number {
    const rc = Math.ceil(radius / CELL);
    const gx = Math.floor(x / CELL);
    const gy = Math.floor(y / CELL);
    let best = -1;
    let bestScore = -Infinity;
    for (let cy = gy - rc; cy <= gy + rc; cy++) {
      if (cy < 1 || cy >= GH - 1) continue;
      for (let cx = gx - rc; cx <= gx + rc; cx++) {
        if (cx < 1 || cx >= GW - 1) continue;
        const k = cy * GW + cx;
        if (this.claim[k] >= 0 && this.claim[k] !== who) continue;
        const kd = this.kind[k];
        if (kd === K_WALL || kd === K_WRECK) continue;
        const px = (cx + 0.5) * CELL;
        const py = (cy + 0.5) * CELL;
        const d = Math.hypot(px - x, py - y);
        if (d > radius) continue;
        const score = (preferCover ? this.cover[k] * 1.2 : 0) - d / radius + (kd === K_WATER ? -0.6 : 0);
        if (score > bestScore) {
          bestScore = score;
          best = k;
        }
      }
    }
    if (best < 0) {
      out.x = x;
      out.y = y;
      return -1;
    }
    this.claim[best] = who;
    out.x = ((best % GW) + 0.5) * CELL + (this.rng.next() - 0.5) * 1.2;
    out.y = (Math.floor(best / GW) + 0.5) * CELL + (this.rng.next() - 0.5) * 1.2;
    return best;
  }

  release(cell: number, who: number) {
    if (cell >= 0 && this.claim[cell] === who) this.claim[cell] = -1;
  }

  /** Granattrichter: gibt Deckung, zerreißt Draht, fällt Bäume. */
  addCrater(x: number, y: number, r: number) {
    this.craters.push({ x, y, r });
    this.forCircle(x, y, r + 3, (k, d) => {
      const kd = this.kind[k];
      if (kd === K_WIRE && d <= r + 3) this.setCell(k, K_CRATER, true);
      if (d > r) return;
      if (kd === K_GROUND || kd === K_ROAD || kd === K_TREE || kd === K_WIRE) this.setCell(k, K_CRATER, true);
    });
  }

  /** Panzer walzt Draht nieder. Gibt true zurück, wenn wirklich Draht zerstört wurde. */
  crushWire(x: number, y: number, r: number): boolean {
    let hit = false;
    this.forCircle(x, y, r, (k) => {
      if (this.kind[k] === K_WIRE) {
        this.setCell(k, K_GROUND, true);
        hit = true;
      }
    });
    return hit;
  }

  // ================================================================ Erzeugung

  private generate() {
    const rng = this.rng;
    const b = this.biome;
    // Grundlinien der Stellungen: geschwungen, mit Frontvorsprüngen
    for (let s = 0; s < 2; s++) {
      const amp = 40 + rng.next() * 60;
      const f = makeWave(rng, amp, [0.0025, 0.006, 0.013]);
      const bumps: [number, number, number][] = [];
      for (let i = 0; i < 1 + Math.floor(rng.next() * 2); i++) {
        bumps.push([rng.range(200, WORLD_W - 200), rng.range(60, 120), rng.range(90, 170)]);
      }
      const front = new Float32Array(Math.ceil(WORLD_W / SAMPLE) + 3);
      const support = new Float32Array(front.length);
      const g = makeWave(rng, 30, [0.004, 0.011]);
      for (let i = 0; i < front.length; i++) {
        const x = (i - 1) * SAMPLE;
        let y = FRONT_BASE[s] + f(x);
        for (const [bx, h, w] of bumps) y += FORWARD[s] * h * Math.exp(-(((x - bx) / w) ** 2));
        front[i] = y;
        support[i] = FRONT_BASE[s] - FORWARD[s] * SUPPORT_OFFSET + f(x) * 0.5 + g(x);
      }
      this.front[s] = front;
      this.support[s] = support;
    }

    if (b === "dorf" || b === "flandern") this.makeVillage(true, b === "dorf" ? 26 : 12);
    if (b !== "argonnen" && rng.next() < 0.6) this.makeVillage(false, 6 + Math.floor(rng.next() * 6));
    this.makeRoads();
    if (b === "flandern" || b === "argonnen" || (b === "winter" && rng.next() < 0.7) || rng.next() < 0.25) this.makeCreek();
    this.makeTrees();
    for (let s = 0; s < 2; s++) this.makeTrenches(s);
    this.makeWrecks();
    const craterCount = { flandern: 650, champagne: 380, argonnen: 420, winter: 300, dorf: 480 }[b];
    for (let i = 0; i < craterCount; i++) {
      const inNoMansLand = rng.next() < 0.8;
      const x = rng.range(5, WORLD_W - 5);
      const y = inNoMansLand
        ? rng.range(this.wireY(1, x) + 10, this.wireY(0, x) - 10)
        : rng.next() < 0.5
          ? rng.range(40, this.frontY(1, x))
          : rng.range(this.frontY(0, x), WORLD_H - 40);
      this.addCrater(x, y, rng.range(3, 14));
    }
    for (let s = 0; s < 2; s++) this.makeMines(s);
  }

  private makeTrenches(s: number) {
    const rng = this.rng;
    // Vorderer Graben: Zinnen-Muster (Schützenstände und Traversen), wie echte Grabensysteme
    const front: Pt[] = [];
    let up = false;
    for (let x = -30; x <= WORLD_W + 30; ) {
      const bay = rng.range(26, 42);
      const depth = rng.range(4, 8);
      const o = up ? -depth : depth;
      front.push({ x, y: this.frontY(s, x) + o });
      front.push({ x: x + bay, y: this.frontY(s, x + bay) + o });
      x += bay;
      up = !up;
    }
    this.addTrench({ pts: front, width: 11, kind: "front", side: s });

    // Unterstützungsgraben: sanfter Zickzack
    const sup: Pt[] = [];
    for (let x = -30, i = 0; x <= WORLD_W + 30; x += rng.range(40, 70), i++) {
      sup.push({ x, y: this.supportY(s, x) + (i % 2 ? 6 : -6) });
    }
    this.addTrench({ pts: sup, width: 9, kind: "support", side: s });

    // Verbindungsgräben: gewunden von hinten nach vorn
    const n = 4 + Math.floor(rng.next() * 3);
    for (let i = 0; i < n; i++) {
      let x = ((i + 0.3 + rng.next() * 0.4) / n) * WORLD_W;
      const pts: Pt[] = [];
      const y0 = this.supportY(s, x);
      const y1 = this.frontY(s, x);
      const steps = 8;
      for (let k = 0; k <= steps; k++) {
        const t = k / steps;
        pts.push({ x, y: y0 + (y1 - y0) * t });
        x += (rng.next() - 0.5) * 26;
      }
      this.addTrench({ pts, width: 7, kind: "comm", side: s });
      // nach hinten zum Nachschub
      if (rng.next() < 0.6) {
        const back: Pt[] = [];
        let bx = pts[0].x;
        const yb = s === 0 ? WORLD_H - 60 : 60;
        for (let k = 0; k <= 6; k++) {
          back.push({ x: bx, y: y0 + ((yb - y0) * k) / 6 });
          bx += (rng.next() - 0.5) * 30;
        }
        this.addTrench({ pts: back, width: 6, kind: "comm", side: s });
      }
    }

    // Sappen: kurze Gräben ins Niemandsland mit Horchposten am Ende
    const saps = 2 + Math.floor(rng.next() * 3);
    for (let i = 0; i < saps; i++) {
      let x = rng.range(100, WORLD_W - 100);
      const y0 = this.frontY(s, x);
      const len = rng.range(60, 130);
      const pts: Pt[] = [];
      for (let k = 0; k <= 5; k++) {
        pts.push({ x, y: y0 + FORWARD[s] * (len * k) / 5 });
        x += (rng.next() - 0.5) * 18;
      }
      this.addTrench({ pts, width: 6, kind: "sap", side: s });
      const end = pts[pts.length - 1];
      this.forCircle(end.x, end.y, 7, (k) => this.setCell(k, K_TRENCH));
    }

    // Bunker (MG-Stände aus Beton) an der Front
    const nb = 2 + Math.floor(rng.next() * 2);
    for (let i = 0; i < nb; i++) {
      const x = ((i + 0.5) / nb) * WORLD_W + rng.range(-80, 80);
      const y = this.frontY(s, x) - FORWARD[s] * 4;
      this.bunkers.push({ x, y, side: s });
      this.forRect(x, y, 18, 13, 0, (k) => this.setCell(k, K_BUNKER));
    }

    // Stacheldraht: zwei Gürtel mit Lücken
    for (const off of [WIRE_OFFSET - 12, WIRE_OFFSET + 14]) {
      const gaps: [number, number][] = [];
      for (let g = 0; g < 2 + Math.floor(rng.next() * 2); g++) {
        const gx = rng.range(80, WORLD_W - 80);
        gaps.push([gx - 18, gx + 18]);
      }
      let pts: Pt[] = [];
      for (let x = -10; x <= WORLD_W + 10; x += 10) {
        const inGap = gaps.some(([a, bb]) => x > a && x < bb);
        if (inGap) {
          if (pts.length > 1) this.addWire({ pts, side: s });
          pts = [];
          continue;
        }
        pts.push({ x, y: this.frontY(s, x) + FORWARD[s] * off + (rng.next() - 0.5) * 6 });
      }
      if (pts.length > 1) this.addWire({ pts, side: s });
    }
  }

  private makeMines(s: number) {
    const rng = this.rng;
    const fields = 2 + Math.floor(rng.next() * 2);
    for (let f = 0; f < fields; f++) {
      const cx = rng.range(120, WORLD_W - 120);
      const cy = this.wireY(s, cx) + FORWARD[s] * rng.range(30, 70);
      const count = 10 + Math.floor(rng.next() * 10);
      for (let i = 0; i < count; i++) {
        this.mines.push({ x: cx + rng.range(-70, 70), y: cy + rng.range(-20, 20), side: s, alive: true });
      }
    }
  }

  private makeVillage(inNoMansLand: boolean, count: number) {
    const rng = this.rng;
    const vx = rng.range(250, WORLD_W - 250);
    let vy: number;
    if (inNoMansLand) vy = (this.wireY(0, vx) + this.wireY(1, vx)) / 2 + rng.range(-120, 120);
    else {
      const s = rng.next() < 0.5 ? 0 : 1;
      vy = (this.supportY(s, vx) + (s === 0 ? WORLD_H - 80 : 80)) / 2;
    }
    const angle = rng.range(-0.4, 0.4);
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    // Dorfstraße
    const road: Pt[] = [];
    for (let t = -1; t <= 1; t += 0.1) road.push({ x: vx + ca * t * 260, y: vy + sa * t * 260 + Math.sin(t * 3) * 10 });
    this.addRoad({ pts: road, width: 12, sunken: false });
    for (let i = 0; i < count; i++) {
      const along = rng.range(-220, 220);
      const sideOff = (rng.next() < 0.5 ? -1 : 1) * rng.range(22, 55 + count * 1.5);
      const x = vx + ca * along - sa * sideOff;
      const y = vy + sa * along + ca * sideOff;
      const w = rng.range(20, 44);
      const h = rng.range(16, 30);
      const bld: Building = { x, y, w, h, angle: angle + rng.range(-0.15, 0.15), ruin: rng.range(0.25, 1), seed: Math.floor(rng.next() * 1e6) };
      if (this.buildings.some((o) => Math.hypot(o.x - x, o.y - y) < (o.w + w) * 0.5)) continue;
      this.buildings.push(bld);
      this.stampBuilding(bld);
    }
  }

  private stampBuilding(b: Building) {
    const wall = 3;
    const r = new Rng(b.seed);
    this.forRect(b.x, b.y, b.w, b.h, b.angle, (k, lx, ly) => {
      const edge = Math.abs(lx) > b.w / 2 - wall || Math.abs(ly) > b.h / 2 - wall;
      if (edge) {
        // Mauern mit Breschen: je zerstörter, desto mehr Lücken
        const gap = r.next() < b.ruin * 0.35;
        this.setCell(k, gap ? K_RUBBLE : K_WALL);
      } else this.setCell(k, K_RUBBLE);
    });
    // Schutt um das Haus
    for (let i = 0; i < 6 * b.ruin; i++) {
      this.forCircle(b.x + r.range(-b.w, b.w) * 0.7, b.y + r.range(-b.h, b.h) * 0.7, r.range(3, 7), (k) => {
        if (this.kind[k] === K_GROUND || this.kind[k] === K_ROAD) this.setCell(k, K_RUBBLE);
      });
    }
  }

  private makeRoads() {
    const rng = this.rng;
    const n = this.biome === "argonnen" ? 1 : 1 + Math.floor(rng.next() * 2);
    for (let i = 0; i < n; i++) {
      let x = rng.range(150, WORLD_W - 150);
      const pts: Pt[] = [];
      for (let y = -20; y <= WORLD_H + 20; y += 60) {
        pts.push({ x, y });
        x += (rng.next() - 0.5) * 50;
      }
      this.addRoad({ pts, width: 11, sunken: false });
    }
    // Hohlweg quer durchs Niemandsland: natürliche Deckung
    if (rng.next() < 0.6) {
      const y0 = (this.wireY(0, 800) + this.wireY(1, 800)) / 2 + rng.range(-150, 150);
      let x = rng.range(-50, 400);
      const end = x + rng.range(500, 900);
      const pts: Pt[] = [];
      let y = y0;
      for (; x < end; x += 40) {
        pts.push({ x, y });
        y += (rng.next() - 0.5) * 26;
      }
      this.addRoad({ pts, width: 12, sunken: true });
    }
  }

  private makeCreek() {
    const rng = this.rng;
    const frozen = this.biome === "winter";
    let y = (this.wireY(0, 800) + this.wireY(1, 800)) / 2 + rng.range(-200, 200);
    const pts: Pt[] = [];
    for (let x = -20; x <= WORLD_W + 20; x += 25) {
      pts.push({ x, y });
      y += (rng.next() - 0.5) * 28;
    }
    const creek: Creek = { pts, width: rng.range(9, 15), frozen };
    this.creeks.push(creek);
    this.forPolyline(pts, creek.width / 2, (k) => {
      if (this.kind[k] === K_ROAD) return; // Brücke/Furt
      this.setCell(k, K_WATER);
      if (frozen) {
        this.slow[k] = 0.9;
        this.cover[k] = 0;
      }
    });
  }

  private makeTrees() {
    const rng = this.rng;
    const b = this.biome;
    const count = { flandern: 90, champagne: 60, argonnen: 4200, winter: 1400, dorf: 120 }[b];
    const clusters: [number, number, number][] = [];
    const forest = b === "argonnen" || b === "winter";
    for (let i = 0; i < (b === "argonnen" ? 16 : b === "winter" ? 11 : 6); i++) {
      // Wälder stehen vor allem hinter den Linien; im Niemandsland bleiben nur Stümpfe
      const behind = forest && rng.next() < 0.75;
      const s = rng.next() < 0.5 ? 0 : 1;
      const y = behind ? (s === 0 ? rng.range(this.frontY(0, 800) + 60, WORLD_H) : rng.range(0, this.frontY(1, 800) - 60)) : rng.range(0, WORLD_H);
      clusters.push([rng.range(0, WORLD_W), y, rng.range(110, 280)]);
    }
    for (let i = 0; i < count; i++) {
      const c = clusters[Math.floor(rng.next() * clusters.length)];
      const a = rng.next() * Math.PI * 2;
      const r = Math.sqrt(rng.next()) * c[2];
      const x = c[0] + Math.cos(a) * r;
      const y = c[1] + Math.sin(a) * r;
      if (x < 0 || y < 0 || x > WORLD_W || y > WORLD_H) continue;
      if (this.kindAt(x, y) !== K_GROUND) continue;
      // Im Niemandsland stehen nur noch Stümpfe
      const nml = y > this.wireY(1, x) - 40 && y < this.wireY(0, x) + 40;
      const dead = nml || (b !== "winter" && rng.next() < 0.3);
      const tr: Tree = { x, y, r: dead ? rng.range(2, 3.5) : rng.range(4, 8), dead };
      this.trees.push(tr);
      this.forCircle(x, y, tr.r * 0.8, (k) => {
        if (this.kind[k] === K_GROUND) this.setCell(k, K_TREE);
      });
    }
  }

  private makeWrecks() {
    const rng = this.rng;
    const n = Math.floor(rng.next() * 4);
    const kinds: Wreck["kind"][] = ["tank", "cart", "gun"];
    for (let i = 0; i < n; i++) {
      const x = rng.range(100, WORLD_W - 100);
      const y = rng.range(this.wireY(1, x) + 60, this.wireY(0, x) - 60);
      const w: Wreck = { x, y, angle: rng.range(0, Math.PI * 2), kind: kinds[Math.floor(rng.next() * 3)] };
      this.wrecks.push(w);
      const [len, wid] = w.kind === "tank" ? [26, 16] : w.kind === "gun" ? [18, 10] : [16, 10];
      this.forRect(x, y, len, wid, w.angle, (k) => this.setCell(k, K_WRECK));
    }
  }

  // ================================================================ Raster-Hilfen

  private addTrench(t: TrenchLine) {
    this.trenches.push(t);
    this.forPolyline(t.pts, t.width / 2, (k) => {
      if (this.kind[k] !== K_BUNKER) this.setCell(k, K_TRENCH);
    });
  }

  private addWire(w: WireBelt) {
    this.wires.push(w);
    this.forPolyline(w.pts, 6, (k) => {
      const kd = this.kind[k];
      if (kd === K_GROUND || kd === K_CRATER || kd === K_ROAD || kd === K_TREE) this.setCell(k, K_WIRE);
    });
  }

  private addRoad(r: Road) {
    this.roads.push(r);
    this.forPolyline(r.pts, r.width / 2, (k) => {
      const kd = this.kind[k];
      if (kd === K_GROUND || kd === K_CRATER || kd === K_TREE) this.setCell(k, r.sunken ? K_SUNKEN : K_ROAD);
    });
  }

  private setCell(k: number, kind: number, force = false) {
    if (!force && kind < this.kind[k] && this.kind[k] !== K_CRATER) {
      // Höherwertige Struktur (z. B. Graben) nicht überschreiben
      return;
    }
    this.kind[k] = kind;
    this.cover[k] = PROPS[kind].cover;
    this.slow[k] = PROPS[kind].slow;
  }

  forCircle(x: number, y: number, r: number, fn: (k: number, d: number) => void) {
    const x0 = Math.max(0, Math.floor((x - r) / CELL));
    const x1 = Math.min(GW - 1, Math.floor((x + r) / CELL));
    const y0 = Math.max(0, Math.floor((y - r) / CELL));
    const y1 = Math.min(GH - 1, Math.floor((y + r) / CELL));
    for (let cy = y0; cy <= y1; cy++) {
      for (let cx = x0; cx <= x1; cx++) {
        const d = Math.hypot((cx + 0.5) * CELL - x, (cy + 0.5) * CELL - y);
        if (d <= r) fn(cy * GW + cx, d);
      }
    }
  }

  private forRect(x: number, y: number, w: number, h: number, angle: number, fn: (k: number, lx: number, ly: number) => void) {
    const r = Math.hypot(w, h) / 2;
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    this.forCircle(x, y, r, (k) => {
      const px = ((k % GW) + 0.5) * CELL - x;
      const py = (Math.floor(k / GW) + 0.5) * CELL - y;
      const lx = px * ca + py * sa;
      const ly = -px * sa + py * ca;
      if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) fn(k, lx, ly);
    });
  }

  private forPolyline(pts: Pt[], half: number, fn: (k: number) => void) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const minX = Math.max(0, Math.floor((Math.min(a.x, b.x) - half) / CELL));
      const maxX = Math.min(GW - 1, Math.floor((Math.max(a.x, b.x) + half) / CELL));
      const minY = Math.max(0, Math.floor((Math.min(a.y, b.y) - half) / CELL));
      const maxY = Math.min(GH - 1, Math.floor((Math.max(a.y, b.y) + half) / CELL));
      for (let cy = minY; cy <= maxY; cy++) {
        for (let cx = minX; cx <= maxX; cx++) {
          if (distToSegment((cx + 0.5) * CELL, (cy + 0.5) * CELL, a.x, a.y, b.x, b.y) <= half) fn(cy * GW + cx);
        }
      }
    }
  }
}

function sampleLine(arr: Float32Array, x: number) {
  const f = x / SAMPLE + 1;
  const i = Math.max(0, Math.min(arr.length - 2, Math.floor(f)));
  const t = Math.max(0, Math.min(1, f - i));
  return arr[i] * (1 - t) + arr[i + 1] * t;
}

/** Glatte Zufallskurve aus mehreren Sinuswellen */
function makeWave(rng: Rng, amp: number, freqs: number[]) {
  const parts = freqs.map((f, i) => ({ f, p: rng.next() * Math.PI * 2, a: amp / (i + 1) }));
  return (x: number) => parts.reduce((s, w) => s + Math.sin(x * w.f + w.p) * w.a, 0);
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
