/* ---------------- Authorized users (validated server-side too) ---------------- */
const AUTH_USERS = [
  { value: "ironman", initials: "IM", tag: "Administrator" },
  { value: "Ajaya Purja", initials: "AP", tag: "Authorized" },
];
const TOKEN_KEY = "ptb_token";
const NAME_KEY = "ptb_user";
const BULK_SIZE = 5;
const CODE_LEN = 21;
const LOG_MAX = 250;

/* ---------------- Elements ---------------- */
const $ = (id) => document.getElementById(id);

const authScreen = $("authScreen");
const authCard = $("authCard");
const authForm = $("authForm");
const authError = $("authError");
const authSubmit = $("authSubmit");
const passwordInput = $("password");
const pwToggle = $("pwToggle");
const pickerTrigger = $("pickerTrigger");
const pickerMenu = $("pickerMenu");
const pickerValue = $("pickerValue");
const pickerAvatar = $("pickerAvatar");

const appRoot = $("appRoot");
const logoutBtn = $("logoutBtn");
const userAvatar = $("userAvatar");
const viewNav = $("viewNav");
const adminTab = $("adminTab");
const statusPill = $("statusPill");

const views = {
  single: $("viewSingle"),
  bulk: $("viewBulk"),
  admin: $("viewAdmin"),
};

const surveyCode = $("surveyCode");
const digitCount = $("digitCount");
const digitBarFill = $("digitBarFill");
const runBtn = $("runBtn");
const progressCard = $("progressCard");
const progressFill = $("progressFill");
const progressPct = $("progressPct");
const currentStep = $("currentStep");
const resultBanner = $("resultBanner");
const screenshotWrap = $("screenshotWrap");
const screenshotImg = $("screenshotImg");

const bulkRows = $("bulkRows");
const bulkRunBtn = $("bulkRunBtn");
const bulkClearBtn = $("bulkClearBtn");
const bulkSummary = $("bulkSummary");
const bulkProgressFill = $("bulkProgressFill");
const bulkDone = $("bulkDone");
const bulkSkipped = $("bulkSkipped");
const bulkFailed = $("bulkFailed");

const logPanel = $("logPanel");
const logFeed = $("logFeed");
const clearLog = $("clearLog");

const adminRows = $("adminRows");
const adminSearch = $("adminSearch");
const adminRefresh = $("adminRefresh");
const adminExport = $("adminExport");
const adminClear = $("adminClear");

/* ---------------- State ---------------- */
let apiBase = "";
let token = localStorage.getItem(TOKEN_KEY) || "";
let role = "user";
let selectedUser = "";
let running = false;
let activeView = "single";
let adminData = [];

/* ---------------- Small helpers ---------------- */
const apiUrl = (path) => (apiBase ? `${apiBase}${path}` : path);
const digitsOnly = (v) => v.replace(/\D/g, "");

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = String(s ?? "");
  return d.innerHTML;
}

function initialsFor(name) {
  return AUTH_USERS.find((u) => u.value === name)?.initials || name.slice(0, 2).toUpperCase();
}

function authHeaders(extra = {}) {
  return { Authorization: `Bearer ${token}`, ...extra };
}

function relativeTime(iso) {
  const then = new Date(iso);
  if (isNaN(then)) return iso || "—";
  const secs = Math.round((Date.now() - then.getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 604800) return `${Math.floor(secs / 86400)}d ago`;
  return then.toLocaleDateString();
}

/* ---------------- Username picker ---------------- */
function buildPicker() {
  pickerMenu.innerHTML = AUTH_USERS.map(
    (u, i) => `
      <li class="picker-option" role="option" tabindex="-1"
          data-value="${escapeHtml(u.value)}" aria-selected="false" style="--i:${i}">
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

const isPickerOpen = () => pickerTrigger.getAttribute("aria-expanded") === "true";

function openPicker() {
  pickerMenu.hidden = false;
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

function selectUser(value) {
  selectedUser = value;
  pickerValue.textContent = value;
  pickerValue.classList.remove("placeholder");
  pickerAvatar.textContent = initialsFor(value);
  pickerAvatar.hidden = false;
  pickerMenu.querySelectorAll(".picker-option").forEach((el) => {
    const on = el.dataset.value === value;
    el.classList.toggle("selected", on);
    el.setAttribute("aria-selected", on ? "true" : "false");
  });
  hideAuthError();
  refreshAuthSubmit();
}

pickerTrigger.addEventListener("click", () => (isPickerOpen() ? closePicker() : openPicker()));

pickerMenu.addEventListener("click", (e) => {
  const option = e.target.closest(".picker-option");
  if (!option) return;
  selectUser(option.dataset.value);
  closePicker();
  passwordInput.focus();
});

document.addEventListener("click", (e) => {
  if (isPickerOpen() && !e.target.closest("#userPicker")) closePicker();
});

pickerTrigger.addEventListener("keydown", (e) => {
  if (["ArrowDown", "Enter", " "].includes(e.key)) {
    e.preventDefault();
    if (!isPickerOpen()) openPicker();
    pickerMenu.querySelector(".picker-option")?.focus();
  } else if (e.key === "Escape") closePicker();
});

pickerMenu.addEventListener("keydown", (e) => {
  const options = [...pickerMenu.querySelectorAll(".picker-option")];
  const idx = options.indexOf(document.activeElement);
  if (e.key === "ArrowDown") {
    e.preventDefault();
    options[Math.min(idx + 1, options.length - 1)]?.focus();
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    idx <= 0 ? pickerTrigger.focus() : options[idx - 1].focus();
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

/* ---------------- Login ---------------- */
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
  void authCard.offsetWidth;
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
    role = data.role || "user";
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.setItem(NAME_KEY, data.username);
    passwordInput.value = "";

    applyIdentity(data.username, role);
    authScreen.classList.add("leaving");
    setTimeout(() => {
      authScreen.hidden = true;
      authScreen.classList.remove("leaving");
      appRoot.hidden = false;
      surveyCode.focus();
    }, 380);
  } catch {
    showAuthError("Cannot reach the server. Please try again.");
  } finally {
    setAuthLoading(false);
  }
});

function applyIdentity(username, userRole) {
  role = userRole || "user";
  userAvatar.textContent = initialsFor(username);
  logoutBtn.title = `Signed in as ${username} — sign out`;
  adminTab.hidden = role !== "admin";
  if (role !== "admin" && activeView === "admin") switchView("single");
}

function logout(message) {
  token = "";
  role = "user";
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(NAME_KEY);
  appRoot.hidden = true;
  authScreen.hidden = false;
  passwordInput.value = "";
  refreshAuthSubmit();
  message ? showAuthError(message) : hideAuthError();
}

logoutBtn.addEventListener("click", () => logout());

/* ---------------- View routing ---------------- */
function switchView(name) {
  if (!views[name] || (name === "admin" && role !== "admin")) return;
  activeView = name;
  Object.entries(views).forEach(([key, el]) => (el.hidden = key !== name));
  viewNav.querySelectorAll(".nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === name)
  );
  logPanel.hidden = name === "admin";
  if (name === "admin") loadAdmin();
}

viewNav.addEventListener("click", (e) => {
  const btn = e.target.closest(".nav-btn");
  if (btn) switchView(btn.dataset.view);
});

/* ---------------- Activity log (buffered so bulk runs stay smooth) --------- */
let logQueue = [];
let logScheduled = false;

function appendLog(message, level = "info") {
  logQueue.push({ message, level, at: new Date() });
  if (!logScheduled) {
    logScheduled = true;
    requestAnimationFrame(flushLog);
  }
}

function flushLog() {
  logScheduled = false;
  if (!logQueue.length) return;

  logFeed.querySelector(".log-empty")?.remove();
  const frag = document.createDocumentFragment();
  for (const item of logQueue) {
    const line = document.createElement("p");
    line.className = `log-line ${item.level}`;
    const stamp = item.at.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    line.innerHTML = `<time>${stamp}</time>${escapeHtml(item.message)}`;
    frag.appendChild(line);
  }
  logQueue = [];
  logFeed.appendChild(frag);

  // Cap the DOM so long bulk runs never bog the page down.
  while (logFeed.childElementCount > LOG_MAX) logFeed.removeChild(logFeed.firstElementChild);
  logFeed.scrollTop = logFeed.scrollHeight;
}

clearLog.addEventListener("click", () => {
  logQueue = [];
  logFeed.innerHTML = `
    <div class="log-empty">
      <span class="log-empty-icon">◇</span>
      <p>Log cleared.</p>
    </div>`;
});

function setStatusPill(text, state) {
  statusPill.textContent = text;
  statusPill.className = "status-pill" + (state ? ` ${state}` : "");
}

/* ---------------- Shared streaming reader ---------------- */
async function readEventStream(res, onEvent) {
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
      if (line) onEvent(JSON.parse(line.slice(6)));
    }
  }
}

function setGlobalRunning(on) {
  running = on;
  runBtn.disabled = on || digitsOnly(surveyCode.value).length !== CODE_LEN;
  surveyCode.disabled = on;
  runBtn.querySelector(".btn-label").textContent = on ? "Running…" : "Start survey";
  runBtn.querySelector(".btn-spinner").hidden = !on;
  runBtn.querySelector(".btn-arrow").hidden = on;
  setStatusPill(on ? "Running" : "Ready", on ? "running" : "");
  refreshBulkButton();
}

/* ---------------- Single run ---------------- */
function updateDigitCount() {
  const n = digitsOnly(surveyCode.value).length;
  digitCount.textContent = `${n} / ${CODE_LEN}`;
  digitCount.classList.toggle("ready", n === CODE_LEN);
  digitBarFill.style.width = `${Math.min(100, Math.round((n / CODE_LEN) * 100))}%`;
  runBtn.disabled = running || n !== CODE_LEN;
}

surveyCode.addEventListener("input", () => {
  const cleaned = digitsOnly(surveyCode.value);
  if (surveyCode.value !== cleaned) surveyCode.value = cleaned;
  updateDigitCount();
});

function showProgress(pct, stepText) {
  progressCard.hidden = false;
  progressFill.style.width = `${pct}%`;
  progressPct.textContent = `${pct}%`;
  if (stepText) currentStep.textContent = stepText;
}

const parseProgress = (m) => {
  const hit = m.match(/(\d+)%/);
  return hit ? parseInt(hit[1], 10) : null;
};

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
      const step = data.message.split("·").slice(2).join("·").trim();
      showProgress(pct, step || data.message);
    }
  }
}

function processDone(data) {
  showProgress(data.status === "success" ? 100 : parseProgress(data.message) ?? 0, data.message);
  let msg = data.message;
  if (data.reward_code) {
    msg = `Reward code: ${data.reward_code}` + (data.saved?.saved ? " · Saved with your IP & time." : "");
  } else if (data.saved?.saved) {
    msg += " · Run saved (time & IP recorded).";
  }
  showResult(data.status, msg, data.screenshot, data.screenshot_b64);
  if (data.reward_code) appendLog(`Reward code: ${data.reward_code}`, "success");
}

runBtn.addEventListener("click", async () => {
  const code = digitsOnly(surveyCode.value);
  if (code.length !== CODE_LEN || running) return;

  setGlobalRunning(true);
  resultBanner.hidden = true;
  screenshotWrap.hidden = true;
  showProgress(0, "Connecting to survey…");
  appendLog("Starting bot…", "info");

  try {
    const res = await fetch(apiBase ? `${apiBase}/api/run-sync` : "/api/run", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ survey_code: code }),
    });

    if (res.status === 401) return logout("Your session expired. Please sign in again.");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Request failed");
    }

    if ((res.headers.get("content-type") || "").includes("application/json")) {
      const data = await res.json();
      (data.logs || []).forEach(processLogEntry);
      processDone(data);
    } else {
      await readEventStream(res, (evt) =>
        evt.type === "done" ? processDone(evt) : processLogEntry(evt)
      );
    }
  } catch (e) {
    appendLog(String(e.message || e), "error");
    showResult("error", e.message || "Something went wrong.", null, null);
  } finally {
    setGlobalRunning(false);
  }
});

/* ---------------- Bulk ---------------- */
function buildBulkRows() {
  bulkRows.innerHTML = Array.from({ length: BULK_SIZE }, (_, i) => `
    <div class="bulk-row" data-index="${i}" style="--i:${i}">
      <span class="row-num">${i + 1}</span>
      <div class="row-main">
        <input class="row-input" type="text" inputmode="numeric" maxlength="27"
               autocomplete="off" spellcheck="false" placeholder="21-digit code" />
        <p class="row-msg"></p>
      </div>
      <span class="row-state idle">—</span>
    </div>`).join("");
}

const bulkInputs = () => [...bulkRows.querySelectorAll(".row-input")];

function bulkCodes() {
  return bulkInputs().map((i) => digitsOnly(i.value)).filter((c) => c.length === CODE_LEN);
}

function refreshBulkButton() {
  const ready = bulkCodes().length;
  bulkRunBtn.disabled = running || ready === 0;
  bulkRunBtn.querySelector(".btn-label").textContent = running
    ? "Running…"
    : ready
    ? `Run bulk (${ready})`
    : "Run bulk";
}

function setRowState(index, state, label, message) {
  const row = bulkRows.querySelector(`.bulk-row[data-index="${index}"]`);
  if (!row) return;
  row.className = `bulk-row ${state}`;
  const badge = row.querySelector(".row-state");
  badge.className = `row-state ${state}`;
  badge.textContent = label;
  const msg = row.querySelector(".row-msg");
  msg.textContent = message || "";
  msg.hidden = !message;
}

bulkRows.addEventListener("input", (e) => {
  if (!e.target.classList.contains("row-input")) return;
  const cleaned = digitsOnly(e.target.value);
  if (e.target.value !== cleaned) e.target.value = cleaned;
  e.target.classList.toggle("valid", cleaned.length === CODE_LEN);
  refreshBulkButton();
});

// Paste all five codes at once and they spread across the rows.
bulkRows.addEventListener("paste", (e) => {
  const target = e.target;
  if (!target.classList.contains("row-input")) return;

  const text = (e.clipboardData || window.clipboardData).getData("text") || "";
  const found = text
    .split(/[\s,;]+/)
    .map(digitsOnly)
    .filter((c) => c.length === CODE_LEN);
  if (found.length < 2) return;

  e.preventDefault();
  const inputs = bulkInputs();
  const start = inputs.indexOf(target);
  found.slice(0, BULK_SIZE - start).forEach((code, offset) => {
    const input = inputs[start + offset];
    input.value = code;
    input.classList.add("valid");
  });
  appendLog(`Pasted ${Math.min(found.length, BULK_SIZE - start)} codes.`, "info");
  refreshBulkButton();
});

bulkClearBtn.addEventListener("click", () => {
  if (running) return;
  bulkInputs().forEach((i) => {
    i.value = "";
    i.classList.remove("valid");
    i.disabled = false;
  });
  buildBulkRows();
  bulkSummary.hidden = true;
  refreshBulkButton();
});

function updateBulkSummary(counts, total) {
  bulkDone.textContent = counts.done;
  bulkSkipped.textContent = counts.skipped;
  bulkFailed.textContent = counts.failed;
  const finished = counts.done + counts.skipped + counts.failed;
  bulkProgressFill.style.width = `${Math.round((finished / total) * 100)}%`;
}

const STATE_LABEL = {
  success: ["success", "Done"],
  used: ["warn", "Used"],
  stuck: ["warn", "Stuck"],
  error: ["error", "Failed"],
};

bulkRunBtn.addEventListener("click", async () => {
  const inputs = bulkInputs();
  const entries = inputs
    .map((input, position) => ({ position, code: digitsOnly(input.value) }))
    .filter((e) => e.code.length === CODE_LEN);

  if (!entries.length || running) return;

  const unique = new Set(entries.map((e) => e.code));
  if (unique.size !== entries.length) {
    appendLog("The same code is entered more than once — remove duplicates.", "error");
    return;
  }

  // Map the server's 0..n-1 index back onto the row it came from.
  const rowFor = entries.map((e) => e.position);
  const counts = { done: 0, skipped: 0, failed: 0 };

  setGlobalRunning(true);
  bulkSummary.hidden = false;
  updateBulkSummary(counts, entries.length);
  inputs.forEach((i) => (i.disabled = true));
  entries.forEach((e) => setRowState(e.position, "queued", "Queued", ""));
  appendLog(`Starting bulk run — ${entries.length} code(s).`, "info");

  const handleEvent = (evt) => {
    if (evt.type === "log") {
      appendLog(evt.message, evt.level || "info");
      return;
    }
    if (evt.type !== "item") return;

    const row = rowFor[evt.index];
    if (evt.status === "running") {
      setRowState(row, "running", "Running", "");
      return;
    }

    const [state, label] = STATE_LABEL[evt.status] || ["error", "Failed"];
    if (evt.status === "success") counts.done++;
    else if (evt.status === "used" || evt.status === "stuck") counts.skipped++;
    else counts.failed++;

    setRowState(row, state, label, evt.reward_code ? `Reward: ${evt.reward_code}` : evt.message);
    updateBulkSummary(counts, entries.length);
  };

  try {
    const res = await fetch(apiBase ? `${apiBase}/api/run-bulk-sync` : "/api/run-bulk", {
      method: "POST",
      headers: authHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ survey_codes: entries.map((e) => e.code) }),
    });

    if (res.status === 401) return logout("Your session expired. Please sign in again.");
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || "Bulk run failed");
    }

    if ((res.headers.get("content-type") || "").includes("application/json")) {
      const data = await res.json();
      (data.events || []).forEach(handleEvent);
    } else {
      await readEventStream(res, (evt) => {
        if (evt.type === "done") return;
        handleEvent(evt);
      });
    }

    appendLog(
      `Bulk finished — ${counts.done} done, ${counts.skipped} skipped, ${counts.failed} failed.`,
      counts.failed ? "warn" : "success"
    );
    setStatusPill(counts.failed ? "Warning" : "Done", counts.failed ? "error" : "success");
  } catch (e) {
    appendLog(String(e.message || e), "error");
    setStatusPill("Error", "error");
  } finally {
    inputs.forEach((i) => (i.disabled = false));
    setGlobalRunning(false);
  }
});

/* ---------------- Admin ---------------- */
async function loadAdmin() {
  adminRows.innerHTML = `<tr><td colspan="6" class="table-empty">Loading…</td></tr>`;
  try {
    const res = await fetch(apiUrl("/api/completions?limit=200"), { headers: authHeaders() });
    if (res.status === 401) return logout("Your session expired. Please sign in again.");
    if (res.status === 403) {
      adminRows.innerHTML = `<tr><td colspan="6" class="table-empty">Admin access required.</td></tr>`;
      return;
    }
    const data = await res.json();
    adminData = data.items || [];
    renderStats(data.stats || {});
    renderAdminRows();
  } catch {
    adminRows.innerHTML = `<tr><td colspan="6" class="table-empty">Could not load records.</td></tr>`;
  }
}

function renderStats(stats) {
  $("statTotal").textContent = stats.total ?? 0;
  $("statToday").textContent = stats.today ?? 0;
  $("statReward").textContent = stats.with_reward ?? 0;
  $("statIps").textContent = stats.unique_ips ?? 0;
}

function filteredAdmin() {
  const q = adminSearch.value.trim().toLowerCase();
  if (!q) return adminData;
  return adminData.filter((r) =>
    [r.receipt_code, r.reward_code, r.ip_address].some((v) => (v || "").toLowerCase().includes(q))
  );
}

function renderAdminRows() {
  const rows = filteredAdmin();
  if (!rows.length) {
    adminRows.innerHTML = `<tr><td colspan="6" class="table-empty">No records yet.</td></tr>`;
    return;
  }
  adminRows.innerHTML = rows
    .map(
      (r) => `
      <tr>
        <td class="mono dim">${r.id}</td>
        <td class="mono">…${escapeHtml(String(r.receipt_code).slice(-8))}</td>
        <td>${r.reward_code ? `<span class="pill-reward">${escapeHtml(r.reward_code)}</span>` : '<span class="dim">—</span>'}</td>
        <td class="mono dim">${escapeHtml(r.ip_address || "—")}</td>
        <td title="${escapeHtml(r.created_at)}">${escapeHtml(relativeTime(r.created_at))}</td>
        <td><button type="button" class="row-del" data-id="${r.id}" title="Delete">×</button></td>
      </tr>`
    )
    .join("");
}

let searchTimer;
adminSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(renderAdminRows, 150);
});

adminRefresh.addEventListener("click", loadAdmin);

adminRows.addEventListener("click", async (e) => {
  const btn = e.target.closest(".row-del");
  if (!btn) return;
  if (!confirm("Delete this record?")) return;
  const res = await fetch(apiUrl(`/api/completions/${btn.dataset.id}`), {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (res.ok) {
    adminData = adminData.filter((r) => String(r.id) !== String(btn.dataset.id));
    renderAdminRows();
    loadAdmin();
  }
});

adminClear.addEventListener("click", async () => {
  if (!confirm(`Delete ALL ${adminData.length} records? This cannot be undone.`)) return;
  const res = await fetch(apiUrl("/api/completions"), { method: "DELETE", headers: authHeaders() });
  if (res.ok) loadAdmin();
});

adminExport.addEventListener("click", () => {
  const rows = filteredAdmin();
  if (!rows.length) return;
  const header = ["id", "receipt_code", "reward_code", "ip_address", "status", "created_at"];
  const csv = [
    header.join(","),
    ...rows.map((r) => header.map((k) => `"${String(r[k] ?? "").replace(/"/g, '""')}"`).join(",")),
  ].join("\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `survey-runs-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
});

/* ---------------- Config + boot ---------------- */
async function loadDeployConfig() {
  try {
    const res = await fetch("/deploy.json");
    if (res.ok) {
      apiBase = ((await res.json()).apiBase || "").replace(/\/$/, "");
      return;
    }
  } catch {
    /* deploy.json only exists on the Vercel build */
  }
  try {
    const res = await fetch("/api/config");
    if (res.ok) apiBase = ((await res.json()).apiBase || "").replace(/\/$/, "");
  } catch {
    /* same-origin fallback */
  }
}

async function boot() {
  buildPicker();
  buildBulkRows();
  await loadDeployConfig();

  if (token) {
    try {
      const res = await fetch(apiUrl("/api/me"), { headers: authHeaders() });
      if (res.ok) {
        const me = await res.json();
        applyIdentity(me.username, me.role);
        authScreen.hidden = true;
        appRoot.hidden = false;
      } else {
        localStorage.removeItem(TOKEN_KEY);
        token = "";
      }
    } catch {
      /* offline — stay on the login screen */
    }
  }

  const saved = localStorage.getItem(NAME_KEY);
  if (saved && AUTH_USERS.some((u) => u.value === saved)) selectUser(saved);

  updateDigitCount();
  refreshBulkButton();
  refreshAuthSubmit();
}

boot();
