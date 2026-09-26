import { Rng } from "../sim/rng.ts";
import {
  BAR_DECAY,
  BAR_MAX,
  CAPITAL_BONUS,
  CAPTURE_SHARE,
  HUNGER_PENALTY,
  OPINION_AGGRESSION,
  OPINION_WAR_DECLARED_ON_ME,
  OPINION_WAR_ON_FRIEND,
  PROVINCE_YIELD,
  SECONDS_PER_DAY,
  TRAVEL_KM_PER_SEC,
  TRAVEL_MIN,
  UNITS,
  WORLD_STEP,
  captureRate,
  type UnitKind,
} from "./config.ts";
import { computeFronts, type FrontSeed } from "./fronts.ts";
import type { GameMap } from "./mapData.ts";
import { FrontBattle } from "./frontBattle.ts";
import { SCENARIO_1914 } from "./scenario.ts";
import { WorldAI } from "./worldAI.ts";

import type { Stance } from "../sim/ai.ts";
export type { Stance };
export const STANCE_NAMES: Record<Stance, string> = {
  hold: "Halten",
  defensive: "Defensiv",
  balanced: "Ausgewogen",
  aggressive: "Aggressiv",
};

export interface Resources {
  gold: number;
  food: number;
  material: number;
  recruits: number;
}

export interface Nation {
  id: number;
  key: string;
  name: string;
  short: string;
  color: string;
  capital: number;
  alive: boolean;
  res: Resources;
  /** Einkommen pro Tag (zuletzt berechnet) */
  income: Resources;
  hungry: boolean;
  opinion: number[];
  allies: number[];
  /** Ausbildung: prov = Kaserne, in der die Einheit gerade ausgebildet wird (-1 = wartet auf eine freie) */
  queue: { kind: UnitKind; left: number; prov: number }[];
  /** Sammelpunkt: frisch ausgebildete Einheiten marschieren zu diesem Frontpunkt */
  rally: number | null;
  counter: Record<UnitKind, number>;
}

export type Location =
  | { t: "prov"; prov: number }
  | { t: "front"; point: number; side: number }
  | { t: "move"; fx: number; fy: number; tx: number; ty: number; elapsed: number; dur: number; dest: Dest };

export type Dest = { t: "prov"; prov: number } | { t: "front"; point: number; side: number };

export interface Division {
  id: number;
  nation: number;
  kind: UnitKind;
  name: string;
  soldiers: number;
  quality: number;
  loc: Location;
}

export interface FrontPoint extends FrontSeed {
  id: number;
  /** + = Seite a nimmt ein, - = Seite b nimmt ein */
  bar: number;
  /** Haltung der KI-Offiziere je Seite und Flanke (links, Mitte, rechts) */
  stance: [Stance[], Stance[]];
  battle: FrontBattle | null;
  /** zuletzt berechnete Stärke je Seite */
  strength: [number, number];
}

export interface War {
  a: number;
  b: number;
  since: number;
  /** eroberte Provinzen: [von a erobert, von b erobert] */
  taken: [number, number];
}

export interface WorldEvent {
  time: number;
  text: string;
  kind: "info" | "good" | "bad" | "war";
  /** betrifft den Spieler direkt → automatische Pause */
  pause: boolean;
  point?: number;
  prov?: number;
}

export interface Decision {
  id: number;
  text: string;
  options: { label: string; act: () => void }[];
}

export class World {
  map: GameMap;
  rng: Rng;
  time = 0;
  player: number;
  owner: Int16Array;
  nations: Nation[];
  divisions = new Map<number, Division>();
  points: FrontPoint[] = [];
  wars: War[] = [];
  events: WorldEvent[] = [];
  decisions: Decision[] = [];
  /** Wird bei neuen Ereignissen aufgerufen (UI, Auto-Pause) */
  onEvent: ((e: WorldEvent) => void) | null = null;
  /** true, wenn sich Besitz oder Fronten geändert haben (Karte neu zeichnen) */
  dirty = true;
  /** Bei wichtigen Ereignissen automatisch pausieren */
  autoPause = true;
  /** Diese Schlacht wird gerade angesehen (Effekte behalten). */
  viewedPoint = -1;

  private nextDivision = 1;
  private nextPoint = 1;
  private nextDecision = 1;
  private acc = 0;
  private frontsDirty = true;
  private timers: { at: number; fn: () => void }[] = [];
  private ai = new WorldAI();

  constructor(map: GameMap, player: number, seed = 1914) {
    this.map = map;
    this.player = player;
    this.rng = new Rng(seed);
    this.owner = new Int16Array(map.provinces.length);
    for (const p of map.provinces) this.owner[p.id] = p.nation;
    const n = map.nations.length;
    this.nations = map.nations.map((d) => ({
      id: d.id,
      key: d.key,
      name: d.name,
      short: d.short,
      color: d.color,
      capital: d.capital,
      alive: true,
      res: { gold: 300, food: 200, material: 200, recruits: 3000 },
      income: { gold: 0, food: 0, material: 0, recruits: 0 },
      hungry: false,
      opinion: new Array(n).fill(0),
      allies: [],
      queue: [],
      rally: null,
      counter: { infantry: 0, mg: 0, artillery: 0, mage: 0, tank: 0, at: 0, flame: 0, storm: 0 },
    }));
    SCENARIO_1914(this);
    this.placeBarracks();
    this.updateEconomy(0);
  }

  // ================================================================ Kasernen

  /** Kasernen: feste Ausbildungsorte auf der Karte. Jede bildet eine Einheit gleichzeitig aus. */
  barracks: number[] = [];

  /**
   * Je Nation: die Hauptstadt und weitere große Städte oder Industrieprovinzen, über das Land
   * verteilt – eine Kaserne je 3 Städte/Industrieprovinzen (mindestens die Hauptstadt).
   */
  private placeBarracks() {
    const km = this.map.kmPerPx;
    for (const n of this.nations) {
      const own = this.map.provinces.filter((p) => this.owner[p.id] === n.id);
      const cand = own.filter((p) => (p.type === "stadt" || p.type === "industrie") && p.id !== n.capital).sort((a, b) => b.area - a.area);
      // höchstens 8 – mehr lässt die Wirtschaft ohnehin nicht gleichzeitig bezahlen
      const want = Math.min(8, Math.max(1, Math.floor((cand.length + (own.some((p) => p.id === n.capital) ? 1 : 0)) / 3)));
      const chosen = [n.capital];
      for (const minKm of [220, 120, 0]) {
        for (const p of cand) {
          if (chosen.length >= want) break;
          if (chosen.includes(p.id)) continue;
          const far = chosen.every((c) => Math.hypot(this.map.provinces[c].x - p.x, this.map.provinces[c].y - p.y) * km >= minKm);
          if (far) chosen.push(p.id);
        }
      }
      this.barracks.push(...chosen);
    }
  }

  /** Kasernen, die eine Nation gerade besitzt */
  barracksOf(n: number): number[] {
    return this.barracks.filter((p) => this.owner[p] === n);
  }

  /** Sammelpunkt setzen (null = keiner) */
  setRally(n: number, pointId: number | null) {
    this.nations[n].rally = pointId;
    this.dirty = true;
  }

  /** Ausbildung: freie Kasernen übernehmen wartende Einheiten, fertige Einheiten treten an */
  private updateTraining(n: Nation, dt: number) {
    const mine = this.barracksOf(n.id);
    // Kaserne verloren: die Einheit wartet auf eine andere (Fortschritt bleibt)
    for (const q of n.queue) if (q.prov >= 0 && !mine.includes(q.prov)) q.prov = -1;
    const busy = new Set(n.queue.filter((q) => q.prov >= 0).map((q) => q.prov));
    const free = mine.filter((p) => !busy.has(p));
    if (free.length > 0 && n.queue.some((q) => q.prov < 0)) {
      // Ziel: der Sammelpunkt, sonst die nächste eigene Front, sonst die Hauptstadt
      const rally = n.rally !== null ? this.point(n.rally) : null;
      const fronts = this.points.filter((p) => this.sideAt(p, n.id) >= 0);
      const cap = this.map.provinces[n.capital];
      const goal = rally ?? fronts[0] ?? { x: cap.x, y: cap.y };
      const dist = (p: number) => Math.hypot(this.map.provinces[p].x - goal.x, this.map.provinces[p].y - goal.y);
      free.sort((a, b) => dist(a) - dist(b));
      for (const q of n.queue) {
        if (q.prov >= 0) continue;
        const p = free.shift();
        if (p === undefined) break;
        q.prov = p;
      }
    }
    for (const q of n.queue) if (q.prov >= 0) q.left -= dt;
    const done = n.queue.filter((q) => q.prov >= 0 && q.left <= 0);
    if (done.length === 0) return;
    n.queue = n.queue.filter((q) => !done.includes(q));
    for (const q of done) {
      const d = this.createDivision(n.id, q.kind, q.prov);
      const rally = n.rally !== null ? this.point(n.rally) : null;
      if (rally && this.sideAt(rally, n.id) >= 0) this.send(d.id, { t: "front", point: rally.id });
      if (n.id === this.player)
        this.log(`${d.name} ist in ${this.map.provinces[q.prov].name} einsatzbereit${rally ? " und marschiert zum Sammelpunkt" : ""}.`, "good", false);
    }
  }

  // ================================================================ Abfragen

  nationByKey(key: string) {
    return this.nations.find((n) => n.key === key)!;
  }

  atWar(a: number, b: number) {
    return this.wars.some((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  }

  war(a: number, b: number) {
    return this.wars.find((w) => (w.a === a && w.b === b) || (w.a === b && w.b === a));
  }

  enemiesOf(n: number) {
    return this.wars.flatMap((w) => (w.a === n ? [w.b] : w.b === n ? [w.a] : []));
  }

  allied(a: number, b: number) {
    return this.nations[a]?.allies.includes(b) ?? false;
  }

  provincesOf(n: number) {
    const out: number[] = [];
    for (let p = 0; p < this.owner.length; p++) if (this.owner[p] === n) out.push(p);
    return out;
  }

  /** Auf welcher Seite eines Punkts kämpft eine Nation? -1 = gar nicht. */
  sideAt(point: FrontPoint, n: number): number {
    if (n === point.a) return 0;
    if (n === point.b) return 1;
    if (this.allied(n, point.a) && this.atWar(n, point.b)) return 0;
    if (this.allied(n, point.b) && this.atWar(n, point.a)) return 1;
    return -1;
  }

  divisionsAt(pointId: number, side?: number): Division[] {
    const out: Division[] = [];
    for (const d of this.divisions.values()) {
      if (d.loc.t === "front" && d.loc.point === pointId && (side === undefined || d.loc.side === side)) out.push(d);
    }
    return out;
  }

  /** Divisionen, die gerade zu einem Punkt unterwegs sind */
  incomingTo(pointId: number, side?: number): Division[] {
    const out: Division[] = [];
    for (const d of this.divisions.values()) {
      if (d.loc.t === "move" && d.loc.dest.t === "front" && d.loc.dest.point === pointId) {
        if (side === undefined || d.loc.dest.side === side) out.push(d);
      }
    }
    return out;
  }

  divisionPower(d: Division): number {
    const hungry = this.nations[d.nation].hungry ? HUNGER_PENALTY : 1;
    return d.soldiers * UNITS[d.kind].power * d.quality * hungry;
  }

  point(id: number) {
    return this.points.find((p) => p.id === id);
  }

  /** Position einer Division auf der Karte (für die Anzeige) */
  divisionPos(d: Division): { x: number; y: number } {
    if (d.loc.t === "prov") {
      const p = this.map.provinces[d.loc.prov];
      return { x: p.x, y: p.y };
    }
    if (d.loc.t === "front") {
      const pt = this.point(d.loc.point);
      return pt ? { x: pt.x, y: pt.y } : { x: 0, y: 0 };
    }
    const k = Math.min(1, d.loc.elapsed / d.loc.dur);
    return { x: d.loc.fx + (d.loc.tx - d.loc.fx) * k, y: d.loc.fy + (d.loc.ty - d.loc.fy) * k };
  }

  travelTime(from: { x: number; y: number }, to: { x: number; y: number }) {
    const km = Math.hypot(to.x - from.x, to.y - from.y) * this.map.kmPerPx;
    return Math.max(TRAVEL_MIN, km / TRAVEL_KM_PER_SEC);
  }

  // ================================================================ Befehle

  recruit(n: number, kind: UnitKind): boolean {
    const nat = this.nations[n];
    const c = UNITS[kind].cost;
    if (nat.res.gold < c.gold || nat.res.material < c.material || nat.res.recruits < c.recruits) return false;
    nat.res.gold -= c.gold;
    nat.res.material -= c.material;
    nat.res.recruits -= c.recruits;
    nat.queue.push({ kind, left: UNITS[kind].trainTime, prov: -1 });
    return true;
  }

  /** Division verlegen: zu einer Provinz oder an einen Frontpunkt. */
  send(divId: number, dest: { t: "prov"; prov: number } | { t: "front"; point: number }): boolean {
    const d = this.divisions.get(divId);
    if (!d) return false;
    let target: Dest;
    let to: { x: number; y: number };
    if (dest.t === "front") {
      const pt = this.point(dest.point);
      if (!pt) return false;
      const side = this.sideAt(pt, d.nation);
      if (side < 0) return false;
      target = { t: "front", point: pt.id, side };
      to = { x: pt.x, y: pt.y };
    } else {
      if (this.owner[dest.prov] !== d.nation) return false;
      target = dest;
      const p = this.map.provinces[dest.prov];
      to = { x: p.x, y: p.y };
    }
    const from = this.divisionPos(d);
    d.loc = { t: "move", fx: from.x, fy: from.y, tx: to.x, ty: to.y, elapsed: 0, dur: this.travelTime(from, to), dest: target };
    return true;
  }

  /** Zurück in die nächste eigene Provinz. */
  withdraw(divId: number) {
    const d = this.divisions.get(divId);
    if (!d) return;
    const home = this.nearestOwnProvince(d.nation, this.divisionPos(d));
    if (home >= 0) this.send(divId, { t: "prov", prov: home });
  }

  setStance(pointId: number, side: number, lane: number, stance: Stance) {
    const p = this.point(pointId);
    if (p) p.stance[side][lane] = stance;
  }

  declareWar(attacker: number, target: number) {
    if (attacker === target || this.atWar(attacker, target) || this.allied(attacker, target)) return;
    if (!this.nations[attacker].alive || !this.nations[target].alive) return;
    this.startWar(attacker, target);
    const A = this.nations[attacker];
    const T = this.nations[target];
    this.addOpinion(target, attacker, OPINION_WAR_DECLARED_ON_ME);
    for (const n of this.nations) {
      if (n.id === attacker || n.id === target) continue;
      this.addOpinion(n.id, attacker, n.allies.includes(target) ? OPINION_WAR_ON_FRIEND : OPINION_AGGRESSION);
    }
    this.log(`${A.short} erklärt ${T.short} den Krieg!`, "war", attacker === this.player || target === this.player);
    // Bündnispartner des Angegriffenen werden gerufen, danach die des Angreifers
    for (const ally of [...T.allies]) this.callToArms(ally, target, attacker);
    for (const ally of [...A.allies]) this.callToArms(ally, attacker, target);
  }

  /** Offene Bündnisanfrage an den Spieler: wird gesammelt, damit nur ein Dialog erscheint. */
  private pendingCall: { decision: Decision; friends: Set<number>; enemies: Set<number> } | null = null;

  /** Ein Verbündeter wird gebeten, gegen enemy in den Krieg zu ziehen. */
  private callToArms(ally: number, friend: number, enemy: number) {
    if (this.atWar(ally, enemy) || !this.nations[ally].alive || this.allied(ally, enemy)) return;
    if (ally === this.player) {
      let call = this.pendingCall;
      if (!call || !this.decisions.includes(call.decision)) {
        const decision: Decision = { id: this.nextDecision++, text: "", options: [] };
        call = { decision, friends: new Set(), enemies: new Set() };
        const c = call;
        decision.options = [
          {
            label: "Beitreten",
            act: () => {
              for (const e of c.enemies) this.declareWar(this.player, e);
            },
          },
          {
            label: "Ablehnen",
            act: () => {
              for (const f of c.friends) {
                this.addOpinion(f, this.player, -60);
                this.breakAlliance(f, this.player);
              }
              this.log("Ihr habt die Hilfe verweigert. Die Bündnisse sind zerbrochen.", "bad", false);
            },
          },
        ];
        this.pendingCall = call;
        this.decisions.push(decision);
        this.onEvent?.({ time: this.time, text: "Eure Verbündeten rufen zu den Waffen!", kind: "war", pause: true });
      }
      call.friends.add(friend);
      call.enemies.add(enemy);
      const names = (set: Set<number>) => [...set].map((n) => this.nations[n].short).join(", ");
      call.decision.text = `${names(call.friends)} ${call.friends.size > 1 ? "bitten" : "bittet"} um Beistand im Krieg gegen ${names(call.enemies)}. Tretet ihr bei?`;
      return;
    }
    if (this.nations[ally].opinion[enemy] < 20) this.declareWar(ally, enemy);
  }

  offerPeace(from: number, to: number): boolean {
    const w = this.war(from, to);
    if (!w) return false;
    const days = (this.time - w.since) / SECONDS_PER_DAY;
    if (to === this.player) {
      const F = this.nations[from];
      this.decide(`${F.short} bietet Frieden an. Die aktuellen Grenzen bleiben bestehen.`, [
        { label: "Frieden schließen", act: () => this.makePeace(from, to) },
        { label: "Weiterkämpfen", act: () => this.addOpinion(from, to, -10) },
      ]);
      return true;
    }
    // KI entscheidet: nimmt an, wenn sie verliert oder der Krieg lange feststeckt
    const toIdx = w.a === to ? 0 : 1;
    const net = w.taken[toIdx] - w.taken[1 - toIdx];
    const accept = days > 15 && (net <= -4 || (days > 365 && Math.abs(net) < 3) || this.nations[to].opinion[from] > 30);
    if (accept) this.makePeace(from, to);
    else if (from === this.player) this.log(`${this.nations[to].short} lehnt den Frieden ab.`, "bad", false);
    return accept;
  }

  makePeace(a: number, b: number) {
    this.wars = this.wars.filter((w) => !((w.a === a && w.b === b) || (w.a === b && w.b === a)));
    this.frontsDirty = true;
    this.addOpinion(a, b, 20);
    this.addOpinion(b, a, 20);
    this.log(`Frieden zwischen ${this.nations[a].short} und ${this.nations[b].short}.`, "info", a === this.player || b === this.player);
  }

  // ============================================================ Simulation

  /** Ein Simulationsschritt (dt = Schlacht-Tick). */
  update(dt: number) {
    this.time += dt;
    for (const p of this.points) {
      if (p.battle) p.battle.update(this, dt, p.id === this.viewedPoint);
    }
    this.acc += dt;
    while (this.acc >= WORLD_STEP) {
      this.acc -= WORLD_STEP;
      this.step(WORLD_STEP);
    }
  }

  /** Führt fn nach delay Sekunden Spielzeit aus. */
  schedule(delay: number, fn: () => void) {
    this.timers.push({ at: this.time + delay, fn });
  }

  private step(dt: number) {
    const due = this.timers.filter((t) => t.at <= this.time);
    if (due.length) {
      this.timers = this.timers.filter((t) => t.at > this.time);
      for (const t of due) t.fn();
    }
    if (this.frontsDirty) this.rebuildFronts();
    this.ai.update(this, dt);
    if (this.frontsDirty) this.rebuildFronts();
    this.updateEconomy(dt);
    this.updateMovement(dt);
    this.updatePoints(dt);
  }

  private updateEconomy(dt: number) {
    const days = dt / SECONDS_PER_DAY;
    for (const n of this.nations) {
      n.income = { gold: 0, food: 0, material: 0, recruits: 0 };
    }
    for (let p = 0; p < this.owner.length; p++) {
      const n = this.nations[this.owner[p]];
      if (!n) continue;
      const y = PROVINCE_YIELD[this.map.provinces[p].type];
      const k = p === n.capital ? CAPITAL_BONUS : 1;
      n.income.gold += y.gold * k;
      n.income.food += y.food;
      n.income.material += y.material;
      n.income.recruits += y.recruits;
    }
    for (const d of this.divisions.values()) {
      const u = UNITS[d.kind];
      this.nations[d.nation].income.food -= (u.food * d.soldiers) / u.size;
    }
    for (const n of this.nations) {
      if (!n.alive) continue;
      n.res.gold += n.income.gold * days;
      n.res.food += n.income.food * days;
      n.res.material += n.income.material * days;
      n.res.recruits += n.income.recruits * days;
      const wasHungry = n.hungry;
      n.hungry = n.res.food < 0;
      if (n.res.food < 0) n.res.food = 0;
      if (n.hungry && !wasHungry && n.id === this.player)
        this.log("Nahrung aufgebraucht! Die Truppen hungern und kämpfen schlechter.", "bad", true);
      // Ausbildung: jede eigene Kaserne bildet eine Einheit gleichzeitig aus
      if (dt > 0) this.updateTraining(n, dt);
    }
  }

  private updateMovement(dt: number) {
    for (const d of this.divisions.values()) {
      if (d.loc.t !== "move") continue;
      d.loc.elapsed += dt;
      if (d.loc.elapsed < d.loc.dur) continue;
      const dest = d.loc.dest;
      if (dest.t === "prov") {
        d.loc = this.owner[dest.prov] === d.nation ? { t: "prov", prov: dest.prov } : this.homeLoc(d);
      } else {
        const pt = this.point(dest.point);
        if (pt && this.sideAt(pt, d.nation) === dest.side) d.loc = { t: "front", point: pt.id, side: dest.side };
        else d.loc = this.homeLoc(d);
      }
    }
  }

  private updatePoints(dt: number) {
    const minutes = dt / 60;
    for (const p of this.points) {
      // Stärke je Seite
      const s: [number, number] = [0, 0];
      for (const d of this.divisions.values()) {
        if (d.loc.t === "front" && d.loc.point === p.id) s[d.loc.side] += this.divisionPower(d);
      }
      if (p.battle) {
        const m = p.battle.moraleFactor();
        s[0] *= m[0];
        s[1] *= m[1];
      }
      p.strength = s;

      // Schlacht nur, wenn beide Seiten da sind
      if (s[0] > 0 && s[1] > 0) {
        if (!p.battle) p.battle = new FrontBattle(this, p);
      } else if (p.battle) {
        p.battle.dispose(this);
        p.battle = null;
      }

      const total = s[0] + s[1];
      const prevBar = p.bar;
      if (total <= 0) {
        p.bar = approach(p.bar, 0, BAR_DECAY * minutes);
      } else {
        const shareA = s[0] / total;
        if (shareA >= CAPTURE_SHARE) p.bar += captureRate((1 - shareA) * 100) * minutes;
        else if (shareA <= 1 - CAPTURE_SHARE) p.bar -= captureRate(shareA * 100) * minutes;
        else p.bar = approach(p.bar, 0, BAR_DECAY * minutes);
      }
      // Warnung, wenn ein eigener Punkt zu kippen beginnt
      if (p.a === this.player || p.b === this.player) {
        const pSide = p.a === this.player ? 0 : 1;
        const mine = pSide === 0 ? -1 : 1; // Richtung, in der wir verlieren
        if (Math.sign(p.bar) === mine && Math.sign(prevBar) !== mine && s[pSide] === 0)
          this.log(`Frontpunkt bei ${this.map.provinces[pSide === 0 ? p.provA : p.provB].name} ist unbewacht und wird eingenommen!`, "bad", true, p.id);
      }
      if (p.bar >= BAR_MAX) this.capture(p, 0);
      else if (p.bar <= -BAR_MAX) this.capture(p, 1);
    }
    for (const [id, d] of this.divisions) {
      if (d.soldiers <= 0) {
        this.divisions.delete(id);
        if (d.nation === this.player) this.log(`${d.name} wurde aufgerieben.`, "bad", false);
      }
    }
  }

  /** Die Schlacht an einem Frontpunkt ist entschieden: der Sieger nimmt die Provinz sofort. */
  battleDecided(p: FrontPoint, winnerSide: number) {
    if (!this.points.includes(p)) return;
    this.capture(p, winnerSide);
  }

  private capture(p: FrontPoint, winnerSide: number) {
    const winner = winnerSide === 0 ? p.a : p.b;
    const loser = winnerSide === 0 ? p.b : p.a;
    const prov = winnerSide === 0 ? p.provB : p.provA;
    p.bar = 0;
    if (p.battle) {
      p.battle.dispose(this);
      p.battle = null;
    }
    const before = this.components(loser);
    this.setOwner(prov, winner);
    const w = this.war(winner, loser);
    if (w) w.taken[w.a === winner ? 0 : 1]++;
    const name = this.map.provinces[prov].name;
    if (winner === this.player) this.log(`${name} eingenommen!`, "good", false, undefined, prov);
    else if (loser === this.player) this.log(`${name} ist an ${this.nations[winner].short} gefallen!`, "bad", true, undefined, prov);

    // Eingekesselte Gebiete ergeben sich
    const capComp = before.get(this.nations[loser].capital);
    const after = this.components(loser);
    const capAfter = after.get(this.nations[loser].capital);
    let pocket = 0;
    for (const [q, comp] of before) {
      if (comp !== capComp || this.owner[q] !== loser) continue;
      if (after.get(q) === capAfter) continue;
      if (this.map.provinces[q].nb.some(([r]) => this.owner[r] === winner)) {
        this.setOwner(q, winner);
        pocket++;
      }
    }
    if (pocket > 0 && (winner === this.player || loser === this.player))
      this.log(`${pocket} eingekesselte Provinz(en) haben sich ergeben.`, winner === this.player ? "good" : "bad", false);

    // Hauptstadt verloren?
    const L = this.nations[loser];
    if (this.owner[L.capital] !== loser) {
      const rest = this.provincesOf(loser);
      if (rest.length === 0) {
        this.eliminate(loser, winner);
      } else {
        L.capital = rest.sort((a, b) => this.map.provinces[b].area - this.map.provinces[a].area)[0];
        // die neue Hauptstadt bekommt eine Kaserne, damit weiter ausgebildet werden kann
        if (!this.barracks.includes(L.capital)) this.barracks.push(L.capital);
        this.log(`${L.short} verlegt die Hauptstadt nach ${this.map.provinces[L.capital].name}.`, "info", loser === this.player);
      }
    }
    this.frontsDirty = true;
  }

  private eliminate(n: number, by: number) {
    const N = this.nations[n];
    N.alive = false;
    this.wars = this.wars.filter((w) => w.a !== n && w.b !== n);
    for (const [id, d] of this.divisions) if (d.nation === n) this.divisions.delete(id);
    this.log(`${N.name} hat aufgehört zu existieren. ${this.nations[by].short} triumphiert.`, n === this.player ? "bad" : "war", true);
  }

  private setOwner(prov: number, n: number) {
    this.owner[prov] = n;
    this.dirty = true;
    // Truppen in einer verlorenen Provinz ziehen sich zurück
    for (const d of this.divisions.values()) {
      if (d.loc.t === "prov" && d.loc.prov === prov && d.nation !== n) d.loc = this.homeLoc(d);
    }
  }

  /** Zusammenhängende Gebiete einer Nation über Landgrenzen: Provinz → Komponenten-ID */
  private components(n: number): Map<number, number> {
    const comp = new Map<number, number>();
    let id = 0;
    for (let p = 0; p < this.owner.length; p++) {
      if (this.owner[p] !== n || comp.has(p)) continue;
      const stack = [p];
      comp.set(p, id);
      while (stack.length) {
        const q = stack.pop()!;
        for (const [r] of this.map.provinces[q].nb) {
          if (this.owner[r] === n && !comp.has(r)) {
            comp.set(r, id);
            stack.push(r);
          }
        }
      }
      id++;
    }
    return comp;
  }

  // ================================================================ Fronten

  private rebuildFronts() {
    this.frontsDirty = false;
    this.dirty = true;
    const seeds = computeFronts(this.map, this.owner, this.wars);
    const old = this.points;
    const used = new Set<FrontPoint>();
    const next: FrontPoint[] = [];
    for (const s of seeds) {
      let best: FrontPoint | null = null;
      let bd = 120;
      for (const o of old) {
        if (used.has(o) || o.a !== s.a || o.b !== s.b) continue;
        const d = Math.hypot(o.x - s.x, o.y - s.y);
        if (d < bd) {
          bd = d;
          best = o;
        }
      }
      if (best) {
        used.add(best);
        const same = best.provA === s.provA && best.provB === s.provB;
        if (!same && best.battle) {
          best.battle.dispose(this);
          best.battle = null;
        }
        Object.assign(best, s);
        next.push(best);
      } else {
        next.push({
          ...s,
          id: this.nextPoint++,
          bar: 0,
          stance: [
            ["defensive", "defensive", "defensive"],
            ["defensive", "defensive", "defensive"],
          ],
          battle: null,
          strength: [0, 0],
        });
      }
    }
    this.points = next;
    // Truppen verschwundener Punkte zum nächsten Punkt oder nach Hause
    for (const o of old) {
      if (used.has(o)) continue;
      if (o.battle) o.battle.dispose(this);
      // Sammelpunkt wandert mit der Front (oder entfällt)
      for (const n of this.nations) {
        if (n.rally !== o.id) continue;
        const alt = this.nearestPointFor({ nation: n.id }, o);
        n.rally = alt ? alt.id : null;
        if (n.id === this.player && !alt) this.log("Der Sammelpunkt ist weggefallen – neue Einheiten bleiben in der Kaserne.", "info", false);
      }
      for (const d of this.divisions.values()) {
        const at = d.loc.t === "front" && d.loc.point === o.id;
        const going = d.loc.t === "move" && d.loc.dest.t === "front" && d.loc.dest.point === o.id;
        if (!at && !going) continue;
        const alt = this.nearestPointFor(d, o);
        if (alt) {
          if (at) d.loc = { t: "front", point: alt.id, side: this.sideAt(alt, d.nation) };
          else if (d.loc.t === "move") {
            d.loc.dest = { t: "front", point: alt.id, side: this.sideAt(alt, d.nation) };
            d.loc.tx = alt.x;
            d.loc.ty = alt.y;
          }
        } else if (at) d.loc = this.homeLoc(d);
        else this.withdraw(d.id);
      }
    }
  }

  private nearestPointFor(d: Pick<Division, "nation">, near: { x: number; y: number }) {
    let best: FrontPoint | null = null;
    let bd = 250;
    for (const p of this.points) {
      if (this.sideAt(p, d.nation) < 0) continue;
      const dist = Math.hypot(p.x - near.x, p.y - near.y);
      if (dist < bd) {
        bd = dist;
        best = p;
      }
    }
    return best;
  }

  // ================================================================ Hilfen

  createDivision(n: number, kind: UnitKind, prov: number): Division {
    const nat = this.nations[n];
    nat.counter[kind]++;
    const d: Division = {
      id: this.nextDivision++,
      nation: n,
      kind,
      name: `${nat.counter[kind]}. ${UNITS[kind].name}`,
      soldiers: UNITS[kind].size,
      quality: 1,
      loc: { t: "prov", prov },
    };
    this.divisions.set(d.id, d);
    return d;
  }

  startWar(a: number, b: number) {
    this.wars.push({ a, b, since: this.time, taken: [0, 0] });
    this.frontsDirty = true;
  }

  addOpinion(of: number, about: number, delta: number) {
    const o = this.nations[of].opinion;
    o[about] = Math.max(-100, Math.min(100, o[about] + delta));
  }

  ally(a: number, b: number) {
    if (!this.nations[a].allies.includes(b)) this.nations[a].allies.push(b);
    if (!this.nations[b].allies.includes(a)) this.nations[b].allies.push(a);
  }

  breakAlliance(a: number, b: number) {
    this.nations[a].allies = this.nations[a].allies.filter((x) => x !== b);
    this.nations[b].allies = this.nations[b].allies.filter((x) => x !== a);
  }

  nearestOwnProvince(n: number, pos: { x: number; y: number }): number {
    let best = -1;
    let bd = Infinity;
    for (let p = 0; p < this.owner.length; p++) {
      if (this.owner[p] !== n) continue;
      const pr = this.map.provinces[p];
      const d = (pr.x - pos.x) ** 2 + (pr.y - pos.y) ** 2;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    return best;
  }

  private homeLoc(d: Division): Location {
    const p = this.nearestOwnProvince(d.nation, this.divisionPos(d));
    return { t: "prov", prov: p >= 0 ? p : this.nations[d.nation].capital };
  }

  log(text: string, kind: WorldEvent["kind"], pause: boolean, point?: number, prov?: number) {
    const e: WorldEvent = { time: this.time, text, kind, pause, point, prov };
    this.events.push(e);
    if (this.events.length > 200) this.events.shift();
    this.onEvent?.(e);
  }

  decide(text: string, options: Decision["options"]) {
    this.decisions.push({ id: this.nextDecision++, text, options });
    this.onEvent?.({ time: this.time, text, kind: "war", pause: true });
  }

  resolveDecision(id: number, option: number) {
    const d = this.decisions.find((x) => x.id === id);
    if (!d) return;
    this.decisions = this.decisions.filter((x) => x.id !== id);
    d.options[option]?.act();
  }

  /** Datum im Spiel (1 Minute = 1 Tag) */
  dateString(): string {
    const date = new Date(Date.UTC(1914, 6, 28) + Math.floor(this.time / SECONDS_PER_DAY) * 86400000);
    return date.toLocaleDateString("de-DE", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  }
}

function approach(v: number, target: number, step: number) {
  if (v < target) return Math.min(target, v + step);
  return Math.max(target, v - step);
}
