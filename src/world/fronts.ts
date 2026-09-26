import { frontPointsFor } from "./config.ts";
import type { GameMap } from "./mapData.ts";

export interface FrontSeed {
  a: number;
  b: number;
  x: number;
  y: number;
  /** Provinz von a bzw. b, um die an diesem Punkt gekämpft wird */
  provA: number;
  provB: number;
  /** Grenzlänge, die dieser Punkt abdeckt (km) */
  km: number;
}

interface Pair {
  p: number; // Provinz von a
  q: number; // Provinz von b
  km: number;
  mx: number;
  my: number;
}

/**
 * Berechnet die Frontpunkte für alle Kriege: entlang jeder gemeinsamen Landgrenze
 * je nach Länge 1 bis n Punkte, gleichmäßig verteilt.
 */
export function computeFronts(map: GameMap, owner: ArrayLike<number>, wars: { a: number; b: number }[]): FrontSeed[] {
  const out: FrontSeed[] = [];
  for (const w of wars) {
    const a = Math.min(w.a, w.b);
    const b = Math.max(w.a, w.b);
    const pairs: Pair[] = [];
    for (const pr of map.provinces) {
      if (owner[pr.id] !== a) continue;
      for (const [q, km] of pr.nb) {
        if (owner[q] !== b) continue;
        const qr = map.provinces[q];
        pairs.push({ p: pr.id, q, km: Math.max(1, km), mx: (pr.x + qr.x) / 2, my: (pr.y + qr.y) / 2 });
      }
    }
    for (const comp of connectedSegments(pairs)) out.push(...splitSegment(comp, a, b));
  }
  return out;
}

/** Grenzabschnitte, die nicht zusammenhängen (z. B. zwei getrennte Grenzen), einzeln behandeln. */
function connectedSegments(pairs: Pair[]): Pair[][] {
  const byProv = new Map<string, number[]>();
  pairs.forEach((pr, i) => {
    for (const key of [`a${pr.p}`, `b${pr.q}`]) {
      if (!byProv.has(key)) byProv.set(key, []);
      byProv.get(key)!.push(i);
    }
  });
  const seen = new Uint8Array(pairs.length);
  const comps: Pair[][] = [];
  for (let i = 0; i < pairs.length; i++) {
    if (seen[i]) continue;
    const stack = [i];
    seen[i] = 1;
    const comp: Pair[] = [];
    while (stack.length) {
      const k = stack.pop()!;
      comp.push(pairs[k]);
      const pr = pairs[k];
      for (const key of [`a${pr.p}`, `b${pr.q}`]) {
        for (const j of byProv.get(key)!) {
          if (!seen[j]) {
            seen[j] = 1;
            stack.push(j);
          }
        }
      }
    }
    comps.push(comp);
  }
  return comps;
}

function splitSegment(pairs: Pair[], a: number, b: number): FrontSeed[] {
  const total = pairs.reduce((s, p) => s + p.km, 0);
  const k = Math.min(pairs.length, frontPointsFor(total));
  // Hauptrichtung der Grenze (Hauptkomponente), entlang der wir aufteilen
  let mx = 0;
  let my = 0;
  for (const p of pairs) {
    mx += p.mx * p.km;
    my += p.my * p.km;
  }
  mx /= total;
  my /= total;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const p of pairs) {
    const dx = p.mx - mx;
    const dy = p.my - my;
    sxx += dx * dx * p.km;
    sxy += dx * dy * p.km;
    syy += dy * dy * p.km;
  }
  const angle = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  const sorted = [...pairs].sort((p, q) => (p.mx - mx) * ux + (p.my - my) * uy - ((q.mx - mx) * ux + (q.my - my) * uy));

  const out: FrontSeed[] = [];
  let i = 0;
  for (let c = 0; c < k; c++) {
    const goal = (total * (c + 1)) / k;
    const chunk: Pair[] = [];
    let acc = sorted.slice(0, i).reduce((s, p) => s + p.km, 0);
    while (i < sorted.length && (acc < goal - 1e-6 || chunk.length === 0)) {
      chunk.push(sorted[i]);
      acc += sorted[i].km;
      i++;
    }
    if (c === k - 1) while (i < sorted.length) chunk.push(sorted[i++]);
    if (chunk.length === 0) continue;
    const km = chunk.reduce((s, p) => s + p.km, 0);
    const byP = new Map<number, number>();
    const byQ = new Map<number, number>();
    let x = 0;
    let y = 0;
    for (const p of chunk) {
      byP.set(p.p, (byP.get(p.p) ?? 0) + p.km);
      byQ.set(p.q, (byQ.get(p.q) ?? 0) + p.km);
      x += p.mx * p.km;
      y += p.my * p.km;
    }
    x /= km;
    y /= km;
    // Der Punkt sitzt auf der Grenze des Paares, das dem Schwerpunkt am nächsten liegt
    let best = chunk[0];
    let bd = Infinity;
    for (const p of chunk) {
      const d = (p.mx - x) ** 2 + (p.my - y) ** 2 - p.km * 0.5;
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
    out.push({ a, b, x: best.mx, y: best.my, provA: best.p, provB: best.q, km });
  }
  return out;
}
