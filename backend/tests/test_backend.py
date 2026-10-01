"""Backend API tests for Nain Photo State — Hisab (Hindi khata) app."""
import uuid

import pytest


# --- Auth Endpoints -----------------------------------------------------
class TestAuthEndpoints:
    def test_login_missing_id_token_returns_401(self, anon_session, api_url):
        r = anon_session.post(f"{api_url}/auth/login", json={"id_token": ""})
        assert r.status_code in (401, 503)

    def test_login_invalid_id_token_returns_error(self, anon_session, api_url):
        r = anon_session.post(
            f"{api_url}/auth/login",
            json={"id_token": "definitely_not_a_valid_firebase_id_token_xxx"},
        )
        assert r.status_code in (401, 503)

    def test_me_without_token_returns_401(self, anon_session, api_url):
        r = anon_session.get(f"{api_url}/auth/me")
        assert r.status_code == 401

    def test_me_with_invalid_token_returns_401(self, anon_session, api_url):
        r = anon_session.get(
            f"{api_url}/auth/me",
            headers={"Authorization": "Bearer invalid_bogus_token"},
        )
        assert r.status_code == 401

    def test_me_with_malformed_authorization_header_returns_401(self, anon_session, api_url):
        r = anon_session.get(
            f"{api_url}/auth/me",
            headers={"Authorization": "Token abc"},
        )
        assert r.status_code == 401

    def test_me_with_valid_token_returns_user(self, session_a, api_url, user_a):
        r = session_a.get(f"{api_url}/auth/me")
        assert r.status_code == 200
        data = r.json()
        assert data["user_id"].startswith("user_")
        assert data["email"] == user_a["email"]
        assert data["name"] == user_a["name"]
        assert "_id" not in data

    def test_update_shop_name_persists(self, session_a, api_url):
        r = session_a.put(f"{api_url}/auth/me", json={"shop_name": "  TEST Shop  "})
        assert r.status_code == 200
        assert r.json()["shop_name"] == "TEST Shop"
        assert session_a.get(f"{api_url}/auth/me").json()["shop_name"] == "TEST Shop"

    def test_update_shop_name_requires_auth(self, anon_session, api_url):
        r = anon_session.put(f"{api_url}/auth/me", json={"shop_name": "x"})
        assert r.status_code == 401

    def test_logout_without_token_returns_ok(self, anon_session, api_url):
        r = anon_session.post(f"{api_url}/auth/logout")
        assert r.status_code == 200
        assert r.json() == {"ok": True}

    def test_logout_with_bogus_token_returns_ok(self, anon_session, api_url):
        r = anon_session.post(
            f"{api_url}/auth/logout",
            headers={"Authorization": "Bearer some_bogus_token_that_does_not_exist"},
        )
        assert r.status_code == 200
        assert r.json() == {"ok": True}


# --- Customers CRUD ------------------------------------------------------
class TestCustomersCRUD:
    created_ids = []

    def test_create_customer(self, session_a, api_url):
        payload = {
            "name": "TEST_Ramesh Kumar",
            "phone": "9999900001",
            "address": "TEST Address 1",
            "notes": "TEST notes",
        }
        r = session_a.post(f"{api_url}/customers", json=payload)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == payload["name"]
        assert data["phone"] == payload["phone"]
        assert "id" in data and data["id"]
        assert "_id" not in data
        assert "user_id" not in data
        assert "createdAt" in data
        TestCustomersCRUD.created_ids.append(data["id"])

    def test_list_customers_includes_created(self, session_a, api_url):
        r = session_a.get(f"{api_url}/customers")
        assert r.status_code == 200
        rows = r.json()
        assert isinstance(rows, list)
        assert any(c["id"] == TestCustomersCRUD.created_ids[0] for c in rows)
        for c in rows:
            assert "_id" not in c
            assert "user_id" not in c

    def test_update_customer(self, session_a, api_url):
        cid = TestCustomersCRUD.created_ids[0]
        r = session_a.put(
            f"{api_url}/customers/{cid}",
            json={"name": "TEST_Ramesh Updated", "phone": "8888800002",
                  "address": "New addr", "notes": "updated"},
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["name"] == "TEST_Ramesh Updated"
        assert data["phone"] == "8888800002"
        assert "_id" not in data

        # verify persistence via GET
        r2 = session_a.get(f"{api_url}/customers")
        found = [c for c in r2.json() if c["id"] == cid]
        assert found and found[0]["name"] == "TEST_Ramesh Updated"

    def test_update_nonexistent_customer_returns_404(self, session_a, api_url):
        r = session_a.put(
            f"{api_url}/customers/nonexistent_id_123",
            json={"name": "x", "phone": "", "address": "", "notes": ""},
        )
        assert r.status_code == 404

    def test_customers_endpoint_requires_auth(self, anon_session, api_url):
        assert anon_session.get(f"{api_url}/customers").status_code == 401
        assert anon_session.post(f"{api_url}/customers", json={"name": "x"}).status_code == 401


# --- Entries CRUD --------------------------------------------------------
class TestEntriesCRUD:
    customer_id = None
    entry_ids = []

    def test_setup_customer(self, session_a, api_url):
        r = session_a.post(f"{api_url}/customers", json={"name": "TEST_EntryCustomer"})
        assert r.status_code == 200
        TestEntriesCRUD.customer_id = r.json()["id"]

    def test_create_work_entry(self, session_a, api_url):
        assert TestEntriesCRUD.customer_id
        payload = {
            "customerId": TestEntriesCRUD.customer_id,
            "type": "work",
            "date": "2026-01-15",
            "description": "TEST Photo work",
            "amount": 500.0,
            "notes": "TEST",
        }
        r = session_a.post(f"{api_url}/entries", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "work"
        assert d["amount"] == 500.0
        assert "_id" not in d
        assert "user_id" not in d
        TestEntriesCRUD.entry_ids.append(d["id"])

    def test_create_payment_entry(self, session_a, api_url):
        payload = {
            "customerId": TestEntriesCRUD.customer_id,
            "type": "payment",
            "date": "2026-01-16",
            "description": "TEST Payment received",
            "amount": 200.0,
        }
        r = session_a.post(f"{api_url}/entries", json=payload)
        assert r.status_code == 200
        TestEntriesCRUD.entry_ids.append(r.json()["id"])

    def test_given_entry(self, session_a, api_url):
        base = {"customerId": TestEntriesCRUD.customer_id, "type": "given", "date": "2026-01-16", "description": "TEST loan", "amount": 300}
        r = session_a.post(f"{api_url}/entries", json=base)
        assert r.status_code == 200, r.text
        assert r.json()["type"] == "given" and r.json()["paid"] == 0
        assert session_a.post(f"{api_url}/entries", json={**base, "paid": 100}).status_code == 422
        eid = r.json()["id"]
        u = session_a.put(f"{api_url}/entries/{eid}", json={**base, "amount": 350, "paid": 0})
        assert u.status_code == 200 and u.json()["amount"] == 350
        session_a.delete(f"{api_url}/entries/{eid}")

    def test_create_invalid_entry_type_rejected(self, session_a, api_url):
        r = session_a.post(f"{api_url}/entries", json={
            "customerId": TestEntriesCRUD.customer_id,
            "type": "invalid_type", "date": "2026-01-15",
            "description": "x", "amount": 10,
        })
        assert r.status_code == 422

    def test_list_entries(self, session_a, api_url):
        r = session_a.get(f"{api_url}/entries")
        assert r.status_code == 200
        rows = r.json()
        for e in rows:
            assert "_id" not in e and "user_id" not in e
        found = [e for e in rows if e["id"] in TestEntriesCRUD.entry_ids]
        assert len(found) == 2

    def test_update_entry(self, session_a, api_url):
        eid = TestEntriesCRUD.entry_ids[1]
        r = session_a.put(f"{api_url}/entries/{eid}", json={
            "type": "payment",
            "date": "2026-01-17",
            "description": "TEST Payment edited",
            "amount": 250,
            "notes": "corrected",
        })
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] == eid
        assert d["amount"] == 250
        assert d["description"] == "TEST Payment edited"
        assert d["customerId"] == TestEntriesCRUD.customer_id
        bad = session_a.put(f"{api_url}/entries/{eid}", json={
            "type": "payment", "date": "2026-01-17", "description": "x", "amount": 0,
        })
        assert bad.status_code == 422

    def test_delete_entry(self, session_a, api_url):
        eid = TestEntriesCRUD.entry_ids[0]
        r = session_a.delete(f"{api_url}/entries/{eid}")
        assert r.status_code == 200
        assert r.json() == {"ok": True}
        # verify deletion
        rows = session_a.get(f"{api_url}/entries").json()
        assert not any(e["id"] == eid for e in rows)

    def test_entries_require_auth(self, anon_session, api_url):
        assert anon_session.get(f"{api_url}/entries").status_code == 401


# --- Jobs CRUD -----------------------------------------------------------
class TestJobsCRUD:
    customer_id = None
    job_id = None

    def test_setup_customer(self, session_a, api_url):
        r = session_a.post(f"{api_url}/customers", json={"name": "TEST_JobCustomer"})
        assert r.status_code == 200
        TestJobsCRUD.customer_id = r.json()["id"]

    def test_create_job(self, session_a, api_url):
        payload = {
            "customerId": TestJobsCRUD.customer_id,
            "title": "TEST Wedding shoot",
            "dueDate": "2026-02-01",
            "status": "pending",
            "estimatedAmount": 5000.0,
            "notes": "TEST",
        }
        r = session_a.post(f"{api_url}/jobs", json=payload)
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["title"] == "TEST Wedding shoot"
        assert d["status"] == "pending"
        assert "_id" not in d and "user_id" not in d
        TestJobsCRUD.job_id = d["id"]

    def test_update_job_status(self, session_a, api_url):
        r = session_a.put(
            f"{api_url}/jobs/{TestJobsCRUD.job_id}",
            json={"status": "doing"},
        )
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "doing"
        # verify persistence
        rows = session_a.get(f"{api_url}/jobs").json()
        found = [j for j in rows if j["id"] == TestJobsCRUD.job_id]
        assert found and found[0]["status"] == "doing"

    def test_update_job_invalid_status_rejected(self, session_a, api_url):
        r = session_a.put(
            f"{api_url}/jobs/{TestJobsCRUD.job_id}",
            json={"status": "invalid_status"},
        )
        assert r.status_code == 422

    def test_update_nonexistent_job_returns_404(self, session_a, api_url):
        r = session_a.put(f"{api_url}/jobs/nonexistent_id", json={"status": "done"})
        assert r.status_code == 404

    def test_list_jobs(self, session_a, api_url):
        r = session_a.get(f"{api_url}/jobs")
        assert r.status_code == 200
        for j in r.json():
            assert "_id" not in j and "user_id" not in j

    def test_delete_job(self, session_a, api_url):
        r = session_a.delete(f"{api_url}/jobs/{TestJobsCRUD.job_id}")
        assert r.status_code == 200
        rows = session_a.get(f"{api_url}/jobs").json()
        assert not any(j["id"] == TestJobsCRUD.job_id for j in rows)


# --- Cascade delete ------------------------------------------------------
class TestOfflineIdempotency:
    def test_client_id_create_is_idempotent(self, session_a, api_url):
        cid = f"offline-{uuid.uuid4()}"
        body = {"id": cid, "name": "TEST_Offline"}
        first = session_a.post(f"{api_url}/customers", json=body)
        second = session_a.post(f"{api_url}/customers", json=body)
        assert first.status_code == 200 and second.status_code == 200
        assert first.json()["id"] == cid and second.json()["id"] == cid
        rows = [c for c in session_a.get(f"{api_url}/customers").json() if c["id"] == cid]
        assert len(rows) == 1
        session_a.delete(f"{api_url}/customers/{cid}")

    def test_client_id_is_scoped_per_user(self, session_a, session_b, api_url):
        cid = f"offline-{uuid.uuid4()}"
        session_a.post(f"{api_url}/customers", json={"id": cid, "name": "TEST_A_Owned"})
        r = session_b.post(f"{api_url}/customers", json={"id": cid, "name": "TEST_B_Owned"})
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_B_Owned"
        a_rows = [c for c in session_a.get(f"{api_url}/customers").json() if c["id"] == cid]
        assert a_rows[0]["name"] == "TEST_A_Owned"
        session_a.delete(f"{api_url}/customers/{cid}")
        session_b.delete(f"{api_url}/customers/{cid}")


class TestCascadeDelete:
    def test_delete_customer_cascades_entries_and_jobs(self, session_a, api_url):
        # Create customer
        c = session_a.post(f"{api_url}/customers", json={"name": "TEST_Cascade"}).json()
        cid = c["id"]
        # Add entry and job
        e = session_a.post(f"{api_url}/entries", json={
            "customerId": cid, "type": "work", "date": "2026-01-01",
            "description": "TEST", "amount": 100,
        }).json()
        j = session_a.post(f"{api_url}/jobs", json={
            "customerId": cid, "title": "TEST Cascade Job", "dueDate": "2026-01-10",
        }).json()

        # Delete the customer
        r = session_a.delete(f"{api_url}/customers/{cid}")
        assert r.status_code == 200

        # Entry and job should be gone
        entries = session_a.get(f"{api_url}/entries").json()
        jobs = session_a.get(f"{api_url}/jobs").json()
        assert not any(x["id"] == e["id"] for x in entries), "entry should have been cascade-deleted"
        assert not any(x["id"] == j["id"] for x in jobs), "job should have been cascade-deleted"
        # And the customer itself
        customers = session_a.get(f"{api_url}/customers").json()
        assert not any(x["id"] == cid for x in customers)


# --- User isolation -------------------------------------------------------
class TestUserIsolation:
    a_customer_id = None
    a_entry_id = None
    a_job_id = None

    def test_seed_user_a_resources(self, session_a, api_url):
        c = session_a.post(f"{api_url}/customers", json={"name": "TEST_A_Only"}).json()
        TestUserIsolation.a_customer_id = c["id"]
        e = session_a.post(f"{api_url}/entries", json={
            "customerId": c["id"], "type": "work", "date": "2026-01-05",
            "description": "TEST A only", "amount": 300,
        }).json()
        TestUserIsolation.a_entry_id = e["id"]
        j = session_a.post(f"{api_url}/jobs", json={
            "customerId": c["id"], "title": "TEST A Job", "dueDate": "2026-01-20",
        }).json()
        TestUserIsolation.a_job_id = j["id"]

    def test_user_b_cannot_see_user_a_customers(self, session_b, api_url):
        rows = session_b.get(f"{api_url}/customers").json()
        assert not any(c["id"] == TestUserIsolation.a_customer_id for c in rows)

    def test_user_b_cannot_see_user_a_entries(self, session_b, api_url):
        rows = session_b.get(f"{api_url}/entries").json()
        assert not any(e["id"] == TestUserIsolation.a_entry_id for e in rows)

    def test_user_b_cannot_see_user_a_jobs(self, session_b, api_url):
        rows = session_b.get(f"{api_url}/jobs").json()
        assert not any(j["id"] == TestUserIsolation.a_job_id for j in rows)

    def test_user_b_cannot_update_user_a_entry(self, session_b, api_url):
        r = session_b.put(
            f"{api_url}/entries/{TestUserIsolation.a_entry_id}",
            json={"type": "work", "date": "2026-01-05", "description": "hacked", "amount": 1},
        )
        assert r.status_code == 404

    def test_user_b_cannot_update_user_a_customer(self, session_b, api_url):
        r = session_b.put(
            f"{api_url}/customers/{TestUserIsolation.a_customer_id}",
            json={"name": "hacked", "phone": "", "address": "", "notes": ""},
        )
        assert r.status_code == 404

    def test_user_b_cannot_delete_user_a_customer(self, session_a, session_b, api_url):
        # Delete responds ok even on missing (idempotent), but must NOT affect user A's data
        session_b.delete(f"{api_url}/customers/{TestUserIsolation.a_customer_id}")
        # Verify user A still has it
        rows = session_a.get(f"{api_url}/customers").json()
        assert any(c["id"] == TestUserIsolation.a_customer_id for c in rows), \
            "User B's delete must not affect user A's customer"

    def test_user_b_cannot_update_user_a_job(self, session_b, api_url):
        r = session_b.put(
            f"{api_url}/jobs/{TestUserIsolation.a_job_id}",
            json={"status": "done"},
        )
        assert r.status_code == 404


# --- Linked work records ------------------------------------------------
class TestLinkedRecords:
    def test_payment_link_and_job_entry_persist(self, session_a, api_url):
        c = session_a.post(f"{api_url}/customers", json={"name": "TEST_Linked"}).json()
        work = session_a.post(f"{api_url}/entries", json={
            "customerId": c["id"], "type": "work", "date": "2026-02-01",
            "description": "TEST linked work", "amount": 400,
        }).json()
        assert work["linkId"] == ""
        pay = session_a.post(f"{api_url}/entries", json={
            "customerId": c["id"], "type": "payment", "date": "2026-02-01",
            "description": "TEST linked pay", "amount": 400, "linkId": work["id"],
        }).json()
        assert pay["linkId"] == work["id"]
        job = session_a.post(f"{api_url}/jobs", json={
            "customerId": c["id"], "title": "TEST linked job", "dueDate": "2026-02-01", "status": "done",
        }).json()
        r = session_a.put(f"{api_url}/jobs/{job['id']}", json={"entryId": work["id"]})
        assert r.status_code == 200
        assert r.json()["entryId"] == work["id"]
        # Editing the entry must keep its link.
        r = session_a.put(f"{api_url}/entries/{pay['id']}", json={
            "type": "payment", "date": "2026-02-02", "description": "TEST linked pay", "amount": 150,
        })
        assert r.json()["linkId"] == work["id"]


# --- Cash taken with the work (single-row cash entries) ---------------------
class TestWorkPaid:
    def test_paid_defaults_to_zero_and_persists(self, session_a, api_url):
        c = session_a.post(f"{api_url}/customers", json={"name": "TEST_Paid"}).json()
        TestWorkPaid.customer_id = c["id"]
        udhaar = session_a.post(f"{api_url}/entries", json={
            "customerId": c["id"], "type": "work", "date": "2026-02-01", "description": "TEST udhaar", "amount": 300,
        }).json()
        assert udhaar["paid"] == 0
        cash = session_a.post(f"{api_url}/entries", json={
            "customerId": c["id"], "type": "work", "date": "2026-02-01", "description": "TEST cash", "amount": 200, "paid": 200,
        })
        assert cash.status_code == 200, cash.text
        assert cash.json()["paid"] == 200
        TestWorkPaid.cash_id = cash.json()["id"]
        rows = session_a.get(f"{api_url}/entries").json()
        assert next(e for e in rows if e["id"] == TestWorkPaid.cash_id)["paid"] == 200

    def test_paid_cannot_exceed_amount_or_go_negative(self, session_a, api_url):
        base = {"customerId": TestWorkPaid.customer_id, "type": "work", "date": "2026-02-01", "description": "TEST bad"}
        assert session_a.post(f"{api_url}/entries", json={**base, "amount": 100, "paid": 150}).status_code == 422
        assert session_a.post(f"{api_url}/entries", json={**base, "amount": 100, "paid": -1}).status_code == 422
        pay = {**base, "type": "payment", "amount": 100, "paid": 50}
        assert session_a.post(f"{api_url}/entries", json=pay).status_code == 422

    def test_update_keeps_or_changes_paid(self, session_a, api_url):
        eid = TestWorkPaid.cash_id
        body = {"type": "work", "date": "2026-02-01", "description": "TEST cash", "amount": 250}
        r = session_a.put(f"{api_url}/entries/{eid}", json=body)
        assert r.status_code == 200 and r.json()["paid"] == 200
        r = session_a.put(f"{api_url}/entries/{eid}", json={**body, "paid": 100})
        assert r.json()["paid"] == 100
        # Lowering the amount below the stored paid value must be rejected.
        assert session_a.put(f"{api_url}/entries/{eid}", json={**body, "amount": 50}).status_code == 422


# --- AEPS ------------------------------------------------------------------
class TestAeps:
    txn_id = None

    def _payload(self, **over):
        base = {
            "type": "withdrawal", "date": "2026-03-01", "time": "10:30",
            "customerName": "TEST Aeps Customer", "mobile": "9876543210",
            "aadhaarLast4": "1234", "bankName": "SBI", "amount": 2000,
            "commission": 10, "reference": "RRN123",
        }
        base.update(over)
        return base

    def test_create_aeps(self, session_a, api_url):
        r = session_a.post(f"{api_url}/aeps", json=self._payload())
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["type"] == "withdrawal" and d["amount"] == 2000
        assert d["status"] == "success"
        assert "_id" not in d and "user_id" not in d
        TestAeps.txn_id = d["id"]

    def test_create_aeps_idempotent(self, session_a, api_url):
        cid = str(uuid.uuid4())
        first = session_a.post(f"{api_url}/aeps", json=self._payload(id=cid)).json()
        again = session_a.post(f"{api_url}/aeps", json=self._payload(id=cid, amount=9)).json()
        assert first["id"] == again["id"] == cid
        assert again["amount"] == 2000
        rows = session_a.get(f"{api_url}/aeps").json()
        assert sum(1 for t in rows if t["id"] == cid) == 1
        session_a.delete(f"{api_url}/aeps/{cid}")

    def test_full_aadhaar_rejected(self, session_a, api_url):
        r = session_a.post(f"{api_url}/aeps", json=self._payload(aadhaarLast4="123456789012"))
        assert r.status_code == 422

    def test_negative_amount_and_bad_type_rejected(self, session_a, api_url):
        assert session_a.post(f"{api_url}/aeps", json=self._payload(amount=-5)).status_code == 422
        assert session_a.post(f"{api_url}/aeps", json=self._payload(type="loan")).status_code == 422

    def test_update_aeps(self, session_a, api_url):
        r = session_a.put(f"{api_url}/aeps/{TestAeps.txn_id}", json=self._payload(
            type="bill", billerName="बिजली", billAccount="CN-778", amount=1450, status="pending",
        ))
        assert r.status_code == 200, r.text
        d = r.json()
        assert d["id"] == TestAeps.txn_id
        assert d["type"] == "bill" and d["billAccount"] == "CN-778" and d["status"] == "pending"

    def test_other_user_cannot_see_or_edit(self, session_b, api_url):
        rows = session_b.get(f"{api_url}/aeps").json()
        assert not any(t["id"] == TestAeps.txn_id for t in rows)
        r = session_b.put(f"{api_url}/aeps/{TestAeps.txn_id}", json=self._payload())
        assert r.status_code == 404

    def test_delete_aeps(self, session_a, api_url):
        assert session_a.delete(f"{api_url}/aeps/{TestAeps.txn_id}").json() == {"ok": True}
        rows = session_a.get(f"{api_url}/aeps").json()
        assert not any(t["id"] == TestAeps.txn_id for t in rows)

    def test_aeps_requires_auth(self, anon_session, api_url):
        assert anon_session.get(f"{api_url}/aeps").status_code == 401


# --- Cleanup -------------------------------------------------------------
class TestZZCleanup:
    """Ensures test data is removed after suite completes."""

    def test_cleanup_user_a_data(self, session_a, api_url):
        # Delete all TEST_ customers for user A (cascade removes entries/jobs)
        rows = session_a.get(f"{api_url}/customers").json()
        for c in rows:
            if c["name"].startswith("TEST_"):
                session_a.delete(f"{api_url}/customers/{c['id']}")
        # Also cleanup orphan entries/jobs just in case
        for e in session_a.get(f"{api_url}/entries").json():
            if e.get("description", "").startswith("TEST"):
                session_a.delete(f"{api_url}/entries/{e['id']}")
        for j in session_a.get(f"{api_url}/jobs").json():
            if j.get("title", "").startswith("TEST"):
                session_a.delete(f"{api_url}/jobs/{j['id']}")
        for t in session_a.get(f"{api_url}/aeps").json():
            if t.get("customerName", "").startswith("TEST"):
                session_a.delete(f"{api_url}/aeps/{t['id']}")
        assert True
