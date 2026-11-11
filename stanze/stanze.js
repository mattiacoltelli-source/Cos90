// ─── stanze/stanze.js ────────────────────────────────────────────────────────
// Modalità "Stanze": un atrio circolare con una porta per genere, e dietro ogni
// porta una stanza a tema piena delle locandine della libreria. Pagina a sé
// (stanze.html): non tocca l'app. I dati sono quelli di sempre (loadDB).
// Per ora: atrio + stanza Horror (le altre porte sono segnaposto).
import * as THREE from "three";
import { loadDB } from "../storage.js?v=0f179bd";
import { posterUrl, titleOf, yearOf, extractDirector } from "../cine-core.js?v=0f179bd";

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

// ─── dati ────────────────────────────────────────────────────────────────────
function demoFilms(n, genre = "Horror") {
  const t = genre === "Fantascienza" ? ["Orbita", "Andromeda", "Il Sintetico", "Ultima Frontiera", "Segnale", "Nova", "Cyber Alba", "Terraformer", "Oltre il Vuoto", "Zero G", "Replicante", "Eclisse", "Il Cacciatore di Stelle", "Rift"] : ["Il Rituale", "Notte Nera", "La Casa in Fondo", "Sotto la Pelle", "Ultimo Piano", "Eco", "Nebbia", "Il Visitatore", "Sette Porte", "Cripta", "Lo Specchio", "Respiro", "Fuori Orario", "Il Custode"];
  return Array.from({ length: n }, (_, i) => ({ id: 9000 + i, media_type: "movie", title: t[i % t.length], year: 1980 + i * 2, vote: [9, 8, 7, 8.5, 6, 5, 7.5, 4, 9.5, 6.5, 3, 8, 7, 5.5][i % 14], genre_names: [genre], director: "Regista " + (i + 1), cast: ["Attore A", "Attrice B", "Attore C"], poster_path: "" }));
}
const GENRE_ALIAS = { "Sci-Fi & Fantasy": "Fantascienza", Dramma: "Drama", "Azione & Avventura": "Azione" };
function groupByGenre(db) {
  const seen = new Set(), all = [];
  [...(db.seen || []), ...(db.watchlist || [])].forEach((f) => {
    const k = `${f.media_type}|${f.id}`;
    if (!seen.has(k)) { seen.add(k); all.push(f); }
  });
  const by = new Map();
  all.forEach((f) => new Set((f.genre_names || []).map((g) => GENRE_ALIAS[g] || g)).forEach((g) => { if (!by.has(g)) by.set(g, []); by.get(g).push(f); }));
  return by;
}
const rank = (f) => (Number(f.vote) || 0) * 1000 + (Number(f.vote_average) || 0) * 10 + (Number(f.popularity) || 0) / 1000;

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
const camera = new THREE.PerspectiveCamera(66, 1, 0.05, 60);
camera.rotation.order = "YXZ";
scene.add(camera);
function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.fov = camera.aspect < 0.8 ? 68 : 56;
  camera.updateProjectionMatrix();
}
addEventListener("resize", resize); resize();

const hemi = new THREE.HemisphereLight(0x1a2230, 0x0a0806, 0.5);
const torch = new THREE.SpotLight(0xfff1d6, 30, 22, 0.55, 0.9, 1.8);
torch.position.set(0.12, -0.1, 0); torch.target.position.set(0, 0, -4);
camera.add(torch, torch.target);
const lamp = new THREE.PointLight(0xffb070, 0, 12, 1.8);
scene.add(hemi, lamp);

const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin("anonymous");
const aniso = Math.min(4, renderer.capabilities.getMaxAnisotropy());
function tiled(url, srgb, rx, ry) {
  const t = texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry); t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function surface(name, rx, ry, tint, rough = 0.9) {
  return new THREE.MeshStandardMaterial({ map: tiled(`stanze/tex/${name}_c.jpg`, true, rx, ry), normalMap: tiled(`stanze/tex/${name}_n.jpg`, false, rx, ry), color: tint, roughness: rough });
}
function labelTexture(lines, w = 512, h = 160, color = "#d8d2c8") {
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d");
  g.fillStyle = "#0b0908"; g.fillRect(0, 0, w, h);
  g.strokeStyle = "#ffffff18"; g.strokeRect(6, 6, w - 12, h - 12);
  g.fillStyle = color; g.textAlign = "center"; g.textBaseline = "middle";
  lines.forEach(([txt, size, y, spacing]) => { g.font = `800 ${size}px Outfit, sans-serif`; g.letterSpacing = spacing || "0px"; g.fillText(txt, w / 2, y); });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  return t;
}
function wrapTitle(g, txt, maxW) {
  const words = txt.split(" "), rows = []; let row = "";
  words.forEach((w) => { const t = row ? row + " " + w : w; if (g.measureText(t).width > maxW && row) { rows.push(row); row = w; } else row = t; });
  rows.push(row); return rows.slice(0, 4);
}
function placeholderPoster(film) {
  const c = document.createElement("canvas"); c.width = 200; c.height = 300;
  const g = c.getContext("2d");
  g.fillStyle = "#15100e"; g.fillRect(0, 0, 200, 300);
  g.strokeStyle = "#7a1c1c"; g.lineWidth = 3; g.strokeRect(10, 10, 180, 280);
  g.fillStyle = "#d8d2c8"; g.textAlign = "center"; g.font = "800 24px Outfit, sans-serif";
  wrapTitle(g, titleOf(film), 160).forEach((r, i) => g.fillText(r, 100, 120 + i * 30));
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ─── stanze (gruppi) ─────────────────────────────────────────────────────────
const hub = new THREE.Group();
const room = new THREE.Group();
scene.add(hub, room);
const doors = [];           // {genre, x, z, color, group}
const posters = [];         // {mesh, film, z, loaded}
const HUB_R = 4.6;
const GENRE_COLOR = { Horror: 0xb02020, Fantascienza: 0x2ab8ff, Commedia: 0xf0b020, Drama: 0x9a6ad8, Thriller: 0x3aa07a, Azione: 0xe0701c, Romance: 0xe05a8a, Fantasy: 0x6ad0c0, Animazione: 0x70c040, Crime: 0x888888 };
// Stanze già disegnate: stile della porta, della stanza e luci. Le altre porte restano segnaposto.
const THEMES = {
  Horror: { style: "horror", fog: 0x030102, density: 0.075, hemi: 0.5, lamp: 0xff6a3a, lampI: 9, torch: 34, flicker: true },
  Fantascienza: { style: "scifi", fog: 0x03080d, density: 0.04, hemi: 0.9, lamp: 0x7fd8ff, lampI: 10, torch: 12, flicker: false },
};
const hex = (n) => "#" + new THREE.Color(n).getHexString();
function canvasTex(w, h, draw, repeat) {
  const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}
function rnd(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

// Texture delle porte, disegnate a mano su canvas (nessun file in più)
function doorTexture(style, color) {
  return canvasTex(256, 512, (g, w, h) => {
    const r = rnd(7), acc = hex(color);
    if (style === "horror") {
      g.fillStyle = "#24150f"; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 43) { g.fillStyle = "#150b07"; g.fillRect(x, 0, 3, h); g.fillStyle = `rgba(255,200,150,${0.03 + r() * 0.05})`; g.fillRect(x + 4, 0, 14, h); }
      for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(0,0,0,${r() * 0.25})`; g.fillRect(r() * w, r() * h, 2 + r() * 3, 20 + r() * 80); }
      g.fillStyle = "#0e0e0e"; [90, 400].forEach((y) => { g.fillRect(0, y, w, 22); for (let x = 16; x < w; x += 56) { g.fillStyle = "#3a3a3a"; g.beginPath(); g.arc(x, y + 11, 4, 0, 7); g.fill(); g.fillStyle = "#0e0e0e"; } });
      g.strokeStyle = "#5a4a34"; g.lineWidth = 6; g.beginPath(); g.arc(w - 50, h * 0.52, 14, 0, 7); g.stroke();
      const gr = g.createLinearGradient(0, h, 0, h * 0.55); gr.addColorStop(0, "rgba(180,10,10,.55)"); gr.addColorStop(1, "rgba(180,10,10,0)"); g.fillStyle = gr; g.fillRect(0, h * 0.55, w, h * 0.45);
    } else if (style === "scifi") {
      g.fillStyle = "#1c2630"; g.fillRect(0, 0, w, h);
      for (let y = 30; y < h; y += 52) { g.fillStyle = "#121a22"; g.fillRect(0, y, w, 4); g.fillStyle = "rgba(255,255,255,.04)"; g.fillRect(0, y + 4, w, 8); }
      g.fillStyle = "#06090c"; g.fillRect(w / 2 - 3, 0, 6, h);                                  // fessura centrale delle ante
      g.fillStyle = acc; g.fillRect(8, 0, 5, h); g.fillRect(w - 13, 0, 5, h);                   // barre di luce
      g.fillStyle = "#0a1016"; g.fillRect(w / 2 + 20, h * 0.5 - 24, 30, 48); g.fillStyle = acc; g.fillRect(w / 2 + 26, h * 0.5 - 14, 18, 6); g.fillRect(w / 2 + 26, h * 0.5 + 2, 18, 6);
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, "rgba(120,220,255,.12)"); gr.addColorStop(1, "rgba(0,0,0,.3)"); g.fillStyle = gr; g.fillRect(0, 0, w, h);
    } else {
      g.fillStyle = "#171513"; g.fillRect(0, 0, w, h);
      g.fillStyle = "#0e0d0c"; g.fillRect(26, 30, w - 52, h * 0.38); g.fillRect(26, h * 0.5, w - 52, h * 0.42);
      g.fillStyle = acc; g.globalAlpha = 0.5; g.fillRect(0, 0, w, 8); g.globalAlpha = 1;
      g.fillStyle = "#8a7444"; g.beginPath(); g.arc(w - 40, h * 0.52, 9, 0, 7); g.fill();
    }
  });
}

function buildDoor(name, count, color, a) {
  const th = THEMES[name], style = th ? th.style : "plain";
  const g = new THREE.Group();
  g.position.set(Math.sin(a) * (HUB_R - 0.02), 0, -Math.cos(a) * (HUB_R - 0.02));
  g.rotation.y = -a;   // il lato +z guarda il centro
  const stone = new THREE.MeshStandardMaterial({ color: style === "scifi" ? 0x141b22 : 0x1d1a17, roughness: 0.85, emissive: style === "scifi" ? color : 0x000000, emissiveIntensity: 0.05 });
  const box = (w, h, d, x, y, z, m = stone) => { const b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); b.position.set(x, y, z); g.add(b); return b; };
  box(0.22, 2.62, 0.34, -0.74, 1.31, 0.17); box(0.22, 2.62, 0.34, 0.74, 1.31, 0.17); box(1.7, 0.22, 0.34, 0, 2.63, 0.17);   // stipiti e architrave
  box(1.26, 2.4, 0.02, 0, 1.2, 0.01, new THREE.MeshBasicMaterial({ color: 0x000000 }));                                      // vano buio
  const door = new THREE.Mesh(new THREE.PlaneGeometry(1.26, 2.4), new THREE.MeshStandardMaterial({ map: doorTexture(style, color), roughness: 0.7, metalness: style === "scifi" ? 0.35 : 0, emissive: 0xffffff, emissiveIntensity: 0.28 }));
  door.material.emissiveMap = door.material.map; door.position.set(0, 1.2, 0.07); g.add(door);
  // targa sopra la porta
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.4), new THREE.MeshBasicMaterial({ map: labelTexture([[name.toUpperCase(), 46, 62, "5px"], [`${count} titoli`, 24, 122]], 512, 160, hex(new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.45))), fog: false }));
  sign.position.set(0, 3.0, 0.2); g.add(sign);
  // luce che esce da sotto/attorno alla porta
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.05), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
  strip.rotation.x = -Math.PI / 2; strip.position.set(0, 0.015, 0.45); g.add(strip);
  const glow = new THREE.PointLight(color, 1.1, 3.4, 2); glow.position.set(0, 1.6, 0.9); g.add(glow);
  hub.add(g);
  doors.push({ genre: name, color, group: g, x: Math.sin(a) * HUB_R, z: -Math.cos(a) * HUB_R, count });
}
function buildHub(genres) {
  hub.clear(); doors.length = 0;
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R, 3.4, 48, 1, true), surface("brick", 14, 2, 0x4a4540));
  wall.position.y = 1.7; wall.material.side = THREE.BackSide; hub.add(wall);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(HUB_R, 48), surface("floorA", 5, 5, 0x77736a, 0.7));
  floor.rotation.x = -Math.PI / 2; hub.add(floor);
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(HUB_R, 48), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.4; hub.add(ceil);
  genres.forEach(({ name, count }, i) => buildDoor(name, count, GENRE_COLOR[name] || 0x777777, (i / genres.length) * Math.PI * 2));
}

// Targhetta sotto la locandina: voto tuo (oro se alto) oppure voto TMDb
function plaqueTexture(f, theme) {
  const mine = Number(f.vote) || 0, tm = Number(f.vote_average) || 0;
  const v = mine || tm, label = mine ? "IL TUO VOTO" : (tm ? "TMDB" : "—");
  const col = !v ? "#8a8278" : v >= 8 ? "#f2c14e" : v >= 6.5 ? "#d8d2c8" : "#c0504a";
  return canvasTex(256, 80, (g, w, h) => {
    g.fillStyle = theme === "scifi" ? "#0a141b" : "#14100d"; g.fillRect(0, 0, w, h);
    g.strokeStyle = col; g.globalAlpha = 0.7; g.lineWidth = 3; g.strokeRect(3, 3, w - 6, h - 6); g.globalAlpha = 1;
    g.fillStyle = col; g.textBaseline = "middle"; g.textAlign = "left";
    g.font = "800 40px Outfit, sans-serif"; g.fillText(v ? (mine ? String(mine) : tm.toFixed(1)) : "—", 22, 42);
    g.textAlign = "right"; g.font = "700 20px Outfit, sans-serif"; g.letterSpacing = "2px"; g.fillText(label, w - 18, 42);
  });
}

function buildRoom(genre, films) {
  const th = THEMES[genre], scifi = th.style === "scifi";
  room.clear(); posters.length = 0;
  const step = 2.4, start = 7;
  const L = start + Math.ceil(films.length / 2) * step + 4;
  room.userData.L = L; room.userData.genre = genre; room.userData.theme = th;
  const HW = 1.9, H = 3.1, cz = -L / 2 + 1;
  const mk = (geo, mat, x, y, z, ry = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); room.add(m); return m; };
  let wallMat, floorMat, ceilMat;
  if (scifi) {
    const panel = canvasTex(256, 256, (g, w, h) => {
      g.fillStyle = "#1a2530"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#0c131a"; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4); g.strokeRect(20, 20, w - 40, h - 40);
      g.fillStyle = "rgba(255,255,255,.04)"; g.fillRect(22, 22, w - 44, 40);
      g.fillStyle = "#3a4a5a"; [[10, 10], [w - 10, 10], [10, h - 10], [w - 10, h - 10]].forEach(([x, y]) => { g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill(); });
    }, [L / 2.4, H / 2.4]);
    wallMat = new THREE.MeshStandardMaterial({ map: panel, roughness: 0.45, metalness: 0.35 });
    floorMat = new THREE.MeshStandardMaterial({ map: canvasTex(256, 256, (g, w, h) => { g.fillStyle = "#0d1319"; g.fillRect(0, 0, w, h); g.strokeStyle = "#2a8cc0"; g.globalAlpha = 0.5; g.lineWidth = 2; g.strokeRect(1, 1, w - 2, h - 2); g.globalAlpha = 1; }, [HW, L / 2]), roughness: 0.3, metalness: 0.4 });
    ceilMat = new THREE.MeshStandardMaterial({ color: 0x0c1218, roughness: 0.6 });
  } else {
    wallMat = surface("brick", L / 2.1, H / 1.05, 0x5a4a44);
    floorMat = surface("floorA", 2.4, L / 1.6, 0x5a5650, 0.65);
    ceilMat = new THREE.MeshStandardMaterial({ color: 0x080808 });
  }
  mk(new THREE.PlaneGeometry(L, H), wallMat, -HW, H / 2, cz, Math.PI / 2);
  mk(new THREE.PlaneGeometry(L, H), wallMat, HW, H / 2, cz, -Math.PI / 2);
  mk(new THREE.PlaneGeometry(HW * 2, L), floorMat, 0, 0, cz, 0, -Math.PI / 2);
  mk(new THREE.PlaneGeometry(HW * 2, L), ceilMat, 0, H, cz, 0, Math.PI / 2);
  const dark = new THREE.MeshStandardMaterial({ color: scifi ? 0x0a1218 : 0x050505 });
  mk(new THREE.PlaneGeometry(HW * 2, H), dark, 0, H / 2, -L + 1, 0);
  mk(new THREE.PlaneGeometry(HW * 2, H), dark, 0, H / 2, 1, Math.PI);
  // porta di ritorno (dietro di te)
  mk(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: scifi ? 0x0e2a38 : 0x1a0606 }), 0, 1.1, 0.98, Math.PI);
  mk(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: labelTexture([["ATRIO", 44, 80, "8px"]]), fog: false }), 0, 2.5, 0.97, Math.PI);
  // luci a soffitto
  if (scifi) {
    const strip = new THREE.MeshBasicMaterial({ color: 0x4fd0ff });
    [-1, 1].forEach((s) => mk(new THREE.BoxGeometry(0.06, 0.04, L), strip, s * (HW - 0.12), H - 0.04, cz));
    [-1, 1].forEach((s) => mk(new THREE.BoxGeometry(0.05, 0.05, L), strip, s * (HW - 0.01), 0.12, cz));
  }
  for (let z = -3; z > -L + 2; z -= step * 2) mk(scifi ? new THREE.BoxGeometry(0.9, 0.05, 0.5) : new THREE.BoxGeometry(0.5, 0.06, 0.12), new THREE.MeshBasicMaterial({ color: scifi ? 0xcff2ff : 0xff9060 }), 0, H - 0.05, z);
  // locandine + targhette
  films.forEach((film, i) => {
    const side = i % 2 ? 1 : -1, z = -start - Math.floor(i / 2) * step;
    const g = new THREE.Group();
    g.position.set(side * (HW - 0.03), 1.75, z); g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    g.add(new THREE.Mesh(new THREE.PlaneGeometry(1.12, 1.62), new THREE.MeshStandardMaterial({ color: scifi ? 0x0c1c26 : 0x0a0807, roughness: 0.5, emissive: scifi ? 0x2ab8ff : 0x000000, emissiveIntensity: scifi ? 0.5 : 0 })));
    const mat = new THREE.MeshStandardMaterial({ map: placeholderPoster(film), roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0.4 });
    mat.emissiveMap = mat.map;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), mat);
    p.position.z = 0.012; p.userData.film = film; g.add(p);
    const pl = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.19), new THREE.MeshStandardMaterial({ map: plaqueTexture(film, th.style), emissive: 0xffffff, emissiveIntensity: 0.55, roughness: 0.5 }));
    pl.material.emissiveMap = pl.material.map; pl.position.set(0, -0.99, 0.02); g.add(pl);
    room.add(g);
    posters.push({ mesh: p, film, z, loaded: false });
  });
  mk(new THREE.PlaneGeometry(3, 0.9), new THREE.MeshBasicMaterial({ map: labelTexture([[films.length ? "FINE" : "NESSUN FILM QUI", 38, 80, "5px"]], 512, 160, hex(GENRE_COLOR[genre] || 0x888888)), fog: false }), 0, 1.6, -L + 1.02);
}
function lazyLoadPosters(z) {
  posters.forEach((p) => {
    if (p.loaded || Math.abs(p.z - z) > 14) return;
    p.loaded = true;
    const url = posterUrl(p.film.poster_path, "w342");
    if (!url) return;
    texLoader.load(url, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = aniso; p.mesh.material.map = p.mesh.material.emissiveMap = t; p.mesh.material.needsUpdate = true; }, undefined, () => {});
  });
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
let sayT;
function say(text, ms = 4500) { const el = $("say"); el.textContent = text; el.style.opacity = 1; clearTimeout(sayT); sayT = setTimeout(() => { el.style.opacity = 0; }, ms); }
function fadeTo(fn) {
  if (state.busy) return; state.busy = true; ctl.enabled = false;
  const f = $("fade"); f.style.transition = "opacity .9s"; f.style.opacity = 1;
  setTimeout(() => { fn(); setTimeout(() => { f.style.opacity = 0; ctl.enabled = true; state.busy = false; }, 250); }, 950);
}
function enterHub(fromDoor) {
  state.where = "hub"; hub.visible = true; room.visible = false; $("back").hidden = true; $("where").textContent = "Atrio";
  scene.fog.color.setHex(0x020203); scene.fog.density = 0.07; scene.background.setHex(0x020203);
  hemi.color.setHex(0x1a2230); hemi.intensity = 0.55; lamp.color.setHex(0xffd8a0); lamp.position.set(0, 3, 0); lamp.intensity = 7; torch.intensity = 14;
  const d = doors.find((x) => x.genre === fromDoor);
  if (d) { camera.position.set(d.x * 0.45, 1.6, d.z * 0.45); yaw = Math.atan2(d.x, d.z); }
  else { camera.position.set(0, 1.6, 0); yaw = 0; }
  pitch = 0;
}
function enterRoom(genre) {
  const th = THEMES[genre];
  buildRoom(genre, state.rooms[genre] || []);
  state.where = "room"; hub.visible = false; room.visible = true; $("back").hidden = false; $("where").textContent = genre;
  scene.fog.color.setHex(th.fog); scene.fog.density = th.density; scene.background.setHex(th.fog);
  hemi.color.setHex(th.style === "scifi" ? 0x6aa8d0 : 0x1a2230); hemi.intensity = th.hemi; lamp.color.setHex(th.lamp); lamp.intensity = 0; torch.intensity = th.torch;
  camera.position.set(0, 1.6, 0); yaw = 0; pitch = 0;
  lazyLoadPosters(0);
}
$("back").onclick = () => fadeTo(() => enterHub(room.userData.genre));

// ─── loop ────────────────────────────────────────────────────────────────────
let last = performance.now(), tt = 0, nextBlink = 3;
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; tt += dt;
  if (ctl.enabled) {
    let x = ctl.mx, y = ctl.my; const k = ctl.keys;
    if (k.has("KeyW") || k.has("ArrowUp")) y -= 1; if (k.has("KeyS") || k.has("ArrowDown")) y += 1;
    if (k.has("KeyA")) x -= 1; if (k.has("KeyD")) x += 1;
    if (k.has("ArrowLeft")) yaw += 1.6 * dt; if (k.has("ArrowRight")) yaw -= 1.6 * dt;
    const m = Math.hypot(x, y); if (m > 1) { x /= m; y /= m; }
    const sp = 1.7 * dt, sy = Math.sin(yaw), cy = Math.cos(yaw);
    camera.position.x += (x * cy + y * sy) * sp; camera.position.z += (-x * sy + y * cy) * sp;
    if (state.where === "hub") {
      const r = Math.hypot(camera.position.x, camera.position.z), max = HUB_R - 0.45;
      if (r > max) { camera.position.x *= max / r; camera.position.z *= max / r; }
      for (const d of doors) if (Math.hypot(camera.position.x - d.x, camera.position.z - d.z) < 0.95) {
        if (THEMES[d.genre]) { camera.position.x *= 0.9; camera.position.z *= 0.9; fadeTo(() => enterRoom(d.genre)); }
        else { camera.position.x *= 0.85; camera.position.z *= 0.85; say(`${d.genre}: stanza in costruzione.`, 2500); }
        break;
      }
    } else {
      const L = room.userData.L;
      camera.position.x = Math.max(-1.45, Math.min(1.45, camera.position.x));
      camera.position.z = Math.max(-L + 1.6, Math.min(0.9, camera.position.z));
      if (camera.position.z > 0.55 && Math.abs(camera.position.x) < 0.7) fadeTo(() => enterHub(room.userData.genre));
      lazyLoadPosters(camera.position.z);
    }
  }
  camera.rotation.set(pitch, yaw, 0);
  // luce: la lampada più vicina, con sfarfallio da horror
  if (state.where === "room") {
    const th = room.userData.theme, z = camera.position.z, zl = -3 - Math.max(0, Math.round((-3 - z) / 4.8)) * 4.8;
    lamp.position.set(0, 2.75, zl);
    if (th.flicker) {
      nextBlink -= dt; if (nextBlink < 0) { nextBlink = 2 + Math.random() * 6; tt = -0.35; }
      const flick = tt < 0 ? (Math.random() < 0.5 ? 0 : 0.5) : 1;
      lamp.intensity = th.lampI * flick; torch.intensity = th.torch + 4 * Math.sin(tt * 3);
      if (tt < 0) tt += dt * 2;
    } else lamp.intensity = th.lampI;
  }
  renderer.render(scene, camera);
}

// ─── avvio ───────────────────────────────────────────────────────────────────
(async function boot() {
  let db = { seen: [], watchlist: [] };
  try { db = (await Promise.race([loadDB(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))])) || db; } catch (e) { console.warn("loadDB", e); }
  const by = groupByGenre(db);
  let demo = false;
  Object.keys(THEMES).forEach((g) => { if (q.has("demo") || !(by.get(g) || []).length) { by.set(g, demoFilms(14, g)); demo = true; } });
  if (demo) $("intro-msg").textContent = "Film di prova (genere senza titoli in libreria)";
  // dal più bello al più brutto: voto tuo, poi voto TMDb
  Object.keys(THEMES).forEach((g) => { state.rooms[g] = by.get(g).slice().sort((a, b) => rank(b) - rank(a)).slice(0, 60); });
  const others = [...by.entries()].filter(([g]) => !THEMES[g]).sort((a, b) => b[1].length - a[1].length).slice(0, 3);
  const names = [...Object.keys(THEMES).map((g) => [g, state.rooms[g].length]), ...others.map(([g, a]) => [g, a.length])];
  ["Commedia", "Drama", "Thriller", "Azione"].forEach((g) => { if (names.length < 5 && !names.some((n) => n[0] === g)) names.push([g, 0]); });
  buildHub(names.map(([name, count]) => ({ name, count })));
  enterHub();
  if (q.get("room") && THEMES[q.get("room")]) enterRoom(q.get("room"));
  if (q.has("debug")) window.__s = { camera, state, doors, posters, enterHub, enterRoom, setView: (y, p) => { yaw = y; pitch = p; } };
  if (!demo) $("intro-msg").textContent = "Libreria caricata";
  $("go").hidden = false;
  $("go").onclick = () => { $("intro").remove(); const f = $("fade"); f.style.opacity = 0; ctl.enabled = true; };
  requestAnimationFrame(frame);
})();
