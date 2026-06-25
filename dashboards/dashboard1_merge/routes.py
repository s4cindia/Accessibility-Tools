"""Placeholder 1 — Merge/Validate Axe Tool Excels (editor in 'merge' mode)."""
from __future__ import annotations
from flask import Blueprint, render_template, request
from common.helpers import ok, fail, feature_response, status_payload
from common.file_manager import save_uploads, load_tabular
from common.logger import get_logger
from dashboards.dashboard1_merge import converter
from dashboards.dashboard1_merge import constants as C

log = get_logger("sde.merge_axe")
merge_axe_bp = Blueprint(C.BLUEPRINT_NAME, __name__)


@merge_axe_bp.route(C.PAGE_URL)
def page():
    return render_template("index.html", mode="merge", page_title=C.PAGE_TITLE)


@merge_axe_bp.route(C.API_MERGE, methods=["POST"])
def merge_axe():
    files = request.files.getlist("files") or request.files.getlist("file")
    try:
        paths = save_uploads(files)
        outputs, stats, preview = converter.merge(paths)
    except ValueError as exc:
        return fail(str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("merge-axe failed")
        return fail(f"Merge failed: {exc}")
    return feature_response(outputs, stats, preview)


@merge_axe_bp.route(C.API_MERGE_OPEN, methods=["POST"])
def merge_open():
    files = request.files.getlist("files") or request.files.getlist("file")
    try:
        paths = save_uploads(files)
        outputs, stats, _preview = converter.merge(paths)
        merged_path = outputs[0][1]
        load_tabular(merged_path, sort_id=True)
    except ValueError as exc:
        return fail(str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("merge-open failed")
        return fail(f"Merge failed: {exc}")
    return ok(loaded=True, status=status_payload(), stats=stats,
              merged_file=merged_path.name,
              merge_url=f"/download/exports/{merged_path.name}")
