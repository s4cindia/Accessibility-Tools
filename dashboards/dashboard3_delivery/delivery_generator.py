"""Placeholder 3 delivery generation (this placeholder's own engine)."""
from dashboards.dashboard3_delivery import engine
def report(path):
    return engine.vpat_report(path)
def delivery_summary(df):
    return engine.summarize_delivery(df)
def export_template(df, stem="delivery", title="", course="", details=""):
    return engine.export_via_template(df, stem=stem, title=title, course=course, details=details)
