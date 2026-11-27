// ==========================================
// KONFIGURASI API GOOGLE APPS SCRIPT
// ==========================================
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbypOugpXmLsnd_Q4dYber4O6V_xDt4JrDeCaiA-RgrirMCDtHpaJNxewlAfiMA6MhACiA/exec";

// Optimasi Performa Mobile (Mencegah Lag pada Layar Retina/HP)
Konva.pixelRatio = 1.25;

let fieldMetersL = 22;
let fieldMetersW = 15;
let canvasW = 300;
let canvasH = 360;

let scenes = [];
let currentSceneIdx = 0;
let memberNodes = {};
let selectedMemberId = null;
let savedFormations = [];
let isPlaying = false;

let undoStack = [];
let redoStack = [];

// Audio State
let audioElement = null;
let audioCtx = null;
let audioSourceNode = null;
let audioDestNode = null;

// Inisialisasi Konva Stage & Layer
const stage = new Konva.Stage({
  container: 'canvas-container',
  width: canvasW,
  height: canvasH
});

const bgLayer = new Konva.Layer({ listening: false }); // Layer latar hijau untuk rekaman video
const gridLayer = new Konva.Layer({ listening: false }); // Nonaktifkan hit-detection grid agar ringan
const troopLayer = new Konva.Layer();
stage.add(bgLayer);
stage.add(gridLayer);
stage.add(troopLayer);

// ==========================================
// CUSTOM POP-UP MODAL
// ==========================================
function showPopup(title, message, isConfirm = false) {
  return new Promise((resolve) => {
    const overlay = document.getElementById('customModal');
    document.getElementById('modalTitle').innerText = title;
    document.getElementById('modalMessage').innerText = message;
    const btnOk = document.getElementById('modalConfirm');
    const btnCancel = document.getElementById('modalCancel');

    overlay.classList.remove('hidden');
    btnCancel.classList.toggle('hidden', !isConfirm);

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
// UKURAN & GRID LAPANGAN (DI-CACHE AGAR RINGAN)
// ==========================================
function calculateCanvasDimensions() {
  const maxW = Math.min(window.innerWidth - 28, 520);
  const maxH = Math.min(window.innerHeight - 285, 420);
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
  bgLayer.destroyChildren();
  gridLayer.clearCache();
  gridLayer.destroyChildren();

  // Latar hijau lapangan digambar di canvas agar ikut terekam saat Export Video
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

  gridLayer.cache(); // Cache grid sebagai bitmap tunggal agar drag pasukan sangat mulus
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
  setStatus(`Lapang: ${l}m x ${w}m`);
});

// ==========================================
// MANAJEMEN PASUKAN (OPTIMASI GPU HP)
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
      circle.strokeWidth(key === id ? 3 : 2);
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
  selectMember(null);
  renderScene(currentSceneIdx, false);
}

function renderScene(sceneIndex, animate = true) {
  currentSceneIdx = sceneIndex;
  const sceneData = scenes[sceneIndex];
  if (!sceneData) return;

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

      // Tanpa shadowBlur agar tidak berat saat digeser di HP
      const circle = new Konva.Circle({
        radius: 13,
        fill: m.color,
        stroke: '#ffffff',
        strokeWidth: 2,
        perfectDrawEnabled: false
      });

      const text = new Konva.Text({
        text: m.label,
        fontSize: 11,
        fontStyle: 'bold',
        fill: '#ffffff',
        width: 26,
        align: 'center',
        offsetX: 13,
        offsetY: 5.5,
        listening: false,
        perfectDrawEnabled: false
      });

      group.add(circle);
      group.add(text);

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

  troopLayer.batchDraw();
  renderTimelineUI();
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
  setStatus(`+ Titik ${nextNum}`);
});

document.getElementById('btnDeleteSelected').addEventListener('click', async () => {
  if (!selectedMemberId) return;
  const ok = await showPopup("Hapus Titik", "Hapus titik yang dipilih dari semua hitungan?", true);
  if (!ok) return;

  saveHistoryState();
  scenes.forEach(sc => {
    sc.members = sc.members.filter(m => m.id !== selectedMemberId);
  });
  selectMember(null);
  renderScene(currentSceneIdx, false);
  setStatus("Titik dihapus");
});

document.getElementById('btnClearAll').addEventListener('click', async () => {
  const ok = await showPopup("Hapus Semua", "Kosongkan seluruh titik pasukan di lapangan?", true);
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: [] }];
  currentSceneIdx = 0;
  rebuildCanvas();
  setStatus("Lapang kosong");
});

document.getElementById('btnResetPos').addEventListener('click', async () => {
  const ok = await showPopup("Reset Formasi", "Kembalikan ke formasi awal (15 pasukan + Danton)?", true);
  if (!ok) return;

  saveHistoryState();
  scenes = [{ name: "Hitungan 1", members: createDefaultFormation() }];
  currentSceneIdx = 0;
  rebuildCanvas();
  setStatus("Reset selesai");
});

// ==========================================
// FITUR AUDIO / LAGU IRINGAN
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

  const url = URL.createObjectURL(file);
  audioElement = new Audio(url);
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
// TIMELINE, PLAY & DOWNLOAD VIDEO MP4
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

  // Mulai dari posisi Hitungan 1 tanpa animasi
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

// Rekam Semua Hitungan Menjadi Video MP4
document.getElementById('btnExportVideo').addEventListener('click', async () => {
  if (isPlaying) return;
  if (scenes.length < 2) {
    showPopup("Info Video", "Tambahkan minimal 2 Hitungan terlebih dahulu sebelum mengunduh video.");
    return;
  }

  setStatus("Merekam video...");

  // Gabungkan semua layer Konva ke satu canvas sementara untuk direkam
  const recordCanvas = document.createElement('canvas');
  recordCanvas.width = stage.width();
  recordCanvas.height = stage.height();
  const ctx = recordCanvas.getContext('2d');

  let animFrameId;
  const drawCombinedFrame = () => {
    ctx.clearRect(0, 0, recordCanvas.width, recordCanvas.height);
    stage.getLayers().forEach(layer => {
      ctx.drawImage(layer.getCanvas()._canvas, 0, 0, recordCanvas.width, recordCanvas.height);
    });
    animFrameId = requestAnimationFrame(drawCombinedFrame);
  };
  drawCombinedFrame();

  const videoStream = recordCanvas.captureStream(30);

  // Gabungkan trek audio jika pengguna memilih lagu
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
    } catch (e) {
      console.warn("Audio stream fallback:", e);
    }
  }

  // Pilih format MP4 jika didukung browser, atau WebM sebagai cadangan
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
      select.innerHTML = '<option value="">-- Muat Formasi --</option>';
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
