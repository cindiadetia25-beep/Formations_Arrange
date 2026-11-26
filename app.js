// ==========================================
// KONFIGURASI API GOOGLE APPS SCRIPT
// ==========================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbypOugpXmLsnd_Q4dYber4O6V_xDt4JrDeCaiA-RgrirMCDtHpaJNxewlAfiMA6MhACiA/exec";

// Ukuran Meter Lapangan & Skala Pixel
let fieldMetersL = 22; // Panjang (ke belakang)
let fieldMetersW = 15; // Lebar (ke samping)
let canvasW = 300;
let canvasH = 360;

// State Utama & Riwayat Undo/Redo
let scenes = [];
let currentSceneIdx = 0;
let memberNodes = {};
let selectedMemberId = null;
let savedFormations = [];

let undoStack = [];
let redoStack = [];

// Inisialisasi Konva Stage & Layer
const stage = new Konva.Stage({
  container: 'canvas-container',
  width: canvasW,
  height: canvasH
});

const gridLayer = new Konva.Layer();
const troopLayer = new Konva.Layer();
stage.add(gridLayer);
stage.add(troopLayer);

// ==========================================
// SISTEM CUSTOM POP-UP MODAL (DI DALAM LAYAR)
// ==========================================
function showPopup(title, message, isConfirm = false) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('customModal');
    const titleEl = document.getElementById('modalTitle');
    const msgEl = document.getElementById('modalMessage');
    const btnOk = document.getElementById('modalConfirm');
    const btnCancel = document.getElementById('modalCancel');

    titleEl.innerText = title;
    msgEl.innerText = message;
    overlay.classList.remove('hidden');

    if (isConfirm) {
      btnCancel.classList.remove('hidden');
    } else {
      btnCancel.classList.add('hidden');
    }

    const cleanup = (result) => {
      overlay.classList.add('hidden');
      btnOk.onclick = null;
      btnCancel.onclick = null;
      resolve(result);
    };

    btnOk.onclick = () => cleanup(true);
    btnCancel.onclick = () => cleanup(false);
  });
}

// ==========================================
// SISTEM UNDO & REDO
// ==========================================
function saveHistoryState() {
  undoStack.push(JSON.stringify({
    scenes: scenes,
    currentSceneIdx: currentSceneIdx
  }));
  if (undoStack.length > 30) undoStack.shift(); // Maksimal 30 langkah
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
  setStatus("Undo dilakukan");
});

document.getElementById('btnRedo').addEventListener('click', () => {
  if (redoStack.length === 0) return;
  undoStack.push(JSON.stringify({ scenes, currentSceneIdx }));
  const next = JSON.parse(redoStack.pop());
  scenes = next.scenes;
  currentSceneIdx = next.currentSceneIdx;
  rebuildCanvas();
  updateHistoryButtons();
  setStatus("Redo dilakukan");
});

// ==========================================
// PENGATURAN UKURAN & GRID LAPANGAN
// ==========================================
function calculateCanvasDimensions() {
  const maxW = Math.min(window.innerWidth - 32, 540);
  const maxH = Math.min(window.innerHeight - 270, 440);
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
}

function drawFieldGrid() {
  gridLayer.destroyChildren();
  const stepX = canvasW / fieldMetersW; // 1 kotak = 1 meter
  const stepY = canvasH / fieldMetersL;

  for (let i = 1; i < fieldMetersW; i++) {
    gridLayer.add(new Konva.Line({
      points: [i * stepX, 0, i * stepX, canvasH],
      stroke: i % 5 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
      strokeWidth: 1
    }));
  }

  for (let j = 1; j < fieldMetersL; j++) {
    gridLayer.add(new Konva.Line({
      points: [0, j * stepY, canvasW, j * stepY],
      stroke: j % 5 === 0 ? 'rgba(255,255,255,0.35)' : 'rgba(255,255,255,0.12)',
      strokeWidth: 1
    }));
  }

  // Titik Tengah Lapangan
  gridLayer.add(new Konva.Circle({
    x: canvasW / 2,
    y: canvasH / 2,
    radius: 4,
    fill: '#facc15'
  }));

  gridLayer.draw();
}

document.getElementById('btnApplyField').addEventListener('click', () => {
  const l = parseInt(document.getElementById('fieldLength').value);
  const w = parseInt(document.getElementById('fieldWidth').value);
  if (!l || !w || l < 5 || w < 5) {
    showPopup("Ukuran Tidak Valid", "Masukkan panjang dan lebar lapangan minimal 5 meter.");
    return;
  }
  fieldMetersL = l;
  fieldMetersW = w;
  calculateCanvasDimensions();
  setStatus(`Lapangan diubah: ${l}m x ${w}m`);
});

// ==========================================
// MANAJEMEN PASUKAN & SELEKSI TITIK
// ==========================================
function createDefaultFormation() {
  const members = [];
  const startX = canvasW / 2 - 34;
  const startY = canvasH / 2 - 60;
  const gap = 34;

  members.push({
    id: 'D',
    label: 'D',
    color: '#ef4444',
    x: Math.max(20, startX - 42),
    y: startY + (2 * gap)
  });

  let num = 1;
  for (let saf = 0; saf < 5; saf++) {
    for (let ban = 0; ban < 3; ban++) {
      members.push({
        id: 'P' + num,
        label: String(num),
        color: '#2563eb',
        x: startX + (ban * gap),
        y: startY + (saf * gap)
      });
      num++;
    }
  }
  return members;
}

function selectMember(id) {
  selectedMemberId = id;
  document.getElementById('btnDeleteSelected').disabled = !id;

  Object.keys(memberNodes).forEach(key => {
    const circle = memberNodes[key].findOne('Circle');
    if (circle) {
      circle.stroke(key === id ? '#facc15' : '#ffffff');
      circle.strokeWidth(key === id ? 3.5 : 2);
    }
  });
  troopLayer.draw();
}

// Klik area kosong lapangan untuk membatalkan pilihan titik
stage.on('click tap', (e) => {
  if (e.target === stage) {
    selectMember(null);
  }
});

function rebuildCanvas() {
  troopLayer.destroyChildren();
  memberNodes = {};
  selectMember(null);
  renderScene(currentSceneIdx, false);
}

function renderScene(sceneIndex, animate = true) {
  currentSceneIdx = sceneIndex;
  const sceneData = scenes[sceneIndex];
  if (!sceneData) return;

  // Hapus node yang sudah tidak ada di scene ini
  const currentIds = sceneData.members.map(m => m.id);
  Object.keys(memberNodes).forEach(id => {
    if (!currentIds.includes(id)) {
      memberNodes[id].destroy();
      delete memberNodes[id];
    }
  });

  sceneData.members.forEach(m => {
    if (!memberNodes[m.id]) {
      const group = new Konva.Group({
        x: m.x,
        y: m.y,
        draggable: true
      });

      const circle = new Konva.Circle({
        radius: 13,
        fill: m.color,
        stroke: '#ffffff',
        strokeWidth: 2,
        shadowColor: 'black',
        shadowBlur: 4,
        shadowOpacity: 0.4
      });

      const text = new Konva.Text({
        text: m.label,
        fontSize: 11,
        fontStyle: 'bold',
        fill: '#ffffff',
        width: 26,
        align: 'center',
        offsetX: 13,
        offsetY: 5.5
      });

      group.add(circle);
      group.add(text);

      // Pilih titik saat diklik/disentuh
      group.on('click tap', (e) => {
        e.cancelBubble = true;
        selectMember(m.id);
        setStatus(`Terpilih: Titik ${m.label}`);
      });

      // Simpan riwayat sebelum digeser
      group.on('dragstart', () => {
        selectMember(m.id);
        saveHistoryState();
      });

      // Simpan koordinat baru setelah digeser
      group.on('dragend', () => {
        const target = scenes[currentSceneIdx].members.find(item => item.id === m.id);
        if (target) {
          target.x = Math.round(group.x());
          target.y = Math.round(group.y());
        }
      });

      troopLayer.add(group);
      memberNodes[m.id] = group;
    } else {
      if (animate) {
        memberNodes[m.id].to({ x: m.x, y: m.y, duration: 0.25 });
      } else {
        memberNodes[m.id].position({ x: m.x, y: m.y });
      }
    }
  });

  troopLayer.draw();
  renderTimelineUI();
}

// Tambah 1 Anggota Pasukan
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
  setStatus(`Titik ${nextNum} ditambahkan`);
});

// Hapus Titik yang Dipilih
document.getElementById('btnDeleteSelected').addEventListener('click', async () => {
  if (!selectedMemberId) return;
  const ok = await showPopup("Hapus Titik", "Hapus titik pasukan yang dipilih dari seluruh hitungan?", true);
  if (!ok) return;

  saveHistoryState();
  scenes.forEach(sc => {
    sc.members = sc.members.filter(m => m.id !== selectedMemberId);
  });
  selectMember(null);
  renderScene(currentSceneIdx, false);
  setStatus("Titik dihapus");
});

// Hapus Seluruh Titik (Kosongkan Lapangan)
document.getElementById('btnClearAll').addEventListener('click', async () => {
  const ok = await showPopup("Hapus Semua", "Kosongkan seluruh titik pasukan di lapangan?", true);
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: [] }];
  currentSceneIdx = 0;
  rebuildCanvas();
  setStatus("Lapangan dikosongkan");
});

// Reset ke Formasi Standar (3 Ban x 5 Saf + Danton)
document.getElementById('btnResetPos').addEventListener('click', async () => {
  const ok = await showPopup("Reset Formasi", "Kembalikan pasukan ke formasi awal (15 pasukan + Danton)?", true);
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: createDefaultFormation() }];
  currentSceneIdx = 0;
  rebuildCanvas();
  setStatus("Formasi di-reset");
});

// ==========================================
// TIMELINE & ANIMASI
// ==========================================
function renderTimelineUI() {
  const listEl = document.getElementById('sceneList');
  listEl.innerHTML = '';

  scenes.forEach((sc, idx) => {
    const card = document.createElement('div');
    card.className = `scene-card ${idx === currentSceneIdx ? 'active' : ''}`;
    card.innerText = sc.name;
    card.onclick = () => renderScene(idx);
    listEl.appendChild(card);
  });
}

document.getElementById('btnAddScene').addEventListener('click', () => {
  saveHistoryState();
  const lastScene = scenes[scenes.length - 1];
  const clonedMembers = JSON.parse(JSON.stringify(lastScene.members));

  scenes.push({
    name: `Hitungan ${scenes.length + 1}`,
    members: clonedMembers
  });

  renderScene(scenes.length - 1);
  setStatus(`Hitungan ${scenes.length} dibuat`);
});

document.getElementById('btnPlay').addEventListener('click', async () => {
  if (scenes.length < 2) {
    showPopup("Animasi", "Tambahkan minimal 2 Hitungan terlebih dahulu untuk memutar pergerakan.");
    return;
  }

  setStatus("Memutar...");
  for (let i = 0; i < scenes.length; i++) {
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

    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  setStatus("Selesai");
});

// ==========================================
// KONEKSI DATABASE GOOGLE APPS SCRIPT
// ==========================================
function setStatus(msg) {
  document.getElementById('statusText').innerText = msg;
}

document.getElementById('btnSave').addEventListener('click', async () => {
  const nama = document.getElementById('formationName').value.trim();
  if (!nama) {
    showPopup("Nama Kosong", "Silakan isi nama formasi terlebih dahulu sebelum menyimpan.");
    return;
  }

  setStatus("Menyimpan...");
  try {
    const response = await fetch(APPS_SCRIPT_URL, {
      method: "POST",
      body: JSON.stringify({
        action: "save",
        nama: nama,
        dataJson: scenes
      })
    });
    const result = await response.json();
    if (result.status === "success") {
      setStatus("Tersimpan");
      showPopup("Berhasil", result.message);
      loadSavedFormations();
    } else {
      showPopup("Gagal Menyimpan", result.message);
    }
  } catch (err) {
    setStatus("Gagal terhubung");
    showPopup("Koneksi Gagal", "Tidak dapat terhubung ke Google Apps Script. Periksa internet atau URL API Anda.");
  }
});

async function loadSavedFormations() {
  if (APPS_SCRIPT_URL.includes("TEMPEL_URL")) return;

  setStatus("Memuat cloud...");
  try {
    const res = await fetch(APPS_SCRIPT_URL);
    const json = await res.json();
    if (json.status === "success") {
      savedFormations = json.data;
      const select = document.getElementById('savedList');
      select.innerHTML = '<option value="">-- Muat Formasi --</option>';

      savedFormations.forEach((item, index) => {
        const opt = document.createElement('option');
        opt.value = index;
        opt.innerText = `${item.nama} (${item.tanggal})`;
        select.appendChild(opt);
      });
      setStatus("Siap");
    }
  } catch (e) {
    setStatus("Offline");
  }
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
  setStatus(`Dimuat: ${selected.nama}`);
});

// ==========================================
// INISIALISASI AWAL
// ==========================================
calculateCanvasDimensions();
scenes.push({
  name: "Hitungan 1",
  members: createDefaultFormation()
});
renderScene(0, false);
loadSavedFormations();
