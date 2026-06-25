"""CSV / TSV reading and writing on Polars (with robust fallbacks)."""
from __future__ import annotations

import io
from pathlib import Path

import polars as pl


def decode_csv_bytes(path: str | Path) -> bytes:
    """Read a text file and return clean UTF-8 bytes.

    CSVs exported from Excel/Windows are frequently cp1252/latin-1 rather than
    UTF-8, which makes a plain ``pl.read_csv`` raise "invalid utf-8 sequence".
    Decode the raw bytes with a fallback chain, then return UTF-8 bytes so any
    source encoding can be parsed. ``latin-1`` never fails, so this always
    yields something; the final ``errors='replace'`` is a last-resort guard."""
    raw = Path(path).read_bytes()
    for enc in ("utf-8-sig", "cp1252", "latin-1"):
        try:
            return raw.decode(enc).encode("utf-8")
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace").encode("utf-8")


def read_csv(path: str | Path, separator: str | None = None) -> pl.DataFrame:
    """Read a CSV/TSV file. Separator is inferred from the extension if omitted.

    Every column is read as text (no type inference). This is deliberate: the
    app is a document editor, so values must be preserved exactly as written —
    e.g. a WCAG criterion like "1.4.3" must never be coerced into a date
    ("0003-04-01"), and IDs/codes must keep leading zeros and punctuation."""
    path = Path(path)
    if separator is None:
        separator = "\t" if path.suffix.lower() == ".tsv" else ","
    return pl.read_csv(
        io.BytesIO(decode_csv_bytes(path)),   # tolerate cp1252/latin-1 sources
        separator=separator,
        infer_schema_length=0,    # treat every column as Utf8 text
        try_parse_dates=False,    # never turn "1.4.3" / "01-02" into a date
        has_header=True,
        truncate_ragged_lines=True,
        ignore_errors=True,
    )


def write_csv(df: pl.DataFrame, out_path: str | Path, separator: str = ",") -> Path:
    out_path = Path(out_path)
    df.write_csv(out_path, separator=separator)
    return out_path
