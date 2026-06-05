const surveyCode = document.getElementById("surveyCode");
const digitCount = document.getElementById("digitCount");
const runBtn = document.getElementById("runBtn");
const btnLabel = runBtn.querySelector(".btn-label");
const btnSpinner = runBtn.querySelector(".btn-spinner");
const progressCard = document.getElementById("progressCard");
const progressFill = document.getElementById("progressFill");
const progressPct = document.getElementById("progressPct");
const currentStep = document.getElementById("currentStep");
const logFeed = document.getElementById("logFeed");
const clearLog = document.getElementById("clearLog");
const resultBanner = document.getElementById("resultBanner");
const screenshotWrap = document.getElementById("screenshotWrap");
const screenshotImg = document.getElementById("screenshotImg");

const openCameraBtn = document.getElementById("openCameraBtn");
const photoInput = document.getElementById("photoInput");
const cameraFileInput = document.getElementById("cameraFileInput");
const scanPreview = document.getElementById("scanPreview");
const scanPreviewImg = document.getElementById("scanPreviewImg");
const scanStatus = document.getElementById("scanStatus");
const cameraModal = document.getElementById("cameraModal");
const cameraBackdrop = document.getElementById("cameraBackdrop");
const cameraVideo = document.getElementById("cameraVideo");
const captureCanvas = document.getElementById("captureCanvas");
const captureBtn = document.getElementById("captureBtn");
const closeCameraBtn = document.getElementById("closeCameraBtn");
const cameraStatus = document.getElementById("cameraStatus");
const cameraError = document.getElementById("cameraError");
const nativeCameraBtn = document.getElementById("nativeCameraBtn");
const statusPill = document.getElementById("statusPill");
const digitBarFill = document.getElementById("digitBarFill");
const photoLabel = document.querySelector('label[for="photoInput"]');
const btnArrow = runBtn.querySelector(".btn-arrow");

let running = false;
let scanning = false;
let cameraStream = null;
let ocrWorker = null;
let deployMode = "local";
let apiBase = "";

function digitsOnly(value) {
  return value.replace(/\D/g, "");
}

function setStatusPill(text, state) {
  if (!statusPill) return;
  statusPill.textContent = text;
  statusPill.className = "status-pill" + (state ? ` ${state}` : "");
}

function updateDigitCount() {
  const n = digitsOnly(surveyCode.value).length;
  const pct = Math.min(100, Math.round((n / 21) * 100));
  digitCount.textContent = `${n} / 21`;
  digitCount.classList.toggle("ready", n === 21);
  if (digitBarFill) digitBarFill.style.width = `${pct}%`;
  const locked = running || scanning;
  runBtn.disabled = locked || n !== 21;
  openCameraBtn.disabled = locked;
  photoInput.disabled = locked;
  if (cameraFileInput) cameraFileInput.disabled = locked;
  openCameraBtn.classList.toggle("disabled", locked);
  if (photoLabel) photoLabel.classList.toggle("disabled", locked);
  if (!running && !scanning && n === 21) setStatusPill("Ready", "");
}

surveyCode.addEventListener("input", () => {
  const raw = surveyCode.value;
  const cleaned = digitsOnly(raw);
  if (raw !== cleaned) surveyCode.value = cleaned;
  updateDigitCount();
});

function setRunning(on) {
  running = on;
  surveyCode.disabled = on;
  btnLabel.textContent = on ? "Running…" : "Start survey";
  btnSpinner.hidden = !on;
  if (btnArrow) btnArrow.hidden = on;
  setStatusPill(on ? "Running" : "Ready", on ? "running" : "");
  updateDigitCount();
}

function clearLogFeed() {
  logFeed.innerHTML = `
    <div class="log-empty">
      <span class="log-empty-icon">◇</span>
      <p>Log cleared.</p>
    </div>`;
}

function appendLog(message, level = "info") {
  const empty = logFeed.querySelector(".log-empty");
  if (empty) empty.remove();

  const line = document.createElement("p");
  line.className = `log-line ${level}`;
  const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  line.innerHTML = `<time>${time}</time>${escapeHtml(message)}`;
  logFeed.appendChild(line);
  logFeed.scrollTop = logFeed.scrollHeight;
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function parseProgress(message) {
  const m = message.match(/(\d+)%/);
  return m ? parseInt(m[1], 10) : null;
}

function showProgress(pct, stepText) {
  progressCard.hidden = false;
  progressFill.style.width = `${pct}%`;
  progressPct.textContent = `${pct}%`;
  if (stepText) currentStep.textContent = stepText;
}

function showResult(status, message, screenshot, screenshotB64) {
  resultBanner.hidden = false;
  resultBanner.className = `result-banner ${status === "success" ? "success" : status === "used" || status === "stuck" ? "warn" : "error"}`;
  resultBanner.textContent = message;
  if (status === "success") setStatusPill("Done", "success");
  else if (status === "used" || status === "stuck") setStatusPill("Warning", "error");
  else if (status === "error") setStatusPill("Error", "error");

  screenshotWrap.hidden = true;
  if (screenshotB64) {
    screenshotWrap.hidden = false;
    screenshotImg.src = `data:image/png;base64,${screenshotB64}`;
  } else if (screenshot) {
    screenshotWrap.hidden = false;
    screenshotImg.src = `/screenshots/${encodeURIComponent(screenshot)}?t=${Date.now()}`;
  }
}

function processLogEntry(data) {
  if (data.type === "log" || data.message) {
    appendLog(data.message, data.level || "info");
    const pct = parseProgress(data.message);
    if (pct !== null) {
      const stepPart = data.message.split("·").slice(2).join("·").trim();
      showProgress(pct, stepPart || data.message);
    }
  }
}

function processDone(data) {
  const pct = data.status === "success" ? 100 : parseProgress(data.message) ?? 0;
  showProgress(pct, data.message);
  let msg = data.message;
  if (data.reward_code) {
    msg = `Reward code: ${data.reward_code}` + (data.saved?.saved ? " · Saved with your IP & time." : "");
  } else if (data.saved?.saved) {
    msg += " · Run saved (time & IP recorded).";
  }
  showResult(data.status, msg, data.screenshot, data.screenshot_b64);
  if (data.reward_code) {
    appendLog(`Reward code: ${data.reward_code}`, "success");
  }
}

async function loadDeployConfig() {
  try {
    const res = await fetch("/deploy.json");
    if (res.ok) {
      const cfg = await res.json();
      apiBase = (cfg.apiBase || "").replace(/\/$/, "");
      deployMode = cfg.mode || (apiBase ? "remote" : "unconfigured");
      if (deployMode === "unconfigured") {
        appendLog(
          "Set BOT_API_URL on Vercel to https://ap-survey-bot.onrender.com (or use Render URL only).",
          "warn"
        );
      }
      return;
    }
  } catch {
    /* deploy.json only exists after Vercel build */
  }

  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const cfg = await res.json();
    deployMode = cfg.mode || "local";
    apiBase = (cfg.apiBase || "").replace(/\/$/, "");
  } catch {
    deployMode = "local";
  }
}

function surveyRunUrl() {
  if (apiBase) return `${apiBase}/api/run-sync`;
  return "/api/run";
}

function parseApiError(err) {
  if (err.message) return err.message;
  if (err.detail) {
    return Array.isArray(err.detail) ? err.detail[0]?.msg : err.detail;
  }
  return "Request failed";
}

async function runSurveyStream(res) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";

    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      const data = JSON.parse(line.slice(6));

      if (data.type === "log") {
        processLogEntry(data);
      } else if (data.type === "done") {
        processDone(data);
      }
    }
  }
}

async function runSurveyJson(data) {
  for (const entry of data.logs || []) {
    processLogEntry(entry);
  }
  processDone(data);
}

/** Find a 21-digit survey code from OCR text. */
function extractSurveyCode(text) {
  const candidates = [];

  const spaced = text.match(/\d[\d\s\-]{19,40}\d/g) || [];
  for (const chunk of spaced) {
    const d = digitsOnly(chunk);
    if (d.length === 21) candidates.push(d);
    if (d.length > 21) {
      for (let i = 0; i <= d.length - 21; i++) {
        candidates.push(d.slice(i, i + 21));
      }
    }
  }

  const all = digitsOnly(text);
  if (all.length === 21) candidates.push(all);
  if (all.length > 21) {
    for (let i = 0; i <= all.length - 21; i++) {
      candidates.push(all.slice(i, i + 21));
    }
  }

  const unique = [...new Set(candidates.filter((c) => c.length === 21 && /^\d{21}$/.test(c))];
  if (unique.length === 1) return unique[0];
  if (unique.length > 1) {
    return unique.find((c) => !c.startsWith("000")) || unique[0];
  }
  return null;
}

function preprocessForOcr(source) {
  const maxW = 1400;
  const scale = source.width > maxW ? maxW / source.width : 1;
  const w = Math.round(source.width * scale);
  const h = Math.round(source.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(source, 0, 0, w, h);

  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    const boosted = gray < 128 ? Math.max(0, gray - 30) : Math.min(255, gray + 40);
    const v = boosted > 140 ? 255 : boosted < 90 ? 0 : boosted;
    d[i] = d[i + 1] = d[i + 2] = v;
  }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

async function getOcrWorker() {
  if (!ocrWorker) {
    ocrWorker = await Tesseract.createWorker("eng", 1, {
      logger: (m) => {
        if (m.status === "recognizing text" && m.progress) {
          const pct = Math.round(m.progress * 100);
          scanStatus.textContent = `Reading text… ${pct}%`;
        }
      },
    });
    await ocrWorker.setParameters({
      tessedit_char_whitelist: "0123456789 -",
    });
  }
  return ocrWorker;
}

function setScanUi(state, message) {
  scanStatus.textContent = message;
  scanStatus.className = `scan-status ${state}`;
  scanning = state === "scanning";
  if (state === "scanning") setStatusPill("Scanning", "running");
  updateDigitCount();
}

async function recognizeCode(canvas) {
  const worker = await getOcrWorker();
  let { data } = await worker.recognize(canvas);
  let code = extractSurveyCode(data.text);
  if (code) return code;

  await worker.setParameters({ tessedit_char_whitelist: "" });
  ({ data } = await worker.recognize(canvas));
  await worker.setParameters({ tessedit_char_whitelist: "0123456789 -" });
  return extractSurveyCode(data.text);
}

async function scanImage(source, previewUrl) {
  scanPreview.hidden = false;
  if (previewUrl) scanPreviewImg.src = previewUrl;
  setScanUi("scanning", "Scanning receipt for 21-digit code…");
  appendLog("Scanning receipt image…", "info");

  try {
    const canvas = preprocessForOcr(source);
    const code = await recognizeCode(canvas);

    if (code) {
      surveyCode.value = code;
      updateDigitCount();
      setScanUi("success", `Code detected: ${code}`);
      appendLog(`Detected code: …${code.slice(-6)}`, "success");
      surveyCode.focus();
    } else {
      setScanUi("error", "Could not find a 21-digit code. Try a clearer photo or type it manually.");
      appendLog("No 21-digit code found in image.", "warn");
    }
  } catch (e) {
    setScanUi("error", e.message || "Scan failed.");
    appendLog(`Scan error: ${e.message}`, "error");
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, url });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Could not load image."));
    };
    img.src = url;
  });
}

async function handlePhotoFile(file) {
  if (!file || running) return;
  try {
    const { img, url } = await loadImageFromFile(file);
    await scanImage(img, url);
  } catch (e) {
    setScanUi("error", e.message);
    appendLog(e.message, "error");
  }
}

photoInput.addEventListener("change", async () => {
  const file = photoInput.files?.[0];
  photoInput.value = "";
  await handlePhotoFile(file);
});

if (cameraFileInput) {
  cameraFileInput.addEventListener("change", async () => {
    const file = cameraFileInput.files?.[0];
    cameraFileInput.value = "";
    closeCameraModal();
    await handlePhotoFile(file);
  });
}

function setCameraStatus(text) {
  if (cameraStatus) cameraStatus.textContent = text;
}

function showCameraError(text) {
  if (!cameraError) return;
  cameraError.textContent = text;
  cameraError.hidden = !text;
}

function canUseLiveCamera() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

async function startCamera() {
  const attempts = [
    { video: { facingMode: { exact: "environment" } }, audio: false },
    { video: { facingMode: "environment" }, audio: false },
    { video: { facingMode: "user" }, audio: false },
    { video: true, audio: false },
  ];

  let lastError = null;
  for (const constraints of attempts) {
    try {
      cameraStream = await navigator.mediaDevices.getUserMedia(constraints);
      cameraVideo.srcObject = cameraStream;
      await cameraVideo.play();
      setCameraStatus("Point at the receipt code, then tap Capture.");
      showCameraError("");
      if (nativeCameraBtn) nativeCameraBtn.hidden = true;
      return;
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError || new Error("Camera not available");
}

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  cameraVideo.srcObject = null;
}

function openCameraModal() {
  cameraModal.hidden = false;
  document.body.style.overflow = "hidden";
}

function closeCameraModal() {
  cameraModal.hidden = true;
  document.body.style.overflow = "";
  stopCamera();
  showCameraError("");
  if (nativeCameraBtn) nativeCameraBtn.hidden = true;
}

function openNativeCamera() {
  if (cameraFileInput) cameraFileInput.click();
}

openCameraBtn.addEventListener("click", async () => {
  if (running || scanning) return;

  if (!canUseLiveCamera()) {
    openNativeCamera();
    return;
  }

  openCameraModal();
  setCameraStatus("Starting camera…");
  showCameraError("");
  if (captureBtn) captureBtn.disabled = false;

  try {
    await startCamera();
  } catch (e) {
    setCameraStatus("Live camera unavailable");
    showCameraError("Allow camera access in your browser, or use the button below.");
    if (nativeCameraBtn) nativeCameraBtn.hidden = false;
    if (captureBtn) captureBtn.disabled = true;
    appendLog("Live camera unavailable — use native camera or upload from gallery.", "warn");
    scanPreview.hidden = false;
    setScanUi("error", "Live camera blocked. Tap “Use phone camera instead” or upload from gallery.");
  }
});

closeCameraBtn.addEventListener("click", closeCameraModal);
cameraBackdrop.addEventListener("click", closeCameraModal);
if (nativeCameraBtn) nativeCameraBtn.addEventListener("click", openNativeCamera);

captureBtn.addEventListener("click", async () => {
  if (!cameraStream) return;

  const w = cameraVideo.videoWidth;
  const h = cameraVideo.videoHeight;
  captureCanvas.width = w;
  captureCanvas.height = h;
  captureCanvas.getContext("2d").drawImage(cameraVideo, 0, 0, w, h);

  const previewUrl = captureCanvas.toDataURL("image/jpeg", 0.92);
  closeCameraModal();

  const img = new Image();
  img.onload = () => scanImage(img, previewUrl);
  img.src = previewUrl;
});

clearLog.addEventListener("click", clearLogFeed);

runBtn.addEventListener("click", async () => {
  const code = digitsOnly(surveyCode.value);
  if (code.length !== 21 || running) return;

  setRunning(true);
  resultBanner.hidden = true;
  screenshotWrap.hidden = true;
  progressCard.hidden = false;
  showProgress(0, "Connecting to survey…");
  appendLog("Starting bot…", "info");

  try {
    const res = await fetch(surveyRunUrl(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ survey_code: code }),
    });

    const contentType = res.headers.get("content-type") || "";
    const isJson = contentType.includes("application/json");

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(parseApiError(err));
    }

    if (isJson) {
      const data = await res.json();
      await runSurveyJson(data);
    } else {
      await runSurveyStream(res);
    }
  } catch (e) {
    appendLog(String(e.message || e), "error");
    showResult("error", e.message || "Something went wrong.", null, null);
  } finally {
    setRunning(false);
  }
});

loadDeployConfig().then(updateDigitCount);
updateDigitCount();
