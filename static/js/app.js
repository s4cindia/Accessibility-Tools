/* =========================================================================
   Smart Document Editor & Validator — core application logic
   Shared namespace: window.SDE
   ========================================================================= */
window.SDE = window.SDE || {};
SDE.columns = [];          // current data column names
SDE.columnDefs = [];       // AG Grid column defs from server
SDE.actions = SDE.actions || {};   // action handlers (extended by other files)

/* ---------- HTTP helpers ------------------------------------------------ */
SDE.api = async function (path, opts = {}) {
  const res = await fetch(path, opts);
  let data;
  try { data = await res.json(); } catch { data = { ok: false, error: "Bad response" }; }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  return data;
};
SDE.post = async function (path, body) {
  const data = await SDE.api(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body || {}),
  });
  // Mark "unsaved changes" whenever a data-mutating call succeeds
  // (but not for preview-only transform calls).
  const mutates = /\/api\/(data\/(cell|add-row|delete-rows|duplicate-rows|undo|redo)|transform\/|duplicates\/drop)/;
  if (mutates.test(path) && !(body && body.preview)) SDE.markDirty();
  return data;
};
SDE.get = (path) => SDE.api(path);

/* ---------- Save state (dirty/clean indicator) -------------------------- */
SDE._dirty = false;
SDE.updateSaveUI = function () {
  const badge = document.getElementById("saveState");
  const btn = document.getElementById("saveBtn");
  if (badge) {
    badge.dataset.dirty = SDE._dirty ? "true" : "false";
    badge.innerHTML = SDE._dirty
      ? '<i class="fa-solid fa-circle"></i> Unsaved changes'
      : '<i class="fa-solid fa-circle-check"></i> Saved';
  }
  if (btn) btn.disabled = !SDE._dirty;
};
SDE.markDirty = function () { SDE._dirty = true; SDE.updateSaveUI(); };
SDE.markClean = function () { SDE._dirty = false; SDE.updateSaveUI(); };

/* ---------- Notifications ----------------------------------------------- */
SDE.toast = function (msg, type = "info") {
  const colors = {
    info: "#2563eb", success: "#16a34a", error: "#dc2626", warn: "#d97706",
  };
  if (typeof Toastify === "undefined") { console.log("[toast]", type, msg); return; }
  Toastify({
    text: msg, duration: 3200, gravity: "bottom", position: "right",
    style: { background: colors[type] || colors.info, borderRadius: "9px",
      boxShadow: "0 8px 30px rgba(0,0,0,.18)", fontFamily: "Plus Jakarta Sans" },
  }).showToast();
};
SDE.busy = function (on) { document.getElementById("busy").classList.toggle("show", !!on); };

/* ---------- Modal ------------------------------------------------------- */
SDE.modal = function ({ title, icon = "fa-sliders", bodyHTML, buttons = [], wide = false }) {
  document.getElementById("modalTitle").textContent = title;
  document.getElementById("modalIcon").className = `fa-solid ${icon}`;
  document.getElementById("modalBody").innerHTML = bodyHTML;
  document.getElementById("modal").classList.toggle("wide", wide);
  const foot = document.getElementById("modalFoot");
  foot.innerHTML = "";
  buttons.forEach((b) => {
    const el = document.createElement("button");
    el.className = `btn ${b.variant || ""}`;
    el.innerHTML = b.label;
    el.onclick = () => b.onClick(el);
    foot.appendChild(el);
  });
  document.getElementById("modalOverlay").classList.add("open");
};
SDE.closeModal = function () {
  document.getElementById("modalOverlay").classList.remove("open");
};

/* ---------- Column multiselect builder ---------------------------------- */
SDE.columnSelectHTML = function (id, { multiple = true, includeAll = false } = {}) {
  const opts = SDE.columns.map((c) => `<option value="${SDE.esc(c)}">${SDE.esc(c)}</option>`).join("");
  const all = includeAll ? `<option value="">— all columns —</option>` : "";
  return `<select id="${id}" ${multiple ? "multiple" : ""}>${all}${opts}</select>`;
};
SDE.getSelected = function (id) {
  const el = document.getElementById(id);
  if (!el) return [];
  return Array.from(el.selectedOptions).map((o) => o.value).filter((v) => v !== "");
};
SDE.esc = function (s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
};

/* ---------- Status / header / footer ------------------------------------ */
SDE.applyStatus = function (st) {
  SDE.status = st;
  const chip = document.getElementById("fileChipName");
  chip.textContent = st.file;
  document.getElementById("fileChip").title = st.file;
  document.getElementById("sbFile").textContent = st.loaded ? st.file : "—";
  document.getElementById("sbSize").textContent = st.size || "—";
  document.getElementById("sbRows").textContent = (st.rows || 0).toLocaleString();
  document.getElementById("sbCols").textContent = st.cols || 0;
  const undoBtn = document.getElementById("undoBtn");
  const redoBtn = document.getElementById("redoBtn");
  if (undoBtn) undoBtn.disabled = !st.can_undo;
  if (redoBtn) redoBtn.disabled = !st.can_redo;
  // Import Digital Asset / Import Alt Text are usable only with a sheet loaded.
  ["importAssetBtn", "importAltTextBtn"].forEach((id) => {
    const b = document.getElementById(id);
    if (b) {
      b.disabled = !st.loaded;
      b.title = st.loaded ? "" : "Open a sheet first";
    }
  });
  const dot = document.getElementById("statusDot");
  dot.classList.toggle("is-ready", !!st.loaded);
  document.getElementById("statusDotText").textContent = st.loaded ? "Ready" : "Idle";
  document.getElementById("emptyState").style.display =
    (st.loaded && st.source !== "pdf") ? "none" : "flex";
};
SDE.refreshStatus = async function () {
  try { const d = await SDE.get("/api/status"); SDE.applyStatus(d.status); }
  catch (e) { /* ignore */ }
};
SDE.setSelectedCount = function (n) {
  document.getElementById("sbSelected").textContent = n;
};
SDE.setFilteredCount = function (n) {
  document.getElementById("sbFiltered").textContent = (n || 0).toLocaleString();
};
SDE.setValidationStatus = function (text, cls) {
  const el = document.getElementById("sbValidation");
  el.innerHTML = `<i class="fa-solid fa-shield-halved"></i> ${text}`;
  el.style.color = cls || "";
};

/* ---------- Theme ------------------------------------------------------- */
SDE.toggleTheme = function () {
  const cur = document.documentElement.getAttribute("data-theme");
  const next = cur === "dark" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", next);
  localStorage.setItem("sde-theme", next);
  document.querySelector("#themeToggle i").className =
    next === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  if (SDE.grid && SDE.grid.applyTheme) SDE.grid.applyTheme(next);
};

/* =========================================================================
   FILE OPENING
   ========================================================================= */
SDE.actions["open-file"] = () => document.getElementById("fileInput").click();

SDE.handleUpload = async function (file) {
  const fd = new FormData();
  fd.append("file", file);
  fd.append("mode", window.SDE_PAGE_MODE || "full");
  SDE.busy(true);
  try {
    const d = await SDE.api("/api/files/open", { method: "POST", body: fd });
    SDE.afterOpen(d);
  } catch (e) {
    SDE.fileOpenError(file && file.name, e.message);
  }
  finally { SDE.busy(false); }
};

// Pop-up shown when a file (e.g. a malformed CSV) cannot be opened.
SDE.fileOpenError = function (name, message) {
  const detail = message || "The file could not be read.";
  if (typeof Swal !== "undefined") {
    Swal.fire({
      icon: "error",
      title: "Couldn't open this file",
      html: `<div style="text-align:left">`
        + (name ? `<p style="margin:0 0 8px"><b>${SDE.esc(name)}</b></p>` : "")
        + `<p style="margin:0;color:#475569">${SDE.esc(detail)}</p>`
        + `<p style="margin:10px 0 0;color:#64748b;font-size:13px">`
        + `Check that it's a valid, non-empty CSV/Excel file and try again.</p></div>`,
      confirmButtonText: "OK", confirmButtonColor: "#4f46e5",
    });
  } else {
    SDE.toast(detail, "error");
  }
};

SDE.afterOpen = function (d) {
  if (d.needs_sheet) { SDE.pickSheet(d.path, d.sheets, d.name); return; }
  if (d.pdf) { SDE.applyStatus(d.status); SDE.openPdfPanel(d.pdf_info); SDE.toast("PDF loaded", "success"); return; }
  SDE.applyStatus(d.status);
  SDE.grid.reload();
  SDE.setValidationStatus("Not validated");
  SDE.markClean();
  SDE.toast("File loaded", "success");
  // Placeholder 3: do NOT auto-detect issues/blanks on load. Validation now
  // runs only when the user clicks "Validate data" (see the 'validate' action).
  // Reset any previous validation state so the page opens clean.
  SDE.validateRan = false;
  SDE.wcagIssues = [];
  SDE.idSeq = { active: false };
  SDE.parentIssue = { active: false, error: "", details: [] };
  SDE.blanks = { count: 0, cells: 0, rows: [], colNames: [] };
  if (SDE.grid && SDE.grid.setWcagFlagRows) SDE.grid.setWcagFlagRows([]);
  if (SDE.grid && SDE.grid.setParentFlagRows) SDE.grid.setParentFlagRows([]);
  ["wcagIssuesBadge", "blanksBadge"].forEach((id) => {
    const b = document.getElementById(id); if (b) b.hidden = true;
  });
  // Placeholder 3: validate the Parent ID format as soon as the sheet opens.
  if (window.SDE_PAGE_MODE === "delivery") SDE.checkParentFormat();
};

/* Placeholder 3: flag rows whose WCAG Ref / WCAG / WCAG Ver are missing or
   mismatched. Highlights those rows live in the grid and keeps the current
   issue list + count on the "WCAG issues" toolbar button (no interrupting
   pop-up). The user opens that button to see every row and its exact error. */
/* Placeholder 3: verify the Parent column is 'PSGIN-<ID>' on every row AND
   identical everywhere. No pop-up — the offending rows are MARKED in the grid
   and listed in the Issues panel/badge (like the WCAG + numbering checks). */
SDE.parentIssue = { active: false, error: "", details: [] };
SDE.checkParentFormat = async function () {
  if (window.SDE_PAGE_MODE !== "delivery") return;
  let d;
  try { d = await SDE.get("/api/feature/check-parent"); }
  catch (e) { return; }
  SDE.parentIssue = {
    active: !!(d && d.active),
    error: (d && d.error) || "",
    details: (d && d.details) || [],
  };
  if (SDE.grid && SDE.grid.setParentFlagRows)
    SDE.grid.setParentFlagRows(SDE.parentIssue.active ? (d.ids || []) : []);
  SDE.updateIssuesBadge();
};
SDE.parentProblemCount = function () {
  return (SDE.parentIssue && SDE.parentIssue.active)
    ? (SDE.parentIssue.details || []).length : 0;
};

SDE.wcagIssues = [];
SDE.checkWcag = async function (editedId, rowData) {
  if ((window.SDE_PAGE_MODE !== "delivery" && window.SDE_PAGE_MODE !== "merge")
      || !SDE.grid || !SDE.grid.setWcagFlagRows) return;
  try {
    const d = await SDE.post("/api/data/validate-wcag", {});
    const ids = d.active ? (d.ids || []) : [];
    SDE.grid.setWcagFlagRows(ids);
    SDE.wcagIssues = d.active ? (d.issues || []) : [];
    SDE.updateIssuesBadge();
  } catch (e) { /* non-fatal */ }
  // Keep the blank-cells badge in sync on the same data-change hooks.
  SDE.checkBlanks();
};

/* Placeholders 1 + 3: verify the first column runs 1..N with no gaps/duplicates,
   and (delivery) that each row's first-column number matches the number at the
   start of its Summary. Results live inside the Issues panel + badge — no
   load-time pop-up. */
SDE.idSeq = { active: false };
SDE.checkIdSequence = async function () {
  if (window.SDE_PAGE_MODE !== "delivery" && window.SDE_PAGE_MODE !== "merge") return;
  try {
    const d = await SDE.get("/api/data/check-id-sequence");
    SDE.idSeq = d || { active: false };
  } catch (e) { SDE.idSeq = { active: false }; }
  SDE.updateIssuesBadge();
};

// How many numbering problems are currently outstanding.
SDE.idSeqProblemCount = function () {
  const s = SDE.idSeq || {};
  if (!s.active) return 0;
  return (s.missing || []).length + (s.duplicates || []).length + (s.mismatches || []).length;
};

// The "Numbering" section rendered inside the Issues panel ("" when all good).
SDE.idSeqIssuesHTML = function () {
  const s = SDE.idSeq || {};
  if (!s.active) return "";
  const missing = s.missing || [], dups = s.duplicates || [], mism = s.mismatches || [];
  if (!missing.length && !dups.length && !mism.length) return "";
  const fmt = (arr) => arr.map((n) => SDE.esc(String(n))).join(", ");
  let html = `<h4 style="margin:16px 0 6px">Numbering — column “${SDE.esc(s.first_col)}”
    (should run 1–${SDE.esc(String(s.max))})</h4>`;
  if (missing.length)
    html += `<div style="color:#b91c1c;margin-bottom:4px"><b>Missing (${missing.length}):</b> ${fmt(missing)}</div>`;
  if (dups.length)
    html += `<div style="color:#b45309;margin-bottom:4px"><b>Duplicated (${dups.length}):</b> ${fmt(dups)}</div>`;
  if (mism.length) {
    const rows = mism.slice(0, 200).map((m) =>
      `<tr><td style="font-weight:700;white-space:nowrap">${SDE.esc(String(m.row || ("#" + m.id)))}</td>
        <td>${SDE.esc(String(m.id_num))}</td><td>${SDE.esc(String(m.summary_num))}</td></tr>`).join("");
    html += `<div style="color:#b91c1c;margin:8px 0 4px"><b>${SDE.esc(s.first_col)} number
      ≠ Summary number (${mism.length} row(s)):</b></div>
      <div style="max-height:200px;overflow:auto"><table class="mini-table">
        <thead><tr><th>Row</th><th>${SDE.esc(s.first_col)}</th><th>Summary #</th></tr></thead>
        <tbody>${rows}</tbody></table></div>`;
  }
  return html;
};

// The "Check ID numbering" menu item just opens the Issues panel.
SDE.actions["check-id-sequence"] = function () { SDE.actions["wcag-issues"](); };

/* Placeholder 3: track blank (empty) cells so users can find and fill the gaps
   that block an export. Updates the "Blanks" toolbar button + count badge. */
SDE.blanks = { count: 0, cells: 0, rows: [], colNames: [] };
SDE.checkBlanks = async function () {
  if (window.SDE_PAGE_MODE !== "delivery") return;
  try {
    const d = await SDE.get("/api/data/blanks");
    SDE.blanks = { count: d.count || 0, cells: d.cells || 0,
                   rows: d.rows || [], colNames: d.col_names || [] };
    SDE.updateBlanksButton(SDE.blanks.cells);
  } catch (e) { /* non-fatal */ }
};

SDE.updateBlanksButton = function (cells) {
  const btn = document.getElementById("blanksBtn");
  const badge = document.getElementById("blanksBadge");
  if (!btn || !badge) return;
  const n = cells == null ? (SDE.blanks.cells || 0) : cells;
  btn.classList.toggle("has-blanks", n > 0);
  badge.hidden = false;
  badge.textContent = String(n);
  badge.classList.toggle("ok", n === 0);
  btn.title = n > 0
    ? `${n} blank cell(s) — click to find, filter and fill them`
    : "No blank cells — ready to export";
};

/* Toolbar action: show every row with blank cells + which columns, and offer a
   one-click "show only blank rows" filter so they're trivial to find and fill. */
SDE.actions["show-blanks"] = async function () {
  if (!SDE.requireData()) return;
  await SDE.checkBlanks();
  const b = SDE.blanks || { rows: [], cells: 0 };
  if (!b.cells) {
    SDE.modal({
      title: "Blank cells", icon: "fa-circle-check",
      bodyHTML: `<div class="hint" style="color:#16a34a;font-weight:600">
        ✓ No blank cells — every cell is filled. You can export.</div>`,
      buttons: [
        ...(SDE.grid.blanksOnly ? [{ label: "Show all rows", onClick: () => {
            SDE.grid.setBlanksOnly(false); SDE.closeModal();
            SDE.toast("Showing all rows", "info"); } }] : []),
        { label: "Close", variant: "primary", onClick: SDE.closeModal },
      ],
    });
    return;
  }
  const lines = (b.rows || []).map((it) =>
    `<tr>
       <td style="font-weight:700;white-space:nowrap">${SDE.esc(String(
         it.row || ("#" + it.id)))}</td>
       <td style="color:#b91c1c">${(it.cols || []).map((c) => SDE.esc(c)).join(", ")}</td>
     </tr>`).join("");
  const filterBtn = SDE.grid.blanksOnly
    ? { label: "Show all rows", onClick: () => {
        SDE.grid.setBlanksOnly(false); SDE.closeModal();
        SDE.toast("Showing all rows", "info"); } }
    : { label: "Show only blank rows", variant: "primary", onClick: () => {
        SDE.grid.setBlanksOnly(true); SDE.closeModal();
        SDE.toast("Filtered to rows with blank cells — fill them, then export", "info"); } };
  SDE.modal({
    title: `Blank cells — ${b.cells} in ${b.count} row(s)`, icon: "fa-eraser",
    bodyHTML: `<div class="hint">Blank cells are shaded red in the grid. Use
        <b>Show only blank rows</b> to filter the grid to just these rows, fill every
        red cell, then export. The list and count update as you fill them.</div>
      <div style="max-height:360px;overflow:auto;margin-top:10px">
        <table class="mini-table">
          <thead><tr><th>Row</th><th>Blank column(s)</th></tr></thead>
          <tbody>${lines}</tbody></table></div>`,
    buttons: [filterBtn, { label: "Close", onClick: SDE.closeModal }],
  });
};

/* Keep the Issues toolbar button + badge in sync with the combined problem count
   (first-column numbering + WCAG). */
SDE.updateIssuesBadge = function () {
  const btn = document.getElementById("wcagIssuesBtn");
  const badge = document.getElementById("wcagIssuesBadge");
  if (!btn || !badge) return;
  const wcagN = (SDE.wcagIssues || []).length;
  const seqN = SDE.idSeqProblemCount();
  const parN = SDE.parentProblemCount ? SDE.parentProblemCount() : 0;
  const n = wcagN + seqN + parN;
  btn.classList.toggle("has-errors", n > 0);
  badge.hidden = false;
  badge.textContent = String(n);
  badge.classList.toggle("ok", n === 0);
  btn.title = n > 0
    ? `${n} issue(s) — click to see the exact row and column`
    : "No issues — numbering" + (window.SDE_PAGE_MODE === "delivery" || window.SDE_PAGE_MODE === "merge" ? " and WCAG values" : "") + " are consistent";
};

/* Toolbar action: the Issues panel. Shows the first-column numbering problems
   and (delivery + merge) the WCAG Ref/WCAG/WCAG Ver problems, each with exact
   row + column. Refreshes the underlying checks first so it's always current. */
SDE.actions["wcag-issues"] = async function () {
  if (!SDE.requireData()) return;
  if (window.SDE_PAGE_MODE === "delivery" || window.SDE_PAGE_MODE === "merge") await SDE.checkWcag();
  if (window.SDE_PAGE_MODE === "delivery") await SDE.checkParentFormat();
  await SDE.checkIdSequence();

  const numberingHTML = SDE.idSeqIssuesHTML();

  // Parent ID section (delivery): one line per offending row.
  const pdet = (SDE.parentIssue && SDE.parentIssue.active) ? (SDE.parentIssue.details || []) : [];
  let parentHTML = "";
  if (pdet.length) {
    const lines = pdet.slice(0, 200).map((p) => `<tr>
        <td style="font-weight:700;white-space:nowrap">${SDE.esc(String(p.row))}</td>
        <td>${SDE.esc(String(p.value || "(blank)"))}</td>
        <td style="color:#b91c1c">${SDE.esc(String(p.problem || ""))}</td>
      </tr>`).join("");
    parentHTML = `<h4 style="margin:16px 0 6px">Parent ID — ${pdet.length} row(s)
        (must be “PSGIN-&lt;ID&gt;”, same on every row)</h4>
      <div style="max-height:240px;overflow:auto"><table class="mini-table">
        <thead><tr><th>Row</th><th>Parent value</th><th>Problem</th></tr></thead>
        <tbody>${lines}</tbody></table></div>`;
  }

  // WCAG section (delivery): one line per (row, column) problem.
  const issues = SDE.wcagIssues || [];
  let wcagHTML = "", wcagProblems = 0;
  if (issues.length) {
    const rowLabel = (it) => SDE.esc(String(it.row != null && it.row !== "" ? it.row
      : (it.ref && it.ref !== "(blank)" ? it.ref : ("#" + it.id))));
    let lines = "";
    issues.forEach((it) => {
      const rl = rowLabel(it);
      const dets = (it.details && it.details.length)
        ? it.details
        : (it.problems || []).map((p) => ({ col: "", msg: p }));
      dets.forEach((d, i) => {
        wcagProblems++;
        lines += `<tr>
          <td style="font-weight:700;white-space:nowrap">${i === 0 ? rl : ""}</td>
          <td style="white-space:nowrap;font-weight:600">${SDE.esc(String(d.col || "—"))}</td>
          <td style="color:#b91c1c">${SDE.esc(String(d.msg || ""))}</td>
        </tr>`;
      });
    });
    wcagHTML = `<h4 style="margin:16px 0 6px">WCAG — ${wcagProblems} problem(s) in ${issues.length} row(s)</h4>
      <div style="max-height:300px;overflow:auto"><table class="mini-table">
        <thead><tr><th>Row</th><th>Column</th><th>Problem</th></tr></thead>
        <tbody>${lines}</tbody></table></div>`;
  }

  if (!numberingHTML && !wcagHTML && !parentHTML) {
    SDE.modal({
      title: "Issues", icon: "fa-circle-check",
      bodyHTML: `<div class="hint" style="color:#16a34a;font-weight:600">
        ✓ No issues — first-column numbering${SDE.idSeq && SDE.idSeq.summary_col ? " / Summary" : ""}${
          window.SDE_PAGE_MODE === "delivery" || window.SDE_PAGE_MODE === "merge" ? " and WCAG values" : ""}${
          window.SDE_PAGE_MODE === "delivery" ? " and Parent IDs" : ""} are all consistent.</div>`,
      buttons: [{ label: "Close", variant: "primary", onClick: SDE.closeModal }],
    });
    return;
  }
  const total = SDE.idSeqProblemCount() + wcagProblems + pdet.length;
  SDE.modal({
    title: `Issues — ${total}`, icon: "fa-triangle-exclamation",
    bodyHTML: `<div class="hint">Fix the items below. Highlighted rows in the grid clear
        automatically as you correct them.</div>${numberingHTML}${wcagHTML}${parentHTML}`,
    buttons: [
      { label: `<i class="fa-solid fa-file-pdf"></i> Download PDF`, onClick: SDE.downloadIssuesPdf },
      { label: "Close", variant: "primary", onClick: SDE.closeModal },
    ],
  });
};

/* Highlight every occurrence of `term` inside `sentence` for the Alert panel.
   The sentence is HTML-escaped first; the watched terms contain no HTML-special
   characters so the match still lines up after escaping. */
SDE.highlightTerm = function (sentence, term) {
  const safe = SDE.esc(String(sentence || ""));
  const t = String(term || "").trim();
  if (!t) return safe;
  const re = new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "ig");
  return safe.replace(re, (m) => `<mark class="alert-hit">${m}</mark>`);
};

/* Toolbar action (Placeholder 1 / merge): the Alert panel. Scans every data
   cell for the watched audit component names (Flashcards, TestPrep, Final Exam,
   …) and lists each hit with its exact row, column and the COMPLETE contents of
   the cell the word appears in, with the word highlighted for good visibility. */
SDE.actions["alert-terms"] = async function () {
  if (!SDE.requireData()) return;
  SDE.busy(true);
  let d;
  try {
    d = await SDE.get("/api/data/alert-terms");
  } catch (e) {
    SDE.toast("Could not scan for alert terms: " + e.message, "error");
    return;
  } finally { SDE.busy(false); }

  const hits = d.hits || [];
  SDE.updateAlertBadge(hits.length);

  if (!hits.length) {
    SDE.modal({
      title: "Alert", icon: "fa-circle-check",
      bodyHTML: `<div class="hint" style="color:#16a34a;font-weight:600">
        ✓ None of the watched audit components were found in the merged data
        (${(d.scanned || 0).toLocaleString()} rows scanned).</div>`,
      buttons: [{ label: "Close", variant: "primary", onClick: SDE.closeModal }],
    });
    return;
  }

  const lines = hits.map((h) => `<tr class="alert-meta">
      <td class="alert-row">${SDE.esc(String(h.row))}</td>
      <td class="alert-col">${SDE.esc(String(h.col || "—"))}</td>
      <td class="alert-word">${SDE.esc(String(h.word || ""))}</td>
    </tr>
    <tr class="alert-content-row">
      <td class="alert-sentence" colspan="3">${SDE.highlightTerm(h.cell || h.word, h.term)}</td>
    </tr>`).join("");

  SDE.modal({
    title: `Alert — ${hits.length}`, icon: "fa-bell", wide: true,
    bodyHTML: `<div class="hint">Watched audit components found in the merged data.
        The complete cell contents are shown (full width) with the detected word highlighted.</div>
      <div class="alert-wrap"><table class="mini-table alert-table">
        <thead><tr><th>Row</th><th>Column</th><th>Word</th></tr></thead>
        <tbody>${lines}</tbody></table></div>`,
    buttons: [{ label: "Close", variant: "primary", onClick: SDE.closeModal }],
  });
};

/* Keep the Alert toolbar badge in sync with the last scan's hit count. */
SDE.updateAlertBadge = function (n) {
  const btn = document.getElementById("alertTermsBtn");
  const badge = document.getElementById("alertTermsBadge");
  if (!btn || !badge) return;
  badge.hidden = false;
  badge.textContent = String(n);
  badge.classList.toggle("ok", n === 0);
  btn.classList.toggle("has-errors", n > 0);
};

/* Build + download the Issues panel as a PDF (server-rendered so it always
   matches the live checks). */
SDE.downloadIssuesPdf = async function () {
  SDE.busy(true);
  try {
    const d = await SDE.post("/api/data/issues-pdf", {});
    SDE.downloadLinkToast(d.url, d.file, { rows: d.count });
  } catch (e) {
    SDE.toast("Could not build the Issues PDF: " + e.message, "error");
  } finally { SDE.busy(false); }
};

SDE.pickSheet = function (path, sheets, name) {
  const opts = sheets.map((s) => `<option value="${SDE.esc(s)}">${SDE.esc(s)}</option>`).join("");
  SDE.modal({
    title: "Select a sheet", icon: "fa-layer-group",
    bodyHTML: `<div class="field"><label>Workbook: ${SDE.esc(name)}</label>
      <select id="sheetSel">${opts}</select></div>`,
    buttons: [
      { label: "Cancel", onClick: SDE.closeModal },
      { label: "Load sheet", variant: "primary", onClick: async () => {
        const sheet = document.getElementById("sheetSel").value;
        SDE.closeModal(); SDE.busy(true);
        try {
          const d = await SDE.post("/api/files/load-sheet", { path, sheet, mode: window.SDE_PAGE_MODE || "full" });
          SDE.applyStatus(d.status); SDE.grid.reload();
          SDE.setValidationStatus("Not validated");
          SDE.markClean();
          SDE.toast(`Loaded sheet "${sheet}"`, "success");
          if (window.SDE_PAGE_MODE === "delivery") SDE.checkParentFormat();
          if (window.SDE_PAGE_MODE === "delivery" || window.SDE_PAGE_MODE === "merge") {
            SDE.checkWcag();
            SDE.checkIdSequence();
          }
        } catch (e) { SDE.toast(e.message, "error"); }
        finally { SDE.busy(false); }
      } },
    ],
  });
};

SDE.actions["open-folder"] = async function () {
  const { value: folder } = await Swal.fire({
    title: "Open folder", input: "text",
    inputPlaceholder: "C:\\Users\\me\\Documents  or  /home/me/data",
    showCancelButton: true, confirmButtonText: "List files",
    confirmButtonColor: "#2563eb",
  });
  if (!folder) return;
  try {
    const d = await SDE.post("/api/files/folder", { folder });
    if (!d.items.length) { SDE.toast("No supported files found", "warn"); return; }
    SDE.fileListModal("Folder contents", d.items);
  } catch (e) { SDE.toast(e.message, "error"); }
};

SDE.actions["recent"] = async function () {
  const d = await SDE.get("/api/files/recent");
  if (!d.recent.length) { SDE.toast("No recent files yet", "info"); return; }
  const fmtTs = (ts) => {
    if (!ts) return "";
    try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ""; }
  };
  const items = d.recent.map((r) => {
    const when = fmtTs(r.ts);
    const parts = [];
    if (r.sheet) parts.push(`sheet: ${r.sheet}`);
    if (when) parts.push(`Opened ${when}`);
    return { path: r.path, name: r.name, ext: "", size: parts.join("  \u00b7  ") };
  });
  SDE.fileListModal("Recent files", items);
};

/* ----- Clear current file and open the next one ------------------------- */
SDE.actions["close-file"] = function () {
  const proceed = async () => {
    SDE.busy(true);
    try {
      const d = await SDE.post("/api/files/close", {});
      SDE.applyStatus(d.status);            // returns to the open screen
      SDE.columns = [];
      SDE._dupBasis = null;
      const ib = document.getElementById("dupInfoBtn");
      if (ib) ib.style.display = "none";
      if (SDE.markClean) SDE.markClean();
      if (SDE.grid && SDE.grid.reload) { try { await SDE.grid.reload(); } catch (e) {} }
      SDE.toast("File cleared \u2014 choose the next file to open.", "success");
      const fi = document.getElementById("fileInput");
      if (fi) fi.click();                   // immediately offer to open the next file
    } catch (e) {
      SDE.toast(e.message, "error");
    } finally {
      SDE.busy(false);
    }
  };
  if (SDE._dirty) {
    SDE.modal({
      title: "Clear current file?", icon: "fa-circle-xmark",
      bodyHTML: `<div class="hint">You have unsaved changes. Clearing this file will discard them and let you open the next file. Continue?</div>`,
      buttons: [
        { label: "Cancel", onClick: SDE.closeModal },
        { label: "Discard & open next", variant: "primary",
          onClick: () => { SDE.closeModal(); proceed(); } },
      ],
    });
  } else {
    proceed();
  }
};

/* ----- Downloads: re-download previously exported files ----------------- */
SDE.actions["downloads"] = async function () {
  let d;
  try { d = await SDE.get("/api/files/downloads"); }
  catch (e) { SDE.toast(e.message, "error"); return; }
  const list = (d && d.downloads) || [];
  if (!list.length) { SDE.toast("No downloads yet — export a file first.", "info"); return; }
  const fmt = (ts) => { try { return new Date(ts * 1000).toLocaleString(); } catch (e) { return ""; } };
  const kb = (n) => (n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " KB");

  // Placeholders 1 (merge) & 3 (delivery): just show the LAST file exported and
  // its time — no re-download.
  if (window.SDE_PAGE_MODE === "merge" || window.SDE_PAGE_MODE === "delivery") {
    const last = list[0];
    SDE.modal({
      title: "Last download", icon: "fa-download",
      bodyHTML: `<div class="list-item" style="cursor:default">
          <i class="fa-solid ${SDE.fileIcon(last.name)}"></i>
          <span class="nm">${SDE.esc(last.name)}</span>
          <span class="meta" style="margin-left:auto">${SDE.esc(fmt(last.ts))}</span>
        </div>`,
      buttons: [{ label: "Close", variant: "primary", onClick: SDE.closeModal }],
    });
    return;
  }

  const rows = list.map((it) => `
    <div class="list-item" style="cursor:default">
      <i class="fa-solid ${SDE.fileIcon(it.name)}"></i>
      <span class="nm">${SDE.esc(it.name)}</span>
      <span class="meta">${SDE.esc(fmt(it.ts))}  \u00b7  ${kb(it.size)}</span>
      <a class="btn-mini" href="${SDE.esc(it.url)}" data-name="${SDE.esc(it.name)}" download
         style="margin-left:auto;text-decoration:none"><i class="fa-solid fa-download"></i> Download</a>
    </div>`).join("");
  SDE.modal({
    title: "Downloads", icon: "fa-download",
    bodyHTML: `<div class="hint" style="margin-bottom:10px">Files you have exported, newest first. Click <b>Download</b> to rename and save one again.</div>${rows}`,
    buttons: [{ label: "Close", onClick: SDE.closeModal }],
  });
  // Re-downloads from this list also let the user rename before saving.
  // Attach the delegated handler once for the life of the page (the #modalBody
  // element persists across modal opens, so guard against stacking listeners).
  const body = document.getElementById("modalBody");
  if (body && !body._saveAsBound) {
    body._saveAsBound = true;
    body.addEventListener("click", (e) => {
      const a = e.target.closest && e.target.closest("a.btn-mini[data-name][href]");
      if (!a || typeof window.saveFileAs !== "function") return;
      e.preventDefault();
      window.saveFileAs(a.getAttribute("href"), a.getAttribute("data-name") || "");
    });
  }
};

/* ----- Duplicate basis: explain what defined the last duplicate check --- */
SDE.actions["duplicate-info"] = function () {
  const b = SDE._dupBasis;
  if (!b) {
    SDE.toast("Run \u201cCheck duplicate rows\u201d or \u201cFind duplicates\u201d first.", "info");
    return;
  }
  const cols = (b.columns && b.columns.length)
    ? b.columns.map((c) => `<span class="chip">${SDE.esc(c)}</span>`).join(" ")
    : "<i>all columns</i>";
  const scope = b.allColumns ? "every column in the data" : "the columns currently shown in the grid";

  // Build a per-group table of the actual key-column values so the user can
  // verify the grouping is correct (rows in a group should match on these).
  let valuesHTML = "";
  const keyCols = (b.keyColumns && b.keyColumns.length) ? b.keyColumns.slice(0, 6) : [];
  const sample = b.sample || [];
  if (sample.length && keyCols.length) {
    const header = `<tr><th>Group</th><th>Row</th>${keyCols.map((c) => `<th>${SDE.esc(c)}</th>`).join("")}</tr>`;
    let lastGroup = null;
    const body = sample.map((rec) => {
      const g = rec.__group;
      const groupCell = (g !== lastGroup)
        ? `<td><span class="tag amber">#${SDE.esc(g)}</span></td>` : "<td></td>";
      lastGroup = g;
      const cells = keyCols.map((c) => `<td>${SDE.esc(rec[c] == null ? "" : rec[c])}</td>`).join("");
      return `<tr>${groupCell}<td>${SDE.esc(rec.__id)}</td>${cells}</tr>`;
    }).join("");
    valuesHTML = `<h4 style="margin:14px 0 6px">Key-column values per group</h4>
      <div class="hint" style="margin-bottom:6px">Rows sharing a group number should have identical values in these column(s). ${b.sample.length >= 300 ? "Showing the first 300 rows." : ""}</div>
      <div style="max-height:340px;overflow:auto"><table class="mini-table">${header}${body}</table></div>`;
  }

  SDE.modal({
    title: "What defines a duplicate", icon: "fa-circle-info",
    bodyHTML: `<div class="hint" style="margin-bottom:10px">Two rows were treated as duplicates when they matched on ${scope}:</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${cols}</div>
      ${b.groups != null ? `<div class="hint" style="margin-top:12px">${b.rows} row(s) in ${b.groups} group(s) were found and grouped together.</div>` : ""}
      ${valuesHTML}`,
    buttons: [{ label: "Close", onClick: SDE.closeModal }],
  });
};

SDE.fileListModal = function (title, items) {
  const rows = items.map((it) => `
    <div class="list-item" data-path="${SDE.esc(it.path)}">
      <i class="fa-solid ${SDE.fileIcon(it.ext || it.path)}"></i>
      <span class="nm">${SDE.esc(it.name)}</span>
      <span class="meta">${SDE.esc(it.size || "")}</span>
    </div>`).join("");
  SDE.modal({
    title, icon: "fa-folder-open", bodyHTML: rows,
    buttons: [{ label: "Close", onClick: SDE.closeModal }],
  });
  document.querySelectorAll("#modalBody .list-item").forEach((el) => {
    el.onclick = async () => {
      SDE.closeModal(); SDE.busy(true);
      try { SDE.afterOpen(await SDE.post("/api/files/open-path", { path: el.dataset.path, mode: window.SDE_PAGE_MODE || "full" })); }
      catch (e) { SDE.fileOpenError(el.dataset.name || el.dataset.path, e.message); }
      finally { SDE.busy(false); }
    };
  });
};

SDE.fileIcon = function (s) {
  s = (s || "").toLowerCase();
  if (s.includes("xls")) return "fa-file-excel";
  if (s.includes("csv") || s.includes("tsv")) return "fa-file-csv";
  if (s.includes("pdf")) return "fa-file-pdf";
  return "fa-file";
};

/* =========================================================================
   TRANSFORM / BULK EDIT
   ========================================================================= */
SDE.runTransform = async function (op, params, applyLabel = "Apply") {
  SDE.busy(true);
  try {
    const d = await SDE.post(`/api/transform/${op}`, params);
    SDE.applyStatus(d.status); SDE.grid.reload();
    SDE.toast(`${applyLabel}: ${d.description}`, "success");
  } catch (e) { SDE.toast(e.message, "error"); }
  finally { SDE.busy(false); }
};

// builds the standard scope + column picker used by most transforms
SDE.transformControls = function (opts = {}) {
  return `
    <div class="field">
      <label>Apply to</label>
      <div class="seg" id="scopeSeg">
        <button class="active" data-scope="all">All rows</button>
        <button data-scope="selected">Selected rows</button>
      </div>
    </div>
    <div class="field">
      <label>Columns ${opts.colHint || "(none = all)"}</label>
      ${SDE.columnSelectHTML("tfCols", { multiple: true })}
      <div class="hint">Ctrl/Cmd-click to choose multiple. Leave empty for all.</div>
    </div>`;
};
SDE.readScope = function () {
  const active = document.querySelector("#scopeSeg .active");
  return active ? active.dataset.scope : "all";
};
SDE.wireScopeSeg = function () {
  document.querySelectorAll("#scopeSeg button").forEach((b) => {
    b.onclick = () => {
      document.querySelectorAll("#scopeSeg button").forEach((x) => x.classList.remove("active"));
      b.classList.add("active");
    };
  });
};
SDE.scopeIds = function () {
  return SDE.readScope() === "selected" ? SDE.grid.selectedIds() : null;
};

// Simple text-input transforms (replace, regex, append, prepend, null replace)
SDE.openTextTransform = function (cfg) {
  SDE.modal({
    title: cfg.title, icon: cfg.icon || "fa-wand-magic-sparkles",
    bodyHTML: cfg.fields + SDE.transformControls(cfg),
    buttons: [
      { label: "Cancel", onClick: SDE.closeModal },
      cfg.preview ? { label: "Preview", onClick: () => cfg.onPreview() } : null,
      { label: "Apply", variant: "primary", onClick: () => cfg.onApply() },
    ].filter(Boolean),
  });
  SDE.wireScopeSeg();
};

SDE.actions["replace"] = function () {
  SDE.openTextTransform({
    title: "Find & Replace", icon: "fa-right-left", preview: true,
    fields: `<div class="row-2">
        <div class="field"><label>Find</label><input type="text" id="tfFind"></div>
        <div class="field"><label>Replace with</label><input type="text" id="tfRepl"></div>
      </div>`,
    onPreview: () => SDE.previewTransform("replace", () => ({
      find: val("tfFind"), replace: val("tfRepl"), columns: SDE.getSelected("tfCols"),
      scope: SDE.readScope(), ids: SDE.scopeIds() })),
    onApply: () => { SDE.closeModal(); SDE.runTransform("replace", {
      find: val("tfFind"), replace: val("tfRepl"), columns: SDE.getSelected("tfCols"),
      scope: SDE.readScope(), ids: SDE.scopeIds() }); },
  });
};

SDE.actions["regex-replace"] = function () {
  SDE.openTextTransform({
    title: "Regex Replace", icon: "fa-asterisk", preview: true,
    fields: `<div class="row-2">
        <div class="field"><label>Pattern (regex)</label><input type="text" id="tfPat" placeholder="\\d+"></div>
        <div class="field"><label>Replace with</label><input type="text" id="tfRepl" placeholder="#"></div>
      </div>`,
    onPreview: () => SDE.previewTransform("regex_replace", () => ({
      pattern: val("tfPat"), replace: val("tfRepl"), columns: SDE.getSelected("tfCols"),
      scope: SDE.readScope(), ids: SDE.scopeIds() })),
    onApply: () => { SDE.closeModal(); SDE.runTransform("regex_replace", {
      pattern: val("tfPat"), replace: val("tfRepl"), columns: SDE.getSelected("tfCols"),
      scope: SDE.readScope(), ids: SDE.scopeIds() }); },
  });
};

// One-click case / trim / clean transforms (with a small confirm modal for scope)
["trim", "upper", "lower", "proper", "remove-special"].forEach((act) => {
  const map = { trim: ["trim", "Trim Spaces", "fa-scissors"],
    upper: ["upper", "Upper Case", "fa-arrow-up-a-z"],
    lower: ["lower", "Lower Case", "fa-arrow-down-a-z"],
    proper: ["proper", "Proper Case", "fa-font"],
    "remove-special": ["remove_special", "Remove Special Characters", "fa-eraser"] };
  SDE.actions[act] = function () {
    const [op, title, icon] = map[act];
    SDE.modal({
      title, icon, bodyHTML: SDE.transformControls({}),
      buttons: [
        { label: "Cancel", onClick: SDE.closeModal },
        { label: "Apply", variant: "primary", onClick: () => {
          SDE.closeModal();
          SDE.runTransform(op, { columns: SDE.getSelected("tfCols"),
            scope: SDE.readScope(), ids: SDE.scopeIds() });
        } },
      ],
    });
    SDE.wireScopeSeg();
  };
});

SDE.actions["merge"] = function () {
  SDE.modal({
    title: "Merge Columns", icon: "fa-object-group",
    bodyHTML: `
      <div class="field"><label>Columns to merge (in order)</label>
        ${SDE.columnSelectHTML("mgCols", { multiple: true })}</div>
      <div class="row-2">
        <div class="field"><label>New column name</label><input type="text" id="mgTarget" value="merged"></div>
        <div class="field"><label>Separator</label><input type="text" id="mgSep" value=" "></div>
      </div>`,
    buttons: [
      { label: "Cancel", onClick: SDE.closeModal },
      { label: "Merge", variant: "primary", onClick: () => {
        SDE.closeModal();
        SDE.runTransform("merge", { columns: SDE.getSelected("mgCols"),
          target: val("mgTarget") || "merged", separator: val("mgSep") });
      } },
    ],
  });
};

SDE.actions["split"] = function () {
  SDE.modal({
    title: "Split Column", icon: "fa-object-ungroup",
    bodyHTML: `
      <div class="field"><label>Column to split</label>
        ${SDE.columnSelectHTML("spCol", { multiple: false })}</div>
      <div class="field"><label>Separator</label>
        <input type="text" id="spSep" value=","></div>`,
    buttons: [
      { label: "Cancel", onClick: SDE.closeModal },
      { label: "Split", variant: "primary", onClick: () => {
        const col = document.getElementById("spCol").value;
        SDE.closeModal();
        SDE.runTransform("split", { column: col, separator: val("spSep") || "," });
      } },
    ],
  });
};

SDE.previewTransform = async function (op, paramsFn) {
  try {
    const d = await SDE.post(`/api/transform/${op}`, { ...paramsFn(), preview: true });
    const p = d.preview;
    const cols = p.columns;
    const head = `<tr><th>#</th>${cols.map((c) => `<th>${SDE.esc(c)}</th>`).join("")}</tr>`;
    const rows = p.before.map((b, i) => {
      const a = p.after[i] || {};
      const cells = cols.map((c) =>
        `<td>${SDE.esc(b[c])} <span class="arrow">→</span> ${SDE.esc(a[c])}</td>`).join("");
      return `<tr><td>${b.__id}</td>${cells}</tr>`;
    }).join("");
    const html = `<div style="overflow:auto"><table class="preview-tbl"><thead>${head}</thead>
      <tbody>${rows}</tbody></table></div>
      <div class="hint" style="margin-top:10px">Showing up to 8 affected rows.</div>`;
    document.getElementById("modalBody").insertAdjacentHTML("beforeend",
      `<div id="previewBox" style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px">${html}</div>`);
    const old = document.getElementById("previewBoxPrev");
    if (old) old.remove();
    document.getElementById("previewBox").id = "previewBoxPrev";
  } catch (e) { SDE.toast(e.message, "error"); }
};

/* Commit any in-progress grid edit and wait for pending cell-saves to finish.
   Ensures every export/report/summary reflects the latest edits. */
SDE.commitEdits = async function () {
  if (!SDE.grid) return;
  if (SDE.grid.stopEditing) SDE.grid.stopEditing();
  if (SDE.grid.flush) await SDE.grid.flush();
};

/* Explicit Save: commit the active edit, flush pending saves, mark clean.
   Edits already persist to the server as you make them; Save guarantees the
   in-progress edit is committed so the next download is fully up to date. */
SDE.actions["save"] = async function () {
  if (!SDE.status || !SDE.status.loaded) { SDE.toast("Nothing to save yet", "info"); return; }
  SDE.busy(true);
  try {
    await SDE.commitEdits();
    await SDE.refreshStatus();
    SDE.markClean();
    SDE.toast("All changes saved — downloads will be up to date", "success");
  } catch (e) { SDE.toast(e.message, "error"); }
  finally { SDE.busy(false); }
};

/* =========================================================================
   EXPORT + REPORTS
   ========================================================================= */
/* Placeholder 3 (delivery): before ANY export, auto-fill blank Issue Category
   from Issue, strip a leading hyphen in Description, and block the export if
   any blank cell remains. Returns true when it is OK to proceed. Other modes
   are unaffected. */
SDE.deliveryExportGate = async function () {
  if (window.SDE_PAGE_MODE !== "delivery") return true;
  await SDE.commitEdits();
  try {
    const d = await SDE.post("/api/feature/delivery-prepare", {});
    if (d.applied) {
      // the clean-up changed the data — refresh the grid + counters
      if (SDE.grid && SDE.grid.reload) { try { await SDE.grid.reload(); } catch (e) {} }
      if (SDE.refreshStatus) await SDE.refreshStatus();
    }
    // Block export if there is even ONE outstanding Issue (WCAG / Summary /
    // Description / numbering / Parent). Refresh the checks first.
    await SDE.checkWcag();
    await SDE.checkParentFormat();
    await SDE.checkIdSequence();
    const nIssues = (SDE.wcagIssues || []).length
      + (SDE.idSeqProblemCount ? SDE.idSeqProblemCount() : 0)
      + (SDE.parentProblemCount ? SDE.parentProblemCount() : 0);
    if (nIssues > 0) {
      if (typeof Swal !== "undefined") {
        Swal.fire({ icon: "error", title: "Can't export yet",
          html: `<div style="text-align:left;color:#475569">There ${nIssues === 1
              ? "is <b>1</b> outstanding issue" : "are <b>" + nIssues + "</b> outstanding issues"}
            in this sheet. Open the <b>Issues</b> panel, fix every item, then export.</div>`,
          confirmButtonColor: "#4f46e5" });
      } else { SDE.toast(`Resolve all ${nIssues} issue(s) before exporting`, "error"); }
      return false;
    }
    return true;
  } catch (e) {
    // Refresh the blanks badge, then point the user at the Blanks button.
    SDE.checkBlanks();
    const isBlankErr = /blank/i.test(e.message || "");
    if (typeof Swal !== "undefined") {
      Swal.fire({ icon: "error", title: "Can't export yet",
        html: `<div style="text-align:left;color:#475569">${SDE.esc(e.message)}</div>`
          + (isBlankErr ? `<div style="text-align:left;margin-top:10px;color:#1f2937">
              <b>Tip:</b> click the <b>Blanks</b> button in the toolbar to filter the grid
              to just the rows with blank cells, fill the red cells, then export.</div>` : ""),
        confirmButtonColor: "#4f46e5" });
    } else { SDE.toast(e.message, "error"); }
    return false;
  }
};

["csv", "pdf", "json"].forEach((fmt) => {
  SDE.actions[`export-${fmt}`] = async function () {
    if (!SDE.requireData()) return;
    if (!(await SDE.deliveryExportGate())) return;
    SDE.busy(true);
    try {
      await SDE.commitEdits();
      const d = await SDE.post(`/api/export/${fmt}`, {});
      SDE.toast(`Exported ${d.file}`, "success");
      SDE.downloadLinkToast(d.url, d.file, { rows: d.rows, cols: d.cols });
    } catch (e) { SDE.toast(e.message, "error"); }
    finally { SDE.busy(false); }
  };
});

// Excel offers optional highlights: yellow Summary cells and/or blue blanks.
async function doExcelExport(opts) {
  opts = opts || {};
  if (!(await SDE.deliveryExportGate())) return;
  SDE.busy(true);
  try {
    await SDE.commitEdits();
    const d = await SDE.post("/api/export/excel", {
      highlight_summary: !!opts.summary,
      highlight_blanks: !!opts.blanks,
      highlight_dups: !!opts.dups,
    });
    SDE.toast(`Exported ${d.file}`, "success");
    SDE.downloadLinkToast(d.url, d.file, { rows: d.rows, cols: d.cols });
  } catch (e) { SDE.toast(e.message, "error"); }
  finally { SDE.busy(false); }
}

// ---- merge mode: merge multiple axe workbooks, load result into the grid ----
SDE.actions["merge-files"] = function () {
  document.getElementById("mergeInput").click();
};

SDE.handleMerge = async function (fileList) {
  const fd = new FormData();
  Array.prototype.forEach.call(fileList, (f) => fd.append("files", f));
  SDE.busy(true);
  try {
    const d = await SDE.api("/api/files/merge-open", { method: "POST", body: fd });
    SDE.afterOpen(d);
    const s = d.stats || {};
    SDE.toast(`Merged ${s.files_processed}/${s.files_total} files · `
      + `${s.duplicates_removed} duplicate(s) removed · ${s.final_rows} rows`, "success");
    if (d.merge_url) SDE.downloadLinkToast(d.merge_url, d.merged_file,
      { rows: s.final_rows, cols: s.columns });
  } catch (e) {
    if (typeof Swal !== "undefined") {
      Swal.fire({ icon: "error", title: "Couldn't merge the files",
        html: `<div style="text-align:left;color:#475569">${SDE.esc(e.message)}</div>`,
        confirmButtonText: "OK", confirmButtonColor: "#4f46e5" });
    } else { SDE.toast(e.message, "error"); }
  }
  finally { SDE.busy(false); }
};
SDE.actions["delivery-errors"] = async function () {
  if (!SDE.requireData()) return;
  SDE.busy(true);
  try {
    await SDE.commitEdits();
    const d = await SDE.get("/api/feature/delivery-errors");
    const s = d.summary || {};
    const tbl = (title, obj, col) => {
      const keys = Object.keys(obj || {});
      if (!keys.length) return `<p class="hint">No "${SDE.esc(col)}" column found, or no values.</p>`;
      return `<h4 style="margin:14px 0 6px">${title}</h4><table class="mini-table">
        <thead><tr><th>${SDE.esc(col)}</th><th>Errors</th></tr></thead><tbody>` +
        keys.map((k) => `<tr><td>${SDE.esc(k)}</td><td>${obj[k]}</td></tr>`).join("") +
        `</tbody></table>`;
    };
    SDE.modal({
      title: "Error summary", icon: "fa-triangle-exclamation",
      bodyHTML: `<div class="hint">Total rows: <b>${s.total || 0}</b></div>`
        + tbl("By WCAG Ver", s.by_wcag, s.wcag_col || "WCAG Ver")
        + tbl("By Priority", s.by_prio, s.prio_col || "Priority"),
      buttons: [{ label: "Close", variant: "primary", onClick: SDE.closeModal }],
    });
  } catch (e) { SDE.toast(e.message, "error"); }
  finally { SDE.busy(false); }
};

// ---- delivery mode: manage the template (upload / remove) ----
SDE.updateTplNote = function (found) {
  const note = document.getElementById("tplNote");
  if (!note) return;
  note.classList.toggle("found", !!found);
  note.classList.toggle("missing", !found);
  const txt = note.querySelector(".tpl-note-text");
  if (txt) txt.textContent = found ? "Template ready" : "No template — plain output";
  const icon = note.querySelector("i");
  if (icon) icon.className = "fa-solid " + (found ? "fa-circle-check" : "fa-triangle-exclamation");
};
SDE.actions["template-manage"] = async function () {
  let status = { found: false };
  try { status = await SDE.get("/api/template/status"); } catch (e) { /* ignore */ }
  const statusLine = status.found
    ? `<div class="tpl-note found" style="margin-bottom:12px"><i class="fa-solid fa-circle-check"></i> A template is installed — delivery exports will use it.</div>`
    : `<div class="tpl-note missing" style="margin-bottom:12px"><i class="fa-solid fa-triangle-exclamation"></i> No template installed — delivery exports are plain workbooks.</div>`;
  SDE.modal({
    title: "Delivery template", icon: "fa-file-invoice",
    bodyHTML: `${statusLine}
      <div class="hint">Upload your standardized audit workbook (.xlsx). Exports from this page will be written into a copy of it. Remove it to go back to plain output.</div>`,
    buttons: [
      { label: "Close", onClick: SDE.closeModal },
      ...(status.found ? [{ label: "Remove template", onClick: async () => {
          try { const d = await SDE.post("/api/template/clear", {}); SDE.updateTplNote(d.found);
            SDE.toast("Template removed — exports will be plain", "info"); SDE.closeModal(); }
          catch (e) { SDE.toast(e.message, "error"); }
        } }] : []),
      { label: "Upload template…", variant: "primary", onClick: () => {
          SDE.closeModal(); document.getElementById("tplFileInput").click();
        } },
    ],
  });
};
SDE.handleTemplateUpload = async function (file) {
  if (!file) return;
  const fd = new FormData(); fd.append("file", file);
  SDE.busy(true);
  try {
    const d = await SDE.api("/api/template/upload", { method: "POST", body: fd });
    SDE.updateTplNote(d.found);
    SDE.toast(`Template set: ${d.uploaded} — delivery exports will use it`, "success");
  } catch (e) {
    if (typeof Swal !== "undefined") {
      Swal.fire({ icon: "error", title: "Couldn't use that template",
        html: `<div style="text-align:left;color:#475569">${SDE.esc(e.message)}</div>`,
        confirmButtonColor: "#4f46e5" });
    } else { SDE.toast(e.message, "error"); }
  } finally { SDE.busy(false); }
};
/* The "Help" lookup (WCAG criteria + axe Rule ID) lives in its own file:
   static/js/help.js — kept separate so it can be changed in isolation. */

SDE.actions["export-template"] = async function () {
  if (!SDE.requireData()) return;
  // Apply the placeholder-3 clean-up + blank gate before collecting headings.
  if (!(await SDE.deliveryExportGate())) return;
  // Auto-fill defaults from the loaded file; user can edit but not leave blank.
  const fname = (SDE.status && SDE.status.file) || "";
  const courseDefault = fname.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").trim();
  const rows = (SDE.status && SDE.status.rows) || 0;
  SDE.modal({
    title: "Export using delivery template", icon: "fa-file-invoice",
    bodyHTML: `<div class="hint" style="margin-bottom:10px">These fill the Audit Summary
      heading. They're pre-filled from your file — edit if needed, but they can't be empty.</div>
      <div class="field"><label>Report title</label>
        <input id="tplTitle" type="text" value="WCAG 2.2 AA Accessibility Audit Summary"></div>
      <div class="field" style="margin-top:8px"><label>Course / product name</label>
        <input id="tplCourse" type="text" value="${SDE.esc(courseDefault)}" placeholder="e.g. Phlebotomy Essentials 8e"></div>
      <div class="field" style="margin-top:8px"><label>Course details / content</label>
        <input id="tplDetails" type="text" value="${rows} issue(s) in this delivery" placeholder="e.g. ISBN … | Navigate Premier + eBook"></div>
      <div id="tplErr" class="hint" style="color:#dc2626;margin-top:8px;display:none"></div>`,
    buttons: [
      { label: "Cancel", onClick: SDE.closeModal },
      { label: "Export", variant: "primary", onClick: async () => {
          const title = document.getElementById("tplTitle").value.trim();
          const course = document.getElementById("tplCourse").value.trim();
          const details = document.getElementById("tplDetails").value.trim();
          const err = document.getElementById("tplErr");
          if (!title || !course || !details) {
            err.textContent = "Title, course, and details are all required — none can be empty.";
            err.style.display = "block";
            return;
          }
          SDE.closeModal();
          SDE.busy(true);
          try {
            await SDE.commitEdits();
            const d = await SDE.post("/api/feature/export-template", { title, course, details });
            SDE.toast(d.template_used ? "Exported using the delivery template"
              : "No template installed — exported a standalone workbook",
              d.template_used ? "success" : "info");
            SDE.downloadLinkToast(d.url, d.file, {});
          } catch (e) {
            if (typeof Swal !== "undefined") {
              Swal.fire({ icon: "error", title: "Can't export yet",
                html: `<div style="text-align:left;color:#475569">${SDE.esc(e.message)}</div>`,
                confirmButtonColor: "#4f46e5" });
            } else { SDE.toast(e.message, "error"); }
          }
          finally { SDE.busy(false); }
        } },
    ],
  });
};

/* Placeholder 3 (delivery): a delivery audit must already be open. Click opens a
   file picker for a SEPARATE downloadables workbook; its "Counts by Type" sheet
   (rows 7/8/9 = PDF/PowerPoint/Word) gives the counts, and THREE digital-asset
   template rows are appended to the end of the loaded dataset with Instances set
   to those counts. After import, the counts are shown. */
SDE.actions["import-digital-asset"] = function () {
  if (window.SDE_PAGE_MODE !== "delivery") return;
  if (!SDE.requireData()) return;   // a delivery file must be open first
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".xlsx,.xls";
  input.style.display = "none";
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    input.remove();
    if (file) SDE._promptDigitalAssetUrl(file);
  }, { once: true });
  document.body.appendChild(input);
  input.click();
};

/* Placeholder 3: Import Alt Text — append the alt-text boilerplate row to the
   end of the loaded sheet (ID continues, Parent inherited). Then reload the
   grid, refresh status, re-run the checks, mark dirty, and toast. */
SDE.actions["import-alt-text"] = async function () {
  if (window.SDE_PAGE_MODE !== "delivery") return;
  if (!SDE.requireData()) return;
  SDE.busy(true);
  try {
    await SDE.commitEdits();
    const d = await SDE.api("/api/feature/import-alt-text", { method: "POST" });
    if (SDE.grid && SDE.grid.reload) { try { await SDE.grid.reload(); } catch (e) {} }
    if (SDE.refreshStatus) await SDE.refreshStatus();
    await SDE.checkWcag(); await SDE.checkParentFormat(); await SDE.checkIdSequence();
    SDE.markDirty();
    SDE.toast(`Added ${d.added || 1} alt-text row at the end.`, "success");
  } catch (e) {
    if (typeof Swal !== "undefined") {
      Swal.fire({ icon: "error", title: "Couldn't import alt text",
        html: `<div style="text-align:left;color:#475569">${SDE.esc(e.message)}</div>`,
        confirmButtonColor: "#4f46e5" });
    } else { SDE.toast(e.message, "error"); }
  } finally { SDE.busy(false); }
};

/* Step 2: after the file is chosen, ask for the URL to record in the 'Issue URL'
   column of the 3 new rows (optional), then run the import. */
// Only a real http(s) URL is accepted (and nothing else).
SDE.isValidUrl = function (u) {
  return /^https?:\/\/[^\s]+\.[^\s]+$/i.test((u || "").trim());
};
SDE._promptDigitalAssetUrl = function (file) {
  SDE.modal({
    title: "Import Digital Asset", icon: "fa-file-arrow-up", wide: true,
    bodyHTML: `<div class="hint" style="margin-bottom:14px">Selected file:
        <b>${SDE.esc(file.name)}</b>. Enter the URL to record in the
        <b>Issue URL</b> column of the 3 new rows. A valid URL is
        <b>required</b> (starting with http:// or https://) — nothing else is
        accepted.</div>
      <div class="field"><label style="font-size:14px;font-weight:600">Issue URL <span style="color:#dc2626">*</span></label>
        <input id="daUrl" type="url" inputmode="url" placeholder="https://example.com/…" autocomplete="off"
               style="width:100%;box-sizing:border-box;padding:15px 18px;font-size:17px;line-height:1.4;
                      border:2px solid var(--accent,#4f46e5);border-radius:11px;"></div>
      <div id="daUrlErr" class="hint" style="color:#dc2626;margin-top:8px;font-size:13.5px;display:none"></div>`,
    buttons: [
      { label: "Cancel", onClick: SDE.closeModal },
      { label: "Import", variant: "primary", onClick: () => {
          const url = (document.getElementById("daUrl").value || "").trim();
          const err = document.getElementById("daUrlErr");
          if (!url) {
            err.textContent = "A URL is required. Enter a valid URL (e.g. https://example.com/page).";
            err.style.display = "block";
            return;   // keep the modal open
          }
          if (!SDE.isValidUrl(url)) {
            err.textContent = "Enter a valid URL (e.g. https://example.com/page). Only http:// or https:// URLs are accepted.";
            err.style.display = "block";
            return;   // keep the modal open
          }
          SDE.closeModal();
          SDE._doDigitalAssetImport(file, url);
        } },
    ],
  });
  setTimeout(() => { const el = document.getElementById("daUrl"); if (el) el.focus(); }, 60);
};

SDE._doDigitalAssetImport = async function (file, url) {
  SDE.busy(true);
  try {
    if (SDE.commitEdits) await SDE.commitEdits();
    const fd = new FormData();
    fd.append("file", file);
    if (url) fd.append("issue_url", url);
    const d = await SDE.api("/api/feature/import-digital-asset", { method: "POST", body: fd });
    const c = d.counts || {};
    if (SDE.grid && SDE.grid.reload) { try { await SDE.grid.reload(); } catch (e) {} }
    if (SDE.refreshStatus) await SDE.refreshStatus();
    if (window.SDE_PAGE_MODE === "delivery") { await SDE.checkWcag(); await SDE.checkParentFormat(); }
    await SDE.checkIdSequence();
    SDE.markDirty();
    // Show the counts straight after import.
    if (typeof Swal !== "undefined") {
      Swal.fire({ icon: "success", title: "Digital assets imported",
        html: `<div style="text-align:left;color:#334155;line-height:1.7">`
          + `<b>Counts by Type</b><br>`
          + `PDF: <b>${c.pdf || 0}</b><br>Word: <b>${c.word || 0}</b><br>`
          + `PowerPoint: <b>${c.ppt || 0}</b><br><br>`
          + `Added <b>${d.added || 0}</b> row(s) to the end of the loaded sheet`
          + (url ? `, with Issue URL set to <b>${SDE.esc(url)}</b>` : "")
          + ` (Instances set to these counts).</div>`,
        confirmButtonColor: "#4f46e5" });
    }
    SDE.toast(`Added ${d.added || 0} digital-asset rows — PDF ${c.pdf || 0}, Word ${c.word || 0}, PPT ${c.ppt || 0}`, "success");
  } catch (e) {
    if (typeof Swal !== "undefined") {
      Swal.fire({ icon: "error", title: "Couldn't import digital asset",
        html: `<div style="text-align:left;color:#475569">${SDE.esc(e.message)}</div>`,
        confirmButtonColor: "#4f46e5" });
    } else { SDE.toast(e.message, "error"); }
  } finally { SDE.busy(false); }
};

SDE.actions["export-excel"] = function () {
  if (!SDE.requireData()) return;
  SDE.modal({
    title: "Export to Excel", icon: "fa-file-excel",
    bodyHTML: `<div class="hint" style="margin-bottom:12px">Choose how cells should be highlighted in the downloaded workbook (leave all off for a plain file):</div>
      <label class="chk-row" style="font-size:13.5px;margin-bottom:6px"><input type="checkbox" id="xlHlSummary">
        <span>Highlight <b>Summary</b> cells over 250 characters or with line breaks in <span style="background:#DCFCE7;padding:0 6px;border-radius:3px">light green</span></span></label>
      <label class="chk-row" style="font-size:13.5px;margin-bottom:6px"><input type="checkbox" id="xlHlBlanks">
        <span>Highlight <b>blank / empty</b> cells in <span style="background:#FEE2E2;padding:0 6px;border-radius:3px">light red</span></span></label>
      <label class="chk-row" style="font-size:13.5px"><input type="checkbox" id="xlHlDups">
        <span>Download with the <b>duplicate-group</b> highlighting (the
          <span style="background:#FDEBD0;padding:0 5px;border-radius:3px">colour</span><span style="background:#DCEAFF;padding:0 5px;border-radius:3px">groups</span>
          from <b>Find duplicates</b>)</span></label>`,
    buttons: [
      { label: "Cancel", onClick: SDE.closeModal },
      { label: "Export", variant: "primary", onClick: () => {
          const summary = document.getElementById("xlHlSummary").checked;
          const blanks = document.getElementById("xlHlBlanks").checked;
          const dups = document.getElementById("xlHlDups").checked;
          SDE.closeModal();
          doExcelExport({ summary, blanks, dups });
        } },
    ],
  });
};

SDE.downloadLinkToast = function (url, name, meta) {
  // Let the user keep the default name or rename it, then save (shared helper
  // in saveas.js — also used by the standalone operation pages). The row/column
  // count is shown as context inside the Save dialog.
  if (typeof window.saveFileAs === "function") {
    return window.saveFileAs(url, name, meta || {});
  }
  // Defensive fallback if saveas.js failed to load: plain download.
  try {
    const a = document.createElement("a");
    a.href = url; a.download = name || "";
    document.body.appendChild(a); a.click(); a.remove();
  } catch (e) { /* ignore */ }
};

SDE.actions["reports"] = function () {
  if (!SDE.requireData()) return;
  SDE.modal({
    title: "Generate Report", icon: "fa-file-lines",
    bodyHTML: `
      <div class="field"><label>Report type</label>
        <select id="rpKind">
          <option value="validation">Validation report</option>
          <option value="duplicate">Duplicate report</option>
          <option value="error">Error report</option>
          <option value="summary">Data summary report</option>
        </select></div>
      <div class="field"><label>Format</label>
        <select id="rpFmt">
          <option value="pdf">PDF</option>
          <option value="excel">Excel</option>
          <option value="html">HTML</option>
        </select></div>`,
    buttons: [
      { label: "Cancel", onClick: SDE.closeModal },
      { label: "Generate", variant: "primary", onClick: async () => {
        const kind = val("rpKind"); const fmt = val("rpFmt");
        SDE.closeModal(); SDE.busy(true);
        try {
          await SDE.commitEdits();
          const d = await SDE.post(`/api/report/${kind}/${fmt}`, {});
          SDE.downloadLinkToast(d.url, d.file);
        } catch (e) { SDE.toast(e.message, "error"); }
        finally { SDE.busy(false); }
      } },
    ],
  });
};

/* ---------- small utils ------------------------------------------------- */
function val(id) { const e = document.getElementById(id); return e ? e.value : ""; }
SDE.requireData = function () {
  if (!SDE.status || !SDE.status.loaded || SDE.status.source === "pdf") {
    SDE.toast("Load a data file first", "warn"); return false;
  }
  return true;
};

/* =========================================================================
   BOOTSTRAP
   ========================================================================= */
/* =========================================================================
   RIBBON MENU (spreadsheet-style top menu)
   ========================================================================= */
SDE.initRibbon = function () {
  const ribbon = document.getElementById("ribbon");
  if (!ribbon) return;
  const menus = Array.from(ribbon.querySelectorAll(".ribbon-menu"));
  if (!menus.length) return;

  const closeAll = (except) => {
    menus.forEach((m) => {
      if (m === except) return;
      m.classList.remove("open");
      const top = m.querySelector(".ribbon-top");
      if (top) top.setAttribute("aria-expanded", "false");
    });
  };
  const open = (m) => {
    closeAll(m);
    m.classList.add("open");
    const top = m.querySelector(".ribbon-top");
    if (top) top.setAttribute("aria-expanded", "true");
  };
  const isOpen = (m) => m.classList.contains("open");
  const itemsOf = (m) => Array.from(m.querySelectorAll(".ribbon-item:not(:disabled)"));

  menus.forEach((menu) => {
    const top = menu.querySelector(".ribbon-top");
    top.addEventListener("click", (e) => {
      e.stopPropagation();
      if (isOpen(menu)) closeAll();
      else open(menu);
    });
    // Open with keyboard and move into the list
    top.addEventListener("keydown", (e) => {
      if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open(menu);
        const items = itemsOf(menu);
        if (items.length) items[0].focus();
      } else if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const i = menus.indexOf(menu);
        const next = e.key === "ArrowRight"
          ? menus[(i + 1) % menus.length]
          : menus[(i - 1 + menus.length) % menus.length];
        next.querySelector(".ribbon-top").focus();
        if (isOpen(menu)) open(next);
      }
    });
    // Clicking an item runs its action (global handler) then closes the menu
    menu.querySelectorAll(".ribbon-item").forEach((item) => {
      item.addEventListener("click", () => setTimeout(closeAll, 0));
    });
    // Keyboard navigation inside the dropdown
    menu.addEventListener("keydown", (e) => {
      const items = itemsOf(menu);
      const idx = items.indexOf(document.activeElement);
      if (e.key === "ArrowDown") {
        e.preventDefault(); items[(idx + 1) % items.length]?.focus();
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); items[(idx - 1 + items.length) % items.length]?.focus();
      } else if (e.key === "Home") {
        e.preventDefault(); items[0]?.focus();
      } else if (e.key === "End") {
        e.preventDefault(); items[items.length - 1]?.focus();
      } else if (e.key === "Escape") {
        e.preventDefault(); closeAll(); top.focus();
      }
    });
  });

  // Close on outside click
  document.addEventListener("click", (e) => {
    if (!ribbon.contains(e.target)) closeAll();
  });
};


document.addEventListener("DOMContentLoaded", () => {
  // theme icon
  const t = document.documentElement.getAttribute("data-theme");
  document.querySelector("#themeToggle i").className =
    t === "dark" ? "fa-solid fa-sun" : "fa-solid fa-moon";
  document.getElementById("themeToggle").onclick = SDE.toggleTheme;

  // file input
  document.getElementById("fileInput").addEventListener("change", (e) => {
    const files = e.target.files;
    if (files && files.length > 1 && (window.SDE_PAGE_MODE === "merge")) {
      SDE.handleMerge(files);            // placeholder 1 only: merge into one grid
    } else if (files && files[0]) {
      SDE.handleUpload(files[0]);        // single file (delivery / editor)
    }
    e.target.value = "";
  });

  // merge multi-file input (merge mode)
  const mi = document.getElementById("mergeInput");
  if (mi) mi.addEventListener("change", (e) => {
    if (e.target.files && e.target.files.length) SDE.handleMerge(e.target.files);
    e.target.value = "";
  });

  // delivery template upload input (delivery mode)
  const tpl = document.getElementById("tplFileInput");
  if (tpl) tpl.addEventListener("change", (e) => {
    if (e.target.files[0]) SDE.handleTemplateUpload(e.target.files[0]);
    e.target.value = "";
  });

  // global search (header) -> grid search
  const gs = document.getElementById("globalSearch");
  gs.addEventListener("keydown", (e) => {
    if (e.key === "Enter") SDE.grid.search(gs.value.trim());
  });

  // toolbar + global action dispatch
  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-action]");
    if (!btn || btn.disabled) return;   // ignore disabled items (e.g. imports with no sheet)
    const act = btn.dataset.action;
    const handler = SDE.actions[act];
    if (handler) { e.preventDefault(); handler(btn); }
  });

  // modal close
  document.getElementById("modalClose").onclick = SDE.closeModal;
  document.getElementById("modalOverlay").addEventListener("click", (e) => {
    if (e.target.id === "modalOverlay") SDE.closeModal();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") SDE.closeModal();
    if ((e.ctrlKey || e.metaKey) && e.key === "s") { e.preventDefault(); if (SDE.actions["save"]) SDE.actions["save"](); }
    if ((e.ctrlKey || e.metaKey) && e.key === "z") { e.preventDefault(); SDE.actions["undo"](); }
    if ((e.ctrlKey || e.metaKey) && e.key === "y") { e.preventDefault(); SDE.actions["redo"](); }
  });

  SDE.initRibbon();
  SDE.refreshStatus();
});
