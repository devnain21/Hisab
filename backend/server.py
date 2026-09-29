from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import json
import os
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone

import firebase_admin
from firebase_admin import auth as firebase_auth
from firebase_admin import credentials as firebase_credentials

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI(title="Nain Hisab API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


def init_firebase() -> bool:
    if firebase_admin._apps:
        return True
    raw = (os.environ.get("FIREBASE_CREDENTIALS_JSON") or "").strip()
    path = (os.environ.get("GOOGLE_APPLICATION_CREDENTIALS") or "").strip()
    try:
        if raw:
            info = json.loads(raw)
            cred = firebase_credentials.Certificate(info)
        elif path:
            cred_path = Path(path)
            if not cred_path.is_absolute():
                cred_path = ROOT_DIR / cred_path
            if not cred_path.is_file():
                logger.warning("Firebase credentials file not found: %s", cred_path)
                return False
            cred = firebase_credentials.Certificate(str(cred_path))
        else:
            logger.warning("Firebase credentials not set — Google ID tokens will not verify")
            return False
        firebase_admin.initialize_app(cred)
        logger.info("Firebase Admin initialized")
        return True
    except Exception:
        logger.exception("Firebase Admin failed to initialize")
        return False


FIREBASE_READY = init_firebase()


# --- Models ---
class LoginRequest(BaseModel):
    id_token: str


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None


class AuthResponse(BaseModel):
    user: UserOut


class Customer(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    phone: str = ""
    address: str = ""
    notes: str = ""
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CustomerCreate(BaseModel):
    name: str
    phone: str = ""
    address: str = ""
    notes: str = ""


class Entry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customerId: str
    type: Literal["work", "payment"]
    date: str
    description: str
    amount: float
    notes: str = ""
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EntryCreate(BaseModel):
    customerId: str
    type: Literal["work", "payment"]
    date: str
    description: str
    amount: float
    notes: str = ""


class Job(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customerId: str
    title: str
    dueDate: str
    status: Literal["pending", "doing", "done"] = "pending"
    estimatedAmount: float = 0
    notes: str = ""
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class JobCreate(BaseModel):
    customerId: str
    title: str
    dueDate: str
    status: Literal["pending", "doing", "done"] = "pending"
    estimatedAmount: float = 0
    notes: str = ""


class JobUpdate(BaseModel):
    title: Optional[str] = None
    dueDate: Optional[str] = None
    status: Optional[Literal["pending", "doing", "done"]] = None
    estimatedAmount: Optional[float] = None
    notes: Optional[str] = None


# --- Auth Helpers ---
def _extract_bearer(authorization: Optional[str]) -> Optional[str]:
    if not authorization or not authorization.startswith("Bearer "):
        return None
    token = authorization.split(" ", 1)[1].strip()
    return token or None


async def upsert_user_from_claims(claims: dict) -> dict:
    firebase_uid = claims.get("uid") or claims.get("sub")
    email = (claims.get("email") or "").strip().lower()
    name = claims.get("name") or email or "User"
    picture = claims.get("picture")
    if not firebase_uid and not email:
        raise HTTPException(status_code=401, detail="Token missing user identity")

    existing = None
    if firebase_uid:
        existing = await db.users.find_one({"firebase_uid": firebase_uid}, {"_id": 0})
    if not existing and email:
        existing = await db.users.find_one({"email": email}, {"_id": 0})

    now = datetime.now(timezone.utc).isoformat()
    if existing:
        user_id = existing["user_id"]
        patch = {"name": name, "picture": picture, "email": email or existing.get("email")}
        if firebase_uid:
            patch["firebase_uid"] = firebase_uid
        await db.users.update_one({"user_id": user_id}, {"$set": patch})
        existing.update(patch)
        return existing

    user_id = f"user_{uuid.uuid4().hex[:12]}"
    doc = {
        "user_id": user_id,
        "firebase_uid": firebase_uid,
        "email": email,
        "name": name,
        "picture": picture,
        "createdAt": now,
    }
    await db.users.insert_one(doc)
    doc.pop("_id", None)
    return doc


async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    token = _extract_bearer(authorization)
    if not token:
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    if not FIREBASE_READY:
        raise HTTPException(status_code=503, detail="Firebase is not configured on the server")
    try:
        claims = firebase_auth.verify_id_token(token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    return await upsert_user_from_claims(claims)


# --- Auth Endpoints ---
@api_router.post("/auth/login", response_model=AuthResponse)
async def login_with_firebase(payload: LoginRequest):
    id_token = (payload.id_token or "").strip()
    if not id_token:
        raise HTTPException(status_code=401, detail="Missing id_token")
    if not FIREBASE_READY:
        raise HTTPException(status_code=503, detail="Firebase is not configured on the server")
    try:
        claims = firebase_auth.verify_id_token(id_token)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid id_token")
    user = await upsert_user_from_claims(claims)
    return AuthResponse(
        user=UserOut(
            user_id=user["user_id"],
            email=user.get("email", ""),
            name=user.get("name", ""),
            picture=user.get("picture"),
        )
    )


@api_router.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return UserOut(
        user_id=user["user_id"],
        email=user["email"],
        name=user.get("name", ""),
        picture=user.get("picture"),
    )


@api_router.post("/auth/logout")
async def logout():
    # Firebase ID tokens are stateless; the client drops its own session.
    return {"ok": True}


# --- Customers ---
@api_router.get("/customers", response_model=List[Customer])
async def list_customers(user: dict = Depends(get_current_user)):
    rows = await db.customers.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(2000)
    return [Customer(**r) for r in rows]


@api_router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, user: dict = Depends(get_current_user)):
    c = Customer(**payload.dict())
    doc = c.dict()
    doc["user_id"] = user["user_id"]
    await db.customers.insert_one(doc)
    return c


@api_router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerCreate, user: dict = Depends(get_current_user)):
    existing = await db.customers.find_one({"id": customer_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    updated = {**existing, **payload.dict()}
    await db.customers.update_one({"id": customer_id, "user_id": user["user_id"]}, {"$set": payload.dict()})
    return Customer(**updated)


@api_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, user: dict = Depends(get_current_user)):
    await db.customers.delete_one({"id": customer_id, "user_id": user["user_id"]})
    await db.entries.delete_many({"customerId": customer_id, "user_id": user["user_id"]})
    await db.jobs.delete_many({"customerId": customer_id, "user_id": user["user_id"]})
    return {"ok": True}


# --- Entries ---
@api_router.get("/entries", response_model=List[Entry])
async def list_entries(user: dict = Depends(get_current_user)):
    rows = await db.entries.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(5000)
    return [Entry(**r) for r in rows]


@api_router.post("/entries", response_model=Entry)
async def create_entry(payload: EntryCreate, user: dict = Depends(get_current_user)):
    e = Entry(**payload.dict())
    doc = e.dict()
    doc["user_id"] = user["user_id"]
    await db.entries.insert_one(doc)
    return e


@api_router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: str, user: dict = Depends(get_current_user)):
    await db.entries.delete_one({"id": entry_id, "user_id": user["user_id"]})
    return {"ok": True}


# --- Jobs ---
@api_router.get("/jobs", response_model=List[Job])
async def list_jobs(user: dict = Depends(get_current_user)):
    rows = await db.jobs.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(5000)
    return [Job(**r) for r in rows]


@api_router.post("/jobs", response_model=Job)
async def create_job(payload: JobCreate, user: dict = Depends(get_current_user)):
    j = Job(**payload.dict())
    doc = j.dict()
    doc["user_id"] = user["user_id"]
    await db.jobs.insert_one(doc)
    return j


@api_router.put("/jobs/{job_id}", response_model=Job)
async def update_job(job_id: str, payload: JobUpdate, user: dict = Depends(get_current_user)):
    existing = await db.jobs.find_one({"id": job_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    patch = {k: v for k, v in payload.dict().items() if v is not None}
    if patch:
        await db.jobs.update_one({"id": job_id, "user_id": user["user_id"]}, {"$set": patch})
    updated = {**existing, **patch}
    return Job(**updated)


@api_router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user: dict = Depends(get_current_user)):
    await db.jobs.delete_one({"id": job_id, "user_id": user["user_id"]})
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "Nain Hisab API"}


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("firebase_uid", unique=True, sparse=True)
    await db.customers.create_index([("user_id", 1), ("id", 1)])
    await db.entries.create_index([("user_id", 1), ("id", 1)])
    await db.jobs.create_index([("user_id", 1), ("id", 1)])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
