"""
8:00 PM Daily Status Cutoff & AWS EventBridge Scheduler Processor.
Responsibilities:
  - Consolidate daily status submissions across all active users.
  - Enforce the 8:00 PM (20:00) cutoff: any user who did not submit before 8:00 PM
    is marked as 'NA' (accomplishments='NA', blockers_remarks='NA', status='NA').
  - Trigger the 8:00 PM automated email report to Admin(s) via AWS SES.
"""

from typing import Any, Tuple

from backend.config import is_daily_status_editable, now_local, today_str
from backend.email_service import send_daily_status_email
from backend.s3_db import db


def get_consolidated_daily_status(target_date: str | None = None) -> dict[str, Any]:
    """
    Return the consolidated daily status for `target_date` across all active team members.
    - Before 8:00 PM today (if not yet finalized): unsubmitted users show status='PENDING'
      (with preview showing they will become 'NA' at 8:00 PM).
    - At/After 8:00 PM today, or for any past date, or after 8:00 PM trigger:
      unsubmitted users automatically show status='NA' and comments='NA'.
    """
    date_str = target_date or today_str()
    editable, window_message = is_daily_status_editable(date_str)

    users_doc = db.read_document("db/users.json", default={"users": []})
    active_users = [
        u for u in users_doc.get("users", []) if u.get("is_active", True)
    ]

    status_key = f"db/daily_status/{date_str}.json"
    daily_doc = db.read_document(
        status_key,
        default={"date": date_str, "cutoff_finalized": False, "submissions": {}},
    )
    submissions: dict[str, Any] = daily_doc.get("submissions", {})
    cutoff_finalized: bool = bool(daily_doc.get("cutoff_finalized", False))

    # After 8:00 PM or when cutoff is finalized, any unsubmitted user is strictly 'NA'
    is_past_cutoff = (not editable) or cutoff_finalized

    rows: list[dict[str, Any]] = []
    for u in active_users:
        uid = u["id"]
        sub = submissions.get(uid)
        if sub and sub.get("status") == "SUBMITTED":
            rows.append(
                {
                    "user_id": uid,
                    "username": u["username"],
                    "full_name": u["full_name"],
                    "email": u.get("email", ""),
                    "role": u.get("role", "USER"),
                    "department": u.get("department", "Engineering"),
                    "designation": u.get("designation", "Member"),
                    "date": date_str,
                    "status": "SUBMITTED",
                    "tasks_worked_on": sub.get("tasks_worked_on", []),
                    "accomplishments": sub.get("accomplishments", ""),
                    "planned_next": sub.get("planned_next", ""),
                    "blockers_remarks": sub.get("blockers_remarks", "None"),
                    "hours_logged": sub.get("hours_logged", 0.0),
                    "submitted_at": sub.get("submitted_at"),
                    "submitted_at_display": sub.get("submitted_at_display", ""),
                    "last_updated_at": sub.get("last_updated_at"),
                    "edit_count": sub.get("edit_count", 1),
                    "locked": bool(sub.get("locked", False) or is_past_cutoff),
                }
            )
        else:
            effective_status = "NA" if is_past_cutoff else "PENDING"
            rows.append(
                {
                    "user_id": uid,
                    "username": u["username"],
                    "full_name": u["full_name"],
                    "email": u.get("email", ""),
                    "role": u.get("role", "USER"),
                    "department": u.get("department", "Engineering"),
                    "designation": u.get("designation", "Member"),
                    "date": date_str,
                    "status": effective_status,
                    "tasks_worked_on": [],
                    "accomplishments": "NA" if effective_status == "NA" else "",
                    "planned_next": "NA" if effective_status == "NA" else "",
                    "blockers_remarks": "NA" if effective_status == "NA" else "",
                    "hours_logged": 0.0,
                    "submitted_at": None,
                    "submitted_at_display": "NA",
                    "last_updated_at": None,
                    "edit_count": 0,
                    "locked": is_past_cutoff,
                }
            )

    submitted_count = sum(1 for r in rows if r["status"] == "SUBMITTED")
    na_count = sum(1 for r in rows if r["status"] == "NA")
    pending_count = sum(1 for r in rows if r["status"] == "PENDING")

    return {
        "date": date_str,
        "is_editable": editable and not cutoff_finalized,
        "cutoff_finalized": cutoff_finalized,
        "cutoff_finalized_at": daily_doc.get("cutoff_finalized_at"),
        "window_message": (
            "Daily status locked (8:00 PM cutoff finalized — unsubmitted marked as NA)."
            if cutoff_finalized
            else window_message
        ),
        "total_users": len(rows),
        "submitted_count": submitted_count,
        "na_count": na_count,
        "pending_count": pending_count,
        "rows": rows,
    }


def execute_8pm_daily_cutoff_and_email(
    target_date: str | None = None,
    triggered_by: str = "aws.events.cron.8pm",
) -> dict[str, Any]:
    """
    Execute the 8:00 PM Daily Status Cutoff job:
      1. Lock all submissions for `target_date`.
      2. Explicitly write status='NA' and comments='NA' for every active user who did not submit.
      3. Generate and dispatch the 8:00 PM Daily Status Email Report to Admin(s).
      4. Record an immutable audit log entry in S3.
    """
    date_str = target_date or today_str()
    users_doc = db.read_document("db/users.json", default={"users": []})
    active_users = [
        u for u in users_doc.get("users", []) if u.get("is_active", True)
    ]

    status_key = f"db/daily_status/{date_str}.json"
    now_iso = now_local().isoformat()

    def _finalize_mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        submissions = doc.get("submissions", {})
        for u in active_users:
            uid = u["id"]
            existing = submissions.get(uid)
            if existing and existing.get("status") == "SUBMITTED":
                existing["locked"] = True
                submissions[uid] = existing
            else:
                submissions[uid] = {
                    "user_id": uid,
                    "username": u["username"],
                    "full_name": u["full_name"],
                    "department": u.get("department", "Engineering"),
                    "date": date_str,
                    "status": "NA",
                    "tasks_worked_on": [],
                    "accomplishments": "NA",
                    "planned_next": "NA",
                    "blockers_remarks": "NA",
                    "hours_logged": 0.0,
                    "submitted_at": None,
                    "submitted_at_display": "NA",
                    "last_updated_at": now_iso,
                    "edit_count": 0,
                    "locked": True,
                }
        doc["date"] = date_str
        doc["cutoff_finalized"] = True
        doc["cutoff_finalized_at"] = now_iso
        doc["submissions"] = submissions
        return doc, doc

    db.atomic_update(
        status_key,
        default={"date": date_str, "cutoff_finalized": False, "submissions": {}},
        mutator_fn=_finalize_mutate,
    )

    consolidated = get_consolidated_daily_status(date_str)
    report_record = send_daily_status_email(
        report_date=date_str,
        rows=consolidated["rows"],
        triggered_by=triggered_by,
    )

    db.append_audit_log(
        actor_id="SYSTEM-8PM-CRON",
        actor_name="8:00 PM EventBridge Scheduler",
        actor_role="SYSTEM",
        action="DAILY_STATUS_8PM_CUTOFF_AND_EMAIL",
        resource_type="DAILY_STATUS_REPORT",
        resource_id=report_record["id"],
        details=(
            f"Finalized 8:00 PM cutoff for {date_str}: "
            f"{report_record['submitted_count']} submitted, "
            f"{report_record['na_count']} marked as NA. Email dispatched ({report_record['dispatch_status']})."
        ),
    )

    return {
        "consolidated": consolidated,
        "report": report_record,
    }
