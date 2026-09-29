from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
import uuid
import httpx
from pathlib import Path
from pydantic import BaseModel, Field
from typing import List, Optional, Literal
from datetime import datetime, timezone, timedelta

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

app = FastAPI()
api_router = APIRouter(prefix="/api")

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


# --- Models ---
class SessionExchangeRequest(BaseModel):
    session_id: str


class UserOut(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None


class AuthResponse(BaseModel):
    session_token: str
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
async def get_current_user(authorization: Optional[str] = Header(None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    session = await db.user_sessions.find_one({"session_token": token}, {"_id": 0})
    if not session:
        raise HTTPException(status_code=401, detail="Invalid session")
    expires_at = session.get("expires_at")
    if isinstance(expires_at, datetime):
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        if expires_at < datetime.now(timezone.utc):
            raise HTTPException(status_code=401, detail="Session expired")
    user = await db.users.find_one({"user_id": session["user_id"]}, {"_id": 0})
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user


# --- Auth Endpoints ---
@api_router.post("/auth/session", response_model=AuthResponse)
async def exchange_session(payload: SessionExchangeRequest):
    session_id = payload.session_id.strip()
    if not session_id:
        raise HTTPException(status_code=401, detail="Missing session_id")
    async with httpx.AsyncClient(timeout=15.0) as hx:
        r = await hx.get(
            "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
            headers={"X-Session-ID": session_id},
        )
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail="Invalid session_id")
    data = r.json()
    email = data.get("email")
    name = data.get("name") or email or "User"
    picture = data.get("picture")
    session_token = data.get("session_token")
    if not email or not session_token:
        raise HTTPException(status_code=401, detail="Malformed session data")

    existing = await db.users.find_one({"email": email}, {"_id": 0})
    if existing:
        user_id = existing["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {"name": name, "picture": picture}},
        )
    else:
        user_id = f"user_{uuid.uuid4().hex[:12]}"
        await db.users.insert_one({
            "user_id": user_id,
            "email": email,
            "name": name,
            "picture": picture,
            "createdAt": datetime.now(timezone.utc).isoformat(),
        })

    await db.user_sessions.insert_one({
        "session_token": session_token,
        "user_id": user_id,
        "created_at": datetime.now(timezone.utc),
        "expires_at": datetime.now(timezone.utc) + timedelta(days=7),
    })

    user_out = UserOut(user_id=user_id, email=email, name=name, picture=picture)
    return AuthResponse(session_token=session_token, user=user_out)


@api_router.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return UserOut(
        user_id=user["user_id"],
        email=user["email"],
        name=user.get("name", ""),
        picture=user.get("picture"),
    )


@api_router.post("/auth/logout")
async def logout(authorization: Optional[str] = Header(None)):
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ", 1)[1].strip()
        await db.user_sessions.delete_one({"session_token": token})
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
    await db.user_sessions.create_index("session_token", unique=True)
    await db.user_sessions.create_index("user_id")
    await db.user_sessions.create_index("expires_at", expireAfterSeconds=0)
    await db.customers.create_index([("user_id", 1), ("id", 1)])
    await db.entries.create_index([("user_id", 1), ("id", 1)])
    await db.jobs.create_index([("user_id", 1), ("id", 1)])


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
