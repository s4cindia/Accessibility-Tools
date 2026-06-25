"""Placeholder 1 (merge axe exports) engine.

This placeholder's own working engine. Shared low-level primitives
(Excel read/write, WCAG tag-file, audit header template) are imported
from services.feature_service so they are defined once.
"""
from __future__ import annotations

import datetime as _dt
import re
from pathlib import Path

import polars as pl

from config import config
from services import export_service as _ex
from services.excel_service import read_sheet

from services.feature_service import (
    TEMPLATE_DIR, WCAG_TEMPLATE, WCAG_DELIVERY_TEMPLATE, WCAG_TAGS,
    list_sheets_for, template_status, audit_headers, validate_audit_columns,
    fill_issue_category, strip_description_hyphen, load_wcag_tags,
    EXCEL_ERROR_VALUES, _read_table, _find_col, _col_or_blank, _outpath, _ts,
    _slug, _preview, _exact_col, _category_from_issue, _excel_error_cells,
    _AUDIT_HEADERS_FALLBACK,
)


def merge_axe(paths: list[str | Path]) -> tuple[list, dict, dict]:
    if not paths:
        raise ValueError("No files were uploaded.")
    frames, per_file = [], []
    for p in paths:
        p = Path(p)
        try:
            df = _read_table(p)
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"Could not read '{p.name}': {exc}") from exc
        if df.height == 0 or df.width == 0:
            per_file.append({"file": p.name, "rows": 0, "note": "empty / skipped"})
            continue
        df = df.with_columns(pl.lit(p.name).alias("Source File"))
        frames.append(df)
        per_file.append({"file": p.name, "rows": df.height})
    if not frames:
        raise ValueError("None of the uploaded files contained any data rows.")

    merged = pl.concat(frames, how="diagonal_relaxed")
    cols = [c for c in merged.columns if c != "Source File"] + ["Source File"]
    merged = merged.select(cols)
    before = merged.height
    content_cols = [c for c in merged.columns if c != "Source File"]
    merged = merged.unique(subset=content_cols, keep="first", maintain_order=True)
    duplicates = before - merged.height

    out = _outpath(f"merged_axe_{_ts()}")
    from services.excel_service import write_excel, highlight_summary_cells
    write_excel(merged, out, sheet_name="Merged")
    # highlighting removed per request: highlight_summary_cells(out)

    stats = {
        "files_processed": len([f for f in per_file if f.get("rows")]),
        "files_total": len(paths),
        "total_rows_in": before,
        "duplicates_removed": duplicates,
        "final_rows": merged.height,
        "columns": merged.width,
        "per_file": per_file,
    }
    return [("Merged workbook", out)], stats, _preview(merged)
