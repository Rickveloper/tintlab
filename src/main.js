import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

let renderer, scene, camera, controls;
let placeholderCar, glassGroup = [];
const app = document.getElementById('app');

const viewSel = document.getElementById('viewSel');
const lightSel = document.getElementById('lightSel');
const filmSel = document.getElementById('filmSel');
const shadeSel = document.getElementById('shadeSel');
const resetCamBtn = document.getElementById('resetCam');

// --- NEW: selection state + raycaster
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const selected = new Set();

init();
createPlaceholderCar();
applyLighting('day');
applyTint();
animate();

function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  app.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color('#0f1115');

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.1, 200);
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

  window.addEventListener('resize', onResize);

  viewSel.addEventListener('change', () => setView(viewSel.value));
  lightSel.addEventListener('change', () => applyLighting(lightSel.value));
  filmSel.addEventListener('change', applyTint);
  shadeSel.addEventListener('change', applyTint);
  resetCamBtn.addEventListener('click', () => setView(viewSel.value));

  // --- NEW: mouse listeners
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
}

function createPlaceholderCar() {
  // Simple body
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(3.8, 1.2, 1.7),
    new THREE.MeshStandardMaterial({ color: 0x6b7280, roughness: 0.6, metalness: 0.2 })
  );
  body.position.y = 1;
  scene.add(body);

  // Glass material baseline
  const baseGlass = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.05,
    transmission: 1.0,
    thickness: 0.4,
    ior: 1.5,
    reflectivity: 0.06,
    transparent: true
  });

  const windshield = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 0.7), baseGlass.clone());
  windshield.name = 'windshield';
  windshield.rotation.x = -Math.PI / 9;
  windshield.position.set(0.2, 1.3, 0.86);

  const lf = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), baseGlass.clone());
  lf.name = 'lf';
  lf.rotation.y = Math.PI / 2;
  lf.position.set(-1.95, 1.15, 0.3);

  const rf = lf.clone(); rf.name = 'rf'; rf.position.x = 1.95; rf.rotation.y = -Math.PI/2;

  const lr = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.6), baseGlass.clone());
  lr.name = 'lr';
  lr.rotation.y = Math.PI / 2;
  lr.position.set(-1.95, 1.15, -0.3);

  const rr = lr.clone(); rr.name = 'rr'; rr.position.x = 1.95; rr.rotation.y = -Math.PI/2;

  const rear = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.6), baseGlass.clone());
  rear.name = 'rear';
  rear.rotation.x = Math.PI / 10;
  rear.position.set(-0.2, 1.2, -0.86);

  placeholderCar = new THREE.Group();
  placeholderCar.add(body, windshield, lf, rf, lr, rr, rear);
  scene.add(placeholderCar);

  glassGroup = [windshield, lf, rf, lr, rr, rear];

  // give each glass an outline helper holder
  glassGroup.forEach(m => { m.userData.outline = null; });

  setView('outside');
}

function setView(mode) {
  if (mode === 'outside') {
    camera.position.set(4, 1.7, 5);
    controls.target.set(0, 1.2, 0);
    controls.enablePan = true;
    controls.minDistance = 2.5; controls.maxDistance = 8;
  } else {
    camera.position.set(0.1, 1.3, 0.2);
    controls.target.set(2.2, 1.0, 0.3);
    controls.enablePan = false;
    controls.minDistance = 0.1; controls.maxDistance = 1.5;
  }
  controls.update();
}

function applyLighting(preset) {
  scene.children.filter((c) => c.isLight).forEach((l) => scene.remove(l));

  const amb = new THREE.AmbientLight(0xffffff, 0.4);
  scene.add(amb);

  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(5, 8, 4);
  scene.add(sun);

  switch (preset) {
    case 'day':   amb.intensity = 0.5;  sun.intensity = 1.2; break;
    case 'dusk':  amb.intensity = 0.35; sun.intensity = 0.8; sun.color.set('#ffd2a6'); break;
    case 'night': amb.intensity = 0.15; sun.intensity = 0.25; sun.color.set('#a7c7ff'); break;
    case 'storm': amb.intensity = 0.25; sun.intensity = 0.6;  sun.color.set('#dfe5ee'); break;
  }
}

function applyTint() {
  const film = filmSel.value; // ceramic | carbon | dyed
  const shade = parseInt(shadeSel.value, 10); // 5..70
  const vlt = shade / 100;

  const attenuationDistance = 0.15 + (vlt * 2.0);
  const dark = new THREE.Color(0.18, 0.18, 0.18);
  const light = new THREE.Color(0.95, 0.95, 0.95);
  const attenuationColor = dark.clone().lerp(light, vlt);
  let reflect = 0.04;
  if (film === 'carbon') reflect = 0.06;
  if (film === 'dyed')   reflect = 0.02;

  glassGroup.forEach((m) => {
    const mat = m.material;
    mat.attenuationColor = attenuationColor;
    mat.attenuationDistance = attenuationDistance;
    mat.transmission = 1.0;
    mat.reflectivity = reflect;
    mat.ior = 1.5;
    mat.roughness = 0.06;
    mat.needsUpdate = true;
  });
}

// ---------- Selection + outline ----------

function onPointerDown(event) {
  // normalize pointer
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(glassGroup, false);

  if (hits.length === 0) {
    // click empty space → clear (unless Shift is held)
    if (!event.shiftKey) clearSelection();
    return;
  }

  const mesh = hits[0].object;

  if (event.shiftKey) {
    // toggle in multi-select
    if (selected.has(mesh)) {
      deselect(mesh);
    } else {
      select(mesh);
    }
  } else {
    // single select: clear others then select one
    if (selected.size === 1 && selected.has(mesh)) {
      // clicking the same one → keep it
      return;
    }
    clearSelection();
    select(mesh);
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
  [...selected].forEach(m => removeOutline(m));
  selected.clear();
  updateSelectedLabel();
}

function addOutline(mesh) {
  if (mesh.userData.outline) return;
  const geo = new THREE.EdgesGeometry(mesh.geometry, 45);
  const lines = new THREE.LineSegments(
    geo,
    new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 1 })
  );
  lines.position.copy(mesh.position);
  lines.rotation.copy(mesh.rotation);
  lines.scale.copy(mesh.scale);
  mesh.userData.outline = lines;
  // put outline slightly above to avoid z-fighting
  lines.renderOrder = 999;
  scene.add(lines);
}

function removeOutline(mesh) {
  const lines = mesh.userData.outline;
  if (lines) {
    scene.remove(lines);
    lines.geometry.dispose();
    lines.material.dispose();
    mesh.userData.outline = null;
  }
}

function updateSelectedLabel() {
  // small inline label showing selected ids
  let label = document.getElementById('selLabel');
  if (!label) {
    label = document.createElement('div');
    label.id = 'selLabel';
    label.style.position = 'fixed';
    label.style.right = '12px';
    label.style.top = '12px';
    label.style.background = '#151821cc';
    label.style.border = '1px solid #232833';
    label.style.borderRadius = '12px';
    label.style.padding = '8px 10px';
    label.style.color = '#e9ecf1';
    label.style.fontFamily = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Inter, Roboto, Helvetica, Arial';
    document.body.appendChild(label);
  }
  const names = [...selected].map(m => m.name.toUpperCase()).join(', ');
  label.textContent = selected.size ? `Selected: ${names}` : 'Selected: —';
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function animate() {
  requestAnimationFrame(animate);
  placeholderCar.rotation.y += 0.003;
  controls.update();
  renderer.render(scene, camera);
}

