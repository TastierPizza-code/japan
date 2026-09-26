import {
  ARTY_KILL_RADIUS,
  ARTY_RELOAD,
  ARTY_SHELL_INTERVAL,
  ARTY_SHELLS_PER_GUN,
  ARTY_SPREAD,
  ARTY_SUPPRESS_RADIUS,
  AT_DAMAGE,
  AT_PER_SQUAD,
  COMPANY_SIZE,
  FIRE_DURATION,
  FLAME_CONE,
  FLAME_PER_SQUAD,
  FORWARD,
  GRENADE_RADIUS,
  GRENADE_RANGE,
  GRENADE_RELOAD,
  GUN_DIRECT_DAMAGE,
  GUN_Y,
  GUNS_PER_BATTERY,
  MAGE_EVASION,
  MAGE_MANA_DRAIN,
  MAGE_MANA_MAX,
  MAGE_MANA_PER_SPELL,
  MAGE_MANA_REGEN,
  MAGE_SHIELD_REGEN,
  MAGE_SPELL_RADIUS,
  MAGES_PER_SQUAD,
  MELEE_KILL,
  MELEE_RANGE,
  MG_PER_SECTION,
  MINE_RADIUS,
  MINE_TANK_DAMAGE,
  MINE_TRIGGER,
  MORALE_PER_LOSS,
  ARTY_DEPTH,
  ODDS_RADIUS,
  RUNNING_TARGET,
  MAGE_SPELL_KILL,
  ENFILADE_COVER,
  MORALE_RALLY,
  MORALE_ROUT,
  MORALE_ROUT_STORM,
  OBJECTIVE_CAPTURE_TIME,
  OBJECTIVE_RADIUS,
  REAR_Y,
  RESERVE_COOLDOWN,
  SHELL_SPEED,
  SMOKE_BLOCK,
  SMOKE_DURATION,
  SMOKE_RADIUS,
  GAS_CASUALTY_RATE,
  GAS_DURATION,
  GAS_RADIUS,
  GAS_SUPPRESS,
  STORM_PER_SQUAD,
  START_RESERVES,
  STATS,
  STORM_ENGAGE_RANGE,
  TANK_BREAKDOWN_PER_SEC,
  TANK_CANNON_RANGE,
  TANK_CANNON_RELOAD,
  TANKS_PER_PLATOON,
  TICK,
  UNIT_AT,
  UNIT_FLAME,
  UNIT_GUN,
  UNIT_MAGE,
  UNIT_MG,
  UNIT_RIFLE,
  UNIT_STORM,
  UNIT_TANK,
  WIND,
  WORLD_H,
  WORLD_W,
} from "./config.ts";
import { SpatialGrid } from "./grid.ts";
import { Rng } from "./rng.ts";
import { K_BUNKER, K_TRENCH, K_WALL, K_WRECK, Terrain, type Biome } from "./terrain.ts";

export type Order = "advance" | "storm" | "retreat" | "rout";

export interface Company {
  id: number;
  side: number;
  type: number;
  name: string;
  members: number[];
  order: Order;
  tx: number;
  ty: number;
  homeX: number;
  homeY: number;
  morale: number;
  /** mittlere Deckung der Männer (0 = freies Feld, 1 = volle Deckung) */
  cover: number;
  /** Kräfteverhältnis in der Umgebung: eigene / feindliche Soldaten (1 = gleich stark) */
  odds: number;
  initial: number;
  alive: number;
  cx: number;
  cy: number;
  lastLoss: number;
  mana: number;
  /** Division der Kampagne, aus der die Kompanie stammt (-1 = keine) */
  division: number;
  /** Spieler hat direkt befohlen → KI-Offizier lässt die Kompanie in Ruhe */
  manual: boolean;
  /** Batterien: ab wann wieder feuerbereit */
  readyAt: number;
}

/** Angekündigter Feuerschlag (für die Warnanzeige) */
export interface Barrage {
  side: number;
  x: number;
  y: number;
  /** Zeitpunkt des ersten Einschlags */
  fireAt: number;
  /** bis dahin schlagen Granaten ein */
  until: number;
}

/** Granate im Flug */
export interface Shell {
  side: number;
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  t0: number;
  dur: number;
  /** direkter Schuss (flach), sonst Steilfeuer im Bogen */
  direct: boolean;
  /** Ziel bei Direktschuss (Panzer), sonst -1 */
  target: number;
  kind: "he" | "smoke" | "gas" | "cannon" | "at" | "grenade";
  /** Trefferfaktor bei Direktschuss (Nebel zwischen Schütze und Ziel) */
  acc?: number;
}

/** Nebelwand: behindert die Sicht und damit das Zielen */
export interface Smoke {
  x: number;
  y: number;
  r: number;
  t0: number;
  until: number;
  /** Gaswolke statt Nebel: blockiert keine Sicht, setzt aber zu */
  gas?: boolean;
  /** Wer das Gas geschossen hat */
  side?: number;
}

interface PendingShot {
  gun: number;
  at: number;
  x: number;
  y: number;
  kind: "he" | "smoke" | "gas";
}

export interface Fire {
  x: number;
  y: number;
  r: number;
  until: number;
}

export interface Objective {
  x: number;
  y: number;
  owner: number;
  /** Fortschritt der Gegenseite beim Einnehmen, 0..1 */
  capture: number;
  /** Wer gerade einnimmt (-1 = niemand) */
  capturer: number;
}

export interface SideState {
  /** feuerbereite Batterien */
  artyCharges: number;
  /** Batterien insgesamt */
  artyMax: number;
  /** Sekunden, bis die nächste Batterie bereit ist */
  artyTimer: number;
  reserves: number;
  reserveCooldown: number;
  initialStrength: number;
}

/** Ereignisse für Darstellung und Ton. Werden vom Renderer geleert. */
export interface BattleEvents {
  /** x1,y1,x2,y2,type,side */
  shots: number[];
  /** x,y,kind (0 Blut, 1 Funken, 2 Erde, 3 Schild) */
  hits: number[];
  /** x,y,side,type,angle */
  deaths: number[];
  /** x,y,r,kind (0 Granate, 1 Magie, 2 Mine, 3 Kanone, 4 Panzer explodiert, 5 Flammentank, 6 Handgranate, 7 Nebelgranate, 8 Gasgranate) */
  blasts: number[];
  /** x,y,r */
  craters: number[];
  /** x,y,angle,kind (0 Geschütz, 1 Panzerkanone) */
  gunfire: number[];
  /** x,y,angle */
  flames: number[];
  /** x,y,angle */
  tracks: number[];
  /** x,y,angle */
  wrecks: number[];
  /** x,y,kind (0 Trillerpfeife zum Sturm, 1 Gasalarm) */
  signals: number[];
}

/** Waffenarten für die Auswertung nach der Schlacht */
export const KILL_CAUSES = ["Gewehre", "MGs", "Artillerie", "Handgranaten", "Nahkampf", "Magie", "Gas", "Feuer", "Panzer", "Minen", "Tankgewehre"];
const C_RIFLE = 0, C_MG = 1, C_ARTY = 2, C_GRENADE = 3, C_MELEE = 4, C_MAGIC = 5, C_GAS = 6, C_FIRE = 7, C_TANK = 8, C_MINE = 9, C_AT = 10;

export interface BattleResult {
  winner: number;
  reason: string;
}

const MAX_UNITS = 16000;
const F_BROKEN = 1;

export class Battle {
  rng: Rng;
  terrain: Terrain;
  time = 0;

  // Einheiten als Struktur aus Arrays (schnell bei Tausenden Soldaten)
  n = 0;
  x = new Float32Array(MAX_UNITS);
  y = new Float32Array(MAX_UNITS);
  tx = new Float32Array(MAX_UNITS);
  ty = new Float32Array(MAX_UNITS);
  /** Zwischenhalt in Deckung, wenn der Soldat unter Beschuss liegt */
  hx = new Float32Array(MAX_UNITS);
  hy = new Float32Array(MAX_UNITS);
  ang = new Float32Array(MAX_UNITS);
  hp = new Float32Array(MAX_UNITS);
  reload = new Float32Array(MAX_UNITS);
  reload2 = new Float32Array(MAX_UNITS);
  think = new Float32Array(MAX_UNITS);
  suppress = new Float32Array(MAX_UNITS);
  tgt = new Int32Array(MAX_UNITS);
  claimCell = new Int32Array(MAX_UNITS);
  side = new Uint8Array(MAX_UNITS);
  type = new Uint8Array(MAX_UNITS);
  alive = new Uint8Array(MAX_UNITS);
  moving = new Uint8Array(MAX_UNITS);
  pinned = new Uint8Array(MAX_UNITS);
  flags = new Uint8Array(MAX_UNITS);
  comp = new Int16Array(MAX_UNITS);

  companies: Company[] = [];
  barrages: Barrage[] = [];
  shells: Shell[] = [];
  smokes: Smoke[] = [];
  fires: Fire[] = [];
  /** Wann hat die Artillerie einer Seite zuletzt gefeuert (verrät ihre Stellung) */
  lastGunfire = [-100, -100];
  objectives: Objective[] = [];
  sides: SideState[] = [];
  result: BattleResult | null = null;
  events: BattleEvents = {
    shots: [],
    hits: [],
    deaths: [],
    blasts: [],
    craters: [],
    gunfire: [],
    flames: [],
    tracks: [],
    wrecks: [],
    signals: [],
  };
  /** Ausgeschaltete Gegner je Seite und Waffenart (KILL_CAUSES) */
  kills: number[][] = [KILL_CAUSES.map(() => 0), KILL_CAUSES.map(() => 0)];
  /** Verluste durch eigenes Feuer (Gas, Artillerie, Handgranaten) je Seite */
  friendly = [0, 0];
  private dmgSide = -1;
  private dmgCause = 0;
  /** Gefallene (x, y, Seite, Typ, Winkel) – damit das Bild beim Öffnen wieder aufgebaut werden kann */
  corpses: number[] = [];
  /** Panzerspuren und Wracks für den Wiederaufbau des Bildes */
  scars: number[] = [];
  /** Kampagnenmodus: kein fester Aufbau, kein Sieg – Truppen kommen aus der Kampagne. */
  campaign: boolean;

  private grids = [new SpatialGrid(MAX_UNITS), new SpatialGrid(MAX_UNITS)];
  private ids = [new Int32Array(MAX_UNITS), new Int32Array(MAX_UNITS)];
  private idCount = [0, 0];
  private special: number[][][] = []; // [side][type] → ids (Magier, Panzer, Geschütze)
  private tmp = { x: 0, y: 0 };
  private companyStamp: number[] = [];
  private stamp = 0;
  private pending: PendingShot[] = [];
  private mineTimer = 0;

  constructor(seed = 1, opts: { campaign?: boolean; biome?: Biome; big?: boolean } = {}) {
    this.rng = new Rng(seed);
    this.terrain = new Terrain(this.rng, opts.biome);
    this.campaign = opts.campaign ?? false;
    for (let s = 0; s < 2; s++) {
      this.sides.push({ artyCharges: 0, artyMax: 0, artyTimer: 0, reserves: this.campaign ? 0 : START_RESERVES, reserveCooldown: 0, initialStrength: 0 });
      for (const x of [WORLD_W / 6, WORLD_W / 2, (WORLD_W * 5) / 6]) {
        this.objectives.push({ x, y: this.terrain.frontY(s, x), owner: s, capture: 0, capturer: -1 });
      }
    }
    if (!this.campaign) {
      if (opts.big) this.deployBig();
      else this.deployDefault();
    }
  }

  /** Großschlacht: rund 4.000 Mann je Seite mit allen Waffengattungen */
  private deployBig() {
    const t = this.terrain;
    const xs = [160, 480, 800, 1120, 1440];
    for (let s = 0; s < 2; s++) {
      const n = (i: number) => (s === 0 ? `${i}. Kompanie` : `${i}e Cie`);
      let k = 1;
      // Tiefe Verteidigung: vorn dünner besetzt, dahinter die Masse
      for (const x of xs) this.createCompany(s, UNIT_RIFLE, n(k++), x, t.frontY(s, x), 180);
      for (const x of xs) this.createCompany(s, UNIT_RIFLE, n(k++), x, t.supportY(s, x), 280);
      for (const x of [300, 650, 950, 1300]) {
        const y = (t.supportY(s, x) + GUN_Y[s]) / 2 - FORWARD[s] * 20;
        this.createCompany(s, UNIT_RIFLE, n(k++), x, y, 300);
      }
      const spots = this.mgSpots(s);
      for (let i = 0; i < 4; i++) {
        const sp = spots[i % spots.length];
        this.createCompany(s, UNIT_MG, s === 0 ? `MG-Zug ${"ABCD"[i]}` : `Mitrailleuses ${"ABCD"[i]}`, sp.x + Math.floor(i / spots.length) * 60, sp.y, MG_PER_SECTION);
      }
      for (const x of [560, 1040]) this.createCompany(s, UNIT_AT, s === 0 ? "Tankgewehr-Trupp" : "Fusils antichar", x, t.frontY(s, x), AT_PER_SQUAD);
      for (const x of [240, 800, 1360]) this.createCompany(s, UNIT_STORM, s === 0 ? "Stoßtrupp" : "Corps franc", x, t.supportY(s, x), STORM_PER_SQUAD);
      for (const x of [400, 1200]) this.createCompany(s, UNIT_FLAME, s === 0 ? "Flammenwerfer" : "Lance-flammes", x, t.supportY(s, x), FLAME_PER_SQUAD);
      for (const x of [500, 1100]) {
        const y = this.tankPark(s, x);
        this.createCompany(s, UNIT_TANK, s === 0 ? "Panzerzug" : "Chars d'assaut", x, y, TANKS_PER_PLATOON);
      }
      [400, 800, 1200].forEach((x, i) => this.createCompany(s, UNIT_GUN, s === 0 ? `${i + 1}. Batterie` : `${i + 1}e Batterie`, x, GUN_Y[s], GUNS_PER_BATTERY));
      for (const x of [500, 1100]) this.createCompany(s, UNIT_MAGE, s === 0 ? "Magier „Sturmvogel“" : "Mages „Corbeau“", x, REAR_Y[s], MAGES_PER_SQUAD);
    }
    for (let s = 0; s < 2; s++) this.sides[s].initialStrength = this.groundStrength(s);
  }

  private deployDefault() {
    const names = [
      ["1. Kompanie", "2. Kompanie", "3. Kompanie", "4. Kompanie", "5. Kompanie", "6. Kompanie"],
      ["1re Cie", "2e Cie", "3e Cie", "4e Cie", "5e Cie", "6e Cie"],
    ];
    const t = this.terrain;
    for (let s = 0; s < 2; s++) {
      const lanes = [WORLD_W / 6, WORLD_W / 2, (WORLD_W * 5) / 6];
      lanes.forEach((x, i) => this.createCompany(s, UNIT_RIFLE, names[s][i], x, t.frontY(s, x), 200));
      lanes.forEach((x, i) => this.createCompany(s, UNIT_RIFLE, names[s][i + 3], x, t.supportY(s, x), 200));
      const mgSpots = this.mgSpots(s);
      this.createCompany(s, UNIT_MG, s === 0 ? "MG-Zug A" : "Mitrailleuses A", mgSpots[0].x, mgSpots[0].y, MG_PER_SECTION);
      this.createCompany(s, UNIT_MG, s === 0 ? "MG-Zug B" : "Mitrailleuses B", mgSpots[1].x, mgSpots[1].y, MG_PER_SECTION);
      this.createCompany(s, UNIT_AT, s === 0 ? "Tankgewehr-Trupp" : "Fusils antichar", WORLD_W / 2 + 120, t.frontY(s, WORLD_W / 2 + 120), AT_PER_SQUAD);
      this.createCompany(s, UNIT_FLAME, s === 0 ? "Flammenwerfer" : "Lance-flammes", WORLD_W / 2 - 150, t.supportY(s, WORLD_W / 2 - 150), FLAME_PER_SQUAD);
      this.createCompany(s, UNIT_STORM, s === 0 ? "Stoßtrupp" : "Corps franc", WORLD_W / 2 + 150, t.supportY(s, WORLD_W / 2 + 150), STORM_PER_SQUAD);
      const tankY = this.tankPark(s, WORLD_W / 2);
      this.createCompany(s, UNIT_TANK, s === 0 ? "Panzerzug" : "Chars d'assaut", WORLD_W / 2, tankY, TANKS_PER_PLATOON);
      this.createCompany(s, UNIT_GUN, s === 0 ? "1. Batterie" : "1re Batterie", WORLD_W / 2 - 250, GUN_Y[s], GUNS_PER_BATTERY);
      this.createCompany(s, UNIT_GUN, s === 0 ? "2. Batterie" : "2e Batterie", WORLD_W / 2 + 250, GUN_Y[s], GUNS_PER_BATTERY);
      this.createCompany(s, UNIT_MAGE, s === 0 ? "Magier „Sturmvogel“" : "Mages „Corbeau“", WORLD_W / 2 - 300, REAR_Y[s], MAGES_PER_SQUAD);
    }
    for (let s = 0; s < 2; s++) this.sides[s].initialStrength = this.groundStrength(s);
  }

  /** Gute Plätze für MGs: Bunker der Seite, sonst an den Flankengrenzen */
  /** Bereitstellung der Panzer: dicht hinter dem Unterstützungsgraben, damit sie rechtzeitig vorn sind */
  tankPark(side: number, x: number): number {
    const sy = this.terrain.supportY(side, x);
    return sy + (GUN_Y[side] - sy) * 0.22;
  }

  mgSpots(side: number): { x: number; y: number }[] {
    const b = this.terrain.bunkers.filter((k) => k.side === side).map((k) => ({ x: k.x, y: k.y }));
    const fallback = [WORLD_W / 3, (WORLD_W * 2) / 3].map((x) => ({ x, y: this.terrain.frontY(side, x) }));
    return [...b, ...fallback];
  }

  // ---------------------------------------------------------------- Befehle

  orderMove(companyId: number, x: number, y: number) {
    const c = this.companies[companyId];
    if (!c || c.alive === 0 || c.order === "rout" || c.type === UNIT_GUN) return;
    this.setTarget(c, x, y, "advance");
  }

  orderStorm(companyId: number, x: number, y: number) {
    const c = this.companies[companyId];
    if (!c || c.alive === 0 || c.order === "rout" || c.type === UNIT_GUN) return;
    const plain = c.type === UNIT_MAGE || c.type === UNIT_TANK || c.type === UNIT_MG;
    this.setTarget(c, x, y, plain ? "advance" : "storm");
  }

  orderHold(companyId: number) {
    const c = this.companies[companyId];
    if (!c || c.alive === 0 || c.order === "rout" || c.type === UNIT_GUN) return;
    c.order = "advance";
    c.tx = c.cx;
    c.ty = c.cy;
    for (const id of c.members) {
      if (!this.alive[id]) continue;
      this.pinned[id] = 0;
      if (c.type === UNIT_MAGE || c.type === UNIT_TANK) {
        this.tx[id] = this.x[id];
        this.ty[id] = this.y[id];
      } else this.place(id, this.x[id], this.y[id], 14);
    }
  }

  orderRetreat(companyId: number) {
    const c = this.companies[companyId];
    if (!c || c.alive === 0 || c.order === "rout" || c.type === UNIT_GUN) return;
    this.setTarget(c, c.homeX, c.homeY, "retreat");
  }

  /** Feuerschlag: eine bereite Batterie beschießt das Zielgebiet. */
  /** Reicht die Artillerie dorthin? Nur bis knapp hinter den feindlichen vorderen Graben. */
  inArtyRange(side: number, x: number, y: number): boolean {
    return (y - this.terrain.frontY(1 - side, x)) * FORWARD[side] <= ARTY_DEPTH;
  }

  callArtillery(side: number, x: number, y: number, kind: "he" | "smoke" | "gas" = "he"): boolean {
    if (this.result) return false;
    x = clamp(x, 0, WORLD_W);
    y = clamp(y, 0, WORLD_H);
    if (!this.inArtyRange(side, x, y)) return false;
    const battery = this.companies.find((c) => c.side === side && c.type === UNIT_GUN && c.alive > 0 && c.readyAt <= this.time);
    if (!battery) return false;
    let first = Infinity;
    let last = 0;
    const guns = battery.members.filter((g) => this.alive[g]);
    guns.forEach((g, gi) => {
      const shots = kind === "smoke" ? 3 : kind === "gas" ? 2 : ARTY_SHELLS_PER_GUN;
      for (let k = 0; k < shots; k++) {
        const at = this.time + 0.5 + gi * 0.35 + k * ARTY_SHELL_INTERVAL + this.rng.next() * 0.4;
        this.pending.push({ gun: g, at, x, y, kind });
        const flight = Math.hypot(x - this.x[g], y - this.y[g]) / SHELL_SPEED + 1;
        first = Math.min(first, at + flight);
        last = Math.max(last, at + flight);
      }
    });
    battery.readyAt = this.time + (kind === "he" ? ARTY_RELOAD : ARTY_RELOAD * 0.7) + ARTY_SHELLS_PER_GUN * ARTY_SHELL_INTERVAL;
    this.barrages.push({ side, x, y, fireAt: first, until: last });
    return true;
  }

  callReserve(side: number): boolean {
    const s = this.sides[side];
    if (s.reserves <= 0 || s.reserveCooldown > 0 || this.result) return false;
    s.reserves--;
    s.reserveCooldown = RESERVE_COOLDOWN;
    const count = this.companies.filter((c) => c.side === side && c.type === UNIT_RIFLE).length;
    const name = side === 0 ? `${count + 1}. Kompanie (Res.)` : `${count + 1}e Cie (rés.)`;
    const x = 250 + this.rng.next() * (WORLD_W - 500);
    this.spawnCompany(side, UNIT_RIFLE, name, x, this.terrain.supportY(side, x), COMPANY_SIZE, -1, false);
    return true;
  }

  // ------------------------------------------------------------- Simulation

  update(dt = TICK) {
    if (this.result) return;
    this.time += dt;
    this.rebuildGrids();
    if (this.n > 3000 && this.idCount[0] + this.idCount[1] < this.n * 0.5) {
      this.compact();
      this.rebuildGrids();
    }
    this.updateUnits(dt);
    this.updateCompanies(dt);
    this.updateArtillery();
    this.updateMines(dt);
    this.updateFires(dt);
    this.updateSmoke(dt);
    this.updateSides(dt);
    this.updateObjectives(dt);
    if (!this.campaign && Math.floor(this.time) !== Math.floor(this.time - dt)) this.checkVictory();
  }

  clearEvents() {
    const e = this.events;
    e.shots.length = 0;
    e.hits.length = 0;
    e.deaths.length = 0;
    e.blasts.length = 0;
    e.craters.length = 0;
    e.gunfire.length = 0;
    e.flames.length = 0;
    e.tracks.length = 0;
    e.wrecks.length = 0;
    e.signals.length = 0;
  }

  /** Signal für Ton/Anzeige: 0 Trillerpfeife (Sturm), 1 Gasalarm */
  signal(x: number, y: number, kind: number) {
    this.events.signals.push(x, y, kind);
  }

  groundStrength(side: number): number {
    let n = 0;
    for (const c of this.companies) {
      if (c.side === side && c.type !== UNIT_MAGE && c.type !== UNIT_GUN) n += c.alive;
    }
    return n;
  }

  /** Einheiten eines Typs einer Seite (Magier, Panzer, Geschütze) – aktuell lebend */
  unitsOf(side: number, type: number): number[] {
    return this.special[side]?.[type] ?? [];
  }

  /** Plätze gefallener Soldaten freigeben, damit lange Gefechte nicht langsamer werden. */
  private compact() {
    const oldN = this.n;
    const map = new Int32Array(oldN).fill(-1);
    const arrays = [
      this.x, this.y, this.tx, this.ty, this.hx, this.hy, this.ang, this.hp, this.reload, this.reload2,
      this.think, this.suppress, this.tgt, this.claimCell, this.side, this.type, this.alive, this.moving,
      this.pinned, this.flags, this.comp,
    ];
    let k = 0;
    for (let i = 0; i < oldN; i++) {
      if (!this.alive[i]) continue;
      map[i] = k;
      if (k !== i) for (const a of arrays) a[k] = a[i];
      k++;
    }
    for (let i = 0; i < k; i++) {
      const t = this.tgt[i];
      this.tgt[i] = t >= 0 && t < oldN ? map[t] : -1;
      if (this.claimCell[i] >= 0) this.terrain.claim[this.claimCell[i]] = i;
    }
    this.alive.fill(0, k, oldN);
    for (const c of this.companies) {
      if (c.alive <= 0) {
        c.members = [];
        continue;
      }
      const next: number[] = [];
      for (const m of c.members) if (map[m] >= 0) next.push(map[m]);
      c.members = next;
    }
    for (const p of this.pending) p.gun = p.gun < oldN ? map[p.gun] : -1;
    this.pending = this.pending.filter((p) => p.gun >= 0);
    for (const s of this.shells) if (s.target >= 0) s.target = s.target < oldN ? map[s.target] : -1;
    this.n = k;
  }

  private rebuildGrids() {
    this.idCount[0] = 0;
    this.idCount[1] = 0;
    this.special = [[], []];
    for (let s = 0; s < 2; s++) for (let t = 0; t <= UNIT_STORM; t++) this.special[s][t] = [];
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const s = this.side[i];
      const t = this.type[i];
      if (t === UNIT_MAGE || t === UNIT_TANK || t === UNIT_GUN) this.special[s][t].push(i);
      if (t === UNIT_MAGE) continue; // Magier fliegen: nicht im Bodenraster (eigene Liste)
      this.ids[s][this.idCount[s]++] = i;
    }
    for (let s = 0; s < 2; s++) this.grids[s].rebuild(this.ids[s], this.idCount[s], this.x, this.y);
  }

  private updateUnits(dt: number) {
    const rng = this.rng;
    const terrain = this.terrain;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const c = this.companies[this.comp[i]];
      const type = this.type[i];
      const st = STATS[type];
      const isMage = type === UNIT_MAGE;
      const isTank = type === UNIT_TANK;
      const enemy = 1 - this.side[i];

      this.suppress[i] = Math.max(0, this.suppress[i] - 0.1 * dt);
      this.reload2[i] -= dt;
      if (isMage) this.hp[i] = Math.min(st.hp, this.hp[i] + MAGE_SHIELD_REGEN * dt);

      // --- Zielauswahl (nicht jeden Tick, das spart viel Rechenzeit)
      this.think[i] -= dt;
      if (this.think[i] <= 0) {
        this.tgt[i] = this.findTarget(i, enemy, Math.max(st.range, STORM_ENGAGE_RANGE));
        // Wer niemanden in Reichweite hat, schaut seltener nach (spart viel Rechenzeit)
        const base = c.order === "storm" ? 0.3 : this.tgt[i] < 0 && !this.moving[i] ? 1.8 : 0.8;
        this.think[i] = base + rng.next() * 0.4;
      }
      let t = this.tgt[i];
      if (t >= 0 && !this.alive[t]) t = this.tgt[i] = -1;
      let tDist = t >= 0 ? Math.hypot(this.x[t] - this.x[i], this.y[t] - this.y[i]) : Infinity;

      // --- Unter Beschuss in Deckung gehen (von Trichter zu Trichter)
      if (!isMage && !isTank && type !== UNIT_GUN && c.order === "advance") {
        if (!this.pinned[i] && this.moving[i] && this.suppress[i] > 0.55 && terrain.coverAt(this.x[i], this.y[i]) < 0.3) {
          const fx = this.x[i] + (this.tx[i] - this.x[i]) * 0.15;
          const fy = this.y[i] + (this.ty[i] - this.y[i]) * 0.15;
          const cell = terrain.findSpot(fx, fy, 18, i, this.tmp);
          if (cell >= 0 && terrain.cover[cell] >= 0.4) {
            this.release(i);
            this.claimCell[i] = cell;
            this.hx[i] = this.tmp.x;
            this.hy[i] = this.tmp.y;
            this.pinned[i] = 1;
          } else terrain.release(cell, i);
        } else if (this.pinned[i] && this.suppress[i] < 0.2) {
          this.pinned[i] = 0;
          this.release(i);
          this.claimCell[i] = terrain.findSpot(this.tx[i], this.ty[i], 10, i, this.tmp);
          this.tx[i] = this.tmp.x;
          this.ty[i] = this.tmp.y;
        }
      } else if (this.pinned[i]) this.pinned[i] = 0;

      // --- Bewegung
      let gx = this.pinned[i] ? this.hx[i] : this.tx[i];
      let gy = this.pinned[i] ? this.hy[i] : this.ty[i];
      const engaging = c.order === "storm" && t >= 0 && tDist < STORM_ENGAGE_RANGE && this.type[t] !== UNIT_MAGE && !STATS[this.type[t]].armored;
      if (engaging) {
        gx = this.x[t];
        gy = this.y[t];
      }
      const dx = gx - this.x[i];
      const dy = gy - this.y[i];
      const d = Math.hypot(dx, dy);
      const stopDist = engaging ? 4 : isTank ? 4 : 1.2;
      const broken = (this.flags[i] & F_BROKEN) !== 0;
      if (d > stopDist && st.walk > 0 && !broken) {
        let speed = c.order === "advance" ? st.walk : st.run;
        if (isTank) {
          speed *= terrain.tankSlowAt(this.x[i], this.y[i]);
          // Panzer drehen langsam
          const want = Math.atan2(dy, dx);
          const diff = wrapAngle(want - this.ang[i]);
          this.ang[i] += clamp(diff, -0.9 * dt, 0.9 * dt);
          if (Math.abs(diff) > 0.6) speed *= 0.25;
          const step = Math.min(d, speed * dt);
          this.x[i] += Math.cos(this.ang[i]) * step;
          this.y[i] += Math.sin(this.ang[i]) * step;
          if (terrain.crushWire(this.x[i], this.y[i], 8)) this.events.hits.push(this.x[i], this.y[i], 2);
          if (rng.next() < dt * 2) {
            this.events.tracks.push(this.x[i], this.y[i], this.ang[i]);
            if (this.scars.length < 40000) this.scars.push(0, this.x[i], this.y[i], this.ang[i]);
          }
          if (rng.next() < TANK_BREAKDOWN_PER_SEC * dt) this.flags[i] |= F_BROKEN;
        } else {
          if (!isMage) {
            speed *= terrain.slowAt(this.x[i], this.y[i]);
            if (c.order === "advance") speed *= 1 - 0.6 * this.suppress[i];
          }
          const step = Math.min(d - stopDist * 0.5, speed * dt);
          this.x[i] += (dx / d) * step;
          this.y[i] += (dy / d) * step;
          if (!engaging || tDist > 8) this.ang[i] = Math.atan2(dy, dx);
          if (!isMage) this.separate(i);
        }
        this.moving[i] = 1;
      } else {
        this.moving[i] = 0;
      }

      // --- Feuern / Nahkampf
      if (isTank) this.tankCannon(i);
      this.reload[i] -= dt;
      if (this.reload[i] > 0 || c.order === "rout") continue;
      if (type === UNIT_GUN) {
        this.gunDirectFire(i);
        continue;
      }
      if (t < 0) continue;
      tDist = Math.hypot(this.x[t] - this.x[i], this.y[t] - this.y[i]);
      const tType = this.type[t];
      // Handgranate auf Gegner in Deckung (Grabenkampf)
      if (st.grenades && this.reload2[i] <= 0 && tDist < GRENADE_RANGE && tDist > 5 && c.order !== "retreat" && !STATS[tType].armored && tType !== UNIT_MAGE) {
        if (c.order === "storm" || terrain.coverAt(this.x[t], this.y[t]) >= 0.4) {
          this.throwGrenade(i, t);
          this.reload[i] = 1.2;
          continue;
        }
      }
      const targetIsMage = tType === UNIT_MAGE;
      const targetArmored = STATS[tType].armored === true;

      if (!isMage && !isTank && !targetIsMage && !targetArmored && tDist <= MELEE_RANGE && type !== UNIT_FLAME) {
        let p = MELEE_KILL + (c.order === "storm" ? 0.15 : 0);
        if (this.companies[this.comp[t]].order === "rout") p += 0.3;
        this.by(this.side[i], C_MELEE);
        if (rng.next() < p) this.damage(t, 1, this.ang[i]);
        this.ang[i] = Math.atan2(this.y[t] - this.y[i], this.x[t] - this.x[i]);
        this.reload[i] = 1.2 + rng.next();
        continue;
      }
      if (c.order === "retreat") continue;
      if (this.moving[i] && !st.fireWhileMoving) {
        this.reload[i] = 0.3;
        continue;
      }
      if (tDist > st.range) {
        this.reload[i] = 0.3;
        continue;
      }
      // Unter schwerem Feuer: Kopf runter, nicht mehr schießen (Trommelfeuer wirkt)
      if (this.suppress[i] > 0.75 && !isMage && !isTank && type !== UNIT_GUN) {
        this.reload[i] = 0.5 + rng.next();
        continue;
      }
      if (!isTank) this.ang[i] = Math.atan2(this.y[t] - this.y[i], this.x[t] - this.x[i]);

      if (isMage) {
        if (c.mana < MAGE_MANA_PER_SPELL) {
          this.reload[i] = 0.5;
          continue;
        }
        c.mana -= MAGE_MANA_PER_SPELL;
        this.castSpell(i, t, tDist);
      } else if (type === UNIT_FLAME) {
        this.flame(i);
      } else if (type === UNIT_AT && targetArmored) {
        const p = 0.4 * (1 - 0.5 * (tDist / st.range)) * (1 - 0.5 * this.suppress[i]) * this.sight(i, t);
        const hit = rng.next() < p;
        this.events.shots.push(this.x[i], this.y[i], this.x[t], this.y[t], UNIT_AT, this.side[i]);
        if (hit) {
          this.by(this.side[i], C_AT);
          this.damage(t, AT_DAMAGE, this.ang[i]);
          this.events.hits.push(this.x[t], this.y[t], 1);
        }
      } else {
        this.rifleShot(i, t, tDist, st.hit * (type === UNIT_AT ? 0.8 : 1));
      }
      this.reload[i] = st.reload + rng.next() * st.reloadJitter;
    }
  }

  /** Gewehr-/MG-Schuss mit Deckung, Niederhalten und Panzerung */
  private rifleShot(i: number, t: number, dist: number, baseHit: number) {
    const rng = this.rng;
    this.by(this.side[i], this.type[i] === UNIT_MG ? C_MG : this.type[i] === UNIT_TANK ? C_TANK : C_RIFLE);
    const st = STATS[this.type[i]];
    const tType = this.type[t];
    const sight = this.alongTrench(i, t) ? 0.05 : this.sight(i, t);
    let p = baseHit * (1 - (st.falloff ?? 0.75) * (dist / st.range)) * (1 - 0.6 * this.suppress[i]) * sight;
    if (tType === UNIT_MAGE) p *= MAGE_EVASION * (this.type[i] === UNIT_MG ? 1.6 : 1);
    else {
      let cover = this.terrain.coverAt(this.x[t], this.y[t]);
      // Von der Seite geschossen: Trichterrand, Ruine oder Wrack schützen nur nach vorn.
      // Gräben nicht – ihre Traversen (Zickzack) verhindern Längsfeuer; dort hilft nur die Handgranate.
      if (cover > 0 && Math.abs(this.x[t] - this.x[i]) > 2 * Math.abs(this.y[t] - this.y[i])) {
        const k = this.terrain.kindAt(this.x[t], this.y[t]);
        if (k !== K_TRENCH && k !== K_BUNKER) cover *= ENFILADE_COVER;
      }
      p *= 1 - cover;
      // Wer im Laufschritt stürmt, ist schwer zu treffen
      if (this.moving[t] && this.companies[this.comp[t]].order === "storm") p *= RUNNING_TARGET;
    }
    // Blind ins Nebelfeld geschossen hält kaum nieder
    this.pin(t, st.suppress * (0.3 + 0.7 * sight));
    let ex = this.x[t];
    let ey = this.y[t];
    if (rng.next() < p) {
      if (STATS[tType].armored) {
        // Prallt meist ab – nur selten trifft etwas durch die Sehschlitze
        this.events.hits.push(ex, ey, 1);
        if (rng.next() < 0.04) this.damage(t, 1, this.ang[i]);
      } else if (tType === UNIT_MAGE) {
        this.events.hits.push(ex, ey, 3);
        this.damage(t, 1, this.ang[i]);
      } else {
        this.events.hits.push(ex, ey, 0);
        this.damage(t, 1, this.ang[i]);
      }
    } else {
      ex += rng.gauss() * 7;
      ey += rng.gauss() * 7;
      if (tType !== UNIT_MAGE) this.events.hits.push(ex, ey, 2);
    }
    this.events.shots.push(this.x[i], this.y[i], ex, ey, this.type[i], this.side[i]);
  }

  private findTarget(i: number, enemy: number, range: number): number {
    const x = this.x[i];
    const y = this.y[i];
    const type = this.type[i];
    const nearestOf = (list: number[], r: number) => {
      let best = -1;
      let bd = r;
      for (const m of list) {
        const d = Math.hypot(this.x[m] - x, this.y[m] - y);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      return best;
    };
    if (type === UNIT_MAGE) {
      const m = nearestOf(this.unitsOf(enemy, UNIT_MAGE), STATS[UNIT_MAGE].range);
      if (m >= 0) return m;
    }
    if (type === UNIT_AT) {
      const tk = nearestOf(this.unitsOf(enemy, UNIT_TANK), STATS[UNIT_AT].range);
      if (tk >= 0) return tk;
    }
    // Wer im Graben liegt, sieht nicht längs durch den Graben (Traversen)
    const k = this.terrain.kindAt(x, y);
    const inTrench = k === K_TRENCH || k === K_BUNKER;
    const ground = this.grids[enemy].nearest(x, y, range, this.x, this.y, inTrench ? (id) => !this.alongTrench(i, id) : undefined);
    // Flugabwehr gab es kaum: Magier werden nur beschossen, wenn sie nah sind
    if (type === UNIT_RIFLE || type === UNIT_MG) {
      const m = nearestOf(this.unitsOf(enemy, UNIT_MAGE), Math.min(range, 200));
      if (m >= 0 && (ground < 0 || Math.hypot(this.x[m] - x, this.y[m] - y) < this.grids[enemy].lastDist)) return m;
    }
    return ground;
  }

  private separate(i: number) {
    const g = this.grids[this.side[i]];
    const r = STATS[this.type[i]].radius * 1.4;
    g.forEachInRadius(this.x[i], this.y[i], r, this.x, this.y, (j, d) => {
      if (j === i || d <= 0.01 || !this.alive[j] || this.type[j] === UNIT_TANK) return;
      const push = ((r - d) / r) * 0.35;
      this.x[i] += ((this.x[i] - this.x[j]) / d) * push;
      this.y[i] += ((this.y[i] - this.y[j]) / d) * push;
    });
  }

  private castSpell(i: number, t: number, dist: number) {
    const rng = this.rng;
    this.by(this.side[i], C_MAGIC);
    const st = STATS[UNIT_MAGE];
    const acc = st.hit * (1 - 0.4 * (dist / st.range));
    let ex = this.x[t];
    let ey = this.y[t];
    this.events.shots.push(this.x[i], this.y[i], ex, ey, UNIT_MAGE, this.side[i]);
    if (this.type[t] === UNIT_MAGE) {
      if (rng.next() < acc) {
        this.damage(t, 3, this.ang[i]);
        this.events.hits.push(ex, ey, 3);
      }
      this.events.blasts.push(ex, ey, 6, 1);
      return;
    }
    if (rng.next() > acc) {
      ex += rng.gauss() * 18;
      ey += rng.gauss() * 18;
    }
    this.events.blasts.push(ex, ey, MAGE_SPELL_RADIUS, 1);
    const enemy = 1 - this.side[i];
    this.grids[enemy].forEachInRadius(ex, ey, MAGE_SPELL_RADIUS * 2, this.x, this.y, (id, d) => {
      if (!this.alive[id]) return;
      this.pin(id, st.suppress * (1 - d / (MAGE_SPELL_RADIUS * 2)));
      if (d > MAGE_SPELL_RADIUS) return;
      if (STATS[this.type[id]].armored) {
        this.damage(id, 3, 0);
        return;
      }
      const cover = this.terrain.coverAt(this.x[id], this.y[id]);
      const p = MAGE_SPELL_KILL * (1 - cover * 0.6) * (1 - (d / MAGE_SPELL_RADIUS) * 0.5);
      if (this.rng.next() < p) this.damage(id, 1, Math.atan2(this.y[id] - ey, this.x[id] - ex));
    });
  }

  /** Flammenwerfer: Kegel vor dem Schützen, Deckung hilft kaum */
  private flame(i: number) {
    this.by(this.side[i], C_FIRE);
    const a = this.ang[i];
    const range = STATS[UNIT_FLAME].range;
    this.events.flames.push(this.x[i], this.y[i], a);
    const enemy = 1 - this.side[i];
    this.grids[enemy].forEachInRadius(this.x[i], this.y[i], range, this.x, this.y, (id, d) => {
      if (!this.alive[id]) return;
      const da = Math.abs(wrapAngle(Math.atan2(this.y[id] - this.y[i], this.x[id] - this.x[i]) - a));
      if (da > FLAME_CONE) return;
      this.pin(id, 1);
      const c = this.companies[this.comp[id]];
      c.morale -= 0.4;
      if (STATS[this.type[id]].armored) return;
      const cover = this.terrain.coverAt(this.x[id], this.y[id]);
      if (this.rng.next() < STATS[UNIT_FLAME].hit * (1 - cover * 0.3) * (1.2 - d / range)) this.damage(id, 1, a);
    });
    if (this.rng.next() < 0.15) {
      const d = range * (0.6 + this.rng.next() * 0.4);
      this.fires.push({ x: this.x[i] + Math.cos(a) * d, y: this.y[i] + Math.sin(a) * d, r: 5, until: this.time + FIRE_DURATION });
    }
  }

  /** Panzerkanone: kleine Sprenggranate auf MGs, Geschütze oder Menschenansammlungen */
  private tankCannon(i: number) {
    this.by(this.side[i], C_TANK);
    if (this.reload2[i] > 0) return;
    const enemy = 1 - this.side[i];
    let target = -1;
    let bd = TANK_CANNON_RANGE;
    for (const list of [this.unitsOf(enemy, UNIT_TANK), this.unitsOf(enemy, UNIT_GUN)]) {
      for (const m of list) {
        const d = Math.hypot(this.x[m] - this.x[i], this.y[m] - this.y[i]);
        if (d < bd) {
          bd = d;
          target = m;
        }
      }
    }
    if (target < 0) target = this.grids[enemy].nearest(this.x[i], this.y[i], TANK_CANNON_RANGE, this.x, this.y);
    if (target < 0) {
      this.reload2[i] = 1;
      return;
    }
    const a = Math.atan2(this.y[target] - this.y[i], this.x[target] - this.x[i]);
    const d = Math.hypot(this.x[target] - this.x[i], this.y[target] - this.y[i]);
    const spread = d * 0.05 + (1 - this.sight(i, target)) * 30;
    this.shells.push({
      side: this.side[i],
      sx: this.x[i] + Math.cos(a) * 10,
      sy: this.y[i] + Math.sin(a) * 10,
      tx: this.x[target] + this.rng.gauss() * spread,
      ty: this.y[target] + this.rng.gauss() * spread,
      t0: this.time,
      dur: 0.15 + d / 1400,
      direct: true,
      target: STATS[this.type[target]].armored ? target : -1,
      kind: "cannon",
    });
    this.events.gunfire.push(this.x[i], this.y[i], a, 1);
    this.reload2[i] = TANK_CANNON_RELOAD + this.rng.next() * 2;
  }

  /** Feldgeschütz schießt direkt auf Panzer in Reichweite */
  private gunDirectFire(i: number) {
    const enemy = 1 - this.side[i];
    const busy = this.pending.some((p) => p.gun === i);
    let target = -1;
    let bd = STATS[UNIT_GUN].range;
    for (const m of this.unitsOf(enemy, UNIT_TANK)) {
      const d = Math.hypot(this.x[m] - this.x[i], this.y[m] - this.y[i]);
      if (d < bd) {
        bd = d;
        target = m;
      }
    }
    if (busy || target < 0) {
      this.reload[i] = 1;
      return;
    }
    const a = Math.atan2(this.y[target] - this.y[i], this.x[target] - this.x[i]);
    this.ang[i] = a;
    this.shells.push({
      side: this.side[i],
      sx: this.x[i],
      sy: this.y[i],
      tx: this.x[target] + this.rng.gauss() * 8,
      ty: this.y[target] + this.rng.gauss() * 8,
      t0: this.time,
      dur: 0.2 + bd / 1500,
      direct: true,
      target,
      kind: "at",
      acc: this.sight(i, target),
    });
    this.events.gunfire.push(this.x[i], this.y[i], a, 0);
    this.reload[i] = STATS[UNIT_GUN].reload + this.rng.next();
  }

  /** Niederhalten – abgeschwächt bei Einheiten mit starken Nerven (Stoßtrupps) */
  private pin(id: number, amount: number) {
    const nerve = STATS[this.type[id]].nerve ?? 1;
    this.suppress[id] = Math.min(1, this.suppress[id] + amount * nerve);
  }

  /** Wie viele Soldaten (ohne Magier) einer Seite stehen im Umkreis? */
  countNear(side: number, x: number, y: number, r: number): number {
    let n = 0;
    this.grids[side].forEachInRadius(x, y, r, this.x, this.y, (id) => {
      if (this.alive[id] && this.type[id] !== UNIT_MAGE) n++;
    });
    return n;
  }

  /**
   * Längs durch denselben Graben kann man nicht weit sehen: Traversen (Zickzack) versperren
   * nach wenigen Metern die Sicht. Gilt für beide im Graben, wenn die Linie überwiegend seitlich läuft.
   */
  alongTrench(i: number, t: number): boolean {
    const dx = Math.abs(this.x[t] - this.x[i]);
    if (dx < 40 || Math.abs(this.y[t] - this.y[i]) * 2 > dx) return false;
    const ki = this.terrain.kindAt(this.x[i], this.y[i]);
    if (ki !== K_TRENCH && ki !== K_BUNKER) return false;
    const kt = this.terrain.kindAt(this.x[t], this.y[t]);
    return kt === K_TRENCH || kt === K_BUNKER;
  }

  /** Sicht zwischen zwei Einheiten: 1 = frei, bis 1 - SMOKE_BLOCK mitten durch dichten Nebel */
  sight(i: number, t: number): number {
    if (this.smokes.length === 0) return 1;
    return 1 - SMOKE_BLOCK * this.smokeBetween(this.x[i], this.y[i], this.x[t], this.y[t]);
  }

  /** Nebeldichte entlang einer Sichtlinie (0..1) */
  smokeBetween(x1: number, y1: number, x2: number, y2: number): number {
    // Mehrere Schwaden hintereinander verdichten sich
    let clear = 1;
    for (const sm of this.smokes) {
      if (sm.gas) continue;
      const d = distToSegment(sm.x, sm.y, x1, y1, x2, y2);
      if (d >= sm.r) continue;
      const age = this.time - sm.t0;
      const fade = Math.min(1, age / 3) * Math.min(1, (sm.until - this.time) / 10);
      clear *= 1 - Math.min(1, 1.3 * (1 - (d / sm.r) ** 2)) * fade;
    }
    return 1 - clear;
  }

  private gasTimer = 0;

  private updateSmoke(dt: number) {
    if (this.smokes.length === 0) return;
    for (const sm of this.smokes) sm.x += WIND * dt;
    this.smokes = this.smokes.filter((sm) => sm.until > this.time);
    // Gas wirkt alle Viertelsekunde auf alle darin (beide Seiten – der Wind fragt nicht)
    this.gasTimer += dt;
    if (this.gasTimer < 0.25) return;
    const step = this.gasTimer;
    this.gasTimer = 0;
    for (const sm of this.smokes) {
      if (!sm.gas) continue;
      this.by(sm.side ?? -1, C_GAS);
      const age = this.time - sm.t0;
      const strength = Math.min(1, age / 4) * Math.min(1, (sm.until - this.time) / 15);
      for (let s = 0; s < 2; s++) {
        this.grids[s].forEachInRadius(sm.x, sm.y, sm.r, this.x, this.y, (id, d) => {
          if (!this.alive[id]) return;
          const t = this.type[id];
          if (t === UNIT_MAGE || t === UNIT_TANK) return; // Magier schweben darüber, Panzer sind dicht
          const k = strength * (1 - (d / sm.r) ** 2);
          this.pin(id, GAS_SUPPRESS * k * step);
          if (this.rng.next() < GAS_CASUALTY_RATE * k * step) this.damage(id, 1, 0);
        });
      }
    }
  }

  private throwGrenade(i: number, t: number) {
    const d = Math.hypot(this.x[t] - this.x[i], this.y[t] - this.y[i]);
    this.ang[i] = Math.atan2(this.y[t] - this.y[i], this.x[t] - this.x[i]);
    this.shells.push({
      side: this.side[i],
      sx: this.x[i],
      sy: this.y[i],
      tx: this.x[t] + this.rng.gauss() * 2.5,
      ty: this.y[t] + this.rng.gauss() * 2.5,
      t0: this.time,
      dur: 0.5 + d / 40,
      direct: false,
      target: -1,
      kind: "grenade",
    });
    this.reload2[i] = GRENADE_RELOAD * (this.type[i] === UNIT_STORM ? 0.55 : 1) + this.rng.next() * 3;
  }

  private grenadeImpact(s: Shell) {
    this.by(s.side, C_GRENADE);
    const enemy = 1 - s.side;
    this.grids[enemy].forEachInRadius(s.tx, s.ty, GRENADE_RADIUS * 2, this.x, this.y, (id, d) => {
      if (!this.alive[id] || STATS[this.type[id]].armored) return;
      this.pin(id, 0.5);
      if (d > GRENADE_RADIUS) return;
      // Im Graben hilft Deckung gegen Handgranaten nur wenig
      const cover = this.terrain.coverAt(this.x[id], this.y[id]);
      const p = 0.6 * (1 - cover * 0.35) * (1 - (d / GRENADE_RADIUS) * 0.5);
      if (this.rng.next() < p) this.damage(id, 1, Math.atan2(this.y[id] - s.ty, this.x[id] - s.tx));
    });
    this.events.blasts.push(s.tx, s.ty, GRENADE_RADIUS, 6);
  }

  /** Wer gerade trifft und womit (für die Auswertung) */
  private by(side: number, cause: number) {
    this.dmgSide = side;
    this.dmgCause = cause;
  }

  private damage(id: number, amount: number, angle: number) {
    if (!this.alive[id]) return;
    this.hp[id] -= amount;
    if (this.hp[id] > 0) return;
    this.alive[id] = 0;
    this.release(id);
    const c = this.companies[this.comp[id]];
    c.alive--;
    c.lastLoss = this.time;
    const victim = this.side[id];
    if (this.dmgSide === victim) this.friendly[victim]++;
    else this.kills[this.dmgSide < 0 ? 1 - victim : this.dmgSide][this.dmgCause]++;
    const type = this.type[id];
    if (type === UNIT_RIFLE || type === UNIT_AT || type === UNIT_FLAME || type === UNIT_STORM) c.morale -= (MORALE_PER_LOSS / c.initial) * oddsFear(c.odds);
    else if (type === UNIT_MG) c.morale -= 12;
    else if (type === UNIT_TANK) c.morale -= 25;
    const x = this.x[id];
    const y = this.y[id];
    const a = type === UNIT_TANK ? this.ang[id] : angle;
    this.events.deaths.push(x, y, this.side[id], type, a);
    if (type === UNIT_TANK || type === UNIT_GUN) {
      this.events.wrecks.push(x, y, this.ang[id]);
      if (this.scars.length < 40000) this.scars.push(type === UNIT_TANK ? 1 : 2, x, y, this.ang[id]);
      this.events.blasts.push(x, y, 14, 4);
      this.fires.push({ x, y, r: 10, until: this.time + FIRE_DURATION * 2 });
    } else if (this.corpses.length < 90000) this.corpses.push(x, y, this.side[id], type, a);
    // Getroffener Flammenwerfer-Tank geht in Flammen auf
    if (type === UNIT_FLAME && this.rng.next() < 0.5) {
      this.events.blasts.push(x, y, 10, 5);
      this.fires.push({ x, y, r: 9, until: this.time + FIRE_DURATION });
      for (let s = 0; s < 2; s++) {
        this.grids[s].forEachInRadius(x, y, 8, this.x, this.y, (j) => {
          if (j !== id && this.alive[j] && !STATS[this.type[j]].armored && this.rng.next() < 0.5) this.damage(j, 1, 0);
        });
      }
    }
  }

  private oddsTimer = 0;

  private updateCompanies(dt: number) {
    // Wer sieht, dass viele Kameraden um ihn sind und wenige Feinde, hält mehr aus – und umgekehrt
    this.oddsTimer -= dt;
    if (this.oddsTimer <= 0) {
      this.oddsTimer = 1;
      for (const c of this.companies) {
        if (c.alive <= 0 || c.type === UNIT_MAGE || c.type === UNIT_GUN) continue;
        const own = this.countNear(c.side, c.cx, c.cy, ODDS_RADIUS);
        const foe = this.countNear(1 - c.side, c.cx, c.cy, ODDS_RADIUS);
        c.odds = foe === 0 ? 4 : Math.max(0.25, Math.min(4, own / foe));
      }
    }
    for (const c of this.companies) {
      if (c.alive <= 0) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      let arrived = 0;
      let cover = 0;
      for (const id of c.members) {
        if (!this.alive[id]) continue;
        sx += this.x[id];
        sy += this.y[id];
        cover += this.terrain.coverAt(this.x[id], this.y[id]);
        n++;
        if (!this.moving[id]) arrived++;
      }
      c.alive = n;
      if (n === 0) continue;
      c.cx = sx / n;
      c.cy = sy / n;
      c.cover = cover / n;

      if (c.type === UNIT_MAGE) {
        const atHome = Math.hypot(c.cx - c.homeX, c.cy - c.homeY) < 60;
        if (atHome) c.mana = Math.min(MAGE_MANA_MAX, c.mana + MAGE_MANA_REGEN * dt);
        else c.mana = Math.max(0, c.mana - MAGE_MANA_DRAIN * dt);
        if (!atHome && c.mana < 12 && c.order !== "retreat") this.setTarget(c, c.homeX, c.homeY, "retreat");
        if (atHome && c.order === "retreat") c.order = "advance";
        continue;
      }
      if (c.type === UNIT_GUN || c.type === UNIT_TANK) continue; // keine Flucht

      if (this.time - c.lastLoss > 4) c.morale = Math.min(100, c.morale + 1.5 * dt);
      if (c.order === "rout") {
        c.morale = Math.min(100, c.morale + 2 * dt);
        const home = Math.hypot(c.cx - c.homeX, c.cy - c.homeY) < 60;
        if (home && c.morale >= MORALE_RALLY) this.setTarget(c, c.homeX, c.homeY, "advance");
      } else if (
        // Wer in guter Deckung liegt (Graben, Bunker), hält länger aus als im freien Feld
        c.morale <
        (c.order === "storm" ? MORALE_ROUT_STORM : MORALE_ROUT) * (c.type === UNIT_STORM ? 0.6 : 1) * (1 - 0.5 * c.cover) * oddsFear(c.odds)
      ) {
        this.setTarget(c, c.homeX, c.homeY, "rout");
      } else if (c.order === "storm" && arrived >= n * 0.8) {
        // Angekommen: im eroberten Abschnitt Stellung beziehen – wer nahe am feindlichen Graben ist, springt hinein
        c.order = "advance";
        const enemy = 1 - c.side;
        for (const id of c.members) {
          if (!this.alive[id]) continue;
          const ty = this.terrain.frontY(enemy, this.x[id]);
          if (Math.abs(this.y[id] - ty) < 70) this.place(id, this.x[id], ty, 22);
          else this.place(id, this.x[id], this.y[id], 18);
        }
      } else if (c.order === "retreat" && arrived >= n * 0.8) {
        c.order = "advance";
      }
    }
  }

  private updateArtillery() {
    // Geschütze feuern ihre Granaten ab
    const still: PendingShot[] = [];
    for (const p of this.pending) {
      if (p.at > this.time) {
        still.push(p);
        continue;
      }
      if (p.gun < 0 || !this.alive[p.gun]) continue;
      const g = p.gun;
      const r = Math.sqrt(this.rng.next()) * ARTY_SPREAD * (p.kind === "he" ? 1 : 1.3);
      const a = this.rng.next() * Math.PI * 2;
      const tx = p.x + Math.cos(a) * r;
      const ty = p.y + Math.sin(a) * r;
      const dist = Math.hypot(tx - this.x[g], ty - this.y[g]);
      const dir = Math.atan2(ty - this.y[g], tx - this.x[g]);
      this.ang[g] = dir;
      this.shells.push({ side: this.side[g], sx: this.x[g], sy: this.y[g], tx, ty, t0: this.time, dur: dist / SHELL_SPEED + 1, direct: false, target: -1, kind: p.kind });
      this.events.gunfire.push(this.x[g], this.y[g], dir, 0);
      this.lastGunfire[this.side[g]] = this.time;
    }
    this.pending = still;
    // Einschläge
    const flying: Shell[] = [];
    for (const s of this.shells) {
      if (this.time < s.t0 + s.dur) {
        flying.push(s);
        continue;
      }
      this.by(s.side, s.kind === "cannon" ? C_TANK : C_ARTY);
      if (s.kind === "he") this.shellImpact(s.tx, s.ty, ARTY_KILL_RADIUS, true);
      else if (s.kind === "smoke") {
        this.smokes.push({ x: s.tx, y: s.ty, r: SMOKE_RADIUS, t0: this.time, until: this.time + SMOKE_DURATION });
        this.events.blasts.push(s.tx, s.ty, 8, 7);
      } else if (s.kind === "gas") {
        this.smokes.push({ x: s.tx, y: s.ty, r: GAS_RADIUS, t0: this.time, until: this.time + GAS_DURATION, gas: true, side: s.side });
        // Gasalarm: höchstens einmal je Salve (nicht für jede Granate)
        if (!this.smokes.some((o) => o.gas && o !== this.smokes[this.smokes.length - 1] && this.time - o.t0 < 6 && Math.hypot(o.x - s.tx, o.y - s.ty) < 200)) this.signal(s.tx, s.ty, 1);
        this.events.blasts.push(s.tx, s.ty, 8, 8);
      } else if (s.kind === "grenade") this.grenadeImpact(s);
      else if (s.target >= 0 && this.alive[s.target] && Math.hypot(this.x[s.target] - s.tx, this.y[s.target] - s.ty) < 14) {
        const hit = this.rng.next() < (s.kind === "at" ? 0.6 : 0.4) * (s.acc ?? 1);
        this.events.blasts.push(s.tx, s.ty, 8, 3);
        if (hit) {
          this.damage(s.target, s.kind === "at" ? GUN_DIRECT_DAMAGE : 8, 0);
          this.events.hits.push(s.tx, s.ty, 1);
        }
      } else this.shellImpact(s.tx, s.ty, 8, false);
    }
    this.shells = flying;
    this.barrages = this.barrages.filter((b) => b.until > this.time);
  }

  private shellImpact(x: number, y: number, radius: number, big: boolean) {
    this.stamp++;
    const supR = big ? ARTY_SUPPRESS_RADIUS : 24;
    for (let s = 0; s < 2; s++) {
      this.grids[s].forEachInRadius(x, y, supR, this.x, this.y, (id, d) => {
        if (!this.alive[id]) return;
        const c = this.companies[this.comp[id]];
        if (this.companyStamp[c.id] !== this.stamp) {
          this.companyStamp[c.id] = this.stamp;
          if (c.type !== UNIT_MAGE) c.morale -= big ? 2.5 : 1;
        }
        this.pin(id, 0.6 * (1 - d / supR));
        if (d > radius) return;
        const type = this.type[id];
        if (STATS[type].armored) {
          this.damage(id, (big ? 22 : 6) * (1 - d / radius), 0);
          return;
        }
        const cover = this.terrain.coverAt(this.x[id], this.y[id]);
        // Im Graben oder Bunker hält Artillerie vor allem nieder – tödlich ist sie im Freien
        const p = 0.85 * (1 - cover) ** 2 * (1 - (d / radius) * 0.5);
        if (this.rng.next() < p) this.damage(id, type === UNIT_GUN ? 3 : type === UNIT_MG ? 2 : 1, Math.atan2(this.y[id] - y, this.x[id] - x));
      });
    }
    // Magier in der Luft nur bei Volltreffer
    for (let s = 0; s < 2; s++) {
      for (const m of this.unitsOf(s, UNIT_MAGE)) {
        if (Math.hypot(this.x[m] - x, this.y[m] - y) < 8) this.damage(m, 4, 0);
      }
    }
    const r = big ? 7 + this.rng.next() * 7 : 4 + this.rng.next() * 3;
    this.terrain.addCrater(x, y, r);
    this.events.blasts.push(x, y, radius, big ? 0 : 3);
    this.events.craters.push(x, y, r);
  }

  private updateMines(dt: number) {
    this.mineTimer -= dt;
    if (this.mineTimer > 0) return;
    this.mineTimer = 0.2;
    for (const m of this.terrain.mines) {
      if (!m.alive) continue;
      this.by(m.side, C_MINE);
      const enemy = 1 - m.side;
      const who = this.grids[enemy].nearest(m.x, m.y, MINE_TRIGGER + 6, this.x, this.y);
      if (who < 0) continue;
      const r = STATS[this.type[who]].radius;
      if (this.grids[enemy].lastDist > MINE_TRIGGER + r * 0.5) continue;
      m.alive = false;
      for (let s = 0; s < 2; s++) {
        this.grids[s].forEachInRadius(m.x, m.y, MINE_RADIUS + 8, this.x, this.y, (id, d) => {
          if (!this.alive[id]) return;
          this.pin(id, 1);
          if (STATS[this.type[id]].armored) {
            if (d < 14) this.damage(id, MINE_TANK_DAMAGE, 0);
          } else if (d < MINE_RADIUS && this.rng.next() < 0.9 - d / (MINE_RADIUS * 1.5)) this.damage(id, 2, Math.atan2(this.y[id] - m.y, this.x[id] - m.x));
        });
      }
      this.terrain.addCrater(m.x, m.y, 5);
      this.events.blasts.push(m.x, m.y, MINE_RADIUS, 2);
      this.events.craters.push(m.x, m.y, 5);
    }
  }

  private updateFires(dt: number) {
    if (this.fires.length === 0) return;
    this.fires = this.fires.filter((f) => f.until > this.time);
    this.by(-1, C_FIRE);
    for (const f of this.fires) {
      for (let s = 0; s < 2; s++) {
        this.grids[s].forEachInRadius(f.x, f.y, f.r, this.x, this.y, (id, d) => {
          if (!this.alive[id] || STATS[this.type[id]].armored || this.type[id] === UNIT_GUN) return;
          // Wer Feuer spürt, springt heraus – liegen bleibt niemand darin
          const dx = this.x[id] - f.x;
          const dy = this.y[id] - f.y;
          const len = d || 1;
          this.x[id] += (dx / len) * 9 * dt;
          this.y[id] += (dy / len) * 9 * dt;
          // Platz im Brand aufgeben und daneben neu Stellung suchen
          if (Math.hypot(this.tx[id] - f.x, this.ty[id] - f.y) < f.r + 3 && this.type[id] !== UNIT_MAGE) {
            this.place(id, f.x + (dx / len) * (f.r + 8), f.y + (dy / len) * (f.r + 8), 10);
          }
          this.pinned[id] = 0;
          if (this.rng.next() < 0.35 * dt) this.damage(id, 1, 0);
        });
      }
    }
  }

  private updateSides(dt: number) {
    for (let s = 0; s < 2; s++) {
      const side = this.sides[s];
      side.reserveCooldown = Math.max(0, side.reserveCooldown - dt);
      let ready = 0;
      let total = 0;
      let next = Infinity;
      for (const c of this.companies) {
        if (c.side !== s || c.type !== UNIT_GUN || c.alive <= 0) continue;
        total++;
        if (c.readyAt <= this.time) ready++;
        else next = Math.min(next, c.readyAt - this.time);
      }
      side.artyCharges = ready;
      side.artyMax = total;
      side.artyTimer = next === Infinity ? 0 : next;
    }
  }

  private updateObjectives(dt: number) {
    for (const o of this.objectives) {
      const cnt = [0, 0];
      for (let s = 0; s < 2; s++) {
        this.grids[s].forEachInRadius(o.x, o.y, OBJECTIVE_RADIUS, this.x, this.y, (id) => {
          const t = this.type[id];
          if (t === UNIT_GUN) return;
          if (this.companies[this.comp[id]].order === "rout") return;
          cnt[s] += t === UNIT_TANK ? 10 : 1;
        });
      }
      const other = 1 - o.owner;
      if (cnt[other] >= 5 && cnt[o.owner] === 0) {
        o.capturer = other;
        o.capture += (dt / OBJECTIVE_CAPTURE_TIME) * Math.min(2, cnt[other] / 40);
        if (o.capture >= 1) {
          o.owner = other;
          o.capture = 0;
          o.capturer = -1;
        }
      } else {
        o.capture = Math.max(0, o.capture - (dt / OBJECTIVE_CAPTURE_TIME) * (cnt[o.owner] > 0 ? 2 : 0.5));
        if (o.capture === 0) o.capturer = -1;
      }
    }
  }

  private checkVictory() {
    for (let s = 0; s < 2; s++) {
      if (this.objectives.every((o) => o.owner === s)) {
        this.result = { winner: s, reason: "Alle Stellungen eingenommen" };
        return;
      }
    }
    for (let s = 0; s < 2; s++) {
      let fighting = 0;
      for (const c of this.companies) {
        if (c.side === s && c.type !== UNIT_MAGE && c.type !== UNIT_GUN && c.order !== "rout") fighting += c.alive;
      }
      const side = this.sides[s];
      if (side.reserves === 0 && fighting < side.initialStrength * 0.08) {
        this.result = { winner: 1 - s, reason: "Der Gegner ist zerschlagen" };
        return;
      }
    }
  }

  // ------------------------------------------------------------ Aufstellung

  /**
   * Neue Kompanie aus der Kampagne. Mit teleport steht sie sofort an (x, y),
   * sonst marschiert sie vom hinteren Rand dorthin.
   */
  spawnCompany(side: number, type: number, name: string, x: number, y: number, size: number, division: number, teleport: boolean) {
    const startY = teleport || type === UNIT_GUN ? y : REAR_Y[side];
    const c = this.createCompany(side, type, name, x, startY, size);
    c.division = division;
    c.homeX = x;
    c.homeY = y;
    if (!teleport && type !== UNIT_GUN) this.setTarget(c, x, y, "advance");
    return c;
  }

  /** Kompanie verlässt das Gefecht (verlegt), ohne dass jemand stirbt. */
  withdrawCompany(id: number) {
    const c = this.companies[id];
    if (!c) return;
    for (const m of c.members) {
      if (this.alive[m]) this.release(m);
      this.alive[m] = 0;
    }
    c.alive = 0;
  }

  private createCompany(side: number, type: number, name: string, x: number, y: number, size: number): Company {
    const c: Company = {
      id: this.companies.length,
      side,
      type,
      name,
      members: [],
      order: "advance",
      tx: x,
      ty: y,
      homeX: x,
      homeY: y,
      morale: 100,
      cover: 0,
      odds: 1,
      initial: size,
      alive: size,
      cx: x,
      cy: y,
      lastLoss: -100,
      mana: MAGE_MANA_MAX,
      division: -1,
      manual: false,
      readyAt: 0,
    };
    this.companies.push(c);
    this.companyStamp.push(0);
    const st = STATS[type];
    for (let k = 0; k < size && this.n < MAX_UNITS; k++) {
      const i = this.n++;
      this.x[i] = x + (this.rng.next() - 0.5) * 60;
      this.y[i] = y + (this.rng.next() - 0.5) * 20;
      this.ang[i] = side === 0 ? -Math.PI / 2 : Math.PI / 2;
      this.hp[i] = st.hp;
      this.reload[i] = this.rng.next() * st.reload;
      this.reload2[i] = this.rng.next() * TANK_CANNON_RELOAD;
      this.think[i] = this.rng.next();
      this.tgt[i] = -1;
      this.claimCell[i] = -1;
      this.side[i] = side;
      this.type[i] = type;
      this.alive[i] = 1;
      this.moving[i] = 0;
      this.pinned[i] = 0;
      this.flags[i] = 0;
      this.suppress[i] = 0;
      this.comp[i] = c.id;
      c.members.push(i);
    }
    this.setTarget(c, x, y, "advance", true);
    return c;
  }

  private release(id: number) {
    if (this.claimCell[id] >= 0) {
      this.terrain.release(this.claimCell[id], id);
      this.claimCell[id] = -1;
    }
  }

  /** Soldat bekommt einen eigenen, freien Standplatz (möglichst in Deckung). */
  private place(id: number, x: number, y: number, radius: number) {
    this.release(id);
    this.claimCell[id] = this.terrain.findSpot(x, y, radius, id, this.tmp);
    this.tx[id] = this.tmp.x;
    this.ty[id] = this.tmp.y;
  }

  /** Verteilt die Überlebenden in Formation um den Zielpunkt. */
  private setTarget(c: Company, x: number, y: number, order: Order, teleport = false) {
    x = clamp(x, 10, WORLD_W - 10);
    y = clamp(y, 10, WORLD_H - 10);
    c.order = order;
    c.tx = x;
    c.ty = y;
    const living = c.members.filter((id) => this.alive[id]);
    living.sort((a, b) => this.x[a] - this.x[b]);
    const layout: Record<number, [number, number]> = {
      [UNIT_RIFLE]: [3, 6],
      [UNIT_MG]: [1, 30],
      [UNIT_MAGE]: [2, 14],
      [UNIT_TANK]: [1, 48],
      [UNIT_AT]: [1, 16],
      [UNIT_FLAME]: [2, 9],
      [UNIT_GUN]: [1, 44],
      [UNIT_STORM]: [2, 7],
    };
    const snap = c.type !== UNIT_MAGE && c.type !== UNIT_TANK && c.type !== UNIT_GUN && order !== "storm";
    // Im Graben rücken die Leute enger zusammen, damit alle hineinpassen
    const trenchY = this.trenchYNear(x, y);
    const inTrench = snap && Math.abs(trenchY - y) < 14;
    let [rows, spacing] = layout[c.type];
    if (inTrench && c.type === UNIT_RIFLE) spacing = 4.2;
    const cols = Math.ceil(living.length / rows);
    const back = -FORWARD[c.side];
    for (let j = 0; j < living.length; j++) {
      const id = living[j];
      const col = Math.floor(j / rows);
      const row = j % rows;
      let px = x + (col - (cols - 1) / 2) * spacing + (this.rng.next() - 0.5) * 1.5;
      // Formation folgt dem Gelände: in einem Graben der Grabenlinie nach
      let py = y + back * row * 6 + (this.rng.next() - 0.5) * 2;
      px = clamp(px, 4, WORLD_W - 4);
      py = clamp(py, 4, WORLD_H - 4);
      this.pinned[id] = 0;
      if (snap) {
        // Liegt das Ziel in einem Graben, folgt die Reihe dem Grabenverlauf
        if (inTrench) py = this.trenchYNear(px, trenchY) + back * (row - 1) * 3;
        this.place(id, px, py, 18);
        px = this.tx[id];
        py = this.ty[id];
      } else {
        this.release(id);
        const kd = this.terrain.kindAt(px, py);
        if (kd === K_WALL || kd === K_WRECK) px += spacing * 0.5;
        this.tx[id] = px;
        this.ty[id] = py;
      }
      if (teleport) {
        this.x[id] = px;
        this.y[id] = py;
      }
    }
  }

  /** y des nächstgelegenen Grabens bei x in der Nähe von y0 */
  private trenchYNear(x: number, y0: number) {
    let best = y0;
    let bd = Infinity;
    for (let s = 0; s < 2; s++) {
      for (const y of [this.terrain.frontY(s, x), this.terrain.supportY(s, x)]) {
        const d = Math.abs(y - y0);
        if (d < bd && d < 80) {
          bd = d;
          best = y;
        }
      }
    }
    return best;
  }
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

/** Moralwirkung des Kräfteverhältnisses: überlegen bis 0,6-fach, gleich 1, stark unterlegen bis 1,7-fach */
function oddsFear(odds: number) {
  return Math.max(0.6, Math.min(1.7, 1 / Math.sqrt(odds)));
}
