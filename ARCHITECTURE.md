# Project structure — per-placeholder engines

Each placeholder now owns its **complete working logic** in its own folder.
The previously-shared conversion engine (`services/feature_service.py`) has been
split: every placeholder-specific function moved into that placeholder's own
`engine.py`. Only genuinely generic primitives remain shared.

## dashboards/ — one self-contained package per placeholder

```
dashboards/
  dashboard1_merge/        Placeholder 1 — merge axe exports
    routes.py              blueprint (HTTP)
    constants.py           URLs / blueprint name
    validation.py          input checks
    converter.py           thin wrapper -> engine
    engine.py              merge_axe()  ← this placeholder's working logic
    services.py

  dashboard2_axe2audit/    Placeholder 2 — axe -> audit conversion
    engine.py              axe_to_audit() + ALL of:
                             - severity/priority maps, column maps
                             - WCAG tag regexes (_WCAG_TAG_RE, _WCAGAA_TAG_RE)
                             - keyword category rules (_KEYWORD_RULES, hints)
                             - category derivation, Description composition
                             - standalone-sheet formatting + output preview
    routes.py / constants.py / validation.py / converter.py / services.py

  dashboard3_delivery/     Placeholder 3 — delivery report
    engine.py              prepare_delivery_export(), export_via_template(),
                           _fill_delivery(), _summary_metrics(),
                           summarize_delivery(), _fill_template(),
                           vpat_report(), _write_vpat_workbook()
    routes.py / constants.py / validation.py / delivery_generator.py /
    csv_export.py / services.py

  dashboard4_downloadable/ Placeholder 4 — downloadable audit (disabled)
    engine.py              downloadable_docs(), _classify_doc(), doc-type maps
    routes.py / constants.py / validation.py / converter.py / services.py

  dashboard5_vpat/         Placeholder 5 — VPAT editor
    vpat_core.py           VPAT data model + PDF export (already self-contained)
    routes.py / constants.py / validation.py / converter.py / templates/
```

Each `converter.py` / `validation.py` / `delivery_generator.py` now calls its
OWN `engine.py` — no cross-placeholder calls.

## services/feature_service.py — shared PRIMITIVES only

What stays here is deliberately generic and used by more than one placeholder
*and* by the editor / app helpers, so duplicating it into every dashboard would
mean fixing the same bug many times:

- Excel/CSV read helpers (`_read_table`, `list_sheets_for`)
- the audit-template header definition (`audit_headers`, `validate_audit_columns`)
- WCAG tag-file loader (`load_wcag_tags`, `WCAG_TAGS`)
- universal cell helpers used on every load (`strip_description_hyphen`,
  `fill_issue_category`, `_category_from_issue`)
- the Excel-error constant + scanner (`EXCEL_ERROR_VALUES`, `_excel_error_cells`)
  used by the editor's Issues-page validator
- template paths + small format/slug/timestamp helpers

These are imported by each placeholder `engine.py` via
`from services.feature_service import ...`.

## Other shared infrastructure (unchanged)

`smart_editor/` (the grid editor), `common/`, `help_lookup/`, `auth/`, `admin/`,
`dashboard/`, `database/`, `utils/`, `templates/`, `static/`, `data/`.

## Verified after the split

PH2 and PH3 outputs are byte-identical to before the split (golden-file
comparison; the only delta is the live "Generated:" timestamp). PH1 merge and
PH4 run through their own engines; the editor's Issues-page validation still
works. App boots clean with all pages responding.
