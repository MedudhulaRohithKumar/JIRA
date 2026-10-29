"""
Initial Seed Data for CSR Work Flow Manager.
Populates S3 Document DB (`db/users.json`, `db/sprints.json`, `db/tasks.json`, `db/daily_status/...`)
on first startup if not already initialized.
"""

from datetime import timedelta
from typing import Any

from backend.config import now_local, today_str
from backend.s3_db import db
from backend.security import hash_password


def ensure_seed_data() -> None:
    """Seed S3 Document DB if `db/users.json` has no users."""
    users_doc = db.read_document("db/users.json", default={"users": []})
    if users_doc.get("users"):
        return

    now = now_local()
    today = today_str()
    yesterday = (now - timedelta(days=1)).strftime("%Y-%m-%d")
    in_2_days = (now + timedelta(days=2)).strftime("%Y-%m-%d")
    in_4_days = (now + timedelta(days=4)).strftime("%Y-%m-%d")
    in_7_days = (now + timedelta(days=7)).strftime("%Y-%m-%d")

    admin_pw = hash_password("Admin@123")
    user_pw = hash_password("User@123")

    seeded_users: list[dict[str, Any]] = [
        {
            "id": "USR-001",
            "username": "admin",
            "full_name": "Rajesh Sharma",
            "email": "rajesh.sharma@internal.csr.local",
            "password_hash": admin_pw,
            "role": "ADMIN",
            "department": "Management & Architecture",
            "designation": "CSR Workflow Manager",
            "avatar_color": "#2563eb",
            "is_active": True,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        {
            "id": "USR-002",
            "username": "priya",
            "full_name": "Priya Nair",
            "email": "priya.nair@internal.csr.local",
            "password_hash": user_pw,
            "role": "USER",
            "department": "UI/UX Design",
            "designation": "Senior Product Designer",
            "avatar_color": "#db2777",
            "is_active": True,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        {
            "id": "USR-003",
            "username": "arjun",
            "full_name": "Arjun Mehta",
            "email": "arjun.mehta@internal.csr.local",
            "password_hash": user_pw,
            "role": "USER",
            "department": "Frontend Engineering",
            "designation": "Senior UI Engineer",
            "avatar_color": "#059669",
            "is_active": True,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        {
            "id": "USR-004",
            "username": "sneha",
            "full_name": "Sneha Reddy",
            "email": "sneha.reddy@internal.csr.local",
            "password_hash": user_pw,
            "role": "USER",
            "department": "Cloud & Serverless",
            "designation": "AWS Lambda / S3 Engineer",
            "avatar_color": "#7c3aed",
            "is_active": True,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        {
            "id": "USR-005",
            "username": "vikram",
            "full_name": "Vikram Singh",
            "email": "vikram.singh@internal.csr.local",
            "password_hash": user_pw,
            "role": "USER",
            "department": "UI/UX Design",
            "designation": "Interaction & Visual Designer",
            "avatar_color": "#d97706",
            "is_active": True,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        {
            "id": "USR-006",
            "username": "ananya",
            "full_name": "Ananya Iyer",
            "email": "ananya.iyer@internal.csr.local",
            "password_hash": user_pw,
            "role": "USER",
            "department": "Security & QA",
            "designation": "Security & QA Lead",
            "avatar_color": "#0891b2",
            "is_active": True,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        {
            "id": "USR-007",
            "username": "rohan",
            "full_name": "Rohan Kulkarni",
            "email": "rohan.kulkarni@internal.csr.local",
            "password_hash": user_pw,
            "role": "USER",
            "department": "Backend Engineering",
            "designation": "Full Stack Engineer",
            "avatar_color": "#4f46e5",
            "is_active": True,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
        {
            "id": "USR-008",
            "username": "kavita",
            "full_name": "Kavita Deshmukh",
            "email": "kavita.deshmukh@internal.csr.local",
            "password_hash": user_pw,
            "role": "USER",
            "department": "CSR Operations",
            "designation": "CSR Workflow Coordinator",
            "avatar_color": "#be123c",
            "is_active": True,
            "created_at": now.isoformat(),
            "updated_at": now.isoformat(),
        },
    ]

    db.atomic_update(
        "db/users.json",
        default={"users": []},
        mutator_fn=lambda _doc: ({"users": seeded_users}, seeded_users),
    )

    seeded_sprints = [
        {
            "id": "SPRINT-1",
            "name": "Sprint 14 — CSR Portal & Design System v2",
            "goal": "Deliver core CSR workflow screens, S3 document integration, and VPC security hardening.",
            "start_date": yesterday,
            "end_date": in_7_days,
            "status": "ACTIVE",
        },
        {
            "id": "SPRINT-2",
            "name": "Sprint 15 — Automated Compliance & Reporting",
            "goal": "Implement quarterly CSR audit exports and executive dashboards.",
            "start_date": in_7_days,
            "end_date": (now + timedelta(days=21)).strftime("%Y-%m-%d"),
            "status": "PLANNED",
        },
    ]

    db.atomic_update(
        "db/sprints.json",
        default={"sprints": []},
        mutator_fn=lambda _doc: ({"sprints": seeded_sprints}, seeded_sprints),
    )

    seeded_tasks = [
        {
            "id": "CSR-101",
            "title": "Design High-Fidelity CSR Approval Workflow Screens & Component Library",
            "description": (
                "Create complete Figma / design specs for the multi-stage CSR approval workflow, "
                "including status badges, timeline extension modals, and accessible color contrast."
            ),
            "task_type": "DESIGN_TASK",
            "priority": "HIGH",
            "status": "IN_PROGRESS",
            "sprint_id": "SPRINT-1",
            "story_points": 5,
            "assignee_id": "USR-002",
            "reporter_id": "USR-001",
            "original_due_date": today,
            "due_date": in_2_days,
            "extension_count": 1,
            "timeline_history": [
                {
                    "old_due_date": today,
                    "new_due_date": in_2_days,
                    "reason": "Added 3 additional mobile responsive breakpoints requested by CSR committee.",
                    "extended_by": "USR-001",
                    "extended_by_name": "Rajesh Sharma",
                    "timestamp": now.isoformat(),
                }
            ],
            "estimated_hours": 16.0,
            "logged_hours": 10.5,
            "labels": ["design-system", "csr-ui", "priority"],
            "has_blocker": False,
            "blocker_summary": "",
            "comments": [
                {
                    "id": "CMT-1001",
                    "task_id": "CSR-101",
                    "author_id": "USR-002",
                    "author_name": "Priya Nair",
                    "author_role": "USER",
                    "comment_type": "REMARK",
                    "content": "Completed wireframes and dark/light tokens. Working on final interactive states.",
                    "created_at": now.isoformat(),
                },
                {
                    "id": "CMT-1002",
                    "task_id": "CSR-101",
                    "author_id": "USR-001",
                    "author_name": "Rajesh Sharma",
                    "author_role": "ADMIN",
                    "comment_type": "TIMELINE_EXTENSION",
                    "content": f"Timeline extended from {today} to {in_2_days}. Reason: Added 3 additional mobile responsive breakpoints.",
                    "created_at": now.isoformat(),
                },
            ],
            "created_at": yesterday,
            "updated_at": now.isoformat(),
        },
        {
            "id": "CSR-102",
            "title": "Design CSR Partner Onboarding Portal & Document Upload Flow",
            "description": (
                "Create step-by-step partner onboarding screens, document verification progress indicators, "
                "and confirmation states for CSR coordinators."
            ),
            "task_type": "DESIGN_TASK",
            "priority": "CRITICAL",
            "status": "DONE",
            "sprint_id": "SPRINT-1",
            "story_points": 8,
            "assignee_id": "USR-004",
            "reporter_id": "USR-001",
            "original_due_date": today,
            "due_date": today,
            "extension_count": 0,
            "timeline_history": [],
            "estimated_hours": 12.0,
            "logged_hours": 11.0,
            "labels": ["onboarding", "csr-portal", "ux"],
            "has_blocker": False,
            "blocker_summary": "",
            "comments": [
                {
                    "id": "CMT-1003",
                    "task_id": "CSR-102",
                    "author_id": "USR-004",
                    "author_name": "Sneha Reddy",
                    "author_role": "USER",
                    "comment_type": "COMMENT",
                    "content": "Completed all 4 onboarding steps and shared prototypes with the review team.",
                    "created_at": now.isoformat(),
                }
            ],
            "created_at": yesterday,
            "updated_at": now.isoformat(),
        },
        {
            "id": "CSR-103",
            "title": "Design Interactive Kanban Cards & Timeline Diff Indicator",
            "description": (
                "Design visual indicators on task cards when a deadline has been extended by Manager, "
                "and highlight tasks with active blockers in red."
            ),
            "task_type": "DESIGN_TASK",
            "priority": "MEDIUM",
            "status": "BLOCKED",
            "sprint_id": "SPRINT-1",
            "story_points": 3,
            "assignee_id": "USR-005",
            "reporter_id": "USR-001",
            "original_due_date": in_2_days,
            "due_date": in_2_days,
            "extension_count": 0,
            "timeline_history": [],
            "estimated_hours": 8.0,
            "logged_hours": 4.0,
            "labels": ["design", "kanban", "ux"],
            "has_blocker": True,
            "blocker_summary": "Awaiting final CSR brand icon set from internal brand compliance team.",
            "comments": [
                {
                    "id": "CMT-1004",
                    "task_id": "CSR-103",
                    "author_id": "USR-005",
                    "author_name": "Vikram Singh",
                    "author_role": "USER",
                    "comment_type": "BLOCKER",
                    "content": "Blocked: Awaiting final SVG icon set from CSR Brand Compliance team to finalize card header.",
                    "created_at": now.isoformat(),
                }
            ],
            "created_at": yesterday,
            "updated_at": now.isoformat(),
        },
        {
            "id": "CSR-104",
            "title": "Build 8:00 PM Daily Status Cutoff Scheduler & SES HTML Email Template",
            "description": (
                "Implement EventBridge cron at 20:00 IST to lock daily status edits, mark non-submissions as NA, "
                "and email the summary table to Admin."
            ),
            "task_type": "FEATURE",
            "priority": "CRITICAL",
            "status": "IN_REVIEW",
            "sprint_id": "SPRINT-1",
            "story_points": 5,
            "assignee_id": "USR-007",
            "reporter_id": "USR-001",
            "original_due_date": in_2_days,
            "due_date": in_2_days,
            "extension_count": 0,
            "timeline_history": [],
            "estimated_hours": 10.0,
            "logged_hours": 9.0,
            "labels": ["eventbridge", "ses-email", "daily-status"],
            "has_blocker": False,
            "blocker_summary": "",
            "comments": [],
            "created_at": yesterday,
            "updated_at": now.isoformat(),
        },
        {
            "id": "CSR-105",
            "title": "Frontend Role-Based Dashboard for Admin & Team Members",
            "description": (
                "Build SPA dashboard supporting Kanban board, task assignment, deadline extension, "
                "and pre-8PM daily status submission form."
            ),
            "task_type": "FEATURE",
            "priority": "HIGH",
            "status": "IN_PROGRESS",
            "sprint_id": "SPRINT-1",
            "story_points": 8,
            "assignee_id": "USR-003",
            "reporter_id": "USR-001",
            "original_due_date": in_4_days,
            "due_date": in_4_days,
            "extension_count": 0,
            "timeline_history": [],
            "estimated_hours": 16.0,
            "logged_hours": 7.5,
            "labels": ["frontend", "rbac", "dashboard"],
            "has_blocker": False,
            "blocker_summary": "",
            "comments": [],
            "created_at": yesterday,
            "updated_at": now.isoformat(),
        },
        {
            "id": "CSR-106",
            "title": "Accessibility & Design QA Review for Q4 CSR Grant Application Forms",
            "description": (
                "Audit keyboard navigation, form validation states, and typography hierarchy across all CSR grant screens."
            ),
            "task_type": "REVIEW",
            "priority": "HIGH",
            "status": "TODO",
            "sprint_id": "SPRINT-1",
            "story_points": 5,
            "assignee_id": "USR-006",
            "reporter_id": "USR-001",
            "original_due_date": in_4_days,
            "due_date": in_4_days,
            "extension_count": 0,
            "timeline_history": [],
            "estimated_hours": 10.0,
            "logged_hours": 0.0,
            "labels": ["design-qa", "accessibility"],
            "has_blocker": False,
            "blocker_summary": "",
            "comments": [],
            "created_at": yesterday,
            "updated_at": now.isoformat(),
        },
        {
            "id": "CSR-107",
            "title": "Prepare Q4 CSR Beneficiary Onboarding Design Templates",
            "description": "Design printable and web CSR beneficiary verification forms and workflow checklists.",
            "task_type": "DESIGN_TASK",
            "priority": "MEDIUM",
            "status": "TODO",
            "sprint_id": "SPRINT-1",
            "story_points": 3,
            "assignee_id": "USR-008",
            "reporter_id": "USR-001",
            "original_due_date": in_7_days,
            "due_date": in_7_days,
            "extension_count": 0,
            "timeline_history": [],
            "estimated_hours": 6.0,
            "logged_hours": 1.0,
            "labels": ["csr-ops", "templates"],
            "has_blocker": False,
            "blocker_summary": "",
            "comments": [],
            "created_at": yesterday,
            "updated_at": now.isoformat(),
        },
    ]

    db.atomic_update(
        "db/tasks.json",
        default={"next_seq": 108, "tasks": []},
        mutator_fn=lambda _doc: ({"next_seq": 108, "tasks": seeded_tasks}, seeded_tasks),
    )

    # Seed a few today's daily status submissions so Admin can immediately see submitted vs pending/NA
    today_submissions = {
        "USR-002": {
            "user_id": "USR-002",
            "username": "priya",
            "full_name": "Priya Nair",
            "department": "UI/UX Design",
            "date": today,
            "status": "SUBMITTED",
            "tasks_worked_on": ["CSR-101"],
            "accomplishments": "Completed high-fidelity CSR approval workflow screens and responsive mobile layouts.",
            "planned_next": "Conduct design handoff session with Arjun for frontend implementation.",
            "blockers_remarks": "None — timeline extended by 2 days for extra mobile breakpoints.",
            "hours_logged": 7.5,
            "submitted_at": now.isoformat(),
            "submitted_at_display": now.strftime("%I:%M %p"),
            "last_updated_at": now.isoformat(),
            "edit_count": 1,
            "locked": False,
        },
        "USR-004": {
            "user_id": "USR-004",
            "username": "sneha",
            "full_name": "Sneha Reddy",
            "department": "Product Engineering",
            "date": today,
            "status": "SUBMITTED",
            "tasks_worked_on": ["CSR-102"],
            "accomplishments": "Completed partner onboarding flow screens and document upload validation states.",
            "planned_next": "Assist Ananya with accessibility review for Q4 grant forms.",
            "blockers_remarks": "None",
            "hours_logged": 8.0,
            "submitted_at": now.isoformat(),
            "submitted_at_display": now.strftime("%I:%M %p"),
            "last_updated_at": now.isoformat(),
            "edit_count": 1,
            "locked": False,
        },
        "USR-005": {
            "user_id": "USR-005",
            "username": "vikram",
            "full_name": "Vikram Singh",
            "department": "UI/UX Design",
            "date": today,
            "status": "SUBMITTED",
            "tasks_worked_on": ["CSR-103"],
            "accomplishments": "Designed Kanban card badges for extended timelines and priority indicators.",
            "planned_next": "Finalize SVG icons once CSR brand compliance team shares assets.",
            "blockers_remarks": "BLOCKER on CSR-103: Waiting on SVG brand icon pack from compliance team.",
            "hours_logged": 6.5,
            "submitted_at": now.isoformat(),
            "submitted_at_display": now.strftime("%I:%M %p"),
            "last_updated_at": now.isoformat(),
            "edit_count": 2,
            "locked": False,
        },
    }

    db.atomic_update(
        f"db/daily_status/{today}.json",
        default={"date": today, "cutoff_finalized": False, "submissions": {}},
        mutator_fn=lambda _doc: (
            {"date": today, "cutoff_finalized": False, "submissions": today_submissions},
            today_submissions,
        ),
    )

    # Also seed yesterday's finalized report (showing how unsubmitted users were marked NA at 8:00 PM)
    yesterday_submissions = {}
    for u in seeded_users:
        uid = u["id"]
        if uid in ("USR-002", "USR-003", "USR-004", "USR-007"):
            yesterday_submissions[uid] = {
                "user_id": uid,
                "username": u["username"],
                "full_name": u["full_name"],
                "department": u["department"],
                "date": yesterday,
                "status": "SUBMITTED",
                "tasks_worked_on": ["CSR-101"],
                "accomplishments": f"Completed sprint tasks and updated CSR documentation ({yesterday}).",
                "planned_next": "Continue sprint backlog items.",
                "blockers_remarks": "None",
                "hours_logged": 8.0,
                "submitted_at": f"{yesterday}T18:45:00+05:30",
                "submitted_at_display": "06:45 PM",
                "last_updated_at": f"{yesterday}T18:45:00+05:30",
                "edit_count": 1,
                "locked": True,
            }
        else:
            yesterday_submissions[uid] = {
                "user_id": uid,
                "username": u["username"],
                "full_name": u["full_name"],
                "department": u["department"],
                "date": yesterday,
                "status": "NA",
                "tasks_worked_on": [],
                "accomplishments": "NA",
                "planned_next": "NA",
                "blockers_remarks": "NA",
                "hours_logged": 0.0,
                "submitted_at": None,
                "submitted_at_display": "NA",
                "last_updated_at": f"{yesterday}T20:00:00+05:30",
                "edit_count": 0,
                "locked": True,
            }

    db.atomic_update(
        f"db/daily_status/{yesterday}.json",
        default={"date": yesterday, "cutoff_finalized": True, "submissions": {}},
        mutator_fn=lambda _doc: (
            {
                "date": yesterday,
                "cutoff_finalized": True,
                "cutoff_finalized_at": f"{yesterday}T20:00:02+05:30",
                "submissions": yesterday_submissions,
            },
            yesterday_submissions,
        ),
    )

    db.append_audit_log(
        actor_id="USR-001",
        actor_name="Rajesh Sharma",
        actor_role="ADMIN",
        action="SYSTEM_INITIALIZED",
        resource_type="SYSTEM",
        resource_id="CSR-WORKFLOW-MANAGER",
        details="Initialized S3 Document DB with internal team members, CSR tasks, and 8:00 PM Daily Status workflow.",
    )
