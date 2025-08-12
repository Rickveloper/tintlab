import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

/** ---------- Global refs ---------- */
let renderer, scene, camera, controls;
let car, glassMeshes = [];
const selected = new Set();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const app = document.getElementById('app');

/** ---------- UI refs ---------- */
const viewSel = document.getElementById('viewSel');
const lightSel = document.getElementById('lightSel');
const filmSel = document.getElementById('filmSel');
const shadeSel = document.getElementById('shadeSel');
const uniformChk = document.getElementById('uniformChk');
const applySelBtn = document.getElementById('applySelBtn');
const applyAllBtn = document.getElementById('applyAllBtn');
const resetCamBtn = document.getElementById('resetCam');
const selLabel = document.getElementById('selLabel');

/** ---------- App State ---------- */
const WINDOWS = ['windshield','lf','rf','lr','rr','rear'];
const CODE_TO_KEY = { ws:'windshield', lf:'lf', rf:'rf', lr:'lr', rr:'rr', re:'rear' };
const KEY_TO_CODE = { windshield:'ws', lf:'lf', rf:'rf', lr:'lr', rr:'rr', rear:'re' };

const state = {
  view: 'outside',              // 'outside' | 'inside'
  lighting: 'day',              // 'day' | 'dusk' | 'night' | 'storm'
  film: 'ceramic',              // 'ceramic' | 'carbon' | 'dyed'  (global for now)
  uniform: false,               // when true, global shade drives all windows
  shade: 15,                    // global default shade
  windows: {                    // per-window shades (VLT %)
    windshield: 10,
    lf: 15,
    rf: 15,
    lr: 5,
    rr: 5,
    rear: 5
  }
};

/** ---------- Boot ---------- */
initRenderer();
initScene();
createPlaceholderCar();
bindUI();
restoreFromURL();
applyLighting(state.lighting);
applyAllTints();
setView(state.view);
animate();

/** ---------- Init functions ---------- */
function initRenderer() {
  renderer = new THREE.WebGLRenderer({
    antialias: false,
    powerPreference: 'high-performance'
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  app.innerHTML = '';
  app.appendChild(renderer.domElement);
  window.addEventListener('resize', onResize);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f1115');

  camera = new THREE.PerspectiveCamera(50, window.innerWidth/window.innerHeight, 0.1, 200);
  camera.position.set(4, 1.7, 5);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.target.set(0, 1.2, 0);

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(20, 64),
    new THREE.MeshStandardMaterial({ color: 0x131722, roughness: 0.95 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);
}

function createPlaceholderCar() {
  // Body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 1.2, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.6, metalness: 0.2 })
  );
  body.position.y = 1;

  // Base glass mat
  const baseGlass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff, roughness: 0.05, transmission: 1.0, thickness: 0.4,
    ior: 1.5, reflectivity: 0.06, transparent: true
  });

  // Glass panes
  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.7), baseGlass.clone());
  windshield.name = 'windshield';
  windshield.rotation.x = -Math.PI / 9; windshield.position.set(0.2, 1.3, 0.86);

  const lf = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), baseGlass.clone());
  lf.name = 'lf'; lf.rotation.y = Math.PI / 2; lf.position.set(-1.95, 1.15, 0.3);

  const rf = lf.clone(); rf.name = 'rf'; rf.position.x = 1.95; rf.rotation.y = -Math.PI / 2;

  const lr = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), baseGlass.clone());
  lr.name = 'lr'; lr.rotation.y = Math.PI / 2; lr.position.set(-1.95, 1.15, -0.3);

  const rr = lr.clone(); rr.name = 'rr'; rr.position.x = 1.95; rr.rotation.y = -Math.PI / 2;

  const rear = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), baseGlass.clone());
  rear.name = 'rear'; rear.rotation.x = Math.PI / 10; rear.position.set(-0.2, 1.2, -0.86);

  car = new THREE.Group();
  car.add(body, windshield, lf, rf, lr, rr, rear);
  scene.add(car);

  glassMeshes = [windshield, lf, rf, lr, rr, rear];
  glassMeshes.forEach(m => m.userData.outline = null);
}

/** ---------- Lighting / View ---------- */
function applyLighting(preset) {
  // remove previous lights
  scene.children.filter(o => o.isLight).forEach(l => scene.remove(l));

  const amb = new THREE.AmbientLight(0xffffff, 0.4);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 8, 4);
  scene.add(amb, sun);

  switch(preset) {
    case 'day':   amb.intensity = 0.5;  sun.intensity = 1.2; sun.color.set('#ffffff'); break;
    case 'dusk':  amb.intensity = 0.35; sun.intensity = 0.8; sun.color.set('#ffd2a6'); break;
    case 'night': amb.intensity = 0.15; sun.intensity = 0.25; sun.color.set('#a7c7ff'); break;
    case 'storm': amb.intensity = 0.25; sun.intensity = 0.6; sun.color.set('#dfe5ee'); break;
  }
}

function setView(mode) {
  state.view = mode;
  if (mode === 'outside') {
    camera.position.set(4, 1.7, 5);
    controls.target.set(0, 1.2, 0);
    controls.enablePan = true;
    controls.minDistance = 2.5; controls.maxDistance = 8;
  } else {
    camera.position.set(0.15, 1.3, 0.25);
    controls.target.set(2.2, 1.0, 0.3);
    controls.enablePan = false;
    controls.minDistance = 0.1; controls.maxDistance = 1.5;
  }
  controls.update();
  writeURL();
}

/** ---------- Tint logic ---------- */
function vltToMaterialAdjust(vlt, film) {
  // vlt = 0.05..0.70
  const attenDist = 0.15 + (vlt * 2.0);
  const dark = new THREE.Color(0.18,0.18,0.18);
  const light = new THREE.Color(0.95,0.95,0.95);
  const attenColor = dark.clone().lerp(light, vlt);
  let reflect = 0.04;
  if (film === 'carbon') reflect = 0.06;
  if (film === 'dyed')   reflect = 0.02;
  return { attenDist, attenColor, reflect };
}

function applyTintToMesh(mesh, vlt, film) {
  const mat = mesh.material;
  const { attenDist, attenColor, reflect } = vltToMaterialAdjust(vlt, film);
  mat.attenuationColor = attenColor;
  mat.attenuationDistance = attenDist;
  mat.transmission = 1.0;
  mat.ior = 1.5;
  mat.reflectivity = reflect;
  mat.roughness = 0.06;
  mat.needsUpdate = true;
}

// Apply all panes from state (respecting uniform mode)
function applyAllTints() {
  const film = state.film;
  if (state.uniform) {
    glassMeshes.forEach(m => applyTintToMesh(m, state.shade/100, film));
  } else {
    glassMeshes.forEach(m => {
      const key = m.name;
      const vlt = (state.windows[key] ?? state.shade) / 100;
      applyTintToMesh(m, vlt, film);
    });
  }
}

/** ---------- Selection + outline ---------- */
function onPointerDown(e) {
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(glassMeshes, false);

  if (hits.length === 0) {
    if (!e.shiftKey) clearSelection();
    return;
  }

  const mesh = hits[0].object;
  if (e.shiftKey) {
    if (selected.has(mesh)) deselect(mesh); else select(mesh);
  } else {
    if (selected.size === 1 && selected.has(mesh)) return;
    clearSelection(); select(mesh);
  }
  updateSelectedLabel();
}

function select(mesh) {
  if (selected.has(mesh)) return;
  selected.add(mesh);
  addOutline(mesh);
}
function deselect(mesh) {
  if (!selected.has(mesh)) return;
  selected.delete(mesh);
  removeOutline(mesh);
}
function clearSelection() {
  [...selected].forEach(removeOutline);
  selected.clear();
  updateSelectedLabel();
}
function addOutline(mesh) {
  if (mesh.userData.outline) return;
  const geo = new THREE.EdgesGeometry(mesh.geometry, 45);
  const lines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  lines.position.copy(mesh.position);
  lines.rotation.copy(mesh.rotation);
  lines.scale.copy(mesh.scale);
  lines.renderOrder = 999;
  mesh.userData.outline = lines;
  car.add(lines);
}
function removeOutline(mesh) {
  const lines = mesh.userData.outline;
  if (lines) {
    car.remove(lines);
    lines.geometry.dispose();
    lines.material.dispose();
    mesh.userData.outline = null;
  }
}
function updateSelectedLabel() {
  const names = [...selected].map(m => m.name.toUpperCase()).join(', ');
  selLabel.textContent = selected.size ? `Selected: ${names}` : 'Selected: —';
}

/** ---------- UI binds ---------- */
function bindUI() {
  viewSel.value = state.view;
  lightSel.value = state.lighting;
  filmSel.value = state.film;
  shadeSel.value = String(state.shade);
  uniformChk.checked = state.uniform;

  viewSel.addEventListener('change', () => setView(viewSel.value));
  lightSel.addEventListener('change', () => { state.lighting = lightSel.value; applyLighting(state.lighting); writeURL(); });
  filmSel.addEventListener('change', () => { state.film = filmSel.value; applyAllTints(); writeURL(); });
  shadeSel.addEventListener('change', () => { state.shade = parseInt(shadeSel.value,10); if (state.uniform) applyAllBtn.click(); writeURL(); });
  uniformChk.addEventListener('change', () => { state.uniform = uniformChk.checked; applyAllTints(); writeURL(); });

  applySelBtn.addEventListener('click', () => {
    const shade = parseInt(shadeSel.value, 10);
    if (state.uniform) {
      // in uniform mode, applying to selected still sets per-window for those, then turns uniform off
      [...selected].forEach(m => state.windows[m.name] = shade);
      state.uniform = false; uniformChk.checked = false;
    } else {
      [...selected].forEach(m => state.windows[m.name] = shade);
    }
    applyAllTints();
    writeURL();
  });

  applyAllBtn.addEventListener('click', () => {
    const shade = parseInt(shadeSel.value, 10);
    if (state.uniform) {
      // force all to global shade
      WINDOWS.forEach(k => state.windows[k] = shade);
    } else {
      // set each window to this shade but keep per-window mode
      WINDOWS.forEach(k => state.windows[k] = shade);
    }
    applyAllTints();
    writeURL();
  });

  resetCamBtn.addEventListener('click', () => setView(state.view));
}

/** ---------- URL state ---------- */
function writeURL() {
  const p = new URLSearchParams();
  p.set('v', state.view);
  p.set('l', state.lighting);
  p.set('f', state.film);
  p.set('u', state.uniform ? '1' : '0');
  p.set('s', String(state.shade));
  const winStr = [
    `ws:${state.windows.windshield}`,
    `lf:${state.windows.lf}`,
    `rf:${state.windows.rf}`,
    `lr:${state.windows.lr}`,
    `rr:${state.windows.rr}`,
    `re:${state.windows.rear}`
  ].join(',');
  p.set('w', winStr);
  const url = `${location.pathname}?${p.toString()}`;
  history.replaceState(null, '', url);
}

function restoreFromURL() {
  const q = new URLSearchParams(location.search);
  const v = q.get('v'); if (v === 'inside' || v === 'outside') state.view = v;
  const l = q.get('l'); if (['day','dusk','night','storm'].includes(l)) state.lighting = l;
  const f = q.get('f'); if (['ceramic','carbon','dyed'].includes(f)) state.film = f;
  const u = q.get('u'); if (u === '1' || u === '0') state.uniform = (u === '1');
  const s = q.get('s'); if (s && !Number.isNaN(+s)) state.shade = Math.max(5, Math.min(70, parseInt(s,10)));
  const w = q.get('w');
  if (w) {
    w.split(',').forEach(tok => {
      const [code, valStr] = tok.split(':');
      const key = CODE_TO_KEY[code];
      const val = parseInt(valStr,10);
      if (key && !Number.isNaN(val)) state.windows[key] = Math.max(5, Math.min(70, val));
    });
  }

  // sync UI with (possibly) restored state
  viewSel.value = state.view;
  lightSel.value = state.lighting;
  filmSel.value = state.film;
  shadeSel.value = String(state.shade);
  uniformChk.checked = state.uniform;
}

/** ---------- Loop & resize ---------- */
function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  // subtle motion so reflections shift
  if (car) car.rotation.y += 0.0025;
  controls.update();
  renderer.render(scene, camera);
}
