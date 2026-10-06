from fastapi import FastAPI, APIRouter, Header, HTTPException, Depends
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv
from html import escape
from urllib.parse import quote
import secrets
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
from datetime import datetime, timedelta, timezone
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
    shop_logo: str = ""
    shop_signature: str = ""


_IMAGE_URI = re.compile(r"^data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$")


def _image_uri(max_bytes: int):
    """An inline image for slips: "" (none) or a png / jpeg / webp data URI no bigger than max_bytes."""

    def check(v: Optional[str]) -> Optional[str]:
        if v is None or v == "":
            return v
        m = _IMAGE_URI.match(v)
        if not m:
            raise ValueError("image must be a png, jpeg or webp data URI")
        b64 = m.group(2)
        if len(b64) * 3 // 4 - b64.count("=") > max_bytes:
            raise ValueError(f"image is larger than {max_bytes // 1024} KB")
        return v

    return AfterValidator(check)


class ProfileUpdate(BaseModel):
    shop_name: str = Field(max_length=60)
    shop_phone: Optional[str] = Field(default=None, max_length=20)
    shop_address: Optional[str] = Field(default=None, max_length=120)
    shop_gst: Optional[str] = Field(default=None, max_length=20)
    shop_upi: Optional[str] = Field(default=None, max_length=50)
    owner_name: Optional[str] = Field(default=None, max_length=60)
    persona: Optional[str] = Field(default=None, max_length=20)
    shop_logo: Annotated[Optional[str], _image_uri(100 * 1024)] = None
    shop_signature: Annotated[Optional[str], _image_uri(25 * 1024)] = None


class AuthResponse(BaseModel):
    user: UserOut


class Customer(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    phone: str = ""
    address: str = ""
    notes: str = ""
    persona: Optional[str] = "business"
    creditLimit: float = 0
    remindOn: str = ""
    # "vendor": someone the shop buys from / outsources work to; their balance is what the shop owes.
    role: str = "customer"
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
    # Udhaar ceiling; 0 = none. Left out by older app builds, which must not wipe it.
    creditLimit: Optional[Money] = None
    # Day to chase the udhaar (YYYY-MM-DD, "" = none); same rule for older builds.
    remindOn: Optional[OptISODate] = None
    role: Optional[Literal["customer", "vendor"]] = None


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
    # Free work is still bookable when the shop paid a fee or a vendor for it, so the cost shows up
    # (the vendor's cost is a separate purchase row pointing at this one).
    free_work = m.amount == 0 and m.type == "work"
    if m.amount == 0 and not free_work:
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
    # Vendor orders (purchase rows): promised date, delivery state and the terms printed on the work order.
    dueDate: str = ""
    status: str = ""
    terms: str = ""
    # Vendor cost row of an outsourced job: id of the customer's work row it belongs to.
    refId: str = ""
    # Day a pending job was handed to the vendor; the row's own date moves to the day the work was finished.
    assignedOn: str = ""
    createdAt: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updatedAt: Optional[str] = None


VendorStatus = Literal["", "ordered", "delivered"]


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
    dueDate: OptISODate = ""
    status: VendorStatus = ""
    terms: Notes = ""
    refId: str = Field("", max_length=64)
    assignedOn: OptISODate = ""

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
    # Left out by older app builds, which must not wipe them.
    dueDate: Optional[OptISODate] = None
    status: Optional[VendorStatus] = None
    terms: Optional[Notes] = None
    refId: Optional[str] = Field(None, max_length=64)
    assignedOn: Optional[OptISODate] = None

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
    # Customer paid the amount but still owes the commission; it waits on their khata.
    commissionDue: bool = False


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

HISTORY_SKIP = {"updatedAt", "createdAt", "id", "user_id", "_id"}


async def _log_change(coll: str, existing: dict, patch: dict, user: dict):
    """Keeps the old and new value of every field an edit changed, for disputes; never blocks the edit."""
    changes = {
        k: [existing.get(k), v]
        for k, v in patch.items()
        if k not in HISTORY_SKIP and existing.get(k) != v and not (existing.get(k) in (None, "", 0) and v in (None, "", 0))
    }
    if not changes:
        return
    try:
        await db.edit_history.insert_one(
            {"user_id": user["user_id"], "coll": coll, "id": existing["id"], "at": datetime.now(timezone.utc), "changes": changes}
        )
    except Exception:
        logger.exception("edit history write failed for %s %s", coll, existing.get("id"))


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
        shop_logo=user.get("shop_logo", ""),
        shop_signature=user.get("shop_signature", ""),
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


ARCHIVE_COLLS = ("customers", "entries", "jobs", "aeps", "expenses", "moves")


@api_router.get("/archive")
async def list_archive(user: dict = Depends(get_current_user), limit: int = 300):
    """Rows deleted in the last 180 days, newest first (duplicate clean-ups left out)."""
    limit = max(1, min(limit, 1000))
    cur = db.deleted_items.find(
        {"user_id": user["user_id"], "coll": {"$in": list(ARCHIVE_COLLS)}, "reason": {"$exists": False}},
        {"_id": 0, "user_id": 0},
    ).sort("deletedAt", -1).limit(limit)
    out = []
    async for d in cur:
        doc = {k: v for k, v in (d.get("doc") or {}).items() if k != "user_id"}
        out.append({"coll": d["coll"], "id": d.get("id", ""), "deletedAt": d["deletedAt"].isoformat() if hasattr(d["deletedAt"], "isoformat") else str(d["deletedAt"]), "doc": doc})
    return out


class RestoreIn(BaseModel):
    coll: Literal["customers", "entries", "jobs", "aeps", "expenses", "moves"]
    id: str = Field(min_length=1, max_length=80)


@api_router.post("/archive/restore")
async def restore_archive(payload: RestoreIn, user: dict = Depends(get_current_user)):
    """Puts a deleted row back; a customer comes back with the entries and jobs deleted along with it."""
    uid = user["user_id"]
    item = await db.deleted_items.find_one(
        {"user_id": uid, "coll": payload.coll, "id": payload.id, "reason": {"$exists": False}}, sort=[("deletedAt", -1)]
    )
    if not item:
        raise HTTPException(404, "Not in the archive")
    if await db[payload.coll].find_one({"user_id": uid, "id": payload.id}, {"_id": 1}):
        raise HTTPException(409, "Already exists")
    item_doc = item.get("doc") or {}

    async def aeps_exists(aeps_id: Optional[str]) -> bool:
        return bool(aeps_id) and bool(await db.aeps.find_one({"user_id": uid, "id": aeps_id}, {"_id": 1}))

    async def customer_exists(customer_id: Optional[str]) -> bool:
        return bool(customer_id) and bool(await db.customers.find_one({"user_id": uid, "id": customer_id}, {"_id": 1}))

    # A counter due without its counter row would be udhaar with nothing behind it.
    if payload.coll == "entries" and item_doc.get("type") == "aeps" and not await aeps_exists(item_doc.get("linkId")):
        raise HTTPException(422, "Counter row is deleted")

    group = [item]
    overrides: dict = {}
    if payload.coll == "customers":
        rows = await db.deleted_items.find(
            {"user_id": uid, "coll": {"$in": ["entries", "jobs"]}, "deletedAt": item["deletedAt"], "doc.customerId": payload.id}
        ).to_list(None)
        for g in rows:
            d = g.get("doc") or {}
            if g["coll"] == "entries" and d.get("type") == "aeps" and not await aeps_exists(d.get("linkId")):
                continue
            group.append(g)
    elif payload.coll == "aeps":
        # removeAeps deletes the row with its due and jama entries in separate calls moments apart.
        window = timedelta(minutes=5)
        rows = await db.deleted_items.find(
            {
                "user_id": uid,
                "coll": "entries",
                "doc.linkId": payload.id,
                "reason": {"$exists": False},
                "deletedAt": {"$gte": item["deletedAt"] - window, "$lte": item["deletedAt"] + window},
            }
        ).to_list(None)
        for g in rows:
            if await customer_exists((g.get("doc") or {}).get("customerId")):
                group.append(g)
        if item_doc.get("customerId") and not await customer_exists(item_doc.get("customerId")):
            overrides[id(item)] = {"customerId": ""}
    now = _now()
    restored = 0

    async def work(s):
        nonlocal restored
        back: list = []
        for g in group:
            doc = {k: v for k, v in (g.get("doc") or {}).items() if k not in ("_id", "user_id")}
            doc.update(overrides.get(id(g), {}))
            if await db[g["coll"]].find_one({"user_id": uid, "id": doc.get("id")}, {"_id": 1}, session=s):
                continue
            await db[g["coll"]].insert_one({**doc, "user_id": uid, "updatedAt": now}, session=s)
            await db.deleted_items.delete_one({"_id": g["_id"]}, session=s)
            back.append((g["coll"], doc))
            restored += 1
        if payload.coll != "customers":
            return
        linked = [d for c, d in back if c == "entries" and d.get("type") in ("aeps", "payment") and d.get("linkId")]
        # Counter rows unlinked when the customer was deleted belong to them again.
        await db.aeps.update_many(
            {"user_id": uid, "id": {"$in": list({d["linkId"] for d in linked})}, "customerId": ""},
            {"$set": {"customerId": payload.id, "updatedAt": now}},
            session=s,
        )
        # The counter jama is back on the khata, so the stand-in "money added" rows made at delete time go.
        for d in linked:
            if d.get("type") != "payment" or not await db.aeps.find_one({"user_id": uid, "id": d["linkId"]}, {"_id": 1}, session=s):
                continue
            await db.moves.delete_one(
                {
                    "user_id": uid,
                    "src": "",
                    "date": d.get("date"),
                    "amount": d.get("amount"),
                    "createdAt": d.get("createdAt"),
                    "note": {"$regex": r"\(खाता हटाया\)$"},
                },
                session=s,
            )

    await _atomic(work)
    return {"ok": True, "restored": restored}


class SettingsIn(BaseModel):
    data: dict
    updatedAt: str = Field(min_length=10, max_length=40)


# Slip logo, slip note, reminder text, default mode and budget; the logo is a small JPEG data URI.
MAX_SETTINGS_CHARS = 400_000


@api_router.get("/settings")
async def get_settings(user: dict = Depends(get_current_user)):
    doc = await db.settings.find_one({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    return doc or {"data": None, "updatedAt": ""}


@api_router.put("/settings")
async def put_settings(payload: SettingsIn, user: dict = Depends(get_current_user)):
    if len(json.dumps(payload.data, ensure_ascii=False)) > MAX_SETTINGS_CHARS:
        raise HTTPException(413, "settings too large")
    existing = await db.settings.find_one({"user_id": user["user_id"]}, {"_id": 0, "user_id": 0})
    # A phone that was offline for a while must not overwrite what another phone saved since.
    if existing and existing.get("updatedAt", "") > payload.updatedAt:
        return existing
    doc = {"data": payload.data, "updatedAt": payload.updatedAt}
    await db.settings.update_one({"user_id": user["user_id"]}, {"$set": doc}, upsert=True)
    return doc


@api_router.get("/history/{coll}/{item_id}")
async def get_history(coll: Literal["customers", "entries", "jobs", "aeps", "expenses", "moves"], item_id: str, user: dict = Depends(get_current_user)):
    rows = await db.edit_history.find(
        {"user_id": user["user_id"], "coll": coll, "id": item_id}, {"_id": 0, "user_id": 0}
    ).sort("at", -1).to_list(100)
    for r in rows:
        r["at"] = r["at"].replace(tzinfo=timezone.utc).isoformat()
    return rows


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
    for key in ("creditLimit", "remindOn", "role"):
        if patch.get(key) is None:
            patch.pop(key, None)
    patch["updatedAt"] = _now()
    await db.customers.update_one({"id": customer_id, "user_id": user["user_id"]}, {"$set": patch})
    await _log_change("customers", existing, patch, user)
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
    # Free work stays bookable when the shop paid a fee or a vendor for it.
    free_work = payload.amount == 0 and payload.type == "work"
    if payload.amount < 0 or (payload.amount == 0 and not free_work):
        raise HTTPException(422, "Amount must be greater than 0")
    patch = payload.dict(exclude_none=True)
    paid = patch.get("paid", existing.get("paid", 0)) if payload.type in PAID_TYPES else 0
    if paid > payload.amount:
        raise HTTPException(422, "paid cannot exceed amount")
    patch["paid"] = paid
    patch["updatedAt"] = _now()
    await db.entries.update_one({"id": entry_id, "user_id": user["user_id"]}, {"$set": patch})
    await _log_change("entries", existing, patch, user)
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
        await _log_change("jobs", existing, patch, user)
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
    await _log_change("aeps", existing, patch, user)
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
    await _log_change("expenses", existing, patch, user)
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
    await _log_change("moves", existing, patch, user)
    return _rows(MoneyMove, [{**existing, **patch}])[0]


@api_router.delete("/moves/{move_id}")
async def delete_move(move_id: str, user: dict = Depends(get_current_user)):
    await _archive_and_delete("moves", {"id": move_id}, user)
    return {"ok": True}


# --- Customer ledger link: a read-only page the customer opens without signing in ---
async def _own_customer(customer_id: str, user: dict) -> dict:
    c = await db.customers.find_one({"id": customer_id, "user_id": user["user_id"]}, {"_id": 0})
    if not c:
        raise HTTPException(404, "Not found")
    return c


@api_router.get("/customers/{customer_id}/ledger-link")
async def get_ledger_link(customer_id: str, user: dict = Depends(get_current_user)):
    await _own_customer(customer_id, user)
    doc = await db.ledger_links.find_one({"user_id": user["user_id"], "customerId": customer_id}, {"_id": 0, "token": 1})
    return {"token": doc["token"] if doc else ""}


@api_router.post("/customers/{customer_id}/ledger-link")
async def create_ledger_link(customer_id: str, user: dict = Depends(get_current_user)):
    await _own_customer(customer_id, user)
    existing = await db.ledger_links.find_one({"user_id": user["user_id"], "customerId": customer_id}, {"_id": 0, "token": 1})
    if existing:
        return {"token": existing["token"]}
    token = secrets.token_urlsafe(16)
    await db.ledger_links.insert_one({"token": token, "user_id": user["user_id"], "customerId": customer_id, "createdAt": _now()})
    return {"token": token}


@api_router.delete("/customers/{customer_id}/ledger-link")
async def revoke_ledger_link(customer_id: str, user: dict = Depends(get_current_user)):
    await db.ledger_links.delete_many({"user_id": user["user_id"], "customerId": customer_id})
    return {"ok": True}


def _entry_delta(e: dict) -> float:
    amount, paid, kind = e.get("amount") or 0, e.get("paid") or 0, e.get("type")
    if kind == "work":
        return amount - paid
    if kind == "purchase":
        return -(amount - paid)
    if kind in ("aeps", "given"):
        return amount
    return -amount


ENTRY_WORDS = {"work": "काम", "payment": "पैसे मिले", "given": "पैसे दिए", "purchase": "सामान लिया", "aeps": "काउंटर सेवा"}
LEDGER_CSS = """
body{margin:0;font-family:system-ui,-apple-system,'Noto Sans Devanagari',sans-serif;background:#FDFBF7;color:#1f2937}
.wrap{max-width:560px;margin:0 auto;padding:20px 16px 40px}
.shop{font-size:14px;color:#6b7280}.shop b{color:#00796B;font-size:18px;display:block}
.card{background:#fff;border:1px solid #e5e7eb;border-radius:16px;padding:18px;margin:16px 0}
.label{font-size:13px;color:#6b7280}.big{font-size:34px;font-weight:800;margin-top:4px}
.due{color:#B91C1C}.ok{color:#047857}
.pay{display:block;text-align:center;background:#00796B;color:#fff;text-decoration:none;font-weight:700;padding:14px;border-radius:12px;margin-top:14px}
.row{display:flex;justify-content:space-between;gap:12px;padding:12px 0;border-bottom:1px solid #f1f5f9}
.row:last-child{border-bottom:0}.d{font-size:12px;color:#6b7280}.t{font-size:15px;font-weight:600}
.amt{font-weight:700;white-space:nowrap}.foot{font-size:12px;color:#9ca3af;text-align:center;margin-top:24px}
"""


def _inr(n: float) -> str:
    n = round(n, 2)
    whole, frac = divmod(abs(n), 1)
    s = f"{int(whole):d}"
    if len(s) > 3:
        head, tail = s[:-3], s[-3:]
        head = ",".join([head[max(0, i - 2):i] for i in range(len(head), 0, -2)][::-1])
        s = f"{head},{tail}"
    if frac:
        s += f".{round(frac * 100):02d}"
    return f"₹{s}"


def _ledger_page(body: str, status: int = 200) -> HTMLResponse:
    html = (
        "<!doctype html><html lang='hi'><head><meta charset='utf-8'>"
        "<meta name='viewport' content='width=device-width,initial-scale=1'>"
        "<meta name='robots' content='noindex,nofollow'><title>हिसाब</title>"
        f"<style>{LEDGER_CSS}</style></head><body><div class='wrap'>{body}</div></body></html>"
    )
    return HTMLResponse(html, status_code=status, headers={"Cache-Control": "no-store", "Referrer-Policy": "no-referrer"})


@app.get("/l/{token}", include_in_schema=False)
async def public_ledger(token: str):
    link = await db.ledger_links.find_one({"token": token}) if len(token) <= 64 else None
    customer = link and await db.customers.find_one({"id": link["customerId"], "user_id": link["user_id"]})
    if not customer:
        return _ledger_page("<div class='card'><div class='t'>यह लिंक अब चालू नहीं है।</div><div class='d'>दुकान से नया लिंक माँगें।</div></div>", 404)
    owner = await db.users.find_one({"user_id": link["user_id"]}) or {}
    entries = await db.entries.find({"user_id": link["user_id"], "customerId": customer["id"]}, {"_id": 0}).to_list(None)
    due = round(sum(_entry_delta(e) for e in entries), 2)
    entries.sort(key=lambda e: (e.get("date", ""), e.get("createdAt", "")), reverse=True)

    shop = escape(owner.get("shop_name") or owner.get("name") or "दुकान")
    phone = escape(owner.get("shop_phone") or "")
    upi = (owner.get("shop_upi") or "").strip()
    if due > 0:
        head = f"<div class='label'>आपको देने हैं</div><div class='big due'>{_inr(due)}</div>"
    elif due < 0:
        head = f"<div class='label'>आपका जमा</div><div class='big ok'>{_inr(-due)}</div>"
    else:
        head = "<div class='label'>हिसाब</div><div class='big ok'>बराबर ✓</div>"
    if due > 0 and upi:
        pay_url = f"upi://pay?pa={quote(upi)}&pn={quote(owner.get('shop_name') or 'Shop')}&am={due:.2f}&cu=INR"
        head += f"<a class='pay' href='{escape(pay_url)}'>UPI से {_inr(due)} भेजें</a>"

    rows = []
    for e in entries[:200]:
        delta = _entry_delta(e)
        word = ENTRY_WORDS.get(e.get("type"), "")
        desc = escape(e.get("description") or "")
        paid = e.get("paid") or 0
        extra = f" · {_inr(e.get('amount') or 0)} में से {_inr(paid)} उसी समय मिले" if e.get("type") == "work" and paid else ""
        cls = "due" if delta > 0 else "ok"
        sign = "+" if delta > 0 else "−" if delta < 0 else ""
        rows.append(
            f"<div class='row'><div><div class='t'>{escape(word)}{' · ' + desc if desc else ''}</div>"
            f"<div class='d'>{escape(e.get('date', ''))}{extra}</div></div>"
            f"<div class='amt {cls}'>{sign}{_inr(abs(delta)) if delta else _inr(e.get('amount') or 0)}</div></div>"
        )
    more = f"<div class='d'>पुरानी {len(entries) - 200} एंट्री नहीं दिखाई गईं</div>" if len(entries) > 200 else ""
    body = (
        f"<div class='shop'><b>{shop}</b>{phone}</div>"
        f"<div class='card'><div class='label'>{escape(customer.get('name', ''))}</div>{head}</div>"
        f"<div class='card'>{''.join(rows) or '<div class=d>अभी कोई एंट्री नहीं</div>'}{more}</div>"
        f"<div class='foot'>यह हिसाब {shop} ने भेजा है · सिर्फ़ देखने के लिए</div>"
    )
    return _ledger_page(body)


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
    await db.settings.create_index("user_id", unique=True)
    await db.edit_history.create_index([("user_id", 1), ("coll", 1), ("id", 1), ("at", -1)])
    await db.ledger_links.create_index("token", unique=True)
    await db.ledger_links.create_index([("user_id", 1), ("customerId", 1)])
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
