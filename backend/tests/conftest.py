import json
import os
from pathlib import Path

import pytest
import requests
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / "frontend" / ".env")
load_dotenv(ROOT / "backend" / ".env")

BASE_URL = (os.environ.get("EXPO_PUBLIC_BACKEND_URL") or "").rstrip("/")
API = f"{BASE_URL}/api"
WEB_API_KEY = os.environ.get("EXPO_PUBLIC_FIREBASE_API_KEY", "").strip()

SIGN_IN_URL = "https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken"

USERS = {
    "a": {"uid": "pytest-hisab-a", "email": "pytest-a@hisab.test", "name": "Test User A"},
    "b": {"uid": "pytest-hisab-b", "email": "pytest-b@hisab.test", "name": "Test User B"},
}


def _service_account_path():
    path = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    if not path:
        return None
    p = Path(path)
    return p if p.is_absolute() else ROOT / "backend" / p


@pytest.fixture(scope="session")
def firebase_app():
    import firebase_admin
    from firebase_admin import credentials

    if firebase_admin._apps:
        return firebase_admin.get_app()

    raw = (os.environ.get("FIREBASE_CREDENTIALS_JSON") or "").strip()
    if raw:
        cred = credentials.Certificate(json.loads(raw))
    else:
        path = _service_account_path()
        if not path or not path.is_file():
            pytest.skip("Firebase service account not configured; see backend/.env.example")
        cred = credentials.Certificate(str(path))
    return firebase_admin.initialize_app(cred)


@pytest.fixture(scope="session")
def id_tokens(firebase_app):
    """Mint real Firebase ID tokens for two isolated test users."""
    from firebase_admin import auth as fb_auth

    if not WEB_API_KEY:
        pytest.skip("EXPO_PUBLIC_FIREBASE_API_KEY not set in frontend/.env")

    tokens = {}
    for key, u in USERS.items():
        try:
            fb_auth.update_user(u["uid"], email=u["email"], display_name=u["name"])
        except fb_auth.UserNotFoundError:
            fb_auth.create_user(uid=u["uid"], email=u["email"], display_name=u["name"])

        custom_token = fb_auth.create_custom_token(u["uid"]).decode()
        r = requests.post(
            SIGN_IN_URL,
            params={"key": WEB_API_KEY},
            json={"token": custom_token, "returnSecureToken": True},
            timeout=30,
        )
        if r.status_code != 200:
            pytest.skip(f"Could not mint Firebase ID token for {u['uid']}: {r.text}")
        tokens[key] = r.json()["idToken"]
    return tokens


@pytest.fixture(scope="session")
def api_url():
    if not BASE_URL:
        pytest.skip("EXPO_PUBLIC_BACKEND_URL not set in frontend/.env")
    return API


def _session(token=None):
    s = requests.Session()
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    s.headers.update(headers)
    return s


@pytest.fixture(scope="session")
def user_a():
    return USERS["a"]


@pytest.fixture(scope="session")
def user_b():
    return USERS["b"]


@pytest.fixture(scope="session")
def session_a(id_tokens):
    return _session(id_tokens["a"])


@pytest.fixture(scope="session")
def session_b(id_tokens):
    return _session(id_tokens["b"])


@pytest.fixture(scope="session")
def anon_session():
    return _session()
