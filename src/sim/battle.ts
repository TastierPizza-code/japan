import {
  ARTY_CHARGES,
  ARTY_DELAY,
  ARTY_DURATION,
  ARTY_KILL_RADIUS,
  ARTY_RECHARGE,
  ARTY_SHELLS,
  ARTY_SPREAD,
  ARTY_SUPPRESS_RADIUS,
  COMPANY_SIZE,
  FORWARD,
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
  MORALE_RALLY,
  MORALE_ROUT,
  MORALE_ROUT_STORM,
  OBJECTIVE_CAPTURE_TIME,
  OBJECTIVE_RADIUS,
  REAR_Y,
  RESERVE_COOLDOWN,
  START_RESERVES,
  STATS,
  STORM_ENGAGE_RANGE,
  SUPPORT_Y,
  TICK,
  TRENCH_Y,
  UNIT_MAGE,
  UNIT_MG,
  UNIT_RIFLE,
  WORLD_H,
  WORLD_W,
} from "./config.ts";
import { SpatialGrid } from "./grid.ts";
import { Rng } from "./rng.ts";
import { Terrain } from "./terrain.ts";

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
  initial: number;
  alive: number;
  cx: number;
  cy: number;
  lastLoss: number;
  mana: number;
}

export interface Barrage {
  side: number;
  x: number;
  y: number;
  fireAt: number;
  shellsLeft: number;
  nextShell: number;
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
  artyCharges: number;
  artyTimer: number;
  reserves: number;
  reserveCooldown: number;
  initialStrength: number;
}

/** Ereignisse für die Darstellung. Werden vom Renderer geleert. */
export interface BattleEvents {
  /** x1,y1,x2,y2,type,side */
  shots: number[];
  /** x,y,side,type */
  deaths: number[];
  /** x,y,r,kind (0 Granate, 1 Magie) */
  blasts: number[];
  /** x,y,r */
  craters: number[];
}

export interface BattleResult {
  winner: number;
  reason: string;
}

const MAX_UNITS = 16000;

export class Battle {
  rng: Rng;
  terrain: Terrain;
  time = 0;

  // Soldaten als Struktur aus Arrays (schnell bei Tausenden Einheiten)
  n = 0;
  x = new Float32Array(MAX_UNITS);
  y = new Float32Array(MAX_UNITS);
  tx = new Float32Array(MAX_UNITS);
  ty = new Float32Array(MAX_UNITS);
  hp = new Float32Array(MAX_UNITS);
  reload = new Float32Array(MAX_UNITS);
  think = new Float32Array(MAX_UNITS);
  suppress = new Float32Array(MAX_UNITS);
  tgt = new Int32Array(MAX_UNITS);
  side = new Uint8Array(MAX_UNITS);
  type = new Uint8Array(MAX_UNITS);
  alive = new Uint8Array(MAX_UNITS);
  moving = new Uint8Array(MAX_UNITS);
  comp = new Int16Array(MAX_UNITS);

  companies: Company[] = [];
  barrages: Barrage[] = [];
  objectives: Objective[] = [];
  sides: SideState[] = [];
  result: BattleResult | null = null;
  events: BattleEvents = { shots: [], deaths: [], blasts: [], craters: [] };

  private grids = [new SpatialGrid(MAX_UNITS), new SpatialGrid(MAX_UNITS)];
  private ids = [new Int32Array(MAX_UNITS), new Int32Array(MAX_UNITS)];
  private idCount = [0, 0];
  private mages: number[][] = [[], []];
  private tmp = { x: 0, y: 0 };
  private companyStamp: number[] = [];
  private stamp = 0;

  constructor(seed = 1) {
    this.rng = new Rng(seed);
    this.terrain = new Terrain(this.rng);
    const names = [
      ["1. Kompanie", "2. Kompanie", "3. Kompanie", "4. Kompanie", "5. Kompanie", "6. Kompanie"],
      ["1re Cie", "2e Cie", "3e Cie", "4e Cie", "5e Cie", "6e Cie"],
    ];
    for (let s = 0; s < 2; s++) {
      const xs = [200, 600, 1000];
      xs.forEach((x, i) => this.createCompany(s, UNIT_RIFLE, names[s][i], x, TRENCH_Y[s], COMPANY_SIZE));
      xs.forEach((x, i) => this.createCompany(s, UNIT_RIFLE, names[s][i + 3], x, SUPPORT_Y[s], COMPANY_SIZE));
      this.createCompany(s, UNIT_MG, s === 0 ? "MG-Zug A" : "Mitrailleuses A", 400, TRENCH_Y[s], MG_PER_SECTION);
      this.createCompany(s, UNIT_MG, s === 0 ? "MG-Zug B" : "Mitrailleuses B", 800, TRENCH_Y[s], MG_PER_SECTION);
      this.createCompany(s, UNIT_MAGE, s === 0 ? "Magier „Sturmvogel“" : "Mages „Corbeau“", 600, REAR_Y[s], MAGES_PER_SQUAD);
      this.sides.push({
        artyCharges: ARTY_CHARGES,
        artyTimer: ARTY_RECHARGE,
        reserves: START_RESERVES,
        reserveCooldown: 0,
        initialStrength: 0,
      });
    }
    for (let s = 0; s < 2; s++) this.sides[s].initialStrength = this.groundStrength(s);
    for (let s = 0; s < 2; s++) {
      for (const x of [200, 600, 1000]) {
        this.objectives.push({ x, y: TRENCH_Y[s], owner: s, capture: 0, capturer: -1 });
      }
    }
  }

  // ---------------------------------------------------------------- Befehle

  orderMove(companyId: number, x: number, y: number) {
    const c = this.companies[companyId];
    if (!c || c.alive === 0 || c.order === "rout") return;
    this.setTarget(c, x, y, "advance");
  }

  orderStorm(companyId: number, x: number, y: number) {
    const c = this.companies[companyId];
    if (!c || c.alive === 0 || c.order === "rout") return;
    this.setTarget(c, x, y, c.type === UNIT_MAGE ? "advance" : "storm");
  }

  orderHold(companyId: number) {
    const c = this.companies[companyId];
    if (!c || c.alive === 0 || c.order === "rout") return;
    c.order = "advance";
    c.tx = c.cx;
    c.ty = c.cy;
    for (const id of c.members) {
      if (!this.alive[id]) continue;
      if (c.type === UNIT_MAGE) {
        this.tx[id] = this.x[id];
        this.ty[id] = this.y[id];
      } else {
        this.terrain.findCover(this.x[id], this.y[id], 12, this.rng, this.tmp);
        this.tx[id] = this.tmp.x;
        this.ty[id] = this.tmp.y;
      }
    }
  }

  orderRetreat(companyId: number) {
    const c = this.companies[companyId];
    if (!c || c.alive === 0 || c.order === "rout") return;
    this.setTarget(c, c.homeX, c.homeY, "retreat");
  }

  callArtillery(side: number, x: number, y: number): boolean {
    const s = this.sides[side];
    if (s.artyCharges <= 0 || this.result) return false;
    s.artyCharges--;
    this.barrages.push({
      side,
      x: clamp(x, 0, WORLD_W),
      y: clamp(y, 0, WORLD_H),
      fireAt: this.time + ARTY_DELAY,
      shellsLeft: ARTY_SHELLS,
      nextShell: 0,
    });
    return true;
  }

  callReserve(side: number): boolean {
    const s = this.sides[side];
    if (s.reserves <= 0 || s.reserveCooldown > 0 || this.result) return false;
    s.reserves--;
    s.reserveCooldown = RESERVE_COOLDOWN;
    const count = this.companies.filter((c) => c.side === side && c.type === UNIT_RIFLE).length;
    const name = side === 0 ? `${count + 1}. Kompanie (Res.)` : `${count + 1}e Cie (rés.)`;
    const x = 250 + this.rng.next() * 700;
    const c = this.createCompany(side, UNIT_RIFLE, name, x, REAR_Y[side], COMPANY_SIZE);
    c.homeY = SUPPORT_Y[side];
    this.setTarget(c, x, SUPPORT_Y[side], "advance");
    return true;
  }

  // ------------------------------------------------------------- Simulation

  update(dt = TICK) {
    if (this.result) return;
    this.time += dt;
    this.rebuildGrids();
    this.updateSoldiers(dt);
    this.updateCompanies(dt);
    this.updateBarrages();
    this.updateSides(dt);
    this.updateObjectives(dt);
    if (Math.floor(this.time) !== Math.floor(this.time - dt)) this.checkVictory();
  }

  clearEvents() {
    const e = this.events;
    e.shots.length = 0;
    e.deaths.length = 0;
    e.blasts.length = 0;
    e.craters.length = 0;
  }

  groundStrength(side: number): number {
    let n = 0;
    for (const c of this.companies) {
      if (c.side === side && c.type !== UNIT_MAGE) n += c.alive;
    }
    return n;
  }

  private rebuildGrids() {
    this.idCount[0] = 0;
    this.idCount[1] = 0;
    this.mages[0].length = 0;
    this.mages[1].length = 0;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const s = this.side[i];
      this.ids[s][this.idCount[s]++] = i;
      if (this.type[i] === UNIT_MAGE) this.mages[s].push(i);
    }
    for (let s = 0; s < 2; s++) this.grids[s].rebuild(this.ids[s], this.idCount[s], this.x, this.y);
  }

  private updateSoldiers(dt: number) {
    const rng = this.rng;
    const terrain = this.terrain;
    for (let i = 0; i < this.n; i++) {
      if (!this.alive[i]) continue;
      const c = this.companies[this.comp[i]];
      const st = STATS[this.type[i]];
      const isMage = this.type[i] === UNIT_MAGE;
      const enemy = 1 - this.side[i];

      this.suppress[i] = Math.max(0, this.suppress[i] - 0.15 * dt);

      // --- Zielauswahl (nicht jeden Tick, das spart viel Rechenzeit)
      this.think[i] -= dt;
      if (this.think[i] <= 0) {
        this.think[i] = (c.order === "storm" ? 0.3 : 0.8) + rng.next() * 0.4;
        this.tgt[i] = this.findTarget(i, enemy, Math.max(st.range, STORM_ENGAGE_RANGE));
      }
      let t = this.tgt[i];
      if (t >= 0 && !this.alive[t]) t = this.tgt[i] = -1;
      let tDist = t >= 0 ? Math.hypot(this.x[t] - this.x[i], this.y[t] - this.y[i]) : Infinity;

      // --- Bewegung
      let gx = this.tx[i];
      let gy = this.ty[i];
      if (c.order === "storm" && t >= 0 && tDist < STORM_ENGAGE_RANGE && this.type[t] !== UNIT_MAGE) {
        gx = this.x[t];
        gy = this.y[t];
      }
      const dx = gx - this.x[i];
      const dy = gy - this.y[i];
      const d = Math.hypot(dx, dy);
      const stopDist = gx === this.tx[i] && gy === this.ty[i] ? 1.5 : 4;
      if (d > stopDist) {
        let speed = c.order === "advance" ? st.walk : st.run;
        if (!isMage) {
          speed *= terrain.slowAt(this.x[i], this.y[i]);
          if (c.order === "advance") speed *= 1 - 0.6 * this.suppress[i];
        }
        const step = Math.min(d - stopDist * 0.5, speed * dt);
        this.x[i] += (dx / d) * step;
        this.y[i] += (dy / d) * step;
        this.moving[i] = 1;
      } else {
        this.moving[i] = 0;
      }

      // --- Mana/Schild der Magier
      if (isMage) this.hp[i] = Math.min(st.hp, this.hp[i] + MAGE_SHIELD_REGEN * dt);

      // --- Feuern / Nahkampf
      this.reload[i] -= dt;
      if (this.reload[i] > 0 || t < 0 || c.order === "rout") continue;
      tDist = Math.hypot(this.x[t] - this.x[i], this.y[t] - this.y[i]);
      const targetIsMage = this.type[t] === UNIT_MAGE;

      if (!isMage && !targetIsMage && tDist <= MELEE_RANGE) {
        let p = MELEE_KILL + (c.order === "storm" ? 0.15 : 0);
        if (this.companies[this.comp[t]].order === "rout") p += 0.3;
        if (rng.next() < p) this.damage(t, 1);
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
      if (isMage) {
        if (c.mana < MAGE_MANA_PER_SPELL) {
          this.reload[i] = 0.5;
          continue;
        }
        c.mana -= MAGE_MANA_PER_SPELL;
        this.castSpell(i, t, tDist);
      } else {
        let p = st.hit * (1 - 0.75 * (tDist / st.range)) * (1 - 0.6 * this.suppress[i]);
        if (targetIsMage) p *= MAGE_EVASION * (this.type[i] === UNIT_MG ? 1.6 : 1);
        else p *= 1 - terrain.coverAt(this.x[t], this.y[t]);
        this.suppress[t] = Math.min(1, this.suppress[t] + st.suppress);
        let ex = this.x[t];
        let ey = this.y[t];
        if (rng.next() < p) this.damage(t, 1);
        else {
          ex += rng.gauss() * 6;
          ey += rng.gauss() * 6;
        }
        this.events.shots.push(this.x[i], this.y[i], ex, ey, this.type[i], this.side[i]);
      }
      this.reload[i] = st.reload + rng.next() * st.reloadJitter;
    }
  }

  private findTarget(i: number, enemy: number, range: number): number {
    const x = this.x[i];
    const y = this.y[i];
    if (this.type[i] === UNIT_MAGE) {
      // Magier suchen zuerst gegnerische Magier
      let best = -1;
      let bd = STATS[UNIT_MAGE].range;
      for (const m of this.mages[enemy]) {
        const d = Math.hypot(this.x[m] - x, this.y[m] - y);
        if (d < bd) {
          bd = d;
          best = m;
        }
      }
      if (best >= 0) return best;
    }
    return this.grids[enemy].nearest(x, y, range, this.x, this.y);
  }

  private castSpell(i: number, t: number, dist: number) {
    const rng = this.rng;
    const st = STATS[UNIT_MAGE];
    const acc = st.hit * (1 - 0.4 * (dist / st.range));
    let ex = this.x[t];
    let ey = this.y[t];
    this.events.shots.push(this.x[i], this.y[i], ex, ey, UNIT_MAGE, this.side[i]);
    if (this.type[t] === UNIT_MAGE) {
      if (rng.next() < acc) this.damage(t, 3);
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
      if (!this.alive[id] || this.type[id] === UNIT_MAGE) return;
      this.suppress[id] = Math.min(1, this.suppress[id] + st.suppress * (1 - d / (MAGE_SPELL_RADIUS * 2)));
      if (d > MAGE_SPELL_RADIUS) return;
      const cover = this.terrain.coverAt(this.x[id], this.y[id]);
      const p = 0.7 * (1 - cover * 0.6) * (1 - (d / MAGE_SPELL_RADIUS) * 0.5);
      if (this.rng.next() < p) this.damage(id, 1);
    });
  }

  private damage(id: number, amount: number) {
    if (!this.alive[id]) return;
    this.hp[id] -= amount;
    if (this.hp[id] > 0) return;
    this.alive[id] = 0;
    const c = this.companies[this.comp[id]];
    c.alive--;
    c.lastLoss = this.time;
    if (c.type === UNIT_RIFLE) c.morale -= 60 / c.initial;
    else if (c.type === UNIT_MG) c.morale -= 12;
    this.events.deaths.push(this.x[id], this.y[id], this.side[id], this.type[id]);
  }

  private updateCompanies(dt: number) {
    for (const c of this.companies) {
      if (c.alive <= 0) continue;
      let sx = 0;
      let sy = 0;
      let n = 0;
      let arrived = 0;
      for (const id of c.members) {
        if (!this.alive[id]) continue;
        sx += this.x[id];
        sy += this.y[id];
        n++;
        if (!this.moving[id]) arrived++;
      }
      c.alive = n;
      if (n === 0) continue;
      c.cx = sx / n;
      c.cy = sy / n;

      if (c.type === UNIT_MAGE) {
        const atHome = Math.hypot(c.cx - c.homeX, c.cy - c.homeY) < 60;
        if (atHome) c.mana = Math.min(MAGE_MANA_MAX, c.mana + MAGE_MANA_REGEN * dt);
        else c.mana = Math.max(0, c.mana - MAGE_MANA_DRAIN * dt);
        if (!atHome && c.mana < 12 && c.order !== "retreat") this.setTarget(c, c.homeX, c.homeY, "retreat");
        if (atHome && c.order === "retreat") c.order = "advance";
        continue;
      }

      if (this.time - c.lastLoss > 4) c.morale = Math.min(100, c.morale + 1.5 * dt);
      if (c.order === "rout") {
        c.morale = Math.min(100, c.morale + 2 * dt);
        const home = Math.hypot(c.cx - c.homeX, c.cy - c.homeY) < 60;
        if (home && c.morale >= MORALE_RALLY) this.setTarget(c, c.homeX, c.homeY, "advance");
      } else if (c.morale < (c.order === "storm" ? MORALE_ROUT_STORM : MORALE_ROUT)) {
        this.setTarget(c, c.homeX, c.homeY, "rout");
      } else if (c.order === "storm" && arrived >= n * 0.8) {
        c.order = "advance";
      } else if (c.order === "retreat" && arrived >= n * 0.8) {
        c.order = "advance";
      }
    }
  }

  private updateBarrages() {
    for (const b of this.barrages) {
      if (this.time < b.fireAt || this.time < b.nextShell || b.shellsLeft <= 0) continue;
      b.shellsLeft--;
      b.nextShell = this.time + (ARTY_DURATION / ARTY_SHELLS) * (0.5 + this.rng.next());
      const r = Math.sqrt(this.rng.next()) * ARTY_SPREAD;
      const a = this.rng.next() * Math.PI * 2;
      this.shellImpact(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r);
    }
    this.barrages = this.barrages.filter((b) => b.shellsLeft > 0);
  }

  private shellImpact(x: number, y: number) {
    this.stamp++;
    for (let s = 0; s < 2; s++) {
      this.grids[s].forEachInRadius(x, y, ARTY_SUPPRESS_RADIUS, this.x, this.y, (id, d) => {
        if (!this.alive[id]) return;
        const c = this.companies[this.comp[id]];
        if (this.companyStamp[c.id] !== this.stamp) {
          this.companyStamp[c.id] = this.stamp;
          if (c.type !== UNIT_MAGE) c.morale -= 2.5;
        }
        if (this.type[id] === UNIT_MAGE) {
          if (d < 8) this.damage(id, 4);
          return;
        }
        this.suppress[id] = Math.min(1, this.suppress[id] + 0.6 * (1 - d / ARTY_SUPPRESS_RADIUS));
        if (d > ARTY_KILL_RADIUS) return;
        const cover = this.terrain.coverAt(this.x[id], this.y[id]);
        const p = 0.85 * (1 - cover * 0.8) * (1 - (d / ARTY_KILL_RADIUS) * 0.5);
        if (this.rng.next() < p) this.damage(id, this.type[id] === UNIT_MG ? 2 : 1);
      });
    }
    const r = 7 + this.rng.next() * 7;
    this.terrain.addCrater(x, y, r);
    this.events.blasts.push(x, y, ARTY_KILL_RADIUS, 0);
    this.events.craters.push(x, y, r);
  }

  private updateSides(dt: number) {
    for (const s of this.sides) {
      s.reserveCooldown = Math.max(0, s.reserveCooldown - dt);
      if (s.artyCharges < ARTY_CHARGES) {
        s.artyTimer -= dt;
        if (s.artyTimer <= 0) {
          s.artyCharges++;
          s.artyTimer = ARTY_RECHARGE;
        }
      }
    }
  }

  private updateObjectives(dt: number) {
    for (const o of this.objectives) {
      const cnt = [0, 0];
      for (let s = 0; s < 2; s++) {
        this.grids[s].forEachInRadius(o.x, o.y, OBJECTIVE_RADIUS, this.x, this.y, (id) => {
          if (this.type[id] === UNIT_MAGE) return;
          if (this.companies[this.comp[id]].order === "rout") return;
          cnt[s]++;
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
        if (c.side === s && c.type !== UNIT_MAGE && c.order !== "rout") fighting += c.alive;
      }
      const side = this.sides[s];
      if (side.reserves === 0 && fighting < side.initialStrength * 0.08) {
        this.result = { winner: 1 - s, reason: "Der Gegner ist zerschlagen" };
        return;
      }
    }
  }

  // ------------------------------------------------------------ Aufstellung

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
      initial: size,
      alive: size,
      cx: x,
      cy: y,
      lastLoss: -100,
      mana: MAGE_MANA_MAX,
    };
    this.companies.push(c);
    this.companyStamp.push(0);
    const st = STATS[type];
    for (let k = 0; k < size && this.n < MAX_UNITS; k++) {
      const i = this.n++;
      this.x[i] = x + (this.rng.next() - 0.5) * 60;
      this.y[i] = y + (this.rng.next() - 0.5) * 20;
      this.hp[i] = st.hp;
      this.reload[i] = this.rng.next() * st.reload;
      this.think[i] = this.rng.next();
      this.tgt[i] = -1;
      this.side[i] = side;
      this.type[i] = type;
      this.alive[i] = 1;
      this.comp[i] = c.id;
      c.members.push(i);
    }
    this.setTarget(c, x, y, "advance", true);
    return c;
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
    const rows = c.type === UNIT_RIFLE ? 3 : c.type === UNIT_MAGE ? 2 : 1;
    const spacing = c.type === UNIT_RIFLE ? 3.6 : c.type === UNIT_MG ? 25 : 12;
    const cols = Math.ceil(living.length / rows);
    const back = -FORWARD[c.side];
    const snap = c.type !== UNIT_MAGE && order !== "storm";
    for (let j = 0; j < living.length; j++) {
      const id = living[j];
      const col = Math.floor(j / rows);
      const row = j % rows;
      let px = x + (col - (cols - 1) / 2) * spacing + (this.rng.next() - 0.5) * 1.5;
      let py = y + back * row * 6 + (this.rng.next() - 0.5) * 2;
      px = clamp(px, 2, WORLD_W - 2);
      py = clamp(py, 2, WORLD_H - 2);
      if (snap) {
        this.terrain.findCover(px, py, 14, this.rng, this.tmp);
        px = this.tmp.x;
        py = this.tmp.y;
      }
      this.tx[id] = px;
      this.ty[id] = py;
      if (teleport) {
        this.x[id] = px;
        this.y[id] = py;
      }
    }
  }
}

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}
