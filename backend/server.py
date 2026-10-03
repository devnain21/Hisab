from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import json
import os
import logging
import uuid
from pathlib import Path
from pydantic import BaseModel, Field, model_validator
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
    shop_name: str = ""
    shop_phone: str = ""
    shop_address: str = ""
    shop_gst: str = ""
    shop_upi: str = ""
    owner_name: str = ""
    persona: str = "business"


class ProfileUpdate(BaseModel):
    shop_name: str = Field(max_length=60)
    shop_phone: Optional[str] = Field(default=None, max_length=20)
    shop_address: Optional[str] = Field(default=None, max_length=120)
    shop_gst: Optional[str] = Field(default=None, max_length=20)
    shop_upi: Optional[str] = Field(default=None, max_length=50)
    owner_name: Optional[str] = Field(default=None, max_length=60)
    persona: Optional[str] = Field(default=None, max_length=20)


class AuthResponse(BaseModel):
    user: UserOut


class Customer(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    phone: str = ""
    address: str = ""
    notes: str = ""
    persona: Optional[str] = "business"
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class CustomerCreate(BaseModel):
    id: Optional[str] = None
    # When the row was typed on the phone; offline rows can reach the server days later.
    createdAt: Optional[str] = None
    name: str
    phone: str = ""
    address: str = ""
    notes: str = ""
    persona: Optional[str] = "business"


def _check_paid(m):
    # `paid` is the cash taken when the work was booked; it only exists on work rows and
    # can never exceed the work amount, so balance = sum(work.amount - work.paid) - sum(payments).
    if m.paid is None:
        return m
    if m.type not in PAID_TYPES and m.paid:
        raise ValueError("paid is only allowed on work / purchase entries")
    if m.paid > m.amount:
        raise ValueError("paid cannot exceed amount")
    return m


# work: service done (raises what they owe) · payment: money received from them ·
# given: money handed to them, e.g. a personal loan (raises what they owe, no work involved) ·
# purchase: goods / service we took from them (raises what we owe; `paid` = paid on the spot) ·
# aeps: what a customer still owes for a counter service (linkId = the AEPS row; money moves on that row).
EntryType = Literal["work", "payment", "given", "purchase", "aeps"]
PAID_TYPES = ("work", "purchase")


class EntryItem(BaseModel):
    title: str
    amount: float = Field(..., ge=0)


class Entry(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customerId: str
    type: EntryType
    date: str
    description: str
    amount: float
    paid: float = 0
    mode: Optional[str] = "cash"
    fee: Optional[float] = 0
    feeMode: Optional[str] = "online"
    notes: str = ""
    linkId: str = ""
    items: Optional[List[EntryItem]] = None
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class EntryCreate(BaseModel):
    id: Optional[str] = None
    # When the row was typed on the phone; offline rows can reach the server days later.
    createdAt: Optional[str] = None
    customerId: str
    type: EntryType
    date: str
    description: str
    amount: float
    paid: float = Field(0, ge=0)
    mode: Optional[str] = "cash"
    fee: Optional[float] = Field(0, ge=0)
    feeMode: Optional[str] = "online"
    notes: str = ""
    linkId: str = ""
    items: Optional[List[EntryItem]] = None

    @model_validator(mode="after")
    def validate_paid(self):
        return _check_paid(self)


class EntryUpdate(BaseModel):
    type: EntryType
    date: str
    description: str
    amount: float
    paid: Optional[float] = Field(None, ge=0)
    mode: Optional[str] = None
    fee: Optional[float] = Field(None, ge=0)
    feeMode: Optional[str] = None
    notes: str = ""
    linkId: Optional[str] = None
    items: Optional[List[EntryItem]] = None

    @model_validator(mode="after")
    def validate_paid(self):
        return _check_paid(self)


class Job(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customerId: str
    title: str
    dueDate: str
    status: Literal["pending", "doing", "done"] = "pending"
    estimatedAmount: float = 0
    notes: str = ""
    entryId: str = ""
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class JobCreate(BaseModel):
    id: Optional[str] = None
    # When the row was typed on the phone; offline rows can reach the server days later.
    createdAt: Optional[str] = None
    customerId: str
    title: str
    dueDate: str
    status: Literal["pending", "doing", "done"] = "pending"
    estimatedAmount: float = 0
    notes: str = ""
    entryId: str = ""


class JobUpdate(BaseModel):
    title: Optional[str] = None
    dueDate: Optional[str] = None
    status: Optional[Literal["pending", "doing", "done"]] = None
    estimatedAmount: Optional[float] = None
    notes: Optional[str] = None
    entryId: Optional[str] = None


AepsType = Literal["withdrawal", "cash", "deposit", "transfer", "upi", "balance", "recharge", "bill", "other"]


class AepsFields(BaseModel):
    type: AepsType
    date: str
    time: str = ""
    customerName: str = Field(min_length=1, max_length=80)
    mobile: str = Field("", max_length=15)
    # UIDAI rules forbid keeping full Aadhaar numbers; only the last four digits are accepted.
    aadhaarLast4: str = Field("", pattern=r"^\d{0,4}$")
    bankName: str = ""
    amount: float = Field(0, ge=0)
    commission: float = Field(0, ge=0)
    status: Literal["success", "pending", "failed"] = "success"
    reference: str = ""
    operator: str = ""
    rechargeNumber: str = ""
    billerName: str = ""
    billAccount: str = ""
    beneficiaryName: str = ""
    accountNumber: str = ""
    ifsc: str = ""
    upiId: str = ""
    # Empty means the service decides. "other" stores which way the drawer moved.
    cash: Literal["", "in", "out", "none"] = ""
    # Where the commission landed: customer paid it in cash / online, or the AEPS app credited it.
    commissionMode: Literal["", "cash", "online", "app"] = ""
    # Day the counter cash changed hands; "" means not yet. None on rows saved before this field existed.
    cashDate: Optional[str] = None
    # Day the bank side went through. "" while pending.
    doneDate: str = ""
    # Pending row the customer asked to be sent on a later day.
    dueDate: str = ""
    notes: str = ""
    # Shop customer this service was done for.
    customerId: str = ""
    # How it was done: AEPS (Aadhaar) / UPI / bank account / EMI.
    via: Literal["", "aeps", "upi", "bank", "emi"] = ""
    # Money the customer has handed over toward the amount, and how. None on older rows (= the full amount).
    collected: Optional[float] = Field(None, ge=0)
    payMode: Literal["", "cash", "online"] = ""


class AepsTxn(AepsFields):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class AepsCreate(AepsFields):
    id: Optional[str] = None
    # When the row was typed on the phone; offline rows can reach the server days later.
    createdAt: Optional[str] = None


class ExpenseFields(BaseModel):
    amount: float = Field(gt=0)
    title: str = Field("खर्च", max_length=80)
    mode: Literal["cash", "online"] = "cash"
    date: str
    notes: str = ""
    persona: Literal["business", "personal"] = "business"


class Expense(ExpenseFields):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ExpenseCreate(ExpenseFields):
    id: Optional[str] = None
    createdAt: Optional[str] = None


AccountKey = Literal["", "business:cash", "business:bank", "personal:cash", "personal:bank"]


class MoneyMoveFields(BaseModel):
    date: str
    # Source and destination account; "" is money from / to outside the app's accounts.
    src: AccountKey = ""
    dst: AccountKey = ""
    amount: float = Field(gt=0)
    note: str = Field("", max_length=120)


class MoneyMove(MoneyMoveFields):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class MoneyMoveCreate(MoneyMoveFields):
    id: Optional[str] = None
    createdAt: Optional[str] = None


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
        # Runs on every request; only write when the Google profile actually changed.
        changed = {k: v for k, v in patch.items() if existing.get(k) != v}
        if changed:
            await db.users.update_one({"user_id": user_id}, {"$set": changed})
            existing.update(changed)
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


# Offline clients generate the id and may resend the same create after a dropped response.
async def _create_idempotent(collection, model, payload: BaseModel, user: dict):
    data = payload.dict(exclude_none=True)
    if data.get("id"):
        existing = await collection.find_one({"id": data["id"], "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
        if existing:
            return model(**existing)
    obj = model(**data)
    doc = obj.dict()
    doc["user_id"] = user["user_id"]
    await collection.insert_one(doc)
    return obj


# Deleted rows are kept for a while so a wrong delete (or a cascade) can be recovered.
async def _archive_and_delete(coll_name: str, query: dict, user: dict):
    collection = db[coll_name]
    q = {**query, "user_id": user["user_id"]}
    docs = await collection.find(q, {"_id": 0}).to_list(None)
    if not docs:
        return
    now = datetime.now(timezone.utc)
    await db.deleted_items.insert_many(
        [{"user_id": user["user_id"], "coll": coll_name, "id": d.get("id", ""), "deletedAt": now, "doc": d} for d in docs]
    )
    await collection.delete_many(q)


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
    return AuthResponse(user=_user_out(user))


def _user_out(user: dict) -> UserOut:
    return UserOut(
        user_id=user["user_id"],
        email=user.get("email", ""),
        name=user.get("name", ""),
        picture=user.get("picture"),
        shop_name=user.get("shop_name", ""),
        shop_phone=user.get("shop_phone", ""),
        shop_address=user.get("shop_address", ""),
        shop_gst=user.get("shop_gst", ""),
        shop_upi=user.get("shop_upi", ""),
        owner_name=user.get("owner_name", ""),
        persona=user.get("persona", "business"),
    )


@api_router.get("/auth/me", response_model=UserOut)
async def me(user: dict = Depends(get_current_user)):
    return _user_out(user)


@api_router.put("/auth/me", response_model=UserOut)
async def update_me(payload: ProfileUpdate, user: dict = Depends(get_current_user)):
    patch = {k: v.strip() for k, v in payload.model_dump(exclude_none=True).items()}
    await db.users.update_one({"user_id": user["user_id"]}, {"$set": patch})
    user.update(patch)
    return _user_out(user)


@api_router.post("/auth/logout")
async def logout():
    # Firebase ID tokens are stateless; the client drops its own session.
    return {"ok": True}


# --- Customers ---
@api_router.get("/customers", response_model=List[Customer])
async def list_customers(user: dict = Depends(get_current_user)):
    rows = await db.customers.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return [Customer(**r) for r in rows]


@api_router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.customers, Customer, payload, user)


@api_router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerCreate, user: dict = Depends(get_current_user)):
    existing = await db.customers.find_one({"id": customer_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    patch = payload.dict(exclude={"id"})
    await db.customers.update_one({"id": customer_id, "user_id": user["user_id"]}, {"$set": patch})
    return Customer(**{**existing, **patch})


@api_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("customers", {"id": customer_id}, user)
    await _archive_and_delete("entries", {"customerId": customer_id}, user)
    await _archive_and_delete("jobs", {"customerId": customer_id}, user)
    # Counter rows carry their own galla / bank movement, so they stay; only the link goes.
    await db.aeps.update_many({"customerId": customer_id, "user_id": user["user_id"]}, {"$set": {"customerId": ""}})
    return {"ok": True}


# --- Entries ---
@api_router.get("/entries", response_model=List[Entry])
async def list_entries(user: dict = Depends(get_current_user)):
    rows = await db.entries.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return [Entry(**r) for r in rows]


@api_router.post("/entries", response_model=Entry)
async def create_entry(payload: EntryCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.entries, Entry, payload, user)


@api_router.put("/entries/{entry_id}", response_model=Entry)
async def update_entry(entry_id: str, payload: EntryUpdate, user: dict = Depends(get_current_user)):
    existing = await db.entries.find_one({"id": entry_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    # Free work stays bookable when the shop paid a fee for it.
    free_with_fee = payload.amount == 0 and payload.type == "work" and (payload.fee or 0) > 0
    if payload.amount < 0 or (payload.amount == 0 and not free_with_fee):
        raise HTTPException(422, "Amount must be greater than 0")
    patch = payload.dict(exclude_none=True)
    paid = patch.get("paid", existing.get("paid", 0)) if payload.type in PAID_TYPES else 0
    if paid > payload.amount:
        raise HTTPException(422, "paid cannot exceed amount")
    patch["paid"] = paid
    await db.entries.update_one({"id": entry_id, "user_id": user["user_id"]}, {"$set": patch})
    return Entry(**{**existing, **patch})


@api_router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("entries", {"id": entry_id}, user)
    return {"ok": True}


# --- Jobs ---
@api_router.get("/jobs", response_model=List[Job])
async def list_jobs(user: dict = Depends(get_current_user)):
    rows = await db.jobs.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return [Job(**r) for r in rows]


@api_router.post("/jobs", response_model=Job)
async def create_job(payload: JobCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.jobs, Job, payload, user)


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
    await _archive_and_delete("jobs", {"id": job_id}, user)
    return {"ok": True}


# --- AEPS / money services ---
@api_router.get("/aeps", response_model=List[AepsTxn])
async def list_aeps(user: dict = Depends(get_current_user)):
    rows = await db.aeps.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return [AepsTxn(**r) for r in rows]


@api_router.post("/aeps", response_model=AepsTxn)
async def create_aeps(payload: AepsCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.aeps, AepsTxn, payload, user)


@api_router.put("/aeps/{txn_id}", response_model=AepsTxn)
async def update_aeps(txn_id: str, payload: AepsFields, user: dict = Depends(get_current_user)):
    existing = await db.aeps.find_one({"id": txn_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    patch = payload.dict()
    await db.aeps.update_one({"id": txn_id, "user_id": user["user_id"]}, {"$set": patch})
    return AepsTxn(**{**existing, **patch})


@api_router.delete("/aeps/{txn_id}")
async def delete_aeps(txn_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("aeps", {"id": txn_id}, user)
    return {"ok": True}


# --- Expenses and money moves (cash / bank adjustments) ---
@api_router.get("/expenses", response_model=List[Expense])
async def list_expenses(user: dict = Depends(get_current_user)):
    rows = await db.expenses.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return [Expense(**r) for r in rows]


@api_router.post("/expenses", response_model=Expense)
async def create_expense(payload: ExpenseCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.expenses, Expense, payload, user)


@api_router.put("/expenses/{expense_id}", response_model=Expense)
async def update_expense(expense_id: str, payload: ExpenseFields, user: dict = Depends(get_current_user)):
    existing = await db.expenses.find_one({"id": expense_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    patch = payload.dict()
    await db.expenses.update_one({"id": expense_id, "user_id": user["user_id"]}, {"$set": patch})
    return Expense(**{**existing, **patch})


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("expenses", {"id": expense_id}, user)
    return {"ok": True}


@api_router.get("/moves", response_model=List[MoneyMove])
async def list_moves(user: dict = Depends(get_current_user)):
    rows = await db.moves.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return [MoneyMove(**r) for r in rows]


@api_router.post("/moves", response_model=MoneyMove)
async def create_move(payload: MoneyMoveCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.moves, MoneyMove, payload, user)


@api_router.put("/moves/{move_id}", response_model=MoneyMove)
async def update_move(move_id: str, payload: MoneyMoveFields, user: dict = Depends(get_current_user)):
    existing = await db.moves.find_one({"id": move_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    patch = payload.dict()
    await db.moves.update_one({"id": move_id, "user_id": user["user_id"]}, {"$set": patch})
    return MoneyMove(**{**existing, **patch})


@api_router.delete("/moves/{move_id}")
async def delete_move(move_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("moves", {"id": move_id}, user)
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
# Full lists of entries grow to a few MB; compressed they travel ~5-10x smaller.
app.add_middleware(GZipMiddleware, minimum_size=1024)


@app.on_event("startup")
async def startup():
    await db.users.create_index("email", unique=True)
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("firebase_uid", unique=True, sparse=True)
    await db.customers.create_index([("user_id", 1), ("id", 1)])
    await db.entries.create_index([("user_id", 1), ("id", 1)])
    await db.entries.create_index([("user_id", 1), ("customerId", 1)])
    await db.entries.create_index([("user_id", 1), ("date", -1)])
    await db.jobs.create_index([("user_id", 1), ("id", 1)])
    await db.jobs.create_index([("user_id", 1), ("status", 1), ("dueDate", 1)])
    await db.aeps.create_index([("user_id", 1), ("id", 1)])
    await db.aeps.create_index([("user_id", 1), ("date", -1)])
    await db.expenses.create_index([("user_id", 1), ("id", 1)])
    await db.moves.create_index([("user_id", 1), ("id", 1)])
    await db.deleted_items.create_index([("user_id", 1), ("coll", 1), ("id", 1)])
    await db.deleted_items.create_index("deletedAt", expireAfterSeconds=60 * 60 * 24 * 180)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
