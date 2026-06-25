"""Placeholder 2 services (sheet picker + template management helpers)."""
from services import feature_service


def sheets_for(path):
    return feature_service.list_sheets_for(path)
