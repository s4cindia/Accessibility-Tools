"""Placeholder 5 conversion wrapper — VPAT PDF/report export.

Delegates to the verbatim VPAT core (vpat_core) kept intact in this package.
"""
from dashboards.dashboard5_vpat.vpat_core import (  # noqa: F401
    default_data, export_pdf, WCAG_SLUGS, sc_url)
