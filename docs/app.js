// Backend'inizi deploy ettikten sonra bu adresi güncelleyin.
   const API_URL = window.API_URL || "https://linland.onrender.com";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const el = {
  dropzone: document.getElementById("dropzone"),
  fileInput: document.getElementById("file-input"),
  preview: document.getElementById("preview"),
  trayHint: document.getElementById("tray-hint"),
  status: document.getElementById("status-text"),
  btnPlay: document.getElementById("btn-play"),
  btnStop: document.getElementById("btn-stop"),
  btnRemix: document.getElementById("btn-remix"),
  swatches: document.getElementById("swatches"),
  valTempo: document.getElementById("val-tempo"),
  valScale: document.getElementById("val-scale"),
  valFilter: document.getElementById("val-filter"),
  valRoot: document.getElementById("val-root"),
  valRhythmStyle: document.getElementById("val-rhythm-style"),
  canvas: document.getElementById("waveform"),
  genreSelect: document.getElementById("genre-select"),
};

let currentFile = null;
let uploadBlob = null; // tarayıcıda küçültülmüş, yüklenecek asıl dosya
let synth, padSynth, filter, distortion, sequence, chordPart, analyser;
let kickSynth, snareSynth, hihatSynth, kickSeq, snareSeq, hihatSeq;

// Render'ın ücretsiz sunucusu 15 dk kullanılmayınca uykuya geçiyor ve
// ilk isteği yanıtlaması 50+ saniye sürebiliyor. Sayfa açılır açılmaz
// arka planda bir "uyandırma" isteği atarak kullanıcı fotoğraf seçene
// kadar sunucunun hazır olma ihtimalini artırıyoruz.
fetch(`${API_URL}/health`).catch(() => {});

function midiToNoteName(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// ---------- dosya seçimi / sürükle-bırak ----------

// iOS Safari'de dosya seçimini JavaScript üzerinden (input.click()) tetiklemek
// bazen "hiçbir tepki yok" hissi veren tuhaf davranışlara yol açabiliyor,
// özellikle birden fazla tetikleyici varsa (buton + tüm alan). Bunun yerine
// dosya seçimini tamamen tarayıcının kendi native <label> mekanizmasına
// bırakıyoruz: aşağıdaki label, CSS ile tüm tepsiyi kaplıyor (style.css'e
// bakın), böylece tepsinin herhangi bir yerine dokunmak dosya seçiciyi
// güvenilir şekilde açıyor. Ayrıca JS tarafında ekstra bir click tetikleyici
// YOK — sadece sürükle-bırak ayrı ele alınıyor.

el.fileInput.addEventListener("change", (e) => {
  if (e.target.files[0]) handleFile(e.target.files[0]);
});

["dragover", "dragleave", "drop"].forEach((evt) => {
  el.dropzone.addEventListener(evt, (e) => e.preventDefault());
});
el.dropzone.addEventListener("dragover", () => el.dropzone.classList.add("dragover"));
el.dropzone.addEventListener("dragleave", () => el.dropzone.classList.remove("dragover"));
el.dropzone.addEventListener("drop", (e) => {
  el.dropzone.classList.remove("dragover");
  if (e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
});

function handleFile(file) {
  currentFile = file;
  el.preview.src = URL.createObjectURL(file);
  el.preview.hidden = false;
  el.preview.style.animation = "none";
  void el.preview.offsetWidth; // reflow -> animasyonu yeniden tetikle
  el.preview.style.animation = "";
  el.trayHint.hidden = true;

  setStatus("fotoğraf hazırlanıyor…");
  resizeImage(file, 1024)
    .then((blob) => {
      uploadBlob = blob;
      analyzeAndLoad(true);
    })
    .catch((err) => {
      console.error(err);
      // küçültme başarısız olursa orijinal dosyayla devam et
      uploadBlob = file;
      analyzeAndLoad(true);
    });
}

// Telefon kameralarından gelen büyük fotoğrafları (birkaç MB) yüklemeden
// önce tarayıcıda küçültür. Analiz zaten görüntüyü 256x256'ya indirdiği
// için kalite kaybı analiz sonucunu etkilemez, ama yükleme süresini
// (özellikle mobil veri üzerinde) ciddi şekilde kısaltır.
function resizeImage(file, maxDimension) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      let { width, height } = img;
      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("toBlob başarısız"))),
        "image/jpeg",
        0.85
      );
    };
    img.onerror = () => reject(new Error("Görüntü okunamadı"));
    img.src = URL.createObjectURL(file);
  });
}

// ---------- backend isteği ----------

async function analyzeAndLoad(regenerate, attempt = 1) {
  if (!currentFile) return;
  setStatus(
    attempt === 1
      ? "sunucuya bağlanılıyor… (ilk istekte 30-60 sn sürebilir)"
      : `yeniden deneniyor… (${attempt}. deneme)`
  );
  disableControls();

  const form = new FormData();
  form.append("file", uploadBlob || currentFile, "photo.jpg");
  const genre = el.genreSelect.value;

  // Render'ın uyanması uzun sürerse kullanıcıya sonsuza dek "bekleniyor"
  // yazısı göstermek yerine 100 saniye sonra net bir hata verelim.
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 100_000);

  try {
    const res = await fetch(`${API_URL}/analyze?regenerate=${regenerate}&genre=${genre}`, {
      method: "POST",
      body: form,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!res.ok) throw new Error(`Sunucu hatası: ${res.status}`);
    const params = await res.json();
    updateMeters(params);
    await buildPlayback(params);
    setStatus("hazır");
    el.btnPlay.disabled = false;
    el.btnRemix.disabled = false;
  } catch (err) {
    clearTimeout(timeoutId);
    console.error(err);

    // "Load failed" / genel ağ hataları genelde Render'ın uyanma anındaki
    // geçici bağlantı kopmalarından kaynaklanır. AbortError (bizim 100sn'lik
    // zaman aşımımız) hariç, ilk 2 denemede otomatik olarak tekrar deneriz.
    const isTransientNetworkError = err.name !== "AbortError";
    if (isTransientNetworkError && attempt < 3) {
      setTimeout(() => analyzeAndLoad(regenerate, attempt + 1), 3000);
      return;
    }

    if (err.name === "AbortError") {
      setStatus("sunucu yanıt vermedi — 'yeniden karıştır'a basıp tekrar deneyin");
    } else {
      setStatus(`bağlantı sorunu (${err.message}) — 'yeniden karıştır'a basıp tekrar deneyin`);
    }
    // hata sonrası kullanıcının elle tekrar deneyebilmesi için buton açık kalsın
    el.btnRemix.disabled = false;
  }
}

function setStatus(text) {
  el.status.textContent = text;
}

function disableControls() {
  el.btnPlay.disabled = true;
  el.btnStop.disabled = true;
  el.btnRemix.disabled = true;
}

function updateMeters(params) {
  el.valTempo.textContent = params.tempo;
  el.valScale.textContent = params.scale.replace("_", " ");
  el.valFilter.textContent = params.filterCutoff;
  el.valRoot.textContent = midiToNoteName(params.rootMidi);
  el.valRhythmStyle.textContent = params.rhythmStyle.replace("_", " ");

  el.swatches.innerHTML = "";
  (params.dominantColors || []).forEach(([r, g, b]) => {
    const dot = document.createElement("span");
    dot.className = "swatch";
    dot.style.background = `rgb(${r},${g},${b})`;
    el.swatches.appendChild(dot);
  });
}

// ---------- tarza göre synth seçimi ----------

function createMelodySynth(genre) {
  switch (genre) {
    case "rock":
    case "heavy_metal":
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 2,
        modulationIndex: 3,
        envelope: { attack: 0.005, decay: 0.15, sustain: 0.2, release: 0.4 },
      });
    case "jazz":
    case "blues":
      return new Tone.PolySynth(Tone.AMSynth, {
        envelope: { attack: 0.02, decay: 0.3, sustain: 0.4, release: 1.2 },
      });
    case "anadolu_rock":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "triangle" },
        envelope: { attack: 0.01, decay: 0.25, sustain: 0.15, release: 0.6 },
      });
    case "pop":
    case "dj":
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: "sawtooth" },
        envelope: { attack: 0.01, decay: 0.2, sustain: 0.3, release: 0.5 },
      });
    default: // soft
      return new Tone.PolySynth(Tone.Synth, {
        envelope: { attack: 0.02, decay: 0.2, sustain: 0.25, release: 0.8 },
      });
  }
}

// ---------- tarza göre davul kalıbı (16'lık adımlar) ----------

function buildDrumPattern(style, steps = 16) {
  const kick = new Array(steps).fill(0);
  const snare = new Array(steps).fill(0);
  const hihat = new Array(steps).fill(0);

  if (style === "four_on_floor") {
    for (let i = 0; i < steps; i += 4) kick[i] = 1;
    for (let i = 2; i < steps; i += 4) snare[i] = 1;
    for (let i = 0; i < steps; i += 2) hihat[i] = 1;
  } else if (style === "backbeat") {
    kick[0] = 1; kick[8] = 1;
    snare[4] = 1; snare[12] = 1;
    for (let i = 0; i < steps; i += 2) hihat[i] = 1;
  } else if (style === "double_kick") {
    for (let i = 0; i < steps; i += 2) kick[i] = 1;
    snare[4] = 1; snare[12] = 1;
    for (let i = 0; i < steps; i++) hihat[i] = 1;
  } else if (style === "shuffle" || style === "swing") {
    for (let i = 0; i < steps; i += 3) kick[i] = 1;
    snare[6] = 1; snare[14] = 1;
    for (let i = 0; i < steps; i += 3) hihat[i] = 1;
  } else if (style === "syncopated") {
    [0, 3, 6, 10, 13].forEach((i) => (kick[i] = 1));
    snare[8] = 1;
    for (let i = 1; i < steps; i += 2) hihat[i] = 1;
  }
  // "straight" (soft tarzı): davul katmanı yok, ambient kalır

  return { kick, snare, hihat };
}

function disposeDrums() {
  [kickSeq, snareSeq, hihatSeq, kickSynth, snareSynth, hihatSynth].forEach((node) => {
    if (node) node.dispose();
  });
  kickSeq = snareSeq = hihatSeq = kickSynth = snareSynth = hihatSynth = null;
}

// ---------- Tone.js oynatma ----------

async function buildPlayback(params) {
  await Tone.start();
  Tone.Transport.stop();
  Tone.Transport.cancel();
  if (sequence) sequence.dispose();
  if (chordPart) chordPart.dispose();
  if (synth) synth.dispose();
  if (padSynth) padSynth.dispose();
  if (filter) filter.dispose();
  if (distortion) distortion.dispose();
  disposeDrums();

  Tone.Transport.bpm.value = params.tempo;
  Tone.Transport.swing = params.swing || 0;
  Tone.Transport.swingSubdivision = "16n";

  filter = new Tone.Filter(params.filterCutoff, "lowpass").toDestination();

  const isDistorted = params.genre === "rock" || params.genre === "heavy_metal";
  if (isDistorted) {
    distortion = new Tone.Distortion(params.genre === "heavy_metal" ? 0.6 : 0.35).connect(filter);
    synth = createMelodySynth(params.genre).connect(distortion);
  } else {
    distortion = null;
    synth = createMelodySynth(params.genre).connect(filter);
  }

  padSynth = new Tone.PolySynth(Tone.AMSynth, { volume: -10 }).toDestination();

  if (!analyser) {
    analyser = new Tone.Analyser("waveform", 256);
    Tone.getDestination().connect(analyser);
    drawWaveform();
  }

  // melodi + ritim: rhythm maskesi hangi 16'lık adımda nota çalınacağını belirler
  const noteNames = params.melody.map((m) => midiToNoteName(m));
  let noteIndex = 0;
  sequence = new Tone.Sequence(
    (time, active) => {
      if (active) {
        const humanizedTime = time + (Math.random() * 0.02 - 0.01);
        const velocity = 0.7 + (Math.random() * 0.16 - 0.08);
        synth.triggerAttackRelease(noteNames[noteIndex % noteNames.length], "16n", humanizedTime, velocity);
        noteIndex++;
      }
    },
    params.rhythm,
    "16n"
  );

  // akor ilerlemesi: fon dokusu, her ölçüde bir akor
  const chordEvents = params.progression.map((chordMidis, i) => [
    `${i}m`,
    chordMidis.map(midiToNoteName),
  ]);
  chordPart = new Tone.Part((time, chord) => {
    padSynth.triggerAttackRelease(chord, "1m", time);
  }, chordEvents);
  chordPart.loop = true;
  chordPart.loopEnd = `${params.progression.length}m`;

  // davul katmanı: tarz "straight" değilse gerçek bir beat eklenir
  if (params.rhythmStyle && params.rhythmStyle !== "straight") {
    const { kick, snare, hihat } = buildDrumPattern(params.rhythmStyle);

    kickSynth = new Tone.MembraneSynth({ octaves: 4, pitchDecay: 0.05 }).toDestination();
    snareSynth = new Tone.NoiseSynth({
      noise: { type: "white" },
      envelope: { attack: 0.001, decay: 0.15, sustain: 0 },
    }).toDestination();
    hihatSynth = new Tone.MetalSynth({
      envelope: { attack: 0.001, decay: 0.06, release: 0.01 },
      harmonicity: 5.1,
      volume: -18,
    }).toDestination();

    kickSeq = new Tone.Sequence((time, active) => {
      if (active) kickSynth.triggerAttackRelease("C1", "8n", time);
    }, kick, "16n");

    snareSeq = new Tone.Sequence((time, active) => {
      if (active) snareSynth.triggerAttackRelease("16n", time);
    }, snare, "16n");

    hihatSeq = new Tone.Sequence((time, active) => {
      if (active) hihatSynth.triggerAttackRelease("32n", time);
    }, hihat, "16n");

    kickSeq.start(0);
    snareSeq.start(0);
    hihatSeq.start(0);
  }

  sequence.start(0);
  chordPart.start(0);
}

el.btnPlay.addEventListener("click", () => {
  Tone.Transport.start();
  el.btnStop.disabled = false;
});
el.btnStop.addEventListener("click", () => {
  Tone.Transport.stop();
  el.btnStop.disabled = true;
});
el.btnRemix.addEventListener("click", () => analyzeAndLoad(true));

// tarz değiştiğinde: aynı fotoğrafın "ruh hali" (mood_seed) korunur,
// sadece yeni tarzın tempo/gam/akor/ritim karakteri uygulanır (regenerate=false)
el.genreSelect.addEventListener("change", () => {
  if (currentFile) analyzeAndLoad(false);
});

// ---------- dalga formu görselleştirme ----------

function drawWaveform() {
  const ctx = el.canvas.getContext("2d");
  const width = el.canvas.width = el.canvas.clientWidth;
  const height = el.canvas.height;

  function render() {
    requestAnimationFrame(render);
    const values = analyser.getValue();

    ctx.clearRect(0, 0, width, height);
    ctx.beginPath();
    ctx.strokeStyle = "#4fa8a0";
    ctx.lineWidth = 1.5;

    for (let i = 0; i < values.length; i++) {
      const x = (i / values.length) * width;
      const y = (0.5 + values[i] / 2) * height;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  render();
}

window.addEventListener("resize", () => {
  if (el.canvas) el.canvas.width = el.canvas.clientWidth;
});
