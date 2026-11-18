// ─── stanze/stanze.js ────────────────────────────────────────────────────────
// Galleria continua: l'atrio e le sale condividono la stessa scena.
import * as THREE from "three";
import { GLTFLoader } from "./vendor/loaders/GLTFLoader.js";
import { loadDB } from "../storage.js?v=489ae17";
import { posterUrl, titleOf, yearOf, extractDirector } from "../cine-core.js?v=489ae17";

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
  return Array.from({ length: n }, (_, i) => ({ id: 9000 + i, media_type: "movie", title: t[i % t.length], year: 1974 + (i * 7) % 52, vote: [9, 8, 7, 8.5, 6, 5, 7.5, 4, 9.5, 6.5, 3, 8, 7, 5.5][i % 14], genre_names: [genre], director: "Regista " + (i + 1), cast: ["Attore A", "Attrice B"], poster_path: "" }));
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
const lamps = Array.from({ length: 5 }, () => new THREE.PointLight(0xffdbb7, 0, 13, 1.65));
scene.add(hemi, ...lamps);

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin("anonymous");
const surfaceTextures = new Map();
const aniso = Math.min(4, renderer?.capabilities.getMaxAnisotropy() ?? 1);
function tiled(url, srgb, rx, ry) {
  if (!surfaceTextures.has(url)) {
    const variants = new Map();
    const source = texLoader.load(url, () => variants.forEach((texture) => { texture.needsUpdate = true; }));
    surfaceTextures.set(url, { source, variants });
  }
  const { source, variants } = surfaceTextures.get(url);
  const key = `${rx}|${ry}`;
  if (!variants.has(key)) {
    const texture = source.clone();
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(rx, ry);
    texture.anisotropy = aniso;
    if (srgb) texture.colorSpace = THREE.SRGBColorSpace;
    variants.set(key, texture);
  }
  return variants.get(key);
}
function surface(name, rx, ry, tint, rough = 0.9, metal = 0) {
  return new THREE.MeshStandardMaterial({ map: tiled(`stanze/tex/${name}_c.jpg`, true, rx, ry), normalMap: tiled(`stanze/tex/${name}_n.jpg`, false, rx, ry), color: tint, roughness: rough, metalness: metal });
}
function canvasTex(w, h, draw) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
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
  return canvasTex(128, 192, (g, w, h) => {
    g.fillStyle = "#332a25"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#96816a"; g.strokeRect(6.5, 6.5, w - 13, h - 13);
    g.fillStyle = "#e4d5c0"; g.textAlign = "center"; g.font = "bold 17px Georgia, serif";
    const lines = wrapTitle(g, titleOf(film), w - 24);
    lines.forEach((line, i) => g.fillText(line, w / 2, 90 + (i - (lines.length - 1) / 2) * 20, w - 22));
    g.font = "12px Georgia, serif";
    g.fillText(yearOf(film) || "", w / 2, 159);
  });
}
// libera la memoria video di tutto ciò che sta in un gruppo
function clearGroup(g) {
  g.traverse((o) => {
    if (o.userData.shared) return;       // parti dei modelli in cache: restano per le stanze dopo
    o.geometry?.dispose();
    if (o.userData.keepMaterial) return;
    [].concat(o.material || []).forEach((m) => { ["map", "normalMap", "emissiveMap"].forEach((k) => { if (m[k] && !m[k].userData.keep) m[k].dispose(); }); m.dispose(); });
  });
  g.clear();
}

function specMat(spec, rx, ry) {
  return surface(spec.tex, rx, ry, spec.tint ?? 0xffffff, spec.rough ?? 0.85, spec.metal ?? 0);
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
// wall/floor: materiali e dimensioni delle ripetizioni in metri.
const W = (s, tile, tint, extra = {}) => ({ ...s, tile, tint, ...extra });
const THEMES = {
  Horror: { ceil: 0x080808,
    wall: W({ tex: "brick" }, [2.1, 1.05], 0x5a4a44), floor: W({ tex: "floorA" }, [1.6, 1.6], 0x5a5650, { rough: 0.65 }) },
  Mistero: { ceil: 0x07060c,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0x8a78b8), floor: W({ tex: "rubber" }, [1, 1], 0x7a7aa0, { rough: 0.3 }) },
  Thriller: { ceil: 0x0a0c0c,
    wall: W({ tex: "tiles" }, [1.2, 1.2], 0x5c6c64), floor: W({ tex: "rubber" }, [1, 1], 0xa8aeb0, { rough: 0.45 }) },
  Fantascienza: { ceil: 0x0c1824,
    wall: W({ tex: "tiles" }, [2.4, 2.4], 0xe0eeff, { rough: 0.45, metal: 0.35 }), floor: W({ tex: "floorB" }, [2, 2], 0xffffff, { rough: 0.3, metal: 0.4 }) },
  Drama: { ceil: 0x1a0608,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0xc06068), floor: W({ tex: "planks" }, [1.6, 1.6], 0xb09080, { rough: 0.5 }) },
  Azione: { ceil: 0x2a2a2a,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0xe0d0c0, { rough: 0.7, metal: 0.25 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xd8b898, { rough: 0.7 }) },
  Avventura: { ceil: 0x4a3a2a,
    wall: W({ tex: "cliff" }, [2.2, 2.2], 0xc0987a), floor: W({ tex: "sand" }, [1.8, 1.8], 0xe8c898, { rough: 1 }) },
  Animazione: { ceil: 0xf0f4ff,
    wall: W({ tex: "plaster" }, [1.6, 1.6], 0xc9aba0), floor: W({ tex: "parquet" }, [1.2, 1.2], 0xd8b2a0, { rough: 0.4 }) },
  Commedia: { ceil: 0xfff0d0,
    wall: W({ tex: "stucco" }, [1.2, 1.2], 0xd6ba8a), floor: W({ tex: "parquet" }, [1.6, 1.6], 0xffe0b0, { rough: 0.5 }) },
  Crime: { ceil: 0x0a0806,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0x7a6a60, { rough: 0.6, metal: 0.2 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0x6a625a, { rough: 0.3 }) },
  Documentario: { ceil: 0xf4f4f4,
    wall: W({ tex: "stucco" }, [2.2, 2.2], 0xffffff, { rough: 0.9 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xe8e4dc, { rough: 0.35 }) },
  Famiglia: { ceil: 0xfff8ee,
    wall: W({ tex: "plaster" }, [2.2, 2.2], 0xb8e8c8, { rough: 0.9 }), floor: W({ tex: "rawwood" }, [1.6, 1.6], 0xe0c8a0) },
  Fantasy: { ceil: 0x0a1a14,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0x6aa880), floor: W({ tex: "rocky" }, [1.8, 1.8], 0xd0ffd0, { rough: 1 }) },
  Storia: { ceil: 0x2a1e14,
    wall: W({ tex: "stone" }, [1.8, 1.8], 0xd0b490), floor: W({ tex: "floorB" }, [1.8, 1.8], 0xb8a488) },
  Musica: { ceil: 0x0a0614,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0x5a3a9a), floor: W({ tex: "planks" }, [1.6, 1.6], 0x8a7aa8, { rough: 0.4 }) },
  Romance: { ceil: 0xffe8ee,
    wall: W({ tex: "velvet" }, [1.1, 1.1], 0xe8a0b4), floor: W({ tex: "parquet" }, [1.6, 1.6], 0xf0e0d8, { rough: 0.45 }) },
  Guerra: { ceil: 0x1a1c10,
    wall: W({ tex: "rust" }, [2.4, 2.4], 0x8a9060, { rough: 0.7, metal: 0.2 }), floor: W({ tex: "floorB" }, [1.8, 1.8], 0x6a6444) },
  Western: { ceil: 0x3a2814,
    wall: W({ tex: "rawwood" }, [1.6, 1.6], 0xc09a6a), floor: W({ tex: "soil" }, [1.8, 1.8], 0xd8b890, { rough: 1 }) },
};
const FALLBACK = { ceil: 0x1a1c20,
  wall: W({ tex: "plaster" }, [2.4, 2.4], 0xffffff), floor: W({ tex: "parquet" }, [1.6, 1.6], 0x8a8070, { rough: 0.55 }) };
const themeOf = (g) => THEMES[g] || FALLBACK;

const hub = new THREE.Group();
scene.add(hub);
const galleries = [];
const slots = [];
const HEIGHT = 3.35;
const FRAME_SPACING = 1.25;
const ARCH = 0.94, SPRING = 1.91, CLEARANCE = 0.24;
const ambient = { fog: [0x171310, 0.012], sky: 0xffede0, ground: 0x72675f };
const wallFinish = new THREE.Color(0xa29385);

function displayLayout(films) {
  const rated = films.filter((film) => Number(film.vote) > 0).length;
  // Il voto personale misura la collezione. Una piccola quota dà spazio anche ai titoli in lista.
  const scale = Math.min(1, Math.sqrt((rated + Math.min(5, (films.length - rated) / 4)) / 44));
  const width = 4.35 + 4.05 * scale;
  const depth = 4.45 + 9.75 * scale;
  const displays = [];
  const rearCount = Math.floor((width - 0.65) / FRAME_SPACING);
  for (let i = 0; i < rearCount; i++) {
    displays.push([(i - (rearCount - 1) / 2) * FRAME_SPACING, -depth + 0.035, 0]);
  }
  const sideCount = Math.floor((depth - 1.25) / FRAME_SPACING);
  const first = -(depth + (sideCount - 1) * FRAME_SPACING) / 2;
  for (let i = 0; i < sideCount; i++) {
    for (const side of [-1, 1]) displays.push([side * (width / 2 - 0.035), first + i * FRAME_SPACING, -side * Math.PI / 2]);
  }
  for (let x = 1.83; x < width / 2 - 0.62; x += FRAME_SPACING) {
    for (const side of [-1, 1]) displays.push([side * x, -0.04, Math.PI]);
  }
  const panels = depth >= 11.2 && width >= 7.15 && films.length > displays.length
    ? (depth > 12.5 && films.length > displays.length + 6
      ? [{ x: -1.4, z: -depth * 0.34 }, { x: 1.4, z: -depth * 0.66 }]
      : [{ x: -1.35, z: -depth * 0.52 }])
    : [];
  for (const { x, z } of panels) {
    for (const side of [1, -1]) {
      for (let i = -1; i <= 1; i++) displays.push([x + side * 0.074, z + i * FRAME_SPACING, side * Math.PI / 2]);
    }
  }
  return { rated, width, depth, displays, panels, pages: Math.ceil(films.length / displays.length) };
}
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
  const { shell, genre, width, rated } = gallery;
  const facade = new THREE.Shape();
  facade.moveTo(-width / 2, 0);
  facade.lineTo(-width / 2, HEIGHT);
  facade.lineTo(width / 2, HEIGHT);
  facade.lineTo(width / 2, 0);
  facade.lineTo(ARCH, 0);
  openingPath(facade, ARCH, false);
  facade.closePath();
  const front = new THREE.ShapeGeometry(facade, 20);
  mesh(shell, front, galleryFacade);
  const surround = new THREE.Shape();
  surround.moveTo(-ARCH - 0.19, 0);
  openingPath(surround, ARCH + 0.19, true);
  surround.lineTo(ARCH, 0);
  openingPath(surround, ARCH, false);
  surround.closePath();
  const stone = surface("stone", 0.72, 0.72, 0xa09281);
  stone.emissive.setHex(0x61534a);
  stone.emissiveIntensity = 0.12;
  mesh(shell, new THREE.ExtrudeGeometry(surround, { depth: 0.27, bevelEnabled: true, bevelThickness: 0.018, bevelSize: 0.013, bevelSegments: 1, curveSegments: 24 }), stone, 0, 0, -0.135);
  const name = LABEL[genre] || genre;
  const sign = labelTexture([[name, name.length > 14 ? 38 : 51, 66], [`${rated} valutati`, 23, 118]], 512, 160, "#44382c", "#d0bca0");
  mountSign(shell, sign, 1.98, 0.40, 3.09, 0.155);
  mesh(shell, new THREE.BoxGeometry(2 * ARCH, 0.015, 0.29), stone, 0, 0.007, 0);
  for (const side of [-1, 1]) {
    const x = side * 1.43;
    const metal = new THREE.MeshStandardMaterial({ color: 0x5d4934, metalness: 0.64, roughness: 0.46 });
    const glass = new THREE.MeshStandardMaterial({ color: 0xeed5b1, emissive: 0xffbe81, emissiveIntensity: 0.58, roughness: 0.42 });
    mesh(shell, new THREE.BoxGeometry(0.13, 0.33, 0.04), metal, x, 2.18, 0.02);
    mesh(shell, new THREE.BoxGeometry(0.055, 0.06, 0.19), metal, x, 2.12, 0.12);
    mesh(shell, new THREE.CylinderGeometry(0.07, 0.105, 0.19, 12), glass, x, 2.26, 0.19);
    mesh(shell, new THREE.CylinderGeometry(0.1, 0.10, 0.024, 12), metal, x, 2.155, 0.19);
    gallery.lights.push({ position: shell.localToWorld(new THREE.Vector3(x, 2.23, 0.43)), color: 0xffdbb5, power: 12, exterior: true });
  }
}

const galleryFacade = surface("plaster", 1 / 2.2, 1 / 1.9, 0xa29683);
galleryFacade.emissiveMap = galleryFacade.map;
galleryFacade.emissive.setHex(0x9b8875);
galleryFacade.emissiveIntensity = 0.20;
galleryFacade.side = THREE.DoubleSide;
const darkWood = new THREE.MeshStandardMaterial({ color: 0x482e21, roughness: 0.57, metalness: 0.04 });
const brass = new THREE.MeshStandardMaterial({ color: 0x92764f, metalness: 0.63, roughness: 0.52 });

const contactShadow = new THREE.MeshBasicMaterial({
  map: canvasTex(64, 64, (g) => {
    const shade = g.createRadialGradient(32, 32, 5, 32, 32, 32);
    shade.addColorStop(0, "rgba(20, 14, 10, .66)");
    shade.addColorStop(1, "rgba(20, 14, 10, 0)");
    g.fillStyle = shade;
    g.fillRect(0, 0, 64, 64);
  }),
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1
});

function addContactShadow(shell, x, z, width, depth) {
  mesh(shell, new THREE.PlaneGeometry(width, depth), contactShadow, x, 0.005, z, 0, -Math.PI / 2);
}

function mountSign(shell, sign, w, h, y, z, ry = 0) {
  mesh(shell, new THREE.BoxGeometry(w + 0.05, h + 0.05, 0.057), darkWood, 0, y, z, ry);
  const ink = new THREE.MeshStandardMaterial({ map: sign, emissiveMap: sign, emissive: 0xffffff, emissiveIntensity: 0.42, roughness: 0.72 });
  mesh(shell, new THREE.PlaneGeometry(w, h), ink, 0, y, z + Math.cos(ry) * 0.03, ry);

}

function buildHub(list) {
  const count = Math.max(5, list.length);
  const angle = Math.PI / count;
  const halfFace = Math.max(4.35, ...list.map(({ width }) => width)) / 2 + 0.23;
  hubRadius = halfFace / Math.tan(angle);
  const outline = new THREE.Shape();
  const roof = surface("plaster", 1 / 2.55, 1 / 2.55, 0x8d7e72);
  roof.side = THREE.DoubleSide;
  roof.emissive.setHex(0x62574f);
  roof.emissiveIntensity = 0.14;
  const floor = surface("floorA", 1 / 2.8, 1 / 2.8, 0xb0a698, 0.72);
  const bronze = new THREE.MeshStandardMaterial({ color: 0x84654b, metalness: 0.52, roughness: 0.56, emissive: 0x654f39, emissiveIntensity: 0.12 });
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
      const gallery = { ...slot, ...entry, shell, theme: themeOf(entry.genre), page: 0, exhibits: new Map(), boxes: [], lights: [] };
      slot.gallery = gallery;
      galleries.push(gallery);
      archFront(gallery);
      buildRoom(gallery);
      for (const side of [-1, 1]) {
        const offset = side * halfFace * 0.91;
        const xx = x + cos * offset - sin * 0.07;
        const zz = z + sin * offset + cos * 0.07;
        mesh(hub, new THREE.BoxGeometry(0.26, HEIGHT, 0.18), darkWood, xx, HEIGHT / 2, zz, -a);
        for (const y of [0.135, HEIGHT - 0.085]) mesh(hub, new THREE.BoxGeometry(0.33, 0.16, 0.24), darkWood, xx, y, zz, -a);
      }
    }
    const roomHalf = (entry?.width || 0) / 2;
    const panels = entry ? [-1, 1].map((side) => [side * (roomHalf + halfFace) / 2, halfFace - roomHalf]) : [[0, 2 * halfFace]];
    for (const y of [0.087, HEIGHT - 0.061]) {
      const segments = entry && y < 1 ? [[-1, halfFace - ARCH - 0.23], [1, halfFace - ARCH - 0.23]] : [[0, 2 * halfFace]];
      for (const [side, length] of segments) {
        const offset = side * (halfFace - length / 2);
        mesh(hub, new THREE.BoxGeometry(length, 0.13, 0.08), darkWood,
          x + cos * offset - sin * 0.037, y, z + sin * offset + cos * 0.037, -a);
      }
    }
    for (const [offset, width] of panels) {
      const panel = new THREE.PlaneGeometry(width, HEIGHT);
      const uv = panel.attributes.uv;
      for (let j = 0; j < uv.count; j++) uv.setXY(j, (uv.getX(j) - 0.5) * width + offset, uv.getY(j) * HEIGHT);
      mesh(hub, panel, galleryFacade, x + cos * offset, HEIGHT / 2, z + sin * offset, -a);
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
  for (const r of [1.35, 1.51]) {
    mesh(hub, new THREE.RingGeometry(r - 0.018, r, 80), brass, 0, 0.009, 0, 0, -Math.PI / 2);
  }
}

// Targhetta sotto la locandina: voto tuo (oro se alto) oppure voto TMDb
function plaqueTexture(f) {
  const mine = Number(f.vote) || 0, tm = Number(f.vote_average) || 0;
  const v = mine || tm, label = mine ? "VOTO" : (tm ? "TMDB" : "—");
  const col = "#4b3a2c";
  return canvasTex(256, 80, (g, w, h) => {
    g.fillStyle = "#cdbb9e"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col; g.globalAlpha = 0.7; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6); g.globalAlpha = 1;
    g.fillStyle = col; g.textBaseline = "middle"; g.textAlign = "left";
    g.font = "800 40px Outfit, sans-serif"; g.fillText(v ? (mine ? String(mine) : tm.toFixed(1)) : "—", 22, 42);
    g.textAlign = "right"; g.font = "700 20px Outfit, sans-serif"; g.letterSpacing = "2px"; g.fillText(label, w - 18, 42);
  });
}

function buildRoom(gallery) {
  const { shell, theme, width, depth, panels } = gallery;
  const { wall: finish, floor: flooring } = theme;
  const panelColor = new THREE.Color(finish.tint ?? 0xaaaaaa).lerp(wallFinish, 0.60);
  const wallSpec = { ...finish, tint: panelColor };
  const wall = specMat(wallSpec, depth / finish.tile[0], HEIGHT / finish.tile[1]);
  const rear = specMat(wallSpec, width / finish.tile[0], HEIGHT / finish.tile[1]);
  for (const material of [wall, rear]) {
    material.emissive.setHex(0x928374);
    material.emissiveMap = material.map;
    material.emissiveIntensity = 0.16;
  }
  const floorColor = new THREE.Color(flooring.tint ?? 0xaaaaaa).lerp(wallFinish, 0.52);
  const floor = specMat({ ...flooring, tint: floorColor }, width / flooring.tile[0], depth / flooring.tile[1]);
  const ceilColor = new THREE.Color(theme.ceil).lerp(new THREE.Color(0x998a7f), 0.55);
  const ceiling = surface("plaster", width / 2.2, depth / 2.2, ceilColor);
  const wainscot = surface("planks", depth / 2.1, 0.6, 0x6d503d);
  const rearWainscot = surface("planks", width / 2.1, 0.6, 0x6d503d);
  for (const side of [-1, 1]) {
    const x = side * width / 2;
    mesh(shell, new THREE.PlaneGeometry(depth, HEIGHT), wall, x, HEIGHT / 2, -depth / 2, -side * Math.PI / 2);
    mesh(shell, new THREE.PlaneGeometry(depth, 0.65), wainscot, x - side * 0.018, 0.325, -depth / 2, -side * Math.PI / 2);
    for (const y of [0.083, 0.65, 3.18]) mesh(shell, new THREE.BoxGeometry(0.072, 0.068, depth), darkWood, x - side * 0.033, y, -depth / 2);
  }
  mesh(shell, new THREE.PlaneGeometry(width, HEIGHT), rear, 0, HEIGHT / 2, -depth);
  mesh(shell, new THREE.PlaneGeometry(width, 0.65), rearWainscot, 0, 0.325, -depth + 0.018);
  mesh(shell, new THREE.PlaneGeometry(width, depth), floor, 0, 0, -depth / 2, 0, -Math.PI / 2);
  mesh(shell, new THREE.PlaneGeometry(width, depth), ceiling, 0, HEIGHT, -depth / 2, 0, Math.PI / 2);
  for (const y of [0.083, 0.65, 3.18]) mesh(shell, new THREE.BoxGeometry(width, 0.068, 0.072), darkWood, 0, y, -depth + 0.033);
  mountSign(shell, labelTexture([["Atrio", 56, 92]], 512, 160, "#473a2c", "#cdbb9e"), 0.84, 0.22, 3.07, -0.035, Math.PI);

  const lampCount = Math.max(1, Math.round(depth / 3.6));
  const glass = new THREE.MeshStandardMaterial({ color: 0xf5dfbf, emissive: 0xffcd94, emissiveIntensity: 0.68, roughness: 0.38 });
  for (let i = 0; i < lampCount; i++) {
    const z = -depth * (i + 0.5) / lampCount;
    mesh(shell, new THREE.CylinderGeometry(0.12, 0.12, 0.035, 12), brass, 0, HEIGHT - 0.019, z);
    mesh(shell, new THREE.CylinderGeometry(0.018, 0.018, 0.27, 8), brass, 0, HEIGHT - 0.16, z);
    mesh(shell, new THREE.CylinderGeometry(0.15, 0.31, 0.118, 16), brass, 0, HEIGHT - 0.35, z);
    mesh(shell, new THREE.SphereGeometry(0.112, 12, 8), glass, 0, HEIGHT - 0.42, z);
    gallery.lights.push({
      position: shell.localToWorld(new THREE.Vector3(0, 2.79, z)),
      color: gallery.genre === "Horror" ? 0xffca99 : 0xffdebd,
      power: gallery.genre === "Horror" ? 16 : 23, exterior: false
    });
  }
  const displayWood = panels.length ? surface("rawwood", 1.7, 1.3, 0x765f4b) : null;
  for (const { x, z } of panels) {
    const panelWidth = 3 * FRAME_SPACING;
    mesh(shell, new THREE.BoxGeometry(panelWidth, 1.91, 0.12), displayWood, x, 1.66, z, Math.PI / 2);
    for (const offset of [-panelWidth / 2 + 0.19, panelWidth / 2 - 0.19]) {
      mesh(shell, new THREE.BoxGeometry(0.12, 0.75, 0.11), darkWood, x, 0.375, z + offset);
      mesh(shell, new THREE.BoxGeometry(0.6, 0.07, 0.28), darkWood, x, 0.035, z + offset);
    }
    gallery.boxes.push({ x, z, halfWidth: 0.3, halfDepth: panelWidth / 2 });
    addContactShadow(shell, x, z, 1.2, panelWidth + 0.8);
  }
}

const exhibitsInMemory = new Map();
const MAX_EXHIBITS = 6;
function showExhibit(gallery) {
  let exhibit = gallery.exhibits.get(gallery.page);
  if (!exhibit) {
    const group = new THREE.Group(), posters = [];
    exhibit = { group, posters, gallery, page: gallery.page, disposed: false };
    gallery.exhibits.set(gallery.page, exhibit);
    const capacity = gallery.displays.length;
    gallery.films.slice(gallery.page * capacity, (gallery.page + 1) * capacity).forEach((film, i) => {
      const [x, z, ry] = gallery.displays[i];
      const frame = new THREE.Group();
      frame.position.set(x, 1.79, z);
      frame.rotation.y = ry;
      group.add(frame);
      const frameMat = darkWood;
      const moulding = mesh(frame, new THREE.BoxGeometry(1.12, 1.62, 0.044), frameMat);
      moulding.userData.keepMaterial = true;
      const fallback = placeholderPoster(film);
      const mat = new THREE.MeshStandardMaterial({ map: fallback, emissiveMap: fallback, emissive: 0xffffff, emissiveIntensity: 0.26, roughness: 0.64 });
      const artwork = mesh(frame, new THREE.PlaneGeometry(1.0, 1.5), mat, 0, 0, 0.024);
      artwork.userData.film = film;
      const plaque = plaqueTexture(film);
      mesh(frame, new THREE.PlaneGeometry(0.62, 0.19), new THREE.MeshBasicMaterial({ map: plaque }), 0, -0.97, 0.025);
      const poster = { artwork, film, size: 0 };
      posters.push(poster);

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
  if (y === 0) {
    const radius = Math.hypot(model.size.x, model.size.z) * scale / 2;
    gallery.boxes.push({ x, z, radius });
    addContactShadow(gallery.shell, x, z, radius * 3.3, radius * 2.6);
  }
  if (base) await placeProp(gallery, name, x, z, ry, 0.85, model.size.y * scale);
}

async function dress(gallery) {
  const cfg = PROPS[gallery.genre];
  if (!cfg) return;
  const { width, depth } = gallery;
  const side = width / 2 - 0.52;
  const placements = [
    [cfg.entrance[0], -side, -0.52, Math.PI / 7, 2.15],
    [cfg.entrance[1], side, -0.52, -Math.PI / 7, 2.15],
    [cfg.end[0], -side, -depth + 0.55, Math.PI / 5, 1.28],
    [cfg.end[1], side, -depth + 0.55, -Math.PI / 5, 1.28],
    [cfg.floor[0], -side, -depth * 0.42, Math.PI / 2, 0.52],
    [cfg.floor[1], side, -depth * 0.62, -Math.PI / 2, 0.52],
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
  const count = active?.pages || 0;
  $("exhibits").hidden = count <= 1;
  if (count <= 1) return;
  $("exhibit-count").textContent = `${active.page + 1} / ${count}`;
  $("previous").disabled = active.page === 0;
  $("next").disabled = active.page + 1 === count;
}

function changePage(step) {
  if (!active || !ctl.enabled) return;
  const page = active.page + step;
  if (page < 0 || page >= active.pages) return;
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
    return Math.abs(lx) < g.width / 2 && lz < 0 && lz > -g.depth;
  }) || null;
}

function walkable(x, z, ox, oz) {
  const outside = slots.find((slot) => localZ(slot, x, z) < CLEARANCE);
  if (!outside) return true;
  const gallery = roomAt(x, z) || outside.gallery;
  if (!gallery) return false;
  const lx = localX(gallery, x, z), lz = localZ(gallery, x, z);
  if (Math.abs(lz) < CLEARANCE) return Math.abs(lx) < ARCH - CLEARANCE;
  if (lz >= 0 || lz < -gallery.depth + CLEARANCE || Math.abs(lx) > gallery.width / 2 - CLEARANCE) return false;
  const x0 = localX(gallery, ox, oz), z0 = localZ(gallery, ox, oz);
  return !gallery.boxes.some((b) => {
    if (b.halfWidth) {
      return Math.abs(lx - b.x) < b.halfWidth + CLEARANCE && Math.abs(lz - b.z) < b.halfDepth + CLEARANCE;
    }
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
  for (const g of [active, ...adjacent.map(({ g }) => g), galleries[0]]) {
    if (!g?.display) continue;
    const lx = localX(g, x, z), lz = localZ(g, x, z);
    const isActive = g === active;
    for (const p of g.display.posters) {
      const pos = p.artwork.parent.position;
      const distance = Math.hypot(lx - pos.x, lz - pos.z);
      if (!p.preview && (isActive ? distance < 10.5 : (distance < 9 || galleries[0] === g && Math.abs(pos.x) < 1.4))) {
        p.preview = true;
        loadPoster(g.display, p, 185);
      }
      if (isActive && !p.upgrading && distance < 2.65) {
        p.upgrading = true;
        loadPoster(g.display, p, 342);
      }
    }
  }
}

const hubLight = { position: new THREE.Vector3(0, 2.63, 0), color: 0xffddb9, power: 45 };
scene.fog.color.setHex(ambient.fog[0]);
scene.fog.density = ambient.fog[1];
scene.background.copy(scene.fog.color);
hemi.color.setHex(ambient.sky);
hemi.groundColor.setHex(ambient.ground);
hemi.intensity = 0.99;

function updateLighting() {
  const nearby = [];
  for (const g of galleries) {
    for (const fixture of g.lights) {
      const d = fixture.position.distanceToSquared(camera.position);
      if (d < 110 && (fixture.exterior || g === active || d < 35)) {
        nearby.push({ fixture, d });
      }
    }
  }
  nearby.push({ fixture: hubLight, d: hubLight.position.distanceToSquared(camera.position) });
  nearby.sort((a, b) => a.d - b.d);
  lamps.forEach((light, i) => {
    const entry = nearby[i];
    if (!entry) { light.intensity = 0; return; }
    const { fixture, d } = entry;
    light.position.copy(fixture.position);
    light.color.setHex(fixture.color);
    light.intensity = fixture.power * (1 - THREE.MathUtils.smoothstep(d, 48, 110));
  });
}

// ─── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), postT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
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
  updateLighting();
  renderer.render(scene, camera);
}

// ─── avvio ───────────────────────────────────────────────────────────────────
(async function boot() {
  if (!renderer) return;
  let db = { seen: [], watchlist: [] };
  try { db = (await Promise.race([loadDB(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))])) || db; } catch (e) { console.warn("loadDB", e); }
  const by = groupByGenre(db);
  if (q.has("demo")) Object.keys(THEMES).forEach((genre, i) => {
    by.set(genre, demoFilms([72, 37, 22, 13, 8, 4][i % 6], genre));
  });
  // dal più bello al più brutto: voto tuo, poi voto TMDb
  const list = [...by.entries()].filter(([, a]) => a.length).sort((a, b) => b[1].length - a[1].length);
  buildHub(list.map(([genre, films]) => ({
    genre, films: films.slice().sort((x, y) => rank(y) - rank(x)), ...displayLayout(films)
  })));
  moveCamera(0, 0);
  $("where").textContent = "Atrio";
  const requested = galleries.find((g) => g.genre === q.get("room"));
  if (requested) {
    moveCamera(requested.x + requested.sin * requested.depth / 2, requested.z - requested.cos * requested.depth / 2);
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
