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
        assert True
