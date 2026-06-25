"""Placeholder 1 input validation."""
from common.exceptions import ValidationError
def require_files(files):
    if not files:
        raise ValidationError("Select at least one axe export to merge.")
    return files
