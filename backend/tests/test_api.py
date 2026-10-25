from app.auth import COOKIE_NAME


def test_health_check(client):
    response = client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {"ok": True}


def test_first_registration_creates_admin_and_session(client, admin_credentials):
    options = client.get("/api/auth/registration-options")
    assert options.status_code == 200
    assert options.json() == {"bootstrap": True, "allow_open_register": False}

    registered = client.post("/api/auth/register", json=admin_credentials)
    assert registered.status_code == 200, registered.text
    user = registered.json()
    assert user["id"] > 0
    assert user["username"] == admin_credentials["username"]
    assert user["role"] == "admin"
    assert client.cookies.get(COOKIE_NAME)

    me = client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json() == user
    assert client.get("/api/auth/registration-options").json()["bootstrap"] is False


def test_logout_and_login_restore_session(admin_client, admin_credentials):
    logged_out = admin_client.post("/api/auth/logout")
    assert logged_out.status_code == 200
    assert logged_out.json() == {"ok": True}
    assert admin_client.get("/api/auth/me").status_code == 401

    logged_in = admin_client.post("/api/auth/login", json=admin_credentials)
    assert logged_in.status_code == 200, logged_in.text
    assert logged_in.json()["role"] == "admin"

    me = admin_client.get("/api/auth/me")
    assert me.status_code == 200
    assert me.json()["username"] == admin_credentials["username"]


def test_manual_paper_and_question_creation(admin_client):
    created = admin_client.post("/api/papers/manual", json={
        "title": "  数学小测  ",
        "subject": "数学",
        "grade": "五年级",
    })
    assert created.status_code == 201, created.text
    paper_id = created.json()["paper_id"]

    initial = admin_client.get(f"/api/papers/{paper_id}")
    assert initial.status_code == 200
    assert initial.json()["title"] == "数学小测"
    assert initial.json()["status"] == "partial"
    assert initial.json()["questions"] == []

    added = admin_client.post(f"/api/papers/{paper_id}/questions", json={
        "number": " 1 ",
        "correct_answer": " B ",
        "type": "single_choice",
        "section": "选择题",
        "stem": "1+1=?",
        "options": {"A": "1", "B": "2"},
        "knowledge_point": "加法",
    })
    assert added.status_code == 201, added.text
    question = added.json()
    assert question["id"].startswith("manual-")
    assert question["number"] == "1"
    assert question["correct_answer"] == "B"
    assert question["options"] == {"A": "1", "B": "2"}
    assert question["edited"] is True
    assert question["manual_created"] is True
    assert question["content_edited"] is True

    paper = admin_client.get(f"/api/papers/{paper_id}").json()
    assert paper["status"] == "ready"
    assert paper["error"] is None
    assert paper["question_count"] == 1
    assert paper["answered_count"] == 1
    assert paper["questions"] == [question]
    assert paper["files"] == []


def test_readiness_and_unknown_api(client):
    ready = client.get("/api/health/ready")
    assert ready.status_code == 200
    assert ready.json()["database"] == "ok"
    assert ready.json()["version"] == "1.0.0"

    missing = client.get("/api/not-a-route")
    assert missing.status_code == 404
    assert missing.headers["content-type"].startswith("application/json")
    assert missing.json()["detail"] == "接口不存在"
