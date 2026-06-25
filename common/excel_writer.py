"""Excel writing — re-exported from the shared services layer."""
from services.excel_service import write_excel, trim_trailing_blank_rows
__all__ = ["write_excel", "trim_trailing_blank_rows"]
