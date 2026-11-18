// ─── stanze/stanze.js ────────────────────────────────────────────────────────
// Galleria continua: l'atrio e le sale condividono la stessa scena.
import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";
import { loadDB } from "../storage.js?v=56bcc4c";
import { posterUrl, titleOf, yearOf, extractDirector } from "../cine-core.js?v=56bcc4c";

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

// ─── dati ────────────────────────────────────────────────────────────────────
// Nomi TMDb (film e serie) → nome della stanza. Un genere può finire in più stanze.
const GENRE_ALIAS = { Dramma: ["Drama"], "Azione & Avventura": ["Azione", "Avventura"], "Action & Adventure": ["Azione", "Avventura"], Kids: ["Famiglia"], "Sci-Fi & Fantasy": ["Fantascienza", "Fantasy"], "War & Politics": ["Guerra"], Bambini: ["Famiglia"] };
const LABEL = { Drama: "Dramma" };
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
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: devicePixelRatio < 2, powerPreference: "high-performance" });
} catch (error) {
  $("intro").classList.remove("loading");
  $("intro-msg").textContent = "Le stanze 3D richiedono WebGL. Puoi tornare alla libreria.";
  console.warn("WebGL", error);
}
renderer?.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
if (renderer) {
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
}
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x020203);
scene.fog = new THREE.FogExp2(0x020203, 0.09);
const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 80);
camera.rotation.order = "YXZ";
scene.add(camera);
function resize() {
  renderer?.setSize(innerWidth, innerHeight, false);
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

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin("anonymous");
const surfaceTextures = new Map();
const aniso = Math.min(4, renderer?.capabilities.getMaxAnisotropy() ?? 1);
function tiled(url, srgb, rx, ry) {
  const key = `${url}|${rx}|${ry}`;
  if (surfaceTextures.has(key)) return surfaceTextures.get(key);
  const t = texLoader.load(url);
  surfaceTextures.set(key, t);
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
// Oggetti per stanza: ai lati degli archi, negli angoli e sotto le locandine.
const PROPS = {
  Horror: { entrance: ["chair", "vintage_grandfather_clock_01", "ornate_mirror_01", "cart", "marble_bust_01@stool", "bin"], floor: ["bin", "garden_gnome", "can"], end: ["shelf", "horse_head@cabinet", "ornate_mirror_01", "chair"] },
  Mistero: { entrance: ["vintage_grandfather_clock_01", "cabinet", "marble_bust_01@stool", "slamp2", "vintage_pocket_watch@stool", "shelf"], floor: ["stool", "wicker_basket_02", "can"], end: ["ornate_mirror_01", "cabinet", "industrial_microscope@cabinet", "stool"] },
  Thriller: { entrance: ["rack", "classic_laptop@cabinet", "cart", "television_02@cart", "industrial_microscope@cabinet", "bin"], floor: ["bin", "can", "television_02"], end: ["cabinet", "rack", "spray_paint_bottles_02", "cart"] },
  Fantascienza: { entrance: ["vintage_spacecraft_instrument@cabinet", "television_02@cart", "classic_laptop@cabinet", "cart", "vintage_spacecraft_instrument@stool", "rack"], floor: ["television_02", "vintage_spacecraft_instrument"], end: ["vintage_spacecraft_instrument@cabinet", "classic_laptop@cabinet", "rack", "television_02@cart"] },
  Drama: { entrance: ["marble_bust_01@stool", "ornate_mirror_01", "CoffeeTable_01", "slamp2", "lion_head@stool", "cabinet"], floor: ["stool", "CoffeeTable_01", "wicker_basket_02"], end: ["vintage_grandfather_clock_01", "ornate_mirror_01", "marble_bust_01@stool", "slamp2"] },
  Azione: { entrance: ["rack", "spray_paint_bottles_02", "stove", "tank", "ammo", "stove"], floor: ["stove", "tank", "spray_paint_bottles_02"], end: ["ammo", "stove", "spray_paint_bottles_02", "rack"] },
  Avventura: { entrance: ["seadogs_compass@stool", "wicker_basket_02", "stove", "fishermans_hat@stool", "ammo", "slamp2"], floor: ["ammo", "can", "wicker_basket_02", "stove"], end: ["ammo", "stove", "seadogs_compass@cabinet", "stool"] },
  Animazione: { entrance: ["garden_gnome", "tank", "spray_paint_bottles_02", "stool", "cart", "wicker_basket_02"], floor: ["stool", "can", "garden_gnome"], end: ["cart", "tank", "garden_gnome", "television_02@cart"] },
  Commedia: { entrance: ["garden_gnome", "cabinet", "television_02@cart", "fishermans_hat@stool", "stool", "wicker_basket_02"], floor: ["stool", "bin", "garden_gnome"], end: ["cart", "television_02@cabinet", "CoffeeTable_01", "stool"] },
  Crime: { entrance: ["slamp1", "spray_paint_bottles_02", "stove", "classic_laptop@cabinet", "bin", "vintage_pocket_watch@stool"], floor: ["bin", "stove", "spray_paint_bottles_02"], end: ["slamp1", "cabinet", "television_02@cart", "bin"] },
  Documentario: { entrance: ["shelf", "industrial_microscope@cabinet", "seadogs_compass@stool", "television_02@cart", "marble_bust_01@stool", "cabinet"], floor: ["stool", "wicker_basket_02", "can"], end: ["rack", "classic_laptop@cabinet", "cart", "chinese_screen_panels"] },
  Famiglia: { entrance: ["cabinet", "television_02@cart", "garden_gnome", "shelf", "wicker_basket_02", "stool"], floor: ["stool", "can", "wicker_basket_02", "garden_gnome"], end: ["cabinet", "CoffeeTable_01", "chinese_screen_panels", "stool"] },
  Fantasy: { entrance: ["slamp1", "lion_head@stool", "garden_gnome", "ornate_mirror_01", "horse_head@stool", "slamp1"], floor: ["stool", "garden_gnome", "wicker_basket_02"], end: ["slamp1", "marble_bust_01@stool", "ornate_mirror_01", "slamp1"] },
  Storia: { entrance: ["shelf", "vintage_grandfather_clock_01", "marble_bust_01@stool", "ornate_mirror_01", "lion_head@stool", "slamp2"], floor: ["stool", "can", "wicker_basket_02"], end: ["shelf", "vintage_pocket_watch@cabinet", "seadogs_compass@stool", "chinese_screen_panels"] },
  Musica: { entrance: ["stool", "television_02@cart", "classic_laptop@cabinet", "ornate_mirror_01", "spray_paint_bottles_02", "slamp2"], floor: ["stool", "television_02"], end: ["slamp2", "stool", "cabinet", "chinese_screen_panels"] },
  Romance: { entrance: ["ornate_mirror_01", "CoffeeTable_01", "marble_bust_01@stool", "slamp2", "wicker_basket_02", "cabinet"], floor: ["stool", "wicker_basket_02", "CoffeeTable_01"], end: ["cabinet", "chinese_screen_panels", "vintage_pocket_watch@stool", "slamp2"] },
  Guerra: { entrance: ["ammo", "vintage_spacecraft_instrument@cabinet", "tank", "fishermans_hat@stool", "stove", "seadogs_compass@stool"], floor: ["ammo", "tank", "can"], end: ["ammo", "rack", "stove", "vintage_spacecraft_instrument@cart"] },
  Western: { entrance: ["stove", "horse_head@cabinet", "cabinet", "fishermans_hat@stool", "slamp2", "wicker_basket_02"], floor: ["stool", "stove", "wicker_basket_02", "can"], end: ["shelf", "stove", "seadogs_compass@stool", "horse_head@stool"] },
};

// ─── i temi: una stanza per genere ───────────────────────────────────────────
// wall/floor: spec superficie con tile in metri · hemi/lamp: [colore, intensità] · torch: intensità della torcia
// mood: steady | flicker | pulse | cycle · bulb: [w,h,d,colore] lampade a soffitto · frame: [cornice, emissivo, intensità]
const W = (s, tile, tint, extra = {}) => ({ ...s, tile, tint, ...extra });
const THEMES = {
  Horror: { color: 0xb02020, fog: [0x030102, 0.075], hemi: [0x1a2230, 0.5], lamp: [0xff6a3a, 9], torch: 34, mood: "flicker", ceil: 0x080808,
    wall: W({ tex: "brick" }, [2.1, 1.05], 0x5a4a44), floor: W({ tex: "floorA" }, [1.6, 1.6], 0x5a5650, { rough: 0.65 }), bulb: [0.5, 0.06, 0.12, 0xff9060], frame: [0x0a0807, 0, 0] },
  Mistero: { color: 0x7a5cff, fog: [0x06050d, 0.08], hemi: [0x6a58a8, 0.7], lamp: [0x9a7cff, 11], torch: 26, mood: "pulse", ceil: 0x07060c,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0x8a78b8), floor: W({ tex: "rubber" }, [1, 1], 0x7a7aa0, { rough: 0.3 }), bulb: [0.4, 0.06, 0.4, 0xb8a0ff], frame: [0x120e1c, 0x7a5cff, 0.35] },
  Thriller: { color: 0x3aa07a, fog: [0x04100c, 0.055], hemi: [0x70a090, 1.0], lamp: [0xc8ffd8, 12], torch: 16, mood: "flicker", ceil: 0x0a0c0c,
    wall: W({ tex: "tiles" }, [1.2, 1.2], 0x5c6c64), floor: W({ tex: "rubber" }, [1, 1], 0xa8aeb0, { rough: 0.45 }), bulb: [0.9, 0.05, 0.3, 0xd8ffe4], frame: [0x101412, 0, 0] },
  Fantascienza: { color: 0x2a8cff, fog: [0x06203a, 0.03], hemi: [0x4a98e0, 1.6], lamp: [0x5ab8ff, 16], torch: 8, mood: "steady", ceil: 0x0c1824, neon: 0x3a9cff,
    wall: W({ proc: "panel", c1: "#26425e" }, [2.4, 2.4], 0xe0eeff, { rough: 0.45, metal: 0.35 }), floor: W({ proc: "grid", c1: "#0d1824", c2: "#2a8cff" }, [2, 2], 0xffffff, { rough: 0.3, metal: 0.4 }), bulb: [0.9, 0.05, 0.5, 0xcff0ff], frame: [0x0c1c2c, 0x2a8cff, 0.55] },
  Drama: { color: 0xc01830, fog: [0x2a060c, 0.04], hemi: [0xc02838, 1.3], lamp: [0xff3040, 16], torch: 6, mood: "steady", ceil: 0x1a0608, trim: 0xc89a3a,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0xc06068), floor: W({ tex: "planks" }, [1.6, 1.6], 0xb09080, { rough: 0.5 }), bulb: [0.7, 0.05, 0.3, 0xff7a80], frame: [0x2a1c0a, 0xc89a3a, 0.35] },
  Azione: { color: 0xff7a1a, fog: [0x1a1008, 0.03], hemi: [0xffe0c0, 1.1], lamp: [0xffa050, 12], torch: 8, mood: "steady", ceil: 0x2a2a2a, stripe: 0xff7a1a,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0xe0d0c0, { rough: 0.7, metal: 0.25 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xd8b898, { rough: 0.7 }), bulb: [1.2, 0.06, 0.25, 0xfff0d0], frame: [0x1a1a1a, 0xff7a1a, 0.4] },
  Avventura: { color: 0xd89a30, fog: [0xd8aa70, 0.028], hemi: [0xfff0d0, 1.5], lamp: [0xffd890, 12], torch: 0, mood: "steady", ceil: 0x4a3a2a,
    wall: W({ tex: "cliff" }, [2.2, 2.2], 0xc0987a), floor: W({ tex: "sand" }, [1.8, 1.8], 0xe8c898, { rough: 1 }), bulb: [0.3, 0.3, 0.3, 0xffb050], frame: [0x3a2812, 0, 0] },
  Animazione: { color: 0xff5aa8, fog: [0xbfd8ff, 0.02], hemi: [0xffffff, 1.6], lamp: [0xffffff, 10], torch: 0, mood: "steady", ceil: 0xf0f4ff,
    wall: W({ proc: "stars", c1: "#3a5ae0", c2: "#ffe066" }, [1.6, 1.6], 0xffffff), floor: W({ proc: "checker", c1: "#ff7ab0", c2: "#fff2a0" }, [1.2, 1.2], 0xffffff, { rough: 0.4 }), bulb: [0.5, 0.05, 0.5, 0xffffff], frame: [0xffffff, 0xff5aa8, 0.5] },
  Commedia: { color: 0xf0b020, fog: [0xffe8b0, 0.02], hemi: [0xfff4e0, 1.5], lamp: [0xffe0a0, 11], torch: 0, mood: "steady", ceil: 0xfff0d0,
    wall: W({ proc: "stripes", c1: "#f4c430", c2: "#fff4cc" }, [1.2, 1.2], 0xffffff), floor: W({ tex: "parquet" }, [1.6, 1.6], 0xffe0b0, { rough: 0.5 }), bulb: [0.5, 0.05, 0.5, 0xfff0c0], frame: [0xe03030, 0xe03030, 0.25] },
  Crime: { color: 0xe0902a, fog: [0x120a05, 0.05], hemi: [0xb87038, 0.95], lamp: [0xffa030, 14], torch: 12, mood: "steady", ceil: 0x0a0806,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0x7a6a60, { rough: 0.6, metal: 0.2 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0x6a625a, { rough: 0.3 }), bulb: [0.7, 0.05, 0.3, 0xffb050], frame: [0x1a1208, 0xffa030, 0.2] },
  Documentario: { color: 0xa0a8b0, fog: [0xe8e8ea, 0.015], hemi: [0xffffff, 1.7], lamp: [0xffffff, 10], torch: 0, mood: "steady", ceil: 0xf4f4f4,
    wall: W({ tex: "stucco" }, [2.2, 2.2], 0xffffff, { rough: 0.9 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xe8e4dc, { rough: 0.35 }), bulb: [1.2, 0.04, 0.3, 0xffffff], frame: [0x111111, 0, 0] },
  Famiglia: { color: 0x70c040, fog: [0xf0f4e0, 0.02], hemi: [0xfff8e0, 1.5], lamp: [0xffe8b0, 10], torch: 0, mood: "steady", ceil: 0xfff8ee,
    wall: W({ tex: "plaster" }, [2.2, 2.2], 0xb8e8c8, { rough: 0.9 }), floor: W({ tex: "rawwood" }, [1.6, 1.6], 0xe0c8a0), bulb: [0.5, 0.05, 0.5, 0xfff4d0], frame: [0x8a5a2a, 0, 0] },
  Fantasy: { color: 0x5adca0, fog: [0x0a2018, 0.05], hemi: [0x7affc0, 0.9], lamp: [0x9affb0, 9], torch: 14, mood: "pulse", ceil: 0x0a1a14,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0x6aa880), floor: W({ tex: "rocky" }, [1.8, 1.8], 0xd0ffd0, { rough: 1 }), bulb: [0.2, 0.2, 0.2, 0xb8ffd0], frame: [0x1a3a22, 0x7affc0, 0.35] },
  Storia: { color: 0xb08a50, fog: [0x2a1a0c, 0.045], hemi: [0xffc890, 0.9], lamp: [0xffb060, 10], torch: 12, mood: "candle", ceil: 0x2a1e14, trim: 0x8a6a30,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0xd0b490), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xb8a488), bulb: [0.15, 0.3, 0.15, 0xffa040], frame: [0x3a2410, 0xb08a3a, 0.2] },
  Musica: { color: 0xc050ff, fog: [0x100820, 0.05], hemi: [0x8a4aff, 0.7], lamp: [0xff40d0, 10], torch: 10, mood: "cycle", cycle: [0xff40d0, 0x40d8ff], ceil: 0x0a0614,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0x5a3a9a), floor: W({ tex: "planks" }, [1.6, 1.6], 0x8a7aa8, { rough: 0.4 }), bulb: [0.5, 0.05, 0.5, 0xff60e0], frame: [0x140a24, 0xff60e0, 0.45] },
  Romance: { color: 0xf070a0, fog: [0xffd0dc, 0.025], hemi: [0xffe0e8, 1.5], lamp: [0xffb0c0, 10], torch: 0, mood: "steady", ceil: 0xffe8ee, trim: 0xe8c080,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0xe8a0b4), floor: W({ tex: "parquet" }, [1.6, 1.6], 0xf0e0d8, { rough: 0.45 }), bulb: [0.6, 0.05, 0.3, 0xffe0e8], frame: [0xf0d0a0, 0xffc0d0, 0.3] },
  Guerra: { color: 0x8a9a40, fog: [0x1c1e10, 0.045], hemi: [0xb8c080, 1.1], lamp: [0xd0d890, 11], torch: 12, mood: "steady", ceil: 0x1a1c10,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0x8a9060, { rough: 0.7, metal: 0.2 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0x6a6444), bulb: [0.4, 0.12, 0.15, 0xd8e0a0], frame: [0x2a2c18, 0, 0] },
  Western: { color: 0xd0803a, fog: [0x3a2410, 0.035], hemi: [0xffc880, 1.1], lamp: [0xffa850, 10], torch: 8, mood: "steady", ceil: 0x3a2814,
    wall: W({ tex: "rawwood" }, [1.6, 1.6], 0xc09a6a), floor: W({ tex: "soil" }, [1.8, 1.8], 0xd8b890, { rough: 1 }), bulb: [0.2, 0.35, 0.2, 0xffb060], frame: [0x2a1a0c, 0, 0] },
};
const FALLBACK = { color: 0x8890a0, fog: [0x101418, 0.04], hemi: [0xffffff, 1.2], lamp: [0xffffff, 9], torch: 6, mood: "steady", ceil: 0x1a1c20,
  wall: W({ proc: "plaster", c1: "#9aa0aa", c2: "#6a707a" }, [2.4, 2.4], 0xffffff), floor: W({ tex: "parquet" }, [1.6, 1.6], 0x8a8070, { rough: 0.55 }), bulb: [0.8, 0.05, 0.3, 0xffffff], frame: [0x15171a, 0, 0] };
const themeOf = (g) => THEMES[g] || FALLBACK;

const hub = new THREE.Group();
scene.add(hub);
const galleries = [];
const slots = [];
const WIDTH = 6.6, DEPTH = 7.8, HEIGHT = 3.35;
const ARCH = 0.94, SPRING = 1.91, CLEARANCE = 0.24;
const PAGE_SIZE = 16;
const hubMood = { fog: [0x090706, 0.018], hemi: [0x56546b, 0.95], torch: 17 };
let hubRadius;

function mesh(group, geometry, material, x = 0, y = 0, z = 0, ry = 0, rx = 0) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, 0);
  group.add(m);
  return m;
}

function openingPath(shape, r, reverse) {
  const first = reverse ? -r : r;
  shape.lineTo(first, SPRING);
  shape.absarc(0, SPRING, r, reverse ? Math.PI : 0, reverse ? 0 : Math.PI, reverse);
  shape.lineTo(-first, 0);
}

function archFront(gallery) {
  const { shell, theme, genre, films } = gallery;
  const facade = new THREE.Shape();
  facade.moveTo(-WIDTH / 2, 0);
  facade.lineTo(-WIDTH / 2, HEIGHT);
  facade.lineTo(WIDTH / 2, HEIGHT);
  facade.lineTo(WIDTH / 2, 0);
  facade.lineTo(ARCH, 0);
  openingPath(facade, ARCH, false);
  facade.closePath();
  const brick = surface("brick", 1 / 2.1, 1 / 1.5, 0x75695c);
  brick.emissive.setHex(0x9e7968);
  brick.emissiveIntensity = 0.22;
  brick.emissiveMap = brick.map;
  brick.side = THREE.DoubleSide;
  const front = new THREE.ShapeGeometry(facade, 20);
  mesh(shell, front, brick);
  const surround = new THREE.Shape();
  surround.moveTo(-ARCH - 0.19, 0);
  openingPath(surround, ARCH + 0.19, true);
  surround.lineTo(ARCH, 0);
  openingPath(surround, ARCH, false);
  surround.closePath();
  const stone = new THREE.MeshStandardMaterial({
    color: new THREE.Color(theme.color).lerp(new THREE.Color(0x8a796b), 0.62),
    roughness: 0.76, emissive: theme.color, emissiveIntensity: 0.16
  });
  mesh(shell, new THREE.ExtrudeGeometry(surround, { depth: 0.22, bevelEnabled: false, curveSegments: 20 }), stone, 0, 0, -0.11);
  const name = (LABEL[genre] || genre).toUpperCase();
  const ink = hex(new THREE.Color(theme.color).lerp(new THREE.Color(0xffedd9), 0.72));
  const sign = labelTexture([[name, name.length > 11 ? 35 : 42, 66, "2px"], [`${films.length} titoli`, 23, 119]], 512, 160, ink);
  mesh(shell, new THREE.PlaneGeometry(2.25, 0.50), new THREE.MeshBasicMaterial({ map: sign }), 0, 3.10, 0.13);
  mesh(shell, new THREE.BoxGeometry(2 * ARCH, 0.019, 0.27), stone, 0, 0.009, 0);
  const beacon = new THREE.MeshBasicMaterial({ color: theme.color });
  for (const side of [-1, 1]) {
    mesh(shell, new THREE.BoxGeometry(0.18, 0.34, 0.12), stone, side * 1.32, 2, 0.09);
    mesh(shell, new THREE.BoxGeometry(0.08, 0.22, 0.045), beacon, side * 1.32, 2.02, 0.18);
  }
}

function buildHub(list) {
  const count = Math.max(5, list.length);
  const angle = Math.PI / count;
  const halfFace = WIDTH / 2 + 0.17;
  hubRadius = halfFace / Math.tan(angle);
  const outline = new THREE.Shape();
  const wall = surface("brick", 2 * halfFace / 2.1, 2, 0x655951);
  wall.emissive.setHex(0x8e6753);
  wall.emissiveIntensity = 0.20;
  wall.emissiveMap = wall.map;
  const roof = new THREE.MeshStandardMaterial({ color: 0x302622, emissive: 0x4b3328, emissiveIntensity: 0.16, side: THREE.DoubleSide });
  const floor = surface("floorA", 1 / 2.8, 1 / 2.8, 0x9b8a78, 0.72);
  const runner = new THREE.MeshStandardMaterial({ color: 0x4c302b, emissive: 0x4c2520, emissiveIntensity: 0.35, roughness: 0.77 });
  const bronze = new THREE.MeshStandardMaterial({ color: 0x84654b, metalness: 0.52, roughness: 0.56, emissive: 0x65432b, emissiveIntensity: 0.29 });
  for (let i = 0; i < count; i++) {
    const a = i * 2 * angle, sin = Math.sin(a), cos = Math.cos(a);
    const x = sin * hubRadius, z = -cos * hubRadius;
    const cornerX = x - cos * halfFace, cornerY = -z - sin * halfFace;
    if (i === 0) outline.moveTo(cornerX, cornerY);
    else outline.lineTo(cornerX, cornerY);
    const entry = list[i];
    const slot = { x, z, sin, cos, ry: -a, gallery: null };
    slots.push(slot);
    if (entry) {
      const shell = new THREE.Group();
      shell.position.set(x, 0, z);
      shell.rotation.y = -a;
      scene.add(shell);
      const gallery = { ...slot, ...entry, shell, theme: themeOf(entry.genre), page: 0, exhibits: new Map(), boxes: [] };
      slot.gallery = gallery;
      galleries.push(gallery);
      gallery.lightPosition = shell.localToWorld(new THREE.Vector3(0, 2.65, -3.4));
      archFront(gallery);
      buildRoom(gallery);
      const length = hubRadius - 3, radius = (hubRadius + 3) / 2;
      mesh(hub, new THREE.PlaneGeometry(0.92, length), runner, sin * radius, 0.006, -cos * radius, 0, -Math.PI / 2).rotation.z = -a;
      for (const side of [-1, 1]) {
        const offset = side * 0.44;
        mesh(hub, new THREE.BoxGeometry(0.025, 0.012, length), bronze, sin * radius + cos * offset, 0.009, -cos * radius + sin * offset, -a);
      }
    }
    const panels = entry ? [-1, 1].map((side) => [side * (WIDTH / 2 + 0.085), 0.17]) : [[0, 2 * halfFace]];
    for (const [offset, width] of panels) {
      mesh(hub, new THREE.PlaneGeometry(width, HEIGHT), wall, x + cos * offset, HEIGHT / 2, z + sin * offset, -a);
    }
  }
  outline.closePath();
  mesh(hub, new THREE.ShapeGeometry(outline), floor, 0, 0, 0, 0, -Math.PI / 2);
  mesh(hub, new THREE.ShapeGeometry(outline), roof, 0, HEIGHT, 0, 0, -Math.PI / 2);
  const ceilingBeams = new THREE.MeshStandardMaterial({ color: 0x49332a, emissive: 0x51352c, emissiveIntensity: 0.27, roughness: 0.8 });
  for (const slot of slots) {
    const length = hubRadius - 1.68, radius = (hubRadius + 1.68) / 2;
    mesh(hub, new THREE.BoxGeometry(0.10, 0.09, length), ceilingBeams, slot.sin * radius, HEIGHT - 0.04, -slot.cos * radius, slot.ry);
  }
  const chandelier = new THREE.MeshBasicMaterial({ color: 0xffb978 });
  mesh(hub, new THREE.CylinderGeometry(0.11, 0.11, 0.48, 12), bronze, 0, 3.10, 0);
  for (const radius of [0.52, 0.91]) {
    mesh(hub, new THREE.TorusGeometry(radius, 0.045, 7, 48), bronze, 0, 2.83, 0, 0, Math.PI / 2);
    for (let i = 0; i < 8; i++) {
      const a = i * Math.PI / 4;
      mesh(hub, new THREE.CylinderGeometry(0.04, 0.05, 0.13, 7), chandelier, Math.cos(a) * radius, 2.78, Math.sin(a) * radius);
    }
  }
  const metal = new THREE.MeshStandardMaterial({ color: 0x99724d, roughness: 0.46, metalness: 0.55, emissive: 0x50301a, emissiveIntensity: 0.3 });
  for (const r of [1.35, 1.51, hubRadius - 0.30]) {
    mesh(hub, new THREE.RingGeometry(r - 0.018, r, 80), metal, 0, 0.009, 0, 0, -Math.PI / 2);
  }
  const title = labelTexture([["CINETRACKER", 52, 83, "7px"]], 512, 160, "#caa27a");
  mesh(hub, new THREE.PlaneGeometry(2.25, 0.7), new THREE.MeshBasicMaterial({ map: title, transparent: true, opacity: 0.76 }), 0, 0.011, 0, 0, -Math.PI / 2);
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

function buildRoom(gallery) {
  const { shell, theme: th } = gallery;
  const wall = specMat(th.wall, DEPTH / th.wall.tile[0], HEIGHT / th.wall.tile[1]);
  wall.emissive.setHex(th.color);
  wall.emissiveIntensity = 0.045;
  const rear = specMat(th.wall, WIDTH / th.wall.tile[0], HEIGHT / th.wall.tile[1]);
  rear.emissive.copy(wall.emissive);
  rear.emissiveIntensity = wall.emissiveIntensity;
  const floor = specMat(th.floor, WIDTH / th.floor.tile[0], DEPTH / th.floor.tile[1]);
  const ceiling = new THREE.MeshStandardMaterial({ color: th.ceil, roughness: 0.92 });
  const trim = new THREE.MeshStandardMaterial({ color: th.trim || 0x564737, metalness: 0.35, roughness: 0.66, emissive: th.color, emissiveIntensity: 0.11 });
  for (const side of [-1, 1]) {
    const x = side * WIDTH / 2;
    mesh(shell, new THREE.PlaneGeometry(DEPTH, HEIGHT), wall, x, HEIGHT / 2, -DEPTH / 2, -side * Math.PI / 2);
    for (const y of [0.1, 3.04]) mesh(shell, new THREE.BoxGeometry(0.075, 0.12, DEPTH), trim, x - side * 0.035, y, -DEPTH / 2);
    if (th.neon || th.stripe) {
      const glow = new THREE.MeshBasicMaterial({ color: th.neon || th.stripe });
      mesh(shell, new THREE.BoxGeometry(0.035, 0.035, DEPTH - 0.35), glow, x - side * 0.07, 3.11, -DEPTH / 2);
    }
  }
  mesh(shell, new THREE.PlaneGeometry(WIDTH, HEIGHT), rear, 0, HEIGHT / 2, -DEPTH);
  mesh(shell, new THREE.PlaneGeometry(WIDTH, DEPTH), floor, 0, 0, -DEPTH / 2, 0, -Math.PI / 2);
  mesh(shell, new THREE.PlaneGeometry(WIDTH, DEPTH), ceiling, 0, HEIGHT, -DEPTH / 2, 0, Math.PI / 2);
  for (const y of [0.1, 3.04]) mesh(shell, new THREE.BoxGeometry(WIDTH, 0.12, 0.075), trim, 0, y, -DEPTH + 0.035);
  mesh(shell, new THREE.PlaneGeometry(1.3, 0.26), new THREE.MeshBasicMaterial({ map: labelTexture([["ATRIO", 47, 87, "7px"]]) }), 0, 3.05, -0.02, Math.PI);
  const glass = new THREE.MeshBasicMaterial({ color: th.bulb[3] });
  for (const z of [-2.1, -5.7]) {
    const [w, h, d] = th.bulb;
    mesh(shell, new THREE.BoxGeometry(0.025, 0.36, 0.025), trim, 0, HEIGHT - 0.18, z);
    mesh(shell, new THREE.BoxGeometry(Math.max(w, 0.32), 0.10, Math.max(d, 0.26)), trim, 0, 2.97, z);
    mesh(shell, new THREE.BoxGeometry(Math.max(w * 0.8, 0.25), Math.min(h, 0.1), Math.max(d * 0.75, 0.2)), glass, 0, 2.90, z);
  }
}

const displaySlots = [];
for (const x of [-0.66, 0.66, -1.98, 1.98]) displaySlots.push([x, -DEPTH + 0.05, 0]);
for (let i = 0; i < 5; i++) {
  for (const side of [-1, 1]) displaySlots.push([side * (WIDTH / 2 - 0.05), -6.75 + i * 1.30, -side * Math.PI / 2]);
}
for (const side of [-1, 1]) displaySlots.push([side * 2.0, -0.05, Math.PI]);

const exhibitsInMemory = new Map();
const MAX_EXHIBITS = 6;
function showExhibit(gallery) {
  let exhibit = gallery.exhibits.get(gallery.page);
  if (!exhibit) {
    const group = new THREE.Group(), posters = [];
    exhibit = { group, posters, gallery, page: gallery.page, disposed: false };
    gallery.exhibits.set(gallery.page, exhibit);
    const th = gallery.theme;
    gallery.films.slice(gallery.page * PAGE_SIZE, (gallery.page + 1) * PAGE_SIZE).forEach((film, i) => {
      const [x, z, ry] = displaySlots[i];
      const frame = new THREE.Group();
      frame.position.set(x, 1.79, z);
      frame.rotation.y = ry;
      group.add(frame);
      const frameMat = new THREE.MeshStandardMaterial({ color: th.frame[0], roughness: 0.5, emissive: th.frame[1], emissiveIntensity: th.frame[2] });
      mesh(frame, new THREE.BoxGeometry(1.12, 1.62, 0.044), frameMat);
      const fallback = placeholderPoster(film);
      const mat = new THREE.MeshStandardMaterial({ map: fallback, emissiveMap: fallback, emissive: 0xffffff, emissiveIntensity: 0.48, roughness: 0.75 });
      const artwork = mesh(frame, new THREE.PlaneGeometry(1.0, 1.5), mat, 0, 0, 0.024);
      artwork.userData.film = film;
      const plaque = plaqueTexture(film, th);
      mesh(frame, new THREE.PlaneGeometry(0.62, 0.19), new THREE.MeshBasicMaterial({ map: plaque }), 0, -0.97, 0.025);
      const poster = { artwork, film, size: 0 };
      posters.push(poster);
      loadPoster(exhibit, poster, 185);
    });
  }
  if (gallery.display !== exhibit) {
    gallery.display?.group.removeFromParent();
    gallery.display = exhibit;
    gallery.shell.add(exhibit.group);
  }
  exhibitsInMemory.delete(exhibit);
  exhibitsInMemory.set(exhibit, true);
  if (exhibitsInMemory.size > MAX_EXHIBITS) {
    const old = [...exhibitsInMemory.keys()].find((item) => item !== exhibit && item !== active?.display);
    if (old) {
      exhibitsInMemory.delete(old);
      old.disposed = true;
      old.gallery.exhibits.delete(old.page);
      if (old.gallery.display === old) old.gallery.display = null;
      old.group.removeFromParent();
      clearGroup(old.group);
    }
  }
  if (!gallery.dressed) {
    gallery.dressed = true;
    void dress(gallery);
  }
}

function loadPoster(exhibit, poster, size) {
  const url = posterUrl(poster.film.poster_path, `w${size}`);
  if (!url) return;
  texLoader.load(url, (texture) => {
    if (exhibit.disposed || poster.size >= size) { texture.dispose(); return; }
    poster.size = size;
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = aniso;
    const mat = poster.artwork.material;
    mat.map.dispose();
    mat.map = mat.emissiveMap = texture;
    mat.needsUpdate = true;
  });
}

const PRESET = { can: 2.4, ammo: 1.5, stove: 0.9, slamp1: 0.72, slamp2: 0.55, tank: 1.05, marble_bust_01: 1.15, lion_head: 1.15, horse_head: 1.25, vintage_pocket_watch: 5, seadogs_compass: 3, fishermans_hat: 1.3, spray_paint_bottles_02: 1.3, wicker_basket_02: 1.3, ornate_mirror_01: 1.8 };
async function placeProp(gallery, spec, x, z, ry, maxH, y = 0) {
  const [name, base] = spec.split("@");
  const model = await loadModel(base || name);
  if (!model) return;
  const scale = Math.min(PRESET[base || name] ?? 1, maxH / model.size.y, 0.78 / Math.max(model.size.x, model.size.z));
  const inner = model.scene.clone(true);
  inner.position.set(-model.center.x, -model.box.min.y, -model.center.z);
  const child = new THREE.Group();
  child.position.set(x, y, z);
  child.rotation.y = ry;
  child.scale.setScalar(scale);
  child.add(inner);
  gallery.shell.add(child);
  if (y === 0) gallery.boxes.push({ x, z, radius: Math.hypot(model.size.x, model.size.z) * scale / 2 });
  if (base) await placeProp(gallery, name, x, z, ry, 0.85, model.size.y * scale);
}

async function dress(gallery) {
  const cfg = PROPS[gallery.genre];
  if (!cfg) return;
  const placements = [
    [cfg.entrance[0], -2.72, -0.67, Math.PI / 7, 2.15],
    [cfg.entrance[1], 2.72, -0.67, -Math.PI / 7, 2.15],
    [cfg.end[0], -2.73, -7.12, Math.PI / 5, 1.28],
    [cfg.end[1], 2.73, -7.12, -Math.PI / 5, 1.28],
    [cfg.floor[0], -2.91, -3.0, Math.PI / 2, 0.52],
    [cfg.floor[1], 2.91, -4.15, -Math.PI / 2, 0.52],
  ];
  await Promise.all(placements.filter(([spec]) => spec).map((args) => placeProp(gallery, ...args)));
}

// ─── controlli ───────────────────────────────────────────────────────────────
const stick = $("stick"), knob = stick.firstElementChild;
const ctl = { mx: 0, my: 0, enabled: false, keys: new Set() };
let yaw = 0, pitch = 0, mp = null, lp = null, mo = null, lo = null, tapStart = null, moveTap = null;
const R = 46;
canvas.addEventListener("pointerdown", (e) => {
  if (!ctl.enabled) return;
  if (e.clientX < innerWidth * 0.4 && mp === null && e.pointerType === "touch") {
    mp = e.pointerId; mo = { x: e.clientX, y: e.clientY }; moveTap = { time: performance.now(), dragged: false };
    stick.style.left = e.clientX + "px"; stick.style.top = e.clientY + "px"; stick.style.opacity = 1; knob.style.transform = "";
  } else if (lp === null) { lp = e.pointerId; lo = { x: e.clientX, y: e.clientY }; tapStart = { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 }; }
  try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
  e.preventDefault();
}, { passive: false });
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerId === mp) {
    let dx = e.clientX - mo.x, dy = e.clientY - mo.y; const d = Math.hypot(dx, dy);
    if (d > 10) moveTap.dragged = true;
    if (d > R) { dx = dx / d * R; dy = dy / d * R; }
    ctl.mx = dx / R; ctl.my = dy / R; knob.style.transform = `translate(${dx}px,${dy}px)`;
  } else if (e.pointerId === lp) {
    const dx = e.clientX - lo.x, dy = e.clientY - lo.y; lo = { x: e.clientX, y: e.clientY };
    yaw -= dx * 0.0048; pitch = Math.max(-0.7, Math.min(0.7, pitch - dy * 0.0048));
    tapStart.moved += Math.abs(dx) + Math.abs(dy);
  }
});
function endPtr(e) {
  if (e.pointerId === mp) {
    mp = null; ctl.mx = ctl.my = 0; stick.style.opacity = 0;
    if (!moveTap.dragged && performance.now() - moveTap.time < 350 && e.type === "pointerup") onTap(e.clientX, e.clientY);
    moveTap = null;
  }
  if (e.pointerId === lp) {
    lp = null;
    if (tapStart && tapStart.moved < 10 && performance.now() - tapStart.t < 350 && e.type === "pointerup") onTap(e.clientX, e.clientY);
  }
}
canvas.addEventListener("pointerup", endPtr); canvas.addEventListener("pointercancel", endPtr);
addEventListener("keydown", (e) => ctl.keys.add(e.code)); addEventListener("keyup", (e) => ctl.keys.delete(e.code));
addEventListener("blur", () => {
  ctl.keys.clear();
  mp = lp = null;
  ctl.mx = ctl.my = 0;
  stick.style.opacity = 0;
});

const ray = new THREE.Raycaster();
function onTap(x, y) {
  if (!active?.display || !ctl.enabled) return;
  ray.setFromCamera(new THREE.Vector2(x / innerWidth * 2 - 1, -(y / innerHeight) * 2 + 1), camera);
  const hit = ray.intersectObjects(active.display.posters.map((p) => p.artwork), false)[0];
  if (hit && hit.distance < 9) openCard(hit.object.userData.film, hit.object.material.map);
}
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

// ─── navigazione continua ───────────────────────────────────────────────────
let active = null;
const localX = (slot, x, z) => (x - slot.x) * slot.cos + (z - slot.z) * slot.sin;
const localZ = (slot, x, z) => -(x - slot.x) * slot.sin + (z - slot.z) * slot.cos;

function moveCamera(x, z) {
  camera.position.set(x, 1.6, z);
}

function setGallery(gallery) {
  if (active === gallery) return;
  active = gallery;
  $("back").hidden = !gallery;
  $("exit").hidden = !!gallery;
  $("where").textContent = gallery ? LABEL[gallery.genre] || gallery.genre : "Atrio";
  if (gallery) showExhibit(gallery);
  updatePages();
}

function updatePages() {
  const count = active ? Math.ceil(active.films.length / PAGE_SIZE) : 0;
  $("exhibits").hidden = count <= 1;
  if (count <= 1) return;
  $("exhibit-count").textContent = `${active.page + 1} / ${count}`;
  $("previous").disabled = active.page === 0;
  $("next").disabled = active.page + 1 === count;
}

function changePage(step) {
  if (!active || !ctl.enabled) return;
  const page = active.page + step;
  if (page < 0 || page >= Math.ceil(active.films.length / PAGE_SIZE)) return;
  active.page = page;
  showExhibit(active);
  updatePages();
}

$("previous").onclick = () => changePage(-1);
$("next").onclick = () => changePage(1);
$("back").onclick = () => {
  const gallery = active;
  if (!gallery) return;
  moveCamera(0, 0);
  yaw = gallery.ry;
  pitch = 0;
  setGallery(null);
};

function roomAt(x, z) {
  return galleries.find((g) => {
    const lx = localX(g, x, z), lz = localZ(g, x, z);
    return Math.abs(lx) < WIDTH / 2 && lz < 0 && lz > -DEPTH;
  }) || null;
}

function walkable(x, z, ox, oz) {
  const outside = slots.find((slot) => localZ(slot, x, z) < CLEARANCE);
  if (!outside) return true;
  const gallery = roomAt(x, z) || outside.gallery;
  if (!gallery) return false;
  const lx = localX(gallery, x, z), lz = localZ(gallery, x, z);
  if (Math.abs(lz) < CLEARANCE) return Math.abs(lx) < ARCH - CLEARANCE;
  if (lz >= 0 || lz < -DEPTH + CLEARANCE || Math.abs(lx) > WIDTH / 2 - CLEARANCE) return false;
  const x0 = localX(gallery, ox, oz), z0 = localZ(gallery, ox, oz);
  return !gallery.boxes.some((b) => {
    const d = Math.hypot(lx - b.x, lz - b.z);
    return d < b.radius + CLEARANCE && d < Math.hypot(x0 - b.x, z0 - b.z);
  });
}

function updateNearby() {
  const { x, z } = camera.position;
  const adjacent = galleries
    .map((g) => ({ g, d: Math.hypot(x - g.x, z - g.z) }))
    .filter(({ g, d }) => g !== active && d < 8)
    .sort((a, b) => a.d - b.d)
    .slice(0, 2);
  for (const { g } of adjacent) showExhibit(g);
  if (!active?.display) return;
  const lx = localX(active, x, z), lz = localZ(active, x, z);
  for (const p of active.display.posters) {
    const pos = p.artwork.parent.position;
    if (!p.upgrading && Math.hypot(lx - pos.x, lz - pos.z) < 2.8) {
      p.upgrading = true;
      loadPoster(active.display, p, 342);
    }
  }
}

const hubLightPosition = new THREE.Vector3(0, 2.95, 0);
const targetFog = new THREE.Color(), targetHemi = new THREE.Color(), targetLamp = new THREE.Color();
function updateLighting(dt) {
  const theme = active?.theme || hubMood, blend = 1 - Math.exp(-dt * 8);
  targetFog.setHex(theme.fog[0]);
  scene.fog.color.lerp(targetFog, blend);
  scene.background.copy(scene.fog.color);
  scene.fog.density += (theme.fog[1] - scene.fog.density) * blend;
  hemi.color.lerp(targetHemi.setHex(theme.hemi[0]), blend);
  hemi.intensity += (theme.hemi[1] - hemi.intensity) * blend;
  torch.intensity += (theme.torch - torch.intensity) * blend;
  const near = galleries.map((g) => {
    const position = g.lightPosition;
    return { g, position, d: position.distanceToSquared(camera.position) };
  }).sort((a, b) => a.d - b.d);
  const fixtures = [{ position: hubLightPosition, color: 0xffce9b, power: 24 }];
  for (const { g, position } of near.slice(0, 2)) {
    const [color, power] = g.theme.lamp;
    const mood = g.theme.mood;
    let flicker = 1;
    if (mood === "flicker") flicker = 0.80 + 0.16 * Math.sin(tt * 7) + 0.06 * Math.sin(tt * 31);
    if (mood === "pulse") flicker = 0.83 + 0.17 * Math.sin(tt * 1.4);
    if (mood === "candle") flicker = 0.89 + 0.07 * Math.sin(tt * 9) + 0.04 * Math.sin(tt * 23);
    const tint = mood === "cycle" ? targetLamp.setHex(color).lerp(colB.setHex(g.theme.cycle[1]), 0.5 + 0.5 * Math.sin(tt * 0.9)).getHex() : color;
    fixtures.push({ position, color: tint, power: power * 1.7 * flicker });
  }
  lamps.forEach((light, i) => {
    const fixture = fixtures[i];
    if (!fixture) { light.intensity = 0; return; }
    light.position.copy(fixture.position);
    light.color.setHex(fixture.color);
    light.intensity = fixture.power;
  });
}

// ─── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), tt = 0, postT = 0;
const colB = new THREE.Color();
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
    const { x: ox, z: oz } = camera.position;
    const dx = (x * cy + y * sy) * sp, dz = (-x * sy + y * cy) * sp;
    if ((dx || dz) && walkable(ox + dx, oz + dz, ox, oz)) moveCamera(ox + dx, oz + dz);
    else if (dx || dz) {
      if (dx && walkable(ox + dx, oz, ox, oz)) moveCamera(ox + dx, oz);
      if (dz && walkable(camera.position.x, oz + dz, camera.position.x, oz)) moveCamera(camera.position.x, oz + dz);
    }
    setGallery(roomAt(camera.position.x, camera.position.z));
    postT -= dt;
    if (postT < 0) { postT = 0.32; updateNearby(); }
  }
  camera.rotation.set(pitch, yaw, 0);
  updateLighting(dt);
  renderer.render(scene, camera);
}

// ─── avvio ───────────────────────────────────────────────────────────────────
(async function boot() {
  if (!renderer) return;
  let db = { seen: [], watchlist: [] };
  try { db = (await Promise.race([loadDB(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))])) || db; } catch (e) { console.warn("loadDB", e); }
  const by = groupByGenre(db);
  if (q.has("demo")) Object.keys(THEMES).forEach((g) => by.set(g, demoFilms(24, g)));
  // dal più bello al più brutto: voto tuo, poi voto TMDb
  const list = [...by.entries()].filter(([, a]) => a.length).sort((a, b) => b[1].length - a[1].length);
  buildHub(list.map(([genre, films]) => ({ genre, films: films.slice().sort((x, y) => rank(y) - rank(x)) })));
  moveCamera(0, 0);
  $("where").textContent = "Atrio";
  const requested = galleries.find((g) => g.genre === q.get("room"));
  if (requested) {
    moveCamera(requested.x + requested.sin * DEPTH / 2, requested.z - requested.cos * DEPTH / 2);
    yaw = requested.ry;
    setGallery(requested);
  }
  const ahead = requested || galleries[0];
  if (ahead) showExhibit(ahead);
  updateNearby();
  if (q.has("debug")) window.__s = { galleries, camera, scene, moveCamera, walkable, roomAt, changePage, setView: (y, p) => { yaw = y; pitch = p; }, get active() { return active; } };
  const titles = new Set([...(db.seen || []), ...(db.watchlist || [])].map((f) => `${f.media_type}|${f.id}`)).size;
  $("intro-msg").textContent = list.length ? (q.has("demo") ? `${list.length} sale dimostrative` : `${list.length} sale · ${titles} titoli`) : "Aggiungi titoli a CineTracker per popolare le sale.";
  $("intro").classList.remove("loading");
  if (requested) $("go").textContent = `Entra · ${LABEL[requested.genre] || requested.genre}`;
  $("go").hidden = false;
  $("go").onclick = () => {
    $("intro").remove();
    $("fade").style.opacity = 0;
    ctl.enabled = true;
  };
  requestAnimationFrame(frame);
})();
