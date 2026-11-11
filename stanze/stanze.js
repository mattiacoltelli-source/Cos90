// ─── stanze/stanze.js ────────────────────────────────────────────────────────
// Modalità "Stanze": un atrio circolare con una porta per ogni genere della
// libreria, e dietro ogni porta un corridoio a tema (luci, muri, pavimento)
// con le locandine appese, dal film più bello al più brutto.
// Pagina a sé (stanze.html), raggiunta dalla barra in basso dell'app.
// I dati sono quelli di sempre (loadDB): niente di nuovo da salvare.
import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";
import { loadDB } from "../storage.js?v=07e757e";
import { posterUrl, titleOf, yearOf, extractDirector } from "../cine-core.js?v=07e757e";

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

// ─── dati ────────────────────────────────────────────────────────────────────
// Nomi TMDb (film e serie) → nome della stanza. Un genere può finire in più stanze.
const GENRE_ALIAS = { Dramma: ["Drama"], "Azione & Avventura": ["Azione", "Avventura"], "Action & Adventure": ["Azione", "Avventura"], Kids: ["Famiglia"], "Sci-Fi & Fantasy": ["Fantascienza", "Fantasy"], "War & Politics": ["Guerra"], Bambini: ["Famiglia"] };
const LABEL = { Drama: "Dramma" };
const MAX_PER_ROOM = 200;
function groupByGenre(db) {
  const seen = new Set(), all = [];
  [...(db.seen || []), ...(db.watchlist || [])].forEach((f) => {
    const k = `${f.media_type}|${f.id}`;
    if (!seen.has(k)) { seen.add(k); all.push(f); }
  });
  const by = new Map();
  all.forEach((f) => {
    const gs = new Set();
    (f.genre_names || []).forEach((g) => (GENRE_ALIAS[g] || [g]).forEach((x) => gs.add(x)));
    gs.forEach((g) => { if (!by.has(g)) by.set(g, []); by.get(g).push(f); });
  });
  return by;
}
const rank = (f) => (Number(f.vote) || 0) * 1000 + (Number(f.vote_average) || 0) * 10 + (Number(f.popularity) || 0) / 1000;
function demoFilms(n, genre) {
  const t = ["Il Rituale", "Notte Nera", "La Casa in Fondo", "Sotto la Pelle", "Ultimo Piano", "Eco", "Nebbia", "Il Visitatore", "Sette Porte", "Cripta", "Lo Specchio", "Respiro", "Fuori Orario", "Il Custode"];
  return Array.from({ length: n }, (_, i) => ({ id: 9000 + i, media_type: "movie", title: t[i % t.length], year: 1980 + i * 2, vote: [9, 8, 7, 8.5, 6, 5, 7.5, 4, 9.5, 6.5, 3, 8, 7, 5.5][i % 14], genre_names: [genre], director: "Regista " + (i + 1), cast: ["Attore A", "Attrice B"], poster_path: "" }));
}

// ─── renderer / scena ────────────────────────────────────────────────────────
const canvas = $("gl");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x020203, 0.09);
const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 80);
camera.rotation.order = "YXZ";
scene.add(camera);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 0.8 ? 68 : 56;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize); resize();

// Numero di luci costante (niente ricompilazione degli shader passando da una stanza all'altra)
const hemi = new THREE.HemisphereLight(0x1a2230, 0x0a0806, 0.5);
const torch = new THREE.SpotLight(0xfff1d6, 30, 22, 0.55, 0.9, 1.8);
torch.position.set(0.12, -0.1, 0); torch.target.position.set(0, 0, -4);
camera.add(torch, torch.target);
const lamps = [0, 1, 2].map(() => new THREE.PointLight(0xffb070, 0, 14, 1.6));
scene.add(hemi, ...lamps);
const lamp = lamps[0];

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin("anonymous");
const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
function tiled(url, srgb, rx, ry) {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function surface(name, rx, ry, tint, rough = 0.9, metal = 0) {
  return new THREE.MeshStandardMaterial({ map: tiled(`stanze/tex/${name}_c.jpg`, true, rx, ry), normalMap: tiled(`stanze/tex/${name}_n.jpg`, false, rx, ry), color: tint, roughness: rough, metalness: metal });
}
const hex = (n) => "#" + new THREE.Color(n).getHexString();
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }
function labelTexture(lines, w = 512, h = 160, color = "#d8d2c8", bg = "#0b0908") {
  return canvasTex(w, h, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#ffffff22"; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
    lines.forEach(([txt, size, y, spacing]) => { g.font = `800 ${size}px Outfit, sans-serif`; g.letterSpacing = spacing || "0px"; g.fillText(txt, w / 2, y); });
  });
}
function wrapTitle(g, txt, maxW) {
  const words = txt.split(" "), rows = []; let row = "";
  words.forEach((w) => { const t = row ? row + " " + w : w; if (g.measureText(t).width > maxW && row) { rows.push(row); row = w; } else row = t; });
  rows.push(row); return rows.slice(0, 4);
}
function placeholderPoster(film) {
  return canvasTex(200, 300, (g) => {
    g.fillStyle = "#15100e"; g.fillRect(0, 0, 200, 300);
    g.strokeStyle = "#7a1c1c"; g.lineWidth = 3; g.strokeRect(10, 10, 180, 280);
    g.fillStyle = "#d8d2c8"; g.textAlign = "center"; g.font = "800 24px Outfit, sans-serif";
    wrapTitle(g, titleOf(film), 160).forEach((r, i) => g.fillText(r, 100, 120 + i * 30));
  });
}
// libera la memoria video di tutto ciò che sta in un gruppo
function clearGroup(g) {
  g.traverse((o) => {
    if (o.userData.shared) return;       // parti dei modelli in cache: restano per le stanze dopo
    o.geometry?.dispose();
    [].concat(o.material || []).forEach((m) => { ["map", "normalMap", "emissiveMap"].forEach((k) => { if (m[k] && !m[k].userData.keep) m[k].dispose(); }); m.dispose(); });
  });
  g.clear();
}

// ─── texture disegnate a mano (nessun file in più) ───────────────────────────
const procCache = new Map();
function procTex(kind, c1 = "#888", c2 = "#444") {
  const key = kind + c1 + c2;
  if (procCache.has(key)) return procCache.get(key);
  const r = rnd(11);
  const t = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = c1; g.fillRect(0, 0, w, h);
    if (kind === "concrete" || kind === "plaster") {
      for (let i = 0; i < (kind === "concrete" ? 2600 : 900); i++) { g.fillStyle = r() < 0.5 ? c2 : "#000"; g.globalAlpha = r() * (kind === "concrete" ? 0.18 : 0.05); g.fillRect(r() * w, r() * h, 1 + r() * 4, 1 + r() * 4); }
      g.globalAlpha = 1;
      if (kind === "concrete") { g.strokeStyle = "rgba(0,0,0,.25)"; g.lineWidth = 2; g.strokeRect(0, 0, w, h); }
    } else if (kind === "stripes") {
      g.fillStyle = c2; for (let x = 0; x < w; x += 64) g.fillRect(x + 32, 0, 32, h);
      g.fillStyle = "rgba(0,0,0,.06)"; for (let x = 0; x < w; x += 32) g.fillRect(x, 0, 2, h);
    } else if (kind === "stars") {
      g.fillStyle = c2;
      for (let i = 0; i < 9; i++) { const x = r() * w, y = r() * h, s = 8 + r() * 14; g.beginPath(); for (let k = 0; k < 10; k++) { const a = (k / 10) * Math.PI * 2 - Math.PI / 2, rad = k % 2 ? s * 0.45 : s; g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); } g.fill(); }
      for (let i = 0; i < 30; i++) g.fillRect(r() * w, r() * h, 3, 3);
    } else if (kind === "checker") {
      g.fillStyle = c2; for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if ((x + y) % 2) g.fillRect(x * 64, y * 64, 64, 64);
    } else if (kind === "grass") {
      for (let i = 0; i < 1800; i++) { g.strokeStyle = r() < 0.5 ? c2 : "#0a2a0a"; g.globalAlpha = 0.5; g.lineWidth = 1; const x = r() * w, y = r() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 6, y - 6 - r() * 10); g.stroke(); }
      g.globalAlpha = 1;
    } else if (kind === "panel") {
      g.strokeStyle = "#0c131a"; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4); g.strokeRect(20, 20, w - 40, h - 40);
      g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(22, 22, w - 44, 40);
      g.fillStyle = "#3a4a5a"; [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); });
    } else if (kind === "grid") {
      g.strokeStyle = c2; g.globalAlpha = 0.55; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); g.globalAlpha = 1;
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.userData.keep = true;
  procCache.set(key, t); return t;
}
// spec di superficie: {tex} (file in stanze/tex) oppure {proc, c1, c2}
function specMat(spec, rx, ry) {
  const rough = spec.rough ?? 0.85, metal = spec.metal ?? 0;
  if (spec.tex) return surface(spec.tex, rx, ry, spec.tint ?? 0xffffff, rough, metal);
  const t = procTex(spec.proc, spec.c1, spec.c2).clone(); t.repeat.set(rx, ry); t.needsUpdate = true; t.userData.keep = false;
  return new THREE.MeshStandardMaterial({ map: t, color: spec.tint ?? 0xffffff, roughness: rough, metalness: metal });
}

// ─── oggetti 3D (modelli GLB del gioco Horror, CC0 dove indicato nei crediti) ─
const gltf = new GLTFLoader();
const modelCache = new Map();
function loadModel(name) {
  if (!modelCache.has(name)) modelCache.set(name, gltf.loadAsync(`stanze/models/${name}.glb`).then((g) => {
    g.scene.traverse((o) => { o.userData.shared = true; });
    const box = new THREE.Box3().setFromObject(g.scene);
    return { scene: g.scene, box, size: box.getSize(new THREE.Vector3()), center: box.getCenter(new THREE.Vector3()) };
  }).catch((e) => { console.warn("modello", name, e); return null; }));
  return modelCache.get(name);
}
// Oggetti per stanza: ingresso e fondo (alti, senza locandine), pavimento lungo il corridoio (bassi, sotto le targhette),
// fixture = lampade vere al posto delle barrette, door = portone in fondo.
const PROPS = {
  Horror: { entrance: ["chair", "cart", "bin"], floor: ["bin", "can"], end: ["shelf", "chair"], fixture: "hlamp" },
  Mistero: { entrance: ["cabinet", "shelf", "slamp2"], floor: ["stool", "can"], end: ["cabinet", "stool"], door: true },
  Thriller: { entrance: ["rack", "cart"], floor: ["bin", "can"], end: ["cabinet", "rack"] },
  Drama: { entrance: ["stool", "cabinet", "slamp2"], floor: ["stool"], end: ["stool", "slamp2"] },
  Azione: { entrance: ["rack", "stove", "tank"], floor: ["stove", "tank"], end: ["ammo", "stove"], fixture: "hlamp" },
  Avventura: { entrance: ["stove", "ammo", "slamp2"], floor: ["ammo", "can", "stove"], end: ["ammo", "stove"], door: true },
  Animazione: { entrance: ["tank", "stool"], floor: ["stool", "can"], end: ["cart", "tank"] },
  Commedia: { entrance: ["cabinet", "stool"], floor: ["stool", "bin"], end: ["cart", "stool"] },
  Crime: { entrance: ["slamp1", "bin", "stove"], floor: ["bin", "stove"], end: ["slamp1", "cabinet"], fixture: "wlamp" },
  Documentario: { entrance: ["shelf", "cabinet"], floor: ["stool"], end: ["rack", "cart"] },
  Famiglia: { entrance: ["cabinet", "shelf"], floor: ["stool", "can"], end: ["cabinet", "stool"] },
  Fantasy: { entrance: ["slamp1", "stool"], floor: ["stool"], end: ["slamp1", "stool"], door: true },
  Storia: { entrance: ["shelf", "cabinet", "slamp2"], floor: ["stool", "can"], end: ["shelf", "stool"], door: true },
  Musica: { entrance: ["stool", "cabinet", "slamp2"], floor: ["stool"], end: ["slamp2", "stool"] },
  Romance: { entrance: ["cabinet", "stool", "slamp2"], floor: ["stool"], end: ["cabinet", "slamp2"] },
  Guerra: { entrance: ["ammo", "tank", "stove"], floor: ["ammo", "tank", "can"], end: ["ammo", "rack"], fixture: "wlamp" },
  Western: { entrance: ["stove", "cabinet", "slamp2"], floor: ["stool", "stove"], end: ["shelf", "stove"] },
  Fantascienza: { fixture: "wlamp" },
};

// ─── i temi: una stanza per genere ───────────────────────────────────────────
// wall/floor: spec superficie con tile in metri · hemi/lamp: [colore, intensità] · torch: intensità della torcia
// mood: steady | flicker | pulse | cycle · bulb: [w,h,d,colore] lampade a soffitto · frame: [cornice, emissivo, intensità]
const W = (s, tile, tint, extra = {}) => ({ ...s, tile, tint, ...extra });
const THEMES = {
  Horror: { color: 0xb02020, door: "horror", fog: [0x030102, 0.075], hemi: [0x1a2230, 0.5], lamp: [0xff6a3a, 9], torch: 34, mood: "flicker", ceil: 0x080808,
    wall: W({ tex: "brick" }, [2.1, 1.05], 0x5a4a44), floor: W({ tex: "floorA" }, [1.6, 1.6], 0x5a5650, { rough: 0.65 }), bulb: [0.5, 0.06, 0.12, 0xff9060], frame: [0x0a0807, 0, 0] },
  Mistero: { color: 0x7a5cff, door: "mist", fog: [0x06050d, 0.08], hemi: [0x6a58a8, 0.7], lamp: [0x9a7cff, 11], torch: 26, mood: "pulse", ceil: 0x07060c,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0x8a78b8), floor: W({ tex: "rubber" }, [1, 1], 0x7a7aa0, { rough: 0.3 }), bulb: [0.4, 0.06, 0.4, 0xb8a0ff], frame: [0x120e1c, 0x7a5cff, 0.35] },
  Thriller: { color: 0x3aa07a, door: "thriller", fog: [0x04100c, 0.055], hemi: [0x70a090, 1.0], lamp: [0xc8ffd8, 12], torch: 16, mood: "flicker", ceil: 0x0a0c0c,
    wall: W({ tex: "tiles" }, [1.2, 1.2], 0x5c6c64), floor: W({ tex: "rubber" }, [1, 1], 0xa8aeb0, { rough: 0.45 }), bulb: [0.9, 0.05, 0.3, 0xd8ffe4], frame: [0x101412, 0, 0] },
  Fantascienza: { color: 0x2a8cff, door: "scifi", fog: [0x06203a, 0.03], hemi: [0x4a98e0, 1.6], lamp: [0x5ab8ff, 16], torch: 8, mood: "steady", ceil: 0x0c1824, neon: 0x3a9cff,
    wall: W({ proc: "panel", c1: "#26425e" }, [2.4, 2.4], 0xe0eeff, { rough: 0.45, metal: 0.35 }), floor: W({ proc: "grid", c1: "#0d1824", c2: "#2a8cff" }, [2, 2], 0xffffff, { rough: 0.3, metal: 0.4 }), bulb: [0.9, 0.05, 0.5, 0xcff0ff], frame: [0x0c1c2c, 0x2a8cff, 0.55] },
  Drama: { color: 0xc01830, door: "drama", fog: [0x2a060c, 0.04], hemi: [0xc02838, 1.3], lamp: [0xff3040, 16], torch: 6, mood: "steady", ceil: 0x1a0608, trim: 0xc89a3a,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0xc06068), floor: W({ tex: "planks" }, [1.6, 1.6], 0xb09080, { rough: 0.5 }), bulb: [0.7, 0.05, 0.3, 0xff7a80], frame: [0x2a1c0a, 0xc89a3a, 0.35] },
  Azione: { color: 0xff7a1a, door: "steel", fog: [0x1a1008, 0.03], hemi: [0xffe0c0, 1.1], lamp: [0xffa050, 12], torch: 8, mood: "steady", ceil: 0x2a2a2a, stripe: 0xff7a1a,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0xe0d0c0, { rough: 0.7, metal: 0.25 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xd8b898, { rough: 0.7 }), bulb: [1.2, 0.06, 0.25, 0xfff0d0], frame: [0x1a1a1a, 0xff7a1a, 0.4] },
  Avventura: { color: 0xd89a30, door: "stone", fog: [0xd8aa70, 0.028], hemi: [0xfff0d0, 1.5], lamp: [0xffd890, 12], torch: 0, mood: "steady", ceil: 0x4a3a2a,
    wall: W({ tex: "cliff" }, [2.2, 2.2], 0xc0987a), floor: W({ tex: "sand" }, [1.8, 1.8], 0xe8c898, { rough: 1 }), bulb: [0.3, 0.3, 0.3, 0xffb050], frame: [0x3a2812, 0, 0] },
  Animazione: { color: 0xff5aa8, door: "candy", fog: [0xbfd8ff, 0.02], hemi: [0xffffff, 1.6], lamp: [0xffffff, 10], torch: 0, mood: "steady", ceil: 0xf0f4ff,
    wall: W({ proc: "stars", c1: "#3a5ae0", c2: "#ffe066" }, [1.6, 1.6], 0xffffff), floor: W({ proc: "checker", c1: "#ff7ab0", c2: "#fff2a0" }, [1.2, 1.2], 0xffffff, { rough: 0.4 }), bulb: [0.5, 0.05, 0.5, 0xffffff], frame: [0xffffff, 0xff5aa8, 0.5] },
  Commedia: { color: 0xf0b020, door: "candy", fog: [0xffe8b0, 0.02], hemi: [0xfff4e0, 1.5], lamp: [0xffe0a0, 11], torch: 0, mood: "steady", ceil: 0xfff0d0,
    wall: W({ proc: "stripes", c1: "#f4c430", c2: "#fff4cc" }, [1.2, 1.2], 0xffffff), floor: W({ tex: "parquet" }, [1.6, 1.6], 0xffe0b0, { rough: 0.5 }), bulb: [0.5, 0.05, 0.5, 0xfff0c0], frame: [0xe03030, 0xe03030, 0.25] },
  Crime: { color: 0xe0902a, door: "noir", fog: [0x120a05, 0.05], hemi: [0xb87038, 0.95], lamp: [0xffa030, 14], torch: 12, mood: "steady", ceil: 0x0a0806,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0x7a6a60, { rough: 0.6, metal: 0.2 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0x6a625a, { rough: 0.3 }), bulb: [0.7, 0.05, 0.3, 0xffb050], frame: [0x1a1208, 0xffa030, 0.2] },
  Documentario: { color: 0xa0a8b0, door: "gallery", fog: [0xe8e8ea, 0.015], hemi: [0xffffff, 1.7], lamp: [0xffffff, 10], torch: 0, mood: "steady", ceil: 0xf4f4f4,
    wall: W({ tex: "stucco" }, [2.2, 2.2], 0xffffff, { rough: 0.9 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xe8e4dc, { rough: 0.35 }), bulb: [1.2, 0.04, 0.3, 0xffffff], frame: [0x111111, 0, 0] },
  Famiglia: { color: 0x70c040, door: "candy", fog: [0xf0f4e0, 0.02], hemi: [0xfff8e0, 1.5], lamp: [0xffe8b0, 10], torch: 0, mood: "steady", ceil: 0xfff8ee,
    wall: W({ tex: "plaster" }, [2.2, 2.2], 0xb8e8c8, { rough: 0.9 }), floor: W({ tex: "rawwood" }, [1.6, 1.6], 0xe0c8a0), bulb: [0.5, 0.05, 0.5, 0xfff4d0], frame: [0x8a5a2a, 0, 0] },
  Fantasy: { color: 0x5adca0, door: "forest", fog: [0x0a2018, 0.05], hemi: [0x7affc0, 0.9], lamp: [0x9affb0, 9], torch: 14, mood: "pulse", ceil: 0x0a1a14,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0x6aa880), floor: W({ tex: "rocky" }, [1.8, 1.8], 0xd0ffd0, { rough: 1 }), bulb: [0.2, 0.2, 0.2, 0xb8ffd0], frame: [0x1a3a22, 0x7affc0, 0.35] },
  Storia: { color: 0xb08a50, door: "wood", fog: [0x2a1a0c, 0.045], hemi: [0xffc890, 0.9], lamp: [0xffb060, 10], torch: 12, mood: "candle", ceil: 0x2a1e14, trim: 0x8a6a30,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0xd0b490), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xb8a488), bulb: [0.15, 0.3, 0.15, 0xffa040], frame: [0x3a2410, 0xb08a3a, 0.2] },
  Musica: { color: 0xc050ff, door: "club", fog: [0x100820, 0.05], hemi: [0x8a4aff, 0.7], lamp: [0xff40d0, 10], torch: 10, mood: "cycle", cycle: [0xff40d0, 0x40d8ff], ceil: 0x0a0614,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0x5a3a9a), floor: W({ tex: "planks" }, [1.6, 1.6], 0x8a7aa8, { rough: 0.4 }), bulb: [0.5, 0.05, 0.5, 0xff60e0], frame: [0x140a24, 0xff60e0, 0.45] },
  Romance: { color: 0xf070a0, door: "drama", fog: [0xffd0dc, 0.025], hemi: [0xffe0e8, 1.5], lamp: [0xffb0c0, 10], torch: 0, mood: "steady", ceil: 0xffe8ee, trim: 0xe8c080,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0xe8a0b4), floor: W({ tex: "parquet" }, [1.6, 1.6], 0xf0e0d8, { rough: 0.45 }), bulb: [0.6, 0.05, 0.3, 0xffe0e8], frame: [0xf0d0a0, 0xffc0d0, 0.3] },
  Guerra: { color: 0x8a9a40, door: "bunker", fog: [0x1c1e10, 0.045], hemi: [0xb8c080, 1.1], lamp: [0xd0d890, 11], torch: 12, mood: "steady", ceil: 0x1a1c10,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0x8a9060, { rough: 0.7, metal: 0.2 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0x6a6444), bulb: [0.4, 0.12, 0.15, 0xd8e0a0], frame: [0x2a2c18, 0, 0] },
  Western: { color: 0xd0803a, door: "saloon", fog: [0x3a2410, 0.035], hemi: [0xffc880, 1.1], lamp: [0xffa850, 10], torch: 8, mood: "steady", ceil: 0x3a2814,
    wall: W({ tex: "rawwood" }, [1.6, 1.6], 0xc09a6a), floor: W({ tex: "soil" }, [1.8, 1.8], 0xd8b890, { rough: 1 }), bulb: [0.2, 0.35, 0.2, 0xffb060], frame: [0x2a1a0c, 0, 0] },
};
const FALLBACK = { color: 0x8890a0, door: "plain", fog: [0x101418, 0.04], hemi: [0xffffff, 1.2], lamp: [0xffffff, 9], torch: 6, mood: "steady", ceil: 0x1a1c20,
  wall: W({ proc: "plaster", c1: "#9aa0aa", c2: "#6a707a" }, [2.4, 2.4], 0xffffff), floor: W({ tex: "parquet" }, [1.6, 1.6], 0x8a8070, { rough: 0.55 }), bulb: [0.8, 0.05, 0.3, 0xffffff], frame: [0x15171a, 0, 0] };
const themeOf = (g) => THEMES[g] || FALLBACK;

// ─── porte (texture dipinte su canvas) ───────────────────────────────────────
function doorTexture(style, color) {
  return canvasTex(256, 512, (g, w, h) => {
    const r = rnd(7), acc = hex(color), dk = hex(new THREE.Color(color).multiplyScalar(0.25));
    const bars = (y, hgt = 18, c = "#0e0e0e") => { g.fillStyle = c; g.fillRect(0, y, w, hgt); };
    const ring = (x, y, rad = 12, c = "#8a7444") => { g.strokeStyle = c; g.lineWidth = 6; g.beginPath(); g.arc(x, y, rad, 0, 7); g.stroke(); };
    const planks = (base, line, n = 43) => { g.fillStyle = base; g.fillRect(0, 0, w, h); for (let x = 0; x < w; x += n) { g.fillStyle = line; g.fillRect(x, 0, 3, h); g.fillStyle = `rgba(255,220,170,${0.03 + r() * 0.05})`; g.fillRect(x + 4, 0, 14, h); } };
    switch (style) {
      case "horror": {
        planks("#24150f", "#150b07");
        for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.25})`; g.fillRect(r() * w, r() * h, 2 + r() * 3, 20 + r() * 80); }
        bars(90, 22); bars(400, 22); ring(w - 50, h * 0.52, 14, "#5a4a34");
        const gr = g.createLinearGradient(0, h, 0, h * 0.55); gr.addColorStop(0, "rgba(180,10,10,.55)"); gr.addColorStop(1, "rgba(180,10,10,0)"); g.fillStyle = gr; g.fillRect(0, h * 0.55, w, h * 0.45); break;
      }
      case "scifi": {
        g.fillStyle = "#1c2630"; g.fillRect(0, 0, w, h);
        for (let y = 30; y < h; y += 52) { g.fillStyle = "#121a22"; g.fillRect(0, y, w, 4); g.fillStyle = "rgba(255,255,255,.04)"; g.fillRect(0, y + 4, w, 8); }
        g.fillStyle = "#06090c"; g.fillRect(w / 2 - 3, 0, 6, h); g.fillStyle = acc; g.fillRect(8, 0, 5, h); g.fillRect(w - 13, 0, 5, h);
        g.fillStyle = "#0a1016"; g.fillRect(w / 2 + 20, h * 0.5 - 24, 30, 48); g.fillStyle = acc; g.fillRect(w / 2 + 26, h * 0.5 - 14, 18, 6); g.fillRect(w / 2 + 26, h * 0.5 + 2, 18, 6); break;
      }
      case "drama": {
        g.fillStyle = dk; g.fillRect(0, 0, w, h); g.fillStyle = acc; g.globalAlpha = 0.8; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
        for (let x = 0; x < w; x += 32) { const gr = g.createLinearGradient(x, 0, x + 32, 0); gr.addColorStop(0, "rgba(0,0,0,.5)"); gr.addColorStop(.5, "rgba(255,160,170,.16)"); gr.addColorStop(1, "rgba(0,0,0,.5)"); g.fillStyle = gr; g.fillRect(x, 0, 32, h); }
        g.fillStyle = "#c89a3a"; g.fillRect(0, 0, w, 14); g.fillRect(0, h - 14, w, 14); g.fillRect(w / 2 - 2, 14, 4, h - 28);
        g.beginPath(); g.arc(w / 2 - 22, h * 0.52, 8, 0, 7); g.arc(w / 2 + 22, h * 0.52, 8, 0, 7); g.fill(); break;
      }
      case "thriller": {
        g.fillStyle = "#3a4642"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(255,255,255,.05)"; g.fillRect(0, 0, 14, h);
        g.fillStyle = "#101614"; g.fillRect(w / 2 - 34, 70, 68, 120); g.fillStyle = "rgba(160,255,200,.35)"; g.fillRect(w / 2 - 28, 76, 56, 108);
        g.fillStyle = "#222c28"; g.fillRect(0, h * 0.62, w, 6); g.fillStyle = "#9a9a9a"; g.fillRect(w - 52, h * 0.5, 28, 8);
        g.fillStyle = "#e0c040"; for (let x = 0; x < w; x += 40) g.fillRect(x, h - 30, 22, 14); break;
      }
      case "steel": {   // Azione: portone industriale a strisce di pericolo
        g.fillStyle = "#3a3a3c"; g.fillRect(0, 0, w, h);
        for (let y = 20; y < h; y += 46) { g.fillStyle = "#222"; g.fillRect(0, y, w, 5); }
        g.fillStyle = "#ffb000"; g.fillRect(0, 0, w, 40); g.fillStyle = "#111"; for (let x = -40; x < w + 40; x += 44) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 22, 0); g.lineTo(x + 2, 40); g.lineTo(x - 20, 40); g.fill(); }
        g.fillStyle = "#ffb000"; g.fillRect(0, h - 40, w, 40); g.fillStyle = "#111"; for (let x = -40; x < w + 40; x += 44) { g.beginPath(); g.moveTo(x, h - 40); g.lineTo(x + 22, h - 40); g.lineTo(x + 2, h); g.lineTo(x - 20, h); g.fill(); }
        g.fillStyle = "#c02020"; g.fillRect(w - 56, h * 0.5 - 20, 26, 40); break;
      }
      case "stone": {   // Avventura: lastra di roccia con un'incisione
        g.fillStyle = "#6a5a48"; g.fillRect(0, 0, w, h);
        for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(${r() < 0.5 ? "0,0,0" : "255,230,190"},${r() * 0.14})`; g.fillRect(r() * w, r() * h, 2 + r() * 14, 2 + r() * 6); }
        g.strokeStyle = acc; g.lineWidth = 6; g.globalAlpha = 0.85; g.beginPath(); g.arc(w / 2, h * 0.38, 40, 0, 7); g.moveTo(w / 2 - 55, h * 0.38); g.lineTo(w / 2 + 55, h * 0.38); g.moveTo(w / 2, h * 0.38 - 55); g.lineTo(w / 2, h * 0.38 + 55); g.stroke(); g.globalAlpha = 1; break;
      }
      case "candy": {   // Animazione / Commedia / Famiglia: colori pieni, pois e oblò
        g.fillStyle = acc; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(255,255,255,.35)";
        for (let y = 20; y < h; y += 56) for (let x = (y / 56) % 2 ? 20 : 48; x < w; x += 56) { g.beginPath(); g.arc(x, y, 9, 0, 7); g.fill(); }
        g.fillStyle = "#fff"; g.beginPath(); g.arc(w / 2, 130, 52, 0, 7); g.fill(); g.fillStyle = "#6ad0ff"; g.beginPath(); g.arc(w / 2, 130, 42, 0, 7); g.fill();
        g.fillStyle = "#ffd000"; g.beginPath(); g.arc(w - 46, h * 0.55, 13, 0, 7); g.fill(); break;
      }
      case "wood": {    // Storia: portone antico con borchie
        planks("#4a3018", "#2a1a0c", 52); bars(110, 16, "#1a1a1a"); bars(380, 16, "#1a1a1a");
        g.fillStyle = "#6a5a2a"; for (let y = 60; y < h - 40; y += 70) for (let x = 34; x < w; x += 62) { g.beginPath(); g.arc(x, y, 4, 0, 7); g.fill(); }
        ring(w / 2, h * 0.55, 16, "#8a7444"); break;
      }
      case "saloon": { // Western: battenti da saloon con persiane
        g.fillStyle = "#0a0806"; g.fillRect(0, 0, w, h);
        for (const x of [4, w / 2 + 4]) { g.fillStyle = "#7a4a22"; g.fillRect(x, h * 0.22, w / 2 - 8, h * 0.5); for (let y = h * 0.24; y < h * 0.7; y += 16) { g.fillStyle = "#3a2210"; g.fillRect(x + 4, y, w / 2 - 16, 5); g.fillStyle = "rgba(255,210,150,.2)"; g.fillRect(x + 4, y + 5, w / 2 - 16, 3); } }
        g.fillStyle = "#3a2210"; g.fillRect(0, 0, w, h * 0.2); g.fillRect(0, h * 0.74, w, h * 0.26); g.fillStyle = "#d0a060"; g.font = "800 28px Outfit, sans-serif"; g.textAlign = "center"; g.fillText("SALOON", w / 2, h * 0.12); break;
      }
      case "club": {    // Musica: porta nera con anello al neon
        g.fillStyle = "#0a0614"; g.fillRect(0, 0, w, h); g.strokeStyle = acc; g.lineWidth = 9; g.shadowColor = acc; g.shadowBlur = 20;
        g.beginPath(); g.arc(w / 2, h * 0.4, 58, 0, 7); g.stroke(); g.strokeStyle = "#40d8ff"; g.beginPath(); g.arc(w / 2, h * 0.4, 32, 0, 7); g.stroke();
        g.shadowBlur = 0; g.fillStyle = "#222"; g.fillRect(w - 52, h * 0.55, 16, 70); break;
      }
      case "mist": {    // Mistero: porta scura con serratura e luce che filtra
        planks("#1c1626", "#0e0a14", 64); g.fillStyle = acc; g.globalAlpha = 0.18; g.fillRect(0, 0, w, h); g.globalAlpha = 1;
        g.fillStyle = "#0a0810"; g.beginPath(); g.arc(w / 2, h * 0.5, 15, 0, 7); g.fill(); g.fillRect(w / 2 - 6, h * 0.5, 12, 36);
        const gr = g.createRadialGradient(w / 2, h * 0.5, 4, w / 2, h * 0.5, 120); gr.addColorStop(0, "rgba(160,120,255,.55)"); gr.addColorStop(1, "rgba(160,120,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h); break;
      }
      case "noir": {    // Crime: vetro smerigliato con scritta dorata
        g.fillStyle = "#2a2018"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(220,200,150,.3)"; g.fillRect(24, 24, w - 48, h * 0.62);
        for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.07})`; g.fillRect(24 + r() * (w - 48), 24 + r() * h * 0.62, 3, 3); }
        g.fillStyle = "#d0a040"; g.textAlign = "center"; g.font = "800 22px Outfit, sans-serif"; g.fillText("INVESTIGAZIONI", w / 2, 120); g.font = "700 16px Outfit, sans-serif"; g.fillText("PRIVATE", w / 2, 148); ring(w - 44, h * 0.72, 8, "#a08030"); break;
      }
      case "forest": {  // Fantasy: arco di rampicanti con luce verde
        g.fillStyle = "#0e2418"; g.fillRect(0, 0, w, h); const gr = g.createRadialGradient(w / 2, h * 0.55, 10, w / 2, h * 0.55, 190); gr.addColorStop(0, "rgba(140,255,190,.7)"); gr.addColorStop(1, "rgba(20,80,50,0)"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
        g.strokeStyle = "#2a6a3a"; g.lineWidth = 5; for (let i = 0; i < 26; i++) { const x = r() * w; g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 30, h * 0.3, x - 30, h * 0.5, x + (r() - 0.5) * 80, h * (0.4 + r() * 0.6)); g.stroke(); }
        g.fillStyle = "#b8ffd0"; for (let i = 0; i < 14; i++) { g.beginPath(); g.arc(r() * w, r() * h, 3, 0, 7); g.fill(); } break;
      }
      case "bunker": {  // Guerra: portello blindato con volantino
        g.fillStyle = "#4a5030"; g.fillRect(0, 0, w, h); for (let i = 0; i < 300; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.2})`; g.fillRect(r() * w, r() * h, 3, 3); }
        g.fillStyle = "#2a2e18"; for (let y = 40; y < h; y += 90) g.fillRect(0, y, w, 6);
        g.strokeStyle = "#2a2e18"; g.lineWidth = 10; g.beginPath(); g.arc(w / 2, h * 0.5, 44, 0, 7); g.moveTo(w / 2 - 44, h * 0.5); g.lineTo(w / 2 + 44, h * 0.5); g.moveTo(w / 2, h * 0.5 - 44); g.lineTo(w / 2, h * 0.5 + 44); g.stroke();
        g.fillStyle = "#c8c090"; g.font = "800 20px Outfit, sans-serif"; g.textAlign = "center"; g.fillText("A-7", w / 2, 60); break;
      }
      case "gallery": { // Documentario: porta bianca con targhetta museale
        g.fillStyle = "#e4e2dc"; g.fillRect(0, 0, w, h); g.fillStyle = "rgba(0,0,0,.06)"; g.fillRect(20, 24, w - 40, h - 48);
        g.fillStyle = "#222"; g.fillRect(w / 2 - 50, 150, 100, 70); g.fillStyle = "#ddd"; g.fillRect(w / 2 - 44, 158, 88, 4); g.fillRect(w / 2 - 44, 170, 60, 4); g.fillRect(w / 2 - 44, 182, 70, 4); ring(w - 40, h * 0.55, 8, "#888"); break;
      }
      default: {        // porta semplice del colore del genere
        g.fillStyle = "#171513"; g.fillRect(0, 0, w, h); g.fillStyle = "#0e0d0c"; g.fillRect(26, 30, w - 52, h * 0.38); g.fillRect(26, h * 0.5, w - 52, h * 0.42);
        g.fillStyle = acc; g.globalAlpha = 0.5; g.fillRect(0, 0, w, 8); g.globalAlpha = 1; ring(w - 40, h * 0.52, 9);
      }
    }
  });
}

// ─── gruppi ──────────────────────────────────────────────────────────────────
const hub = new THREE.Group();
const room = new THREE.Group();
scene.add(hub, room);
const doors = [];           // {genre, x, z}
const posters = [];         // {mesh, plaque, film, z, state, tok}
let HUB_R = 4.6;

function buildDoor(genre, count, a) {
  const th = themeOf(genre), color = th.color, style = th.door;
  const g = new THREE.Group();
  g.position.set(Math.sin(a) * (HUB_R - 0.02), 0, -Math.cos(a) * (HUB_R - 0.02));
  g.rotation.y = -a;   // il lato +z guarda il centro
  const stone = new THREE.MeshStandardMaterial({ color: new THREE.Color(color).multiplyScalar(0.22), roughness: 0.8, emissive: color, emissiveIntensity: 0.06 });
  const box = (w, h, d, x, y, z, m = stone) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); };
  box(0.22, 2.62, 0.34, -0.74, 1.31, 0.17); box(0.22, 2.62, 0.34, 0.74, 1.31, 0.17); box(1.7, 0.22, 0.34, 0, 2.63, 0.17);
  box(1.26, 2.4, 0.02, 0, 1.2, 0.01, new THREE.MeshBasicMaterial({ color: 0x000000 }));
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 2.4), new THREE.MeshStandardMaterial({ map: doorTexture(style, color), roughness: 0.7, metalness: style === "scifi" || style === "steel" ? 0.35 : 0, emissive: 0xffffff, emissiveIntensity: 0.34 }));
  door.material.emissiveMap = door.material.map; door.position.set(0, 1.2, 0.07); g.add(door);
  const name = (LABEL[genre] || genre).toUpperCase();
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.44), new THREE.MeshBasicMaterial({ map: labelTexture([[name, name.length > 10 ? 38 : 46, 62, "4px"], [`${count} titoli`, 24, 122]], 512, 160, hex(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5))), fog: false }));
  sign.position.set(0, 3.0, 0.2); g.add(sign);
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.06), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }));
  strip.rotation.x = -Math.PI / 2; strip.position.set(0, 0.015, 0.45); g.add(strip);
  hub.add(g);
  doors.push({ genre, x: Math.sin(a) * HUB_R, z: -Math.cos(a) * HUB_R });
}
function buildHub(list) {
  clearGroup(hub); doors.length = 0;
  HUB_R = Math.max(4.6, (list.length * 2.5) / (Math.PI * 2));
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R, 3.4, 64, 1, true), surface("brick", (Math.PI * 2 * HUB_R) / 2.1, 2, 0x5a544e));
  wall.position.y = 1.7; wall.material.side = THREE.BackSide; hub.add(wall);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(HUB_R, 64), surface("floorA", HUB_R * 1.25, HUB_R * 1.25, 0xb4b0a4, 0.7));
  floor.rotation.x = -Math.PI / 2; hub.add(floor);
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(HUB_R, 64), new THREE.MeshStandardMaterial({ color: 0x0c0c0c }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.4; hub.add(ceil);
  list.forEach(({ genre, count }, i) => buildDoor(genre, count, (i / list.length) * Math.PI * 2));
}

// Targhetta sotto la locandina: voto tuo (oro se alto) oppure voto TMDb
function plaqueTexture(f, th) {
  const mine = Number(f.vote) || 0, tm = Number(f.vote_average) || 0;
  const v = mine || tm, label = mine ? "VOTO" : (tm ? "TMDB" : "—");
  const light = th.hemi[1] > 1.2;
  const col = !v ? "#8a8278" : v >= 8 ? (light ? "#a87800" : "#f2c14e") : v >= 6.5 ? (light ? "#222" : "#d8d2c8") : "#c0504a";
  return canvasTex(256, 80, (g, w, h) => {
    g.fillStyle = light ? "#f4f0e8" : "#12100e"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col; g.globalAlpha = 0.7; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6); g.globalAlpha = 1;
    g.fillStyle = col; g.textBaseline = "middle"; g.textAlign = "left";
    g.font = "800 40px Outfit, sans-serif"; g.fillText(v ? (mine ? String(mine) : tm.toFixed(1)) : "—", 22, 42);
    g.textAlign = "right"; g.font = "700 20px Outfit, sans-serif"; g.letterSpacing = "2px"; g.fillText(label, w - 18, 42);
  });
}

const STEP = 1.3, START = 7, LAMP_STEP = 4.8;
function buildRoom(genre, films) {
  const th = themeOf(genre);
  clearGroup(room); posters.length = 0;
  const L = START + Math.ceil(films.length / 2) * STEP + 4;
  room.userData = { L, genre, theme: th, boxes: [], tok: (room.userData.tok || 0) + 1 };
  const HW = 1.9, H = 3.1, cz = -L / 2 + 1;
  const mk = (geo, mat, x, y, z, ry = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); room.add(m); return m; };
  const wallMat = specMat(th.wall, L / th.wall.tile[0], H / th.wall.tile[1]);
  const floorMat = specMat(th.floor, HW * 2 / th.floor.tile[0], L / th.floor.tile[1]);
  const ceilMat = new THREE.MeshStandardMaterial({ color: th.ceil, roughness: 0.8 });
  mk(new THREE.PlaneGeometry(L, H), wallMat, -HW, H / 2, cz, Math.PI / 2);
  mk(new THREE.PlaneGeometry(L, H), wallMat, HW, H / 2, cz, -Math.PI / 2);
  mk(new THREE.PlaneGeometry(HW * 2, L), floorMat, 0, 0, cz, 0, -Math.PI / 2);
  mk(new THREE.PlaneGeometry(HW * 2, L), ceilMat, 0, H, cz, 0, Math.PI / 2);
  const endMat = new THREE.MeshStandardMaterial({ color: th.ceil });
  mk(new THREE.PlaneGeometry(HW * 2, H), endMat, 0, H / 2, -L + 1, 0);
  mk(new THREE.PlaneGeometry(HW * 2, H), endMat, 0, H / 2, 1, Math.PI);
  // porta di ritorno (dietro di te)
  mk(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ map: doorTexture(th.door, th.color) }), 0, 1.1, 0.98, Math.PI);
  mk(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: labelTexture([["ATRIO", 44, 80, "8px"]]), fog: false }), 0, 2.5, 0.97, Math.PI);
  // dettagli del tema
  const glow = (c) => new THREE.MeshBasicMaterial({ color: c });
  if (th.neon) [-1, 1].forEach((s) => { mk(new THREE.BoxGeometry(0.06, 0.04, L), glow(th.neon), s * (HW - 0.12), H - 0.04, cz); mk(new THREE.BoxGeometry(0.05, 0.05, L), glow(th.neon), s * (HW - 0.01), 0.12, cz); });
  if (th.stripe) [-1, 1].forEach((s) => mk(new THREE.BoxGeometry(0.03, 0.16, L), glow(th.stripe), s * (HW - 0.015), 0.95, cz));
  if (th.trim) { const gold = new THREE.MeshStandardMaterial({ color: th.trim, emissive: th.trim, emissiveIntensity: 0.25, metalness: 0.6, roughness: 0.4 }); [-1, 1].forEach((s) => { mk(new THREE.BoxGeometry(0.05, 0.1, L), gold, s * (HW - 0.02), 0.08, cz); mk(new THREE.BoxGeometry(0.05, 0.1, L), gold, s * (HW - 0.02), H - 0.08, cz); }); }
  const [bw, bh, bd, bc] = th.bulb, hanging = bh > 0.15, fixture = PROPS[genre]?.fixture;
  for (let z = -3; !fixture && z > -L + 2; z -= LAMP_STEP) {
    if (hanging) [-1, 1].forEach((s) => { mk(new THREE.BoxGeometry(bw, bh, bd), glow(bc), s * (HW - 0.25), 2.25, z); mk(new THREE.BoxGeometry(0.02, H - 2.4, 0.02), glow(0x111111), s * (HW - 0.25), (H + 2.4) / 2, z); });
    else mk(new THREE.BoxGeometry(bw, bh, bd), glow(bc), 0, H - 0.05, z);
  }
  // locandine + targhette (le immagini arrivano dopo, solo per quelle vicine)
  films.forEach((film, i) => {
    const side = i % 2 ? 1 : -1, z = -START - Math.floor(i / 2) * STEP;
    const g = new THREE.Group();
    g.position.set(side * (HW - 0.03), 1.75, z); g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.12, 1.62), new THREE.MeshStandardMaterial({ color: th.frame[0], roughness: 0.5, emissive: th.frame[1], emissiveIntensity: th.frame[2] })));
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), new THREE.MeshStandardMaterial({ color: 0x15100e, roughness: 0.7 }));
    p.position.z = 0.012; p.userData.film = film; g.add(p);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.19), new THREE.MeshStandardMaterial({ color: 0x15100e, emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 }));
    pl.position.set(0, -0.99, 0.02); g.add(pl);
    room.add(g);
    posters.push({ mesh: p, plaque: pl, film, z, state: 0, hi: false, tok: 0 });
  });
  $("scrub").value = 0;
}

// Locandine "a richiesta": placeholder + immagine piccola entro 14 m, definizione piena entro 5 m, rilascio oltre 36 m
function loadPoster(p, size) {
  const url = posterUrl(p.film.poster_path, size);
  if (!url) return;
  const tok = p.tok;
  texLoader.load(url, (t) => {
    if (tok !== p.tok || p.state === 0) { t.dispose(); return; }
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
    const m = p.mesh.material; if (m.map) m.map.dispose();
    m.map = m.emissiveMap = t; m.needsUpdate = true; p.state = 2;
  }, undefined, () => {});
}
function updatePosters(z) {
  const th = room.userData.theme; if (!th) return;
  for (const p of posters) {
    const d = Math.abs(p.z - z);
    if (p.state === 0 && d < 14) {
      const m = p.mesh.material;
      m.map = m.emissiveMap = placeholderPoster(p.film); m.color.setHex(0xffffff); m.emissive.setHex(0xffffff); m.emissiveIntensity = th.hemi[1] > 1.2 ? 0.15 : 0.4; m.needsUpdate = true;
      const pm = p.plaque.material; pm.map = pm.emissiveMap = plaqueTexture(p.film, th); pm.needsUpdate = true;
      p.state = 1; loadPoster(p, "w185");
    }
    if (p.state === 2 && !p.hi && d < 5) { p.hi = true; loadPoster(p, "w342"); }
    if (p.state > 0 && d > 36) {
      p.tok++; p.state = 0; p.hi = false;
      for (const [mesh, ks] of [[p.mesh, ["map"]], [p.plaque, ["map"]]]) { const m = mesh.material; ks.forEach((k) => { m[k]?.dispose(); m[k] = null; }); m.emissiveMap = null; m.color.setHex(0x15100e); m.emissive.setHex(0xffffff); m.needsUpdate = true; }
    }
  }
}

// Oggetti 3D della stanza (si caricano dopo la stanza; se un modello manca, la stanza resta com'è)
const PRESET = { can: 2.4, ammo: 1.5, stove: 0.9, slamp1: 0.72, slamp2: 0.55, tank: 1.05 };
async function placeModel(name, o) {
  const m = await loadModel(name);
  if (!m || o.tok !== room.userData.tok) return null;
  const inner = m.scene.clone(true), sc = o.scale ?? PRESET[name] ?? 1;
  inner.position.set(-m.center.x, o.mode === "floor" ? -m.box.min.y : o.mode === "hang" ? -m.box.max.y : -m.center.y, -m.center.z);
  const w = new THREE.Group(); w.add(inner); w.scale.setScalar(sc); w.position.set(o.x, o.y ?? 0, o.z); w.rotation.y = o.ry ?? 0; room.add(w);
  return { sx: m.size.x * sc, sy: m.size.y * sc, sz: m.size.z * sc };
}
async function dress(genre, th, L) {
  const cfg = PROPS[genre] || {}, tok = room.userData.tok, HW = 1.9, H = 3.1, jobs = [];
  const faceIn = (sd) => (sd < 0 ? Math.PI / 2 : -Math.PI / 2);   // il davanti del modello guarda il centro del corridoio
  const prop = (name, z, sd, maxH) => jobs.push((async () => {
    const m = await loadModel(name); if (!m) return;
    const sc = Math.min(PRESET[name] ?? 1, maxH ? maxH / m.size.y : 9);
    if (name === "slamp2") {   // lanterna da muro
      await placeModel(name, { mode: "wall", x: sd * (HW - 0.2), y: 1.95, z, ry: faceIn(sd), scale: sc, tok }); return;
    }
    const cx = sd * (HW - 0.04) - sd * (m.size.z * sc) / 2;
    const r = await placeModel(name, { mode: "floor", x: cx, z, ry: faceIn(sd), scale: sc, tok });
    if (r) room.userData.boxes.push({ x0: cx - r.sz / 2, x1: cx + r.sz / 2, z0: z - r.sx / 2, z1: z + r.sx / 2 });
  })());
  const pick = (list, i) => list[i % list.length];
  if (cfg.entrance) for (let k = 0; k < 3; k++) [-1, 1].forEach((sd, j) => prop(pick(cfg.entrance, k * 2 + j), -2.4 - k * 1.9, sd));
  if (cfg.end) [0, 1].forEach((k) => [-1, 1].forEach((sd, j) => prop(pick(cfg.end, k * 2 + j), -L + 3.7 - k * 1.5, sd)));
  if (cfg.floor) { let i = 0; for (let z = -START - 2.6; z > -L + 6; z -= 10.3, i++) prop(pick(cfg.floor, i), z, i % 2 ? 1 : -1, 0.58); }
  if (cfg.door) jobs.push(placeModel("door", { mode: "floor", x: 0, z: -L + 1.16, ry: 0, scale: 0.88, tok }));
  if (cfg.fixture) {
    const bc = th.bulb[3], glowMat = new THREE.MeshBasicMaterial({ color: bc });
    let i = 0;
    for (let z = -3; z > -L + 2; z -= LAMP_STEP, i++) {
      const sd = i % 2 ? 1 : -1;
      if (cfg.fixture === "hlamp") {
        jobs.push(placeModel("hlamp", { mode: "hang", x: 0, y: H, z, scale: 0.62, tok }));
        const gl = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glowMat); gl.position.set(0, H - 0.78, z); room.add(gl);
      } else {
        jobs.push(placeModel("wlamp", { mode: "wall", x: sd * (HW - 0.09), y: 2.85, z, ry: faceIn(sd), scale: 1.2, tok }));
        const gl = new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), glowMat); gl.position.set(sd * (HW - 0.2), 2.85, z); room.add(gl);
      }
    }
  }
  await Promise.all(jobs);
}

// ─── controlli ───────────────────────────────────────────────────────────────
const stick = $("stick"), knob = stick.firstElementChild;
const ctl = { mx: 0, my: 0, enabled: false, keys: new Set() };
let yaw = 0, pitch = 0, mp = null, lp = null, mo = null, lo = null, tapStart = null;
const R = 46;
canvas.addEventListener("pointerdown", (e) => {
  if (!ctl.enabled) return;
  if (e.clientX < innerWidth * 0.4 && mp === null && e.pointerType === "touch") {
    mp = e.pointerId; mo = { x: e.clientX, y: e.clientY };
    stick.style.left = e.clientX + "px"; stick.style.top = e.clientY + "px"; stick.style.opacity = 1; knob.style.transform = "";
  } else if (lp === null) { lp = e.pointerId; lo = { x: e.clientX, y: e.clientY }; tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; }
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
}, { passive: false });
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId === mp) {
    let dx = e.clientX - mo.x, dy = e.clientY - mo.y; const d = Math.hypot(dx, dy);
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    ctl.mx = dx / R; ctl.my = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
  } else if (e.pointerId === lp) {
    const dx = e.clientX - lo.x, dy = e.clientY - lo.y; lo = { x: e.clientX, y: e.clientY };
    yaw -= dx * 0.0048; pitch = Math.max(-0.7, Math.min(0.7, pitch - dy * 0.0048));
    tapStart.moved += Math.abs(dx) + Math.abs(dy);
  }
});
function endPtr(e) {
  if (e.pointerId === mp) { mp = null; ctl.mx = ctl.my = 0; stick.style.opacity = 0; }
  if (e.pointerId === lp) {
    lp = null;
    if (tapStart && tapStart.moved < 10 && performance.now() - tapStart.t < 350 && e.type === "pointerup") onTap(e.clientX, e.clientY);
  }
}
canvas.addEventListener("pointerup", endPtr); canvas.addEventListener("pointercancel", endPtr);
addEventListener("keydown", (e) => ctl.keys.add(e.code)); addEventListener("keyup", (e) => ctl.keys.delete(e.code));
addEventListener("blur", () => { ctl.keys.clear(); mp = lp = null; ctl.mx = ctl.my = 0; });

const ray = new THREE.Raycaster();
function onTap(x, y) {
  if (state.where !== "room") return;
  ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(posters.map((p) => p.mesh), false)[0];
  if (hit && hit.distance < 9) openCard(hit.object.userData.film, hit.object.material.map);
}
// barra per saltare lungo il corridoio (le stanze grandi hanno centinaia di titoli)
$("scrub").addEventListener("input", (e) => {
  if (state.where !== "room") return;
  const L = room.userData.L; camera.position.z = 0.2 - (L - 2.2) * (e.target.value / 1000);
});

// ─── scheda film ─────────────────────────────────────────────────────────────
function openCard(f, tex) {
  $("c-img").src = posterUrl(f.poster_path, "w342") || tex?.image?.toDataURL?.() || "";
  $("c-title").textContent = titleOf(f);
  const vote = f.vote ? `Il tuo voto ${f.vote}/10` : (f.vote_average ? `TMDb ${Number(f.vote_average).toFixed(1)}` : "");
  $("c-meta").textContent = [yearOf(f), extractDirector(f), vote].filter(Boolean).join(" · ");
  $("c-cast").textContent = Array.isArray(f.cast) && f.cast.length ? "Con " + f.cast.slice(0, 4).join(", ") : "";
  $("c-note").textContent = f.comment || "";
  $("card").hidden = false; ctl.enabled = false;
}
$("c-close").onclick = () => { $("card").hidden = true; ctl.enabled = true; };

// ─── flusso ──────────────────────────────────────────────────────────────────
const state = { where: "hub", busy: false, rooms: {} };
function fadeTo(fn) {
  if (state.busy) return; state.busy = true; ctl.enabled = false;
  const f = $("fade"); f.style.transition = "opacity .9s"; f.style.opacity = 1;
  setTimeout(async () => { try { await fn(); } catch (e) { console.warn(e); } setTimeout(() => { f.style.opacity = 0; ctl.enabled = true; state.busy = false; }, 250); }, 950);
}
function setAtmosphere(fogHex, density, hemiC, hemiI) {
  scene.fog.color.setHex(fogHex); scene.fog.density = density; scene.background.setHex(fogHex);
  hemi.color.setHex(hemiC); hemi.intensity = hemiI;
}
function enterHub(fromDoor) {
  state.where = "hub"; hub.visible = true; room.visible = false; $("back").hidden = true; $("exit").hidden = false; $("scrub").hidden = true; $("where").textContent = "Atrio";
  setAtmosphere(0x040405, 0.04, 0x3a4458, 1.1);
  torch.intensity = 14; lamps[0].color.setHex(0xffd8a0); lamps[0].position.set(0, 3, 0); lamps[0].intensity = 12;
  [1, 2].forEach((i) => { const a = i * 2.094 + 0.5; lamps[i].color.setHex(0xffd8a0); lamps[i].position.set(Math.sin(a) * HUB_R * 0.6, 2.8, -Math.cos(a) * HUB_R * 0.6); lamps[i].intensity = HUB_R > 5.5 ? 11 : 0; });
  const d = doors.find((x) => x.genre === fromDoor);
  if (d) { camera.position.set(d.x * 0.45, 1.6, d.z * 0.45); yaw = Math.atan2(d.x, d.z); }
  else { camera.position.set(0, 1.6, 0); yaw = 0; }
  pitch = 0;
}
function enterRoom(genre) {
  const th = themeOf(genre);
  buildRoom(genre, state.rooms[genre] || []);
  state.where = "room"; hub.visible = false; room.visible = true; $("back").hidden = false; $("exit").hidden = true; $("scrub").hidden = false; $("where").textContent = LABEL[genre] || genre;
  setAtmosphere(th.fog[0], th.fog[1], th.hemi[0], th.hemi[1]);
  lamps[0].color.setHex(th.lamp[0]); lamps[0].intensity = 0; lamps[1].intensity = lamps[2].intensity = 0; torch.intensity = th.torch;
  camera.position.set(0, 1.6, 0); yaw = 0; pitch = 0;
  updatePosters(0);
  return Promise.race([dress(genre, th, room.userData.L), new Promise((r) => setTimeout(r, 6000))]);
}
$("back").onclick = () => fadeTo(() => enterHub(room.userData.genre));

// ─── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), tt = 0, nextBlink = 3, postT = 0;
const colA = new THREE.Color(), colB = new THREE.Color();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; tt += dt;
  if (ctl.enabled) {
    let x = ctl.mx, y = ctl.my; const k = ctl.keys;
    if (k.has("KeyW") || k.has("ArrowUp")) y -= 1; if (k.has("KeyS") || k.has("ArrowDown")) y += 1;
    if (k.has("KeyA")) x -= 1; if (k.has("KeyD")) x += 1;
    if (k.has("ArrowLeft")) yaw += 1.6 * dt; if (k.has("ArrowRight")) yaw -= 1.6 * dt;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    const run = k.has("ShiftLeft") || m > 0.92 ? 1.9 : 1;     // joystick a fondo (o Shift) = corsa
    const sp = 1.7 * run * dt, sy = Math.sin(yaw), cy = Math.cos(yaw);
    const ox = camera.position.x, oz = camera.position.z, boxes = state.where === "room" ? room.userData.boxes : [];
    const hit = (px, pz) => boxes.some((b) => px > b.x0 - 0.3 && px < b.x1 + 0.3 && pz > b.z0 - 0.3 && pz < b.z1 + 0.3);
    let nx = ox + (x * cy + y * sy) * sp, nz = oz + (-x * sy + y * cy) * sp;
    if (hit(nx, oz)) nx = ox;
    if (hit(nx, nz)) nz = oz;
    camera.position.x = nx; camera.position.z = nz;
    for (let i = 0; i < 8 && hit(camera.position.x, camera.position.z); i++) camera.position.z += 0.5;   // dopo un salto con la barra
    if (state.where === "hub") {
      const r = Math.hypot(camera.position.x, camera.position.z), max = HUB_R - 0.45;
      if (r > max) { camera.position.x *= max / r; camera.position.z *= max / r; }
      for (const d of doors) if (Math.hypot(camera.position.x - d.x, camera.position.z - d.z) < 0.95) {
        camera.position.x *= 0.9; camera.position.z *= 0.9; fadeTo(() => enterRoom(d.genre)); break;
      }
    } else {
      const L = room.userData.L;
      camera.position.x = Math.max(-1.45, Math.min(1.45, camera.position.x));
      camera.position.z = Math.max(-L + 1.6, Math.min(0.9, camera.position.z));
      if (camera.position.z > 0.55 && Math.abs(camera.position.x) < 0.7) fadeTo(() => enterHub(room.userData.genre));
      postT -= dt; if (postT < 0) { postT = 0.25; updatePosters(camera.position.z); $("scrub").value = Math.round(((0.2 - camera.position.z) / (L - 2.2)) * 1000); }
    }
  }
  camera.rotation.set(pitch, yaw, 0);
  if (state.where === "room") {
    const th = room.userData.theme, z = camera.position.z, zl = -3 - Math.max(0, Math.round((-3 - z) / LAMP_STEP)) * LAMP_STEP, I = th.lamp[1];
    lamp.position.set(0, 2.75, zl);
    if (th.mood === "flicker") {
      nextBlink -= dt; if (nextBlink < 0) { nextBlink = 2 + Math.random() * 6; tt = -0.35; }
      lamp.intensity = I * (tt < 0 ? (Math.random() < 0.5 ? 0 : 0.5) : 1); torch.intensity = th.torch + 4 * Math.sin(tt * 3);
      if (tt < 0) tt += dt * 2;
    } else if (th.mood === "pulse") lamp.intensity = I * (0.75 + 0.25 * Math.sin(tt * 1.4));
    else if (th.mood === "candle") lamp.intensity = I * (0.85 + 0.1 * Math.sin(tt * 9) + 0.05 * Math.sin(tt * 23));
    else if (th.mood === "cycle") { lamp.intensity = I; colA.setHex(th.cycle[0]); colB.setHex(th.cycle[1]); lamp.color.copy(colA).lerp(colB, 0.5 + 0.5 * Math.sin(tt * 0.9)); }
    else lamp.intensity = I;
  }
  renderer.render(scene, camera);
}

// ─── avvio ───────────────────────────────────────────────────────────────────
(async function boot() {
  let db = { seen: [], watchlist: [] };
  try { db = (await Promise.race([loadDB(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))])) || db; } catch (e) { console.warn("loadDB", e); }
  const by = groupByGenre(db);
  if (q.has("demo")) Object.keys(THEMES).forEach((g) => by.set(g, demoFilms(24, g)));
  // dal più bello al più brutto: voto tuo, poi voto TMDb
  const list = [...by.entries()].filter(([, a]) => a.length).sort((a, b) => b[1].length - a[1].length);
  list.forEach(([g, a]) => { state.rooms[g] = a.slice().sort((x, y) => rank(y) - rank(x)).slice(0, MAX_PER_ROOM); });
  buildHub(list.map(([genre, a]) => ({ genre, count: a.length })));
  enterHub();
  if (q.get("room") && state.rooms[q.get("room")]) enterRoom(q.get("room"));
  if (q.has("debug")) window.__s = { room, camera, state, doors, posters, enterHub, enterRoom, THEMES, setView: (y, p) => { yaw = y; pitch = p; } };
  $("intro-msg").textContent = list.length ? `${list.length} generi · ${new Set([...db.seen, ...db.watchlist].map((f) => f.id)).size} titoli` : "Libreria vuota: aggiungi titoli nell'app.";
  $("go").hidden = false;
  $("go").onclick = () => { $("intro").remove(); const f = $("fade"); f.style.opacity = 0; ctl.enabled = true; };
  requestAnimationFrame(frame);
})();
