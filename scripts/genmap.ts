// Erzeugt die Kampagnenkarte aus Natural-Earth-Daten (gemeinfrei, über das Paket world-atlas).
//   npm run genmap
// Ergebnis: public/maps/<region>.json
import { readFileSync, writeFileSync } from "node:fs";
import { feature } from "topojson-client";
import type { Topology } from "topojson-specification";
import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";
import { COUNTRIES, EUROPE, NATIONS, type RegionSpec } from "./mapdef.ts";
import { encodeRle, type MapFile, type ProvinceDef, type ProvinceType } from "../src/world/mapData.ts";
import { Rng } from "../src/sim/rng.ts";

const region: RegionSpec = EUROPE;
const rng = new Rng(1914);

const cosRef = Math.cos((region.refLat * Math.PI) / 180);
const W = Math.ceil(((region.lonMax - region.lonMin) * cosRef) / region.degPerPx);
const H = Math.ceil((region.latMax - region.latMin) / region.degPerPx);
const KM_PER_PX = region.degPerPx * 111.2;
const px = (lon: number) => ((lon - region.lonMin) * cosRef) / region.degPerPx;
const py = (lat: number) => (region.latMax - lat) / region.degPerPx;
const lonOf = (x: number) => region.lonMin + ((x + 0.5) * region.degPerPx) / cosRef;
const latOf = (y: number) => region.latMax - (y + 0.5) * region.degPerPx;

console.log(`Region ${region.name}: ${W}×${H} Pixel, ${KM_PER_PX.toFixed(1)} km/Pixel`);

function hashNoise(x: number, y: number) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
function valueNoise(x: number, y: number, scale: number) {
  const gx = x / scale;
  const gy = y / scale;
  const x0 = Math.floor(gx);
  const y0 = Math.floor(gy);
  const fx = gx - x0;
  const fy = gy - y0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);
  const a = hashNoise(x0, y0);
  const b = hashNoise(x0 + 1, y0);
  const c = hashNoise(x0, y0 + 1);
  const d = hashNoise(x0 + 1, y0 + 1);
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
}

// ------------------------------------------------------------ Länder rastern
const topo = JSON.parse(readFileSync("node_modules/world-atlas/countries-50m.json", "utf8")) as Topology;
const fc = feature(topo, topo.objects.countries) as FeatureCollection<Polygon | MultiPolygon, { name: string }>;

const nationIndex = new Map(NATIONS.map((n, i) => [n.key, i]));
const nationMap = new Int16Array(W * H).fill(-1);

function fillPolygon(rings: number[][][], set: (x: number, y: number) => void) {
  const edges: number[] = []; // x1,y1,x2,y2
  let minY = Infinity;
  let maxY = -Infinity;
  for (const raw of rings) {
    const wraps = raw.some((c) => c[0] < -170) && raw.some((c) => c[0] > 170);
    const ring = wraps ? raw.map((c) => [c[0] < 0 ? c[0] + 360 : c[0], c[1]]) : raw;
    for (let i = 0; i < ring.length - 1; i++) {
      const x1 = px(ring[i][0]);
      const y1 = py(ring[i][1]);
      const x2 = px(ring[i + 1][0]);
      const y2 = py(ring[i + 1][1]);
      edges.push(x1, y1, x2, y2);
      minY = Math.min(minY, y1, y2);
      maxY = Math.max(maxY, y1, y2);
    }
  }
  const y0 = Math.max(0, Math.floor(minY));
  const y1 = Math.min(H - 1, Math.ceil(maxY));
  const xs: number[] = [];
  for (let y = y0; y <= y1; y++) {
    const yc = y + 0.5;
    xs.length = 0;
    for (let e = 0; e < edges.length; e += 4) {
      const ay = edges[e + 1];
      const by = edges[e + 3];
      if (ay <= yc !== by <= yc) {
        const ax = edges[e];
        const bx = edges[e + 2];
        xs.push(ax + ((yc - ay) * (bx - ax)) / (by - ay));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const from = Math.max(0, Math.ceil(xs[i] - 0.5));
      const to = Math.min(W - 1, Math.floor(xs[i + 1] - 0.5));
      for (let x = from; x <= to; x++) set(x, y);
    }
  }
}

const unknown = new Set<string>();
for (const f of fc.features as Feature<Polygon | MultiPolygon, { name: string }>[]) {
  const rule = COUNTRIES[f.properties.name];
  if (!rule) {
    unknown.add(f.properties.name);
    continue;
  }
  const polys = f.geometry.type === "Polygon" ? [f.geometry.coordinates] : f.geometry.coordinates;
  for (const poly of polys) {
    fillPolygon(poly, (x, y) => {
      const jx = (valueNoise(x, y, 14) - 0.5) * 0.9 + (valueNoise(x + 500, y, 4) - 0.5) * 0.25;
      const jy = (valueNoise(x, y + 700, 14) - 0.5) * 0.6 + (valueNoise(x, y + 900, 4) - 0.5) * 0.2;
      const key = typeof rule === "string" ? rule : rule(lonOf(x) + jx, latOf(y) + jy);
      nationMap[y * W + x] = nationIndex.get(key)!;
    });
  }
}

// Kleine Enklaven (Artefakte der vereinfachten Grenzen) dem umgebenden Land zuschlagen
{
  const MIN_ENCLAVE = 80;
  const seen = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    if (nationMap[i] < 0 || seen[i]) continue;
    const n = nationMap[i];
    const comp = [i];
    seen[i] = 1;
    const around = new Map<number, number>();
    for (let k = 0; k < comp.length; k++) {
      const c = comp[k];
      const x = c % W;
      for (const j of [x + 1 < W ? c + 1 : -1, x > 0 ? c - 1 : -1, c + W < W * H ? c + W : -1, c - W]) {
        if (j < 0) continue;
        const m = nationMap[j];
        if (m === n) {
          if (!seen[j]) {
            seen[j] = 1;
            comp.push(j);
          }
        } else if (m >= 0) around.set(m, (around.get(m) ?? 0) + 1);
      }
    }
    if (comp.length >= MIN_ENCLAVE || around.size === 0) continue;
    const target = [...around.entries()].sort((a, b) => b[1] - a[1])[0][0];
    for (const c of comp) nationMap[c] = target;
  }
}

// ------------------------------------------------ Provinzen (Voronoi mit Rauschen)
const R = region.provinceSpacing;
const seedsX: number[] = [];
const seedsY: number[] = [];
const seedsNation: number[] = [];
{
  // Poisson-Disk: Pixel in zufälliger Reihenfolge, Sitz nur mit Mindestabstand R (pro Nation)
  const order: number[] = [];
  for (let i = 0; i < W * H; i++) if (nationMap[i] >= 0) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const cs = R;
  const gw = Math.ceil(W / cs);
  const buckets = new Map<number, number[]>();
  for (const i of order) {
    const x = i % W;
    const y = (i / W) | 0;
    const n = nationMap[i];
    const cx = Math.floor(x / cs);
    const cy = Math.floor(y / cs);
    const r = R * region.spacingFactor(lonOf(x), latOf(y));
    const reach = Math.ceil(r / cs);
    let ok = true;
    for (let dy = -reach; dy <= reach && ok; dy++) {
      for (let dx = -reach; dx <= reach && ok; dx++) {
        const list = buckets.get((cy + dy) * gw + cx + dx);
        if (!list) continue;
        for (const s of list) {
          if (seedsNation[s] === n && (seedsX[s] - x) ** 2 + (seedsY[s] - y) ** 2 < r * r) {
            ok = false;
            break;
          }
        }
      }
    }
    if (!ok) continue;
    const id = seedsX.length;
    seedsX.push(x);
    seedsY.push(y);
    seedsNation.push(n);
    const key = cy * gw + cx;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(id);
  }
}

// Wachsen lassen: Priorität = Abstand zum Keim + Rauschen, nur innerhalb der eigenen Nation
const prov = new Int32Array(W * H).fill(-1);
class Heap {
  k: number[] = [];
  v: number[] = [];
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= k[i]) break;
      [k[p], k[i]] = [k[i], k[p]];
      [v[p], v[i]] = [v[i], v[p]];
      i = p;
    }
  }
  pop(): number {
    const k = this.k;
    const v = this.v;
    const top = v[0];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length > 0) {
      k[0] = lk;
      v[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < k.length && k[l] < k[m]) m = l;
        if (r < k.length && k[r] < k[m]) m = r;
        if (m === i) break;
        [k[m], k[i]] = [k[i], k[m]];
        [v[m], v[i]] = [v[i], v[m]];
        i = m;
      }
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

function grow(seeds: number[]) {
  const heap = new Heap();
  for (const s of seeds) {
    const i = seedsY[s] * W + seedsX[s];
    if (prov[i] >= 0) continue;
    prov[i] = s;
    heap.push(0, i);
  }
  while (heap.size > 0) {
    const i = heap.pop();
    const s = prov[i];
    const x = i % W;
    const y = (i / W) | 0;
    for (const [dx, dy] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const j = ny * W + nx;
      if (prov[j] >= 0 || nationMap[j] !== seedsNation[s]) continue;
      prov[j] = s;
      const d = Math.hypot(nx - seedsX[s], ny - seedsY[s]) / region.spacingFactor(lonOf(seedsX[s]), latOf(seedsY[s]));
      const noise = (valueNoise(nx, ny, 9) - 0.5) * R * 0.9 + (valueNoise(nx + 999, ny, 3) - 0.5) * 3;
      heap.push(d + noise, j);
    }
  }
}
grow(seedsX.map((_, i) => i));

// Nicht erreichte Inseln: große bekommen eine eigene Provinz, kleine werden Meer
const MIN_ISLAND = 25;
for (let i = 0; i < W * H; i++) {
  if (nationMap[i] < 0 || prov[i] >= 0) continue;
  const comp: number[] = [i];
  const seen = new Set([i]);
  for (let k = 0; k < comp.length; k++) {
    const c = comp[k];
    const x = c % W;
    const y = (c / W) | 0;
    for (const j of [c + 1, c - 1, c + W, c - W]) {
      if (j < 0 || j >= W * H || seen.has(j)) continue;
      if (Math.abs((j % W) - x) > 1 || Math.abs(((j / W) | 0) - y) > 1) continue;
      if (nationMap[j] !== nationMap[i] || prov[j] >= 0) continue;
      seen.add(j);
      comp.push(j);
    }
  }
  if (comp.length < MIN_ISLAND) {
    for (const c of comp) nationMap[c] = -1;
    continue;
  }
  const s = seedsX.length;
  const mid = comp[Math.floor(comp.length / 2)];
  seedsX.push(mid % W);
  seedsY.push((mid / W) | 0);
  seedsNation.push(nationMap[i]);
  for (const c of comp) prov[c] = s;
}

// Winzige Provinzen (Reste an Küsten) dem größten Nachbarn derselben Nation zuschlagen
{
  const count = new Map<number, number>();
  for (let i = 0; i < W * H; i++) if (prov[i] >= 0) count.set(prov[i], (count.get(prov[i]) ?? 0) + 1);
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < W * H; i++) {
      const p = prov[i];
      if (p < 0 || (count.get(p) ?? 0) >= 40) continue;
      for (const j of [i + 1, i - 1, i + W, i - W]) {
        const q = prov[j];
        if (j < 0 || j >= W * H || q < 0 || q === p || seedsNation[q] !== seedsNation[p]) continue;
        if ((count.get(q) ?? 0) < 40) continue;
        // ganze Provinz p umfärben
        for (let k = 0; k < W * H; k++) if (prov[k] === p) prov[k] = q;
        count.set(q, (count.get(q) ?? 0) + (count.get(p) ?? 0));
        count.delete(p);
        break;
      }
    }
  }
}

// IDs verdichten
const remap = new Map<number, number>();
const pixels = new Int16Array(W * H).fill(-1);
for (let i = 0; i < W * H; i++) {
  const s = prov[i];
  if (s < 0) continue;
  if (!remap.has(s)) remap.set(s, remap.size);
  pixels[i] = remap.get(s)!;
}
const N = remap.size;
console.log(`${N} Provinzen`);

// ------------------------------------------------------------ Provinzdaten
const sumX = new Float64Array(N);
const sumY = new Float64Array(N);
const cnt = new Int32Array(N);
const nationOf = new Int16Array(N);
const coastal = new Uint8Array(N);
const borders: Map<number, number>[] = Array.from({ length: N }, () => new Map());
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const i = y * W + x;
    const p = pixels[i];
    if (p < 0) continue;
    sumX[p] += x;
    sumY[p] += y;
    cnt[p]++;
    nationOf[p] = nationMap[i];
    for (const [j, ok] of [
      [i + 1, x + 1 < W],
      [i + W, y + 1 < H],
    ] as const) {
      if (!ok) continue;
      const q = pixels[j];
      if (q < 0) {
        coastal[p] = 1;
        continue;
      }
      if (q === p) continue;
      const kmEdge = KM_PER_PX * (Math.cos((latOf(y) * Math.PI) / 180) / cosRef) ** (j === i + 1 ? 0 : 1);
      borders[p].set(q, (borders[p].get(q) ?? 0) + kmEdge);
      borders[q].set(p, (borders[q].get(p) ?? 0) + kmEdge);
    }
    if (x === 0 || y === 0 || pixels[i - 1] < 0 || pixels[i - W] < 0) coastal[p] = 1;
  }
}
// Label-Punkt: der Provinz-Pixel, der dem Schwerpunkt am nächsten liegt
const labelX = new Int32Array(N);
const labelY = new Int32Array(N);
const bestD = new Float64Array(N).fill(Infinity);
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const p = pixels[y * W + x];
    if (p < 0) continue;
    const d = (x - sumX[p] / cnt[p]) ** 2 + (y - sumY[p] / cnt[p]) ** 2;
    if (d < bestD[p]) {
      bestD[p] = d;
      labelX[p] = x;
      labelY[p] = y;
    }
  }
}

const usedNames = new Set<string>();
function makeName(n: number): string {
  const spec = NATIONS[n];
  for (let t = 0; t < 50; t++) {
    const s = spec.stems[Math.floor(rng.next() * spec.stems.length)];
    const r = spec.roots[Math.floor(rng.next() * spec.roots.length)];
    let name = s + r;
    if (t > 20) name += " " + ["I", "II", "III", "IV"][t % 4];
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }
  return `${spec.short} ${usedNames.size}`;
}

const provinces: ProvinceDef[] = [];
for (let p = 0; p < N; p++) {
  const r = rng.next();
  const type: ProvinceType = r < 0.15 ? "stadt" : r < 0.35 ? "industrie" : r < 0.65 ? "agrar" : "land";
  provinces.push({
    id: p,
    name: makeName(nationOf[p]),
    nation: nationOf[p],
    x: labelX[p],
    y: labelY[p],
    lon: +lonOf(labelX[p]).toFixed(2),
    lat: +latOf(labelY[p]).toFixed(2),
    area: Math.round(cnt[p] * KM_PER_PX * KM_PER_PX * (Math.cos((latOf(labelY[p]) * Math.PI) / 180) / cosRef)),
    type,
    coastal: coastal[p] === 1,
    nb: [...borders[p].entries()].map(([q, km]) => [q, Math.round(km)] as [number, number]),
  });
}

const nations = NATIONS.map((n, i) => {
  let x = Math.round(px(n.capital[0]));
  let y = Math.round(py(n.capital[1]));
  let cap = pixels[y * W + x];
  if (cap < 0) {
    // Hauptstadt liegt knapp im Meer: nächste Provinz dieser Nation nehmen
    let best = Infinity;
    for (const p of provinces) {
      if (p.nation !== i) continue;
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < best) {
        best = d;
        cap = p.id;
      }
    }
  }
  provinces[cap].type = "stadt";
  const count = provinces.filter((p) => p.nation === i).length;
  console.log(`  ${n.short.padEnd(12)} ${String(count).padStart(4)} Provinzen, Hauptstadt ${provinces[cap].name}`);
  return { id: i, key: n.key, name: n.name, short: n.short, color: n.color, capital: cap };
});

const out: MapFile = {
  name: region.name,
  width: W,
  height: H,
  kmPerPx: KM_PER_PX,
  rle: encodeRle(pixels),
  nations,
  provinces,
};
const path = `public/maps/${region.name}.json`;
writeFileSync(path, JSON.stringify(out));
console.log(`→ ${path} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB)`);
if (unknown.size) console.log(`Nicht zugeordnete Länder (außerhalb/ignoriert): ${unknown.size}`);
