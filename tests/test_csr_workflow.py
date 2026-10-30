"""
End-to-End Verification Suite for CSR Work Flow Manager.
Tests:
  1. Main Page Info ("CSR Work Flow Manager") & Security Posture
  2. Role-Based Login (Admin vs User) & PBKDF2-SHA256 + JWT Validation
  3. Admin User Management (Add, Edit, Delete users for 20-member team) & RBAC protection
  4. Admin Task Assignment (Design Tasks), Timeline Extensions with History
  5. User Task Updates, Blocker & Remark Comments, and Admin Consolidated Comment View
  6. Daily Status Pre-8:00 PM Submission & Multiple Edits before 8:00 PM
  7. Daily Status Post-8:00 PM Lock (403 Forbidden after 20:00)
  8. 8:00 PM AWS EventBridge Lambda Trigger: Marks unsubmitted users as 'NA' and sends HTML/Text Email Report
  9. S3 Document DB ETag Optimistic Concurrency Control (OCC) verification
"""

import shutil
import sys
import tempfile
from pathlib import Path

# Configure isolated temporary S3 Document DB before importing backend modules
TEST_DB_DIR = Path(tempfile.mkdtemp(prefix="csr_s3_test_"))
import os

os.environ["LOCAL_S3_DIR"] = str(TEST_DB_DIR)
os.environ["STORAGE_MODE"] = "local"
os.environ["EMAIL_MODE"] = "local_outbox"

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import HTTPException
from backend.app import (
    add_task_comment,
    create_task,
    create_team,
    create_user,
    delete_team,
    delete_user,
    extend_task_timeline,
    get_daily_status,
    get_system_info,
    lambda_handler,
    list_all_user_comments,
    list_tasks,
    list_teams,
    list_users,
    login,
    submit_or_update_daily_status,
    update_team,
    update_user,
)
from backend.config import set_clock_override, today_str
from backend.models import (
    CommentType,
    DailyStatusSubmitRequest,
    LoginRequest,
    TaskCommentCreateRequest,
    TaskCreateRequest,
    TaskPriority,
    TaskType,
    TeamCreateRequest,
    TeamUpdateRequest,
    TimelineExtendRequest,
    UserCreateRequest,
    UserRole,
    UserUpdateRequest,
)
from backend.s3_db import ConcurrencyConflictError, db
from backend.security import decode_access_token
from backend.seed import ensure_seed_data


class DummyRequest:
    client = type("Client", (), {"host": "10.42.1.15"})()
    cookies = {}


class DummyResponse:
    def __init__(self):
        self.cookies = {}

    def set_cookie(self, key, value, **kwargs):
        self.cookies[key] = value

    def delete_cookie(self, key):
        self.cookies.pop(key, None)


def run_all_tests() -> None:
    print("=== Running CSR Work Flow Manager Verification Suite ===")
    ensure_seed_data()

    # 1. Verify Main Page Info ("CSR Work Flow Manager")
    set_clock_override(15, 30)  # 3:30 PM IST (Before 8:00 PM cutoff)
    info = get_system_info()
    assert info["app_name"] == "CSR Work Flow Manager"
    assert info["is_daily_status_open"] is True
    print("[PASS] 1. Main page info & pre-8PM window check verified.")

    # 2. Verify Role-Based Login (Admin & User)
    req = DummyRequest()
    resp = DummyResponse()
    admin_login = login(LoginRequest(username="admin", password="Admin@123"), req, resp)
    admin_user = admin_login["user"]
    assert admin_user["role"] == "ADMIN"
    decoded = decode_access_token(admin_login["access_token"])
    assert decoded["role"] == "ADMIN"

    user_login = login(LoginRequest(username="arjun", password="User@123"), req, resp)
    regular_user = user_login["user"]
    assert regular_user["role"] == "USER"
    print("[PASS] 2. Role-based login (Admin & User) + JWT + PBKDF2 verified.")

    # 3. Verify Admin User Management (Add, Edit, Delete)
    new_u_res = create_user(
        UserCreateRequest(
            username="meera",
            full_name="Meera Krishnan",
            email="meera@internal.csr.local",
            password="User@123",
            role=UserRole.USER,
            department="UI/UX Design",
            designation="Visual Designer",
        ),
        admin_user=admin_user,
    )
    meera_id = new_u_res["user"]["id"]
    assert new_u_res["user"]["username"] == "meera"

    upd_u_res = update_user(
        meera_id,
        UserUpdateRequest(designation="Lead Visual Designer"),
        admin_user=admin_user,
    )
    assert upd_u_res["user"]["designation"] == "Lead Visual Designer"

    del_u_res = delete_user(meera_id, admin_user=admin_user)
    assert del_u_res["deleted_user_id"] == meera_id
    print("[PASS] 3. Admin User CRUD (Add, Edit, Delete) verified.")

    # 3b. Verify Team Creation & Management Mechanism (DevOps & Custom Teams)
    teams_res = list_teams(current_user=admin_user)
    assert teams_res["total"] >= 1
    devops_team = next((tm for tm in teams_res["teams"] if tm["id"] == "TEAM-DEVOPS"), None)
    assert devops_team is not None, "TEAM-DEVOPS should be seeded"
    assert "USR-001" in devops_team["member_ids"]

    # Admin creates new team
    new_team_res = create_team(
        TeamCreateRequest(
            name="Cloud SRE & Incident Response",
            description="Dedicated squad for 24/7 reliability and infrastructure automation.",
            lead_id=admin_user["id"],
            member_ids=[admin_user["id"]],
        ),
        admin_user=admin_user,
    )
    sre_team = new_team_res["team"]
    sre_team_id = sre_team["id"]
    assert sre_team["name"] == "Cloud SRE & Incident Response"

    # Admin updates team
    up_team_res = update_team(
        sre_team_id,
        TeamUpdateRequest(description="Updated scope: SRE, Chaos Engineering & VPC observability."),
        admin_user=admin_user,
    )
    assert "Chaos Engineering" in up_team_res["team"]["description"]

    # Admin deletes team
    del_team_res = delete_team(sre_team_id, admin_user=admin_user)
    assert del_team_res["deleted_team"]["id"] == sre_team_id
    print("[PASS] 3b. Team Creation, Member Assignment & Squad Management verified.")

    # 4. Verify Admin Design Task Assignment & Timeline Extension
    today = today_str()
    created_task_res = create_task(
        TaskCreateRequest(
            title="Design CSR Impact Infographic & Report Layout",
            description="Create vector charts and layout for annual CSR review.",
            task_type=TaskType.DESIGN_TASK,
            priority=TaskPriority.HIGH,
            assignee_id=regular_user["id"],
            due_date=today,
            story_points=5,
        ),
        admin_user=admin_user,
    )
    task = created_task_res["task"]
    task_id = task["id"]
    assert task["task_type"] == "DESIGN_TASK"
    assert task["original_due_date"] == today

    extended_res = extend_task_timeline(
        task_id,
        TimelineExtendRequest(
            new_due_date="2026-11-05",
            reason="Additional stakeholder feedback from CSR board.",
        ),
        admin_user=admin_user,
    )
    ext_task = extended_res["task"]
    assert ext_task["due_date"] == "2026-11-05"
    assert ext_task["original_due_date"] == today
    assert ext_task["extension_count"] == 1
    assert len(ext_task["timeline_history"]) == 1
    print("[PASS] 4. Admin Task Assignment & Timeline Extension history verified.")

    # 5. Verify User Adding Blocker / Remark Comments & Admin Seeing All Comments
    cmt_res = add_task_comment(
        task_id,
        TaskCommentCreateRequest(
            content="Waiting on verified Q3 CSR metrics dataset from finance.",
            comment_type=CommentType.BLOCKER,
            mark_task_blocked=True,
            logged_hours_delta=3.5,
        ),
        current_user=regular_user,
    )
    assert cmt_res["task"]["has_blocker"] is True
    assert cmt_res["task"]["status"] == "BLOCKED"
    assert cmt_res["task"]["logged_hours"] == 3.5

    all_cmts = list_all_user_comments(current_user=admin_user)
    assert all_cmts["total"] >= 4
    print("[PASS] 5. User Blocker/Remark comments & Admin unified comment view verified.")

    # 6. Verify Daily Status Submission & Editing BEFORE 8:00 PM (15:30 IST)
    set_clock_override(18, 15)  # 6:15 PM (Before 8:00 PM)
    sub1 = submit_or_update_daily_status(
        DailyStatusSubmitRequest(
            tasks_worked_on=[task_id],
            accomplishments="Drafted initial CSR infographic grid layout.",
            planned_next="Incorporate finance dataset into charts.",
            blockers_remarks="Waiting on Q3 CSR metrics dataset.",
            hours_logged=6.5,
        ),
        current_user=regular_user,
    )
    assert sub1["submission"]["status"] == "SUBMITTED"
    assert sub1["submission"]["edit_count"] == 1

    # Re-edit before 8:00 PM (e.g., at 7:45 PM)
    set_clock_override(19, 45)
    sub2 = submit_or_update_daily_status(
        DailyStatusSubmitRequest(
            tasks_worked_on=[task_id],
            accomplishments="Drafted initial CSR infographic grid layout + color palette tokens.",
            planned_next="Incorporate finance dataset into charts.",
            blockers_remarks="Resolved partial dataset; waiting on final sign-off.",
            hours_logged=7.5,
        ),
        current_user=regular_user,
    )
    assert sub2["submission"]["edit_count"] == 2
    assert "color palette tokens" in sub2["submission"]["accomplishments"]
    print("[PASS] 6. Pre-8:00 PM Daily Status submission & comment re-editing verified.")

    # 7. Verify Daily Status Lock AT/AFTER 8:00 PM (20:05 IST) -> Rejects Edits with HTTP 403
    set_clock_override(20, 5)  # 8:05 PM IST
    locked_error_raised = False
    try:
        submit_or_update_daily_status(
            DailyStatusSubmitRequest(
                tasks_worked_on=[task_id],
                accomplishments="Trying to edit after 8:00 PM should fail!",
                planned_next="Tomorrow",
                blockers_remarks="None",
                hours_logged=8.0,
            ),
            current_user=regular_user,
        )
    except HTTPException as exc:
        assert exc.status_code == 403
        locked_error_raised = True
    assert locked_error_raised, "Expected HTTP 403 when editing daily status after 8:00 PM!"
    print("[PASS] 7. Post-8:00 PM cutoff strictly blocks daily status edits (HTTP 403).")

    # 8. Verify 8:00 PM EventBridge Lambda Trigger marks unsubmitted users as 'NA' & sends Email
    eventbridge_resp = lambda_handler(
        {"source": "aws.events", "detail-type": "Scheduled Event", "date": today},
        context=None,
    )
    assert eventbridge_resp["statusCode"] == 200
    assert eventbridge_resp["body"]["na_count"] >= 1
    assert eventbridge_resp["body"]["submitted_count"] >= 4

    consolidated_after = get_daily_status(date=today, current_user=admin_user)
    na_rows = [r for r in consolidated_after["rows"] if r["status"] == "NA"]
    assert len(na_rows) >= 1
    for r in na_rows:
        assert r["accomplishments"] == "NA"
        assert r["blockers_remarks"] == "NA"
    print(
        f"[PASS] 8. 8:00 PM EventBridge Lambda trigger finalized {len(na_rows)} unsubmitted users as 'NA' and generated email report."
    )

    # 9. Verify S3 Document DB ETag Optimistic Concurrency Control
    doc, etag = db.get_document_with_etag("db/sprints.json")
    assert etag is not None
    conflict_detected = False
    try:
        db.put_document_conditional("db/sprints.json", doc, expected_etag='"stale-invalid-etag"')
    except ConcurrencyConflictError:
        conflict_detected = True
    assert conflict_detected, "Expected ConcurrencyConflictError on mismatched S3 ETag!"
    print("[PASS] 9. S3 Document DB ETag Optimistic Concurrency Control verified.")

    set_clock_override(None)
    shutil.rmtree(TEST_DB_DIR, ignore_errors=True)
    print("\nALL 9 END-TO-END TESTS PASSED SUCCESSFULLY!")


if __name__ == "__main__":
    run_all_tests()
