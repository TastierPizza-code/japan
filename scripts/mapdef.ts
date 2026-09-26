// Definition der Welt von 1914 in alternativer Form: welche heutigen Länder (Natural Earth)
// zu welcher Nation gehören, plus Grenzkorrekturen für 1914. Kleine Länder sind zusammengefasst.
// Für die ganze Welt später: weitere Regionen und Nationen hier ergänzen.

export interface NationSpec {
  key: string;
  name: string;
  short: string;
  color: string;
  capital: [number, number]; // lon, lat
  stems: string[];
  roots: string[];
}

export const NATIONS: NationSpec[] = [
  {
    key: "VEL",
    name: "Kaiserreich Veldmark",
    short: "Veldmark",
    color: "#7a8599",
    capital: [13.4, 52.5],
    stems: ["Lind", "Ros", "Els", "Hart", "Fried", "Adel", "Kron", "Sieg", "Eich", "Brand", "Wolf", "Hag", "Schön", "Weiß", "Grün", "Rab", "Stein", "Kalt"],
    roots: ["berg", "burg", "feld", "stein", "au", "bach", "dorf", "hausen", "heim", "wald", "tal", "furt", "brück", "hof", "rode", "münde"],
  },
  {
    key: "CAR",
    name: "Republik Carmaux",
    short: "Carmaux",
    color: "#5d7fb8",
    capital: [2.35, 48.86],
    stems: ["Beau", "Mont", "Val", "Roche", "Belle", "Clair", "Font", "Mar", "Char", "Vern", "Lor", "Saint-Am", "Bois", "Cham"],
    roots: ["mont", "ville", "court", "fort", "lieu", "ac", "ay", "ennes", "ières", "val", "bourg", "pierre", "champ"],
  },
  {
    key: "BRY",
    name: "Königreich Brythanien",
    short: "Brythanien",
    color: "#a8514a",
    capital: [-0.13, 51.5],
    stems: ["Ash", "Brad", "Wick", "Hart", "Stan", "Mel", "Ley", "Nor", "Kings", "Wes", "Dun", "Glen", "Thorn", "Oak"],
    roots: ["ford", "ton", "ham", "bury", "field", "wick", "shire", "by", "mouth", "ley", "combe", "stead"],
  },
  {
    key: "DAN",
    name: "Doppelmonarchie Danubien",
    short: "Danubien",
    color: "#c9b06a",
    capital: [16.37, 48.2],
    stems: ["Vár", "Kolo", "Brun", "Pres", "Szent", "Tem", "Leo", "Zla", "Kar", "Mar", "Ober", "Görz", "Kron", "Neu"],
    roots: ["stadt", "ov", "egy", "ice", "háza", "burg", "grad", "vár", "ach", "nik", "berg", "falva"],
  },
  {
    key: "VAL",
    name: "Königreich Valtara",
    short: "Valtara",
    color: "#8fb35e",
    capital: [12.5, 41.9],
    stems: ["Monte", "Castel", "Val", "Porto", "Villa", "Borgo", "Roc", "Fior", "Ter", "Ales", "Mar", "San Vit", "Lu"],
    roots: ["ano", "ella", "ino", "era", "ona", "esco", "ata", "ezia", "oro", "alto", "enza", "iglia"],
  },
  {
    key: "VOS",
    name: "Zarenreich Vostrava",
    short: "Vostrava",
    color: "#5b8a73",
    capital: [30.3, 59.94],
    stems: ["Novo", "Staro", "Kras", "Vol", "Belo", "Yar", "Zolo", "Pet", "Kaz", "Smol", "Ros", "Tver", "Mir", "Dub"],
    roots: ["grad", "sk", "ovo", "ino", "yansk", "itsa", "evka", "ov", "insk", "gorod", "ansk"],
  },
  {
    key: "ANA",
    name: "Sultanat Anadol",
    short: "Anadol",
    color: "#b8a37a",
    capital: [28.97, 41.01],
    stems: ["Kara", "Ak", "Eski", "Yeni", "Kızıl", "Bey", "Sar", "Deni", "Dar", "Ham", "Ruk", "Tel", "Bağ"],
    roots: ["hisar", "kent", "köy", "abad", "su", "dağ", "iye", "ova", "pınar", "han", "şehir"],
  },
  {
    key: "IBE",
    name: "Kronen von Iberien",
    short: "Iberien",
    color: "#b87d9c",
    capital: [-3.7, 40.4],
    stems: ["Villa", "Castro", "Val", "Alcal", "Torre", "Monte", "Santa ", "Ribe", "Olm", "Bar", "Cor", "Sal"],
    roots: ["ada", "edo", "ejo", "ana", "eira", "ón", "illa", "oso", "ales", "ar", "ena", "ia"],
  },
  {
    key: "NOR",
    name: "Nordischer Bund",
    short: "Nordbund",
    color: "#7fb0c9",
    capital: [18.07, 59.33],
    stems: ["Sten", "Björk", "Hav", "Lund", "Fjell", "Ek", "Norr", "Sund", "Vik", "Tor", "Holm", "Frost", "Ul"],
    roots: ["vik", "by", "sund", "stad", "havn", "dal", "holm", "berg", "fors", "ö", "näs"],
  },
  {
    key: "BRA",
    name: "Vereinigte Lande Brabant",
    short: "Brabant",
    color: "#d98b4a",
    capital: [4.35, 50.85],
    stems: ["Zand", "Oost", "West", "Hoog", "Brug", "Maas", "Delf", "Lin", "Gel", "Ant", "Leu"],
    roots: ["dam", "dijk", "hoven", "gem", "werpen", "ede", "horst", "veld", "broek", "sel"],
  },
  {
    key: "ALP",
    name: "Alpenbund",
    short: "Alpenbund",
    color: "#d69a8e",
    capital: [7.45, 46.95],
    stems: ["Berg", "Lau", "Zer", "Grin", "Inter", "Fri", "Lu", "Brie", "Wald"],
    roots: ["matt", "wald", "ern", "sanne", "dorf", "egg", "alp", "horn", "tal"],
  },
  {
    key: "BAL",
    name: "Balkanbund",
    short: "Balkanbund",
    color: "#9a7bb0",
    capital: [20.46, 44.8],
    stems: ["Kral", "Nik", "Kos", "Pod", "Vel", "Thes", "Pla", "Zar", "Bel", "Dra", "Var", "Tir"],
    roots: ["evo", "ica", "ovo", "grad", "opol", "ia", "ari", "ovac", "ina", "os", "ani"],
  },
  {
    key: "PAR",
    name: "Schahreich Parsa",
    short: "Parsa",
    color: "#a8906a",
    capital: [46.3, 38.08],
    stems: ["Ker", "Tab", "Hama", "Isfa", "Shir", "Ard", "Zan", "Qaz", "Sa", "Mar"],
    roots: ["abad", "an", "shah", "gan", "dan", "rud", "vin", "sar"],
  },
];

type Rule = string | ((lon: number, lat: number) => string);

const alsace = (lon: number, lat: number) =>
  pointInPolygon(lon, lat, [
    [5.9, 49.55],
    [6.5, 49.5],
    [7.1, 49.15],
    [8.25, 48.98],
    [7.6, 47.58],
    [7.0, 47.45],
    [6.85, 47.8],
    [6.95, 48.3],
    [6.2, 48.55],
    [5.85, 49.0],
  ]);

/** Heutiges Land → Nation 1914 (vereinfacht) */
export const COUNTRIES: Record<string, Rule> = {
  Germany: "VEL",
  France: (lon, lat) => (alsace(lon, lat) ? "VEL" : "CAR"),
  Monaco: "CAR",
  Algeria: "CAR",
  Tunisia: "CAR",
  Morocco: "CAR",
  "United Kingdom": "BRY",
  Ireland: "BRY",
  "Isle of Man": "BRY",
  Jersey: "BRY",
  Guernsey: "BRY",
  Malta: "BRY",
  Cyprus: "BRY",
  "N. Cyprus": "BRY",
  Egypt: "BRY",
  Austria: "DAN",
  Hungary: "DAN",
  Czechia: "DAN",
  Slovakia: "DAN",
  Slovenia: "DAN",
  Croatia: "DAN",
  "Bosnia and Herz.": "DAN",
  Italy: (lon, lat) =>
    (lat > 45.75 && lon > 10.4 && lon < 12.6) || (lon > 13.35 && lat > 45.5) ? "DAN" : "VAL",
  "San Marino": "VAL",
  Vatican: "VAL",
  Libya: "VAL",
  Russia: (lon, lat) => (lat < 55.3 && lon < 23 ? "VEL" : "VOS"), // Ostpreußen (Kaliningrad)
  Belarus: "VOS",
  Lithuania: (lon, lat) => (lat > 55.3 && lon < 21.7 ? "VEL" : "VOS"), // Memelland
  Latvia: "VOS",
  Estonia: "VOS",
  Finland: "VOS",
  Åland: "VOS",
  Moldova: "VOS",
  Georgia: "VOS",
  Armenia: "VOS",
  Azerbaijan: "VOS",
  Kazakhstan: "VOS",
  Ukraine: (lon, lat) => (lat < 50.3 && lon < 26.4 ? "DAN" : "VOS"), // Galizien, Bukowina
  Poland: (lon, lat) => {
    if (lat < 50.4 && lon > 19.25) return "DAN"; // Galizien
    if (lon < 18.3 || (lat > 53.3 && lon < 22.6) || (lat > 52.9 && lon < 19.5)) return "VEL";
    return "VOS"; // Kongresspolen
  },
  Turkey: "ANA",
  Syria: "ANA",
  Lebanon: "ANA",
  Israel: "ANA",
  Palestine: "ANA",
  Jordan: "ANA",
  Iraq: "ANA",
  "Saudi Arabia": "ANA",
  Kuwait: "ANA",
  Spain: "IBE",
  Portugal: "IBE",
  Andorra: "IBE",
  Norway: "NOR",
  Sweden: "NOR",
  Denmark: (_lon, lat) => (lat < 55.45 && _lon < 10 ? "VEL" : "NOR"), // Nordschleswig
  Iceland: "NOR",
  "Faeroe Is.": "NOR",
  Belgium: "BRA",
  Netherlands: "BRA",
  Luxembourg: "BRA",
  Switzerland: "ALP",
  Liechtenstein: "ALP",
  Serbia: (_lon, lat) => (lat > 44.85 ? "DAN" : "BAL"), // Vojvodina
  Montenegro: "BAL",
  Kosovo: "BAL",
  Macedonia: "BAL",
  Albania: "BAL",
  Greece: "BAL",
  Bulgaria: "BAL",
  Romania: (lon, lat) => (lon < 22.9 || (lat > 45.55 && lon < 25.95) ? "DAN" : "BAL"), // Siebenbürgen
  Iran: "PAR",
};

export interface RegionSpec {
  name: string;
  lonMin: number;
  lonMax: number;
  latMin: number;
  latMax: number;
  /** Grad Breite pro Pixel */
  degPerPx: number;
  /** Breitengrad, an dem die Längen nicht verzerrt sind */
  refLat: number;
  /** Abstand der Provinzzentren in Pixeln */
  provinceSpacing: number;
  /** Faktor für den Provinzabstand: dünn besiedelte Gebiete bekommen größere Provinzen */
  spacingFactor: (lon: number, lat: number) => number;
}

export const EUROPE: RegionSpec = {
  name: "europa",
  lonMin: -12,
  lonMax: 50,
  latMin: 30,
  latMax: 71.5,
  degPerPx: 0.05,
  refLat: 50,
  provinceSpacing: 19,
  spacingFactor: (lon, lat) => {
    if (lat < 34.5 && lon > -6) return 2.3; // Sahara, Arabien, Mesopotamien
    if (lat > 64) return 1.8; // hoher Norden
    if (lon > 38) return 1.8; // Wolga, Kaukasus, Persien
    if (lon > 31 && lat > 46) return 1.4; // Innerrussland
    return 1;
  },
};

export function pointInPolygon(x: number, y: number, poly: number[][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
