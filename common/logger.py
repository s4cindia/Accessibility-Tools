"""Logging helper — one place to get a namespaced logger."""
import logging
def get_logger(name: str) -> logging.Logger:
    return logging.getLogger(name)
