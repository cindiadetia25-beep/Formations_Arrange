// ==========================================
// KONFIGURASI API GOOGLE APPS SCRIPT
// ==========================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbypOugpXmLsnd_Q4dYber4O6V_xDt4JrDeCaiA-RgrirMCDtHpaJNxewlAfiMA6MhACiA/exec";

Konva.pixelRatio = 1.25;

let fieldMetersL = 22;
let fieldMetersW = 15;
let canvasW = 300;
let canvasH = 340;

let scenes = [];
let currentSceneIdx = 0;
let memberNodes = {};
let selectedMemberId = null;
let savedFormations = [];
let isPlaying = false;

// Opsi Tampilan: 'circle' | 'person' dan Mode 2D/3D
let pointShape = 'circle';
let is3DMode = false;

let undoStack = [];
let redoStack = [];

// Audio State
let audioElement = null;
let audioCtx = null;
let audioSourceNode = null;
let audioDestNode = null;

// Three.js 3D State
let threeScene, threeCamera, threeRenderer;
let threeMembers = {};
let threeAnimId = null;
let is3DMarching = false;

// Inisialisasi Konva 2D
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

// ==========================================
// CUSTOM POP-UP MODAL (ALERT, CONFIRM & PROMPT)
// ==========================================
function showPopup(title, message, options = {}) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('customModal');
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalMessage').innerText = message;
    const btnOk = document.getElementById('modalConfirm');
    const btnCancel = document.getElementById('modalCancel');
    const inputEl = document.getElementById('modalInput');

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

// ==========================================
// UNDO & REDO
// ==========================================
function saveHistoryState() {
  undoStack.push(JSON.stringify({ scenes, currentSceneIdx }));
  if (undoStack.length > 25) undoStack.shift();
  redoStack = [];
  updateHistoryButtons();
}

function updateHistoryButtons() {
  document.getElementById('btnUndo').disabled = undoStack.length === 0;
  document.getElementById('btnRedo').disabled = redoStack.length === 0;
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

// ==========================================
// UKURAN LAPANG & RADIUS TITIK PROPORSIONAL
// ==========================================
function getMemberRadius() {
  // Lebar bahu manusia ~0.45m; proporsional terhadap 1 kotak meter lapangan
  const meterPx = Math.min(canvasW / fieldMetersW, canvasH / fieldMetersL);
  return Math.max(6, Math.min(13, Math.round(meterPx * 0.42)));
}

function calculateCanvasDimensions() {
  const maxW = Math.min(window.innerWidth - 28, 520);
  const maxH = Math.min(window.innerHeight - 335, 380);
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
  calculateCanvasDimensions();
  rebuildCanvas();
  if (is3DMode) rebuild3DFieldAndTroops();
  setStatus(`Lapang: ${l}m x ${w}m`);
});

// ==========================================
// TOGGLE BENTUK TITIK (LINGKARAN / ORANG)
// ==========================================
document.getElementById('btnToggleShape').addEventListener('click', () => {
  pointShape = pointShape === 'circle' ? 'person' : 'circle';
  document.getElementById('btnToggleShape').innerText = pointShape === 'circle' ? '👤 Orang' : '⚪ Bulat';
  rebuildCanvas();
  setStatus(pointShape === 'person' ? "Bentuk: Orang" : "Bentuk: Lingkaran");
});

// ==========================================
// MANAJEMEN PASUKAN 2D (LINGKARAN & BENTUK ORANG)
// ==========================================
function createDefaultFormation() {
  const members = [];
  const stepX = canvasW / fieldMetersW;
  const stepY = canvasH / fieldMetersL;
  const gapX = Math.max(18, stepX * 1.1);
  const gapY = Math.max(18, stepY * 1.1);
  const startX = canvasW / 2 - gapX;
  const startY = canvasH / 2 - (gapY * 2);

  members.push({
    id: 'D',
    label: 'D',
    color: '#ef4444',
    x: Math.round(Math.max(16, startX - gapX * 1.3)),
    y: Math.round(startY + (2 * gapY))
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
      mainShape.strokeWidth(key === id ? 2.5 : 1.5);
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
    // Bentuk Orang (Tampak Atas: Bahu Oval + Kepala + Label Nama di bawah)
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
      fontSize: Math.max(8, Math.round(r * 0.85)),
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
    // Bentuk Lingkaran Proporsional
    const circle = new Konva.Circle({
      name: 'mainBody',
      radius: r,
      fill: m.color,
      stroke: '#ffffff',
      strokeWidth: 1.5,
      perfectDrawEnabled: false
    });

    const fontSize = m.label.length > 2 ? Math.max(7, Math.round(r * 0.72)) : Math.max(8, Math.round(r * 0.92));
    const text = new Konva.Text({
      name: 'labelText',
      text: m.label,
      fontSize: fontSize,
      fontStyle: 'bold',
      fill: '#ffffff',
      width: r * 2.4,
      align: 'center',
      offsetX: r * 1.2,
      offsetY: fontSize * 0.5,
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

  troopLayer.batchDraw();
  renderTimelineUI();

  if (is3DMode) {
    sync3DPositions(animate);
  }
}

// Tambah 1 Pasukan
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

// Beri Nama pada Titik yang Dipilih
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

// Hapus Titik
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

// Kosongkan Lapangan
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

// Reset Formasi Standar
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

// ==========================================
// MODE SIMULASI 3D (GERAKAN MANUSIA VARIASI)
// ==========================================
document.getElementById('btnToggle3D').addEventListener('click', () => {
  is3DMode = !is3DMode;
  const c2d = document.getElementById('canvas-container');
  const c3d = document.getElementById('canvas-3d-container');
  const btn = document.getElementById('btnToggle3D');

  if (is3DMode) {
    c2d.classList.add('hidden');
    c3d.classList.remove('hidden');
    btn.innerText = '🗺️ 2D';
    init3DScene();
    setStatus("Mode 3D Aktif");
  } else {
    c3d.classList.add('hidden');
    c2d.classList.remove('hidden');
    btn.innerText = '🧊 3D';
    stop3DLoop();
    setStatus("Mode 2D Aktif");
  }
});

function init3DScene() {
  const container = document.getElementById('canvas-3d-container');
  container.style.width = canvasW + 'px';
  container.style.height = canvasH + 'px';

  if (!threeRenderer) {
    threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color(0x0f172a);

    threeCamera = new THREE.PerspectiveCamera(42, canvasW / canvasH, 0.1, 200);
    // Sudut pandang tribun Dewan Juri menghadap lapangan
    threeCamera.position.set(0, fieldMetersL * 0.95, fieldMetersL * 0.95);
    threeCamera.lookAt(0, 0, 0);

    threeRenderer = new THREE.WebGLRenderer({ antialias: true });
    threeRenderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    threeRenderer.setSize(canvasW, canvasH);
    container.innerHTML = '';
    container.appendChild(threeRenderer.domElement);

    const ambient = new THREE.AmbientLight(0xffffff, 0.75);
    threeScene.add(ambient);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.7);
    dirLight.position.set(10, 25, 15);
    threeScene.add(dirLight);
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
  threeCamera.position.set(0, fieldMetersL * 0.95, fieldMetersL * 0.95);
  threeCamera.lookAt(0, 0, 0);
  threeCamera.updateProjectionMatrix();
  threeRenderer.setSize(canvasW, canvasH);
}

function create3DHumanFigure(member) {
  const group = new THREE.Group();
  const isDanton = member.id === 'D';
  const uniformColor = isDanton ? 0xdc2626 : 0xf8fafc; // Danton merah, Pasukan putih PDU
  const pantsColor = isDanton ? 0x991b1b : 0x1e3a8a;

  // Badan (Torso)
  const torso = new THREE.Mesh(
    new THREE.BoxGeometry(0.36, 0.55, 0.2),
    new THREE.MeshLambertMaterial({ color: uniformColor })
  );
  torso.position.y = 0.85;
  group.add(torso);

  // Kepala & Peci/Baret
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

  // Kaki Kiri & Kanan (Untuk Animasi Langkah Tegap / Jalan)
  const legGeo = new THREE.BoxGeometry(0.13, 0.58, 0.14);
  const legMat = new THREE.MeshLambertMaterial({ color: pantsColor });

  const leftLeg = new THREE.Mesh(legGeo, legMat);
  leftLeg.position.set(-0.1, 0.29, 0);
  group.add(leftLeg);

  const rightLeg = new THREE.Mesh(legGeo, legMat);
  rightLeg.position.set(0.1, 0.29, 0);
  group.add(rightLeg);

  // Lengan Kiri & Kanan (Untuk Animasi Melenggang)
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
  // Hapus objek lama kecuali lampu
  for (let i = threeScene.children.length - 1; i >= 0; i--) {
    if (!(threeScene.children[i] instanceof THREE.Light)) {
      threeScene.remove(threeScene.children[i]);
    }
  }
  threeMembers = {};

  // Lantai Lapangan Hijau 3D
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(fieldMetersW, fieldMetersL),
    new THREE.MeshLambertMaterial({ color: 0x1b4332 })
  );
  plane.rotation.x = -Math.PI / 2;
  threeScene.add(plane);

  // Garis Grid 3D
  const gridHelper = new THREE.GridHelper(Math.max(fieldMetersW, fieldMetersL), Math.max(fieldMetersW, fieldMetersL), 0xffffff, 0x2d6a4f);
  gridHelper.scale.set(fieldMetersW / Math.max(fieldMetersW, fieldMetersL), 1, fieldMetersL / Math.max(fieldMetersW, fieldMetersL));
  gridHelper.position.y = 0.01;
  threeScene.add(gridHelper);

  // Pasukan 3D
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
    const t = clock.getElapsedTime() * 10; // Tempo langkah Paskibra

    Object.values(threeMembers).forEach(fig => {
      const target = fig.userData.targetPos;
      const dx = target.x - fig.position.x;
      const dz = target.z - fig.position.z;
      const dist = Math.hypot(dx, dz);

      if (dist > 0.03) {
        // Bergerak menuju titik berikutnya + menghadap arah jalan
        fig.position.x += dx * 0.08;
        fig.position.z += dz * 0.08;
        fig.rotation.y = Math.atan2(dx, dz);

        // Animasi ayunan langkah tegap kaki & lengan
        const swing = Math.sin(t) * 0.65;
        fig.userData.leftLeg.rotation.x = swing;
        fig.userData.rightLeg.rotation.x = -swing;
        fig.userData.leftArm.rotation.x = -swing * 0.85;
        fig.userData.rightArm.rotation.x = swing * 0.85;
      } else {
        // Sikap sempurna (berhenti tegak menghadap Dewan Juri)
        fig.position.x = target.x;
        fig.position.z = target.z;
        fig.rotation.y = Math.PI; // Menghadap ke arah depan (Dewan Juri)
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

// ==========================================
// AUDIO / LAGU IRINGAN
// ==========================================
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

// ==========================================
// TIMELINE, PLAY & DOWNLOAD VIDEO
// ==========================================
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
  if (!MediaRecorder.isTypeSupported('video/mp4')) {
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

// ==========================================
// DATABASE GOOGLE APPS SCRIPT
// ==========================================
function setStatus(msg) {
  document.getElementById('statusText').innerText = msg;
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
  if (APPS_SCRIPT_URL.includes("TEMPEL_URL")) return;
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

// ==========================================
// INISIALISASI
// ==========================================
calculateCanvasDimensions();
scenes.push({
  name: "Hitungan 1",
  members: createDefaultFormation()
});
renderScene(0, false);
loadSavedFormations();
