// ==========================================
// KONFIGURASI API GOOGLE APPS SCRIPT
// ==========================================
const APPS_SCRIPT_URL = "TEMPEL_URL_WEB_APP_APPS_SCRIPT_ANDA_DI_SINI";

// Ukuran Lapangan (Skala responsif untuk layar HP/PC)
const FIELD_WIDTH = Math.min(window.innerWidth - 30, 600);
const FIELD_HEIGHT = Math.min(window.innerHeight - 240, 420);

// State Aplikasi
let scenes = [];          // Menyimpan seluruh hitungan/keyframe
let currentSceneIdx = 0;  // Hitungan yang sedang aktif diedit
let memberNodes = {};     // Menyimpan objek lingkaran Konva per ID anggota
let savedFormations = []; // Cache data dari Google Sheets

// Inisialisasi Konva Stage & Layer
const stage = new Konva.Stage({
  container: 'canvas-container',
  width: FIELD_WIDTH,
  height: FIELD_HEIGHT
});

const gridLayer = new Konva.Layer();
const troopLayer = new Konva.Layer();
stage.add(gridLayer);
stage.add(troopLayer);

// ==========================================
// 1. MENGGAMBAR GARIS LAPANGAN (GRID)
// ==========================================
function drawFieldGrid() {
  const step = 30; // Jarak antar garis grid (pixel)
  
  // Garis Vertikal & Horizontal
  for (let x = 0; x <= FIELD_WIDTH; x += step) {
    gridLayer.add(new Konva.Line({
      points: [x, 0, x, FIELD_HEIGHT],
      stroke: 'rgba(255, 255, 255, 0.15)',
      strokeWidth: 1
    }));
  }
  for (let y = 0; y <= FIELD_HEIGHT; y += step) {
    gridLayer.add(new Konva.Line({
      points: [0, y, FIELD_WIDTH, y],
      stroke: 'rgba(255, 255, 255, 0.15)',
      strokeWidth: 1
    }));
  }

  // Titik Tengah Lapangan (Pusat Variasi)
  gridLayer.add(new Konva.Circle({
    x: FIELD_WIDTH / 2,
    y: FIELD_HEIGHT / 2,
    radius: 4,
    fill: '#facc15'
  }));

  gridLayer.draw();
}

// ==========================================
// 2. INISIALISASI PASUKAN (3 BAN x 5 SAF + DANTON)
// ==========================================
function createDefaultFormation() {
  const members = [];
  const startX = FIELD_WIDTH / 2 - 40;
  const startY = FIELD_HEIGHT / 2 - 60;
  const gap = 38;

  // Danton (Nomor D)
  members.push({
    id: 'D',
    label: 'D',
    color: '#ef4444', // Merah
    x: startX - 50,
    y: startY + (2 * gap)
  });

  // 15 Pasukan (3 Ban x 5 Saf)
  let num = 1;
  for (let saf = 0; saf < 5; saf++) {
    for (let ban = 0; ban < 3; ban++) {
      members.push({
        id: 'P' + num,
        label: String(num),
        color: '#2563eb', // Biru
        x: startX + (ban * gap),
        y: startY + (saf * gap)
      });
      num++;
    }
  }
  return members;
}

// Render Pasukan ke Kanvas berdasarkan Scene aktif
function renderScene(sceneIndex) {
  currentSceneIdx = sceneIndex;
  const sceneData = scenes[sceneIndex];

  sceneData.members.forEach(m => {
    if (!memberNodes[m.id]) {
      // Buat grup lingkaran + angka jika belum ada
      const group = new Konva.Group({
        x: m.x,
        y: m.y,
        draggable: true
      });

      const circle = new Konva.Circle({
        radius: 14,
        fill: m.color,
        stroke: '#ffffff',
        strokeWidth: 2,
        shadowColor: 'black',
        shadowBlur: 4,
        shadowOpacity: 0.4
      });

      const text = new Konva.Text({
        text: m.label,
        fontSize: 12,
        fontStyle: 'bold',
        fill: '#ffffff',
        width: 28,
        align: 'center',
        offsetX: 14,
        offsetY: 6
      });

      group.add(circle);
      group.add(text);

      // Simpan koordinat baru setiap kali pasukan selesai digeser (dragend)
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
      // Pindahkan posisi jika objek sudah ada
      memberNodes[m.id].to({
        x: m.x,
        y: m.y,
        duration: 0.25
      });
    }
  });

  renderTimelineUI();
}

// ==========================================
// 3. SISTEM TIMELINE & ANIMASI (PLAY)
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

// Tambah Hitungan Baru (Menggandakan posisi dari hitungan terakhir)
document.getElementById('btnAddScene').addEventListener('click', () => {
  const lastScene = scenes[scenes.length - 1];
  const clonedMembers = JSON.parse(JSON.stringify(lastScene.members));
  
  scenes.push({
    name: `Hitungan ${scenes.length + 1}`,
    members: clonedMembers
  });
  
  renderScene(scenes.length - 1);
  setStatus(`Hitungan ${scenes.length} ditambahkan`);
});

// Putar Animasi Berurutan dari Hitungan 1 sampai Akhir
document.getElementById('btnPlay').addEventListener('click', async () => {
  if (scenes.length < 2) {
    alert("Tambahkan minimal 2 Hitungan untuk memutar animasi gerakan.");
    return;
  }

  setStatus("Memutar animasi...");
  for (let i = 0; i < scenes.length; i++) {
    currentSceneIdx = i;
    renderTimelineUI();

    const sceneData = scenes[i];
    sceneData.members.forEach(m => {
      if (memberNodes[m.id]) {
        memberNodes[m.id].to({
          x: m.x,
          y: m.y,
          duration: 1.0, // Durasi transisi 1 detik antar hitungan
          easing: Konva.Easings.EaseInOut
        });
      }
    });

    // Tunggu 1.2 detik sebelum lanjut ke hitungan berikutnya
    await new Promise(resolve => setTimeout(resolve, 1200));
  }
  setStatus("Animasi selesai");
});

// ==========================================
// 4. KONEKSI DATABASE GOOGLE APPS SCRIPT
// ==========================================
function setStatus(msg) {
  document.getElementById('statusText').innerText = msg;
}

// Simpan Formasi ke Google Sheets
document.getElementById('btnSave').addEventListener('click', async () => {
  const nama = document.getElementById('formationName').value.trim();
  if (!nama) {
    alert("Masukkan nama formasi terlebih dahulu!");
    return;
  }

  setStatus("Menyimpan ke Google Sheets...");
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
      setStatus("Tersimpan!");
      alert(result.message);
      loadSavedFormations(); // Refresh dropdown
    } else {
      alert("Gagal: " + result.message);
    }
  } catch (err) {
    setStatus("Gagal terhubung");
    alert("Error koneksi ke Apps Script: " + err);
  }
});

// Ambil Daftar Formasi dari Google Sheets saat web dibuka
async function loadSavedFormations() {
  if (APPS_SCRIPT_URL.includes("TEMPEL_URL")) return;
  
  setStatus("Memuat data cloud...");
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
    setStatus("Mode Offline");
  }
}

// Pilih & Muat Formasi dari Dropdown
document.getElementById('savedList').addEventListener('change', (e) => {
  const idx = e.target.value;
  if (idx === "") return;

  const selected = savedFormations[idx];
  document.getElementById('formationName').value = selected.nama;
  scenes = selected.dataJson;
  
  // Reset node kanvas dan render ulang
  troopLayer.destroyChildren();
  memberNodes = {};
  renderScene(0);
  setStatus(`Memuat: ${selected.nama}`);
});

// Tambah Anggota Pasukan Baru secara manual
document.getElementById('btnAddMember').addEventListener('click', () => {
  const nextNum = scenes[0].members.length;
  const newMember = {
    id: 'P' + Date.now(),
    label: String(nextNum),
    color: '#0284c7',
    x: FIELD_WIDTH / 2,
    y: FIELD_HEIGHT / 2
  };
  scenes.forEach(sc => sc.members.push({ ...newMember }));
  renderScene(currentSceneIdx);
});

// Reset ke formasi dasar
document.getElementById('btnResetPos').addEventListener('click', () => {
  if (!confirm("Reset semua hitungan ke formasi awal?")) return;
  scenes = [{ name: "Hitungan 1", members: createDefaultFormation() }];
  troopLayer.destroyChildren();
  memberNodes = {};
  renderScene(0);
});

// Jalankan Aplikasi Pertama Kali
drawFieldGrid();
scenes.push({
  name: "Hitungan 1",
  members: createDefaultFormation()
});
renderScene(0);
loadSavedFormations();