"""Placeholder 3 — Validate / Generate Delivery Outputs (editor 'delivery' mode)."""
from __future__ import annotations
import re
from flask import Blueprint, render_template, request
from common.helpers import ok, fail, feature_response
from common.file_manager import save_uploads
from common.logger import get_logger
from services.store import store
from utils.helpers import ID_COL
from dashboards.dashboard3_delivery import services
from dashboards.dashboard3_delivery import constants as C

log = get_logger("sde.vpat_report")
vpat_report_bp = Blueprint(C.BLUEPRINT_NAME, __name__)


def _delivery_issue_block() -> str | None:
    """Return a user-facing message when the loaded delivery sheet still has ANY
    outstanding Issue (the same checks the Issues panel runs — WCAG / Summary /
    Description / fixed-value / Parent, plus ID numbering), else None. Used to
    refuse export until everything is resolved. Never raises."""
    try:
        from smart_editor.routes import validate_wcag, check_id_sequence
        vw = validate_wcag().get_json() or {}
        seq = check_id_sequence().get_json() or {}
    except Exception:  # noqa: BLE001
        return None  # don't block on an internal check failure
    n = int(vw.get("count") or 0)
    seq_problems = 0
    if seq.get("active"):
        seq_problems = (len(seq.get("missing") or []) + len(seq.get("duplicates") or [])
                        + len(seq.get("mismatches") or []))
    total = n + seq_problems
    if total > 0:
        return ("Cannot export — there are unresolved issues in the sheet. Open "
                "the 'Issues' panel, fix every item (WCAG / Summary / Description "
                "/ numbering / Parent), then export.")
    return None


@vpat_report_bp.route(C.PAGE_URL)
def page():
    from services import feature_service
    return render_template("index.html", mode="delivery", page_title=C.PAGE_TITLE,
                           template_found=feature_service.template_status()["found"])


@vpat_report_bp.route(C.API_VPAT, methods=["POST"])
def vpat():
    f = request.files.get("file")
    try:
        paths = save_uploads([f])
        outputs, stats, preview = services.report(paths[0])
    except ValueError as exc:
        return fail(str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("vpat failed")
        return fail(f"Report generation failed: {exc}")
    return feature_response(outputs, stats, preview)


@vpat_report_bp.route(C.API_ERRORS, methods=["GET"])
def delivery_errors():
    if not store.loaded:
        return fail("Open a workbook first.")
    df = store.df.select([c for c in store.df.columns if c != ID_COL])
    return ok(summary=services.delivery_summary(df))


@vpat_report_bp.route(C.API_PREPARE, methods=["POST"])
def delivery_prepare():
    if not store.loaded:
        return fail("Open a workbook first.")
    cleaned, blank_err = services.prepare_export(store.df)
    if blank_err:
        return fail(blank_err)
    if not cleaned.equals(store.df):
        store.apply(cleaned, "Delivery clean-up: fill Issue Category, "
                             "strip leading hyphen in Description")
        return ok(applied=True)
    return ok(applied=False)


@vpat_report_bp.route(C.API_IMPORT_ASSET, methods=["POST"])
def import_digital_asset():
    """With a delivery audit already loaded, pick a SEPARATE downloadables
    workbook and read its 'Counts by Type' sheet (rows 8/9 = PowerPoint/Word).
    Append the digital-asset template rows (Word + PowerPoint) to the END of the
    loaded dataset with Instances set to those counts (ID continues the sequence,
    Parent inherited, Fix Owner='Vendor', Verified='Pending'). Returns the
    counts. PDFs are intentionally not added."""
    if not store.loaded:
        return fail("Open a delivery workbook first, then import the digital asset.")
    f = request.files.get("file")
    if not f or not f.filename:
        return fail("Choose a workbook (.xlsx) with a 'Counts by Type' sheet.")
    # A valid URL is mandatory — validate it before any file parsing so a missing
    # or malformed URL is rejected immediately and nothing else is accepted.
    issue_url = (request.form.get("issue_url") or "").strip()
    if not issue_url:
        return fail("A URL is required to import a digital asset. Enter a valid "
                    "URL (e.g. https://example.com/…).")
    if not re.match(r"^https?://\S+\.\S+$", issue_url, re.IGNORECASE):
        return fail("The Issue URL must be a valid URL (e.g. https://example.com/…). "
                    "Only http:// or https:// URLs are accepted.")
    try:
        paths = save_uploads([f])               # extension check only; no format gate
    except ValueError as exc:
        return fail(str(exc))
    try:
        counts = services.read_counts_by_type(paths[0])
    except Exception as exc:  # noqa: BLE001
        log.exception("import-digital-asset: reading 'Counts by Type' failed")
        return fail(f"Could not read the 'Counts by Type' sheet: {exc}")
    if counts is None:
        return fail("No 'Counts by Type' sheet present in the selected file.")

    data = store.df.select([c for c in store.df.columns if c != ID_COL])
    parent_id = (request.form.get("parent_id") or "").strip() \
        or services.most_common_parent(data)
    start_seq = services.next_issue_seq(data)
    try:
        new_rows, used = services.build_digital_asset_rows(
            counts, data, parent_id=parent_id, start_seq=start_seq,
            issue_url=issue_url)
    except ValueError as exc:
        return fail(str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("import-digital-asset failed")
        return fail(f"Import failed: {exc}")

    if new_rows is None or new_rows.height == 0:
        return fail("The 'Counts by Type' sheet shows 0 Word and PowerPoint "
                    "documents — nothing to add.")
    added = store.append_rows(new_rows, "Import digital asset rows")
    return ok(added=added, counts=used, parent_id=parent_id)


@vpat_report_bp.route(C.API_IMPORT_ALT, methods=["POST"])
def import_alt_text():
    """Append the single alt-text boilerplate row to the END of the loaded
    dataset (ID continues the sequence, Parent inherited, Summary regenerated).
    No upload — the row's static content comes from Alt_Text_Template.xlsx."""
    if not store.loaded:
        return fail("Open a delivery workbook first, then import the alt text.")
    data = store.df.select([c for c in store.df.columns if c != ID_COL])
    parent_id = (request.form.get("parent_id") or "").strip() \
        or services.most_common_parent(data)
    start_seq = services.next_issue_seq(data)
    try:
        new_rows = services.build_alt_text_rows(data, parent_id=parent_id,
                                                start_seq=start_seq)
    except ValueError as exc:
        return fail(str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("import-alt-text failed")
        return fail(f"Import failed: {exc}")
    added = store.append_rows(new_rows, "Import alt text row")
    return ok(added=added, parent_id=parent_id)


@vpat_report_bp.route(C.API_CHECK_PARENT, methods=["GET"])
def check_parent():
    """Validate the loaded delivery sheet's Parent column (must be 'PSGIN-<ID>'
    and identical on every row). Returns the summary message plus the offending
    rows (with internal ids) so the editor can MARK them and list them in the
    Issues panel — no pop-up."""
    if not store.loaded:
        return ok(active=False, error="", ids=[], details=[])
    df = store.df.select([c for c in store.df.columns if c != ID_COL])
    err = services.validate_parent_column(df)
    details = services.parent_offending_rows(df)
    row_ids = store.df.get_column(ID_COL).to_list()
    for d in details:
        d["id"] = row_ids[d["index"]]
    ids = [d["id"] for d in details]
    return ok(active=bool(details), error=err or "", ids=ids, details=details)


@vpat_report_bp.route(C.API_EXPORT, methods=["POST"])
def export_template():
    if not store.loaded:
        return fail("Open a workbook first.")
    body = request.get_json(force=True, silent=True) or {}
    title = (body.get("title") or "").strip()
    course = (body.get("course") or "").strip()
    details = (body.get("details") or "").strip()
    df = store.df.select([c for c in store.df.columns if c != ID_COL])
    df, blank_err = services.prepare_export(df)
    if blank_err:
        return fail(blank_err)
    # Authoritative gate: refuse to export while ANY Issue remains (the same
    # checks shown in the Issues panel), so export only works once all are fixed.
    issue_err = _delivery_issue_block()
    if issue_err:
        return fail(issue_err)
    try:
        out, used = services.export_template(df, stem="delivery", title=title,
                                             course=course, details=details)
    except Exception as exc:  # noqa: BLE001
        log.exception("export-template failed")
        return fail(f"Template export failed: {exc}")
    return ok(file=out.name, url=f"/download/exports/{out.name}", template_used=used)
