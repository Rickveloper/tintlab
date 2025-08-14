import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/* ============================== State ============================== */
const hemiLight = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
hemiLight.position.set(0, 20, 0);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 1);
dirLight.position.set(-3, 10, -10);
scene.add(dirLight);

const WINDOWS = ['windshield', 'lf', 'rf', 'lr', 'rr', 'rear'];
const CODE_TO_KEY = { ws: 'windshield', lf: 'lf', rf: 'rf', lr: 'lr', rr: 'rr', re: 'rear' };
const KEY_TO_CODE = { windshield: 'ws', lf: 'lf', rf: 'rf', lr: 'lr', rr: 'rr', rear: 're' };

const state = {
  view: 'outside',
  lighting: 'day',
  film: 'ceramic',
  uniform: false,
  shade: 15,
  scale: 1.0,
  height: 0.0,
  windows: { windshield: 10, lf: 15, rf: 15, lr: 5, rr: 5, rear: 5 }
};

/* ============================== DOM =============================== */
const app = document.getElementById('app');
const perfEl = document.getElementById('perf');
const viewSel = document.getElementById('viewSel');
const lightSel = document.getElementById('lightSel');
const filmSel = document.getElementById('filmSel');
const shadeSel = document.getElementById('shadeSel');
const uniformChk = document.getElementById('uniformChk');
const applySelBtn = document.getElementById('applySelBtn');
const applyAllBtn = document.getElementById('applyAllBtn');
const resetCamBtn = document.getElementById('resetCam');
const scaleSlider = document.getElementById('scaleSlider');
const heightSlider = document.getElementById('heightSlider');
const scaleValue = document.getElementById('scaleValue');
const heightValue = document.getElementById('heightValue');
const screenshotBtn = document.getElementById('screenshotBtn');

const fileInput = document.getElementById('fileInput');
const modelBtn = document.getElementById('modelBtn');
const dropEl = document.getElementById('drop');

const selLabel = document.getElementById('selLabel');

/* ============================== Three ============================== */
let renderer, scene, camera, controls, pmrem;
let car, glassMeshes = [];
const selected = new Set();
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();

// TINTLAB: render-on-demand core
let renderQueued = false;
function requestRender() {
  if (renderQueued) return;
  renderQueued = true;
  queueMicrotask(() => {
    renderQueued = false;
    renderer.setAnimationLoop(null); // hard stop any loops
    renderOnce();
  });
}

// render scheduler (render-on-demand)
let needsRender = true;
function invalidate() { needsRender = true; requestAnimationFrame(renderIfNeeded); }
function renderIfNeeded() {
  if (!needsRender || document.hidden) return;
  needsRender = false;
  renderer.render(scene, camera);
}

function renderOnce() {
  renderer.render(scene, camera);
}

/* ====== Perf: DPR scaler, visibility pause, context safety ======= */
const DPR_MIN = 0.8;
const DPR_MAX = 1.25;
let dynamicDPR = Math.min(window.devicePixelRatio || 1, 1.0);
let lastFrame = performance.now();
let ema = 16;
const EMA_WEIGHT = 0.15;

function adjustResolution() {
  const now = performance.now();
  const dt = now - lastFrame; lastFrame = now;
  ema = (1 - EMA_WEIGHT) * ema + EMA_WEIGHT * dt;
  if (ema > 20 && dynamicDPR > DPR_MIN) {
    dynamicDPR = Math.max(DPR_MIN, dynamicDPR - 0.05);
    renderer.setPixelRatio(dynamicDPR); perfEl.textContent = `pxRatio ${dynamicDPR.toFixed(2)} ↓`;
  } else if (ema < 14 && dynamicDPR < DPR_MAX) {
    dynamicDPR = Math.min(DPR_MAX, dynamicDPR + 0.05);
    renderer.setPixelRatio(dynamicDPR); perfEl.textContent = `pxRatio ${dynamicDPR.toFixed(2)} ↑`;
  } else {
    perfEl.textContent = `pxRatio ${dynamicDPR.toFixed(2)}`;
  }
}
document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); });
function onContextLost(e) { e.preventDefault(); console.warn('WebGL context lost'); }
function onContextRestored() { console.info('WebGL context restored'); invalidate(); }

/* ============================== Boot ============================== */
initRenderer();
initScene();
bindUI();
restoreFromURL();
applyLighting(state.lighting);

// TINTLAB: quick existence check for public asset
async function urlExists(url) {
  try {
    const r = await fetch(url, { method: 'HEAD', cache: 'no-store' });
    return r.ok;
  } catch { return false; }
}

// TINTLAB: boot the car
let carRoot;
(async () => {
  const { scene: modelScene, isPlaceholder } = await loadModelOrPlaceholder('/models/2019-tacoma/tacoma.gltf');
  carRoot = modelScene;
  scene.add(carRoot);
  initOrRemapGlass(carRoot); // your existing mapping + proxy handling
  console.log('[TintLab] Car ready. Placeholder?', isPlaceholder);
  requestRender();
})();

/* ============================== Init ============================== */
function initRenderer() {
  renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(dynamicDPR);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  app.innerHTML = ''; app.appendChild(renderer.domElement);

  renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
  renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);
  window.addEventListener('resize', onResizeThrottled);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);

  // drag & drop files
  window.addEventListener('dragover', (e) => { e.preventDefault(); dropEl.style.display = 'grid'; });
  window.addEventListener('dragleave', () => { dropEl.style.display = 'none'; });
  window.addEventListener('drop', async (e) => {
    e.preventDefault(); dropEl.style.display = 'none';
    const file = e.dataTransfer?.files?.[0]; if (!file) return;
    await loadLocalModel(file);
    requestRender();
  });
  modelBtn.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    await loadLocalModel(file);
    requestRender();
  });
}

function initScene() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f1115');

  pmrem = new THREE.PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
  camera.position.set(4, 1.7, 5);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.target.set(0, 1.2, 0);
  controls.addEventListener('change', () => { adjustResolution(); invalidate(); });

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(20, 64),
    new THREE.MeshStandardMaterial({ color: 0x10131b, roughness: 0.95, metalness: 0.0 })
  );
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
}

/* ============================== Model Loading ============================== */
const DEFAULT_MODEL_URL = '/models/2019-tacoma/tacoma.gltf';

async function loadModelOrPlaceholder(url = DEFAULT_MODEL_URL) {
  const exists = await urlExists(url);
  if (!exists) {
    console.warn('[TintLab] Missing', url, '— using placeholder model.');
    return { scene: makeCarPlaceholder(), isPlaceholder: true };
  }
  return new Promise((resolve) => {
    const loader = new GLTFLoader();
    loader.load(
      url,
      (gltf) => {
        console.log('[TintLab] Loaded model:', url);

        // Process the loaded model
        const root = gltf.scene;

        // Normalize scale & center
        const box = new THREE.Box3().setFromObject(root);
        const size = new THREE.Vector3(); const center = new THREE.Vector3();
        box.getSize(size); box.getCenter(center);
        const scale = 3.8 / Math.max(size.x, size.z); // fit similar to placeholder length
        root.scale.setScalar(scale);
        root.position.sub(center.multiplyScalar(scale)); // center on origin
        root.position.y = 0.9; // sit above ground

        // Materials quick pass: add nice clearcoat if we detect "body"/"paint"
        root.traverse((o) => {
          if (o.isMesh) {
            o.castShadow = o.receiveShadow = false;
            if (o.material && !Array.isArray(o.material)) {
              const name = (o.material.name || o.name || '').toLowerCase();
              if (name.includes('body') || name.includes('paint') || name.includes('carpaint')) {
                o.material = new THREE.MeshPhysicalMaterial({
                  color: o.material.color ?? new THREE.Color(0x888888),
                  roughness: 0.35, metalness: 0.1, clearcoat: 1.0, clearcoatRoughness: 0.06,
                  envMapIntensity: 1.0
                });
              }
            }
          }
        });

        resolve({ scene: root, isPlaceholder: false });
      },
      undefined,
      (err) => {
        console.warn('[TintLab] Failed to load model — using placeholder. Error:', err?.message || err);
        resolve({ scene: makeCarPlaceholder(), isPlaceholder: true });
      }
    );
  });
}

async function loadBundledModel(path) {
  // fetch to check existence
  const res = await fetch(path, { method: 'HEAD' });
  if (!res.ok) throw new Error('Not found');
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(path);
  onModelLoaded(gltf.scene, 'bundled');
}

async function loadLocalModel(file) {
  // Dispose old carRoot
  if (carRoot) {
    carRoot.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
    scene.remove(carRoot);
  }

  const url = URL.createObjectURL(file);
  try {
    const { scene: modelScene } = await loadModelOrPlaceholder(url);
    carRoot = modelScene;
    scene.add(carRoot);
    initOrRemapGlass(carRoot);
    console.log('[TintLab] Loaded local model:', file.name);
  } finally {
    URL.revokeObjectURL(url);
  }
}

function clearCar() {
  if (carRoot) {
    scene.remove(carRoot);
    // Dispose of geometries and materials
    carRoot.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach(mat => mat.dispose());
        } else {
          child.material.dispose();
        }
      }
    });
  }
  carRoot = undefined; car = undefined; glassMeshes = []; selected.clear(); updateSelectedLabel();
}

function onModelLoaded(root, label) {
  clearCar();

  carRoot = new THREE.Group();
  carRoot.add(root);
  scene.add(carRoot);

  // Initialize glass meshes
  initOrRemapGlass(carRoot);
}

// TINTLAB: Apply scale and height adjustments to the car model
function applyScaleAndHeight() {
  if (!carRoot) return;

  // Apply scale
  carRoot.scale.setScalar(state.scale);

  // Apply height offset (relative to original position)
  carRoot.position.y = 0.9 + state.height;

  // Update controls target to follow car
  if (controls && controls.target) {
    controls.target.y = 1.2 + state.height;
  }

  requestRender();
}

// TINTLAB: Take a screenshot of the current viewport and download it
function takeScreenshot() {
  // Force one render at current DPR
  renderer.render(scene, camera);

  // Get the canvas data as PNG
  const dataURL = renderer.domElement.toDataURL('image/png');

  // Create download link
  const link = document.createElement('a');
  link.download = `tintlab_${Date.now()}.png`;
  link.href = dataURL;

  // Trigger download
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function findGlassMeshes(root) {
  const out = [];
  root.traverse((o) => {
    if (!o.isMesh) return;
    const n = (o.name || '').toLowerCase();
    const mn = (o.material?.name || '').toLowerCase();

    // TINTLAB: Enhanced glass detection heuristics
    const looksGlassByName = /glass|window|wind|screen|front|rear|backlight|left|right|lf|rf|lr|rr/.test(n) ||
      /glass|window|front|rear|left|right/.test(mn);
    const looksGlassByProps = !!o.material && (o.material.transparent || (o.material.opacity && o.material.opacity < 1));

    if (looksGlassByName || looksGlassByProps) {
      // Replace with our physical glass mat so tinting works predictably
      o.material = new THREE.MeshPhysicalMaterial({
        color: 0xffffff, roughness: 0.05, transmission: 1.0, thickness: 0.4, ior: 1.5, reflectivity: 0.06, transparent: true
      });
      out.push(o);
    }
  });
  return out;
}

// If no glass present / split, create simple quads around the car bbox
function createProxyGlass(root) {
  const box = new THREE.Box3().setFromObject(root);
  const size = new THREE.Vector3(); const center = new THREE.Vector3();
  box.getSize(size); box.getCenter(center);
  const w = size.x * 0.9, h = size.y * 0.55, d = size.z * 0.9;

  const g = (name, geo, pos, rot) => {
    const m = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({
      color: 0xffffff, roughness: 0.05, transmission: 1.0, thickness: 0.4, ior: 1.5, reflectivity: 0.06, transparent: true
    }));
    m.name = name;
    m.position.copy(pos);
    m.rotation.setFromVector3(rot);
    // TINTLAB: Mark as proxy for debugging
    m.userData.proxy = true;
    m.userData.proxyID = name;
    return m;
  };

  const windshield = g('windshield', new THREE.PlaneGeometry(w * 0.45, h * 0.5),
    new THREE.Vector3(center.x, center.y + 0.25, center.z + d * 0.4),
    new THREE.Vector3(-Math.PI / 10, 0, 0));
  const rear = g('rear', new THREE.PlaneGeometry(w * 0.42, h * 0.45),
    new THREE.Vector3(center.x, center.y + 0.2, center.z - d * 0.42),
    new THREE.Vector3(Math.PI / 10, 0, 0));
  const lf = g('lf', new THREE.PlaneGeometry(d * 0.35, h * 0.45),
    new THREE.Vector3(center.x - w * 0.5, center.y + 0.2, center.z + d * 0.15),
    new THREE.Vector3(0, Math.PI / 2, 0));
  const rf = g('rf', lf.geometry.clone(),
    new THREE.Vector3(center.x + w * 0.5, center.y + 0.2, center.z + d * 0.15),
    new THREE.Vector3(0, -Math.PI / 2, 0));
  const lr = g('lr', lf.geometry.clone(),
    new THREE.Vector3(center.x - w * 0.5, center.y + 0.2, center.z - d * 0.15),
    new THREE.Vector3(0, Math.PI / 2, 0));
  const rr = g('rr', lf.geometry.clone(),
    new THREE.Vector3(center.x + w * 0.5, center.y + 0.2, center.z - d * 0.15),
    new THREE.Vector3(0, -Math.PI / 2, 0));

  return [windshield, lf, rf, lr, rr, rear];
}

// Create a simple placeholder car when no model is loaded
function makeCarPlaceholder() {
  const carGroup = new THREE.Group();

  // Car body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 1.2, 1.8),
    new THREE.MeshPhysicalMaterial({
      color: 0x444444,
      roughness: 0.35,
      metalness: 0.1,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06
    })
  );
  body.position.y = 0.6;
  carGroup.add(body);

  // Wheels
  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.2, 16);
  const wheelMat = new THREE.MeshStandardMaterial({ color: 0x222222, roughness: 0.8 });

  const wheelPositions = [
    [-1.2, 0.4, 0.8], [-1.2, 0.4, -0.8],  // left wheels
    [1.2, 0.4, 0.8], [1.2, 0.4, -0.8]     // right wheels
  ];

  wheelPositions.forEach(pos => {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2;
    wheel.position.set(...pos);
    carGroup.add(wheel);
  });

  // Create glass meshes
  const proxyGlass = createProxyGlass(carGroup);
  carGroup.add(...proxyGlass);

  // For selection outlines per-mesh
  proxyGlass.forEach(m => m.userData.outline = null);

  return carGroup;
}

// Create a simple placeholder car when no model is loaded
function createPlaceholderCar() {
  const carGroup = makeCarPlaceholder();
  carRoot = carGroup;
  car = carGroup;
  scene.add(carRoot);

  // TINTLAB: Apply current scale and height settings
  applyScaleAndHeight();
  requestRender();
}

function categorizeWindows(meshes) {
  // TINTLAB: Enhanced window mapping using position and orientation heuristics
  const entries = meshes.map(m => {
    const p = new THREE.Vector3(); m.getWorldPosition(p);
    return { m, x: p.x, y: p.y, z: p.z, area: approxArea(m), mesh: m };
  });

  const pickExtreme = (arr, key, max = true) => arr.slice().sort((a, b) => max ? (b[key] - a[key]) : (a[key] - b[key]))[0];

  // Frontmost = windshield, backmost = rear
  const windshield = pickExtreme(entries, 'z', true)?.m;
  const rear = pickExtreme(entries, 'z', false)?.m;

  // Remove picked from pool
  const rest = entries.filter(e => e.m !== windshield && e.m !== rear);

  // Left vs right by X position
  const left = rest.filter(e => e.x < 0).sort((a, b) => b.z - a.z);  // sort by z (front first)
  const right = rest.filter(e => e.x >= 0).sort((a, b) => b.z - a.z);

  const lf = left[0]?.m, lr = left[1]?.m;
  const rf = right[0]?.m, rr = right[1]?.m;

  const out = { windshield, lf, rf, lr, rr, rear };

  // Assign missing slots with any leftover meshes
  const used = new Set(Object.values(out).filter(Boolean));
  rest.forEach(e => {
    if (used.has(e.m)) return;
    for (const k of WINDOWS) { if (!out[k]) { out[k] = e.m; used.add(e.m); break; } }
  });

  // Ensure names match our canonical keys (helps selection label)
  for (const k of WINDOWS) { if (out[k]) out[k].name = k; }

  // Log mapping results
  const mappedCount = Object.values(out).filter(Boolean).length;
  if (mappedCount === 6) {
    console.log('[TintLab] Mapped panes:', Object.fromEntries(Object.entries(out).map(([k, v]) => [k, v.name])));
  } else {
    const missing = WINDOWS.filter(k => !out[k]);
    console.info('[TintLAB] Using proxy panes for:', missing);
  }

  return out;
}

function approxArea(mesh) {
  mesh.geometry.computeBoundingBox();
  const s = mesh.geometry.boundingBox.getSize(new THREE.Vector3());
  return s.x * s.y + s.x * s.z + s.y * s.z; // rough
}

// TINTLAB: Initialize or remap glass meshes for a car model
function initOrRemapGlass(carModel) {
  // Collect glass meshes or make proxies
  glassMeshes = findGlassMeshes(carModel);
  if (glassMeshes.length < 3) {
    console.warn('[TintLab] Model has few or no glass meshes; creating proxy panes.');
    glassMeshes = createProxyGlass(carModel);
    carModel.add(...glassMeshes);
  }

  // Map glass to our canonical windows by position
  const mapping = categorizeWindows(glassMeshes);
  glassMeshes = WINDOWS.map(k => mapping[k]).filter(Boolean);

  // For selection outlines per-mesh
  glassMeshes.forEach(m => m.userData.outline = null);

  car = carModel.children[0] || carModel; // Get the actual car model from the group

  // Apply current scale and height settings
  applyScaleAndHeight();

  applyAllTints();
  setView(state.view);
  requestRender();
}

/* ============================== Lighting/View ============================== */
function applyLighting(preset) {
  scene.children.filter(c => c.isLight).forEach(l => scene.remove(l));
  const amb = new THREE.AmbientLight(0xffffff, 0.4);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0); sun.position.set(5, 8, 4);
  scene.add(amb, sun);
  switch (preset) {
    case 'day': amb.intensity = 0.5; sun.intensity = 1.2; sun.color.set('#ffffff'); break;
    case 'dusk': amb.intensity = 0.35; sun.intensity = 0.8; sun.color.set('#ffd2a6'); break;
    case 'night': amb.intensity = 0.15; sun.intensity = 0.25; sun.color.set('#a7c7ff'); break;
    case 'storm': amb.intensity = 0.25; sun.intensity = 0.6; sun.color.set('#dfe5ee'); break;
  }
  requestRender();
}

function setView(mode) {
  state.view = mode;
  if (mode === 'outside') {
    camera.position.set(4, 1.7, 5); controls.target.set(0, 1.2, 0);
    controls.enablePan = true; controls.minDistance = 2.5; controls.maxDistance = 8;
  } else {
    camera.position.set(0.15, 1.3, 0.25); controls.target.set(2.2, 1.0, 0.3);
    controls.enablePan = false; controls.minDistance = 0.1; controls.maxDistance = 1.5;
  }
  controls.update(); writeURL(); requestRender();
}

/* ============================== Tinting ============================== */
function vltToAdjust(vlt, film) {
  const attenDist = 0.15 + (vlt * 2.0);
  const dark = new THREE.Color(0.18, 0.18, 0.18);
  const light = new THREE.Color(0.95, 0.95, 0.95);
  const attenColor = dark.clone().lerp(light, vlt);
  let reflect = 0.04; if (film === 'carbon') reflect = 0.06; if (film === 'dyed') reflect = 0.02;
  return { attenDist, attenColor, reflect };
}

function applyTintToMesh(mesh, vlt, film) {
  if (!mesh?.material) return;
  const mat = mesh.material;
  const { attenDist, attenColor, reflect } = vltToAdjust(vlt, film);
  mat.attenuationColor = attenColor;
  mat.attenuationDistance = attenDist;
  mat.transmission = 1.0;
  mat.ior = 1.5;
  mat.reflectivity = reflect;
  mat.roughness = 0.06;
  mat.needsUpdate = true;
}

function applyAllTints() {
  const film = state.film;
  const mapByName = {};
  if (glassMeshes?.length) { glassMeshes.forEach(m => mapByName[m.name] = m); }
  WINDOWS.forEach(k => {
    const vlt = (state.uniform ? state.shade : (state.windows[k] ?? state.shade)) / 100;
    const mesh = mapByName[k];
    if (mesh) applyTintToMesh(mesh, vlt, film);
  });
  requestRender();
}

/* ============================== Selection ============================== */
function onPointerDown(e) {
  if (!glassMeshes?.length) return;
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(glassMeshes, false);

  if (hits.length === 0) { if (!e.shiftKey) clearSelection(); return; }

  const mesh = hits[0].object;
  if (e.shiftKey) { if (selected.has(mesh)) deselect(mesh); else select(mesh); }
  else { if (!(selected.size === 1 && selected.has(mesh))) { clearSelection(); select(mesh); } }
  updateSelectedLabel();
}

function select(mesh) {
  if (selected.has(mesh)) return;
  selected.add(mesh);
  addOutline(mesh);
  requestRender();
}
function deselect(mesh) {
  if (!selected.has(mesh)) return;
  selected.delete(mesh);
  removeOutline(mesh);
  requestRender();
}
function clearSelection() {
  [...selected].forEach(removeOutline);
  selected.clear();
  updateSelectedLabel();
  requestRender();
}

function addOutline(mesh) {
  if (mesh.userData.outline) return;
  const geo = new THREE.EdgesGeometry(mesh.geometry, 45);
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: 0xffffff }));
  lines.position.copy(mesh.position); lines.rotation.copy(mesh.rotation); lines.scale.copy(mesh.scale);
  lines.renderOrder = 999; // on top
  (carRoot || scene).add(lines);
  mesh.userData.outline = lines;
}
function removeOutline(mesh) {
  const lines = mesh.userData.outline;
  if (lines) {
    (carRoot || scene).remove(lines);
    lines.geometry.dispose();
    lines.material.dispose();
    mesh.userData.outline = null;
  }
}
function updateSelectedLabel() {
  const names = [...selected].map(m => m.name.toUpperCase()).join(', ');
  selLabel.textContent = selected.size ? `Selected: ${names}` : 'Selected: —';
}

/* ============================== UI Bindings ============================== */
function bindUI() {
  viewSel.value = state.view; lightSel.value = state.lighting;
  filmSel.value = state.film; shadeSel.value = String(state.shade); uniformChk.checked = state.uniform;
  scaleSlider.value = state.scale.toFixed(2); heightSlider.value = state.height.toFixed(3);
  scaleValue.textContent = state.scale.toFixed(2); heightValue.textContent = `${state.height.toFixed(3)}m`;

  viewSel.addEventListener('change', () => setView(viewSel.value));
  lightSel.addEventListener('change', () => { state.lighting = lightSel.value; applyLighting(state.lighting); writeURL(); requestRender(); });
  filmSel.addEventListener('change', () => { state.film = filmSel.value; applyAllTints(); writeURL(); requestRender(); });
  shadeSel.addEventListener('change', () => { state.shade = parseInt(shadeSel.value, 10); if (state.uniform) applyAllBtn.click(); writeURL(); requestRender(); });
  uniformChk.addEventListener('change', () => { state.uniform = uniformChk.checked; applyAllTints(); writeURL(); requestRender(); });

  // TINTLAB: Scale and height slider handlers
  scaleSlider.addEventListener('input', () => {
    state.scale = parseFloat(scaleSlider.value);
    scaleValue.textContent = state.scale.toFixed(2);
    applyScaleAndHeight();
    setURLParams(p => { p.set('sc', state.scale.toFixed(2)); });
  });

  heightSlider.addEventListener('input', () => {
    state.height = parseFloat(heightSlider.value);
    heightValue.textContent = `${state.height.toFixed(3)}m`;
    applyScaleAndHeight();
    setURLParams(p => { p.set('h', state.height.toFixed(3)); });
  });

  applySelBtn.addEventListener('click', () => {
    const shade = parseInt(shadeSel.value, 10);
    if (state.uniform) { [...selected].forEach(m => state.windows[m.name] = shade); state.uniform = false; uniformChk.checked = false; }
    else { [...selected].forEach(m => state.windows[m.name] = shade); }
    applyAllTints(); writeURL(); requestRender();
  });

  applyAllBtn.addEventListener('click', () => {
    const shade = parseInt(shadeSel.value, 10);
    WINDOWS.forEach(k => state.windows[k] = shade);
    applyAllTints(); writeURL(); requestRender();
  });

  resetCamBtn.addEventListener('click', () => setView(state.view));
  screenshotBtn.addEventListener('click', () => {
    requestRender(); // ensure a fresh frame
    const data = renderer.domElement.toDataURL('image/png');
    const a = document.createElement('a');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    a.href = data; a.download = `tintlab_${ts}.png`;
    a.click();
  });
}

/* ============================== URL State ============================== */
// TINTLAB: URL state helpers for sc, h
function getURLParams() { return new URLSearchParams(window.location.search); }
function setURLParams(mutator) {
  const p = getURLParams(); mutator(p);
  history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

function writeURL() {
  const p = new URLSearchParams();
  p.set('v', state.view);
  p.set('l', state.lighting);
  p.set('f', state.film);
  p.set('u', state.uniform ? '1' : '0');
  p.set('s', String(state.shade));
  p.set('sc', state.scale.toFixed(2));
  p.set('h', state.height.toFixed(3));
  const winStr = [
    `ws:${state.windows.windshield}`, `lf:${state.windows.lf}`, `rf:${state.windows.rf}`,
    `lr:${state.windows.lr}`, `rr:${state.windows.rr}`, `re:${state.windows.rear}`
  ].join(',');
  p.set('w', winStr);
  history.replaceState(null, '', `${location.pathname}?${p.toString()}`);
}

function restoreFromURL() {
  const q = new URLSearchParams(location.search);
  const v = q.get('v'); if (v === 'inside' || v === 'outside') state.view = v;
  const l = q.get('l'); if (['day', 'dusk', 'night', 'storm'].includes(l)) state.lighting = l;
  const f = q.get('f'); if (['ceramic', 'carbon', 'dyed'].includes(f)) state.film = f;
  const u = q.get('u'); if (u === '0' || u === '1') state.uniform = (u === '1');
  const s = q.get('s'); if (s && !Number.isNaN(+s)) state.shade = Math.max(5, Math.min(70, parseInt(s, 10)));
  const sc = q.get('sc'); if (sc && !Number.isNaN(+sc)) state.scale = Math.max(0.8, Math.min(1.2, parseFloat(sc)));
  const h = q.get('h'); if (h && !Number.isNaN(+h)) state.height = Math.max(-0.15, Math.min(0.15, parseFloat(h)));
  const w = q.get('w'); if (w) {
    w.split(',').forEach(tok => {
      const [code, valStr] = tok.split(':'); const key = CODE_TO_KEY[code]; const val = parseInt(valStr, 10);
      if (key && !Number.isNaN(val)) state.windows[key] = Math.max(5, Math.min(70, val));
    });
  }
  viewSel.value = state.view; lightSel.value = state.lighting; filmSel.value = state.film;
  shadeSel.value = String(state.shade); uniformChk.checked = state.uniform;
  scaleSlider.value = state.scale.toFixed(2); heightSlider.value = state.height.toFixed(3);
  scaleValue.textContent = state.scale.toFixed(2); heightValue.textContent = `${state.height.toFixed(3)}m`;

  // Restore from URL on boot
  (() => {
    const p = getURLParams();
    if (p.has('sc')) { scaleSlider.value = p.get('sc'); }
    if (p.has('h')) { heightSlider.value = p.get('h'); }
  })();
}

/* ============================== Resize ============================== */
let resizePending = false;
function onResizeThrottled() {
  if (resizePending) return; resizePending = true;
  requestAnimationFrame(() => {
    resizePending = false;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    invalidate();
  });
}
