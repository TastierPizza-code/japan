import { SECONDS_PER_DAY, UNITS, type UnitKind } from "./config.ts";
import type { Division, FrontPoint, Stance, World } from "./world.ts";

/**
 * Computergesteuerte Nationen: rekrutieren, verteilen Truppen auf die Fronten,
 * stellen ihre Offiziere ein und entscheiden über Krieg und Frieden.
 */
export class WorldAI {
  private timer = 0;
  private diploTimer = 20;

  update(w: World, dt: number) {
    this.timer -= dt;
    this.diploTimer -= dt;
    if (this.timer <= 0) {
      this.timer = 4;
      for (const n of w.nations) {
        if (!n.alive || n.id === w.player) continue;
        this.recruit(w, n.id);
        this.deploy(w, n.id);
        this.stances(w, n.id);
      }
    }
    if (this.diploTimer <= 0) {
      this.diploTimer = 30;
      for (const n of w.nations) {
        if (!n.alive || n.id === w.player) continue;
        this.diplomacy(w, n.id);
      }
    }
  }

  private recruit(w: World, n: number) {
    const nat = w.nations[n];
    if (nat.queue.length >= 2) return;
    const atWar = w.enemiesOf(n).length > 0;
    const r = w.rng.next();
    let kind: UnitKind = "infantry";
    if (r < 0.1 && nat.res.gold > 500) kind = "mage";
    else if (r < 0.16 && nat.res.material > 400) kind = "tank";
    else if (r < 0.3) kind = "artillery";
    else if (r < 0.42) kind = "mg";
    else if (r < 0.48) kind = "at";
    else if (r < 0.53) kind = "flame";
    else if (r < 0.58) kind = "storm";
    // Im Frieden sparsamer: Rücklage behalten
    const c = UNITS[kind].cost;
    const reserve = atWar ? 1 : 2.5;
    if (nat.res.gold >= c.gold * reserve && nat.res.material >= c.material * reserve && nat.res.recruits >= c.recruits) {
      w.recruit(n, kind);
    }
  }

  /** Freie Divisionen dorthin schicken, wo sie am dringendsten gebraucht werden. */
  private deploy(w: World, n: number) {
    const points = w.points.filter((p) => w.sideAt(p, n) >= 0);
    if (points.length === 0) return;
    const idle = [...w.divisions.values()].filter((d) => d.nation === n && d.loc.t === "prov");
    if (idle.length === 0) return;

    const need = new Map<FrontPoint, number>();
    for (const p of points) {
      const side = w.sideAt(p, n);
      const own = sum(w, [...w.divisionsAt(p.id, side), ...w.incomingTo(p.id, side)]);
      const enemy = sum(w, [...w.divisionsAt(p.id, 1 - side), ...w.incomingTo(p.id, 1 - side)]);
      // Verteidigung: mindestens gleich stark, besser etwas mehr. Eigene Grenzpunkte zählen doppelt.
      const principal = p.a === n || p.b === n ? 1 : 0.5;
      need.set(p, (enemy * 1.3 + 300 - own) * principal);
    }
    // Schwerpunkt für den Angriff: der Punkt, an dem 70 % am leichtesten zu erreichen sind
    let focus: FrontPoint | null = null;
    let focusGap = Infinity;
    for (const p of points) {
      if (p.a !== n && p.b !== n) continue;
      const side = w.sideAt(p, n);
      const own = sum(w, [...w.divisionsAt(p.id, side), ...w.incomingTo(p.id, side)]);
      const enemy = sum(w, w.divisionsAt(p.id, 1 - side));
      const gap = enemy * 2.5 - own;
      if (gap > 0 && gap < focusGap) {
        focusGap = gap;
        focus = p;
      }
    }

    // Etwas zu Hause lassen, solange es Grenzen ohne Krieg gibt? Hier: alles an die Front.
    idle.sort((a, b) => w.divisionPower(b) - w.divisionPower(a));
    for (const d of idle) {
      let best: FrontPoint | null = null;
      let bestNeed = 0;
      for (const [p, v] of need) {
        if (v > bestNeed) {
          bestNeed = v;
          best = p;
        }
      }
      if (!best || (d.kind !== "infantry" && focus)) best = focus ?? best;
      if (!best) best = points[Math.floor(w.rng.next() * points.length)];
      if (w.send(d.id, { t: "front", point: best.id })) {
        need.set(best, (need.get(best) ?? 0) - w.divisionPower(d));
      }
    }
  }

  private stances(w: World, n: number) {
    for (const p of w.points) {
      if (p.a !== n && p.b !== n) continue;
      const side = p.a === n ? 0 : 1;
      const total = p.strength[0] + p.strength[1];
      const share = total > 0 ? p.strength[side] / total : 0.5;
      const s: Stance = share >= 0.6 ? "aggressive" : share >= 0.45 ? "balanced" : "defensive";
      p.stance[side] = [s, s, s];
    }
  }

  private diplomacy(w: World, n: number) {
    const nat = w.nations[n];
    // Frieden, wenn ein Krieg lange dauert oder schlecht läuft
    for (const e of w.enemiesOf(n)) {
      const war = w.war(n, e)!;
      const days = (w.time - war.since) / SECONDS_PER_DAY;
      const idx = war.a === n ? 0 : 1;
      const net = war.taken[idx] - war.taken[1 - idx];
      // Kriege sollen lange dauern: Frieden nur bei klarer Niederlage oder nach über einem Jahr
      if ((days > 30 && net <= -5) || (days > 365 && w.rng.next() < 0.05)) {
        w.offerPeace(n, e);
        return;
      }
    }
    // Krieg: nur gegen verhasste, schwächere Nachbarn, und nicht zu viele Kriege gleichzeitig
    if (w.enemiesOf(n).length > 0 || w.time < 240) return;
    const myPower = armyPower(w, n);
    for (const other of w.nations) {
      if (!other.alive || other.id === n || w.allied(n, other.id)) continue;
      if (nat.opinion[other.id] > -40) continue;
      if (!borders(w, n, other.id)) continue;
      const theirs = armyPower(w, other.id) + other.allies.reduce((s, a) => s + armyPower(w, a) * 0.5, 0);
      if (myPower > theirs * 1.4 && w.rng.next() < 0.15) {
        w.declareWar(n, other.id);
        return;
      }
    }
  }
}

function sum(w: World, divs: Division[]) {
  return divs.reduce((s, d) => s + w.divisionPower(d), 0);
}

function armyPower(w: World, n: number) {
  let s = 0;
  for (const d of w.divisions.values()) if (d.nation === n) s += w.divisionPower(d);
  return s;
}

function borders(w: World, a: number, b: number) {
  for (let p = 0; p < w.owner.length; p++) {
    if (w.owner[p] !== a) continue;
    if (w.map.provinces[p].nb.some(([q]) => w.owner[q] === b)) return true;
  }
  return false;
}
