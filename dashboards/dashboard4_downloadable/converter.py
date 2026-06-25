"""Placeholder 4 conversion wrapper (delegates to this placeholder's own engine)."""
from dashboards.dashboard4_downloadable import engine
def generate(path, parent_id="", sheet=None):
    """Build the downloadable-documents workbook. Returns (outputs, stats, preview)."""
    return engine.downloadable_docs(path, parent_id=parent_id, sheet=sheet)
