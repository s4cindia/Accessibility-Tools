"""Authentication routes — login + logout only."""
from __future__ import annotations

import logging
from uuid import uuid4

from flask import (Blueprint, redirect, render_template, request, session,
                   url_for)

from auth.forms import validate_login
from auth.service import verify_credentials

log = logging.getLogger("sde.auth")

auth_bp = Blueprint("auth", __name__)


@auth_bp.route("/login", methods=["GET", "POST"])
def login():
    if request.method == "POST":
        username = request.form.get("username", "")
        password = request.form.get("password", "")

        valid, message = validate_login(username, password)
        if not valid:
            return render_template("login.html", error=message, username=username)

        ok_, result = verify_credentials(username, password)
        if ok_:
            session["user"] = result
            # Fresh per-login session id -> a brand-new, empty in-memory
            # workspace every time someone logs in (no file data persists).
            session["sid"] = uuid4().hex
            from database.models import get_user
            u = get_user(result)
            session["role"] = u.role if u else "user"
            return redirect(url_for("main.dashboard"))
        return render_template("login.html", error=result, username=username)

    return render_template("login.html")


@auth_bp.route("/logout")
def logout():
    # Delete this session's in-memory workspace (must run while 'sid' is still in
    # the session so it targets the right store), then clear the session so the
    # next login starts completely fresh.
    try:
        from services.store import reset_current_store
        reset_current_store()
    except Exception:  # noqa: BLE001
        pass
    session.pop("user", None)
    session.pop("role", None)
    session.pop("sid", None)
    return redirect(url_for("auth.login"))
