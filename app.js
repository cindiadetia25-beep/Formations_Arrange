// ============================================================================
// BAGIAN 1: KONFIGURASI API GOOGLE APPS SCRIPT & STATE GLOBAL
// ============================================================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbypOugpXmLsnd_Q4dYber4O6V_xDt4JrDeCaiA-RgrirMCDtHpaJNxewlAfiMA6MhACiA/exec";

if (typeof Konva !== 'undefined') {
  Konva.pixelRatio = 1.5;
}

let competitionMode = 'LKBB'; // 'LKBB' (Kotak Danton) | 'RUKIBRA' (Tiang Bendera)
let fieldMetersL = 22;
let fieldMetersW = 15;
let fieldW = 360;
let fieldH = 210;
const DANTON_AREA_H = 28;

// Penyimpanan terpisah untuk 2 Slide Mode (LKBB & RUKIBRA)
let modeStore = {
  LKBB: { scenes: [], currentSceneIdx: 0 },
  RUKIBRA: { scenes: [], currentSceneIdx: 0 }
};

let scenes = [];
let currentSceneIdx = 0;
let memberNodes = {};
let selectedMemberIds = [];
let isBlockSelectMode = false;
let savedFormations = [];
let isPlaying = false;

let pointShape = 'circle'; // 'circle' | 'person'
let is5DMode = false;

let undoStack = [];
let redoStack = [];

// State Audio & Rekam Suara Live Danton
let audioElement = null;
let audioCtx = null;
let audioSourceNode = null;
let audioDestNode = null;
let mediaRecorderVoice = null;
let voiceChunks = [];
let isRecordingVoice = false;

// State Simulasi 5D Realistis & Ringan
let threeScene = null;
let threeCamera = null;
let threeRenderer = null;
let threeMembers = {};
let threeFlagMesh = null;
let threeGrassTexture = null;
let threeAnimId = null;

let camAzimuth = 0.28;
let camElevation = 0.92;
let camDistance = 24;

// ============================================================================
// BAGIAN 2: INISIALISASI KANVAS 2D KONVA (LAPANG + KOTAK D / TIANG BENDERA)
// ============================================================================
const stage = new Konva.Stage({
  container: 'canvas-container',
  width: fieldW,
  height: fieldH + DANTON_AREA_H
});

const bgLayer = new Konva.Layer({ listening: false });
const gridLayer = new Konva.Layer({ listening: false });
const troopLayer = new Konva.Layer();
const uiLayer = new Konva.Layer({ listening: false });

stage.add(bgLayer);
stage.add(gridLayer);
stage.add(troopLayer);
stage.add(uiLayer);

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
// BAGIAN 4: SISTEM RIWAYAT UNDO & REDO + PERPINDAHAN SLIDE LKBB / RUKIBRA
// ============================================================================
function saveHistoryState() {
  undoStack.push(JSON.stringify({ competitionMode, scenes, currentSceneIdx }));
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
  redoStack.push(JSON.stringify({ competitionMode, scenes, currentSceneIdx }));
  const prev = JSON.parse(undoStack.pop());
  scenes = prev.scenes;
  currentSceneIdx = prev.currentSceneIdx;
  rebuildCanvas();
  if (is5DMode) rebuild5DFieldAndTroops();
  updateHistoryButtons();
  setStatus("Undo");
});

document.getElementById('btnRedo').addEventListener('click', () => {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify({ competitionMode, scenes, currentSceneIdx }));
  const next = JSON.parse(redoStack.pop());
  scenes = next.scenes;
  currentSceneIdx = next.currentSceneIdx;
  rebuildCanvas();
  if (is5DMode) rebuild5DFieldAndTroops();
  updateHistoryButtons();
  setStatus("Redo");
});

function switchCompetitionMode(newMode) {
  if (competitionMode === newMode) return;
  modeStore[competitionMode] = { scenes, currentSceneIdx };

  competitionMode = newMode;
  document.getElementById('btnModeLKBB').classList.toggle('active', newMode === 'LKBB');
  document.getElementById('btnModeRukibra').classList.toggle('active', newMode === 'RUKIBRA');

  if (!modeStore[newMode].scenes || modeStore[newMode].scenes.length === 0) {
    modeStore[newMode] = {
      scenes: [{ name: "Hitungan 1", members: createDefaultFormation(newMode) }],
      currentSceneIdx: 0
    };
  }

  scenes = modeStore[newMode].scenes;
  currentSceneIdx = modeStore[newMode].currentSceneIdx;
  setSelectedMembers([]);
  updateFieldLabel();
  drawFieldGrid();
  rebuildCanvas();
  if (is5DMode) rebuild5DFieldAndTroops();
  setStatus(newMode === 'LKBB' ? "Slide 1: LKBB (Danton)" : "Slide 2: RUKIBRA (Tiang Bendera)");
}

document.getElementById('btnModeLKBB').addEventListener('click', () => switchCompetitionMode('LKBB'));
document.getElementById('btnModeRukibra').addEventListener('click', () => switchCompetitionMode('RUKIBRA'));

// ============================================================================
// BAGIAN 5: UKURAN LAPANG LANDSCAPE, KOTAK DANTON / TIANG BENDERA & SKALA
// ============================================================================
function getMemberRadius() {
  const meterPx = Math.min(fieldW / fieldMetersL, fieldH / fieldMetersW);
  return Math.max(5, Math.min(10, Math.round(meterPx * 0.36)));
}

function getSpecialZoneRect() {
  const boxW = 36;
  const boxH = 26;
  return {
    x: Math.round((fieldW - boxW) / 2),
    y: fieldH,
    width: boxW,
    height: boxH
  };
}

function updateFieldLabel() {
  const prefix = competitionMode === 'LKBB' ? 'MODE LKBB (DANTON)' : 'MODE RUKIBRA (TIANG BENDERA)';
  document.getElementById('fieldLabel').innerText = `${prefix} — DP KANAN (${fieldMetersL}m x ${fieldMetersW}m)`;
}

function calculateCanvasDimensions() {
  const winW = window.innerWidth || 360;
  const winH = window.innerHeight || 640;

  const maxW = Math.max(260, Math.min(winW - 24, 640));
  const maxH = Math.max(150, Math.min(winH - 380, 325));
  const ratio = fieldMetersL / fieldMetersW;

  if (maxW / maxH > ratio) {
    fieldH = maxH;
    fieldW = Math.round(maxH * ratio);
  } else {
    fieldW = maxW;
    fieldH = Math.round(maxW / ratio);
  }

  stage.width(fieldW);
  stage.height(fieldH + DANTON_AREA_H);
  updateFieldLabel();
  drawFieldGrid();

  if (is5DMode) {
    resize5DView();
  }
}

function drawFieldGrid() {
  bgLayer.destroyChildren();
  gridLayer.clearCache();
  gridLayer.destroyChildren();

  const zBox = getSpecialZoneRect();

  bgLayer.add(new Konva.Rect({
    x: 0,
    y: 0,
    width: fieldW,
    height: fieldH,
    fill: '#1b4332'
  }));

  bgLayer.add(new Konva.Rect({
    x: zBox.x,
    y: zBox.y,
    width: zBox.width,
    height: zBox.height,
    fill: competitionMode === 'LKBB' ? '#1b4332' : '#334155'
  }));
  bgLayer.draw();

  const stepX = fieldW / fieldMetersL;
  const stepY = fieldH / fieldMetersW;

  for (let i = 1; i < fieldMetersL; i++) {
    gridLayer.add(new Konva.Line({
      points: [i * stepX, 0, i * stepX, fieldH],
      stroke: i % 5 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
      strokeWidth: 1,
      perfectDrawEnabled: false
    }));
  }

  for (let j = 1; j < fieldMetersW; j++) {
    gridLayer.add(new Konva.Line({
      points: [0, j * stepY, fieldW, j * stepY],
      stroke: j % 5 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
      strokeWidth: 1,
      perfectDrawEnabled: false
    }));
  }

  gridLayer.add(new Konva.Circle({
    x: fieldW / 2,
    y: fieldH / 2,
    radius: 3.5,
    fill: '#facc15',
    perfectDrawEnabled: false
  }));

  gridLayer.add(new Konva.Rect({
    x: 1,
    y: 1,
    width: fieldW - 2,
    height: fieldH - 2,
    stroke: '#ffffff',
    strokeWidth: 2,
    perfectDrawEnabled: false
  }));

  gridLayer.add(new Konva.Rect({
    x: zBox.x,
    y: zBox.y,
    width: zBox.width,
    height: zBox.height,
    stroke: '#ffffff',
    strokeWidth: 2,
    perfectDrawEnabled: false
  }));

  if (competitionMode === 'LKBB') {
    gridLayer.add(new Konva.Text({
      x: zBox.x,
      y: zBox.y + 7,
      width: zBox.width,
      align: 'center',
      text: 'D',
      fontSize: 11,
      fontStyle: 'bold',
      fill: 'rgba(252, 165, 165, 0.45)',
      perfectDrawEnabled: false
    }));
  } else {
    const cx = zBox.x + zBox.width / 2;
    const cy = zBox.y + zBox.height / 2;
    gridLayer.add(new Konva.Circle({
      x: cx,
      y: cy,
      radius: 4,
      fill: '#e2e8f0',
      stroke: '#0f172a',
      strokeWidth: 1
    }));
    gridLayer.add(new Konva.Rect({
      x: cx + 2,
      y: cy - 6,
      width: 10,
      height: 3.5,
      fill: '#ef4444'
    }));
    gridLayer.add(new Konva.Rect({
      x: cx + 2,
      y: cy - 2.5,
      width: 10,
      height: 3.5,
      fill: '#ffffff'
    }));
  }

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
  if (is5DMode) rebuild5DFieldAndTroops();
  setStatus(`Lapang: ${l}m x ${w}m`);
});

// ============================================================================
// BAGIAN 6: MANAJEMEN PASUKAN 2D, SERAGAM KUSTOM & BLOK TITIK
// ============================================================================
function getDefaultUniform(isDanton) {
  return isDanton
    ? { cap: '#dc2626', top: '#dc2626', bottom: '#991b1b', boots: '#111827' }
    : { cap: '#dc2626', top: '#f8fafc', bottom: '#1e3a8a', boots: '#111827' };
}

function normalizeMemberUniform(m) {
  if (!m.uniform) {
    m.uniform = getDefaultUniform(m.id === 'D');
  }
  return m.uniform;
}

document.getElementById('btnToggleShape').addEventListener('click', () => {
  pointShape = pointShape === 'circle' ? 'person' : 'circle';
  document.getElementById('btnToggleShape').innerText = pointShape === 'circle' ? '👤' : '⚪';
  rebuildCanvas();
  setStatus(pointShape === 'person' ? "Bentuk: Orang" : "Bentuk: Lingkaran");
});

document.getElementById('btnSelectBox').addEventListener('click', () => {
  isBlockSelectMode = !isBlockSelectMode;
  const btn = document.getElementById('btnSelectBox');
  btn.classList.toggle('active-mode', isBlockSelectMode);
  setStatus(isBlockSelectMode ? "Mode Blok Aktif (Seret di 2D/5D)" : "Mode Geser Titik");
});

function getTargetPointCoords() {
  const zBox = getSpecialZoneRect();
  if (competitionMode === 'LKBB') {
    const danton = scenes[currentSceneIdx]?.members.find(item => item.id === 'D');
    if (danton) return { x: danton.x, y: danton.y };
  }
  return { x: Math.round(zBox.x + zBox.width / 2), y: Math.round(zBox.y + zBox.height / 2) };
}

function getFacingToTargetAngle(memberX, memberY, targetX, targetY) {
  const dx = targetX - memberX;
  const dz = targetY - memberY;
  return Math.atan2(dx, dz);
}

function createDefaultFormation(mode = competitionMode) {
  const members = [];
  const stepX = fieldW / fieldMetersL;
  const stepY = fieldH / fieldMetersW;
  const gapX = Math.max(14, stepX * 1.15);
  const gapY = Math.max(14, stepY * 1.15);

  const centerX = Math.round(fieldW / 2);
  const centerY = Math.round(fieldH / 2);
  const zBox = getSpecialZoneRect();
  const targetX = Math.round(zBox.x + zBox.width / 2);
  const targetY = Math.round(zBox.y + zBox.height / 2);

  if (mode === 'LKBB') {
    members.push({
      id: 'D',
      label: 'D',
      color: '#ef4444',
      uniform: getDefaultUniform(true),
      x: targetX,
      y: targetY,
      facing: Math.PI
    });
  }

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
        uniform: getDefaultUniform(false),
        x: mx,
        y: my,
        facing: getFacingToTargetAngle(mx, my, targetX, targetY)
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

  if (is5DMode) {
    update5DSelectionHighlight();
  }
}

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
  const uni = normalizeMemberUniform(m);
  const fillCol = m.id === 'D' ? uni.top : (uni.top !== '#f8fafc' ? uni.top : m.color);

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
      fill: uni.top,
      stroke: '#ffffff',
      strokeWidth: 1.5,
      perfectDrawEnabled: false
    });

    const head = new Konva.Circle({
      y: -r * 0.15,
      radius: r * 0.52,
      fill: uni.cap,
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
      fill: fillCol,
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
      stroke: '#0f172a',
      strokeWidth: 0.3,
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
    const targetPt = getTargetPointCoords();
    selectedMemberIds.forEach(id => {
      const target = scenes[currentSceneIdx].members.find(item => item.id === id);
      const node = memberNodes[id];
      if (target && node) {
        target.x = Math.round(node.x());
        target.y = Math.round(node.y());
        if (target.id !== 'D' && target.customFacing !== true) {
          target.facing = getFacingToTargetAngle(target.x, target.y, targetPt.x, targetPt.y);
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

  if (is5DMode) {
    sync5DPositions(animate);
  }
}

document.getElementById('btnUniformColor').addEventListener('click', () => {
  const sceneData = scenes[currentSceneIdx];
  const sampleMember = selectedMemberIds.length > 0
    ? sceneData.members.find(m => m.id === selectedMemberIds[0])
    : sceneData.members.find(m => m.id !== 'D') || sceneData.members[0];

  if (sampleMember) {
    const uni = normalizeMemberUniform(sampleMember);
    document.getElementById('colorCap').value = uni.cap;
    document.getElementById('colorTop').value = uni.top;
    document.getElementById('colorBottom').value = uni.bottom;
    document.getElementById('colorBoots').value = uni.boots;
  }

  document.getElementById('uniformTargetText').innerText = selectedMemberIds.length > 0
    ? `Terapkan ke ${selectedMemberIds.length} titik terpilih`
    : "Terapkan ke seluruh pasukan";
  document.getElementById('uniformModal').classList.remove('hidden');
});

document.getElementById('btnCancelUniform').addEventListener('click', () => {
  document.getElementById('uniformModal').classList.add('hidden');
});

document.getElementById('btnApplyUniform').addEventListener('click', () => {
  saveHistoryState();
  const newUniform = {
    cap: document.getElementById('colorCap').value,
    top: document.getElementById('colorTop').value,
    bottom: document.getElementById('colorBottom').value,
    boots: document.getElementById('colorBoots').value
  };

  scenes.forEach(sc => {
    const targets = selectedMemberIds.length > 0
      ? sc.members.filter(m => selectedMemberIds.includes(m.id))
      : sc.members.filter(m => m.id !== 'D');

    targets.forEach(m => {
      m.uniform = { ...newUniform };
      m.color = newUniform.top;
    });
  });

  document.getElementById('uniformModal').classList.add('hidden');
  rebuildCanvas();
  if (is5DMode) rebuild5DFieldAndTroops();
  setStatus("Warna seragam diperbarui");
});

document.getElementById('btnAddMember').addEventListener('click', () => {
  saveHistoryState();
  const nextNum = scenes[currentSceneIdx].members.length + 1;
  const targetPt = getTargetPointCoords();
  const mx = Math.round(fieldW / 2);
  const my = Math.round(fieldH / 2);

  const newMember = {
    id: 'P' + Date.now(),
    label: String(nextNum),
    color: '#2563eb',
    uniform: getDefaultUniform(false),
    x: mx,
    y: my,
    facing: getFacingToTargetAngle(mx, my, targetPt.x, targetPt.y)
  };
  scenes.forEach(sc => sc.members.push(JSON.parse(JSON.stringify(newMember))));
  renderScene(currentSceneIdx, false);
  if (is5DMode) rebuild5DFieldAndTroops();
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
  if (is5DMode) rebuild5DFieldAndTroops();
  setStatus(`${count} titik dihapus`);
});

document.getElementById('btnClearAll').addEventListener('click', async () => {
  const ok = await showPopup("Hapus Semua", "Kosongkan seluruh titik pasukan di lapangan?", { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: [] }];
  modeStore[competitionMode].scenes = scenes;
  currentSceneIdx = 0;
  setSelectedMembers([]);
  rebuildCanvas();
  if (is5DMode) rebuild5DFieldAndTroops();
  setStatus("Lapang kosong");
});

document.getElementById('btnResetPos').addEventListener('click', async () => {
  const ok = await showPopup("Reset Formasi", `Kembalikan ke formasi awal mode ${competitionMode}?`, { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: createDefaultFormation(competitionMode) }];
  modeStore[competitionMode].scenes = scenes;
  currentSceneIdx = 0;
  setSelectedMembers([]);
  rebuildCanvas();
  if (is5DMode) rebuild5DFieldAndTroops();
  setStatus("Reset selesai");
});

// ============================================================================
// BAGIAN 7: MODE SIMULASI 5D REALISTIS & RINGAN (BLOK 5D, SERAGAM & TIANG)
// ============================================================================
function triggerHaptic5D(ms = 16) {
  if (navigator.vibrate) {
    try { navigator.vibrate(ms); } catch (e) {}
  }
}

function createRealisticGrassTexture() {
  if (threeGrassTexture) return threeGrassTexture;
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 256;
  const ctx = c.getContext('2d');

  ctx.fillStyle = '#1b4332';
  ctx.fillRect(0, 0, 256, 256);

  ctx.fillStyle = 'rgba(45, 106, 79, 0.32)';
  ctx.fillRect(0, 0, 128, 256);

  for (let i = 0; i < 1800; i++) {
    const x = Math.random() * 256;
    const y = Math.random() * 256;
    ctx.fillStyle = i % 2 === 0 ? 'rgba(82, 183, 136, 0.16)' : 'rgba(8, 28, 21, 0.2)';
    ctx.fillRect(x, y, 2, 2);
  }

  threeGrassTexture = new THREE.CanvasTexture(c);
  threeGrassTexture.wrapS = THREE.RepeatWrapping;
  threeGrassTexture.wrapT = THREE.RepeatWrapping;
  threeGrassTexture.repeat.set(6, 4);
  return threeGrassTexture;
}

document.getElementById('btnToggle5D').addEventListener('click', () => {
  if (typeof THREE === 'undefined') {
    showPopup("Info 5D", "Library visual 5D belum siap. Pastikan koneksi internet aktif saat pertama membuka aplikasi.");
    return;
  }

  is5DMode = !is5DMode;
  const wrapper2D = document.getElementById('fieldWrapper2D');
  const wrapper5D = document.getElementById('wrapper5D');
  const camConsole = document.getElementById('cameraConsole5D');
  const btn = document.getElementById('btnToggle5D');

  if (is5DMode) {
    wrapper2D.classList.add('hidden');
    wrapper5D.classList.remove('hidden');
    camConsole.classList.remove('hidden');
    btn.innerText = '🗺️ 2D';
    init5DScene();
    triggerHaptic5D(22);
    setStatus("Mode 5D Realistis Aktif");
  } else {
    wrapper5D.classList.add('hidden');
    camConsole.classList.add('hidden');
    wrapper2D.classList.remove('hidden');
    btn.innerText = '✨ 5D';
    stop5DLoop();
    rebuildCanvas();
    setStatus("Mode 2D Aktif");
  }
});

function updateCamera5DPosition() {
  if (!threeCamera) return;
  const x = camDistance * Math.sin(camElevation) * Math.sin(camAzimuth);
  const y = camDistance * Math.cos(camElevation);
  const z = camDistance * Math.sin(camElevation) * Math.cos(camAzimuth);
  threeCamera.position.set(x, Math.max(1.8, y), z);
  threeCamera.lookAt(0, 0.5, 0);
}

document.querySelectorAll('.cam-btn[data-view]').forEach(btn => {
  btn.addEventListener('click', () => {
    const view = btn.getAttribute('data-view');
    document.querySelectorAll('.cam-btn[data-view]').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    if (view === 'lomba') {
      camAzimuth = 0.28;
      camElevation = 0.92;
    } else if (view === 'juri') {
      camAzimuth = Math.PI / 2;
      camElevation = 0.85;
    } else if (view === 'belakang') {
      camAzimuth = -Math.PI / 2;
      camElevation = 0.85;
    } else if (view === 'danton') {
      camAzimuth = 0;
      camElevation = 0.85;
    } else if (view === 'atas') {
      camAzimuth = 0;
      camElevation = 0.05;
    }
    updateCamera5DPosition();
  });
});

document.getElementById('btnCamZoomIn').addEventListener('click', () => {
  camDistance = Math.max(9, camDistance - 3);
  updateCamera5DPosition();
});

document.getElementById('btnCamZoomOut').addEventListener('click', () => {
  camDistance = Math.min(60, camDistance + 3);
  updateCamera5DPosition();
});

function applyFacingDirection(mode) {
  saveHistoryState();
  const sceneData = scenes[currentSceneIdx];
  const targetPt = getTargetPointCoords();
  const targets = selectedMemberIds.length > 0
    ? sceneData.members.filter(m => selectedMemberIds.includes(m.id))
    : sceneData.members;

  targets.forEach(m => {
    if (mode === 'target' && m.id !== 'D') {
      m.facing = getFacingToTargetAngle(m.x, m.y, targetPt.x, targetPt.y);
      m.customFacing = false;
    } else if (mode === 'dp') {
      m.facing = Math.PI / 2;
      m.customFacing = true;
    } else if (mode === 'belakang') {
      m.facing = -Math.PI / 2;
      m.customFacing = true;
    } else if (mode === 'kiri') {
      m.facing = Math.PI;
      m.customFacing = true;
    } else if (mode === 'kanan') {
      m.facing = 0;
      m.customFacing = true;
    } else if (mode === 'rotate45') {
      m.facing = (m.facing || 0) - (Math.PI / 4);
      m.customFacing = true;
    }
  });

  triggerHaptic5D(15);
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

function init5DScene() {
  const container = document.getElementById('canvas-5d-container');
  const totalH = fieldH + DANTON_AREA_H;
  container.style.width = fieldW + 'px';
  container.style.height = totalH + 'px';

  if (!threeRenderer) {
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0b1324);
    threeScene.fog = new THREE.FogExp2(0x0b1324, 0.009);

    threeCamera = new THREE.PerspectiveCamera(40, fieldW / totalH, 0.1, 220);
    camDistance = Math.max(fieldMetersL, fieldMetersW) * 1.1;
    updateCamera5DPosition();

    threeRenderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'default',
      preserveDrawingBuffer: true
    });
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    threeRenderer.setSize(fieldW, totalH);
    container.innerHTML = '';
    container.appendChild(threeRenderer.domElement);

    const hemiLight = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.85);
    threeScene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0xfffbeb, 0.78);
    sunLight.position.set(14, 28, 16);
    threeScene.add(sunLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 0.35);
    rimLight.position.set(-15, 12, -14);
    threeScene.add(rimLight);

    let isDraggingCam = false;
    let isBlocking5D = false;
    let blockStart5D = { x: 0, y: 0 };
    let draggedMemberId = null;
    let dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    let dragStart3DPositions = {};
    let dragOriginPoint = new THREE.Vector3();
    let prevPointerX = 0;
    let prevPointerY = 0;

    const selBoxEl = document.getElementById('selectionBox5D');

    const getRaycasterFromEvent = (e) => {
      const rect = threeRenderer.domElement.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
      const rc = new THREE.Raycaster();
      rc.setFromCamera(mouse, threeCamera);
      return rc;
    };

    threeRenderer.domElement.addEventListener('pointerdown', (e) => {
      const rect = threeRenderer.domElement.getBoundingClientRect();

      if (isBlockSelectMode) {
        isBlocking5D = true;
        blockStart5D = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        selBoxEl.style.left = blockStart5D.x + 'px';
        selBoxEl.style.top = blockStart5D.y + 'px';
        selBoxEl.style.width = '0px';
        selBoxEl.style.height = '0px';
        selBoxEl.classList.remove('hidden');
        return;
      }

      const rc = getRaycasterFromEvent(e);
      const allMeshes = [];
      Object.entries(threeMembers).forEach(([id, group]) => {
        group.traverse(child => {
          if (child.isMesh) {
            child.userData.memberId = id;
            allMeshes.push(child);
          }
        });
      });

      const hits = rc.intersectObjects(allMeshes);
      if (hits.length > 0 && hits[0].object.userData.memberId) {
        draggedMemberId = hits[0].object.userData.memberId;
        if (!selectedMemberIds.includes(draggedMemberId)) {
          setSelectedMembers([draggedMemberId]);
        }
        saveHistoryState();
        triggerHaptic5D(15);

        rc.ray.intersectPlane(dragPlane, dragOriginPoint);
        dragStart3DPositions = {};
        selectedMemberIds.forEach(id => {
          if (threeMembers[id]) {
            dragStart3DPositions[id] = threeMembers[id].position.clone();
          }
        });
        setStatus(`Geser titik ${draggedMemberId} (5D)`);
      } else {
        isDraggingCam = true;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;
        setSelectedMembers([]);
      }
    });

    window.addEventListener('pointermove', (e) => {
      if (!is5DMode) return;
      const rect = threeRenderer.domElement.getBoundingClientRect();

      if (isBlocking5D) {
        const curX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const curY = Math.max(0, Math.min(rect.height, e.clientY - rect.top));
        selBoxEl.style.left = Math.min(blockStart5D.x, curX) + 'px';
        selBoxEl.style.top = Math.min(blockStart5D.y, curY) + 'px';
        selBoxEl.style.width = Math.abs(curX - blockStart5D.x) + 'px';
        selBoxEl.style.height = Math.abs(curY - blockStart5D.y) + 'px';
        return;
      }

      if (draggedMemberId) {
        const rc = getRaycasterFromEvent(e);
        const currentHit = new THREE.Vector3();
        if (rc.ray.intersectPlane(dragPlane, currentHit)) {
          const dx = currentHit.x - dragOriginPoint.x;
          const dz = currentHit.z - dragOriginPoint.z;

          selectedMemberIds.forEach(id => {
            const fig = threeMembers[id];
            const startP = dragStart3DPositions[id];
            if (fig && startP) {
              const nx = startP.x + dx;
              const nz = startP.z + dz;
              fig.position.set(nx, 0, nz);
              fig.userData.targetPos.set(nx, 0, nz);

              const pos2D = map3DTo2D(nx, nz);
              const targetData = scenes[currentSceneIdx].members.find(m => m.id === id);
              if (targetData) {
                targetData.x = pos2D.x;
                targetData.y = pos2D.y;
              }
            }
          });
        }
      } else if (isDraggingCam) {
        const dx = e.clientX - prevPointerX;
        const dy = e.clientY - prevPointerY;
        prevPointerX = e.clientX;
        prevPointerY = e.clientY;

        camAzimuth -= dx * 0.012;
        camElevation = Math.max(0.05, Math.min(1.42, camElevation - dy * 0.01));
        updateCamera5DPosition();
      }
    });

    window.addEventListener('pointerup', () => {
      if (isBlocking5D) {
        isBlocking5D = false;
        const boxLeft = parseFloat(selBoxEl.style.left);
        const boxTop = parseFloat(selBoxEl.style.top);
        const boxRight = boxLeft + parseFloat(selBoxEl.style.width);
        const boxBottom = boxTop + parseFloat(selBoxEl.style.height);
        selBoxEl.classList.add('hidden');

        const matched = [];
        const rect = threeRenderer.domElement.getBoundingClientRect();
        Object.entries(threeMembers).forEach(([id, fig]) => {
          const worldPos = new THREE.Vector3(fig.position.x, 0.8, fig.position.z);
          worldPos.project(threeCamera);
          const screenX = (worldPos.x * 0.5 + 0.5) * rect.width;
          const screenY = (-worldPos.y * 0.5 + 0.5) * rect.height;
          if (screenX >= boxLeft && screenX <= boxRight && screenY >= boxTop && screenY <= boxBottom) {
            matched.push(id);
          }
        });

        setSelectedMembers(matched);
        if (matched.length > 0) {
          setStatus(`${matched.length} titik terblok di 5D`);
          triggerHaptic5D(20);
        }
      }

      if (draggedMemberId) {
        const targetPt = getTargetPointCoords();
        selectedMemberIds.forEach(id => {
          const target = scenes[currentSceneIdx].members.find(item => item.id === id);
          if (target && target.id !== 'D' && target.customFacing !== true) {
            target.facing = getFacingToTargetAngle(target.x, target.y, targetPt.x, targetPt.y);
          }
        });
        draggedMemberId = null;
        setStatus("Posisi 5D tersimpan");
      }
      isDraggingCam = false;
    });
  } else {
    resize5DView();
  }

  rebuild5DFieldAndTroops();
  start5DLoop();
}

function resize5DView() {
  if (!threeRenderer) return;
  const container = document.getElementById('canvas-5d-container');
  const totalH = fieldH + DANTON_AREA_H;
  container.style.width = fieldW + 'px';
  container.style.height = totalH + 'px';
  threeCamera.aspect = fieldW / totalH;
  updateCamera5DPosition();
  threeCamera.updateProjectionMatrix();
  threeRenderer.setSize(fieldW, totalH);
}

function create5DHumanFigure(member) {
  const group = new THREE.Group();
  const uni = normalizeMemberUniform(member);

  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(0.3, 14),
    new THREE.MeshBasicMaterial({ color: 0x051b11, transparent: true, opacity: 0.45 })
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.02;
  group.add(shadow);

  const selRing = new THREE.Mesh(
    new THREE.RingGeometry(0.28, 0.38, 18),
    new THREE.MeshBasicMaterial({ color: 0xfacc15, side: THREE.DoubleSide })
  );
  selRing.rotation.x = -Math.PI / 2;
  selRing.position.y = 0.026;
  selRing.visible = selectedMemberIds.includes(member.id);
  group.add(selRing);

  const chest = new THREE.Mesh(
    new THREE.BoxGeometry(0.38, 0.34, 0.21),
    new THREE.MeshLambertMaterial({ color: uni.top })
  );
  chest.position.y = 1.0;
  group.add(chest);

  const waist = new THREE.Mesh(
    new THREE.BoxGeometry(0.31, 0.22, 0.18),
    new THREE.MeshLambertMaterial({ color: uni.top })
  );
  waist.position.y = 0.73;
  group.add(waist);

  const belt = new THREE.Mesh(
    new THREE.BoxGeometry(0.33, 0.05, 0.195),
    new THREE.MeshLambertMaterial({ color: 0xf8fafc })
  );
  belt.position.y = 0.64;
  group.add(belt);

  const neck = new THREE.Mesh(
    new THREE.CylinderGeometry(0.06, 0.07, 0.08, 8),
    new THREE.MeshLambertMaterial({ color: 0xfbbf24 })
  );
  neck.position.y = 1.2;
  group.add(neck);

  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.135, 12, 12),
    new THREE.MeshLambertMaterial({ color: 0xfcd34d })
  );
  head.position.y = 1.33;
  group.add(head);

  const capCrown = new THREE.Mesh(
    new THREE.CylinderGeometry(0.165, 0.135, 0.08, 12),
    new THREE.MeshLambertMaterial({ color: uni.cap })
  );
  capCrown.position.y = 1.44;
  group.add(capCrown);

  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.17, 0.025, 0.13),
    new THREE.MeshPhongMaterial({ color: 0x0f172a, shininess: 60 })
  );
  visor.position.set(0, 1.39, 0.14);
  group.add(visor);

  const emblem = new THREE.Mesh(
    new THREE.SphereGeometry(0.025, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xfacc15 })
  );
  emblem.position.set(0, 1.44, 0.16);
  group.add(emblem);

  const legGeo = new THREE.CylinderGeometry(0.075, 0.062, 0.46, 8);
  const legMat = new THREE.MeshLambertMaterial({ color: uni.bottom });
  const bootGeo = new THREE.BoxGeometry(0.13, 0.17, 0.21);
  const bootMat = new THREE.MeshPhongMaterial({ color: uni.boots, shininess: 70 });

  const leftLegGroup = new THREE.Group();
  leftLegGroup.position.set(-0.095, 0.62, 0);
  const leftPants = new THREE.Mesh(legGeo, legMat);
  leftPants.position.y = -0.23;
  const leftBoot = new THREE.Mesh(bootGeo, bootMat);
  leftBoot.position.set(0, -0.52, 0.03);
  leftLegGroup.add(leftPants, leftBoot);
  group.add(leftLegGroup);

  const rightLegGroup = new THREE.Group();
  rightLegGroup.position.set(0.095, 0.62, 0);
  const rightPants = new THREE.Mesh(legGeo, legMat);
  rightPants.position.y = -0.23;
  const rightBoot = new THREE.Mesh(bootGeo, bootMat);
  rightBoot.position.set(0, -0.52, 0.03);
  rightLegGroup.add(rightPants, rightBoot);
  group.add(rightLegGroup);

  const armGeo = new THREE.CylinderGeometry(0.052, 0.045, 0.46, 8);
  const armMat = new THREE.MeshLambertMaterial({ color: uni.top });
  const handGeo = new THREE.SphereGeometry(0.048, 8, 8);
  const handMat = new THREE.MeshLambertMaterial({ color: 0xfcd34d });

  const leftArmGroup = new THREE.Group();
  leftArmGroup.position.set(-0.24, 1.12, 0);
  const leftArmMesh = new THREE.Mesh(armGeo, armMat);
  leftArmMesh.position.y = -0.23;
  const leftHand = new THREE.Mesh(handGeo, handMat);
  leftHand.position.y = -0.48;
  leftArmGroup.add(leftArmMesh, leftHand);
  group.add(leftArmGroup);

  const rightArmGroup = new THREE.Group();
  rightArmGroup.position.set(0.24, 1.12, 0);
  const rightArmMesh = new THREE.Mesh(armGeo, armMat);
  rightArmMesh.position.y = -0.23;
  const rightHand = new THREE.Mesh(handGeo, handMat);
  rightHand.position.y = -0.48;
  rightArmGroup.add(rightArmMesh, rightHand);
  group.add(rightArmGroup);

  group.userData = {
    selRing,
    leftLeg: leftLegGroup,
    rightLeg: rightLegGroup,
    leftArm: leftArmGroup,
    rightArm: rightArmGroup,
    targetPos: new THREE.Vector3(),
    memberId: member.id
  };
  return group;
}

function createRealisticFlagpole5D() {
  const flagGroup = new THREE.Group();
  const zPos = (fieldMetersW / 2) + 0.85;

  const step1 = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 0.16, 1.8),
    new THREE.MeshLambertMaterial({ color: 0xe2e8f0 })
  );
  step1.position.set(0, 0.08, zPos);
  flagGroup.add(step1);

  const step2 = new THREE.Mesh(
    new THREE.BoxGeometry(1.5, 0.16, 1.2),
    new THREE.MeshLambertMaterial({ color: 0xcbd5e1 })
  );
  step2.position.set(0, 0.24, zPos);
  flagGroup.add(step2);

  const step3 = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.2, 0.7),
    new THREE.MeshLambertMaterial({ color: 0x94a3b8 })
  );
  step3.position.set(0, 0.42, zPos);
  flagGroup.add(step3);

  const poleHeight = 7.5;
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.045, 0.075, poleHeight, 12),
    new THREE.MeshPhongMaterial({ color: 0xf1f5f9, shininess: 90 })
  );
  pole.position.set(0, 0.5 + poleHeight / 2, zPos);
  flagGroup.add(pole);

  const finial = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 12),
    new THREE.MeshPhongMaterial({ color: 0xfacc15, shininess: 100 })
  );
  finial.position.set(0, 0.5 + poleHeight + 0.08, zPos);
  flagGroup.add(finial);

  const rope = new THREE.Mesh(
    new THREE.CylinderGeometry(0.01, 0.01, poleHeight - 0.3, 6),
    new THREE.MeshBasicMaterial({ color: 0xf8fafc })
  );
  rope.position.set(0.08, 0.5 + poleHeight / 2, zPos);
  flagGroup.add(rope);

  const flagW = 2.1;
  const flagH = 1.4;
  const flagGeo = new THREE.PlaneGeometry(flagW, flagH, 12, 6);
  const flagCanvas = document.createElement('canvas');
  flagCanvas.width = 128;
  flagCanvas.height = 64;
  const fCtx = flagCanvas.getContext('2d');
  fCtx.fillStyle = '#dc2626';
  fCtx.fillRect(0, 0, 128, 32);
  fCtx.fillStyle = '#ffffff';
  fCtx.fillRect(0, 32, 128, 32);

  const flagTex = new THREE.CanvasTexture(flagCanvas);
  const flagMesh = new THREE.Mesh(
    flagGeo,
    new THREE.MeshLambertMaterial({ map: flagTex, side: THREE.DoubleSide })
  );
  flagMesh.position.set(flagW / 2 + 0.06, 0.5 + poleHeight - flagH / 2 - 0.15, zPos);
  flagGroup.add(flagMesh);

  threeFlagMesh = flagMesh;
  return flagGroup;
}

function update5DSelectionHighlight() {
  Object.entries(threeMembers).forEach(([id, fig]) => {
    if (fig.userData.selRing) {
      fig.userData.selRing.visible = selectedMemberIds.includes(id);
    }
  });
}

function map2DTo3D(x2d, y2d) {
  const x3d = ((x2d / fieldW) - 0.5) * fieldMetersL;
  const z3d = ((y2d / fieldH) - 0.5) * fieldMetersW;
  return { x: x3d, z: z3d };
}

function map3DTo2D(x3d, z3d) {
  const x2d = Math.round(((x3d / fieldMetersL) + 0.5) * fieldW);
  const y2d = Math.round(((z3d / fieldMetersW) + 0.5) * fieldH);
  return { x: x2d, y: y2d };
}

function rebuild5DFieldAndTroops() {
  if (!threeScene) return;
  for (let i = threeScene.children.length - 1; i >= 0; i--) {
    if (!(threeScene.children[i] instanceof THREE.Light)) {
      threeScene.remove(threeScene.children[i]);
    }
  }
  threeMembers = {};
  threeFlagMesh = null;

  const outerGround = new THREE.Mesh(
    new THREE.PlaneGeometry(fieldMetersL + 16, fieldMetersW + 16),
    new THREE.MeshLambertMaterial({ color: 0x1e293b })
  );
  outerGround.rotation.x = -Math.PI / 2;
  outerGround.position.y = -0.02;
  threeScene.add(outerGround);

  const grassTex = createRealisticGrassTexture();
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(fieldMetersL, fieldMetersW),
    new THREE.MeshLambertMaterial({ map: grassTex })
  );
  plane.rotation.x = -Math.PI / 2;
  threeScene.add(plane);

  const mainFieldBorder = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.PlaneGeometry(fieldMetersL, fieldMetersW)),
    new THREE.LineBasicMaterial({ color: 0xffffff })
  );
  mainFieldBorder.rotation.x = -Math.PI / 2;
  mainFieldBorder.position.y = 0.015;
  threeScene.add(mainFieldBorder);

  if (competitionMode === 'LKBB') {
    const dantonBox = new THREE.Mesh(
      new THREE.PlaneGeometry(1.8, 1.5),
      new THREE.MeshLambertMaterial({ map: grassTex })
    );
    dantonBox.rotation.x = -Math.PI / 2;
    dantonBox.position.set(0, 0.01, (fieldMetersW / 2) + 0.75);
    threeScene.add(dantonBox);

    const dantonBorder = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(1.8, 1.5)),
      new THREE.LineBasicMaterial({ color: 0xffffff })
    );
    dantonBorder.rotation.x = -Math.PI / 2;
    dantonBorder.position.set(0, 0.018, (fieldMetersW / 2) + 0.75);
    threeScene.add(dantonBorder);
  } else {
    threeScene.add(createRealisticFlagpole5D());
  }

  const maxDim = Math.max(fieldMetersL, fieldMetersW);
  const gridHelper = new THREE.GridHelper(maxDim, maxDim, 0xffffff, 0x2d6a4f);
  gridHelper.scale.set(fieldMetersL / maxDim, 1, fieldMetersW / maxDim);
  gridHelper.position.y = 0.01;
  threeScene.add(gridHelper);

  const sceneData = scenes[currentSceneIdx];
  if (!sceneData) return;

  sceneData.members.forEach(m => {
    const fig = create5DHumanFigure(m);
    const pos = map2DTo3D(m.x, m.y);
    fig.position.set(pos.x, 0, pos.z);
    fig.rotation.y = m.facing !== undefined ? m.facing : 0;
    fig.userData.targetPos.set(pos.x, 0, pos.z);
    threeScene.add(fig);
    threeMembers[m.id] = fig;
  });
}

function sync5DPositions(animate = true) {
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

function start5DLoop() {
  if (threeAnimId) return;
  const clock = new THREE.Clock();

  const animate = () => {
    threeAnimId = requestAnimationFrame(animate);
    const elapsed = clock.getElapsedTime();
    const t = elapsed * 10;
    const sceneData = scenes[currentSceneIdx];

    if (threeFlagMesh) {
      const posAttr = threeFlagMesh.geometry.attributes.position;
      for (let i = 0; i < posAttr.count; i++) {
        const vx = posAttr.getX(i);
        const wave = Math.sin(vx * 3.5 - elapsed * 5.5) * 0.08 * ((vx + 1.05) / 2.1);
        posAttr.setZ(i, wave);
      }
      posAttr.needsUpdate = true;
    }

    Object.entries(threeMembers).forEach(([id, fig], idx) => {
      const target = fig.userData.targetPos;
      const dx = target.x - fig.position.x;
      const dz = target.z - fig.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.03) {
        fig.position.x += dx * 0.08;
        fig.position.z += dz * 0.08;
        fig.position.y = Math.abs(Math.sin(t)) * 0.045;
        fig.rotation.y = Math.atan2(dx, dz);

        const swing = Math.sin(t) * 0.68;
        fig.userData.leftLeg.rotation.x = swing;
        fig.userData.rightLeg.rotation.x = -swing;
        fig.userData.leftArm.rotation.x = -swing * 0.9;
        fig.userData.rightArm.rotation.x = swing * 0.9;
      } else {
        fig.position.x = target.x;
        fig.position.z = target.z;
        fig.position.y = Math.sin(elapsed * 2 + idx) * 0.007;

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

function stop5DLoop() {
  if (threeAnimId) {
    cancelAnimationFrame(threeAnimId);
    threeAnimId = null;
  }
}

// ============================================================================
// BAGIAN 8: AUDIO FILE & REKAM SUARA ABA-ABA DANTON LIVE
// ============================================================================
const audioInput = document.getElementById('audioInput');
const btnRecordVoice = document.getElementById('btnRecordVoice');

function attachAudioBlobOrFile(srcUrl, labelText) {
  if (audioElement) {
    audioElement.pause();
    URL.revokeObjectURL(audioElement.src);
  }
  audioElement = new Audio(srcUrl);
  audioElement.crossOrigin = "anonymous";
  document.getElementById('audioFileName').innerText = labelText;
  document.getElementById('audioBadge').classList.remove('hidden');
}

document.getElementById('btnAudio').addEventListener('click', () => {
  audioInput.click();
});

audioInput.addEventListener('change', (e) => {
  const file = e.target.files[0];
  if (!file) return;
  attachAudioBlobOrFile(URL.createObjectURL(file), "🎵 " + file.name);
  setStatus("File audio siap");
});

btnRecordVoice.addEventListener('click', async () => {
  if (!isRecordingVoice) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      showPopup("Mikrofon Tidak Didukung", "Browser Anda tidak mendukung perekaman suara mikrofon langsung.");
      return;
    }

    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      voiceChunks = [];
      mediaRecorderVoice = new MediaRecorder(micStream);

      mediaRecorderVoice.ondataavailable = (e) => {
        if (e.data.size > 0) voiceChunks.push(e.data);
      };

      mediaRecorderVoice.onstop = () => {
        micStream.getTracks().forEach(track => track.stop());
        const voiceBlob = new Blob(voiceChunks, { type: 'audio/webm' });
        const voiceUrl = URL.createObjectURL(voiceBlob);
        attachAudioBlobOrFile(voiceUrl, "🎙️ Rekaman Aba-aba Danton");
        setStatus("Suara tersimpan");
        triggerHaptic5D(25);
      };

      mediaRecorderVoice.start();
      isRecordingVoice = true;
      btnRecordVoice.classList.add('recording');
      btnRecordVoice.innerText = '⏹ Stop';
      setStatus("Merekam suara...");
      triggerHaptic5D(18);
    } catch (err) {
      showPopup("Izin Mikrofon Ditolak", "Izinkan akses mikrofon di browser untuk merekam aba-aba.");
    }
  } else {
    if (mediaRecorderVoice && mediaRecorderVoice.state !== 'inactive') {
      mediaRecorderVoice.stop();
    }
    isRecordingVoice = false;
    btnRecordVoice.classList.remove('recording');
    btnRecordVoice.innerText = '🎙️ Suara';
  }
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
// BAGIAN 9: TIMELINE HITUNGAN (RENAME/HAPUS), PLAY & EXPORT VIDEO HD 1080P
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
    card.ondblclick = () => {
      if (!isPlaying) renameActiveScene();
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

async function renameActiveScene() {
  const activeScene = scenes[currentSceneIdx];
  if (!activeScene) return;

  const newName = await showPopup(
    "Ubah Nama Hitungan",
    "Masukkan nama hitungan atau gerakan (maks. 18 huruf):",
    { isPrompt: true, defaultValue: activeScene.name }
  );

  if (newName === null || newName === "") return;

  saveHistoryState();
  activeScene.name = newName;
  renderTimelineUI();
  setStatus(`Hitungan: ${newName}`);
}

document.getElementById('btnRenameScene').addEventListener('click', () => {
  if (!isPlaying) renameActiveScene();
});

document.getElementById('btnDeleteScene').addEventListener('click', async () => {
  if (isPlaying) return;
  if (scenes.length <= 1) {
    showPopup("Tidak Dapat Dihapus", "Minimal harus tersisa 1 Hitungan di dalam timeline.");
    return;
  }

  const targetName = scenes[currentSceneIdx].name;
  const ok = await showPopup("Hapus Hitungan", `Hapus "${targetName}" dari timeline?`, { isConfirm: true });
  if (!ok) return;

  saveHistoryState();
  scenes.splice(currentSceneIdx, 1);
  modeStore[competitionMode].scenes = scenes;
  currentSceneIdx = Math.max(0, currentSceneIdx - 1);
  rebuildCanvas();
  if (is5DMode) rebuild5DFieldAndTroops();
  setStatus(`${targetName} dihapus`);
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
    if (is5DMode) triggerHaptic5D(18);

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

    if (is5DMode) {
      sync5DPositions(true);
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

  setStatus("Merekam Full HD 1080p...");

  const videoW = 1920;
  const videoH = 1080;
  const recordCanvas = document.createElement('canvas');
  recordCanvas.width = videoW;
  recordCanvas.height = videoH;
  const ctx = recordCanvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';

  const prevPixelRatio = threeRenderer ? threeRenderer.getPixelRatio() : 1;
  if (is5DMode && threeRenderer) {
    threeRenderer.setPixelRatio(2.5);
    threeRenderer.render(threeScene, threeCamera);
  }

  const srcW = stage.width();
  const srcH = stage.height();

  let animFrameId;
  const drawCombinedFrame = () => {
    ctx.fillStyle = '#0b1324';
    ctx.fillRect(0, 0, videoW, videoH);

    const scale = Math.min((videoW - 80) / srcW, (videoH - 80) / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const offsetX = (videoW - drawW) / 2;
    const offsetY = (videoH - drawH) / 2;

    if (is5DMode && threeRenderer) {
      ctx.drawImage(threeRenderer.domElement, offsetX, offsetY, drawW, drawH);
    } else {
      stage.getLayers().forEach(layer => {
        ctx.drawImage(layer.getCanvas()._canvas, offsetX, offsetY, drawW, drawH);
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

  const recorder = new MediaRecorder(videoStream, {
    mimeType,
    videoBitsPerSecond: 8000000
  });
  const chunks = [];

  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data);
  };

  recorder.onstop = () => {
    cancelAnimationFrame(animFrameId);
    if (is5DMode && threeRenderer) {
      threeRenderer.setPixelRatio(prevPixelRatio);
    }
    const blob = new Blob(chunks, { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = (document.getElementById('formationName').value.trim() || `Formasi_${competitionMode}`).replace(/\s+/g, '_');
    a.href = url;
    a.download = `${fileName}_HD.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
    setStatus("Video HD terunduh");
    showPopup("Video HD Selesai", `Video resolusi tinggi 1080p berhasil diunduh (${fileName}_HD.${ext}).`);
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

  modeStore[competitionMode] = { scenes, currentSceneIdx };
  const payloadData = {
    version: 2,
    activeMode: competitionMode,
    LKBB: modeStore.LKBB.scenes,
    RUKIBRA: modeStore.RUKIBRA.scenes
  };

  setStatus("Menyimpan...");
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({ action: "save", nama, dataJson: payloadData })
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

  if (Array.isArray(selected.dataJson)) {
    modeStore.LKBB = { scenes: selected.dataJson, currentSceneIdx: 0 };
    modeStore.RUKIBRA = { scenes: [], currentSceneIdx: 0 };
    competitionMode = 'LKBB';
  } else if (selected.dataJson && selected.dataJson.version === 2) {
    modeStore.LKBB = { scenes: selected.dataJson.LKBB || [], currentSceneIdx: 0 };
    modeStore.RUKIBRA = { scenes: selected.dataJson.RUKIBRA || [], currentSceneIdx: 0 };
    competitionMode = selected.dataJson.activeMode || 'LKBB';
  }

  document.getElementById('btnModeLKBB').classList.toggle('active', competitionMode === 'LKBB');
  document.getElementById('btnModeRukibra').classList.toggle('active', competitionMode === 'RUKIBRA');
  scenes = modeStore[competitionMode].scenes;
  currentSceneIdx = 0;

  setSelectedMembers([]);
  updateFieldLabel();
  drawFieldGrid();
  rebuildCanvas();
  if (is5DMode) rebuild5DFieldAndTroops();
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
  modeStore.LKBB = {
    scenes: [{ name: "Hitungan 1", members: createDefaultFormation('LKBB') }],
    currentSceneIdx: 0
  };
  scenes = modeStore.LKBB.scenes;
  renderScene(0, false);
  loadSavedFormations();
});
