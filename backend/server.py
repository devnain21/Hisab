from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from starlette.middleware.gzip import GZipMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import json
import os
import re
import logging
import uuid
from pathlib import Path
from pydantic import AfterValidator, BaseModel, Field, model_validator
from pymongo.errors import DuplicateKeyError, OperationFailure
from typing import Annotated, List, Optional, Literal
from datetime import datetime, timezone
from collections import defaultdict, deque
import math
import time

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
# Above any real shop amount; stops a typo or a bad client from writing absurd figures.
MAX_MONEY = 100_000_000


def _money(v: float) -> float:
    if not math.isfinite(v):
        raise ValueError("amount must be a number")
    if v < 0:
        raise ValueError("amount cannot be negative")
    if v > MAX_MONEY:
        raise ValueError("amount is too large")
    return round(v, 2)


# Incoming amounts only; stored rows are read back as plain floats so old data always loads.
Money = Annotated[float, AfterValidator(_money)]
ISODate = Annotated[str, Field(pattern=r"^\d{4}-\d{2}-\d{2}$")]
OptISODate = Annotated[str, Field(pattern=r"^(\d{4}-\d{2}-\d{2})?$")]
Name = Annotated[str, Field(max_length=120)]
Short = Annotated[str, Field(max_length=300)]
Notes = Annotated[str, Field(max_length=2000)]


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
    updatedAt: Optional[str] = None


class CustomerCreate(BaseModel):
    id: Optional[str] = None
    # When the row was typed on the phone; offline rows can reach the server days later.
    createdAt: Optional[str] = None
    name: Name
    phone: str = Field("", max_length=20)
    address: Short = ""
    notes: Notes = ""
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
    title: Short
    amount: Money


def _check_amount(m):
    # Free work is still bookable when the shop paid a fee for it, so the cost shows up.
    free_with_fee = m.amount == 0 and m.type == "work" and (m.fee or 0) > 0
    if m.amount == 0 and not free_with_fee:
        raise ValueError("Amount must be greater than 0")
    return m


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
    updatedAt: Optional[str] = None


class EntryCreate(BaseModel):
    id: Optional[str] = None
    # When the row was typed on the phone; offline rows can reach the server days later.
    createdAt: Optional[str] = None
    customerId: str
    type: EntryType
    date: ISODate
    description: Short
    amount: Money
    paid: Money = 0
    mode: Optional[str] = "cash"
    fee: Optional[Money] = 0
    feeMode: Optional[str] = "online"
    notes: Notes = ""
    linkId: str = ""
    items: Optional[List[EntryItem]] = Field(None, max_length=200)

    @model_validator(mode="after")
    def validate_paid(self):
        return _check_paid(_check_amount(self))


class EntryUpdate(BaseModel):
    type: EntryType
    date: ISODate
    description: Short
    amount: Money
    paid: Optional[Money] = None
    mode: Optional[str] = None
    fee: Optional[Money] = None
    feeMode: Optional[str] = None
    notes: Notes = ""
    linkId: Optional[str] = None
    items: Optional[List[EntryItem]] = Field(None, max_length=200)

    @model_validator(mode="after")
    def validate_paid(self):
        return _check_paid(_check_amount(self))


class Job(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    customerId: str
    title: str
    dueDate: str
    status: Literal["pending", "doing", "done"] = "pending"
    estimatedAmount: float = 0
    notes: str = ""
    entryId: str = ""
    # "personal" marks a to-do of the personal book; shop jobs (and rows saved before this field) are "business".
    persona: Optional[str] = "business"
    priority: str = ""
    time: str = ""
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: Optional[str] = None


class JobCreate(BaseModel):
    id: Optional[str] = None
    # When the row was typed on the phone; offline rows can reach the server days later.
    createdAt: Optional[str] = None
    customerId: str
    title: Short
    dueDate: OptISODate
    status: Literal["pending", "doing", "done"] = "pending"
    estimatedAmount: Money = 0
    notes: Notes = ""
    entryId: str = ""
    persona: Optional[Literal["business", "personal"]] = "business"
    priority: Literal["", "high"] = ""
    time: str = Field("", max_length=5)


class JobUpdate(BaseModel):
    title: Optional[Short] = None
    dueDate: Optional[OptISODate] = None
    status: Optional[Literal["pending", "doing", "done"]] = None
    estimatedAmount: Optional[Money] = None
    notes: Optional[Notes] = None
    entryId: Optional[str] = None
    priority: Optional[Literal["", "high"]] = None
    time: Optional[str] = Field(None, max_length=5)


AepsType = Literal["withdrawal", "cash", "deposit", "transfer", "upi", "balance", "recharge", "bill", "other"]


class AepsFields(BaseModel):
    type: AepsType
    date: ISODate
    time: str = ""
    customerName: str = Field(min_length=1, max_length=80)
    mobile: str = Field("", max_length=15)
    # UIDAI rules forbid keeping full Aadhaar numbers; only the last four digits are accepted.
    aadhaarLast4: str = Field("", pattern=r"^\d{0,4}$")
    bankName: str = ""
    amount: Money = 0
    commission: Money = 0
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
    cashDate: Optional[OptISODate] = None
    # Day the bank side went through. "" while pending.
    doneDate: OptISODate = ""
    # Pending row the customer asked to be sent on a later day.
    dueDate: OptISODate = ""
    notes: Notes = ""
    # Shop customer this service was done for.
    customerId: str = ""
    # How it was done: AEPS (Aadhaar) / UPI / bank account / EMI.
    via: Literal["", "aeps", "upi", "bank", "emi"] = ""
    # Money the customer has handed over toward the amount, and how. None on older rows (= the full amount).
    collected: Optional[Money] = None
    payMode: Literal["", "cash", "online"] = ""


class AepsTxn(AepsFields):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: Optional[str] = None


class AepsCreate(AepsFields):
    id: Optional[str] = None
    # When the row was typed on the phone; offline rows can reach the server days later.
    createdAt: Optional[str] = None


class ExpenseFields(BaseModel):
    amount: Annotated[Money, Field(gt=0)]
    title: str = Field("खर्च", max_length=80)
    mode: Literal["cash", "online"] = "cash"
    date: ISODate
    notes: Notes = ""
    persona: Literal["business", "personal"] = "business"


class Expense(ExpenseFields):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: Optional[str] = None


class ExpenseCreate(ExpenseFields):
    id: Optional[str] = None
    createdAt: Optional[str] = None


AccountKey = Literal["", "business:cash", "business:bank", "personal:cash", "personal:bank"]


class MoneyMoveFields(BaseModel):
    date: ISODate
    # Source and destination account; "" is money from / to outside the app's accounts.
    src: AccountKey = ""
    dst: AccountKey = ""
    amount: Annotated[Money, Field(gt=0)]
    note: str = Field("", max_length=120)


class MoneyMove(MoneyMoveFields):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: Optional[str] = None


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

    # Only a provider-verified address may claim a khata saved under that email.
    verified = bool(claims.get("email_verified"))
    existing = None
    if firebase_uid:
        existing = await db.users.find_one({"firebase_uid": firebase_uid}, {"_id": 0})
    if not existing and email:
        by_email = await db.users.find_one({"email": email}, {"_id": 0})
        if by_email:
            if not verified:
                raise HTTPException(status_code=403, detail="Email not verified")
            existing = by_email

    now = datetime.now(timezone.utc).isoformat()
    if existing:
        user_id = existing["user_id"]
        patch = {"name": name, "picture": picture}
        if email and verified:
            patch["email"] = email
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
    try:
        await db.users.insert_one(doc)
    except DuplicateKeyError:
        # Two first requests of a new user raced; the other one created the row.
        again = await db.users.find_one({"firebase_uid": firebase_uid}, {"_id": 0}) if firebase_uid else None
        if again:
            return again
        raise HTTPException(status_code=409, detail="Account already exists")
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
    _rate_limit(claims.get("uid") or claims.get("sub") or token[-16:])
    return await upsert_user_from_claims(claims)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _rows(model, rows: list) -> list:
    """One odd stored row must never make the whole list fail to load; it is sent back as stored."""
    out = []
    for r in rows:
        try:
            out.append(model(**r))
        except Exception:
            logger.warning("Unreadable %s row %s sent unvalidated", model.__name__, r.get("id"))
            out.append(model.model_construct(**r))
    return out


def _check_base(existing: dict, base: Optional[str]):
    """The phone says which copy it edited; a newer copy saved elsewhere since then is not overwritten."""
    if base and existing.get("updatedAt") and existing["updatedAt"] != base:
        raise HTTPException(status_code=409, detail="Changed on another device")


BaseHeader = Header(None, alias="X-Base-Updated-At")


# Offline clients generate the id and may resend the same create after a dropped response.
async def _create_idempotent(collection, model, payload: BaseModel, user: dict):
    data = payload.dict(exclude_none=True)
    if data.get("id"):
        existing = await collection.find_one({"id": data["id"], "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
        if existing:
            return _rows(model, [existing])[0]
    obj = model(**data)
    doc = obj.dict()
    doc["updatedAt"] = _now()
    doc["user_id"] = user["user_id"]
    try:
        await collection.insert_one(doc)
    except DuplicateKeyError:
        # The same create from two sends at once; the first one won.
        existing = await collection.find_one({"id": doc["id"], "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
        if existing:
            return _rows(model, [existing])[0]
        raise
    doc.pop("_id", None)
    doc.pop("user_id", None)
    return model(**doc)


# Deleted rows are kept for a while so a wrong delete (or a cascade) can be recovered.
async def _archive_and_delete(coll_name: str, query: dict, user: dict, session=None):
    collection = db[coll_name]
    q = {**query, "user_id": user["user_id"]}
    docs = await collection.find(q, {"_id": 0}, session=session).to_list(None)
    if not docs:
        return
    now = datetime.now(timezone.utc)
    await db.deleted_items.insert_many(
        [{"user_id": user["user_id"], "coll": coll_name, "id": d.get("id", ""), "deletedAt": now, "doc": d} for d in docs],
        session=session,
    )
    await collection.delete_many(q, session=session)


async def _atomic(work):
    """All-or-nothing where the database supports transactions (Atlas does); plain steps otherwise."""
    try:
        async with await client.start_session() as s:
            async with s.start_transaction():
                return await work(s)
    except OperationFailure as e:
        # 20 / 263: a standalone server without transactions; nothing was written, so run it plainly.
        if e.code in (20, 263):
            return await work(None)
        raise


# --- Rate limit: per account, in memory (one server instance) ---
RATE_WINDOW_S = 60
RATE_MAX = 600
_hits: dict = defaultdict(deque)


def _rate_limit(key: str):
    now = time.monotonic()
    q = _hits[key]
    while q and now - q[0] > RATE_WINDOW_S:
        q.popleft()
    if len(q) >= RATE_MAX:
        raise HTTPException(status_code=429, detail="Too many requests, slow down")
    q.append(now)


# --- Auth Endpoints ---
@api_router.post("/auth/login", response_model=AuthResponse)
async def login_with_firebase(payload: LoginRequest):
    id_token = (payload.id_token or "").strip()
    if not id_token:
        raise HTTPException(status_code=401, detail="Missing id_token")
    if not FIREBASE_READY:
        raise HTTPException(status_code=503, detail="Firebase is not configured on the server")
    try:
        # Sign-in is rare, so it can afford the extra check that the account wasn't disabled / revoked.
        claims = firebase_auth.verify_id_token(id_token, check_revoked=True)
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid id_token")
    _rate_limit("login:" + (claims.get("uid") or ""))
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


@api_router.post("/shop/close", response_model=UserOut)
async def close_shop(user: dict = Depends(get_current_user)):
    """Removes the whole shop book; the personal book and money moved between the two books stay."""
    uid = user["user_id"]
    patch = {"shop_name": "", "shop_gst": "", "persona": "personal"}

    async def work(s):
        shop_customers = await db.customers.find({"user_id": uid, "persona": {"$ne": "personal"}}, {"_id": 0, "id": 1}, session=s).to_list(None)
        ids = [c["id"] for c in shop_customers]
        if ids:
            await _archive_and_delete("entries", {"customerId": {"$in": ids}}, user, s)
            await _archive_and_delete("jobs", {"customerId": {"$in": ids}}, user, s)
        await _archive_and_delete("customers", {"persona": {"$ne": "personal"}}, user, s)
        await _archive_and_delete("jobs", {"customerId": "", "persona": {"$ne": "personal"}}, user, s)
        await _archive_and_delete("aeps", {}, user, s)
        await _archive_and_delete("expenses", {"persona": {"$ne": "personal"}}, user, s)
        personal = re.compile(r"^personal:")
        await _archive_and_delete("moves", {"src": {"$not": personal}, "dst": {"$not": personal}}, user, s)
        await db.users.update_one({"user_id": uid}, {"$set": patch}, session=s)

    await _atomic(work)
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
    return _rows(Customer, rows)


@api_router.post("/customers", response_model=Customer)
async def create_customer(payload: CustomerCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.customers, Customer, payload, user)


@api_router.put("/customers/{customer_id}", response_model=Customer)
async def update_customer(customer_id: str, payload: CustomerCreate, user: dict = Depends(get_current_user), base: Optional[str] = BaseHeader):
    existing = await db.customers.find_one({"id": customer_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    _check_base(existing, base)
    patch = payload.dict(exclude={"id", "createdAt"})
    patch["updatedAt"] = _now()
    await db.customers.update_one({"id": customer_id, "user_id": user["user_id"]}, {"$set": patch})
    return _rows(Customer, [{**existing, **patch}])[0]


@api_router.delete("/customers/{customer_id}")
async def delete_customer(customer_id: str, user: dict = Depends(get_current_user)):
    async def work(s):
        await _archive_and_delete("customers", {"id": customer_id}, user, s)
        await _archive_and_delete("entries", {"customerId": customer_id}, user, s)
        await _archive_and_delete("jobs", {"customerId": customer_id}, user, s)
        # Counter rows carry their own galla / bank movement, so they stay; only the link goes.
        await db.aeps.update_many(
            {"customerId": customer_id, "user_id": user["user_id"]}, {"$set": {"customerId": "", "updatedAt": _now()}}, session=s
        )

    await _atomic(work)
    return {"ok": True}


# --- Entries ---
@api_router.get("/entries", response_model=List[Entry])
async def list_entries(user: dict = Depends(get_current_user)):
    rows = await db.entries.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return _rows(Entry, rows)


@api_router.post("/entries", response_model=Entry)
async def create_entry(payload: EntryCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.entries, Entry, payload, user)


@api_router.put("/entries/{entry_id}", response_model=Entry)
async def update_entry(entry_id: str, payload: EntryUpdate, user: dict = Depends(get_current_user), base: Optional[str] = BaseHeader):
    existing = await db.entries.find_one({"id": entry_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    _check_base(existing, base)
    # Free work stays bookable when the shop paid a fee for it.
    free_with_fee = payload.amount == 0 and payload.type == "work" and (payload.fee or 0) > 0
    if payload.amount < 0 or (payload.amount == 0 and not free_with_fee):
        raise HTTPException(422, "Amount must be greater than 0")
    patch = payload.dict(exclude_none=True)
    paid = patch.get("paid", existing.get("paid", 0)) if payload.type in PAID_TYPES else 0
    if paid > payload.amount:
        raise HTTPException(422, "paid cannot exceed amount")
    patch["paid"] = paid
    patch["updatedAt"] = _now()
    await db.entries.update_one({"id": entry_id, "user_id": user["user_id"]}, {"$set": patch})
    return _rows(Entry, [{**existing, **patch}])[0]


@api_router.delete("/entries/{entry_id}")
async def delete_entry(entry_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("entries", {"id": entry_id}, user)
    return {"ok": True}


# --- Jobs ---
@api_router.get("/jobs", response_model=List[Job])
async def list_jobs(user: dict = Depends(get_current_user)):
    rows = await db.jobs.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return _rows(Job, rows)


@api_router.post("/jobs", response_model=Job)
async def create_job(payload: JobCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.jobs, Job, payload, user)


@api_router.put("/jobs/{job_id}", response_model=Job)
async def update_job(job_id: str, payload: JobUpdate, user: dict = Depends(get_current_user), base: Optional[str] = BaseHeader):
    existing = await db.jobs.find_one({"id": job_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    patch = {k: v for k, v in payload.dict().items() if v is not None}
    if patch:
        _check_base(existing, base)
        patch["updatedAt"] = _now()
        await db.jobs.update_one({"id": job_id, "user_id": user["user_id"]}, {"$set": patch})
    return _rows(Job, [{**existing, **patch}])[0]


@api_router.delete("/jobs/{job_id}")
async def delete_job(job_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("jobs", {"id": job_id}, user)
    return {"ok": True}


# --- AEPS / money services ---
@api_router.get("/aeps", response_model=List[AepsTxn])
async def list_aeps(user: dict = Depends(get_current_user)):
    rows = await db.aeps.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return _rows(AepsTxn, rows)


@api_router.post("/aeps", response_model=AepsTxn)
async def create_aeps(payload: AepsCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.aeps, AepsTxn, payload, user)


@api_router.put("/aeps/{txn_id}", response_model=AepsTxn)
async def update_aeps(txn_id: str, payload: AepsFields, user: dict = Depends(get_current_user), base: Optional[str] = BaseHeader):
    existing = await db.aeps.find_one({"id": txn_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    _check_base(existing, base)
    patch = payload.dict()
    patch["updatedAt"] = _now()
    await db.aeps.update_one({"id": txn_id, "user_id": user["user_id"]}, {"$set": patch})
    return _rows(AepsTxn, [{**existing, **patch}])[0]


@api_router.delete("/aeps/{txn_id}")
async def delete_aeps(txn_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("aeps", {"id": txn_id}, user)
    return {"ok": True}


# --- Expenses and money moves (cash / bank adjustments) ---
@api_router.get("/expenses", response_model=List[Expense])
async def list_expenses(user: dict = Depends(get_current_user)):
    rows = await db.expenses.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return _rows(Expense, rows)


@api_router.post("/expenses", response_model=Expense)
async def create_expense(payload: ExpenseCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.expenses, Expense, payload, user)


@api_router.put("/expenses/{expense_id}", response_model=Expense)
async def update_expense(expense_id: str, payload: ExpenseFields, user: dict = Depends(get_current_user), base: Optional[str] = BaseHeader):
    existing = await db.expenses.find_one({"id": expense_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    _check_base(existing, base)
    patch = payload.dict()
    patch["updatedAt"] = _now()
    await db.expenses.update_one({"id": expense_id, "user_id": user["user_id"]}, {"$set": patch})
    return _rows(Expense, [{**existing, **patch}])[0]


@api_router.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("expenses", {"id": expense_id}, user)
    return {"ok": True}


@api_router.get("/moves", response_model=List[MoneyMove])
async def list_moves(user: dict = Depends(get_current_user)):
    rows = await db.moves.find({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0}).to_list(None)
    return _rows(MoneyMove, rows)


@api_router.post("/moves", response_model=MoneyMove)
async def create_move(payload: MoneyMoveCreate, user: dict = Depends(get_current_user)):
    return await _create_idempotent(db.moves, MoneyMove, payload, user)


@api_router.put("/moves/{move_id}", response_model=MoneyMove)
async def update_move(move_id: str, payload: MoneyMoveFields, user: dict = Depends(get_current_user), base: Optional[str] = BaseHeader):
    existing = await db.moves.find_one({"id": move_id, "user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    if not existing:
        raise HTTPException(404, "Not found")
    _check_base(existing, base)
    patch = payload.dict()
    patch["updatedAt"] = _now()
    await db.moves.update_one({"id": move_id, "user_id": user["user_id"]}, {"$set": patch})
    return _rows(MoneyMove, [{**existing, **patch}])[0]


@api_router.delete("/moves/{move_id}")
async def delete_move(move_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("moves", {"id": move_id}, user)
    return {"ok": True}


@api_router.get("/")
async def root():
    return {"message": "Nain Hisab API"}


app.include_router(api_router)

# Auth is a bearer token, never a cookie, so credentials mode is off (and "*" stays safe).
app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
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
    for name in ("customers", "entries", "jobs", "aeps", "expenses", "moves"):
        await _unique_row_ids(name)
    await db.entries.create_index([("user_id", 1), ("customerId", 1)])
    await db.entries.create_index([("user_id", 1), ("date", -1)])
    await db.jobs.create_index([("user_id", 1), ("status", 1), ("dueDate", 1)])
    await db.aeps.create_index([("user_id", 1), ("date", -1)])
    await db.deleted_items.create_index([("user_id", 1), ("coll", 1), ("id", 1)])
    await db.deleted_items.create_index("deletedAt", expireAfterSeconds=60 * 60 * 24 * 180)
    await _repair_null_created_at()


async def _unique_row_ids(name: str):
    """One row per (account, id): extra copies from two devices sending the same create are archived, then the index turns unique."""
    coll = db[name]
    try:
        info = await coll.index_information()
        old = info.get("user_id_1_id_1")
        if old and old.get("unique"):
            return
        dupes = coll.aggregate([
            {"$group": {"_id": {"u": "$user_id", "i": "$id"}, "ids": {"$push": "$_id"}, "n": {"$sum": 1}}},
            {"$match": {"n": {"$gt": 1}}},
        ], allowDiskUse=True)
        async for g in dupes:
            extra = g["ids"][1:]
            docs = await coll.find({"_id": {"$in": extra}}).to_list(None)
            now = datetime.now(timezone.utc)
            await db.deleted_items.insert_many([
                {"user_id": d.get("user_id"), "coll": name, "id": d.get("id", ""), "deletedAt": now, "doc": {k: v for k, v in d.items() if k != "_id"}, "reason": "duplicate"}
                for d in docs
            ])
            await coll.delete_many({"_id": {"$in": extra}})
        if old:
            await coll.drop_index("user_id_1_id_1")
        await coll.create_index([("user_id", 1), ("id", 1)], unique=True)
    except Exception:
        logger.exception("Unique index for %s failed; keeping the plain one", name)
        try:
            await coll.create_index([("user_id", 1), ("id", 1)])
        except Exception:
            pass


async def _repair_null_created_at():
    """Customer edits once wrote createdAt: null, which made GET /customers fail; the ObjectId keeps the real insert time."""
    try:
        async for doc in db.customers.find({"createdAt": None}, {"_id": 1}):
            when = doc["_id"].generation_time.isoformat()
            await db.customers.update_one({"_id": doc["_id"]}, {"$set": {"createdAt": when}})
    except Exception:
        logger.exception("createdAt repair failed")


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
