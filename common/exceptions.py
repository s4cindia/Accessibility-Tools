"""Shared exception types for the dashboards."""
class DashboardError(Exception):
    """Base error for any dashboard/placeholder operation."""
class ValidationError(DashboardError):
    """Raised when an input/output fails a validation rule."""
class ConversionError(DashboardError):
    """Raised when a conversion/transform step fails."""
