/* ---------------- Authorized users (validated server-side too) ---------------- */
const AUTH_USERS = [
  { value: "ironman", initials: "IM", tag: "Owner" },
  { value: "Ajaya Purja", initials: "AP", tag: "Authorized" },
];
const TOKEN_KEY = "ptb_token";
const NAME_KEY = "ptb_user";

/* ---------------- Elements ---------------- */
const authScreen = document.getElementById("authScreen");
const authCard = document.getElementById("authCard");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const authSubmit = document.getElementById("authSubmit");
const passwordInput = document.getElementById("password");
const pwToggle = document.getElementById("pwToggle");
const pickerTrigger = document.getElementById("pickerTrigger");
const pickerMenu = document.getElementById("pickerMenu");
const pickerValue = document.getElementById("pickerValue");
const pickerAvatar = document.getElementById("pickerAvatar");

const appRoot = document.getElementById("appRoot");
const logoutBtn = document.getElementById("logoutBtn");
const userAvatar = document.getElementById("userAvatar");

const surveyCode = document.getElementById("surveyCode");
const digitCount = document.getElementById("digitCount");
const digitBarFill = document.getElementById("digitBarFill");
const runBtn = document.getElementById("runBtn");
const btnLabel = runBtn.querySelector(".btn-label");
const btnSpinner = runBtn.querySelector(".btn-spinner");
const btnArrow = runBtn.querySelector(".btn-arrow");
const progressCard = document.getElementById("progressCard");
const progressFill = document.getElementById("progressFill");
const progressPct = document.getElementById("progressPct");
const currentStep = document.getElementById("currentStep");
const logFeed = document.getElementById("logFeed");
const clearLog = document.getElementById("clearLog");
const resultBanner = document.getElementById("resultBanner");
const screenshotWrap = document.getElementById("screenshotWrap");
const screenshotImg = document.getElementById("screenshotImg");
const statusPill = document.getElementById("statusPill");

let running = false;
let apiBase = "";
let selectedUser = "";
let token = localStorage.getItem(TOKEN_KEY) || "";

/* ---------------- Helpers ---------------- */
function apiUrl(path) {
  return apiBase ? `${apiBase}${path}` : path;
}

function digitsOnly(value) {
  return value.replace(/\D/g, "");
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s;
  return d.innerHTML;
}

function initialsFor(name) {
  const found = AUTH_USERS.find((u) => u.value === name);
  if (found) return found.initials;
  return name.slice(0, 2).toUpperCase();
}

/* ---------------- Username picker ---------------- */
function buildPicker() {
  pickerMenu.innerHTML = AUTH_USERS.map(
    (u, i) => `
      <li class="picker-option" role="option" tabindex="-1"
          data-value="${escapeHtml(u.value)}" aria-selected="false"
          style="--i:${i}">
        <span class="option-avatar">${escapeHtml(u.initials)}</span>
        <span class="option-copy">
          <strong>${escapeHtml(u.value)}</strong>
          <small>${escapeHtml(u.tag)}</small>
        </span>
        <svg class="option-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true">
          <path d="M20 6L9 17l-5-5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </li>`
  ).join("");
}

function openPicker() {
  pickerMenu.hidden = false;
  // Next frame so the open animation runs from its start state.
  requestAnimationFrame(() => pickerMenu.classList.add("open"));
  pickerTrigger.setAttribute("aria-expanded", "true");
}

function closePicker() {
  pickerMenu.classList.remove("open");
  pickerTrigger.setAttribute("aria-expanded", "false");
  setTimeout(() => {
    if (!pickerMenu.classList.contains("open")) pickerMenu.hidden = true;
  }, 180);
}

function isPickerOpen() {
  return pickerTrigger.getAttribute("aria-expanded") === "true";
}

function selectUser(value) {
  selectedUser = value;
  pickerValue.textContent = value;
  pickerValue.classList.remove("placeholder");
  pickerAvatar.textContent = initialsFor(value);
  pickerAvatar.hidden = false;
  pickerTrigger.classList.add("filled");

  pickerMenu.querySelectorAll(".picker-option").forEach((el) => {
    const on = el.dataset.value === value;
    el.classList.toggle("selected", on);
    el.setAttribute("aria-selected", on ? "true" : "false");
  });

  hideAuthError();
  refreshAuthSubmit();
}

pickerTrigger.addEventListener("click", () => {
  isPickerOpen() ? closePicker() : openPicker();
});

pickerMenu.addEventListener("click", (e) => {
  const option = e.target.closest(".picker-option");
  if (!option) return;
  selectUser(option.dataset.value);
  closePicker();
  passwordInput.focus();
});

document.addEventListener("click", (e) => {
  if (!isPickerOpen()) return;
  if (!e.target.closest("#userPicker")) closePicker();
});

pickerTrigger.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (!isPickerOpen()) openPicker();
    pickerMenu.querySelector(".picker-option")?.focus();
  } else if (e.key === "Escape") {
    closePicker();
  }
});

pickerMenu.addEventListener("keydown", (e) => {
  const options = [...pickerMenu.querySelectorAll(".picker-option")];
  const idx = options.indexOf(document.activeElement);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    options[Math.min(idx + 1, options.length - 1)]?.focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (idx <= 0) pickerTrigger.focus();
    else options[idx - 1].focus();
  } else if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    if (idx >= 0) {
      selectUser(options[idx].dataset.value);
      closePicker();
      passwordInput.focus();
    }
  } else if (e.key === "Escape") {
    e.preventDefault();
    closePicker();
    pickerTrigger.focus();
  }
});

/* ---------------- Password field ---------------- */
pwToggle.addEventListener("click", () => {
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  pwToggle.classList.toggle("on", show);
  pwToggle.setAttribute("aria-label", show ? "Hide password" : "Show password");
  passwordInput.focus();
});

passwordInput.addEventListener("input", () => {
  hideAuthError();
  refreshAuthSubmit();
});

function refreshAuthSubmit() {
  authSubmit.disabled = !selectedUser || !passwordInput.value;
}

function showAuthError(message) {
  authError.textContent = message;
  authError.hidden = false;
  authCard.classList.remove("shake");
  void authCard.offsetWidth; // restart the shake animation
  authCard.classList.add("shake");
}

function hideAuthError() {
  authError.hidden = true;
  authCard.classList.remove("shake");
}

function setAuthLoading(on) {
  authSubmit.disabled = on || !selectedUser || !passwordInput.value;
  authSubmit.querySelector(".btn-label").textContent = on ? "Signing in…" : "Sign in";
  authSubmit.querySelector(".btn-spinner").hidden = !on;
  authSubmit.querySelector(".btn-arrow").hidden = on;
}

/* ---------------- Login / logout ---------------- */
authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!selectedUser || !passwordInput.value) return;

  setAuthLoading(true);
  try {
    const res = await fetch(apiUrl("/api/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: selectedUser, password: passwordInput.value }),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      showAuthError(data.detail || "Incorrect username or password.");
      passwordInput.select();
      return;
    }

    token = data.token;
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NAME_KEY, data.username);
    passwordInput.value = "";
    enterApp(data.username);
  } catch (err) {
    showAuthError("Cannot reach the server. Please try again.");
  } finally {
    setAuthLoading(false);
  }
});

function enterApp(username) {
  userAvatar.textContent = initialsFor(username);
  logoutBtn.title = `Signed in as ${username} — sign out`;

  authScreen.classList.add("leaving");
  setTimeout(() => {
    authScreen.hidden = true;
    authScreen.classList.remove("leaving");
    appRoot.hidden = false;
    surveyCode.focus();
  }, 380);
}

function logout(message) {
  token = "";
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);

  appRoot.hidden = true;
  authScreen.hidden = false;
  passwordInput.value = "";
  refreshAuthSubmit();
  if (message) showAuthError(message);
  else hideAuthError();
}

logoutBtn.addEventListener("click", () => logout());

/* ---------------- Survey code field ---------------- */
function setStatusPill(text, state) {
  statusPill.textContent = text;
  statusPill.className = "status-pill" + (state ? ` ${state}` : "");
}

function updateDigitCount() {
  const n = digitsOnly(surveyCode.value).length;
  digitCount.textContent = `${n} / 21`;
  digitCount.classList.toggle("ready", n === 21);
  digitBarFill.style.width = `${Math.min(100, Math.round((n / 21) * 100))}%`;
  runBtn.disabled = running || n !== 21;
  if (!running && n === 21) setStatusPill("Ready", "");
}

surveyCode.addEventListener("input", () => {
  const cleaned = digitsOnly(surveyCode.value);
  if (surveyCode.value !== cleaned) surveyCode.value = cleaned;
  updateDigitCount();
});

function setRunning(on) {
  running = on;
  surveyCode.disabled = on;
  btnLabel.textContent = on ? "Running…" : "Start survey";
  btnSpinner.hidden = !on;
  btnArrow.hidden = on;
  setStatusPill(on ? "Running" : "Ready", on ? "running" : "");
  updateDigitCount();
}

/* ---------------- Log + progress ---------------- */
function clearLogFeed() {
  logFeed.innerHTML = `
    <div class="log-empty">
      <span class="log-empty-icon">◇</span>
      <p>Log cleared.</p>
    </div>`;
}

function appendLog(message, level = "info") {
  logFeed.querySelector(".log-empty")?.remove();
  const line = document.createElement("p");
  line.className = `log-line ${level}`;
  const time = new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  line.innerHTML = `<time>${time}</time>${escapeHtml(message)}`;
  logFeed.appendChild(line);
  logFeed.scrollTop = logFeed.scrollHeight;
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
  resultBanner.className =
    "result-banner " +
    (status === "success" ? "success" : status === "used" || status === "stuck" ? "warn" : "error");
  resultBanner.textContent = message;

  if (status === "success") setStatusPill("Done", "success");
  else if (status === "used" || status === "stuck") setStatusPill("Warning", "error");
  else setStatusPill("Error", "error");

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
  if (data.reward_code) appendLog(`Reward code: ${data.reward_code}`, "success");
}

/* ---------------- Config + run ---------------- */
async function loadDeployConfig() {
  try {
    const res = await fetch("/deploy.json");
    if (res.ok) {
      const cfg = await res.json();
      apiBase = (cfg.apiBase || "").replace(/\/$/, "");
      return;
    }
  } catch {
    /* deploy.json only exists on the Vercel build */
  }
  try {
    const res = await fetch("/api/config");
    if (!res.ok) return;
    const cfg = await res.json();
    apiBase = (cfg.apiBase || "").replace(/\/$/, "");
  } catch {
    /* fall back to same-origin */
  }
}

function surveyRunUrl() {
  return apiBase ? `${apiBase}/api/run-sync` : "/api/run";
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
      if (data.type === "log") processLogEntry(data);
      else if (data.type === "done") processDone(data);
    }
  }
}

runBtn.addEventListener("click", async () => {
  const code = digitsOnly(surveyCode.value);
  if (code.length !== 21 || running) return;

  setRunning(true);
  resultBanner.hidden = true;
  screenshotWrap.hidden = true;
  showProgress(0, "Connecting to survey…");
  appendLog("Starting bot…", "info");

  try {
    const res = await fetch(surveyRunUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ survey_code: code }),
    });

    if (res.status === 401) {
      logout("Your session expired. Please sign in again.");
      return;
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || err.message || "Request failed");
    }

    if ((res.headers.get("content-type") || "").includes("application/json")) {
      const data = await res.json();
      (data.logs || []).forEach(processLogEntry);
      processDone(data);
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

clearLog.addEventListener("click", clearLogFeed);

/* ---------------- Boot ---------------- */
async function boot() {
  buildPicker();
  await loadDeployConfig();

  // Restore a previous session if the saved token is still valid.
  if (token) {
    try {
      const res = await fetch(apiUrl("/api/me"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const me = await res.json();
        authScreen.hidden = true;
        appRoot.hidden = false;
        userAvatar.textContent = initialsFor(me.username);
        logoutBtn.title = `Signed in as ${me.username} — sign out`;
      } else {
        localStorage.removeItem(TOKEN_KEY);
        token = "";
      }
    } catch {
      /* offline — stay on the login screen */
    }
  }

  const savedName = localStorage.getItem(NAME_KEY);
  if (savedName && AUTH_USERS.some((u) => u.value === savedName)) selectUser(savedName);

  updateDigitCount();
  refreshAuthSubmit();
}

boot();
