// ============================================================================
// BAGIAN 1: KONFIGURASI API GOOGLE APPS SCRIPT & STATE GLOBAL
// ============================================================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbypOugpXmLsnd_Q4dYber4O6V_xDt4JrDeCaiA-RgrirMCDtHpaJNxewlAfiMA6MhACiA/exec";

if (typeof Konva !== 'undefined') {
  Konva.pixelRatio = 1.25;
}

let fieldMetersL = 22; // Sisi panjang horizontal (landscape)
let fieldMetersW = 15; // Sisi lebar vertikal (landscape)
let canvasW = 360;
let canvasH = 210;

let scenes = [];
let currentSceneIdx = 0;
let memberNodes = {};
let selectedMemberIds = []; // Mendukung multi-select / blok titik
let isBlockSelectMode = false;
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

// State Three.js (3D) & Kontrol Sudut Kamera Lomba
let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeMembers = {};
let threeAnimId = null;

let camAzimuth = 0.25;    // Sudut tribun lomba (serong menghadap lapangan & DP)
let camElevation = 0.88;  // Sudut kemiringan kamera tribun
let camDistance = 24;

// ============================================================================
// BAGIAN 2: INISIALISASI KANVAS 2D KONVA & LAYER (TERMASUK KOTAK BLOK)
// ============================================================================
const stage = new Konva.Stage({
  container: 'canvas-container',
  width: canvasW,
  height: canvasH
});

const bgLayer = new Konva.Layer({ listening: false });
const gridLayer = new Konva.Layer({ listening: false });
const troopLayer = new Konva.Layer();
const uiLayer = new Konva.Layer({ listening: false });

stage.add(bgLayer);
stage.add(gridLayer);
stage.add(troopLayer);
stage.add(uiLayer);

// Kotak Seleksi Blok (Rubber-band Selection)
const selectionRect = new Konva.Rect({
  fill: 'rgba(250, 204, 21, 0.22)',
  stroke: '#facc15',
  strokeWidth: 1.5,
  dash: [4, 3],
  visible: false
});
uiLayer.add(selectionRect);

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
// BAGIAN 5: UKURAN LAPANG LANDSCAPE, GRID METERAN & SKALA TITIK
// ============================================================================
function getMemberRadius() {
  const meterPx = Math.min(canvasW / fieldMetersL, canvasH / fieldMetersW);
  return Math.max(5, Math.min(10, Math.round(meterPx * 0.36)));
}

function calculateCanvasDimensions() {
  const winW = window.innerWidth || 360;
  const winH = window.innerHeight || 640;

  // Dimensi Landscape (16:9 / proporsional lapang melebar horizontal)
  const maxW = Math.max(260, Math.min(winW - 24, 640));
  const maxH = Math.max(155, Math.min(winH - 365, 340));
  const ratio = fieldMetersL / fieldMetersW;

  if (maxW / maxH > ratio) {
    canvasH = maxH;
    canvasW = Math.round(maxH * ratio);
  } else {
    canvasW = maxW;
    canvasH = Math.round(maxW / ratio);
  }

  stage.width(canvasW);
  stage.height(canvasH);
  document.getElementById('fieldLabel').innerText = `ARAH DEWAN JURI / DP — KANAN (${fieldMetersL}m x ${fieldMetersW}m)`;
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

  // Horizontal = Panjang (fieldMetersL), Vertikal = Lebar (fieldMetersW)
  const stepX = canvasW / fieldMetersL;
  const stepY = canvasH / fieldMetersW;

  for (let i = 1; i < fieldMetersL; i++) {
    gridLayer.add(new Konva.Line({
      points: [i * stepX, 0, i * stepX, canvasH],
      stroke: i % 5 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
      strokeWidth: 1,
      perfectDrawEnabled: false
    }));
  }

  for (let j = 1; j < fieldMetersW; j++) {
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
  camDistance = Math.max(fieldMetersL, fieldMetersW) * 1.1;
  calculateCanvasDimensions();
  rebuildCanvas();
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus(`Lapang: ${l}m x ${w}m`);
});

// ============================================================================
// BAGIAN 6: MANAJEMEN PASUKAN 2D, ARAH HADAP DEFAULT KE DANTON & BLOK TITIK
// ============================================================================
document.getElementById('btnToggleShape').addEventListener('click', () => {
  pointShape = pointShape === 'circle' ? 'person' : 'circle';
  document.getElementById('btnToggleShape').innerText = pointShape === 'circle' ? '👤 Orang' : '⚪ Bulat';
  rebuildCanvas();
  setStatus(pointShape === 'person' ? "Bentuk: Orang" : "Bentuk: Lingkaran");
});

// Toggle Mode Blok Banyak Titik
document.getElementById('btnSelectBox').addEventListener('click', () => {
  isBlockSelectMode = !isBlockSelectMode;
  const btn = document.getElementById('btnSelectBox');
  btn.classList.toggle('active-mode', isBlockSelectMode);
  setStatus(isBlockSelectMode ? "Mode Blok: Seret kotak di lapang" : "Mode Geser Titik");
});

// Helper sudut hadap default ke Danton (dalam radian di 3D)
function getFacingToDantonAngle(memberX, memberY, dantonX, dantonY) {
  const dx = dantonX - memberX;
  const dz = dantonY - memberY;
  return Math.atan2(dx, dz);
}

function createDefaultFormation() {
  const members = [];
  const stepX = canvasW / fieldMetersL;
  const stepY = canvasH / fieldMetersW;
  const gapX = Math.max(14, stepX * 1.15);
  const gapY = Math.max(14, stepY * 1.15);

  const centerX = Math.round(canvasW / 2);
  const centerY = Math.round(canvasH / 2);

  // Danton berada di sisi bawah tengah menghadap ke pasukan (atas / -Z)
  const dantonX = centerX;
  const dantonY = Math.round(Math.min(canvasH - 16, centerY + gapY * 2.6));

  members.push({
    id: 'D',
    label: 'D',
    color: '#ef4444',
    x: dantonX,
    y: dantonY,
    facing: Math.PI // Menghadap ke pasukan (atas)
  });

  // 15 Pasukan (3 Banjar x 5 Saf) menghadap ke Danton (bawah / facing = 0)
  const startX = centerX - (gapX * 2);
  const startY = centerY - gapY;
  let num = 1;
  for (let ban = 0; ban < 3; ban++) {
    for (let saf = 0; saf < 5; saf++) {
      const mx = Math.round(startX + (saf * gapX));
      const my = Math.round(startY + (ban * gapY));
      members.push({
        id: 'P' + num,
        label: String(num),
        color: '#2563eb',
        x: mx,
        y: my,
        facing: getFacingToDantonAngle(mx, my, dantonX, dantonY)
      });
      num++;
    }
  }
  return members;
}

function setSelectedMembers(ids) {
  selectedMemberIds = ids;
  document.getElementById('btnDeleteSelected').disabled = ids.length === 0;
  document.getElementById('btnRenameMember').disabled = ids.length !== 1;

  Object.keys(memberNodes).forEach(key => {
    const isSel = ids.includes(key);
    const mainShape = memberNodes[key].findOne('.mainBody');
    if (mainShape) {
      mainShape.stroke(isSel ? '#facc15' : '#ffffff');
      mainShape.strokeWidth(isSel ? 2.4 : 1.5);
    }
  });
  troopLayer.batchDraw();

  if (is3DMode) {
    update3DSelectionHighlight();
  }
}

// Logika Drag-Select Kotak Blok di Kanvas 2D
let selStartX = 0;
let selStartY = 0;
let isSelectingRect = false;

stage.on('pointerdown', (e) => {
  if (e.target === stage) {
    const pos = stage.getPointerPosition();
    if (!pos) return;

    if (isBlockSelectMode) {
      isSelectingRect = true;
      selStartX = pos.x;
      selStartY = pos.y;
      selectionRect.setAttrs({
        x: selStartX,
        y: selStartY,
        width: 0,
        height: 0,
        visible: true
      });
      uiLayer.batchDraw();
    } else {
      setSelectedMembers([]);
    }
  }
});

stage.on('pointermove', () => {
  if (!isSelectingRect) return;
  const pos = stage.getPointerPosition();
  if (!pos) return;

  selectionRect.setAttrs({
    x: Math.min(selStartX, pos.x),
    y: Math.min(selStartY, pos.y),
    width: Math.abs(pos.x - selStartX),
    height: Math.abs(pos.y - selStartY)
  });
  uiLayer.batchDraw();
});

stage.on('pointerup', () => {
  if (!isSelectingRect) return;
  isSelectingRect = false;
  const box = selectionRect.getClientRect();
  selectionRect.visible(false);
  uiLayer.batchDraw();

  const matched = [];
  scenes[currentSceneIdx].members.forEach(m => {
    if (
      m.x >= box.x &&
      m.x <= box.x + box.width &&
      m.y >= box.y &&
      m.y <= box.y + box.height
    ) {
      matched.push(m.id);
    }
  });

  setSelectedMembers(matched);
  if (matched.length > 0) {
    setStatus(`${matched.length} titik terblok`);
  }
});

function rebuildCanvas() {
  troopLayer.destroyChildren();
  memberNodes = {};
  const prevSelected = [...selectedMemberIds];
  renderScene(currentSceneIdx, false);
  const validSel = prevSelected.filter(id => memberNodes[id]);
  setSelectedMembers(validSel);
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
      fontSize: Math.max(6, Math.round(r * 0.7)),
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
    if (!selectedMemberIds.includes(m.id)) {
      setSelectedMembers([m.id]);
    }
  });

  // Geser Satu atau Seluruh Titik yang Terblok Secara Bersamaan
  let dragStartPositions = {};
  group.on('dragstart', () => {
    saveHistoryState();
    dragStartPositions = {};
    selectedMemberIds.forEach(id => {
      if (memberNodes[id]) {
        dragStartPositions[id] = { x: memberNodes[id].x(), y: memberNodes[id].y() };
      }
    });
  });

  group.on('dragmove', () => {
    const origin = dragStartPositions[m.id];
    if (!origin) return;
    const dx = group.x() - origin.x;
    const dy = group.y() - origin.y;

    selectedMemberIds.forEach(id => {
      if (id !== m.id && memberNodes[id] && dragStartPositions[id]) {
        memberNodes[id].position({
          x: dragStartPositions[id].x + dx,
          y: dragStartPositions[id].y + dy
        });
      }
    });
  });

  group.on('dragend', () => {
    const danton = scenes[currentSceneIdx].members.find(item => item.id === 'D');
    selectedMemberIds.forEach(id => {
      const target = scenes[currentSceneIdx].members.find(item => item.id === id);
      const node = memberNodes[id];
      if (target && node) {
        target.x = Math.round(node.x());
        target.y = Math.round(node.y());
        if (target.id !== 'D' && danton && target.customFacing !== true) {
          target.facing = getFacingToDantonAngle(target.x, target.y, danton.x, danton.y);
        }
      }
    });
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
  const danton = scenes[currentSceneIdx].members.find(item => item.id === 'D');
  const mx = Math.round(canvasW / 2);
  const my = Math.round(canvasH / 2);

  const newMember = {
    id: 'P' + Date.now(),
    label: String(nextNum),
    color: '#0284c7',
    x: mx,
    y: my,
    facing: danton ? getFacingToDantonAngle(mx, my, danton.x, danton.y) : 0
  };
  scenes.forEach(sc => sc.members.push({ ...newMember }));
  renderScene(currentSceneIdx, false);
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus(`+ Titik ${nextNum}`);
});

document.getElementById('btnRenameMember').addEventListener('click', async () => {
  if (selectedMemberIds.length !== 1) return;
  const targetId = selectedMemberIds[0];
  const currentMember = scenes[currentSceneIdx].members.find(m => m.id === targetId);
  if (!currentMember) return;

  const newName = await showPopup(
    "Nama Titik Pasukan",
    "Masukkan nomor atau nama panggilan (maks. 12 huruf):",
    { isPrompt: true, defaultValue: currentMember.label }
  );

  if (newName === null || newName === "") return;

  saveHistoryState();
  scenes.forEach(sc => {
    const item = sc.members.find(m => m.id === targetId);
    if (item) item.label = newName;
  });

  rebuildCanvas();
  setStatus(`Nama diubah: ${newName}`);
});

document.getElementById('btnDeleteSelected').addEventListener('click', async () => {
  if (selectedMemberIds.length === 0) return;
  const count = selectedMemberIds.length;
  const ok = await showPopup("Hapus Titik", `Hapus ${count} titik terpilih dari semua hitungan?`, { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes.forEach(sc => {
    sc.members = sc.members.filter(m => !selectedMemberIds.includes(m.id));
  });
  setSelectedMembers([]);
  renderScene(currentSceneIdx, false);
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus(`${count} titik dihapus`);
});

document.getElementById('btnClearAll').addEventListener('click', async () => {
  const ok = await showPopup("Hapus Semua", "Kosongkan seluruh titik pasukan di lapangan?", { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: [] }];
  currentSceneIdx = 0;
  setSelectedMembers([]);
  rebuildCanvas();
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus("Lapang kosong");
});

document.getElementById('btnResetPos').addEventListener('click', async () => {
  const ok = await showPopup("Reset Formasi", "Kembalikan ke formasi awal (15 pasukan menghadap Danton)?", { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: createDefaultFormation() }];
  currentSceneIdx = 0;
  setSelectedMembers([]);
  rebuildCanvas();
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus("Reset selesai");
});

// ============================================================================
// BAGIAN 7: MODE SIMULASI 3D LANDSCAPE, KONSOL KAMERA & ARAH HADAP PASUKAN
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
    setStatus("Mode 3D Lomba Aktif");
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

// Tombol Sudut Pandang Kamera Lomba
document.querySelectorAll('.cam-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    document.querySelectorAll('.cam-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (view === 'lomba') {
      camAzimuth = 0.25;
      camElevation = 0.88;
    } else if (view === 'juri') {
      camAzimuth = Math.PI / 2;
      camElevation = 0.82;
    } else if (view === 'belakang') {
      camAzimuth = -Math.PI / 2;
      camElevation = 0.82;
    } else if (view === 'danton') {
      camAzimuth = 0;
      camElevation = 0.82;
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

// Kontrol Arah Hadap Pasukan di 3D (Untuk Titik Terpilih atau Semua Pasukan)
function applyFacingDirection(mode) {
  saveHistoryState();
  const sceneData = scenes[currentSceneIdx];
  const danton = sceneData.members.find(m => m.id === 'D');
  const targets = selectedMemberIds.length > 0
    ? sceneData.members.filter(m => selectedMemberIds.includes(m.id))
    : sceneData.members;

  targets.forEach(m => {
    if (mode === 'danton' && danton && m.id !== 'D') {
      m.facing = getFacingToDantonAngle(m.x, m.y, danton.x, danton.y);
      m.customFacing = false;
    } else if (mode === 'dp') {
      m.facing = Math.PI / 2; // Menghadap kanan (Dewan Juri)
      m.customFacing = true;
    } else if (mode === 'belakang') {
      m.facing = -Math.PI / 2; // Membelakangi Dewan Juri
      m.customFacing = true;
    } else if (mode === 'kiri') {
      m.facing = Math.PI; // Menghadap atas (-Z)
      m.customFacing = true;
    } else if (mode === 'kanan') {
      m.facing = 0; // Menghadap bawah (+Z / Danton)
      m.customFacing = true;
    } else if (mode === 'rotate45') {
      m.facing = (m.facing || 0) - (Math.PI / 4);
      m.customFacing = true;
    }
  });

  setStatus(selectedMemberIds.length > 0 ? `Arah ${targets.length} titik diubah` : "Arah semua pasukan diubah");
}

document.querySelectorAll('.face-btn[data-face]').forEach(btn => {
  btn.addEventListener('click', () => {
    applyFacingDirection(btn.getAttribute('data-face'));
  });
});

document.getElementById('btnFaceRotate').addEventListener('click', () => {
  applyFacingDirection('rotate45');
});

function init3DScene() {
  const container = document.getElementById('canvas-3d-container');
  container.style.width = canvasW + 'px';
  container.style.height = canvasH + 'px';

  if (!threeRenderer) {
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0f172a);

    threeCamera = new THREE.PerspectiveCamera(40, canvasW / canvasH, 0.1, 200);
    camDistance = Math.max(fieldMetersL, fieldMetersW) * 1.1;
    updateCamera3DPosition();

    threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    threeRenderer.setSize(canvasW, canvasH);
    container.innerHTML = '';
    container.appendChild(threeRenderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.78);
    threeScene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.68);
    dirLight.position.set(12, 24, 14);
    threeScene.add(dirLight);

    // Geser Jari / Mouse di Kanvas 3D untuk Orbit Sudut Kamera Lomba & Klik Pilih Figur
    let isDraggingCam = false;
    let dragMoved = false;
    let prevPointerX = 0;
    let prevPointerY = 0;

    threeRenderer.domElement.addEventListener('pointerdown', (e) => {
      isDraggingCam = true;
      dragMoved = false;
      prevPointerX = e.clientX;
      prevPointerY = e.clientY;
    });

    window.addEventListener('pointermove', (e) => {
      if (!isDraggingCam || !is3DMode) return;
      const dx = e.clientX - prevPointerX;
      const dy = e.clientY - prevPointerY;
      if (Math.hypot(dx, dy) > 4) dragMoved = true;
      prevPointerX = e.clientX;
      prevPointerY = e.clientY;

      camAzimuth -= dx * 0.012;
      camElevation = Math.max(0.05, Math.min(1.42, camElevation - dy * 0.01));
      updateCamera3DPosition();
    });

    window.addEventListener('pointerup', (e) => {
      if (isDraggingCam && !dragMoved && is3DMode) {
        pick3DMember(e);
      }
      isDraggingCam = false;
    });
  } else {
    resize3DView();
  }

  rebuild3DFieldAndTroops();
  start3DLoop();
}

// Klik/Tap Figur Orang di Layar 3D untuk Memilih Titik
function pick3DMember(event) {
  if (!threeRenderer || !threeCamera) return;
  const rect = threeRenderer.domElement.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1
  );

  const raycaster = new THREE.Raycaster();
  raycaster.setFromCamera(mouse, threeCamera);

  const allMeshes = [];
  Object.entries(threeMembers).forEach(([id, group]) => {
    group.traverse(child => {
      if (child.isMesh) {
        child.userData.memberId = id;
        allMeshes.push(child);
      }
    });
  });

  const hits = raycaster.intersectObjects(allMeshes);
  if (hits.length > 0) {
    const hitId = hits[0].object.userData.memberId;
    if (hitId) {
      setSelectedMembers([hitId]);
      setStatus(`Terpilih: ${hitId}`);
    }
  } else {
    setSelectedMembers([]);
  }
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

  // Cincin Penanda Seleksi Kuning di Kaki Figur
  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.24, 0.34, 18),
    new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
  );
  selRing.rotation.x = -Math.PI / 2;
  selRing.position.y = 0.025;
  selRing.visible = selectedMemberIds.includes(member.id);
  group.add(selRing);

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

  // Topi Pet dengan Pet Depan (Visor) agar Arah Hadap Wajah Terlihat Jelas
  const cap = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14, 0.14, 0.08, 10),
    new THREE.MeshLambertMaterial({ color: 0xdc2626 })
  );
  cap.position.y = 1.38;
  group.add(cap);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.16, 0.03, 0.12),
    new THREE.MeshLambertMaterial({ color: 0x0f172a })
  );
  visor.position.set(0, 1.34, 0.14);
  group.add(visor);

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

  group.userData = {
    selRing,
    leftLeg,
    rightLeg,
    leftArm,
    rightArm,
    targetPos: new THREE.Vector3(),
    memberId: member.id
  };
  return group;
}

function update3DSelectionHighlight() {
  Object.entries(threeMembers).forEach(([id, fig]) => {
    if (fig.userData.selRing) {
      fig.userData.selRing.visible = selectedMemberIds.includes(id);
    }
  });
}

// Konversi Koordinat 2D Landscape ke 3D Landscape (X = Panjang 22m, Z = Lebar 15m)
function map2DTo3D(x2d, y2d) {
  const x3d = ((x2d / canvasW) - 0.5) * fieldMetersL;
  const z3d = ((y2d / canvasH) - 0.5) * fieldMetersW;
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

  // Lantai Lapangan Landscape (22m x 15m)
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(fieldMetersL, fieldMetersW),
    new THREE.MeshLambertMaterial({ color: 0x1b4332 })
  );
  plane.rotation.x = -Math.PI / 2;
  threeScene.add(plane);

  // Garis Tepian Putih Utama Lapangan (22m x 15m Utuh)
  const mainFieldBorder = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(fieldMetersL, fieldMetersW)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  mainFieldBorder.rotation.x = -Math.PI / 2;
  mainFieldBorder.position.y = 0.015;
  threeScene.add(mainFieldBorder);

  // Kotak Khusus Danton dengan 4 Garis Tepi Utuh di Luar Garis Bawah Tengah (+Z)
  const dantonBox = new THREE.Mesh(
    new THREE.PlaneGeometry(1.6, 1.4),
    new THREE.MeshLambertMaterial({ color: 0x1b4332 })
  );
  dantonBox.rotation.x = -Math.PI / 2;
  dantonBox.position.set(0, 0.01, (fieldMetersW / 2) + 0.7);
  threeScene.add(dantonBox);

  const dantonBorder = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.6, 1.4)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  dantonBorder.rotation.x = -Math.PI / 2;
  dantonBorder.position.set(0, 0.018, (fieldMetersW / 2) + 0.7);
  threeScene.add(dantonBorder);

  const maxDim = Math.max(fieldMetersL, fieldMetersW);
  const gridHelper = new THREE.GridHelper(maxDim, maxDim, 0xffffff, 0x2d6a4f);
  gridHelper.scale.set(fieldMetersL / maxDim, 1, fieldMetersW / maxDim);
  gridHelper.position.y = 0.01;
  threeScene.add(gridHelper);

  const sceneData = scenes[currentSceneIdx];
  if (!sceneData) return;

  sceneData.members.forEach(m => {
    const fig = create3DHumanFigure(m);
    const pos = map2DTo3D(m.x, m.y);
    fig.position.set(pos.x, 0, pos.z);
    fig.rotation.y = m.facing !== undefined ? m.facing : 0;
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
        fig.rotation.y = m.facing !== undefined ? m.facing : 0;
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
    const sceneData = scenes[currentSceneIdx];

    Object.entries(threeMembers).forEach(([id, fig]) => {
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

        const mData = sceneData ? sceneData.members.find(item => item.id === id) : null;
        fig.rotation.y = (mData && mData.facing !== undefined) ? mData.facing : 0;

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
// BAGIAN 9: TIMELINE HITUNGAN, PLAY ANIMASI & DOWNLOAD VIDEO LANDSCAPE 16:9
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

  setStatus("Merekam video 16:9...");

  // Resolusi Video Landscape HD 1280x720 (Kamera Lomba)
  const videoW = 1280;
  const videoH = 720;
  const recordCanvas = document.createElement('canvas');
  recordCanvas.width = videoW;
  recordCanvas.height = videoH;
  const ctx = recordCanvas.getContext('2d');

  let animFrameId;
  const drawCombinedFrame = () => {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, videoW, videoH);

    // Hitung skala agar lapang landscape proporsional di frame 16:9
    const scale = Math.min((videoW - 80) / canvasW, (videoH - 80) / canvasH);
    const drawW = canvasW * scale;
    const drawH = canvasH * scale;
    const offsetX = (videoW - drawW) / 2;
    const offsetY = (videoH - drawH) / 2;

    if (is3DMode && threeRenderer) {
      ctx.drawImage(threeRenderer.domElement, offsetX, offsetY, drawW, drawH);
    } else {
      stage.getLayers().forEach(layer => {
        ctx.drawImage(layer.getCanvas()._canvas, offsetX, offsetY, drawW, drawH);
      });
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.strokeRect(offsetX, offsetY, drawW, drawH);
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
    showPopup("Video Selesai", `Video animasi landscape berhasil diunduh (${fileName}.${ext}).`);
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
  setSelectedMembers([]);
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
