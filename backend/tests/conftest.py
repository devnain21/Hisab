import os
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

# Load frontend .env for EXPO_PUBLIC_BACKEND_URL
load_dotenv(Path(__file__).parent.parent.parent / "frontend" / ".env")

BASE_URL = os.environ["EXPO_PUBLIC_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

TOKEN_A = "testtoken123"
TOKEN_B = "othertoken456"
USER_A_ID = "user_test123"
USER_A_EMAIL = "test@example.com"
USER_B_ID = "user_test456"


@pytest.fixture(scope="session")
def api_url():
    return API


@pytest.fixture(scope="session")
def session_a():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN_A}",
    })
    return s


@pytest.fixture(scope="session")
def session_b():
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {TOKEN_B}",
    })
    return s


@pytest.fixture(scope="session")
def anon_session():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s
