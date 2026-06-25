"""Placeholder 5 validation helpers."""
from common.exceptions import ValidationError
def require_draft_name(name: str) -> str:
    n = (name or "").strip()
    if not n:
        raise ValidationError("A draft name is required.")
    return n
