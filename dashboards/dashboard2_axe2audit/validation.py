"""Placeholder 2 input validation."""
import re

from common.exceptions import ValidationError


def require_parent_id(parent_id: str) -> str:
    """Require a Parent ID and ensure its id part is NUMBERS ONLY.

    The field is the 'PSGIN-<id>' form (the prefix is added/prefilled); the
    <id> after the prefix must be digits only — no letters or symbols. Any
    number of digits is allowed."""
    pid = (parent_id or "").strip()
    if not pid:
        raise ValidationError("Parent ID is required — enter a Parent ID before generating.")
    core = re.sub(r"^PSGIN\s*-?\s*", "", pid, flags=re.IGNORECASE).strip()
    if not core:
        raise ValidationError("Enter the numeric Parent ID after 'PSGIN-'.")
    if not core.isdigit():
        raise ValidationError("Parent ID must be numbers only — no letters or symbols.")
    return pid
