// ─── stanze/stanze.js ────────────────────────────────────────────────────────
// Modalità "Stanze": un atrio circolare con una porta per genere, e dietro ogni
// porta una stanza a tema piena delle locandine della libreria. Pagina a sé
// (stanze.html): non tocca l'app. I dati sono quelli di sempre (loadDB).
// Per ora: atrio + stanza Horror (le altre porte sono segnaposto).
import * as THREE from "three";
import { loadDB } from "../storage.js?v=9576e74";
import { posterUrl, titleOf, yearOf, extractDirector } from "../cine-core.js?v=9576e74";

const $ = (id) => document.getElementById(id);
const q = new URLSearchParams(location.search);

// ─── dati ────────────────────────────────────────────────────────────────────
function demoFilms(n) {
  const t = ["Il Rituale", "Notte Nera", "La Casa in Fondo", "Sotto la Pelle", "Ultimo Piano", "Eco", "Nebbia", "Il Visitatore", "Sette Porte", "Cripta", "Lo Specchio", "Respiro", "Fuori Orario", "Il Custode"];
  return Array.from({ length: n }, (_, i) => ({ id: 9000 + i, media_type: "movie", title: t[i % t.length], year: 1980 + i * 2, vote: 6 + (i % 4), genre_names: ["Horror"], director: "Regista " + (i + 1), cast: ["Attore A", "Attrice B", "Attore C"], poster_path: "" }));
}
function groupByGenre(db) {
  const seen = new Set(), all = [];
  [...(db.seen || []), ...(db.watchlist || [])].forEach((f) => {
    const k = `${f.media_type}|${f.id}`;
    if (!seen.has(k)) { seen.add(k); all.push(f); }
  });
  const by = new Map();
  all.forEach((f) => (f.genre_names || []).forEach((g) => { if (!by.has(g)) by.set(g, []); by.get(g).push(f); }));
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
const doors = [];           // {genre, pos, color, group}
const posters = [];         // {mesh, film, z, loaded}
const HUB_R = 4.6;
const GENRE_COLOR = { Horror: 0xb02020, Fantascienza: 0x2a8cff, Commedia: 0xf0b020, Drama: 0x9a6ad8, Thriller: 0x3aa07a, Azione: 0xe0701c, Romance: 0xe05a8a, Fantasy: 0x6ad0c0, Animazione: 0x70c040, Crime: 0x888888 };

function buildHub(genres) {
  hub.clear(); doors.length = 0;
  const wallMat = surface("brick", 14, 2, 0x3a3632);
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(HUB_R, HUB_R, 3.2, 40, 1, true), wallMat);
  wall.position.y = 1.6; wall.material.side = THREE.BackSide; hub.add(wall);
  const floor = new THREE.Mesh(new THREE.CircleGeometry(HUB_R, 40), surface("floorA", 5, 5, 0x6a665e, 0.7));
  floor.rotation.x = -Math.PI / 2; hub.add(floor);
  const ceil = new THREE.Mesh(new THREE.CircleGeometry(HUB_R, 40), new THREE.MeshStandardMaterial({ color: 0x0a0a0a }));
  ceil.rotation.x = Math.PI / 2; ceil.position.y = 3.2; hub.add(ceil);
  genres.forEach(({ name, count }, i) => {
    const a = (i / genres.length) * Math.PI * 2;
    const color = GENRE_COLOR[name] || 0x777777;
    const g = new THREE.Group();
    g.position.set(Math.sin(a) * (HUB_R - 0.05), 0, -Math.cos(a) * (HUB_R - 0.05));
    g.rotation.y = -a;   // il lato +z della porta guarda il centro
    const frame = new THREE.Mesh(new THREE.BoxGeometry(1.5, 2.5, 0.12), new THREE.MeshStandardMaterial({ color: 0x0b0a09, emissive: color, emissiveIntensity: 0.18, roughness: 0.6 }));
    frame.position.set(0, 1.25, 0.04); g.add(frame);
    const inner = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 2.25), new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(0.28) }));
    inner.position.set(0, 1.2, 0.11); g.add(inner);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: labelTexture([[name.toUpperCase(), 52, 62, "6px"], [`${count} film`, 26, 122]], 512, 160, "#" + new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.5).getHexString()), fog: false }));
    lab.position.set(0, 2.85, 0.12); g.add(lab);
    const glow = new THREE.PointLight(color, 0.9, 3.2, 2); glow.position.set(0, 1.4, 0.8); g.add(glow);
    hub.add(g);
    doors.push({ genre: name, color, group: g, x: Math.sin(a) * HUB_R, z: -Math.cos(a) * HUB_R, count });
  });
}

function buildHorrorRoom(films) {
  room.clear(); posters.length = 0;
  const per = 2, step = 2.4, start = 7;
  const L = start + Math.ceil(films.length / per) * step + 4;
  room.userData.L = L;
  const HW = 1.9, H = 3.1;
  const brickL = surface("brick", L / 2.1, H / 1.05, 0x5a4a44), brickR = brickL.clone();
  const mk = (geo, mat, x, y, z, ry = 0, rx = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.rotation.set(rx, ry, 0); room.add(m); return m; };
  mk(new THREE.PlaneGeometry(L, H), brickL, -HW, H / 2, -L / 2 + 1, Math.PI / 2);
  mk(new THREE.PlaneGeometry(L, H), brickR, HW, H / 2, -L / 2 + 1, -Math.PI / 2);
  mk(new THREE.PlaneGeometry(HW * 2, L), surface("floorA", 2.4, L / 1.6, 0x5a5650, 0.65), 0, 0, -L / 2 + 1, 0, -Math.PI / 2);
  mk(new THREE.PlaneGeometry(HW * 2, L), new THREE.MeshStandardMaterial({ color: 0x080808 }), 0, H, -L / 2 + 1, 0, Math.PI / 2);
  mk(new THREE.PlaneGeometry(HW * 2, H), new THREE.MeshStandardMaterial({ color: 0x050505 }), 0, H / 2, -L + 1, 0);           // fondo
  mk(new THREE.PlaneGeometry(HW * 2, H), new THREE.MeshStandardMaterial({ color: 0x050505 }), 0, H / 2, 1, Math.PI);          // dietro
  // porta di ritorno (dietro di te)
  mk(new THREE.PlaneGeometry(1.2, 2.2), new THREE.MeshBasicMaterial({ color: 0x1a0606 }), 0, 1.1, 0.98, Math.PI);
  mk(new THREE.PlaneGeometry(1.5, 0.47), new THREE.MeshBasicMaterial({ map: labelTexture([["ATRIO", 44, 80, "8px"]]), fog: false }), 0, 2.5, 0.97, Math.PI);
  // lampade a muro, una ogni 2 poster
  for (let z = -3; z > -L + 2; z -= step * 2) {
    const l = mk(new THREE.BoxGeometry(0.5, 0.06, 0.12), new THREE.MeshBasicMaterial({ color: 0xff9060 }), 0, H - 0.3, z);
    l.userData.lamp = true;
  }
  // locandine
  films.forEach((film, i) => {
    const side = i % per ? 1 : -1, z = -start - Math.floor(i / per) * step;
    const g = new THREE.Group();
    g.position.set(side * (HW - 0.03), 1.6, z); g.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const fr = new THREE.Mesh(new THREE.PlaneGeometry(1.12, 1.62), new THREE.MeshStandardMaterial({ color: 0x0a0807, roughness: 0.5 }));
    g.add(fr);
    const mat = new THREE.MeshStandardMaterial({ map: placeholderPoster(film), roughness: 0.7, emissive: 0xffffff, emissiveIntensity: 0.4 });
    mat.emissiveMap = mat.map;
    const p = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 1.5), mat);
    p.position.z = 0.012; p.userData.film = film; g.add(p);
    room.add(g);
    posters.push({ mesh: p, film, z, loaded: false });
  });
  // fondo: ultima scritta
  mk(new THREE.PlaneGeometry(3, 0.9), new THREE.MeshBasicMaterial({ map: labelTexture([[films.length ? "FINE DEL CORRIDOIO" : "NESSUN FILM QUI", 38, 80, "5px"]], 512, 160, "#7a1c1c"), fog: false }), 0, 1.6, -L + 1.02);
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
  if (state.where !== "horror") return;
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
const state = { where: "hub", busy: false, data: null, horror: [], genres: [] };
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
  hemi.intensity = 0.55; lamp.color.setHex(0xffd8a0); lamp.position.set(0, 2.9, 0); lamp.intensity = 7; torch.intensity = 14;
  const d = doors.find((x) => x.genre === fromDoor);
  if (d) { camera.position.set(d.x * 0.45, 1.6, d.z * 0.45); yaw = Math.atan2(d.x, d.z); }
  else { camera.position.set(0, 1.6, 0); yaw = 0; }
  pitch = 0;
}
function enterHorror() {
  state.where = "horror"; hub.visible = false; room.visible = true; $("back").hidden = false; $("where").textContent = "Horror";
  scene.fog.color.setHex(0x030102); scene.fog.density = 0.075; scene.background.setHex(0x030102);
  hemi.intensity = 0.5; lamp.color.setHex(0xff6a3a); lamp.intensity = 0; torch.intensity = 34;
  camera.position.set(0, 1.6, 0); yaw = 0; pitch = 0;
  lazyLoadPosters(0);
  setTimeout(() => { if (state.where === "horror") say("qui dentro non c'è nessuno. sono tutti appesi."); }, 1800);
}
$("back").onclick = () => fadeTo(() => enterHub("Horror"));

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
        if (d.genre === "Horror") { camera.position.x *= 0.9; camera.position.z *= 0.9; fadeTo(enterHorror); }
        else { camera.position.x *= 0.85; camera.position.z *= 0.85; say(`${d.genre}: stanza in costruzione.`, 2500); }
        break;
      }
    } else {
      const L = room.userData.L;
      camera.position.x = Math.max(-1.45, Math.min(1.45, camera.position.x));
      camera.position.z = Math.max(-L + 1.6, Math.min(0.9, camera.position.z));
      if (camera.position.z > 0.55 && Math.abs(camera.position.x) < 0.7) fadeTo(() => enterHub("Horror"));
      lazyLoadPosters(camera.position.z);
    }
  }
  camera.rotation.set(pitch, yaw, 0);
  // luce: la lampada più vicina, con sfarfallio da horror
  if (state.where === "horror") {
    const z = camera.position.z, zl = -3 - Math.max(0, Math.round((-3 - z) / 4.8)) * 4.8;
    lamp.position.set(0, 2.75, zl);
    nextBlink -= dt; if (nextBlink < 0) { nextBlink = 2 + Math.random() * 6; tt = -0.35; }
    const flick = tt < 0 ? (Math.random() < 0.5 ? 0 : 0.5) : 1;
    lamp.intensity = 9 * flick; torch.intensity = 30 + 4 * Math.sin(tt * 3);
    if (tt < 0) tt += dt * 2;
  }
  renderer.render(scene, camera);
}

// ─── avvio ───────────────────────────────────────────────────────────────────
(async function boot() {
  let db = { seen: [], watchlist: [] };
  try { db = (await Promise.race([loadDB(), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), 8000))])) || db; } catch (e) { console.warn("loadDB", e); }
  let by = groupByGenre(db);
  if (q.has("demo") || !(by.get("Horror") || []).length) { by.set("Horror", demoFilms(14)); if (!q.has("demo")) $("intro-msg").textContent = "Nessun horror in libreria: mostro film di prova."; }
  const horror = (by.get("Horror") || []).slice().sort((a, b) => rank(b) - rank(a)).slice(0, 60);
  const others = [...by.entries()].filter(([g]) => g !== "Horror").sort((a, b) => b[1].length - a[1].length).slice(0, 4);
  const names = [["Horror", horror.length], ...others.map(([g, a]) => [g, a.length])];
  ["Fantascienza", "Commedia", "Drama", "Thriller"].forEach((g) => { if (names.length < 5 && !names.some((n) => n[0] === g)) names.push([g, 0]); });
  state.horror = horror;
  buildHub(names.map(([name, count]) => ({ name, count })));
  buildHorrorRoom(horror);
  enterHub();
  if (q.get("room") === "horror") enterHorror();
  if (q.has("debug")) window.__s = { camera, state, doors, posters, enterHub, enterHorror, setView: (y, p) => { yaw = y; pitch = p; } };
  $("intro-msg").textContent = `${horror.length} horror nella libreria`;
  $("go").hidden = false;
  $("go").onclick = () => { $("intro").remove(); const f = $("fade"); f.style.opacity = 0; ctl.enabled = true; };
  requestAnimationFrame(frame);
})();
