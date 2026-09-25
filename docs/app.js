/**
 * Health Buddy – pure PWA frontend
 * Offline shell + localStorage history; claim checks need network + backend /check
 */

const EXAMPLE_CLAIMS = [
  "You need to drink eight glasses of water every day.",
  "Vaccines cause autism.",
  "Vitamin C supplements prevent the common cold.",
  "Cracking your knuckles causes arthritis.",
  "A juice cleanse will detox your liver.",
];

const VERDICT_COPY = {
  "VERIFIED TRUE": { short: "True", hint: "Strong scientific consensus", tone: "good" },
  "MOSTLY TRUE": { short: "Mostly true", hint: "Right in general, with caveats", tone: "good" },
  "UNVERIFIED / MIXED": { short: "Unverified", hint: "Evidence is limited or conflicting", tone: "mixed" },
  "MOSTLY FALSE": { short: "Mostly false", hint: "Significant inaccuracies", tone: "bad" },
  "VERIFIED FALSE": { short: "False", hint: "Contradicts medical consensus", tone: "bad" },
};

const CHECKING_LINES = [
  "Reading agency guidance…",
  "Weighing the consensus…",
  "Checking what the evidence actually says…",
];

const HISTORY_KEY = "healthbuddy-history-v1";
const API_BASE_KEY = "healthbuddy-api-base";
const INSTALL_DISMISS_KEY = "healthbuddy-install-dismissed";
const MAX_HISTORY = 20;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let busy = false;
let currentReport = null;
let statusTimer = null;
let deferredInstallPrompt = null;

/** Default Gradio Space host for Path 1 (free HF backend). */
const DEFAULT_GRADIO_BASE = "https://sk6594246-healthbuddy.hf.space";

function getApiBase() {
  try {
    const stored = localStorage.getItem(API_BASE_KEY);
    if (stored != null && stored.trim() !== "") return stored.replace(/\/$/, "");
  } catch {}
  return DEFAULT_GRADIO_BASE;
}

function isGradioBase(base) {
  return /hf\.space|huggingface\.co/i.test(base || "");
}

function setApiBase(url) {
  const clean = (url || "").trim().replace(/\/$/, "");
  localStorage.setItem(API_BASE_KEY, clean);
}

function checkUrl() {
  const base = getApiBase();
  if (!base) return "/check";
  if (isGradioBase(base)) return null; // use Gradio path
  return `${base}/check`;
}

/**
 * Call Gradio 5/6 queue API: POST /gradio_api/call/check_claim → poll event stream.
 * Expects 3 outputs: [html, plain, jsonString] after Space app.py update.
 */
async function callGradioCheck(claim) {
  const base = getApiBase().replace(/\/$/, "");
  const post = await fetch(`${base}/gradio_api/call/check_claim`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data: [claim] }),
  });
  if (!post.ok) {
    const t = await post.text().catch(() => "");
    throw new Error(`Gradio call failed (${post.status}). ${t.slice(0, 120)}`);
  }
  const body = await post.json();
  const eventId = body.event_id;
  if (!eventId) throw new Error("Gradio did not return event_id (Space may be sleeping — retry).");

  const streamRes = await fetch(`${base}/gradio_api/call/check_claim/${eventId}`);
  if (!streamRes.ok) throw new Error(`Gradio poll failed (${streamRes.status})`);
  const raw = await streamRes.text();
  // SSE: lines like "event: complete" / "data: [...]"
  let dataLine = null;
  for (const line of raw.split("\n")) {
    if (line.startsWith("data:")) {
      dataLine = line.slice(5).trim();
    }
  }
  if (!dataLine) throw new Error("No data from Gradio (timeout or cold start). Try again.");
  const outputs = JSON.parse(dataLine);
  // Prefer 3rd output JSON when present
  if (Array.isArray(outputs) && outputs.length >= 3 && outputs[2]) {
    try {
      const report = typeof outputs[2] === "string" ? JSON.parse(outputs[2]) : outputs[2];
      if (report && report.verdict) {
        report.claim = report.claim || claim;
        return report;
      }
    } catch {}
  }
  // Fallback: parse plain text (2nd output)
  const plain = (outputs && outputs[1]) || "";
  return parsePlainReport(plain, claim);
}

function parsePlainReport(plain, claim) {
  const lines = String(plain).split("\n");
  let verdict = "UNVERIFIED / MIXED";
  let summary = "";
  let confidence = 0.5;
  const breakdown = [];
  const sources = [];
  let mode = "head";
  for (const line of lines) {
    const t = line.trim();
    if (t.startsWith("Health Buddy verdict:")) {
      verdict = t.replace("Health Buddy verdict:", "").trim();
    } else if (t.startsWith("Claim:")) {
      continue;
    } else if (t.startsWith("Confidence:")) {
      const m = t.match(/(\d+)/);
      if (m) confidence = parseInt(m[1], 10) / 100;
    } else if (t.startsWith("Why this verdict")) {
      mode = "why";
    } else if (t.startsWith("Sources:")) {
      mode = "sources";
      t.replace("Sources:", "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .forEach((org) => sources.push({ organization: org, topic_or_guideline: "", url: "" }));
    } else if (t.startsWith("This information") || t.startsWith("Educational")) {
      mode = "disclaimer";
    } else if (mode === "head" && t && !t.startsWith("Health Buddy") && !t.startsWith("Claim:")) {
      if (!summary) summary = t;
    } else if (mode === "why" && (t.startsWith("•") || t.startsWith("-"))) {
      breakdown.push(t.replace(/^[•\-]\s*/, ""));
    }
  }
  return {
    claim,
    verdict,
    summary,
    confidence_score: confidence,
    detailed_breakdown: breakdown,
    trusted_sources: sources,
    disclaimer: "Educational use only. Not medical advice.",
  };
}

function loadHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, MAX_HISTORY)));
}

function remember(report) {
  const key = report.claim.trim().toLowerCase();
  let entries = loadHistory().filter((e) => e.report.claim.trim().toLowerCase() !== key);
  entries.unshift({ id: crypto.randomUUID(), at: Date.now(), report });
  saveHistory(entries);
  renderHistory();
}

function findCached(claim) {
  const key = claim.trim().toLowerCase();
  return loadHistory().find((e) => e.report.claim.trim().toLowerCase() === key);
}

function normalizeBreakdown(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value === "string") {
    return value
      .split(/\n+/)
      .map((l) => l.replace(/^\s*[-•*]\s*/, "").trim())
      .filter(Boolean);
  }
  return [];
}

function toneClass(verdict) {
  const t = VERDICT_COPY[verdict]?.tone || "mixed";
  return `badge-${t}`;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderLegend() {
  const list = $("#legend-list");
  list.innerHTML = Object.entries(VERDICT_COPY)
    .map(
      ([verdict, meta]) => `
      <li>
        <span class="badge ${toneClass(verdict)}">${meta.short}</span>
        <span>${meta.hint}</span>
      </li>`
    )
    .join("");
}

function renderExamples() {
  const box = $("#examples");
  box.innerHTML = EXAMPLE_CLAIMS.map(
    (c) => `<button type="button" class="chip" data-claim="${c.replace(/"/g, "&quot;")}">${c}</button>`
  ).join("");
  box.addEventListener("click", (e) => {
    const btn = e.target.closest(".chip");
    if (!btn) return;
    const claim = btn.dataset.claim;
    $("#claim-input").value = claim;
    updateCharCount();
    runCheck(claim);
  });
}

function renderHistory() {
  const entries = loadHistory();
  const list = $("#history-list");
  const empty = $("#history-empty");
  const clearBtn = $("#clear-history");

  if (entries.length === 0) {
    list.innerHTML = "";
    empty.hidden = false;
    clearBtn.hidden = true;
    return;
  }

  empty.hidden = true;
  clearBtn.hidden = false;
  list.innerHTML = entries
    .map((entry) => {
      const meta = VERDICT_COPY[entry.report.verdict] || VERDICT_COPY["UNVERIFIED / MIXED"];
      const active = currentReport?.claim === entry.report.claim;
      return `
        <li class="history-item ${active ? "active" : ""}" data-id="${entry.id}">
          <button type="button" class="pick">
            <span class="badge ${toneClass(entry.report.verdict)}">${meta.short}</span>
            <p class="claim-snip">${escapeHtml(entry.report.claim)}</p>
          </button>
          <button type="button" class="remove" data-remove="${entry.id}">Remove</button>
        </li>`;
    })
    .join("");
}

function renderVerdict(report) {
  const meta = VERDICT_COPY[report.verdict] || VERDICT_COPY["UNVERIFIED / MIXED"];
  const pct = Math.round((report.confidence_score || 0) * 100);
  const filled = Math.round((report.confidence_score || 0) * 8);
  const breakdown = normalizeBreakdown(report.detailed_breakdown);
  const sources = Array.isArray(report.trusted_sources) ? report.trusted_sources : [];

  const bars = Array.from({ length: 8 }, (_, i) =>
    `<span class="${i < filled ? "filled" : ""}"></span>`
  ).join("");

  const breakdownHtml =
    breakdown.length > 0
      ? `<h3 class="section-label">Why this verdict</h3>
         <ul class="breakdown">${breakdown.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>`
      : "";

  const sourcesHtml =
    sources.length > 0
      ? `<h3 class="section-label">Trusted sources</h3>
         <ul class="sources">${sources
           .map((s) => {
             const org = escapeHtml(s.organization || "");
             const topic = escapeHtml(s.topic_or_guideline || "");
             if (s.url) {
               return `<li><a href="${escapeHtml(s.url)}" target="_blank" rel="noreferrer">
                 <span><span class="org">${org}</span>${topic ? `<span class="topic">${topic}</span>` : ""}</span>
                 <span aria-hidden="true">↗</span>
               </a></li>`;
             }
             return `<li><span class="org">${org}</span>${topic ? `<span class="topic">${topic}</span>` : ""}</li>`;
           })
           .join("")}</ul>`
      : "";

  $("#verdict-sheet").innerHTML = `
    <article class="verdict-card" aria-live="polite">
      <div class="verdict-top">
        <span class="badge ${toneClass(report.verdict)}">${escapeHtml(report.verdict)}</span>
        <p class="verdict-hint">${meta.hint}</p>
      </div>
      <h2 class="verdict-summary">${escapeHtml(report.summary || "")}</h2>
      <p class="verdict-claim">Claim checked: <span>${escapeHtml(report.claim)}</span></p>
      <div class="confidence">
        <div class="confidence-row">
          <span>Confidence</span>
          <span>${pct}%</span>
        </div>
        <div class="confidence-bar" aria-hidden="true">${bars}</div>
      </div>
      <div class="action-row">
        <button type="button" class="btn btn-primary" id="copy-family">Copy for family chat</button>
        <button type="button" class="btn btn-outline" id="copy-json">Copy JSON</button>
        <button type="button" class="btn btn-ghost" id="recheck">↻ Recheck</button>
      </div>
      ${breakdownHtml}
      ${sourcesHtml}
      <p class="disclaimer">${escapeHtml(report.disclaimer || "Educational use only. Not medical advice.")}</p>
    </article>`;

  $("#verdict-sheet").hidden = false;
  $("#legend").hidden = true;

  $("#copy-family").onclick = () => copyFamily(report);
  $("#copy-json").onclick = () => copyJson(report);
  $("#recheck").onclick = () => runCheck(report.claim, true);
}

function familyMessage(report) {
  const pct = Math.round((report.confidence_score || 0) * 100);
  const sources = (report.trusted_sources || [])
    .slice(0, 3)
    .map((s) => s.organization)
    .filter(Boolean)
    .join(", ");
  return [
    `Health Buddy verdict: ${report.verdict}`,
    `Claim: “${report.claim}”`,
    "",
    report.summary,
    "",
    `Confidence: ${pct}%`,
    sources ? `Sources: ${sources}` : "",
    "",
    report.disclaimer || "Educational use only. Not medical advice.",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

async function copyFamily(report) {
  const ok = await copyText(familyMessage(report));
  const btn = $("#copy-family");
  if (ok && btn) {
    btn.textContent = "Copied for family";
    setTimeout(() => (btn.textContent = "Copy for family chat"), 1600);
  }
}

async function copyJson(report) {
  const payload = JSON.stringify(report, null, 2);
  const ok = await copyText(payload);
  const btn = $("#copy-json");
  if (ok && btn) {
    btn.textContent = "JSON copied";
    setTimeout(() => (btn.textContent = "Copy JSON"), 1600);
  }
}

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function setBusy(state) {
  busy = state;
  const btn = $("#check-btn");
  const icon = $("#btn-icon");
  const label = $("#btn-label");
  btn.disabled = state || $("#claim-input").value.trim().length < 8;
  if (state) {
    icon.textContent = "⏳";
    label.textContent = "Checking";
    let i = 0;
    $("#status-line").textContent = CHECKING_LINES[0];
    $("#status-line").hidden = false;
    statusTimer = setInterval(() => {
      i = (i + 1) % CHECKING_LINES.length;
      $("#status-line").textContent = CHECKING_LINES[i];
    }, 2200);
  } else {
    icon.textContent = "🔍";
    label.textContent = "Check this claim";
    $("#status-line").hidden = true;
    if (statusTimer) clearInterval(statusTimer);
  }
}

function showError(msg) {
  const box = $("#error-box");
  box.textContent = msg;
  box.hidden = false;
  $("#verdict-sheet").hidden = true;
  $("#legend").hidden = true;
}

function clearError() {
  $("#error-box").hidden = true;
}

async function runCheck(raw, force = false) {
  const text = (raw || "").trim();
  if (text.length < 8 || busy) return;

  if (!force) {
    const cached = findCached(text);
    if (cached) {
      clearError();
      currentReport = cached.report;
      renderVerdict(cached.report);
      renderHistory();
      return;
    }
  }

  if (!navigator.onLine) {
    showError("You're offline. Open a recent check from history, or reconnect to verify a new claim.");
    $("#legend").hidden = false;
    return;
  }

  setBusy(true);
  clearError();
  currentReport = null;

  try {
    let report;
    const base = getApiBase();
    if (isGradioBase(base)) {
      report = await callGradioCheck(text);
    } else {
      const form = new FormData();
      form.append("claim", text);
      const url = checkUrl() || "/check";
      const res = await fetch(url, { method: "POST", body: form });
      if (res.status === 429) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || "Daily limit reached. Try again tomorrow.");
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.detail || `Request failed (${res.status})`);
      }
      report = await res.json();
    }
    if (typeof report.detailed_breakdown === "string") {
      report.detailed_breakdown = normalizeBreakdown(report.detailed_breakdown);
    }
    report.claim = report.claim || text;
    currentReport = report;
    remember(report);
    renderVerdict(report);
    renderHistory();
  } catch (err) {
    const msg =
      err.name === "TypeError"
        ? "Could not reach the backend. Check API settings or your connection. If the Space was sleeping, wait ~30s and retry."
        : err.message || "Something went wrong while checking. Please try again.";
    showError(msg);
    $("#legend").hidden = false;
  } finally {
    setBusy(false);
  }
}

function updateCharCount() {
  const len = $("#claim-input").value.trim().length;
  $("#char-count").textContent = len;
  $("#check-btn").disabled = busy || len < 8;
}

/* ---------- Network banner ---------- */
function updateNetBanner() {
  const banner = $("#net-banner");
  const text = $("#net-banner-text");
  if (!navigator.onLine) {
    banner.hidden = false;
    banner.classList.add("offline");
    text.textContent = "You're offline. Recent checks still work; new checks need a connection.";
  } else {
    banner.classList.remove("offline");
    if (!banner.hidden) {
      text.textContent = "Back online.";
      setTimeout(() => {
        if (navigator.onLine) banner.hidden = true;
      }, 1800);
    }
  }
}

/* ---------- Install prompt ---------- */
function showInstallUi(show) {
  const sheet = $("#install-sheet");
  const headerBtn = $("#install-btn");
  if (show) {
    sheet.hidden = false;
    headerBtn.hidden = false;
  } else {
    sheet.hidden = true;
  }
}

function setupInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferredInstallPrompt = e;
    const dismissed = localStorage.getItem(INSTALL_DISMISS_KEY);
    if (!dismissed) showInstallUi(true);
    else $("#install-btn").hidden = false;
  });

  window.addEventListener("appinstalled", () => {
    deferredInstallPrompt = null;
    showInstallUi(false);
    $("#install-btn").hidden = true;
    localStorage.removeItem(INSTALL_DISMISS_KEY);
  });

  $("#install-confirm")?.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    showInstallUi(false);
  });

  $("#install-dismiss")?.addEventListener("click", () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, "1");
    showInstallUi(false);
    $("#install-btn").hidden = false;
  });

  $("#install-btn")?.addEventListener("click", async () => {
    if (deferredInstallPrompt) {
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
      showInstallUi(false);
      return;
    }
    // iOS / browsers without beforeinstallprompt
    alert(
      "To install: open the browser menu and choose “Add to Home Screen” (Safari: Share → Add to Home Screen)."
    );
  });
}

/* ---------- Share Target (GET params from OS share) ---------- */
function applyShareTarget() {
  const params = new URLSearchParams(window.location.search);
  const text = params.get("text") || params.get("title") || "";
  const url = params.get("url") || "";
  let claim = [text, url].filter(Boolean).join("\n").trim();
  if (!claim && params.get("action") === "new") {
    $("#claim-input")?.focus();
    return;
  }
  if (claim.length >= 8) {
    $("#claim-input").value = claim.slice(0, 600);
    updateCharCount();
    // Clean URL without losing history ability
    if (window.history.replaceState) {
      const clean = new URL(window.location.href);
      clean.search = params.get("source") === "pwa" ? "?source=pwa" : "";
      window.history.replaceState({}, "", clean.pathname + clean.search);
    }
  }
}

/* ---------- API settings ---------- */
function setupApiSettings() {
  const dialog = $("#api-dialog");
  const input = $("#api-base");
  $("#api-settings-btn")?.addEventListener("click", () => {
    try {
      const stored = localStorage.getItem(API_BASE_KEY);
      input.value = stored != null ? stored : DEFAULT_GRADIO_BASE;
    } catch {
      input.value = DEFAULT_GRADIO_BASE;
    }
    dialog.showModal();
  });
  $("#api-form")?.addEventListener("submit", (e) => {
    const submitter = e.submitter;
    if (submitter && submitter.value === "save") {
      setApiBase(input.value);
    }
  });
}

function init() {
  renderLegend();
  renderExamples();
  renderHistory();
  setupInstall();
  setupApiSettings();
  applyShareTarget();
  updateNetBanner();

  window.addEventListener("online", updateNetBanner);
  window.addEventListener("offline", updateNetBanner);

  $("#claim-input").addEventListener("input", updateCharCount);
  $("#claim-input").addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      runCheck($("#claim-input").value);
    }
  });

  $("#claim-form").addEventListener("submit", (e) => {
    e.preventDefault();
    runCheck($("#claim-input").value);
  });

  $("#clear-history").addEventListener("click", () => {
    saveHistory([]);
    renderHistory();
  });

  $("#history-list").addEventListener("click", (e) => {
    const removeId = e.target.dataset?.remove;
    if (removeId) {
      const next = loadHistory().filter((x) => x.id !== removeId);
      saveHistory(next);
      renderHistory();
      return;
    }
    const item = e.target.closest(".history-item");
    if (!item) return;
    const entry = loadHistory().find((x) => x.id === item.dataset.id);
    if (!entry) return;
    $("#claim-input").value = entry.report.claim;
    updateCharCount();
    clearError();
    currentReport = entry.report;
    renderVerdict(entry.report);
    renderHistory();
  });

  updateCharCount();
}

init();
