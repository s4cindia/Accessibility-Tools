"""Placeholder 4 — Generate Excel for downloadable documents."""
from __future__ import annotations
from flask import Blueprint, request
from common.helpers import fail, feature_response, render_operation
from common.file_manager import save_uploads
from common.logger import get_logger
from dashboards.dashboard4_downloadable import converter
from dashboards.dashboard4_downloadable import constants as C

log = get_logger("sde.downloadable")
downloadable_bp = Blueprint(C.BLUEPRINT_NAME, __name__)


@downloadable_bp.route(C.PAGE_URL)
def page():
    return render_operation(C.PAGE_SLUG)


@downloadable_bp.route(C.API_GENERATE, methods=["POST"])
def downloadable():
    f = request.files.get("file")
    parent_id = (request.form.get("parent_id") or "").strip()
    sheet = (request.form.get("sheet") or "").strip() or None
    try:
        paths = save_uploads([f])
        outputs, stats, preview = converter.generate(paths[0], parent_id=parent_id, sheet=sheet)
    except ValueError as exc:
        return fail(str(exc))
    except Exception as exc:  # noqa: BLE001
        log.exception("downloadable failed")
        return fail(f"Processing failed: {exc}")
    return feature_response(outputs, stats, preview)
