"""
8:00 PM Automated Daily Status Email Service (AWS SES + S3 Outbox Archive).
Generates consolidated HTML and Plaintext tables showing every user's daily status
and explicitly marking unsubmitted users as 'NA'.
"""

import html
import uuid
from typing import Any

import boto3

from backend.config import (
    ADMIN_REPORT_EMAILS,
    APP_NAME,
    AWS_REGION,
    EMAIL_MODE,
    SES_SENDER_EMAIL,
    now_local,
)
from backend.s3_db import db


def build_daily_status_email_content(
    report_date: str,
    rows: list[dict[str, Any]],
) -> tuple[str, str, str]:
    """
    Build (subject, html_body, text_body) for the 8:00 PM Daily Status Report.
    Any user who did not submit before 8:00 PM is shown with status 'NA' and comments 'NA'.
    """
    total_users = len(rows)
    submitted_count = sum(1 for r in rows if r.get("status") == "SUBMITTED")
    na_count = sum(1 for r in rows if r.get("status") == "NA")
    blocker_count = sum(
        1
        for r in rows
        if r.get("status") == "SUBMITTED"
        and r.get("blockers_remarks")
        and r.get("blockers_remarks", "").strip().lower() not in ("none", "na", "n/a", "-", "")
    )

    subject = (
        f"[{APP_NAME}] 8:00 PM Daily Status Report ({report_date}) — "
        f"{submitted_count}/{total_users} Submitted, {na_count} NA"
    )

    # Plaintext version
    text_lines = [
        f"======================================================================",
        f" {APP_NAME} — 8:00 PM DAILY STATUS REPORT",
        f" Date: {report_date} | Generated at: {now_local().strftime('%Y-%m-%d %H:%M:%S %Z')}",
        f" Summary: {submitted_count} Submitted | {na_count} Not Submitted (NA) | {blocker_count} Blockers",
        f"======================================================================",
        "",
    ]

    for idx, r in enumerate(rows, start=1):
        st = r.get("status", "NA")
        tasks_str = ", ".join(r.get("tasks_worked_on", [])) if r.get("tasks_worked_on") else "NA"
        comments = r.get("accomplishments", "NA") if st == "SUBMITTED" else "NA"
        blockers = r.get("blockers_remarks", "NA") if st == "SUBMITTED" else "NA"
        sub_time = r.get("submitted_at_display", "NA") if st == "SUBMITTED" else "NA"
        text_lines.append(
            f"{idx:02d}. {r['full_name']} (@{r['username']}) [{r.get('department', 'Team')}]\n"
            f"    Status      : {st}\n"
            f"    Tasks       : {tasks_str}\n"
            f"    Comments    : {comments}\n"
            f"    Blockers    : {blockers}\n"
            f"    Submitted At: {sub_time}\n"
            f"----------------------------------------------------------------------"
        )

    text_body = "\n".join(text_lines)

    # HTML version
    table_rows_html = []
    for idx, r in enumerate(rows, start=1):
        st = r.get("status", "NA")
        is_na = st == "NA"
        badge_bg = "#dc2626" if is_na else "#16a34a"
        row_bg = "#fff5f5" if is_na else ("#ffffff" if idx % 2 == 1 else "#f8fafc")

        tasks_list = r.get("tasks_worked_on", [])
        tasks_str = html.escape(", ".join(tasks_list)) if (tasks_list and not is_na) else "NA"
        comments_str = html.escape(r.get("accomplishments", "NA")) if not is_na else "NA"
        planned_str = html.escape(r.get("planned_next", "-")) if not is_na else "NA"
        blockers_str = html.escape(r.get("blockers_remarks", "None")) if not is_na else "NA"
        hours_str = f"{r.get('hours_logged', 0):.1f}h" if not is_na else "NA"
        sub_time_str = html.escape(r.get("submitted_at_display", "NA")) if not is_na else "NA"

        table_rows_html.append(
            f"""
            <tr style="background-color: {row_bg}; border-bottom: 1px solid #e2e8f0;">
                <td style="padding: 10px 12px; font-weight: 600; color: #1e293b;">
                    {html.escape(r['full_name'])}<br/>
                    <span style="font-size: 11px; color: #64748b; font-weight: 400;">
                        @{html.escape(r['username'])} • {html.escape(r.get('department', ''))}
                    </span>
                </td>
                <td style="padding: 10px 12px; text-align: center;">
                    <span style="display: inline-block; padding: 3px 10px; border-radius: 12px;
                                 font-size: 11px; font-weight: 700; color: #ffffff; background: {badge_bg};">
                        {html.escape(st)}
                    </span>
                </td>
                <td style="padding: 10px 12px; font-family: monospace; font-size: 12px; color: #334155;">
                    {tasks_str}
                </td>
                <td style="padding: 10px 12px; font-size: 13px; color: { '#dc2626' if is_na else '#1e293b' }; font-weight: { '700' if is_na else '400' };">
                    {comments_str}
                </td>
                <td style="padding: 10px 12px; font-size: 12px; color: #475569;">
                    {planned_str}
                </td>
                <td style="padding: 10px 12px; font-size: 12px; color: #b91c1c;">
                    {blockers_str}
                </td>
                <td style="padding: 10px 12px; text-align: center; font-size: 12px; color: #475569;">
                    {hours_str}<br/>
                    <span style="font-size: 10px; color: #94a3b8;">{sub_time_str}</span>
                </td>
            </tr>
            """
        )

    html_body = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>{html.escape(subject)}</title></head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f1f5f9; padding: 24px; margin: 0;">
  <div style="max-width: 1040px; margin: 0 auto; background: #ffffff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(15,23,42,0.08); border: 1px solid #cbd5e1;">
    <div style="background: #0f172a; color: #ffffff; padding: 20px 24px;">
      <div style="font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: #38bdf8; font-weight: 700;">
        Automated 8:00 PM Daily Status Summary
      </div>
      <h2 style="margin: 6px 0 4px 0; font-size: 20px;">{html.escape(APP_NAME)} — Daily Status Report</h2>
      <div style="font-size: 13px; color: #94a3b8;">
        Report Date: <strong style="color: #f8fafc;">{html.escape(report_date)}</strong> |
        Cutoff Time: <strong style="color: #f8fafc;">20:00 (8:00 PM IST)</strong>
      </div>
    </div>

    <div style="display: flex; gap: 16px; padding: 16px 24px; background: #f8fafc; border-bottom: 1px solid #e2e8f0;">
      <div style="flex: 1; padding: 12px; background: #ffffff; border-radius: 8px; border: 1px solid #e2e8f0;">
        <div style="font-size: 11px; color: #64748b; text-transform: uppercase;">Total Team Members</div>
        <div style="font-size: 22px; font-weight: 700; color: #0f172a;">{total_users}</div>
      </div>
      <div style="flex: 1; padding: 12px; background: #f0fdf4; border-radius: 8px; border: 1px solid #bbf7d0;">
        <div style="font-size: 11px; color: #166534; text-transform: uppercase;">Submitted Before 8 PM</div>
        <div style="font-size: 22px; font-weight: 700; color: #15803d;">{submitted_count}</div>
      </div>
      <div style="flex: 1; padding: 12px; background: #fef2f2; border-radius: 8px; border: 1px solid #fecaca;">
        <div style="font-size: 11px; color: #991b1b; text-transform: uppercase;">Not Submitted (Marked NA)</div>
        <div style="font-size: 22px; font-weight: 700; color: #dc2626;">{na_count}</div>
      </div>
      <div style="flex: 1; padding: 12px; background: #fffbeb; border-radius: 8px; border: 1px solid #fde68a;">
        <div style="font-size: 11px; color: #92400e; text-transform: uppercase;">Reported Blockers</div>
        <div style="font-size: 22px; font-weight: 700; color: #d97706;">{blocker_count}</div>
      </div>
    </div>

    <div style="padding: 20px 24px; overflow-x: auto;">
      <table style="width: 100%; border-collapse: collapse; text-align: left;">
        <thead>
          <tr style="background: #1e293b; color: #ffffff; font-size: 12px; text-transform: uppercase;">
            <th style="padding: 10px 12px;">Team Member</th>
            <th style="padding: 10px 12px; text-align: center;">Status</th>
            <th style="padding: 10px 12px;">Tasks</th>
            <th style="padding: 10px 12px;">Daily Comments / Work Done</th>
            <th style="padding: 10px 12px;">Next Plan</th>
            <th style="padding: 10px 12px;">Blockers / Remarks</th>
            <th style="padding: 10px 12px; text-align: center;">Hours / Time</th>
          </tr>
        </thead>
        <tbody>
          {''.join(table_rows_html)}
        </tbody>
      </table>
    </div>

    <div style="padding: 14px 24px; background: #f8fafc; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b;">
      Note: Any team member who did not submit their daily status before 8:00 PM is automatically recorded as <strong>NA</strong>.
    </div>
  </div>
</body>
</html>"""

    return subject, html_body, text_body


def send_daily_status_email(
    report_date: str,
    rows: list[dict[str, Any]],
    triggered_by: str = "aws.events.cron.8pm",
) -> dict[str, Any]:
    """
    Dispatch the 8:00 PM Daily Status email via AWS SES (in production VPC)
    and persist the report + email payload in S3 (`db/reports/daily_report_{YYYY-MM-DD}.json`).
    """
    subject, html_body, text_body = build_daily_status_email_content(report_date, rows)
    dispatch_status = "STORED_IN_S3_OUTBOX"
    ses_message_id: str | None = None
    error_detail: str | None = None

    if EMAIL_MODE == "ses":
        try:
            ses_client = boto3.client("ses", region_name=AWS_REGION)
            resp = ses_client.send_email(
                Source=SES_SENDER_EMAIL,
                Destination={"ToAddresses": ADMIN_REPORT_EMAILS},
                Message={
                    "Subject": {"Data": subject, "Charset": "UTF-8"},
                    "Body": {
                        "Text": {"Data": text_body, "Charset": "UTF-8"},
                        "Html": {"Data": html_body, "Charset": "UTF-8"},
                    },
                },
            )
            ses_message_id = resp.get("MessageId")
            dispatch_status = "SENT_VIA_AWS_SES"
        except Exception as exc:
            dispatch_status = "SES_ERROR_SAVED_TO_S3"
            error_detail = str(exc)
    else:
        ses_message_id = f"local-ses-{uuid.uuid4().hex[:12]}"
        dispatch_status = "DISPATCHED_LOCAL_OUTBOX"

    report_record = {
        "id": f"RPT-{report_date}",
        "report_date": report_date,
        "generated_at": now_local().isoformat(),
        "triggered_by": triggered_by,
        "recipients": ADMIN_REPORT_EMAILS,
        "sender": SES_SENDER_EMAIL,
        "subject": subject,
        "dispatch_status": dispatch_status,
        "ses_message_id": ses_message_id,
        "error_detail": error_detail,
        "total_users": len(rows),
        "submitted_count": sum(1 for r in rows if r.get("status") == "SUBMITTED"),
        "na_count": sum(1 for r in rows if r.get("status") == "NA"),
        "rows": rows,
        "html_body": html_body,
        "text_body": text_body,
    }

    report_key = f"db/reports/daily_report_{report_date}.json"
    db.atomic_update(
        report_key,
        default={},
        mutator_fn=lambda _doc: (report_record, report_record),
    )

    return report_record
