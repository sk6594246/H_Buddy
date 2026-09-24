/**
 * Health Buddy – static frontend
 * Talks to FastAPI /check endpoint
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
const MAX_HISTORY = 20;

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

let busy = false;
let currentReport = null;
let statusTimer = null;

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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
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

  setBusy(true);
  clearError();
  currentReport = null;

  try {
    const form = new FormData();
    form.append("claim", text);

    const res = await fetch("/check", {
      method: "POST",
      body: form,
    });

    if (res.status === 429) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || "Daily limit reached. Try again tomorrow.");
    }

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || `Request failed (${res.status})`);
    }

    const report = await res.json();
    if (typeof report.detailed_breakdown === "string") {
      report.detailed_breakdown = normalizeBreakdown(report.detailed_breakdown);
    }
    currentReport = report;
    remember(report);
    renderVerdict(report);
    renderHistory();
  } catch (err) {
    showError(err.message || "Something went wrong while checking. Please try again.");
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

function init() {
  renderLegend();
  renderExamples();
  renderHistory();

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
