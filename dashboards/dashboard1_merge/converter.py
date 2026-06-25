"""Placeholder 1 merge wrapper (delegates to this placeholder's own engine)."""
from dashboards.dashboard1_merge import engine
def merge(paths):
    """Merge axe workbooks. Returns (outputs, stats, preview)."""
    return engine.merge_axe(paths)
