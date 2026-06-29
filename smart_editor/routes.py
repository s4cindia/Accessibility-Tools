"""Smart Editor routes.

Blueprints (names + URL prefixes preserved from the original app so existing
front-end calls keep working):
    files_bp      /api/files       open / sheets / load / recent / folder
    data_bp       /api/data        columns / rows / edits / undo-redo
    check_bp      /api             validate / duplicates
    transform_bp  /api/transform   bulk transforms (+ preview)
    analytics_bp  /api/analytics   overview / statistics / profile / chart
    export_bp     /api             export / report
    pdf_bp        /api/pdf         info / text / search / tables
"""
from __future__ import annotations

import logging
import re
from pathlib import Path

from flask import Blueprint, request

from app_helpers import (fail, load_pdf, load_tabular, ok, pdf_info_payload,
                         status_payload)
from config import config
from services import excel_service, export_service
from services.store import FileMeta, store, drop_all_blank_rows
from smart_editor import services as editor_services
from smart_editor import validators
from utils import file_utils
from utils.helpers import ID_COL, column_defs, data_columns

log = logging.getLogger("sde.smart_editor")

files_bp = Blueprint("files", __name__, url_prefix="/api/files")
data_bp = Blueprint("data", __name__, url_prefix="/api/data")
check_bp = Blueprint("check", __name__, url_prefix="/api")
transform_bp = Blueprint("transform", __name__, url_prefix="/api/transform")
analytics_bp = Blueprint("analytics", __name__, url_prefix="/api/analytics")
export_bp = Blueprint("export", __name__, url_prefix="/api")
pdf_bp = Blueprint("pdf", __name__, url_prefix="/api/pdf")


# --------------------------------------------------------------------------
# Files: open / sheets / load / recent / folder
# --------------------------------------------------------------------------
def _max_cols_for(mode) -> int:
    # delivery editor (placeholder 3) keeps A-W (23); everything else A-R (18)
    return 23 if str(mode or "").lower() == "delivery" else 18


def _sort_for(mode) -> bool:
    # Placeholders 1 (merge) and 3 (delivery) present rows ordered by ID.
    return str(mode or "").lower() in ("merge", "delivery")


def _validate_for(mode) -> bool:
    # Placeholder 3 (delivery) only accepts the A–W audit format.
    return str(mode or "").lower() == "delivery"


@files_bp.route("/open", methods=["POST"])
def open_file():
    mode = request.form.get("mode")
    max_cols = _max_cols_for(mode)
    sort_id = _sort_for(mode)
    validate_audit = _validate_for(mode)
    if "file" not in request.files:
        return fail("No file part in request.")
    f = request.files["file"]
    if not f.filename:
        return fail("No file selected.")
    if not file_utils.allowed_file(f.filename):
        return fail("Unsupported file type.")
    dest = file_utils.unique_path(config.upload_dir,
                                  file_utils.safe_filename(f.filename))
    f.save(dest)
    ext = dest.suffix.lower()

    try:
        if ext in (".xlsx", ".xls"):
            sheets = excel_service.list_sheets(dest)
            if len(sheets) > 1:
                return ok(needs_sheet=True, path=str(dest), sheets=sheets,
                          name=dest.name)
            load_tabular(dest, sheets[0] if sheets else None, max_cols, sort_id,
                         validate_audit)
            return ok(loaded=True, status=status_payload())

        if ext == ".pdf":
            load_pdf(dest)
            return ok(loaded=True, pdf=True, status=status_payload(),
                      pdf_info=pdf_info_payload())

        load_tabular(dest, max_cols=max_cols, sort_id=sort_id,
                     validate_audit=validate_audit)
        return ok(loaded=True, status=status_payload())
    except ValueError as exc:
        return fail(str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("open failed: %s", dest.name)
        return fail(f"“{dest.name}” could not be opened. The file may be "
                    f"corrupt, empty, or not a valid {ext.lstrip('.') or 'data'} "
                    f"file. Details: {exc}")


@files_bp.route("/open-path", methods=["POST"])
def open_path():
    body = request.get_json(force=True, silent=True) or {}
    max_cols = _max_cols_for(body.get("mode"))
    sort_id = _sort_for(body.get("mode"))
    validate_audit = _validate_for(body.get("mode"))
    path = Path(body.get("path", "")).expanduser()
    if not path.exists():
        return fail("File not found.")
    ext = path.suffix.lower()
    try:
        if ext == ".pdf":
            load_pdf(path)
            return ok(loaded=True, pdf=True, status=status_payload(),
                      pdf_info=pdf_info_payload())
        if ext in (".xlsx", ".xls"):
            sheets = excel_service.list_sheets(path)
            if len(sheets) > 1:
                return ok(needs_sheet=True, path=str(path), sheets=sheets,
                          name=path.name)
            load_tabular(path, sheets[0] if sheets else None, max_cols, sort_id,
                         validate_audit)
            return ok(loaded=True, status=status_payload())
        load_tabular(path, max_cols=max_cols, sort_id=sort_id,
                     validate_audit=validate_audit)
        return ok(loaded=True, status=status_payload())
    except ValueError as exc:
        return fail(str(exc))


@files_bp.route("/sheets")
def sheets():
    path = request.args.get("path", "")
    if not path:
        return fail("Missing path.")
    return ok(sheets=excel_service.list_sheets(path))


@files_bp.route("/load-sheet", methods=["POST"])
def load_sheet():
    body = request.get_json(force=True, silent=True) or {}
    path = body.get("path")
    sheet = body.get("sheet")
    max_cols = _max_cols_for(body.get("mode"))
    sort_id = _sort_for(body.get("mode"))
    validate_audit = _validate_for(body.get("mode"))
    if not path:
        return fail("Missing path.")
    try:
        load_tabular(Path(path), sheet, max_cols, sort_id, validate_audit)
    except ValueError as exc:
        return fail(str(exc))
    return ok(loaded=True, status=status_payload())


@files_bp.route("/recent")
def recent():
    # Per-session recent files (in memory) — never another session's.
    return ok(recent=store.recent_files())


@files_bp.route("/close", methods=["POST"])
def close_file():
    """Clear the currently loaded file so the next one can be opened."""
    store.reset()
    return ok(status=status_payload())


@files_bp.route("/downloads")
def downloads():
    """List files previously exported/downloaded (newest first) so they can
    be re-downloaded later for easy, future access."""
    from config import config
    items = []
    for area in ("exports", "reports"):
        base = getattr(config, f"{area[:-1]}_dir", None) or (config.base_dir / area)
        # Only this session's own generated files (its private subfolder).
        d = file_utils.session_subdir(base)
        try:
            entries = list(d.iterdir())
        except Exception:
            entries = []
        for p in entries:
            if not p.is_file() or p.name.startswith("."):
                continue
            try:
                st = p.stat()
            except OSError:
                continue
            items.append({"name": p.name, "ts": st.st_mtime,
                          "size": st.st_size, "area": area,
                          "url": f"/download/{area}/{p.name}"})
    items.sort(key=lambda x: x["ts"], reverse=True)
    return ok(downloads=items[:50])


@files_bp.route("/folder", methods=["POST"])
def folder():
    body = request.get_json(force=True, silent=True) or {}
    items = file_utils.list_folder(body.get("folder", ""))
    return ok(items=items)


# --------------------------------------------------------------------------
# Grid data: columns / rows (infinite model) / edits / undo-redo
# --------------------------------------------------------------------------
@data_bp.route("/columns")
def columns():
    if not store.loaded:
        return ok(columns=[])
    return ok(columns=column_defs(store.df), names=data_columns(store.df))


@data_bp.route("/validate-wcag", methods=["POST"])
def validate_wcag():
    """Validate the WCAG Ref, WCAG (name) and WCAG Ver (level) columns against
    the bundled wcag_tags.txt. Flags rows where any of the three is empty (not
    filled) or doesn't match the tag file, and returns the specific mismatches.
    Used by the delivery editor (placeholder 3) to colour rows live + show errors."""
    if not store.loaded:
        return ok(ids=[], count=0, active=False)
    import re as _re
    from services.feature_service import WCAG_TAGS, load_wcag_tags
    tags = load_wcag_tags(WCAG_TAGS)            # {sc: (name, level)}

    df = store.df
    names = [c for c in df.columns if c != ID_COL]

    def _find(*needles):
        for c in names:
            lc = str(c).strip().lower()
            if any(n in lc for n in needles):
                return c
        return None

    # WCAG Ref/SC, WCAG name, and WCAG Ver (level) columns.
    sc_col = _find("wcag ref", "wcag sc", "wcag criteria", "criterion", "success criteria")
    name_col = next((c for c in names if str(c).strip().lower() in ("wcag", "wcag name")), None)
    ver_col = _find("wcag ver", "wcag version", "wcag level", "conformance level")
    # A human-friendly row label (the audit 'ID' column, e.g. 'Issue - 07').
    id_col = next((c for c in names if str(c).strip().lower() == "id"), None)
    if not sc_col or not name_col or not tags:
        return ok(ids=[], count=0, active=False,
                  reason="no WCAG columns or tag file" if not tags else "no WCAG columns")

    def _sc(v):
        if v is None:
            return ""
        m = _re.search(r"(\d\.\d+\.\d+)", str(v))
        return m.group(1) if m else str(v).strip()

    def _level(v):
        # Normalise a level to A / AA / AAA from 'Level AA', 'AA', 'WCAG2AA', etc.
        s = _re.sub(r"\(.*?\)", "", str(v if v is not None else "")).strip().upper()
        m = _re.search(r"WCAG\d+\s*(A{1,3})$", s)
        if m:
            return m.group(1)
        m = _re.search(r"(?:LEVEL\s*)?(A{1,3})\s*$", s)
        return m.group(1) if m else ""

    # A WCAG Ver must be a clean, whole standard tag — e.g. 'WCAG2A', 'WCAG2AA',
    # 'WCAG21AA', 'WCAG22AA', 'Level AA' or just 'AA'. Anchored so junk like
    # 'yuiWCAG2A' or 'WCAG2AAAAA' (a typo) is rejected instead of being silently
    # reduced to a valid-looking level.
    _ver_re = _re.compile(r"^(WCAG\s*\d{1,2}\s*A{1,3}|LEVEL\s*A{1,3}|A{1,3})$",
                          _re.IGNORECASE)

    def _valid_ver(v):
        s = _re.sub(r"\(.*?\)", "", str(v if v is not None else "")).strip()
        s = _re.sub(r"\s+", " ", s)
        return bool(_ver_re.match(s))

    sel = [ID_COL, sc_col, name_col] + ([ver_col] if ver_col else []) \
          + ([id_col] if id_col else [])
    rows = df.select(sel).to_dicts()

    def _filled(v):
        return str(v if v is not None else "").strip() != ""

    any_filled = any(_filled(r.get(sc_col)) or _filled(r.get(name_col))
                     or (ver_col and _filled(r.get(ver_col))) for r in rows)
    flagged, issues = [], []
    _LVL_RANK = {"a": 1, "aa": 2, "aaa": 3}
    for r in rows:
        sc = _sc(r.get(sc_col))
        sc_raw = str(r.get(sc_col) or "").strip()
        sc_filled = _filled(r.get(sc_col))
        name = str(r.get(name_col) or "").strip()
        ver = str(r.get(ver_col) or "").strip() if ver_col else ""
        # Each problem records the exact column it belongs to, so the UI can
        # show 'row + column + message'. `problems` stays a flat string list
        # (back-compat); `details` carries {col, msg} pairs.
        probs, details = [], []

        def _add(col, msg):
            probs.append(msg)
            details.append({"col": col, "msg": msg})

        # WCAG Ver: 'filled' + well-formed checks run regardless of the Ref, so a
        # malformed tag (e.g. 'yuiWCAG2A') is always caught.
        ver_ok = False
        if ver_col:
            if not ver:
                _add(ver_col, f"{ver_col} not filled")
            elif not _valid_ver(ver):
                _add(ver_col, f"'{ver}' is not valid "
                              f"(expected e.g. WCAG2AA / WCAG22AA / Level AA)")
            else:
                ver_ok = True
        # WCAG Ref must be ONLY a valid WCAG criterion number from the tag
        # dataset — flag the word 'Ref' (or any non-criterion text) and any
        # value that isn't a known criterion.
        if sc_filled and _re.search(r"(?i)\bref\b", sc_raw):
            _add(sc_col, "remove 'Ref' — the WCAG Ref must contain only the "
                         "criterion number (e.g. 1.3.1)")
        if not sc_filled:
            _add(sc_col, f"{sc_col} not filled")
        # The WHOLE cell must be a valid criterion from the tag dataset — not
        # merely contain one (so '1.4.3hhj', '1.4.3 foo', 'Ref: 1.4.3' all fail).
        elif sc_raw not in tags:
            _add(sc_col, f"'{sc_raw}' is not a valid WCAG criterion "
                         f"(must be exactly a tag from the WCAG dataset, e.g. 1.4.3)")
        else:
            canon_name, canon_level = tags[sc_raw]
            if not name:
                _add(name_col, f"{name_col} not filled")
            elif name.lower() != canon_name.lower():
                _add(name_col, f"should be '{canon_name}'")
            # Level: the stated conformance level must be AT LEAST the criterion's
            # level (an AA audit legitimately covers Level-A criteria, etc.).
            vl, cl = _level(ver).lower(), _level(canon_level).lower()
            if (ver_col and ver_ok and vl and cl
                    and _LVL_RANK.get(vl, 0) < _LVL_RANK.get(cl, 0)):
                _add(ver_col, f"should be at least {canon_level}")
        if probs:
            flagged.append(int(r[ID_COL]))
            row_label = str(r.get(id_col) or "").strip() if id_col else ""
            issues.append({"id": int(r[ID_COL]), "row": row_label,
                           "ref": sc or "(blank)", "problems": probs,
                           "details": details})
    # ---- Additional placeholder-3 spec checks (Excel errors, Priority/Severity,
    # fixed constants). These surface in the SAME Issues panel and run on every
    # row regardless of whether the WCAG columns are filled. ------------------
    from services.feature_service import EXCEL_ERROR_VALUES
    _errset = {e.upper() for e in EXCEL_ERROR_VALUES}

    def _exact(label):
        for c in names:
            if str(c).strip().lower() == label:
                return c
        return None

    prio_col = _exact("priority")
    sev_col = _exact("severity")
    cat_col = _exact("issue category")
    comp_col = _exact("component")
    issue_col = _exact("issue")
    summary_col2 = _exact("summary")
    desc_col = _exact("description")
    url_col = _exact("issue url")
    element_col = _exact("element")
    rootcause_col = _exact("root cause")
    fixowner_col = _exact("fix owner")
    resolution_col = _exact("resolution")
    wcagref_col = _exact("wcag ref")
    wcagname_col = _exact("wcag")

    import re as _re
    # Pull each labelled value out of the Description (T) so it can be compared
    # to its source column. Robust to either the multi-line generated format OR
    # a single-line version (some grid editors collapse newlines on edit): each
    # field is captured up to the NEXT known label.
    def _desc_field(text, pattern):
        m = _re.search(pattern, text, _re.DOTALL | _re.IGNORECASE)
        if not m:
            return None
        val = (m.group(1) or "").strip()
        # collapse internal whitespace/newlines a grid edit may have introduced
        val = _re.sub(r"\s+", " ", val).strip()
        return "" if val.lower() == "none" else val

    _DESC_PATTERNS = {
        "issue_category": r"Issue Type:\s*(.*?)\s*Component:",
        "component":      r"\bComponent:\s*(.*?)\s*URL:",
        "url":            r"\bURL:\s*(.*?)\s*Element:",
        "element":        r"\bElement:\s*(.*?)\s*(?:Selector:|WHERE TO FIX|$)",
        "ruleid":         r"\bRule ID:\s*(.*?)\s*Impact:",
        "root_cause":     r"(?:^|\n|\s)Issue:\s*(.*?)\s*Help:",
    }

    # The digital-asset Description is the labelled-section format:
    #   "Issue Type:\n<v>\n\nRoot Cause:\n<v>\n\nIssue:\n<v>\n\n…WCAG:\n<v>".
    # Split it into {label: value} so each section can be matched to its column.
    _LABELLED_SPLIT = _re.compile(
        r"(?im)^[ \t]*(Issue Type|Root Cause|Issue|Element|Resolution|Fix Owner|"
        r"WCAG Ref|WCAG)[ \t]*:[ \t]*\r?\n?")

    def _parse_labelled(text):
        parts = _LABELLED_SPLIT.split(text)
        out, it = {}, iter(parts[1:])  # parts[0] is any preamble
        for label in it:
            val = next(it, "")
            if label not in out:               # keep the FIRST occurrence
                out[label] = val.strip()
        return out

    def _norm_ws(s):
        return _re.sub(r"\s+", " ", str(s or "")).strip()

    CONSTS = [(_exact("fix owner"), "Vendor"), (_exact("verified"), "Pending"),
              (_exact("project key"), "PSGIN"), (_exact("issue type"), "Bug"),
              (_exact("assignee"), "kevin.murphy@ascendlearning.com")]
    VALID_PRIO = {"P1 - Immediate", "P2 - High", "P3 - Medium", "P4 - Low"}
    PAIR = {"P1 - Immediate": "1 - Urgent", "P2 - High": "2 - High",
            "P3 - Medium": "3 - Medium", "P4 - Low": "4 - Low"}

    # Parent (W) must be the SAME value on every row. Establish the consensus
    # (the most common non-empty value) and flag any row that differs from it.
    parent_col = _exact("parent")
    parent_consensus = None
    if parent_col:
        from collections import Counter
        pvals = [str(r.get(parent_col) or "").strip()
                 for r in df.to_dicts()]
        nonblank = [v for v in pvals if v]
        if nonblank:
            parent_consensus = Counter(nonblank).most_common(1)[0][0]

    issue_by_id = {it["id"]: it for it in issues}
    extra_flagged = set()
    for _pos, r in enumerate(df.to_dicts(), start=1):
        rid = int(r[ID_COL])
        rprobs = []
        # 1) Excel error literals in ANY cell
        for c in names:
            v = str(r.get(c) if r.get(c) is not None else "").strip().upper()
            if v in _errset:
                rprobs.append((c, f"contains an Excel error value '{v}'"))
        # 2) Priority valid + Priority/Severity aligned
        if prio_col:
            pv = str(r.get(prio_col) or "").strip()
            if pv and pv not in VALID_PRIO:
                rprobs.append((prio_col, f"'{pv}' is not a valid Priority (P1-P4)"))
            elif pv and sev_col:
                sv = str(r.get(sev_col) or "").strip()
                if sv and PAIR.get(pv) != sv:
                    rprobs.append((sev_col,
                                   f"Severity '{sv}' should be '{PAIR.get(pv)}' for {pv}"))
        # 3) Fixed constants
        for col, want in CONSTS:
            if col:
                cv = str(r.get(col) or "").strip()
                if cv and cv != want:
                    rprobs.append((col, f"should be '{want}'"))
        # 4) Parent (W) must match the consensus value on every row
        if parent_col and parent_consensus is not None:
            wv = str(r.get(parent_col) or "").strip()
            if wv != parent_consensus:
                if wv == "":
                    rprobs.append((parent_col,
                                   f"Parent is blank — should be '{parent_consensus}' (same on all rows)"))
                else:
                    rprobs.append((parent_col,
                                   f"Parent '{wv}' differs from the rest — should be '{parent_consensus}' (same on all rows)"))
        # 5) Summary (S) must equal "<ID> - <Issue Category> - <Component> - <Issue>"
        if summary_col2:
            a_val = str(r.get(id_col) or "").strip() if id_col else ""
            c_val = str(r.get(cat_col) or "").strip() if cat_col else ""
            e_val = str(r.get(comp_col) or "").strip() if comp_col else ""
            # Component (E) may carry a query string after '?'. The Summary is
            # built from the part BEFORE '?', so compare against that — but the
            # stored E cell is left exactly as-is (not modified here).
            e_val_for_summary = e_val.split("?")[0].strip()
            g_val = str(r.get(issue_col) or "").strip() if issue_col else ""
            expected_s = f"{a_val} - {c_val} - {e_val_for_summary} - {g_val}"
            actual_s = str(r.get(summary_col2) or "").strip()
            if actual_s and actual_s != expected_s:
                rprobs.append((summary_col2,
                               f"should be '{expected_s}' "
                               f"(ID - Issue Category - Component - Issue)"))
        # 6) ID (A) sequential: row N should be "Issue - {N:02d}" (catches
        #    out-of-order and missing numbers, highlighting the exact row).
        if id_col:
            a_val = str(r.get(id_col) or "").strip()
            expected_id = f"Issue - {_pos:02d}"
            if a_val and a_val != expected_id:
                rprobs.append((id_col,
                               f"out of sequence — should be '{expected_id}'"))
        # 7) Description (T) must keep the generated HOW TO FIND / HOW TO FIX
        #    template AND its placeholders must match their source columns:
        #    Issue Type->C, Component->E (ignore '?'-tail), URL->I, Element->H,
        #    Rule ID->G (Issue), Issue->D (Root Cause).
        #
        #    This runs on EVERY non-trivial row (not only when "HOW TO FIND" is
        #    intact) so that edits which BREAK the Description are caught too:
        #      * the template was replaced with free text / blanked out,
        #      * a whole placeholder line was deleted,
        #      * a placeholder value was cleared while its column still has one,
        #      * a placeholder value was changed so it no longer matches.
        if desc_col:
            t_text = str(r.get(desc_col) or "")
            t_stripped = t_text.strip()
            t_upper = t_text.upper()

            def _cell(col):
                return str(r.get(col) or "").strip() if col else ""

            # Column H (Element) may store "element [selector]"; the
            # Description's Element line shows only the element. Strip a
            # trailing bracketed selector from H for the comparison.
            h_val = _cell(element_col)
            h_for_desc = _re.sub(r"\s*\[[^\[]*\]\s*$", "", h_val).strip()
            # (label, pattern-key, expected source value, source-column label)
            field_specs = [
                ("Issue Type", "issue_category", _cell(cat_col), "Issue Category (C)"),
                ("Component", "component", _cell(comp_col).split("?")[0].strip(), "Component (E)"),
                ("URL", "url", _cell(url_col), "Issue URL (I)"),
                ("Element", "element", h_for_desc, "Element (H)"),
                ("Rule ID", "ruleid", _cell(issue_col), "Issue (G)"),
                ("Issue", "root_cause", _cell(rootcause_col), "Root Cause (D)"),
            ]
            # Does this row carry the issue data the template is built from? If
            # so, a missing/free-text/blank Description means its required
            # placeholders are gone and must be flagged.
            has_source = any(val for _, _, val, _ in field_specs)
            # The generated Description always ends with a "Fix Owner: / WCAG
            # Ref: / WCAG:" tail; rows without a help URL legitimately carry
            # ONLY that tail (no HOW TO FIND/FIX block), so don't treat those
            # as broken.
            has_tail = "FIX OWNER:" in t_upper and "WCAG REF:" in t_upper
            # Digital-asset labelled format (Issue Type / Root Cause / Issue /
            # Element / Resolution / Fix Owner / WCAG Ref / WCAG sections). It is
            # detected FIRST and takes precedence: these rows begin with a
            # "HOW TO FIND:" header too, so the labelled markers (Root Cause +
            # Resolution sections) are what distinguish them from the placeholder-2
            # structured format.
            labelled = (has_tail and "ISSUE TYPE:" in t_upper
                        and "ROOT CAUSE:" in t_upper and "RESOLUTION:" in t_upper)
            structured = (not labelled
                          and ("HOW TO FIND" in t_upper or "RULE ID:" in t_upper))

            # Every Description message ends with the SAME "should be '<value>'"
            # phrasing the Summary (S) check uses, and names the exact line, its
            # current value, the expected value and the source column — so the
            # Issues column reads as a clear, actionable instruction.
            if not t_stripped:
                if has_source:
                    rprobs.append((desc_col,
                        "Description is empty — should be the HOW TO FIND / "
                        "HOW TO FIX template echoing the row's Issue Category, "
                        "Component, Issue URL, Element, Issue and Root Cause"))
            elif labelled:
                # Must START with the 'HOW TO FIND:' header — any stray text
                # before it (e.g. a typo'd character) is flagged.
                _m = _re.search(r"Issue Type\s*:", t_stripped, _re.IGNORECASE)
                head = t_stripped[:_m.start()] if _m else ""
                if not _re.fullmatch(r"HOW TO FIND\s*:", _norm_ws(head), _re.IGNORECASE):
                    rprobs.append((desc_col,
                        "Description must start with 'HOW TO FIND:' — found "
                        f"'{_norm_ws(head)[:40] or '(nothing)'}'"))
                # Each labelled section must match its source column. WCAG is
                # rendered '<SC> <name>' (SC from WCAG Ref), the rest echo their
                # column verbatim (whitespace-normalised for the comparison).
                parsed = _parse_labelled(t_text)
                _scm = _re.search(r"(\d\.\d+\.\d+)", _cell(wcagref_col))
                _wname = _cell(wcagname_col)
                _wexp = (f"{_scm.group(1)} {_wname}".strip()) if _scm else _wname
                lab_specs = [
                    ("Issue Type", _cell(cat_col), "Issue Category (C)"),
                    ("Root Cause", _cell(rootcause_col), "Root Cause (D)"),
                    ("Issue", _cell(issue_col), "Issue (G)"),
                    ("Element", h_for_desc, "Element (H)"),
                    ("Resolution", _cell(resolution_col), "Resolution (J)"),
                    ("Fix Owner", _cell(fixowner_col), "Fix Owner (K)"),
                    ("WCAG Ref", _cell(wcagref_col), "WCAG Ref (N)"),
                    ("WCAG", _wexp, "WCAG (O)"),
                ]
                for label, want, colname in lab_specs:
                    if not want:
                        continue
                    got = parsed.get(label)
                    if got is None:
                        rprobs.append((desc_col,
                            f"Description is missing the \"{label}:\" section — "
                            f"should be '{want}' (from {colname})"))
                    elif _norm_ws(got) != _norm_ws(want):
                        shown = _norm_ws(got)
                        shown = shown if len(shown) <= 80 else shown[:80] + "…"
                        rprobs.append((desc_col,
                            f"Description \"{label}:\" is '{shown}' — should be "
                            f"'{want}' (from {colname})"))
            elif not structured:
                # Non-empty but the template was removed. Skip the rare, legit
                # "tail only" rows (no source detail block) to avoid false flags.
                if has_source and not has_tail:
                    rprobs.append((desc_col,
                        "Description doesn't follow the required template — "
                        "should be the HOW TO FIND / HOW TO FIX format with the "
                        "Issue Category, Component, Issue URL, Element, Issue and "
                        "Root Cause placeholders"))
            else:
                # Structured: both sections must be present...
                if "HOW TO FIND" not in t_upper:
                    rprobs.append((desc_col,
                        "Description is missing the 'HOW TO FIND' section — "
                        "should include a 'HOW TO FIND -' block"))
                if "HOW TO FIX" not in t_upper:
                    rprobs.append((desc_col,
                        "Description is missing the 'HOW TO FIX' section — "
                        "should include a 'HOW TO FIX -' block"))
                # ...and each placeholder must be PRESENT, non-blank and matching
                # whenever its source column has a value to echo.
                for label, key, in_col, colname in field_specs:
                    if not in_col:
                        continue  # nothing required for this field on this row
                    in_desc = _desc_field(t_text, _DESC_PATTERNS[key])
                    if in_desc is None:
                        rprobs.append((desc_col,
                            f"Description is missing the \"{label}\" line — "
                            f"should be '{in_col}' (from {colname})"))
                        continue
                    if in_desc == "":
                        rprobs.append((desc_col,
                            f"Description \"{label}\" line is blank — "
                            f"should be '{in_col}' (from {colname})"))
                        continue
                    norm_col = _re.sub(r"\s+", " ", in_col).strip()
                    if label == "Element":
                        # Column H may be "element [selector]"; the Description
                        # shows only the element. It's a match if H begins with
                        # the Description's element (handles selectors that
                        # themselves contain brackets).
                        if norm_col == in_desc or norm_col.startswith(in_desc):
                            continue
                    elif in_desc == norm_col:
                        continue
                    rprobs.append((desc_col,
                                   f"Description \"{label}\" line is '{in_desc}' — "
                                   f"should be '{in_col}' (from {colname})"))
                # Tail AFTER 'HOW TO FIX' (Fix Owner / WCAG Ref / WCAG) must also
                # match its columns, so an edit there is flagged too. (The tail
                # echoes columns as "Ref:<N>" and "<N> <O>".)
                tail = _parse_labelled(t_text)

                def _crit(s):
                    # criterion number if present, else the text with a leading
                    # 'Ref:' stripped — so 'Ref:1.4.3' matches the '1.4.3' column.
                    m = _re.search(r"(\d\.\d+\.\d+)", str(s or ""))
                    if m:
                        return m.group(1)
                    return _norm_ws(_re.sub(r"(?i)^\s*ref\s*:?\s*", "", str(s or "").strip()))

                _foK = _cell(fixowner_col)
                if _foK and tail.get("Fix Owner") is not None \
                        and _norm_ws(tail["Fix Owner"]) != _norm_ws(_foK):
                    rprobs.append((desc_col, f"Description 'Fix Owner:' is "
                        f"'{_norm_ws(tail['Fix Owner'])[:40]}' — should be "
                        f"'{_foK}' (from Fix Owner (K))"))
                # WCAG Ref / WCAG tail only when THIS row's criterion is a real
                # WCAG tag (rows like 'Best Practice' are already flagged on the
                # column). NOTE: compute the value for the current row — `sc_raw`
                # above belongs to the earlier WCAG-columns loop.
                if sc_col and str(r.get(sc_col) or "").strip() in tags:
                    _refN = _cell(wcagref_col)
                    if _refN and tail.get("WCAG Ref") is not None \
                            and _crit(tail["WCAG Ref"]) != _crit(_refN):
                        rprobs.append((desc_col, f"Description 'WCAG Ref:' is "
                            f"'{_norm_ws(tail['WCAG Ref'])[:40]}' — should match the "
                            f"criterion '{_refN}' (from WCAG Ref (N))"))
                    _wexp = _norm_ws(f"{_refN} {_cell(wcagname_col)}")
                    if _refN and tail.get("WCAG") is not None \
                            and _norm_ws(tail["WCAG"]) != _wexp:
                        rprobs.append((desc_col, f"Description 'WCAG:' is "
                            f"'{_norm_ws(tail['WCAG'])[:40]}' — should be "
                            f"'{_wexp}' (from WCAG Ref + WCAG)"))
        if rprobs:
            extra_flagged.add(rid)
            it = issue_by_id.get(rid)
            if it is None:
                row_label = str(r.get(id_col) or "").strip() if id_col else ""
                it = {"id": rid, "row": row_label,
                      "ref": _sc(r.get(sc_col)) or "(blank)",
                      "problems": [], "details": []}
                issue_by_id[rid] = it
                issues.append(it)
            for col, msg in rprobs:
                it["problems"].append(msg)
                it["details"].append({"col": col, "msg": msg})
    for rid in extra_flagged:
        if rid not in flagged:
            flagged.append(rid)

    active = any_filled or bool(extra_flagged)
    if not active:
        flagged, issues = [], []
    return ok(ids=flagged, count=len(flagged), active=active, issues=issues[:50],
              sc_col=sc_col, name_col=name_col, ver_col=ver_col)


@data_bp.route("/check-id-sequence", methods=["GET"])
def check_id_sequence():
    """Check the first column's numbering (placeholders 1 + 3):

      * It should run 1, 2, 3 … N with no gaps — any missing number is reported.
      * Duplicated numbers are reported too.
      * Delivery (placeholder 3): the first-column number on each row must match
        the number at the start of that row's 'Summary' cell — mismatches are
        reported.

    Only 'active' when the first column actually looks like a numeric sequence,
    so non-numeric data (e.g. a merged report's text first column) is ignored."""
    import re as _re
    if not store.loaded:
        return ok(active=False)
    df = store.df
    names = [c for c in df.columns if c != ID_COL]
    if not names or df.height == 0:
        return ok(active=False)
    first_col = names[0]

    def _num(v):
        s = str(v if v is not None else "").strip()
        if not s:
            return None
        m = _re.search(r"(\d+)\s*$", s) or _re.search(r"(\d+)", s)
        return int(m.group(1)) if m else None

    first_vals = df.get_column(first_col).to_list()
    nums = [_num(v) for v in first_vals]
    non_empty = [v for v in first_vals if str(v if v is not None else "").strip()]
    numeric = [n for n in nums if n is not None]
    # Treat the first column as a sequence only if it is mostly numbers.
    active = len(numeric) >= 2 and len(numeric) >= 0.6 * max(1, len(non_empty))
    if not active:
        return ok(active=False, first_col=first_col)

    from collections import Counter
    counts = Counter(numeric)
    present = sorted(counts)
    hi = present[-1]
    missing = [n for n in range(1, hi + 1) if n not in counts]
    duplicates = sorted(n for n, k in counts.items() if k > 1)

    # Delivery: first-column number vs the leading number in 'Summary'.
    summary_col = next((c for c in names if str(c).strip().lower() == "summary"), None)
    mismatches = []
    if summary_col:
        for r in df.select([ID_COL, first_col, summary_col]).to_dicts():
            idn = _num(r.get(first_col))
            sraw = str(r.get(summary_col) or "")
            sm = _re.search(r"\d+", sraw)
            snum = int(sm.group(0)) if sm else None
            if idn is not None and snum is not None and idn != snum:
                mismatches.append({
                    "id": int(r[ID_COL]),
                    "row": str(r.get(first_col) or "").strip(),
                    "id_num": idn, "summary_num": snum,
                })

    return ok(active=True, first_col=first_col, summary_col=summary_col,
              count=len(numeric), max=hi, missing=missing,
              duplicates=duplicates, mismatches=mismatches[:200])


@data_bp.route("/issues-pdf", methods=["POST"])
def issues_pdf():
    """Download the current Issues panel (WCAG/Description/spec problems +
    first-column numbering) as a PDF. Recomputes the checks server-side so the
    PDF always matches what the panel shows."""
    if not store.loaded:
        return fail("No dataset loaded.")

    # Reuse the authoritative checks (these views ignore the request body).
    wj = validate_wcag().get_json() or {}
    issues = (wj.get("issues") or []) if wj.get("active") else []
    nj = check_id_sequence().get_json() or {}

    # Flatten one row per (row, column, problem) — mirrors the panel layout.
    flat: list[dict] = []
    for it in issues:
        row_label = it.get("row") or (
            it.get("ref") if it.get("ref") not in (None, "", "(blank)")
            else f"#{it.get('id')}")
        details = it.get("details") or [
            {"col": "", "msg": p} for p in (it.get("problems") or [])]
        for d in details:
            flat.append({"row": row_label, "col": d.get("col") or "—",
                         "msg": d.get("msg") or ""})

    try:
        path = export_service.export_issues_pdf(
            flat, nj, file_name=store.meta.name, stem="issues_report")
    except Exception as exc:  # noqa: BLE001
        log.exception("issues-pdf failed")
        return fail(f"Could not build the Issues PDF: {exc}")
    return ok(file=path.name, url=f"/download/reports/{path.name}",
              count=len(flat))


# NOTE: the WCAG / axe "Help" lookup endpoints now live in their own
# self-contained module — see help_lookup/ (mounted at /api/help).


@data_bp.route("/rows", methods=["POST"])
def rows():
    if not store.loaded:
        return ok(rows=[], lastRow=0)
    body = request.get_json(force=True, silent=True) or {}
    start = int(body.get("startRow", 0))
    end = int(body.get("endRow", config.page_size_default))
    end = min(end, start + config.page_size_max)
    page = store.query_page(
        start, end,
        sort_model=body.get("sortModel"),
        search=body.get("search"),
        search_columns=body.get("searchColumns"),
        search_mode=body.get("searchMode", "contains"),
        blanks_only=bool(body.get("blanksOnly")),
    )
    return ok(**page)


@data_bp.route("/blanks", methods=["GET"])
def blanks():
    """List rows that contain blank (null/empty) cells, with the blank column
    names per row. Powers the delivery editor's "Blanks" button + count badge so
    users can find and fill the gaps that block an export."""
    if not store.loaded:
        return ok(count=0, cells=0, rows=[], col_names=[])
    df = store.df
    names = [c for c in df.columns if c != ID_COL]
    id_col = next((c for c in names if str(c).strip().lower() == "id"), None)
    rows = df.select([ID_COL] + names).to_dicts()

    def _blank(v):
        return str(v if v is not None else "").strip() == ""

    out, total_cells = [], 0
    for r in rows:
        blank_cols = [c for c in names if _blank(r.get(c))]
        if blank_cols:
            total_cells += len(blank_cols)
            out.append({
                "id": int(r[ID_COL]),
                "row": str(r.get(id_col) or "").strip() if id_col else "",
                "cols": blank_cols,
            })
    return ok(count=len(out), cells=total_cells, rows=out[:1000], col_names=names)


# Placeholder 1 "Alert" — component names AND their individual keywords to watch
# for in the merged data. A warning fires when the FULL component name appears
# (e.g. "Knowledge Check") and ALSO when any single keyword appears on its own
# (e.g. "KNOWLEDGE"). The full names are listed first so they read as the
# primary component, followed by the standalone keywords.
_ALERT_COMPONENTS = [
    "Flashcards", "TestPrep", "Knowledge Check", "Math Review Module",
    "Virtual Mentor Lectures", "Final Exam", "Chapter Quizzes",
    "Soft-Skill Simulations", "Virtual Patient Cases",
    "Simulation Training Support and Scenarios",
]
_ALERT_KEYWORDS = [
    "Knowledge", "Check", "Math", "Review", "Module", "Virtual", "Mentor",
    "Lectures", "Final", "Exam", "Chapter", "Quizzes", "Soft-Skill",
    "Simulations", "Patient", "Cases", "Simulation", "Training", "Support",
    "Scenarios",
]
ALERT_TERMS = [
    {"label": _w, "term": _w.lower()}
    for _w in _ALERT_COMPONENTS + _ALERT_KEYWORDS
]
# Whole-word, case-insensitive matchers with flexible internal whitespace: a
# multi-word name matches across single/multiple spaces or line breaks, and a
# single keyword never fires inside a larger word ('exam' in 'examine', 'support'
# in 'supported', 'math' in 'mathematics'). Compiled once at import; kept
# separate from ALERT_TERMS so that list stays JSON-serialisable for the API.
_ALERT_PATTERNS = [
    (t, re.compile(r"\b" + r"\s+".join(re.escape(p) for p in t["term"].split())
                   + r"\b", re.IGNORECASE))
    for t in ALERT_TERMS
]


@data_bp.route("/alert-terms", methods=["GET"])
def alert_terms():
    """Placeholder 1 "Alert": scan every data cell for the watched audit
    component names (Flashcards, TestPrep, Final Exam, …) and report each hit as
    (row, column, word, cell) so the auditor sees exactly where the component
    appears AND the complete contents of the cell it appears in."""
    if not store.loaded:
        return ok(count=0, scanned=0, hits=[], terms=ALERT_TERMS)
    df = store.df
    names = [c for c in df.columns if c != ID_COL]
    rows = df.select([ID_COL] + names).to_dicts()

    hits = []
    for pos, r in enumerate(rows, start=1):          # 1-based data row number
        for col in names:
            raw = r.get(col)
            cell = str(raw if raw is not None else "")
            if not cell.strip():
                continue
            for t, pat in _ALERT_PATTERNS:
                if pat.search(cell):
                    hits.append({
                        "id": int(r[ID_COL]),
                        "row": pos,
                        "col": col,
                        "word": t["label"],
                        "term": t["term"],
                        # the COMPLETE cell contents, verbatim (line breaks kept;
                        # only surrounding whitespace trimmed) so nothing is lost
                        "cell": cell.strip(),
                    })
    return ok(count=len(hits), scanned=len(rows), hits=hits[:5000], terms=ALERT_TERMS)


@data_bp.route("/cell", methods=["POST"])
def update_cell():
    body = request.get_json(force=True, silent=True) or {}
    try:
        store.update_cell(int(body["id"]), body["field"], body.get("value"))
    except (KeyError, ValueError) as exc:
        return fail(str(exc))
    return ok(status=status_payload())


@data_bp.route("/add-row", methods=["POST"])
def add_row():
    if not store.loaded:
        return fail("No dataset loaded.")
    new_id = store.add_row()
    return ok(id=new_id, status=status_payload())


@data_bp.route("/delete-rows", methods=["POST"])
def delete_rows():
    body = request.get_json(force=True, silent=True) or {}
    ids = [int(i) for i in body.get("ids", [])]
    if not ids:
        return fail("No rows selected.")
    removed = store.delete_rows(ids)
    return ok(removed=removed, status=status_payload())


@data_bp.route("/duplicate-rows", methods=["POST"])
def duplicate_rows():
    body = request.get_json(force=True, silent=True) or {}
    ids = [int(i) for i in body.get("ids", [])]
    if not ids:
        return fail("No rows selected.")
    added = store.duplicate_rows(ids)
    return ok(added=added, status=status_payload())


@data_bp.route("/undo", methods=["POST"])
def undo():
    desc = store.undo()
    if desc is None:
        return fail("Nothing to undo.")
    return ok(description=desc, status=status_payload())


@data_bp.route("/redo", methods=["POST"])
def redo():
    desc = store.redo()
    if desc is None:
        return fail("Nothing to redo.")
    return ok(description=desc, status=status_payload())


# --------------------------------------------------------------------------
# Check: validation + duplicates
# --------------------------------------------------------------------------
@check_bp.route("/validate", methods=["POST"])
def validate():
    if not store.loaded:
        return fail("No dataset loaded.")
    body = request.get_json(force=True, silent=True) or {}
    report = validators.validate(store.df, body.get("rules"))
    return ok(report=report)


@check_bp.route("/validate/errors")
def validate_errors():
    if not store.loaded:
        return fail("No dataset loaded.")
    rows_ = validators.error_rows(store.df)
    return ok(rows=rows_, count=len(rows_))


@check_bp.route("/duplicates", methods=["POST"])
def duplicates():
    if not store.loaded:
        return fail("No dataset loaded.")
    body = request.get_json(force=True, silent=True) or {}
    result = validators.find_duplicates(store.df, body.get("columns"))
    # Group matching rows together: bring duplicate rows to the top, ordered by
    # group, so members of the same group are adjacent in the grid.
    dup_ids = result.get("duplicate_ids") or []
    if dup_ids:
        store.reorder_by_ids(dup_ids)
    # Remember the group of each row so an export can colour the groups.
    store.set_duplicate_groups(result.get("groups"))
    return ok(result=result, regrouped=bool(dup_ids))


@check_bp.route("/duplicates/drop", methods=["POST"])
def drop_duplicates():
    if not store.loaded:
        return fail("No dataset loaded.")
    body = request.get_json(force=True, silent=True) or {}
    new_df = validators.drop_duplicates(store.df, body.get("columns"))
    removed = store.df.height - new_df.height
    store.apply(new_df, "Drop duplicates")
    store.clear_duplicate_groups()
    return ok(removed=removed, status=status_payload())


# --------------------------------------------------------------------------
# Transform / bulk edit (single dispatch endpoint, supports preview)
# --------------------------------------------------------------------------
@transform_bp.route("/<op>", methods=["POST"])
def transform(op: str):
    if not store.loaded:
        return fail("No dataset loaded.")
    if op not in editor_services.TRANSFORMS:
        return fail(f"Unknown transform: {op}", 404)
    body = request.get_json(force=True, silent=True) or {}
    try:
        new_df, desc = editor_services.TRANSFORMS[op](store.df, body)
    except Exception as exc:  # noqa: BLE001
        return fail(f"Transform failed: {exc}")

    if body.get("preview"):
        prev = editor_services.transform_preview(store.df, new_df, body.get("columns"))
        return ok(preview=prev, description=desc)

    store.apply(new_df, desc)
    return ok(description=desc, status=status_payload())


# --------------------------------------------------------------------------
# Analytics
# --------------------------------------------------------------------------
@analytics_bp.route("/overview")
def an_overview():
    if not store.loaded:
        return fail("No dataset loaded.")
    return ok(overview=editor_services.analytics().overview(store.df))


@analytics_bp.route("/statistics")
def an_statistics():
    if not store.loaded:
        return fail("No dataset loaded.")
    return ok(statistics=editor_services.analytics().statistics(store.df))


@analytics_bp.route("/profile")
def an_profile():
    if not store.loaded:
        return fail("No dataset loaded.")
    return ok(profile=editor_services.analytics().column_profile(store.df))


@analytics_bp.route("/chart")
def an_chart():
    if not store.loaded:
        return fail("No dataset loaded.")
    column = request.args.get("column")
    if column:
        return ok(chart=editor_services.analytics().frequency(store.df, column))
    return ok(chart=editor_services.analytics().chart_data(store.df))


# --------------------------------------------------------------------------
# Export + reports
# --------------------------------------------------------------------------
@export_bp.route("/export/<fmt>", methods=["POST"])
def export(fmt: str):
    if not store.loaded:
        return fail("No dataset loaded.")
    stem = Path(store.meta.name).stem or "export"
    # Downloads contain real data only: drop rows that are entirely blank
    # (every cell null/empty). Rows with some empty cells are kept.
    export_df = drop_all_blank_rows(store.df, ID_COL)
    try:
        if fmt == "excel":
            body = request.get_json(silent=True) or {}
            # Two independent, optional highlights:
            #   • blank/empty cells in blue  (written by the xlsx writer)
            #   • long / multi-line Summary cells in yellow (post-processed)
            hl_blanks = bool(body.get("highlight_blanks"))
            hl_summary = bool(body.get("highlight_summary") or body.get("highlight"))
            hl_dups = bool(body.get("highlight_dups"))
            path = editor_services.export(export_df, "excel", stem, highlight=hl_blanks)
            if hl_summary:
                from services.excel_service import highlight_summary_cells
                highlight_summary_cells(path)
            if hl_dups:
                from services.excel_service import highlight_duplicate_rows
                # group index per row, aligned to the rows actually written
                groups = [store.dup_groups.get(int(r))
                          for r in export_df.get_column(ID_COL).to_list()]
                highlight_duplicate_rows(path, groups)
            from services.excel_service import trim_trailing_blank_rows
            trim_trailing_blank_rows(path)
        elif fmt in ("csv", "json", "pdf"):
            path = editor_services.export(export_df, fmt, stem)
        else:
            return fail(f"Unsupported export format: {fmt}", 404)
    except Exception as exc:  # noqa: BLE001
        log.exception("export failed")
        return fail(f"Export failed: {exc}")
    return ok(file=path.name, url=f"/download/exports/{path.name}",
              rows=export_df.height, cols=len(data_columns(export_df)))


@export_bp.route("/report/<kind>/<fmt>", methods=["POST"])
def report(kind: str, fmt: str):
    if not store.loaded:
        return fail("No dataset loaded.")
    if kind not in ("validation", "duplicate", "error", "summary"):
        return fail("Unknown report kind.", 404)
    try:
        path = editor_services.report(store.df, kind, fmt)
    except Exception as exc:  # noqa: BLE001
        log.exception("report failed")
        return fail(f"Report failed: {exc}")
    return ok(file=path.name, url=f"/download/reports/{path.name}")


# --------------------------------------------------------------------------
# PDF module
# --------------------------------------------------------------------------
@pdf_bp.route("/info")
def pdf_info():
    if store.meta.source != "pdf":
        return fail("No PDF loaded.")
    return ok(pdf_info=pdf_info_payload())


@pdf_bp.route("/text")
def pdf_text():
    if store.meta.source != "pdf":
        return fail("No PDF loaded.")
    page = request.args.get("page", type=int)
    pages = store.extra.get("text", [])
    if page:
        match = next((p for p in pages if p["page"] == page), None)
        return ok(text=match)
    return ok(pages=pages)


@pdf_bp.route("/search", methods=["POST"])
def pdf_search():
    if store.meta.source != "pdf":
        return fail("No PDF loaded.")
    from services import pdf_service
    body = request.get_json(force=True, silent=True) or {}
    term = body.get("term", "")
    if not term:
        return fail("Missing search term.")
    hits = pdf_service.search_text(store.extra.get("text", []), term)
    return ok(hits=hits, count=len(hits))


@pdf_bp.route("/load-table", methods=["POST"])
def pdf_load_table():
    if store.meta.source != "pdf":
        return fail("No PDF loaded.")
    body = request.get_json(force=True, silent=True) or {}
    page = int(body.get("page", -1))
    index = int(body.get("index", -1))
    tables = store.extra.get("tables", [])
    match = next((t for t in tables if t["page"] == page and t["index"] == index),
                 None)
    if match is None:
        return fail("Table not found.")
    extra = store.extra
    src_path = store.meta.path
    src_name = store.meta.name
    store.set_dataframe(match["frame"], FileMeta(
        path=src_path, name=f"{src_name} (p{page} t{index+1})",
        ext=".pdf", source="pdf-table"))
    store.extra = extra  # keep pdf payload so user can pick other tables
    return ok(loaded=True, status=status_payload())


@pdf_bp.route("/export-table", methods=["POST"])
def pdf_export_table():
    if store.meta.source not in ("pdf", "pdf-table"):
        return fail("No PDF loaded.")
    body = request.get_json(force=True, silent=True) or {}
    page = int(body.get("page", -1))
    index = int(body.get("index", -1))
    fmt = body.get("format", "excel")
    tables = store.extra.get("tables", [])
    match = next((t for t in tables if t["page"] == page and t["index"] == index),
                 None)
    if match is None:
        return fail("Table not found.")
    frame = match["frame"]
    stem = f"pdf_p{page}_t{index+1}"
    if fmt == "csv":
        path = export_service.export_csv(frame, stem)
    else:
        path = export_service.export_excel(frame, stem)
    return ok(file=path.name, url=f"/download/exports/{path.name}")
