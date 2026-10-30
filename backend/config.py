"""
Configuration & Environment Settings for CSR Work Flow Manager.
Designed for AWS Lambda + Amazon S3 Document DB inside a Private VPC.
"""

import os
from datetime import datetime, date, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path(__file__).resolve().parent.parent

# Application Metadata
APP_NAME = "CSR Work Flow Manager"
APP_VERSION = "1.0.0"
ORGANIZATION_NAME = os.getenv("ORGANIZATION_NAME", "CSR Internal Engineering & Design")
MAX_TEAM_SIZE = int(os.getenv("MAX_TEAM_SIZE", "25"))  # Designed for 20-member internal team

# Environment & Storage Mode ("s3" in AWS Lambda, "local" for local development/testing)
ENV_STAGE = os.getenv("ENV_STAGE", "local")  # "local" | "priv-vpc-prod"
S3_BUCKET_NAME = os.getenv("S3_BUCKET_NAME", "")
STORAGE_MODE = os.getenv("STORAGE_MODE", "s3" if S3_BUCKET_NAME else "local")
AWS_REGION = os.getenv("AWS_REGION", "ap-south-1")
KMS_KEY_ID = os.getenv("KMS_KEY_ID", "")  # Optional SSE-KMS key ARN for S3 encryption

# Local S3 Document DB emulation directory (defaults to writable /tmp on AWS Lambda)
_default_local_s3 = "/tmp/.s3_local_db" if os.getenv("AWS_LAMBDA_FUNCTION_NAME") else str(BASE_DIR / ".s3_local_db")
LOCAL_S3_DIR = Path(os.getenv("LOCAL_S3_DIR", _default_local_s3))

# Security & JWT Settings
# In production Lambda, injected via AWS Secrets Manager / KMS-encrypted environment variable
JWT_SECRET_KEY = os.getenv(
    "JWT_SECRET_KEY",
    "csr-internal-vpc-only-jwt-secret-key-change-in-production-9f8e7d6c5b4a3",
)
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "720"))  # 12-hour shift session

# Network & VPC Security Enforcement
ENFORCE_PRIVATE_VPC_HEADERS = os.getenv("ENFORCE_PRIVATE_VPC_HEADERS", "false").lower() == "true"
ALLOWED_VPC_ENDPOINT_ID = os.getenv("ALLOWED_VPC_ENDPOINT_ID", "")

# Timezone & 8:00 PM Daily Status Cutoff Configuration
APP_TIMEZONE_NAME = os.getenv("APP_TIMEZONE", "Asia/Kolkata")
try:
    APP_TZ = ZoneInfo(APP_TIMEZONE_NAME)
except Exception:
    # Fallback to fixed +05:30 IST offset if tzdata is missing
    APP_TZ = timezone(timedelta(hours=5, minutes=30))

DAILY_CUTOFF_HOUR = int(os.getenv("DAILY_CUTOFF_HOUR", "20"))  # 20:00 (8:00 PM)
DAILY_CUTOFF_MINUTE = int(os.getenv("DAILY_CUTOFF_MINUTE", "0"))

# Email / AWS SES Settings for 8:00 PM Automated Report
SES_SENDER_EMAIL = os.getenv("SES_SENDER_EMAIL", "csr-workflow-noreply@internal.csr.local")
ADMIN_REPORT_EMAILS = [
    e.strip()
    for e in os.getenv("ADMIN_REPORT_EMAILS", "manager@internal.csr.local,admin@internal.csr.local").split(",")
    if e.strip()
]
EMAIL_MODE = os.getenv("EMAIL_MODE", "ses" if ENV_STAGE == "priv-vpc-prod" else "local_outbox")

# Runtime clock override (only used when Admin tests Before/After 8 PM cutoff in non-prod/demo)
_CLOCK_OVERRIDE_TIME: tuple[int, int] | None = None


def set_clock_override(hour: int | None, minute: int = 0) -> None:
    """Allow Admin or automated tests to simulate time of day (e.g. 19:30 vs 20:05)."""
    global _CLOCK_OVERRIDE_TIME
    if hour is None:
        _CLOCK_OVERRIDE_TIME = None
    else:
        _CLOCK_OVERRIDE_TIME = (int(hour), int(minute))


def get_clock_override() -> tuple[int, int] | None:
    return _CLOCK_OVERRIDE_TIME


def now_local() -> datetime:
    """Return current datetime in the configured team timezone (default IST +05:30)."""
    real_now = datetime.now(APP_TZ)
    if _CLOCK_OVERRIDE_TIME is not None:
        h, m = _CLOCK_OVERRIDE_TIME
        return real_now.replace(hour=h, minute=m, second=0, microsecond=0)
    return real_now


def today_str() -> str:
    """Return today's date string in YYYY-MM-DD format in team timezone."""
    return now_local().strftime("%Y-%m-%d")


def is_daily_status_editable(target_date_str: str | None = None) -> tuple[bool, str]:
    """
    Check whether a user can submit or edit their daily status for `target_date_str`.
    Rule:
      - Users can ONLY submit/edit today's daily status BEFORE 8:00 PM (20:00).
      - Past dates cannot be edited by regular users.
      - Future dates cannot be submitted early.
      - At or after 8:00 PM (20:00:00), editing is locked and unsubmitted users become 'NA'.
    """
    current = now_local()
    today = current.strftime("%Y-%m-%d")
    check_date = target_date_str or today

    if check_date < today:
        return False, f"Daily status window for {check_date} has already closed."
    if check_date > today:
        return False, f"Cannot submit daily status for a future date ({check_date})."

    cutoff_dt = current.replace(
        hour=DAILY_CUTOFF_HOUR,
        minute=DAILY_CUTOFF_MINUTE,
        second=0,
        microsecond=0,
    )
    if current >= cutoff_dt:
        return (
            False,
            f"Daily status editing locked after {DAILY_CUTOFF_HOUR:02d}:{DAILY_CUTOFF_MINUTE:02d} "
            f"(8:00 PM). Unsubmitted statuses are marked as NA.",
        )

    remaining = cutoff_dt - current
    mins_left = int(remaining.total_seconds() // 60)
    hours_left = mins_left // 60
    rem_mins = mins_left % 60
    return True, f"Open for submission ({hours_left}h {rem_mins}m remaining until 8:00 PM cutoff)"
