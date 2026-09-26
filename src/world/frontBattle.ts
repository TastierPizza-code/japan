import { BattleAI } from "../sim/ai.ts";
import { Battle } from "../sim/battle.ts";
import {
  COMPANY_SIZE,
  MG_PER_SECTION,
  SUPPORT_Y,
  TRENCH_Y,
  UNIT_MAGE,
  UNIT_MG,
  UNIT_RIFLE,
  REAR_Y,
} from "../sim/config.ts";
import { FIELD_RIFLE_COMPANIES } from "./config.ts";
import type { Division, FrontPoint, World } from "./world.ts";

const LANES = [200, 600, 1000];
const UNVIEWED_STEP = 0.2;

/**
 * Verbindet einen Frontpunkt der Kampagne mit einer echten Schlacht:
 * Divisionen werden zu Kompanien auf dem Gefechtsfeld, Verluste fließen
 * zurück in die Divisionen. Nachschub marschiert vom hinteren Rand ein.
 */
export class FrontBattle {
  battle: Battle;
  ai: [BattleAI, BattleAI];
  /** Schlachtseite → Seite des Frontpunkts (0 = a, 1 = b). Der Spieler ist immer unten (0). */
  sideMap: [number, number];
  private pointId: number;
  private lastAlive = new Map<number, number>();
  private syncTimer = 0;
  private acc = 0;

  constructor(world: World, point: FrontPoint) {
    this.pointId = point.id;
    this.battle = new Battle(point.id * 7919 + Math.floor(world.time), { campaign: true });
    const playerSide = world.sideAt(point, world.player);
    this.sideMap = playerSide === 1 ? [1, 0] : [0, 1];
    this.ai = [new BattleAI(0), new BattleAI(1)];
    this.sync(world, point, true);
  }

  /** Schlachtseite für eine Seite des Frontpunkts */
  battleSide(pointSide: number) {
    return this.sideMap[0] === pointSide ? 0 : 1;
  }

  update(world: World, dt: number, viewed: boolean) {
    const p = world.point(this.pointId);
    if (!p) return;
    this.ai[0].stances = p.stance[this.sideMap[0]];
    this.ai[1].stances = p.stance[this.sideMap[1]];
    // Nicht angesehene Schlachten rechnen gröber (5× pro Sekunde statt 20×) – spart viel Rechenzeit
    this.acc += dt;
    const step = viewed ? dt : UNVIEWED_STEP;
    if (this.acc + 1e-9 < step) return;
    dt = this.acc;
    this.acc = 0;
    this.ai[0].update(this.battle, dt);
    this.ai[1].update(this.battle, dt);
    this.battle.update(dt);
    if (!viewed) this.battle.clearEvents();
    this.syncTimer -= dt;
    if (this.syncTimer <= 0) {
      this.syncTimer = 0.25;
      this.sync(world, p, false);
    }
  }

  /** Stärke-Faktor je Seite des Frontpunkts: Moral und eroberte Grabenabschnitte. */
  moraleFactor(): [number, number] {
    const out: [number, number] = [1, 1];
    const b = this.battle;
    for (let bs = 0; bs < 2; bs++) {
      let sum = 0;
      let n = 0;
      for (const c of b.companies) {
        if (c.side !== bs || c.alive <= 0 || c.type === UNIT_MAGE) continue;
        sum += c.morale * c.alive;
        n += c.alive;
      }
      let f = n > 0 ? 0.6 + 0.4 * (sum / n / 100) : 1;
      const held = b.objectives.filter((o) => o.owner === bs && o.y === TRENCH_Y[1 - bs]).length;
      f *= 1 + 0.1 * held;
      out[this.sideMap[bs]] = f;
    }
    return out;
  }

  dispose(world: World) {
    const p = world.point(this.pointId);
    if (p) this.syncLosses(world, p);
  }

  private syncLosses(world: World, point: FrontPoint) {
    const b = this.battle;
    for (const c of b.companies) {
      if (c.division < 0) continue;
      const prev = this.lastAlive.get(c.id) ?? c.alive;
      const d = world.divisions.get(c.division);
      if (d && c.alive < prev) d.soldiers = Math.max(0, d.soldiers - (prev - c.alive));
      const here = d && d.loc.t === "front" && d.loc.point === point.id && d.soldiers > 0;
      if (!here && c.alive > 0) b.withdrawCompany(c.id);
      this.lastAlive.set(c.id, c.alive);
    }
  }

  private sync(world: World, point: FrontPoint, initial: boolean) {
    this.syncLosses(world, point);
    const b = this.battle;
    for (let bs = 0; bs < 2; bs++) {
      const divs = world.divisionsAt(point.id, this.sideMap[bs]).sort((x, y) => x.id - y.id);
      const onField = new Map<number, number>();
      let rifles = 0;
      for (const c of b.companies) {
        if (c.side !== bs || c.alive <= 0) continue;
        onField.set(c.division, (onField.get(c.division) ?? 0) + c.alive);
        if (c.type === UNIT_RIFLE && c.order !== "rout") rifles++;
      }
      // Artillerie steht hinter der Karte: bestimmt nur die Zahl der Feuerschläge
      const batteries = divs.filter((d) => d.kind === "artillery").reduce((s, d) => s + d.soldiers, 0);
      const side = b.sides[bs];
      side.artyMax = Math.min(6, batteries);
      if (initial) side.artyCharges = side.artyMax;
      side.artyCharges = Math.min(side.artyCharges, side.artyMax);

      let slot = b.companies.filter((c) => c.side === bs && c.type === UNIT_RIFLE).length;
      let mgSlot = b.companies.filter((c) => c.side === bs && c.type === UNIT_MG).length;
      for (const d of divs) {
        let spare = d.soldiers - (onField.get(d.id) ?? 0);
        let k = b.companies.filter((c) => c.division === d.id).length;
        const num = divisionNumber(d);
        if (d.kind === "infantry") {
          while (spare >= 30 && rifles < FIELD_RIFLE_COMPANIES) {
            const size = Math.min(COMPANY_SIZE, spare);
            const pos = riflePosition(slot, bs, initial);
            this.spawn(bs, UNIT_RIFLE, `${num}.${++k}`, pos, size, d, initial);
            spare -= size;
            rifles++;
            slot++;
          }
        } else if (d.kind === "mg") {
          while (spare >= 1) {
            const size = Math.min(MG_PER_SECTION, spare);
            const x = mgSlot % 2 === 0 ? 400 : 800;
            this.spawn(bs, UNIT_MG, `MG ${num}.${++k}`, { x: x + Math.floor(mgSlot / 2) * 60, y: TRENCH_Y[bs] }, size, d, initial);
            spare -= size;
            mgSlot++;
          }
        } else if (d.kind === "mage") {
          if (spare >= 1) this.spawn(bs, UNIT_MAGE, `✦ ${num}`, { x: 600, y: REAR_Y[bs] }, spare, d, initial);
        }
      }
    }
  }

  private spawn(
    bs: number,
    type: number,
    name: string,
    pos: { x: number; y: number },
    size: number,
    d: Division,
    teleport: boolean,
  ) {
    const c = this.battle.spawnCompany(bs, type, name, pos.x, pos.y, size, d.id, teleport);
    this.lastAlive.set(c.id, c.alive);
  }
}

function riflePosition(slot: number, side: number, initial: boolean) {
  if (initial && slot < 3) return { x: LANES[slot], y: TRENCH_Y[side] };
  return { x: LANES[slot % 3] + (slot >= 6 ? 120 : 0), y: SUPPORT_Y[side] };
}

function divisionNumber(d: Division) {
  const m = d.name.match(/^\d+/);
  return m ? m[0] : String(d.id);
}
