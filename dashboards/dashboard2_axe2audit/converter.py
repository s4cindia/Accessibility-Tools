"""Placeholder 2 conversion wrapper (delegates to this placeholder's own engine)."""
from dashboards.dashboard2_axe2audit import engine
def convert(path, sheet=None, parent_id="", out_name=""):
    """axe workbook -> audit workbook. Returns (outputs, stats, preview)."""
    return engine.axe_to_audit(path, sheet=sheet, parent_id=parent_id, out_name=out_name)
