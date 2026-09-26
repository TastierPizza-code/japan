// Format der erzeugten Kartendateien (public/maps/*.json) und Laden zur Laufzeit.
// Erzeugt werden sie von scripts/genmap.ts.

export interface NationDef {
  id: number;
  key: string;
  name: string;
  short: string;
  color: string;
  capital: number; // Provinz-ID
}

export type ProvinceType = "land" | "agrar" | "industrie" | "stadt";

export interface ProvinceDef {
  id: number;
  name: string;
  nation: number; // Besitzer 1914
  x: number; // Label-Punkt in Kartenpixeln
  y: number;
  lon: number;
  lat: number;
  area: number; // km²
  type: ProvinceType;
  coastal: boolean;
  /** Nachbarn über Land: [Provinz-ID, Grenzlänge in km] */
  nb: [number, number][];
}

export interface MapFile {
  name: string;
  width: number;
  height: number;
  kmPerPx: number;
  /** Lauflängen-kodierte Provinz-Karte: [Wert+1, Anzahl, Wert+1, Anzahl, …], 0 = Meer */
  rle: number[];
  nations: NationDef[];
  provinces: ProvinceDef[];
}

export interface GameMap extends MapFile {
  /** Provinz-ID pro Pixel, -1 = Meer */
  pixels: Int16Array;
}

export function decodeMap(file: MapFile): GameMap {
  const pixels = new Int16Array(file.width * file.height);
  let k = 0;
  for (let i = 0; i < file.rle.length; i += 2) {
    const v = file.rle[i] - 1;
    const n = file.rle[i + 1];
    pixels.fill(v, k, k + n);
    k += n;
  }
  return { ...file, pixels };
}

export function encodeRle(pixels: Int16Array): number[] {
  const out: number[] = [];
  let cur = pixels[0];
  let run = 0;
  for (let i = 0; i < pixels.length; i++) {
    if (pixels[i] === cur) run++;
    else {
      out.push(cur + 1, run);
      cur = pixels[i];
      run = 1;
    }
  }
  out.push(cur + 1, run);
  return out;
}
