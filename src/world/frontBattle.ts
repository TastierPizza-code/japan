import { BattleAI } from "../sim/ai.ts";
import { Battle } from "../sim/battle.ts";
import {
  COMPANY_SIZE,
  GUN_Y,
  MG_PER_SECTION,
  REAR_Y,
  STORM_PER_SQUAD,
  UNIT_AT,
  UNIT_FLAME,
  UNIT_GUN,
  UNIT_MAGE,
  UNIT_MG,
  UNIT_RIFLE,
  UNIT_STORM,
  UNIT_TANK,
  WORLD_W,
} from "../sim/config.ts";
import { FIELD_RIFLE_COMPANIES } from "./config.ts";
import type { Division, FrontPoint, World } from "./world.ts";

const LANES = [WORLD_W / 6, WORLD_W / 2, (WORLD_W * 5) / 6];
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
        if (c.side !== bs || c.alive <= 0 || c.type === UNIT_MAGE || c.type === UNIT_GUN || c.type === UNIT_TANK) continue;
        sum += c.morale * c.alive;
        n += c.alive;
      }
      let f = n > 0 ? 0.6 + 0.4 * (sum / n / 100) : 1;
      const held = b.objectives.filter((o) => o.owner === bs && Math.abs(o.y - b.terrain.frontY(1 - bs, o.x)) < 30).length;
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
    const t = b.terrain;
    for (let bs = 0; bs < 2; bs++) {
      const divs = world.divisionsAt(point.id, this.sideMap[bs]).sort((x, y) => x.id - y.id);
      const onField = new Map<number, number>();
      let rifles = 0;
      const count: Record<number, number> = {};
      for (const c of b.companies) {
        if (c.side !== bs || c.alive <= 0) continue;
        onField.set(c.division, (onField.get(c.division) ?? 0) + c.alive);
        if (c.type === UNIT_RIFLE && c.order !== "rout") rifles++;
        count[c.type] = (count[c.type] ?? 0) + 1;
      }
      const slotOf = (type: number) => count[type] ?? 0;
      const bump = (type: number) => (count[type] = (count[type] ?? 0) + 1);
      const mgSpots = b.mgSpots(bs);

      for (const d of divs) {
        let spare = d.soldiers - (onField.get(d.id) ?? 0);
        let k = b.companies.filter((c) => c.division === d.id).length;
        const num = divisionNumber(d);
        const spawn = (type: number, name: string, x: number, y: number, size: number) => {
          const c = b.spawnCompany(bs, type, name, x, y, size, d.id, initial || type === UNIT_GUN);
          this.lastAlive.set(c.id, c.alive);
          spare -= size;
          bump(type);
        };
        if (d.kind === "infantry") {
          while (spare >= 30 && rifles < FIELD_RIFLE_COMPANIES) {
            // Dort hin, wo die Front am dünnsten besetzt ist – nicht alle auf dieselben drei Punkte
            const { x, y } = b.freeSlot(bs, true);
            spawn(UNIT_RIFLE, `${num}.${++k}`, x, y, Math.min(COMPANY_SIZE, spare));
            rifles++;
          }
        } else if (d.kind === "mg") {
          while (spare >= 1) {
            const slot = slotOf(UNIT_MG);
            const spot = mgSpots[slot % mgSpots.length];
            spawn(UNIT_MG, `MG ${num}.${++k}`, spot.x + Math.floor(slot / mgSpots.length) * 50, spot.y, Math.min(MG_PER_SECTION, spare));
          }
        } else if (d.kind === "artillery") {
          if (spare >= 1) {
            const slot = slotOf(UNIT_GUN);
            spawn(UNIT_GUN, `${num}. Batterie`, WORLD_W / 2 + ((slot % 3) - 1) * 380, GUN_Y[bs], spare);
          }
        } else if (d.kind === "tank") {
          if (spare >= 1) {
            const slot = slotOf(UNIT_TANK);
            const x = LANES[slot % 3];
            spawn(UNIT_TANK, `Pz ${num}`, x, b.tankPark(bs, x), spare);
          }
        } else if (d.kind === "at") {
          if (spare >= 1) {
            const slot = slotOf(UNIT_AT);
            const x = LANES[(slot + 1) % 3] + 90;
            spawn(UNIT_AT, `AT ${num}`, x, t.frontY(bs, x), spare);
          }
        } else if (d.kind === "flame") {
          if (spare >= 1) {
            const slot = slotOf(UNIT_FLAME);
            const x = LANES[slot % 3] - 90;
            spawn(UNIT_FLAME, `Fl ${num}`, x, t.supportY(bs, x), spare);
          }
        } else if (d.kind === "storm") {
          if (spare >= 1) {
            const slot = slotOf(UNIT_STORM);
            const x = LANES[(slot + 2) % 3] + 60;
            spawn(UNIT_STORM, `St ${num}`, x, t.supportY(bs, x), Math.min(STORM_PER_SQUAD, spare));
          }
        } else if (d.kind === "mage") {
          if (spare >= 1) spawn(UNIT_MAGE, `✦ ${num}`, WORLD_W / 2, REAR_Y[bs], spare);
        }
      }
    }
  }
}

function divisionNumber(d: Division) {
  const m = d.name.match(/^\d+/);
  return m ? m[0] : String(d.id);
}
