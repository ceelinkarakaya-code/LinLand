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
  canvas: document.getElementById("waveform"),
};

let currentFile = null;
let synth, padSynth, filter, sequence, chordPart, analyser;

function midiToNoteName(midi) {
  const name = NOTE_NAMES[midi % 12];
  const octave = Math.floor(midi / 12) - 1;
  return `${name}${octave}`;
}

// ---------- dosya seçimi / sürükle-bırak ----------

el.dropzone.addEventListener("click", () => el.fileInput.click());
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

  analyzeAndLoad(true);
}

// ---------- backend isteği ----------

async function analyzeAndLoad(regenerate) {
  if (!currentFile) return;
  setStatus("Melodiniz oluşturuluyor…");
  disableControls();

  const form = new FormData();
  form.append("file", currentFile);

  try {
    const res = await fetch(`${API_URL}/analyze?regenerate=${regenerate}`, {
      method: "POST",
      body: form,
    });
    if (!res.ok) throw new Error(`Sunucu hatası: ${res.status}`);
    const params = await res.json();
    updateMeters(params);
    await buildPlayback(params);
    setStatus("hazır");
    el.btnPlay.disabled = false;
    el.btnRemix.disabled = false;
  } catch (err) {
    console.error(err);
    setStatus(`hata: ${err.message}`);
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

  el.swatches.innerHTML = "";
  (params.dominantColors || []).forEach(([r, g, b]) => {
    const dot = document.createElement("span");
    dot.className = "swatch";
    dot.style.background = `rgb(${r},${g},${b})`;
    el.swatches.appendChild(dot);
  });
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

  Tone.Transport.bpm.value = params.tempo;

  filter = new Tone.Filter(params.filterCutoff, "lowpass").toDestination();
  synth = new Tone.PolySynth(Tone.Synth, {
    envelope: { attack: 0.02, decay: 0.2, sustain: 0.25, release: 0.8 },
  }).connect(filter);

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
