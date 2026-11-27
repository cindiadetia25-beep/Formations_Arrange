// ============================================================================
// BAGIAN 1: KONFIGURASI API GOOGLE APPS SCRIPT & STATE GLOBAL
// ============================================================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbypOugpXmLsnd_Q4dYber4O6V_xDt4JrDeCaiA-RgrirMCDtHpaJNxewlAfiMA6MhACiA/exec";

if (typeof Konva !== 'undefined') {
  Konva.pixelRatio = 1.25;
}

let fieldMetersL = 22;
let fieldMetersW = 15;
let canvasW = 280;
let canvasH = 340;

let scenes = [];
let currentSceneIdx = 0;
let memberNodes = {};
let selectedMemberId = null;
let savedFormations = [];
let isPlaying = false;

let pointShape = 'circle'; // 'circle' | 'person'
let is3DMode = false;

let undoStack = [];
let redoStack = [];

// State Audio
let audioElement = null;
let audioCtx = null;
let audioSourceNode = null;
let audioDestNode = null;

// State Three.js (3D) & Kontrol Sudut Kamera Orbit
let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeMembers = {};
let threeAnimId = null;

let camAzimuth = 0;      // Sudut putar horizontal (radian)
let camElevation = 0.78; // Sudut kemiringan vertikal (radian)
let camDistance = 26;    // Jarak kamera dari pusat lapang

// ============================================================================
// BAGIAN 2: INISIALISASI KANVAS 2D KONVA & LAYER
// ============================================================================
const stage = new Konva.Stage({
  container: 'canvas-container',
  width: canvasW,
  height: canvasH
});

const bgLayer = new Konva.Layer({ listening: false });
const gridLayer = new Konva.Layer({ listening: false });
const troopLayer = new Konva.Layer();
stage.add(bgLayer);
stage.add(gridLayer);
stage.add(troopLayer);

// ============================================================================
// BAGIAN 3: CUSTOM POP-UP MODAL (NOTIFIKASI, KONFIRMASI & INPUT NAMA)
// ============================================================================
function showPopup(title, message, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('customModal');
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');
    const btnOk = document.getElementById('modalConfirm');
    const btnCancel = document.getElementById('modalCancel');
    const inputEl = document.getElementById('modalInput');

    titleEl.innerText = title;
    msgEl.innerText = message;
    overlay.classList.remove('hidden');
    btnCancel.classList.toggle('hidden', !options.isConfirm && !options.isPrompt);

    if (options.isPrompt) {
      inputEl.classList.remove('hidden');
      inputEl.value = options.defaultValue || '';
      setTimeout(() => inputEl.focus(), 50);
    } else {
      inputEl.classList.add('hidden');
    }

    const cleanup = (confirmed) => {
      overlay.classList.add('hidden');
      btnOk.onclick = null;
      btnCancel.onclick = null;
      if (options.isPrompt) {
        resolve(confirmed ? inputEl.value.trim() : null);
      } else {
        resolve(confirmed);
      }
    };

    btnOk.onclick = () => cleanup(true);
    btnCancel.onclick = () => cleanup(false);
  });
}

// ============================================================================
// BAGIAN 4: SISTEM RIWAYAT UNDO & REDO
// ============================================================================
function saveHistoryState() {
  undoStack.push(JSON.stringify({ scenes, currentSceneIdx }));
  if (undoStack.length > 25) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  const btnU = document.getElementById('btnUndo');
  const btnR = document.getElementById('btnRedo');
  if (btnU) btnU.disabled = undoStack.length === 0;
  if (btnR) btnR.disabled = redoStack.length === 0;
}

document.getElementById('btnUndo').addEventListener('click', () => {
  if (undoStack.length === 0) return;
  redoStack.push(JSON.stringify({ scenes, currentSceneIdx }));
  const prev = JSON.parse(undoStack.pop());
  scenes = prev.scenes;
  currentSceneIdx = prev.currentSceneIdx;
  rebuildCanvas();
  updateHistoryButtons();
  setStatus("Undo");
});

document.getElementById('btnRedo').addEventListener('click', () => {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify({ scenes, currentSceneIdx }));
  const next = JSON.parse(redoStack.pop());
  scenes = next.scenes;
  currentSceneIdx = next.currentSceneIdx;
  rebuildCanvas();
  updateHistoryButtons();
  setStatus("Redo");
});

// ============================================================================
// BAGIAN 5: UKURAN LAPANG, GRID METERAN & SKALA TITIK PROPORSIONAL
// ============================================================================
function getMemberRadius() {
  const meterPx = Math.min(canvasW / fieldMetersW, canvasH / fieldMetersL);
  return Math.max(5, Math.min(11, Math.round(meterPx * 0.38)));
}

function calculateCanvasDimensions() {
  const winW = window.innerWidth || 360;
  const winH = window.innerHeight || 640;
  const maxW = Math.max(200, Math.min(winW - 58, 500));
  const maxH = Math.max(200, Math.min(winH - 355, 365));
  const ratio = fieldMetersW / fieldMetersL;

  if (maxW / maxH > ratio) {
    canvasH = maxH;
    canvasW = Math.round(maxH * ratio);
  } else {
    canvasW = maxW;
    canvasH = Math.round(maxW / ratio);
  }

  stage.width(canvasW);
  stage.height(canvasH);
  document.getElementById('fieldLabel').innerText = `ARAH DEWAN JURI / DP (${fieldMetersL}m x ${fieldMetersW}m)`;
  drawFieldGrid();

  if (is3DMode) {
    resize3DView();
  }
}

function drawFieldGrid() {
  bgLayer.destroyChildren();
  gridLayer.clearCache();
  gridLayer.destroyChildren();

  bgLayer.add(new Konva.Rect({
    x: 0,
    y: 0,
    width: canvasW,
    height: canvasH,
    fill: '#1b4332'
  }));
  bgLayer.draw();

  const stepX = canvasW / fieldMetersW;
  const stepY = canvasH / fieldMetersL;

  for (let i = 1; i < fieldMetersW; i++) {
    gridLayer.add(new Konva.Line({
      points: [i * stepX, 0, i * stepX, canvasH],
      stroke: i % 5 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
      strokeWidth: 1,
      perfectDrawEnabled: false
    }));
  }

  for (let j = 1; j < fieldMetersL; j++) {
    gridLayer.add(new Konva.Line({
      points: [0, j * stepY, canvasW, j * stepY],
      stroke: j % 5 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
      strokeWidth: 1,
      perfectDrawEnabled: false
    }));
  }

  gridLayer.add(new Konva.Circle({
    x: canvasW / 2,
    y: canvasH / 2,
    radius: 3.5,
    fill: '#facc15',
    perfectDrawEnabled: false
  }));

  gridLayer.cache();
  gridLayer.draw();
}

document.getElementById('btnApplyField').addEventListener('click', () => {
  const l = parseInt(document.getElementById('fieldLength').value);
  const w = parseInt(document.getElementById('fieldWidth').value);
  if (!l || !w || l < 5 || w < 5) {
    showPopup("Ukuran Tidak Valid", "Masukkan panjang dan lebar minimal 5 meter.");
    return;
  }
  fieldMetersL = l;
  fieldMetersW = w;
  camDistance = Math.max(fieldMetersL, fieldMetersW) * 1.25;
  calculateCanvasDimensions();
  rebuildCanvas();
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus(`Lapang: ${l}m x ${w}m`);
});

// ============================================================================
// BAGIAN 6: MANAJEMEN PASUKAN 2D (BENTUK LINGKARAN / ORANG, NAMA & HAPUS)
// ============================================================================
document.getElementById('btnToggleShape').addEventListener('click', () => {
  pointShape = pointShape === 'circle' ? 'person' : 'circle';
  document.getElementById('btnToggleShape').innerText = pointShape === 'circle' ? '👤 Orang' : '⚪ Bulat';
  rebuildCanvas();
  setStatus(pointShape === 'person' ? "Bentuk: Orang" : "Bentuk: Lingkaran");
});

function createDefaultFormation() {
  const members = [];
  const stepX = canvasW / fieldMetersW;
  const stepY = canvasH / fieldMetersL;
  const gapX = Math.max(15, stepX * 1.1);
  const gapY = Math.max(15, stepY * 1.1);
  const startX = canvasW / 2 - gapX;
  const centerY = Math.round(canvasH / 2);
  const startY = centerY - (gapY * 2);

  members.push({
    id: 'D',
    label: 'D',
    color: '#ef4444',
    x: Math.round(Math.max(16, startX - gapX * 1.25)),
    y: centerY
  });

  let num = 1;
  for (let saf = 0; saf < 5; saf++) {
    for (let ban = 0; ban < 3; ban++) {
      members.push({
        id: 'P' + num,
        label: String(num),
        color: '#2563eb',
        x: Math.round(startX + (ban * gapX)),
        y: Math.round(startY + (saf * gapY))
      });
      num++;
    }
  }
  return members;
}

function selectMember(id) {
  selectedMemberId = id;
  document.getElementById('btnDeleteSelected').disabled = !id;
  document.getElementById('btnRenameMember').disabled = !id;

  Object.keys(memberNodes).forEach(key => {
    const mainShape = memberNodes[key].findOne('.mainBody');
    if (mainShape) {
      mainShape.stroke(key === id ? '#facc15' : '#ffffff');
      mainShape.strokeWidth(key === id ? 2.2 : 1.5);
    }
  });
  troopLayer.batchDraw();
}

stage.on('click tap', (e) => {
  if (e.target === stage) selectMember(null);
});

function rebuildCanvas() {
  troopLayer.destroyChildren();
  memberNodes = {};
  const prevSelected = selectedMemberId;
  renderScene(currentSceneIdx, false);
  if (prevSelected && memberNodes[prevSelected]) {
    selectMember(prevSelected);
  } else {
    selectMember(null);
  }
}

function buildMemberNode(m, r) {
  const group = new Konva.Group({
    x: m.x,
    y: m.y,
    draggable: true
  });

  if (pointShape === 'person') {
    const shoulders = new Konva.Ellipse({
      name: 'mainBody',
      radiusX: r * 1.25,
      radiusY: r * 0.65,
      fill: m.color,
      stroke: '#ffffff',
      strokeWidth: 1.5,
      perfectDrawEnabled: false
    });

    const head = new Konva.Circle({
      y: -r * 0.15,
      radius: r * 0.52,
      fill: '#fde047',
      stroke: '#1e293b',
      strokeWidth: 1,
      listening: false,
      perfectDrawEnabled: false
    });

    const text = new Konva.Text({
      name: 'labelText',
      text: m.label,
      y: r * 0.85,
      fontSize: Math.max(6, Math.round(r * 0.72)),
      fontStyle: 'bold',
      fill: '#ffffff',
      width: 60,
      align: 'center',
      offsetX: 30,
      listening: false,
      perfectDrawEnabled: false
    });

    group.add(shoulders);
    group.add(head);
    group.add(text);
  } else {
    const circle = new Konva.Circle({
      name: 'mainBody',
      radius: r,
      fill: m.color,
      stroke: '#ffffff',
      strokeWidth: 1.5,
      perfectDrawEnabled: false
    });

    // Ukuran angka proporsional di dalam lingkaran (tidak kebesaran)
    const fontSize = m.label.length > 2
      ? Math.max(5, Math.round(r * 0.55))
      : Math.max(6, Math.round(r * 0.68));

    const text = new Konva.Text({
      name: 'labelText',
      text: m.label,
      fontSize: fontSize,
      fontStyle: 'bold',
      fill: '#ffffff',
      width: r * 2.2,
      align: 'center',
      offsetX: r * 1.1,
      offsetY: fontSize * 0.48,
      listening: false,
      perfectDrawEnabled: false
    });

    group.add(circle);
    group.add(text);
  }

  group.on('pointerdown', (e) => {
    e.cancelBubble = true;
    selectMember(m.id);
  });

  group.on('dragstart', () => {
    saveHistoryState();
  });

  group.on('dragend', () => {
    const target = scenes[currentSceneIdx].members.find(item => item.id === m.id);
    if (target) {
      target.x = Math.round(group.x());
      target.y = Math.round(group.y());
    }
  });

  return group;
}

function renderScene(sceneIndex, animate = true) {
  currentSceneIdx = sceneIndex;
  const sceneData = scenes[sceneIndex];
  if (!sceneData) return;

  const r = getMemberRadius();
  const currentIds = sceneData.members.map(m => m.id);
  Object.keys(memberNodes).forEach(id => {
    if (!currentIds.includes(id)) {
      memberNodes[id].destroy();
      delete memberNodes[id];
    }
  });

  sceneData.members.forEach(m => {
    if (!memberNodes[m.id]) {
      const node = buildMemberNode(m, r);
      troopLayer.add(node);
      memberNodes[m.id] = node;
    } else {
      const lbl = memberNodes[m.id].findOne('.labelText');
      if (lbl) lbl.text(m.label);

      if (animate) {
        memberNodes[m.id].to({ x: m.x, y: m.y, duration: 0.25 });
      } else {
        memberNodes[m.id].position({ x: m.x, y: m.y });
      }
    }
  });

  troopLayer.draw();
  renderTimelineUI();

  if (is3DMode) {
    sync3DPositions(animate);
  }
}

document.getElementById('btnAddMember').addEventListener('click', () => {
  saveHistoryState();
  const nextNum = scenes[currentSceneIdx].members.length + 1;
  const newMember = {
    id: 'P' + Date.now(),
    label: String(nextNum),
    color: '#0284c7',
    x: Math.round(canvasW / 2),
    y: Math.round(canvasH / 2)
  };
  scenes.forEach(sc => sc.members.push({ ...newMember }));
  renderScene(currentSceneIdx, false);
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus(`+ Titik ${nextNum}`);
});

document.getElementById('btnRenameMember').addEventListener('click', async () => {
  if (!selectedMemberId) return;
  const currentMember = scenes[currentSceneIdx].members.find(m => m.id === selectedMemberId);
  if (!currentMember) return;

  const newName = await showPopup(
    "Nama Titik Pasukan",
    "Masukkan nomor atau nama panggilan (maks. 12 huruf):",
    { isPrompt: true, defaultValue: currentMember.label }
  );

  if (newName === null || newName === "") return;

  saveHistoryState();
  scenes.forEach(sc => {
    const item = sc.members.find(m => m.id === selectedMemberId);
    if (item) item.label = newName;
  });

  rebuildCanvas();
  setStatus(`Nama diubah: ${newName}`);
});

document.getElementById('btnDeleteSelected').addEventListener('click', async () => {
  if (!selectedMemberId) return;
  const ok = await showPopup("Hapus Titik", "Hapus titik yang dipilih dari semua hitungan?", { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes.forEach(sc => {
    sc.members = sc.members.filter(m => m.id !== selectedMemberId);
  });
  selectMember(null);
  renderScene(currentSceneIdx, false);
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus("Titik dihapus");
});

document.getElementById('btnClearAll').addEventListener('click', async () => {
  const ok = await showPopup("Hapus Semua", "Kosongkan seluruh titik pasukan di lapangan?", { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: [] }];
  currentSceneIdx = 0;
  rebuildCanvas();
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus("Lapang kosong");
});

document.getElementById('btnResetPos').addEventListener('click', async () => {
  const ok = await showPopup("Reset Formasi", "Kembalikan ke formasi awal (15 pasukan + Danton)?", { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: createDefaultFormation() }];
  currentSceneIdx = 0;
  rebuildCanvas();
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus("Reset selesai");
});

// ============================================================================
// BAGIAN 7: MODE SIMULASI 3D, KONSOL ARAH & ORBIT KAMERA 360°
// ============================================================================
document.getElementById('btnToggle3D').addEventListener('click', () => {
  if (typeof THREE === 'undefined') {
    showPopup("Info 3D", "Library 3D belum siap. Pastikan koneksi internet aktif saat pertama membuka aplikasi.");
    return;
  }

  is3DMode = !is3DMode;
  const wrapper2D = document.getElementById('fieldWrapper2D');
  const c3d = document.getElementById('canvas-3d-container');
  const camConsole = document.getElementById('cameraConsole3D');
  const btn = document.getElementById('btnToggle3D');

  if (is3DMode) {
    wrapper2D.classList.add('hidden');
    c3d.classList.remove('hidden');
    camConsole.classList.remove('hidden');
    btn.innerText = '🗺️ 2D';
    init3DScene();
    setStatus("Mode 3D Aktif");
  } else {
    c3d.classList.add('hidden');
    camConsole.classList.add('hidden');
    wrapper2D.classList.remove('hidden');
    btn.innerText = '🧊 3D';
    stop3DLoop();
    setStatus("Mode 2D Aktif");
  }
});

function updateCamera3DPosition() {
  if (!threeCamera) return;
  const x = camDistance * Math.sin(camElevation) * Math.sin(camAzimuth);
  const y = camDistance * Math.cos(camElevation);
  const z = camDistance * Math.sin(camElevation) * Math.cos(camAzimuth);
  threeCamera.position.set(x, Math.max(2, y), z);
  threeCamera.lookAt(0, 0, 0);
}

// Event Tombol Konsol Arah Kamera 3D
document.querySelectorAll('.cam-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    document.querySelectorAll('.cam-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (view === 'juri') {
      camAzimuth = 0;
      camElevation = 0.78;
    } else if (view === 'belakang') {
      camAzimuth = Math.PI;
      camElevation = 0.78;
    } else if (view === 'kiri') {
      camAzimuth = -Math.PI / 2;
      camElevation = 0.78;
    } else if (view === 'kanan') {
      camAzimuth = Math.PI / 2;
      camElevation = 0.78;
    } else if (view === 'atas') {
      camAzimuth = 0;
      camElevation = 0.05;
    }
    updateCamera3DPosition();
  });
});

document.getElementById('btnCamZoomIn').addEventListener('click', () => {
  camDistance = Math.max(10, camDistance - 3);
  updateCamera3DPosition();
});

document.getElementById('btnCamZoomOut').addEventListener('click', () => {
  camDistance = Math.min(60, camDistance + 3);
  updateCamera3DPosition();
});

function init3DScene() {
  const container = document.getElementById('canvas-3d-container');
  container.style.width = canvasW + 'px';
  container.style.height = canvasH + 'px';

  if (!threeRenderer) {
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0f172a);

    threeCamera = new THREE.PerspectiveCamera(42, canvasW / canvasH, 0.1, 200);
    camDistance = Math.max(fieldMetersL, fieldMetersW) * 1.25;
    updateCamera3DPosition();

    threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    threeRenderer.setSize(canvasW, canvasH);
    container.innerHTML = '';
    container.appendChild(threeRenderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.78);
    threeScene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.68);
    dirLight.position.set(10, 25, 15);
    threeScene.add(dirLight);

    // Geser Jari / Mouse di Kanvas 3D untuk Memutar Sudut Pandang Bebas
    let isDraggingCam = false;
    let prevPointerX = 0;
    let prevPointerY = 0;

    threeRenderer.domElement.addEventListener('pointerdown', (e) => {
      isDraggingCam = true;
      prevPointerX = e.clientX;
      prevPointerY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!isDraggingCam || !is3DMode) return;
      const dx = e.clientX - prevPointerX;
      const dy = e.clientY - prevPointerY;
      prevPointerX = e.clientX;
      prevPointerY = e.clientY;

      camAzimuth -= dx * 0.012;
      camElevation = Math.max(0.05, Math.min(1.42, camElevation - dy * 0.01));
      updateCamera3DPosition();
    });

    window.addEventListener('pointerup', () => {
      isDraggingCam = false;
    });
  } else {
    resize3DView();
  }

  rebuild3DFieldAndTroops();
  start3DLoop();
}

function resize3DView() {
  if (!threeRenderer) return;
  const container = document.getElementById('canvas-3d-container');
  container.style.width = canvasW + 'px';
  container.style.height = canvasH + 'px';
  threeCamera.aspect = canvasW / canvasH;
  updateCamera3DPosition();
  threeCamera.updateProjectionMatrix();
  threeRenderer.setSize(canvasW, canvasH);
}

function create3DHumanFigure(member) {
  const group = new THREE.Group();
  const isDanton = member.id === 'D';
  const uniformColor = isDanton ? 0xdc2626 : 0xf8fafc;
  const pantsColor = isDanton ? 0x991b1b : 0x1e3a8a;

  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.55, 0.2),
    new THREE.MeshLambertMaterial({ color: uniformColor })
  );
  torso.position.y = 0.85;
  group.add(torso);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 10, 10),
    new THREE.MeshLambertMaterial({ color: 0xfcd34d })
  );
  head.position.y = 1.28;
  group.add(head);

  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10),
    new THREE.MeshLambertMaterial({ color: 0xdc2626 })
  );
  cap.position.y = 1.38;
  group.add(cap);

  const legGeo = new THREE.BoxGeometry(0.13, 0.58, 0.14);
  const legMat = new THREE.MeshLambertMaterial({ color: pantsColor });

  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.1, 0.29, 0);
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.1, 0.29, 0);
  group.add(rightLeg);

  const armGeo = new THREE.BoxGeometry(0.1, 0.5, 0.11);
  const armMat = new THREE.MeshLambertMaterial({ color: uniformColor });

  const leftArm = new THREE.Mesh(armGeo, armMat);
  leftArm.position.set(-0.24, 0.85, 0);
  group.add(leftArm);

  const rightArm = new THREE.Mesh(armGeo, armMat);
  rightArm.position.set(0.24, 0.85, 0);
  group.add(rightArm);

  group.userData = { leftLeg, rightLeg, leftArm, rightArm, targetPos: new THREE.Vector3() };
  return group;
}

function map2DTo3D(x2d, y2d) {
  const x3d = ((x2d / canvasW) - 0.5) * fieldMetersW;
  const z3d = ((y2d / canvasH) - 0.5) * fieldMetersL;
  return { x: x3d, z: z3d };
}

function rebuild3DFieldAndTroops() {
  if (!threeScene) return;
  for (let i = threeScene.children.length - 1; i >= 0; i--) {
    if (!(threeScene.children[i] instanceof THREE.Light)) {
      threeScene.remove(threeScene.children[i]);
    }
  }
  threeMembers = {};

  // Lantai Lapangan Utama (22m x 15m Utuh)
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(fieldMetersW, fieldMetersL),
    new THREE.MeshLambertMaterial({ color: 0x1b4332 })
  );
  plane.rotation.x = -Math.PI / 2;
  threeScene.add(plane);

  // Garis Tepian Putih Utama Lapangan (22m x 15m)
  const mainFieldBorder = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(fieldMetersW, fieldMetersL)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  mainFieldBorder.rotation.x = -Math.PI / 2;
  mainFieldBorder.position.y = 0.015;
  threeScene.add(mainFieldBorder);

  // Kotak Khusus Danton dengan 4 Garis Tepi Utuh di Luar Garis Kiri (z = 0)
  const dantonBox = new THREE.Mesh(
    new THREE.PlaneGeometry(1.4, 1.6),
    new THREE.MeshLambertMaterial({ color: 0x1b4332 })
  );
  dantonBox.rotation.x = -Math.PI / 2;
  dantonBox.position.set(-(fieldMetersW / 2) - 0.7, 0.01, 0);
  threeScene.add(dantonBox);

  const dantonBorder = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.4, 1.6)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  dantonBorder.rotation.x = -Math.PI / 2;
  dantonBorder.position.set(-(fieldMetersW / 2) - 0.7, 0.018, 0);
  threeScene.add(dantonBorder);

  const maxDim = Math.max(fieldMetersW, fieldMetersL);
  const gridHelper = new THREE.GridHelper(maxDim, maxDim, 0xffffff, 0x2d6a4f);
  gridHelper.scale.set(fieldMetersW / maxDim, 1, fieldMetersL / maxDim);
  gridHelper.position.y = 0.01;
  threeScene.add(gridHelper);

  const sceneData = scenes[currentSceneIdx];
  if (!sceneData) return;

  sceneData.members.forEach(m => {
    const fig = create3DHumanFigure(m);
    const pos = map2DTo3D(m.x, m.y);
    fig.position.set(pos.x, 0, pos.z);
    fig.userData.targetPos.set(pos.x, 0, pos.z);
    threeScene.add(fig);
    threeMembers[m.id] = fig;
  });
}

function sync3DPositions(animate = true) {
  const sceneData = scenes[currentSceneIdx];
  if (!sceneData) return;

  sceneData.members.forEach(m => {
    const fig = threeMembers[m.id];
    if (fig) {
      const pos = map2DTo3D(m.x, m.y);
      fig.userData.targetPos.set(pos.x, 0, pos.z);
      if (!animate) {
        fig.position.set(pos.x, 0, pos.z);
      }
    }
  });
}

function start3DLoop() {
  if (threeAnimId) return;
  const clock = new THREE.Clock();

  const animate = () => {
    threeAnimId = requestAnimationFrame(animate);
    const t = clock.getElapsedTime() * 10;

    Object.values(threeMembers).forEach(fig => {
      const target = fig.userData.targetPos;
      const dx = target.x - fig.position.x;
      const dz = target.z - fig.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.03) {
        fig.position.x += dx * 0.08;
        fig.position.z += dz * 0.08;
        fig.rotation.y = Math.atan2(dx, dz);

        const swing = Math.sin(t) * 0.65;
        fig.userData.leftLeg.rotation.x = swing;
        fig.userData.rightLeg.rotation.x = -swing;
        fig.userData.leftArm.rotation.x = -swing * 0.85;
        fig.userData.rightArm.rotation.x = swing * 0.85;
      } else {
        fig.position.x = target.x;
        fig.position.z = target.z;
        fig.rotation.y = Math.PI;
        fig.userData.leftLeg.rotation.x = 0;
        fig.userData.rightLeg.rotation.x = 0;
        fig.userData.leftArm.rotation.x = 0;
        fig.userData.rightArm.rotation.x = 0;
      }
    });

    threeRenderer.render(threeScene, threeCamera);
  };
  animate();
}

function stop3DLoop() {
  if (threeAnimId) {
    cancelAnimationFrame(threeAnimId);
    threeAnimId = null;
  }
}

// ============================================================================
// BAGIAN 8: AUDIO / LAGU IRINGAN
// ============================================================================
const audioInput = document.getElementById('audioInput');

document.getElementById('btnAudio').addEventListener('click', () => {
  audioInput.click();
});

audioInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;

  if (audioElement) {
    audioElement.pause();
    URL.revokeObjectURL(audioElement.src);
  }

  audioElement = new Audio(URL.createObjectURL(file));
  audioElement.crossOrigin = "anonymous";

  document.getElementById('audioFileName').innerText = "🎵 " + file.name;
  document.getElementById('audioBadge').classList.remove('hidden');
  setStatus("Audio siap");
});

document.getElementById('btnRemoveAudio').addEventListener('click', () => {
  if (audioElement) {
    audioElement.pause();
    audioElement = null;
  }
  audioInput.value = "";
  document.getElementById('audioBadge').classList.add('hidden');
  setStatus("Audio dihapus");
});

// ============================================================================
// BAGIAN 9: TIMELINE HITUNGAN, PLAY ANIMASI & DOWNLOAD VIDEO
// ============================================================================
function renderTimelineUI() {
  const listEl = document.getElementById('sceneList');
  listEl.innerHTML = '';

  scenes.forEach((sc, idx) => {
    const card = document.createElement('div');
    card.className = `scene-card ${idx === currentSceneIdx ? 'active' : ''}`;
    card.innerText = sc.name;
    card.onclick = () => {
      if (!isPlaying) renderScene(idx);
    };
    listEl.appendChild(card);
  });
}

document.getElementById('btnAddScene').addEventListener('click', () => {
  saveHistoryState();
  const lastScene = scenes[scenes.length - 1];
  scenes.push({
    name: `Hitungan ${scenes.length + 1}`,
    members: JSON.parse(JSON.stringify(lastScene.members))
  });
  renderScene(scenes.length - 1);
  setStatus(`+ Hitungan ${scenes.length}`);
});

async function runFormationPlayback() {
  isPlaying = true;
  if (audioElement) {
    audioElement.currentTime = 0;
    audioElement.play().catch(() => {});
  }

  renderScene(0, false);
  await new Promise(r => setTimeout(r, 400));

  for (let i = 1; i < scenes.length; i++) {
    currentSceneIdx = i;
    renderTimelineUI();

    scenes[i].members.forEach(m => {
      if (memberNodes[m.id]) {
        memberNodes[m.id].to({
          x: m.x,
          y: m.y,
          duration: 1.0,
          easing: Konva.Easings.EaseInOut
        });
      }
    });

    if (is3DMode) {
      sync3DPositions(true);
    }

    await new Promise(resolve => setTimeout(resolve, 1150));
  }

  if (audioElement) {
    audioElement.pause();
  }
  isPlaying = false;
}

document.getElementById('btnPlay').addEventListener('click', async () => {
  if (isPlaying) return;
  if (scenes.length < 2) {
    showPopup("Info Animasi", "Tambahkan minimal 2 Hitungan terlebih dahulu untuk memutar formasi.");
    return;
  }

  setStatus("Memutar...");
  await runFormationPlayback();
  setStatus("Selesai");
});

document.getElementById('btnExportVideo').addEventListener('click', async () => {
  if (isPlaying) return;
  if (scenes.length < 2) {
    showPopup("Info Video", "Tambahkan minimal 2 Hitungan terlebih dahulu sebelum mengunduh video.");
    return;
  }

  setStatus("Merekam video...");

  const recordCanvas = document.createElement('canvas');
  recordCanvas.width = canvasW;
  recordCanvas.height = canvasH;
  const ctx = recordCanvas.getContext('2d');

  let animFrameId;
  const drawCombinedFrame = () => {
    ctx.clearRect(0, 0, recordCanvas.width, recordCanvas.height);
    if (is3DMode && threeRenderer) {
      ctx.drawImage(threeRenderer.domElement, 0, 0, recordCanvas.width, recordCanvas.height);
    } else {
      stage.getLayers().forEach(layer => {
        ctx.drawImage(layer.getCanvas()._canvas, 0, 0, recordCanvas.width, recordCanvas.height);
      });
    }
    animFrameId = requestAnimationFrame(drawCombinedFrame);
  };
  drawCombinedFrame();

  const videoStream = recordCanvas.captureStream(30);

  if (audioElement) {
    try {
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioSourceNode = audioCtx.createMediaElementSource(audioElement);
        audioDestNode = audioCtx.createMediaStreamDestination();
        audioSourceNode.connect(audioDestNode);
        audioSourceNode.connect(audioCtx.destination);
      }
      if (audioCtx.state === 'suspended') await audioCtx.resume();
      audioDestNode.stream.getAudioTracks().forEach(track => videoStream.addTrack(track));
    } catch (e) {}
  }

  let mimeType = 'video/mp4';
  let ext = 'mp4';
  if (typeof MediaRecorder !== 'undefined' && !MediaRecorder.isTypeSupported('video/mp4')) {
    mimeType = 'video/webm';
    ext = 'webm';
  }

  const recorder = new MediaRecorder(videoStream, { mimeType });
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    cancelAnimationFrame(animFrameId);
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = (document.getElementById('formationName').value.trim() || 'Formasi_Paskibra').replace(/\s+/g, '_');
    a.href = url;
    a.download = `${fileName}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Video terunduh");
    showPopup("Video Selesai", `Video animasi formasi berhasil diunduh (${fileName}.${ext}).`);
  };

  recorder.start();
  await runFormationPlayback();
  await new Promise(r => setTimeout(r, 300));
  recorder.stop();
});

// ============================================================================
// BAGIAN 10: KONEKSI DATABASE GOOGLE APPS SCRIPT (SIMPAN, MUAT & HAPUS)
// ============================================================================
function setStatus(msg) {
  const el = document.getElementById('statusText');
  if (el) el.innerText = msg;
}

document.getElementById('btnSave').addEventListener('click', async () => {
  const nama = document.getElementById('formationName').value.trim();
  if (!nama) {
    showPopup("Nama Kosong", "Isi nama formasi terlebih dahulu sebelum menyimpan.");
    return;
  }

  setStatus("Menyimpan...");
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "save", nama, dataJson: scenes })
    });
    const result = await response.json();
    if (result.status === "success") {
      setStatus("Tersimpan");
      showPopup("Berhasil", result.message);
      loadSavedFormations();
    } else {
      showPopup("Gagal", result.message);
    }
  } catch (err) {
    setStatus("Gagal");
    showPopup("Koneksi Gagal", "Tidak dapat terhubung ke Google Sheets.");
  }
});

async function loadSavedFormations() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.includes("TEMPEL_URL")) return;
  try {
    const res = await fetch(APPS_SCRIPT_URL);
    const json = await res.json();
    if (json.status === "success") {
      savedFormations = json.data;
      const select = document.getElementById('savedList');
      select.innerHTML = '<option value="">-- Muat --</option>';
      savedFormations.forEach((item, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.innerText = `${item.nama} (${item.tanggal})`;
        select.appendChild(opt);
      });
    }
  } catch (e) {}
}

document.getElementById('savedList').addEventListener('change', (e) => {
  const idx = e.target.value;
  if (idx === "") return;
  saveHistoryState();
  const selected = savedFormations[idx];
  document.getElementById('formationName').value = selected.nama;
  scenes = selected.dataJson;
  currentSceneIdx = 0;
  rebuildCanvas();
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus(`Dimuat: ${selected.nama}`);
});

document.getElementById('btnDeleteProject').addEventListener('click', async () => {
  const select = document.getElementById('savedList');
  const idx = select.value;
  if (idx === "") {
    showPopup("Pilih Project", "Pilih formasi yang ingin dihapus dari daftar Muat terlebih dahulu.");
    return;
  }

  const targetProject = savedFormations[idx];
  const ok = await showPopup("Hapus Project", `Hapus permanen formasi "${targetProject.nama}" dari cloud?`, { isConfirm: true });
  if (!ok) return;

  setStatus("Menghapus...");
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "delete", nama: targetProject.nama })
    });
    const result = await response.json();
    if (result.status === "success") {
      document.getElementById('formationName').value = "";
      setStatus("Project dihapus");
      showPopup("Terhapus", result.message);
      loadSavedFormations();
    } else {
      showPopup("Gagal", result.message);
    }
  } catch (err) {
    setStatus("Gagal");
    showPopup("Koneksi Gagal", "Tidak dapat terhubung ke Google Sheets untuk menghapus project.");
  }
});

// ============================================================================
// BAGIAN 11: INISIALISASI UTAMA SAAT HALAMAN DIMUAT
// ============================================================================
window.addEventListener('DOMContentLoaded', () => {
  calculateCanvasDimensions();
  scenes = [{
    name: "Hitungan 1",
    members: createDefaultFormation()
  }];
  renderScene(0, false);
  loadSavedFormations();
});
