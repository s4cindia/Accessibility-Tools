"""Shared infrastructure used by every dashboard (placeholder).

This package is a single, stable import surface over the engine/editor/helpers
so the per-dashboard packages don't reach into scattered modules. The heavy
logic still lives in the proven services/ layer; these are thin re-exports.
"""
