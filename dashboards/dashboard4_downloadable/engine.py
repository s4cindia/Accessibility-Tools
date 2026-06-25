"""Placeholder 4 (downloadable audit) engine.

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


_DOC_TYPES = {".pdf": "PDF", ".doc": "Microsoft Word", ".docx": "Microsoft Word",
              ".ppt": "Microsoft PowerPoint", ".pptx": "Microsoft PowerPoint"}


_TYPE_KEYWORDS = [("pdf", "PDF"),
                  ("powerpoint", "Microsoft PowerPoint"),
                  ("pptx", "Microsoft PowerPoint"), ("ppt", "Microsoft PowerPoint"),
                  ("word", "Microsoft Word"), ("docx", "Microsoft Word"),
                  ("doc", "Microsoft Word")]


def _classify_doc(*values: str) -> str | None:
    blob = " ".join(v.lower() for v in values if v)
    for ext, friendly in _DOC_TYPES.items():
        if ext in blob:
            return friendly
    for kw, friendly in _TYPE_KEYWORDS:
        if kw in blob:
            return friendly
    return None


def downloadable_docs(path: str | Path, parent_id: str = "",
                      sheet: str | None = None) -> tuple[list, dict, dict]:
    # prefer a "Media Inventory" sheet when present (legacy behaviour)
    if sheet is None:
        for s in list_sheets_for(path):
            if "media" in s.lower() and "inventory" in s.lower():
                sheet = s
                break
    df = _read_table(path, sheet=sheet)
    if df.height == 0:
        raise ValueError("The media inventory sheet has no data rows.")

    url_c = _find_col(df, ["url", "location", "link", "href", "file", "filename",
                           "path", "document", "resource", "media url", "source"])
    name_c = _find_col(df, ["title", "name", "document name", "file name",
                            "filename", "asset"])
    type_c = _find_col(df, ["document type", "type", "format", "file type",
                            "extension", "mime", "kind", "category"])
    notes_c = _find_col(df, ["notes", "note", "comment", "remarks"])

    if url_c is None and type_c is None and name_c is None:
        raise ValueError(
            "Could not find a Title, Type or URL/Location column in the "
            "inventory. Found: " + ", ".join(df.columns[:12])
            + ("…" if df.width > 12 else "")
        )

    counts = {"PDF": 0, "Microsoft Word": 0, "Microsoft PowerPoint": 0}
    matched = []
    for r in df.to_dicts():
        url = str(r.get(url_c, "") or "") if url_c else ""
        name = str(r.get(name_c, "") or "") if name_c else ""
        typ = str(r.get(type_c, "") or "") if type_c else ""
        notes = str(r.get(notes_c, "") or "") if notes_c else ""
        friendly = _classify_doc(typ, url, name)
        if friendly:
            counts[friendly] = counts.get(friendly, 0) + 1
            matched.append({
                "Title": name or (url.rsplit("/", 1)[-1] if url else ""),
                "Document Type": friendly,
                "URL / Location": url,
                "Notes": notes,
                "Review Status": "Pending Review",
                "Parent ID": parent_id or "",
            })
    if not matched:
        raise ValueError("No PDF, Word or PowerPoint documents were found in "
                         "the inventory.")

    out_df = pl.DataFrame(
        [{"S.No": i + 1, **m} for i, m in enumerate(matched)]
    ).select(["S.No", "Title", "Document Type", "URL / Location", "Notes",
              "Review Status", "Parent ID"])

    stem = f"{_slug(parent_id)}_downloadable" if parent_id else f"downloadable_docs_{_ts()}"
    out = _outpath(stem)
    from services.excel_service import write_excel
    write_excel(out_df, out, sheet_name="Downloadable Docs")

    stats = {
        "inventory_rows": df.height,
        "matched": len(matched),
        "sheet": sheet or "(first sheet)",
        "parent_id": parent_id or "",
        "by_type": {k: v for k, v in counts.items() if v},
        "counts_all": {"PDF": counts.get("PDF", 0),
                       "Microsoft Word": counts.get("Microsoft Word", 0),
                       "Microsoft PowerPoint": counts.get("Microsoft PowerPoint", 0)},
    }
    return [("Downloadable documents", out)], stats, _preview(out_df)
