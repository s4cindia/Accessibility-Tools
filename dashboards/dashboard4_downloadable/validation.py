"""Placeholder 4 input validation."""
from common.exceptions import ValidationError
def require_file(f):
    if not f or not getattr(f, "filename", ""):
        raise ValidationError("Choose a file to process.")
    return f
