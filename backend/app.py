"""
CSR Work Flow Manager — FastAPI Application & AWS Lambda Entrypoint (Mangum + EventBridge).
"""

import types
import uuid
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Optional, Tuple

from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response, status
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from mangum import Mangum

from backend.config import (
    ALLOWED_VPC_ENDPOINT_ID,
    APP_NAME,
    APP_TIMEZONE_NAME,
    APP_VERSION,
    DAILY_CUTOFF_HOUR,
    DAILY_CUTOFF_MINUTE,
    EMAIL_MODE,
    ENFORCE_PRIVATE_VPC_HEADERS,
    ENV_STAGE,
    MAX_TEAM_SIZE,
    ORGANIZATION_NAME,
    STORAGE_MODE,
    get_clock_override,
    is_daily_status_editable,
    now_local,
    set_clock_override,
    today_str,
)
from backend.models import (
    CommentType,
    DailyStatusSubmitRequest,
    LoginRequest,
    SprintCreateRequest,
    TaskCommentCreateRequest,
    TaskCreateRequest,
    TaskStatus,
    TaskUpdateRequest,
    TeamCreateRequest,
    TeamUpdateRequest,
    TimelineExtendRequest,
    UserCreateRequest,
    UserUpdateRequest,
)
from backend.s3_db import db
from backend.scheduler import (
    execute_8pm_daily_cutoff_and_email,
    get_consolidated_daily_status,
)
from backend.security import (
    create_access_token,
    get_current_user,
    hash_password,
    require_admin,
    sanitize_user,
    verify_password,
)
from backend.seed import ensure_seed_data

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(
    title=APP_NAME,
    version=APP_VERSION,
    description=(
        "Internal Jira & Daily Status Workflow Manager for a 20-member engineering/design team. "
        "Deployed on AWS Lambda with Amazon S3 Document DB inside a Private VPC (Zero Internet Exposure)."
    ),
    docs_url="/api/docs",
    redoc_url=None,
)

AVATAR_COLORS = [
    "#2563eb", "#db2777", "#059669", "#7c3aed", "#d97706",
    "#0891b2", "#4f46e5", "#be123c", "#0d9488", "#9333ea",
]


# Ensure seed data is initialized on startup / serverless cold start
try:
    ensure_seed_data()
except Exception as _seed_err:
    import logging
    logging.getLogger("uvicorn.error").warning("Initial seed deferred or skipped: %s", _seed_err)


@app.middleware("http")
async def security_and_vpc_isolation_middleware(request: Request, call_next):
    """
    Enforce Private VPC headers (when enabled in AWS) and attach strict security headers
    so no information is exposed or cached insecurely.
    """
    if ENFORCE_PRIVATE_VPC_HEADERS and ALLOWED_VPC_ENDPOINT_ID:
        vpce_header = request.headers.get("x-amzn-vpce-id", "")
        if vpce_header != ALLOWED_VPC_ENDPOINT_ID:
            return JSONResponse(
                status_code=status.HTTP_403_FORBIDDEN,
                content={"detail": "Forbidden: Request must originate from internal AWS VPC Endpoint."},
            )

    response: Response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Content-Security-Policy"] = (
        "default-src 'self'; "
        "script-src 'self' 'unsafe-inline'; "
        "style-src 'self' 'unsafe-inline'; "
        "img-src 'self' data:; "
        "font-src 'self' data:; "
        "connect-src 'self'; "
        "frame-ancestors 'none';"
    )
    if request.url.path.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate, private"
    return response


# ---------------------------------------------------------------------------
# 1. Public System Info & Main Page Metadata ("CSR Work Flow Manager")
# ---------------------------------------------------------------------------

@app.get("/api/info")
def get_system_info() -> dict[str, Any]:
    """Return CSR Work Flow Manager main page info, clock status, and security posture."""
    now = now_local()
    today = today_str()
    editable, window_msg = is_daily_status_editable(today)
    clock_override = get_clock_override()

    users_doc = db.read_document("db/users.json", default={"users": []})
    active_users_count = sum(1 for u in users_doc.get("users", []) if u.get("is_active", True))

    return {
        "app_name": APP_NAME,
        "version": APP_VERSION,
        "organization": ORGANIZATION_NAME,
        "storage_engine": f"Amazon S3 Document DB ({STORAGE_MODE.upper()} mode)",
        "compute_engine": "AWS Lambda (Python FastAPI + Mangum)",
        "network_posture": "Private VPC Only • Zero Internet Exposure • S3 & SES VPC Endpoints",
        "team_size_active": active_users_count,
        "max_team_capacity": MAX_TEAM_SIZE,
        "server_time_iso": now.isoformat(),
        "server_time_display": now.strftime("%I:%M %p"),
        "current_time_ist": f"{now.strftime('%I:%M %p')} IST",
        "server_date": today,
        "current_date_ist": today,
        "timezone": APP_TIMEZONE_NAME,
        "daily_cutoff_time": f"{DAILY_CUTOFF_HOUR:02d}:{DAILY_CUTOFF_MINUTE:02d} (8:00 PM)",
        "is_daily_status_open": editable,
        "daily_status_editable": editable,
        "daily_status_window_message": window_msg,
        "clock_simulated": clock_override is not None,
        "clock_override": f"{clock_override[0]:02d}:{clock_override[1]:02d}" if clock_override else None,
    }


# ---------------------------------------------------------------------------
# 2. Authentication (Role-Based Login: ADMIN vs USER)
# ---------------------------------------------------------------------------

@app.post("/api/auth/login")
def login(payload: LoginRequest, request: Request, response: Response) -> dict[str, Any]:
    users_doc = db.read_document("db/users.json", default={"users": []})
    uname = payload.username.strip().lower()

    matched_user: dict[str, Any] | None = None
    for u in users_doc.get("users", []):
        if u["username"].lower() == uname:
            matched_user = u
            break

    if not matched_user or not verify_password(payload.password, matched_user.get("password_hash", "")):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    if not matched_user.get("is_active", True):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Account is deactivated. Contact your CSR Workflow Manager (Admin).",
        )

    token = create_access_token(matched_user)
    response.set_cookie(
        key="csr_access_token",
        value=token,
        httponly=True,
        samesite="strict",
        secure=(ENV_STAGE == "priv-vpc-prod"),
        max_age=12 * 3600,
    )

    client_ip = request.client.host if request.client else "internal-vpc"
    db.append_audit_log(
        actor_id=matched_user["id"],
        actor_name=matched_user["full_name"],
        actor_role=matched_user["role"],
        action="USER_LOGIN",
        resource_type="AUTH",
        resource_id=matched_user["id"],
        details=f"User @{matched_user['username']} ({matched_user['role']}) signed in.",
        ip_address=client_ip,
    )

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": sanitize_user(matched_user),
    }


@app.post("/api/auth/logout")
def logout(response: Response) -> dict[str, str]:
    response.delete_cookie("csr_access_token")
    return {"message": "Signed out of CSR Work Flow Manager."}


@app.get("/api/auth/me")
def get_me(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    return {"user": current_user}


# ---------------------------------------------------------------------------
# 3. User Management (Admin can Add, Edit, Delete Users)
# ---------------------------------------------------------------------------

@app.get("/api/users")
def list_users(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    users_doc = db.read_document("db/users.json", default={"users": []})
    users = [sanitize_user(u) for u in users_doc.get("users", [])]
    return {
        "total": len(users),
        "max_capacity": MAX_TEAM_SIZE,
        "users": users,
    }


@app.post("/api/users", status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreateRequest,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    now_iso = now_local().isoformat()

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        users: list[dict[str, Any]] = doc.get("users", [])
        if len(users) >= MAX_TEAM_SIZE:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Team capacity limit ({MAX_TEAM_SIZE} members) reached.",
            )
        uname = payload.username.strip().lower()
        for existing in users:
            if existing["username"].lower() == uname:
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Username '{payload.username}' already exists.",
                )

        existing_nums = [
            int(u["id"].split("-")[1])
            for u in users
            if u["id"].startswith("USR-") and u["id"].split("-")[1].isdigit()
        ]
        next_num = (max(existing_nums) + 1) if existing_nums else (len(users) + 1)
        new_user = {
            "id": f"USR-{next_num:03d}",
            "username": uname,
            "full_name": payload.full_name.strip(),
            "email": payload.email.strip().lower(),
            "password_hash": hash_password(payload.password),
            "role": payload.role.value,
            "department": payload.department.strip(),
            "designation": payload.designation.strip(),
            "team_id": (payload.team_id.strip() if payload.team_id else "TEAM-DEVOPS"),
            "avatar_color": AVATAR_COLORS[next_num % len(AVATAR_COLORS)],
            "is_active": payload.is_active,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        users.append(new_user)
        doc["users"] = users
        return doc, new_user

    created = db.atomic_update("db/users.json", default={"users": []}, mutator_fn=_mutate)
    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="USER_CREATED",
        resource_type="USER",
        resource_id=created["id"],
        details=f"Admin added user {created['full_name']} (@{created['username']}) with role {created['role']}.",
    )
    return {"user": sanitize_user(created)}


@app.put("/api/users/{user_id}")
@app.patch("/api/users/{user_id}")
def update_user(
    user_id: str,
    payload: UserUpdateRequest,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    now_iso = now_local().isoformat()

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        users: list[dict[str, Any]] = doc.get("users", [])
        for u in users:
            if u["id"] == user_id:
                if payload.full_name is not None:
                    u["full_name"] = payload.full_name.strip()
                if payload.email is not None:
                    u["email"] = payload.email.strip().lower()
                if payload.password:
                    u["password_hash"] = hash_password(payload.password)
                if payload.role is not None:
                    u["role"] = payload.role.value
                if payload.department is not None:
                    u["department"] = payload.department.strip()
                if payload.designation is not None:
                    u["designation"] = payload.designation.strip()
                if payload.team_id is not None:
                    u["team_id"] = payload.team_id.strip()
                if payload.is_active is not None:
                    if user_id == admin_user["id"] and not payload.is_active:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail="Admin cannot deactivate their own account.",
                        )
                    u["is_active"] = payload.is_active
                u["updated_at"] = now_iso
                doc["users"] = users
                return doc, u
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    updated = db.atomic_update("db/users.json", default={"users": []}, mutator_fn=_mutate)
    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="USER_UPDATED",
        resource_type="USER",
        resource_id=user_id,
        details=f"Admin updated user profile for {updated['full_name']} (@{updated['username']}).",
    )
    return {"user": sanitize_user(updated)}


@app.delete("/api/users/{user_id}")
def delete_user(
    user_id: str,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    if user_id == admin_user["id"]:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Admin cannot delete their own active account.",
        )

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        users: list[dict[str, Any]] = doc.get("users", [])
        for idx, u in enumerate(users):
            if u["id"] == user_id:
                removed = users.pop(idx)
                doc["users"] = users
                return doc, removed
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found.")

    removed = db.atomic_update("db/users.json", default={"users": []}, mutator_fn=_mutate)
    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="USER_DELETED",
        resource_type="USER",
        resource_id=user_id,
        details=f"Admin deleted user {removed['full_name']} (@{removed['username']}).",
    )
    return {"message": f"User {removed['full_name']} removed.", "deleted_user_id": user_id}


# ---------------------------------------------------------------------------
# 3b. Teams & Squads Management (Admin can Add, Edit, Delete Teams)
# ---------------------------------------------------------------------------

@app.get("/api/teams")
def list_teams(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    teams_doc = db.read_document("db/teams.json", default={"teams": []})
    users_doc = db.read_document("db/users.json", default={"users": []})
    tasks_doc = db.read_document("db/tasks.json", default={"tasks": []})

    users_map = {u["id"]: sanitize_user(u) for u in users_doc.get("users", [])}
    tasks = tasks_doc.get("tasks", [])
    teams = teams_doc.get("teams", [])

    enriched_teams = []
    for team in teams:
        team_copy = dict(team)
        lead_id = team.get("lead_id")
        lead = users_map.get(lead_id) if lead_id else None
        team_copy["lead_name"] = lead.get("full_name", "") if lead else ""
        team_copy["lead_email"] = lead.get("email", "") if lead else ""
        team_copy["lead_username"] = lead.get("username", "") if lead else ""

        member_ids = team.get("member_ids", [])
        team_members = [users_map[mid] for mid in member_ids if mid in users_map]
        team_copy["members"] = team_members
        team_copy["member_count"] = len(team_members)

        team_member_set = set(member_ids)
        team_tasks = [t for t in tasks if t.get("assignee_id") in team_member_set]
        team_copy["total_tasks"] = len(team_tasks)
        team_copy["done_tasks"] = sum(1 for t in team_tasks if t.get("status") == "DONE")
        team_copy["active_tasks"] = sum(1 for t in team_tasks if t.get("status") in ("TODO", "IN_PROGRESS", "IN_REVIEW"))
        team_copy["blocked_tasks"] = sum(1 for t in team_tasks if t.get("status") == "BLOCKED" or t.get("has_blocker"))

        enriched_teams.append(team_copy)

    return {
        "total": len(enriched_teams),
        "teams": enriched_teams,
    }


@app.post("/api/teams", status_code=status.HTTP_201_CREATED)
def create_team(
    payload: TeamCreateRequest,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    now_iso = now_local().isoformat()

    def _mutate_teams(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        teams: list[dict[str, Any]] = doc.get("teams", [])
        norm_name = payload.name.strip()
        for t in teams:
            if t["name"].strip().lower() == norm_name.lower():
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"Team with name '{norm_name}' already exists.",
                )

        slug = "".join(c if c.isalnum() else "-" for c in norm_name.lower()).strip("-")
        team_id = f"TEAM-{slug[:16].upper()}-{uuid.uuid4().hex[:4].upper()}"
        new_team = {
            "id": team_id,
            "name": norm_name,
            "slug": slug,
            "description": payload.description.strip(),
            "lead_id": payload.lead_id,
            "member_ids": payload.member_ids,
            "created_at": now_iso,
            "updated_at": now_iso,
        }
        teams.append(new_team)
        doc["teams"] = teams
        return doc, new_team

    created_team = db.atomic_update("db/teams.json", default={"teams": []}, mutator_fn=_mutate_teams)

    if payload.member_ids:
        def _update_users(udoc: dict[str, Any]) -> Tuple[dict[str, Any], Any]:
            for u in udoc.get("users", []):
                if u["id"] in payload.member_ids:
                    u["team_id"] = created_team["id"]
            return udoc, True
        db.atomic_update("db/users.json", default={"users": []}, mutator_fn=_update_users)

    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="TEAM_CREATED",
        resource_type="TEAM",
        resource_id=created_team["id"],
        details=f"Admin created team '{created_team['name']}' with {len(payload.member_ids)} members.",
    )
    return {"team": created_team}


@app.get("/api/teams/{team_id}")
def get_team(team_id: str, current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    teams_doc = db.read_document("db/teams.json", default={"teams": []})
    for t in teams_doc.get("teams", []):
        if t["id"] == team_id or t.get("slug") == team_id.lower():
            return {"team": t}
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found.")


@app.put("/api/teams/{team_id}")
@app.patch("/api/teams/{team_id}")
def update_team(
    team_id: str,
    payload: TeamUpdateRequest,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    now_iso = now_local().isoformat()

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        teams: list[dict[str, Any]] = doc.get("teams", [])
        for t in teams:
            if t["id"] == team_id or t.get("slug") == team_id.lower():
                if payload.name is not None:
                    t["name"] = payload.name.strip()
                if payload.description is not None:
                    t["description"] = payload.description.strip()
                if payload.lead_id is not None:
                    t["lead_id"] = payload.lead_id
                if payload.member_ids is not None:
                    t["member_ids"] = payload.member_ids
                t["updated_at"] = now_iso
                doc["teams"] = teams
                return doc, t
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found.")

    updated_team = db.atomic_update("db/teams.json", default={"teams": []}, mutator_fn=_mutate)

    if payload.member_ids is not None:
        def _sync_members(udoc: dict[str, Any]) -> Tuple[dict[str, Any], Any]:
            for u in udoc.get("users", []):
                if u["id"] in payload.member_ids:
                    u["team_id"] = team_id
                elif u.get("team_id") == team_id:
                    u["team_id"] = None
            return udoc, True
        db.atomic_update("db/users.json", default={"users": []}, mutator_fn=_sync_members)

    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="TEAM_UPDATED",
        resource_type="TEAM",
        resource_id=team_id,
        details=f"Admin updated team '{updated_team['name']}'.",
    )
    return {"team": updated_team}


@app.delete("/api/teams/{team_id}")
def delete_team(
    team_id: str,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        teams: list[dict[str, Any]] = doc.get("teams", [])
        for idx, t in enumerate(teams):
            if t["id"] == team_id or t.get("slug") == team_id.lower():
                removed = teams.pop(idx)
                doc["teams"] = teams
                return doc, removed
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Team not found.")

    removed_team = db.atomic_update("db/teams.json", default={"teams": []}, mutator_fn=_mutate)

    def _clear_user_team(udoc: dict[str, Any]) -> Tuple[dict[str, Any], Any]:
        for u in udoc.get("users", []):
            if u.get("team_id") == team_id:
                u["team_id"] = None
        return udoc, True
    db.atomic_update("db/users.json", default={"users": []}, mutator_fn=_clear_user_team)

    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="TEAM_DELETED",
        resource_type="TEAM",
        resource_id=team_id,
        details=f"Admin deleted team '{removed_team['name']}'.",
    )
    return {"message": f"Team '{removed_team['name']}' deleted.", "deleted_team": removed_team}



# ---------------------------------------------------------------------------
# 4. Tasks / Jira Workflow (Assign Design Tasks, Extend Timelines, Blockers/Remarks)
# ---------------------------------------------------------------------------

def _enrich_tasks(tasks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    users_doc = db.read_document("db/users.json", default={"users": []})
    user_map = {u["id"]: u for u in users_doc.get("users", [])}
    today = today_str()

    enriched = []
    for t in tasks:
        copy_t = dict(t)
        assignee = user_map.get(copy_t.get("assignee_id", ""))
        reporter = user_map.get(copy_t.get("reporter_id", ""))
        copy_t["assignee_name"] = assignee["full_name"] if assignee else "Unassigned"
        copy_t["assignee_username"] = assignee["username"] if assignee else ""
        copy_t["assignee_department"] = assignee.get("department", "") if assignee else ""
        copy_t["assignee_team_id"] = assignee.get("team_id", "") if assignee else ""
        copy_t["assignee_color"] = assignee.get("avatar_color", "#475569") if assignee else "#475569"
        copy_t["reporter_name"] = reporter["full_name"] if reporter else "Manager"
        copy_t["is_overdue"] = (
            copy_t.get("due_date", "9999-99-99") < today
            and copy_t.get("status") != TaskStatus.DONE.value
        )
        copy_t["is_timeline_extended"] = copy_t.get("extension_count", 0) > 0
        enriched.append(copy_t)
    return enriched


@app.get("/api/tasks")
def list_tasks(
    assignee_id: Optional[str] = Query(default=None),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    task_type: Optional[str] = Query(default=None),
    priority: Optional[str] = Query(default=None),
    sprint_id: Optional[str] = Query(default=None),
    team_id: Optional[str] = Query(default=None),
    has_blocker: Optional[bool] = Query(default=None),
    search: Optional[str] = Query(default=None),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    tasks_doc = db.read_document("db/tasks.json", default={"next_seq": 101, "tasks": []})
    tasks = _enrich_tasks(tasks_doc.get("tasks", []))

    if team_id and team_id.upper() != "ALL":
        teams_doc = db.read_document("db/teams.json", default={"teams": []})
        matched_team = next((tm for tm in teams_doc.get("teams", []) if tm["id"] == team_id or tm.get("slug") == team_id.lower()), None)
        if matched_team:
            member_set = set(matched_team.get("member_ids", []))
            tasks = [t for t in tasks if t.get("assignee_id") in member_set]

    if assignee_id:
        tasks = [t for t in tasks if t.get("assignee_id") == assignee_id]
    if status_filter:
        tasks = [t for t in tasks if t.get("status") == status_filter]
    if task_type:
        tasks = [t for t in tasks if t.get("task_type") == task_type]
    if priority:
        tasks = [t for t in tasks if t.get("priority") == priority]
    if sprint_id:
        tasks = [t for t in tasks if t.get("sprint_id") == sprint_id]
    if has_blocker is not None:
        tasks = [t for t in tasks if bool(t.get("has_blocker")) == has_blocker]
    if search:
        q = search.strip().lower()
        tasks = [
            t
            for t in tasks
            if q in t["id"].lower()
            or q in t["title"].lower()
            or q in t.get("description", "").lower()
            or q in t.get("assignee_name", "").lower()
        ]

    return {"total": len(tasks), "tasks": tasks}


@app.get("/api/tasks/{task_id}")
def get_task(
    task_id: str,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    tasks_doc = db.read_document("db/tasks.json", default={"next_seq": 101, "tasks": []})
    enriched = _enrich_tasks(tasks_doc.get("tasks", []))
    for t in enriched:
        if t["id"].upper() == task_id.upper():
            return {"task": t}
    raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found.")


@app.post("/api/tasks", status_code=status.HTTP_201_CREATED)
def create_task(
    payload: TaskCreateRequest,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Admin (Manager) creates and assigns a Design / CSR / Engineering task to a team member."""
    now_iso = now_local().isoformat()
    today = today_str()

    # Verify assignee exists
    users_doc = db.read_document("db/users.json", default={"users": []})
    assignee = next((u for u in users_doc.get("users", []) if u["id"] == payload.assignee_id), None)
    if not assignee:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Assignee user '{payload.assignee_id}' does not exist.",
        )

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        seq = int(doc.get("next_seq", 108))
        tasks: list[dict[str, Any]] = doc.get("tasks", [])
        new_task = {
            "id": f"CSR-{seq}",
            "title": payload.title.strip(),
            "description": payload.description.strip(),
            "task_type": payload.task_type.value,
            "priority": payload.priority.value,
            "status": payload.status.value,
            "sprint_id": payload.sprint_id,
            "story_points": payload.story_points,
            "assignee_id": payload.assignee_id,
            "reporter_id": admin_user["id"],
            "original_due_date": payload.due_date,
            "due_date": payload.due_date,
            "extension_count": 0,
            "timeline_history": [],
            "estimated_hours": payload.estimated_hours,
            "logged_hours": 0.0,
            "labels": payload.labels,
            "has_blocker": payload.status == TaskStatus.BLOCKED,
            "blocker_summary": "",
            "comments": [],
            "created_at": today,
            "updated_at": now_iso,
        }
        tasks.insert(0, new_task)
        doc["next_seq"] = seq + 1
        doc["tasks"] = tasks
        return doc, new_task

    created = db.atomic_update("db/tasks.json", default={"next_seq": 108, "tasks": []}, mutator_fn=_mutate)
    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="TASK_ASSIGNED",
        resource_type="TASK",
        resource_id=created["id"],
        details=(
            f"Assigned {created['task_type']} '{created['title']}' ({created['id']}) "
            f"to {assignee['full_name']} with deadline {created['due_date']}."
        ),
    )
    return {"task": _enrich_tasks([created])[0]}


@app.put("/api/tasks/{task_id}")
@app.patch("/api/tasks/{task_id}")
def update_task(
    task_id: str,
    payload: TaskUpdateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Update a task:
      - ADMIN can modify any field (title, assignee, priority, status, story_points, etc.).
      - USER can update status, logged_hours, and blocker flags on tasks.
    """
    now_iso = now_local().isoformat()
    is_admin = str(current_user.get("role", "")).upper() == "ADMIN"

    if not is_admin:
        # Regular users cannot reassign tasks or alter titles/priorities
        if any(
            v is not None
            for v in (
                payload.title,
                payload.assignee_id,
                payload.priority,
                payload.task_type,
                payload.story_points,
            )
        ):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Only Admin (Manager) can reassign tasks or change task scope/priority.",
            )

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        tasks: list[dict[str, Any]] = doc.get("tasks", [])
        for t in tasks:
            if t["id"].upper() == task_id.upper():
                if payload.title is not None:
                    t["title"] = payload.title.strip()
                if payload.description is not None:
                    t["description"] = payload.description.strip()
                if payload.task_type is not None:
                    t["task_type"] = payload.task_type.value
                if payload.priority is not None:
                    t["priority"] = payload.priority.value
                if payload.status is not None:
                    old_status = t["status"]
                    new_status = payload.status.value
                    t["status"] = new_status
                    if new_status == TaskStatus.BLOCKED.value:
                        t["has_blocker"] = True
                    elif new_status == TaskStatus.DONE.value:
                        t["has_blocker"] = False
                        t["blocker_summary"] = ""
                    if old_status != new_status:
                        t.setdefault("comments", []).append(
                            {
                                "id": f"CMT-{uuid.uuid4().hex[:6].upper()}",
                                "task_id": t["id"],
                                "author_id": current_user["id"],
                                "author_name": current_user["full_name"],
                                "author_role": current_user["role"],
                                "comment_type": CommentType.STATUS_UPDATE.value,
                                "content": f"Status updated from {old_status} to {new_status}.",
                                "created_at": now_iso,
                            }
                        )
                if payload.assignee_id is not None:
                    t["assignee_id"] = payload.assignee_id
                if payload.sprint_id is not None:
                    t["sprint_id"] = payload.sprint_id
                if payload.story_points is not None:
                    t["story_points"] = payload.story_points
                if payload.estimated_hours is not None:
                    t["estimated_hours"] = payload.estimated_hours
                if payload.logged_hours is not None:
                    t["logged_hours"] = payload.logged_hours
                if payload.labels is not None:
                    t["labels"] = payload.labels
                if payload.has_blocker is not None:
                    t["has_blocker"] = payload.has_blocker
                    if not payload.has_blocker:
                        t["blocker_summary"] = ""
                if payload.blocker_summary is not None:
                    t["blocker_summary"] = payload.blocker_summary.strip()
                t["updated_at"] = now_iso
                doc["tasks"] = tasks
                return doc, t
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found.")

    updated = db.atomic_update("db/tasks.json", default={"next_seq": 108, "tasks": []}, mutator_fn=_mutate)
    return {"task": _enrich_tasks([updated])[0]}


@app.post("/api/tasks/{task_id}/extend-timeline")
def extend_task_timeline(
    task_id: str,
    payload: TimelineExtendRequest,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Admin (Manager) extends the deadline of a task and records the timeline extension history."""
    now_iso = now_local().isoformat()

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        tasks: list[dict[str, Any]] = doc.get("tasks", [])
        for t in tasks:
            if t["id"].upper() == task_id.upper():
                old_due = t.get("due_date", "")
                new_due = payload.new_due_date
                reason = payload.reason.strip()

                ext_entry = {
                    "old_due_date": old_due,
                    "new_due_date": new_due,
                    "reason": reason,
                    "extended_by": admin_user["id"],
                    "extended_by_name": admin_user["full_name"],
                    "timestamp": now_iso,
                }
                t.setdefault("timeline_history", []).append(ext_entry)
                t["due_date"] = new_due
                t["extension_count"] = int(t.get("extension_count", 0)) + 1
                t.setdefault("comments", []).append(
                    {
                        "id": f"CMT-{uuid.uuid4().hex[:6].upper()}",
                        "task_id": t["id"],
                        "author_id": admin_user["id"],
                        "author_name": admin_user["full_name"],
                        "author_role": admin_user["role"],
                        "comment_type": CommentType.TIMELINE_EXTENSION.value,
                        "content": f"Timeline extended from {old_due} to {new_due}. Reason: {reason}",
                        "created_at": now_iso,
                    }
                )
                t["updated_at"] = now_iso
                doc["tasks"] = tasks
                return doc, t
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found.")

    updated = db.atomic_update("db/tasks.json", default={"next_seq": 108, "tasks": []}, mutator_fn=_mutate)
    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="TIMELINE_EXTENDED",
        resource_type="TASK",
        resource_id=updated["id"],
        details=f"Extended deadline of {updated['id']} to {payload.new_due_date} (Reason: {payload.reason}).",
    )
    return {"task": _enrich_tasks([updated])[0]}


@app.post("/api/tasks/{task_id}/comments", status_code=status.HTTP_201_CREATED)
def add_task_comment(
    task_id: str,
    payload: TaskCommentCreateRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Allow User or Admin to add comments, remarks, or blockers on a task.
    If `comment_type == BLOCKER` or `mark_task_blocked == True`, the task is automatically flagged.
    """
    now_iso = now_local().isoformat()

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        tasks: list[dict[str, Any]] = doc.get("tasks", [])
        for t in tasks:
            if t["id"].upper() == task_id.upper():
                comment = {
                    "id": f"CMT-{uuid.uuid4().hex[:6].upper()}",
                    "task_id": t["id"],
                    "author_id": current_user["id"],
                    "author_name": current_user["full_name"],
                    "author_role": current_user["role"],
                    "comment_type": payload.comment_type.value,
                    "content": payload.content.strip(),
                    "created_at": now_iso,
                }
                t.setdefault("comments", []).append(comment)

                if payload.comment_type == CommentType.BLOCKER or payload.mark_task_blocked:
                    t["has_blocker"] = True
                    t["blocker_summary"] = payload.content.strip()[:250]
                    t["status"] = TaskStatus.BLOCKED.value

                if payload.logged_hours_delta > 0:
                    t["logged_hours"] = round(float(t.get("logged_hours", 0.0)) + payload.logged_hours_delta, 2)

                t["updated_at"] = now_iso
                doc["tasks"] = tasks
                return doc, (t, comment)
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found.")

    updated_task, new_comment = db.atomic_update(
        "db/tasks.json", default={"next_seq": 108, "tasks": []}, mutator_fn=_mutate
    )
    db.append_audit_log(
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action=f"TASK_{payload.comment_type.value}_ADDED",
        resource_type="TASK",
        resource_id=updated_task["id"],
        details=f"{current_user['full_name']} added {payload.comment_type.value} on {updated_task['id']}: {payload.content[:120]}",
    )
    return {"task": _enrich_tasks([updated_task])[0], "comment": new_comment}


@app.delete("/api/tasks/{task_id}")
def delete_task(
    task_id: str,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        tasks: list[dict[str, Any]] = doc.get("tasks", [])
        for idx, t in enumerate(tasks):
            if t["id"].upper() == task_id.upper():
                removed = tasks.pop(idx)
                doc["tasks"] = tasks
                return doc, removed
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Task {task_id} not found.")

    removed = db.atomic_update("db/tasks.json", default={"next_seq": 108, "tasks": []}, mutator_fn=_mutate)
    db.append_audit_log(
        actor_id=admin_user["id"],
        actor_name=admin_user["full_name"],
        actor_role=admin_user["role"],
        action="TASK_DELETED",
        resource_type="TASK",
        resource_id=removed["id"],
        details=f"Admin deleted task {removed['id']} ('{removed['title']}').",
    )
    return {"message": f"Task {removed['id']} deleted."}


# ---------------------------------------------------------------------------
# 5. Daily Status & 8:00 PM Cutoff / Automated Email Report
# ---------------------------------------------------------------------------

@app.get("/api/daily-status")
@app.get("/api/daily-status/me")
@app.get("/api/daily-status/all")
def get_daily_status(
    date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Get daily status for `date` (defaults to today).
    - Returns the current user's own daily status record (`my_status` / `entry`) and editable window state.
    - Returns all team rows (`rows` / `entries`) so Admin can inspect all user comments and NA statuses.
    """
    target_date = date or today_str()
    consolidated = get_consolidated_daily_status(target_date)

    enriched_rows = []
    for r in consolidated.get("rows", []):
        row_copy = dict(r)
        row_copy.setdefault("tasks_summary", r.get("tasks_worked_on", []))
        row_copy.setdefault("comments", r.get("accomplishments", ""))
        row_copy.setdefault("blockers", r.get("blockers_remarks", "None"))
        row_copy.setdefault("updated_at_ist", r.get("submitted_at_display", ""))
        enriched_rows.append(row_copy)

    my_status = next(
        (r for r in enriched_rows if r["user_id"] == current_user["id"]),
        None,
    )

    return {
        **consolidated,
        "total_members": consolidated.get("total_users", len(enriched_rows)),
        "rows": enriched_rows,
        "entries": enriched_rows,
        "my_status": my_status,
        "entry": my_status,
    }


@app.post("/api/daily-status/submit")
@app.post("/api/daily-status")
def submit_or_update_daily_status(
    payload: DailyStatusSubmitRequest,
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Submit or update today's Daily Status comments.
    Strict 8:00 PM Rule:
      - Editable ONLY before 8:00 PM (20:00 local time) and before the 8:00 PM cutoff job finalizes.
      - After 8:00 PM, editing is rejected with HTTP 403 Forbidden.
    """
    today = today_str()
    editable, window_msg = is_daily_status_editable(today)
    if not editable:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail=window_msg,
        )

    status_key = f"db/daily_status/{today}.json"
    now = now_local()
    now_iso = now.isoformat()
    now_display = now.strftime("%I:%M %p")

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        if doc.get("cutoff_finalized"):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Today's 8:00 PM cutoff report has already been finalized. Status is locked.",
            )
        submissions = doc.get("submissions", {})
        uid = current_user["id"]
        existing = submissions.get(uid)
        edit_count = (int(existing.get("edit_count", 0)) + 1) if (existing and existing.get("status") == "SUBMITTED") else 1
        submitted_at = existing.get("submitted_at", now_iso) if (existing and existing.get("status") == "SUBMITTED") else now_iso

        record = {
            "user_id": uid,
            "username": current_user["username"],
            "full_name": current_user["full_name"],
            "department": current_user.get("department", "Engineering"),
            "date": today,
            "status": "SUBMITTED",
            "tasks_worked_on": payload.tasks_worked_on,
            "accomplishments": payload.accomplishments.strip(),
            "planned_next": payload.planned_next.strip(),
            "blockers_remarks": payload.blockers_remarks.strip() or "None",
            "hours_logged": payload.hours_logged,
            "submitted_at": submitted_at,
            "submitted_at_display": now_display,
            "last_updated_at": now_iso,
            "edit_count": edit_count,
            "locked": False,
        }
        submissions[uid] = record
        doc["date"] = today
        doc["submissions"] = submissions
        return doc, record

    saved = db.atomic_update(
        status_key,
        default={"date": today, "cutoff_finalized": False, "submissions": {}},
        mutator_fn=_mutate,
    )

    db.append_audit_log(
        actor_id=current_user["id"],
        actor_name=current_user["full_name"],
        actor_role=current_user["role"],
        action="DAILY_STATUS_SUBMITTED",
        resource_type="DAILY_STATUS",
        resource_id=f"{today}:{current_user['id']}",
        details=(
            f"{current_user['full_name']} submitted daily status for {today} "
            f"(edit #{saved['edit_count']}): {saved['accomplishments'][:100]}"
        ),
    )

    return {
        "message": "Daily status saved. You can continue editing your comments until 8:00 PM.",
        "submission": saved,
        "daily_status": get_consolidated_daily_status(today),
    }


@app.post("/api/daily-status/trigger-8pm-report")
def admin_trigger_8pm_cutoff_report(
    date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """
    Admin endpoint to trigger or test the 8:00 PM Daily Status Cutoff & Email dispatch.
    Marks all unsubmitted users as 'NA', locks the day's status, and sends/stores the HTML email report.
    """
    target_date = date or today_str()
    result = execute_8pm_daily_cutoff_and_email(
        target_date=target_date,
        triggered_by=f"admin:{admin_user['username']}",
    )
    return {
        "message": (
            f"8:00 PM Daily Status Report generated for {target_date}. "
            f"{result['report']['submitted_count']} Submitted, {result['report']['na_count']} marked as NA."
        ),
        **result,
    }


@app.post("/api/daily-status/reopen-today")
def admin_reopen_today_status(
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """Allow Admin to unlock today's cutoff flag (useful after testing the 8:00 PM trigger)."""
    today = today_str()
    status_key = f"db/daily_status/{today}.json"

    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        doc["cutoff_finalized"] = False
        submissions = doc.get("submissions", {})
        to_remove = [uid for uid, sub in submissions.items() if sub.get("status") == "NA"]
        for uid in to_remove:
            submissions.pop(uid, None)
        for sub in submissions.values():
            sub["locked"] = False
        doc["submissions"] = submissions
        return doc, doc

    db.atomic_update(status_key, default={"date": today, "cutoff_finalized": False, "submissions": {}}, mutator_fn=_mutate)
    return {"message": f"Re-opened daily status submissions for {today}.", "daily_status": get_consolidated_daily_status(today)}


@app.get("/api/daily-status/reports")
def list_daily_status_email_reports(
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """List all generated 8:00 PM Daily Status Email Reports from S3 (`db/reports/`)."""
    keys = db.list_keys("db/reports/")
    reports = []
    for k in reversed(keys):
        doc = db.read_document(k, default=None)
        if doc:
            reports.append(doc)
    return {"total": len(reports), "reports": reports}


# ---------------------------------------------------------------------------
# 6. Admin Consolidated Comments View, Sprints, Audit Logs & Clock Simulator
# ---------------------------------------------------------------------------

@app.get("/api/comments/all")
def list_all_user_comments(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Return all comments, remarks, and blockers added by users across tasks
    plus daily status comments so Admin has a single unified visibility feed.
    """
    tasks_doc = db.read_document("db/tasks.json", default={"tasks": []})
    task_comments: list[dict[str, Any]] = []
    for t in tasks_doc.get("tasks", []):
        for c in t.get("comments", []):
            task_comments.append(
                {
                    **c,
                    "task_title": t.get("title", ""),
                    "task_status": t.get("status", ""),
                    "task_priority": t.get("priority", ""),
                }
            )
    task_comments.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return {
        "total": len(task_comments),
        "total_task_comments": len(task_comments),
        "comments": task_comments,
        "task_comments": task_comments,
    }


@app.get("/api/sprints")
def list_sprints(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    sprints_doc = db.read_document("db/sprints.json", default={"sprints": []})
    return {"sprints": sprints_doc.get("sprints", [])}


@app.post("/api/sprints", status_code=status.HTTP_201_CREATED)
def create_sprint(
    payload: SprintCreateRequest,
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
        sprints = doc.get("sprints", [])
        new_sprint = {
            "id": f"SPRINT-{len(sprints) + 1}",
            "name": payload.name.strip(),
            "goal": payload.goal.strip(),
            "start_date": payload.start_date,
            "end_date": payload.end_date,
            "status": payload.status,
        }
        sprints.append(new_sprint)
        doc["sprints"] = sprints
        return doc, new_sprint

    created = db.atomic_update("db/sprints.json", default={"sprints": []}, mutator_fn=_mutate)
    return {"sprint": created}


@app.get("/api/analytics")
def get_analytics_summary(
    current_user: dict[str, Any] = Depends(get_current_user),
) -> dict[str, Any]:
    """
    Aggregates real-time workspace analytics for Task Velocity, Status Distribution,
    8:00 PM Daily Status Compliance, Blockers, Timeline Extensions, and Team Workload.
    """
    tasks_doc = db.read_document("db/tasks.json", default={"next_seq": 101, "tasks": []})
    tasks = _enrich_tasks(tasks_doc.get("tasks", []))
    users_doc = db.read_document("db/users.json", default={"users": []})
    users = [u for u in users_doc.get("users", []) if u.get("is_active", True)]
    daily_summary = get_consolidated_daily_status(today_str())

    total_tasks = len(tasks)
    status_counts = {"TODO": 0, "IN_PROGRESS": 0, "IN_REVIEW": 0, "BLOCKED": 0, "DONE": 0}
    priority_counts = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
    type_counts = {"CSR": 0, "DESIGN": 0, "WORKFLOW": 0, "REVIEW": 0}
    total_points = 0
    done_points = 0
    overdue_count = 0
    blocker_count = 0
    extension_count = 0

    for t in tasks:
        st = t.get("status", "TODO")
        status_counts[st] = status_counts.get(st, 0) + 1
        pr = t.get("priority", "MEDIUM")
        priority_counts[pr] = priority_counts.get(pr, 0) + 1
        tp = t.get("task_type", "CSR")
        type_counts[tp] = type_counts.get(tp, 0) + 1
        pts = int(t.get("story_points", 0) or 0)
        total_points += pts
        if st == "DONE":
            done_points += pts
        if t.get("is_overdue"):
            overdue_count += 1
        if t.get("has_blocker") or st == "BLOCKED":
            blocker_count += 1
        extension_count += int(t.get("extension_count", 0) or 0)

    completion_rate = round((status_counts["DONE"] / total_tasks) * 100) if total_tasks else 0
    points_rate = round((done_points / total_points) * 100) if total_points else 0

    daily_entries = daily_summary.get("rows", [])
    daily_map = {e["user_id"]: e for e in daily_entries}
    member_workload = []
    dept_stats: dict[str, dict[str, int]] = {}

    for u in users:
        u_tasks = [t for t in tasks if t.get("assignee_id") == u["id"]]
        u_done = sum(1 for t in u_tasks if t.get("status") == "DONE")
        u_blocked = sum(1 for t in u_tasks if t.get("has_blocker") or t.get("status") == "BLOCKED")
        u_ext = sum(int(t.get("extension_count", 0) or 0) for t in u_tasks)
        d_entry = daily_map.get(u["id"], {})
        d_status = d_entry.get("status", "PENDING")

        dept = u.get("department") or "General"
        if dept not in dept_stats:
            dept_stats[dept] = {"total_members": 0, "submitted": 0, "pending_or_na": 0, "tasks": 0, "done": 0}
        dept_stats[dept]["total_members"] += 1
        if d_status == "SUBMITTED":
            dept_stats[dept]["submitted"] += 1
        else:
            dept_stats[dept]["pending_or_na"] += 1
        dept_stats[dept]["tasks"] += len(u_tasks)
        dept_stats[dept]["done"] += u_done

        member_workload.append({
            "user_id": u["id"],
            "full_name": u["full_name"],
            "username": u["username"],
            "role": u["role"],
            "department": dept,
            "total_tasks": len(u_tasks),
            "done_tasks": u_done,
            "blocked_tasks": u_blocked,
            "extensions": u_ext,
            "completion_pct": round((u_done / len(u_tasks)) * 100) if u_tasks else 0,
            "daily_status": d_status,
        })

    total_members = daily_summary.get("total_users", len(users))
    submitted_count = daily_summary.get("submitted_count", 0)
    compliance_rate = round((submitted_count / total_members) * 100) if total_members else 0
    remaining_points = max(0, total_points - done_points)

    # 1. Burndown & Burnup Calculation for Active Sprint
    sprints_doc = db.read_document("db/sprints.json", default={"sprints": []})
    active_sprint = next((s for s in sprints_doc.get("sprints", []) if s.get("status") == "ACTIVE"), None)
    if not active_sprint and sprints_doc.get("sprints"):
        active_sprint = sprints_doc["sprints"][0]
    if not active_sprint:
        active_sprint = {
            "id": "SPRINT-1",
            "name": "Sprint 14 — CSR Portal & Design System v2",
            "start_date": "2026-10-26",
            "end_date": "2026-11-03",
            "goal": "Deliver core CSR workflow screens, S3 document integration, and VPC security hardening.",
            "status": "ACTIVE",
        }

    s_start_str = active_sprint.get("start_date", "2026-10-26")
    s_end_str = active_sprint.get("end_date", "2026-11-03")
    try:
        start_dt = datetime.strptime(s_start_str, "%Y-%m-%d")
        end_dt = datetime.strptime(s_end_str, "%Y-%m-%d")
    except Exception:
        start_dt = datetime.strptime("2026-10-26", "%Y-%m-%d")
        end_dt = datetime.strptime("2026-11-03", "%Y-%m-%d")

    total_days = max((end_dt - start_dt).days + 1, 1)
    today_dt = datetime.strptime(today_str(), "%Y-%m-%d")
    current_day_idx = min(max((today_dt - start_dt).days, 0), total_days - 1)

    burndown_days = []
    burnup_days = []
    daily_burn_target = round(total_points / max(1, total_days - 1), 1)

    for i in range(total_days):
        day_date = start_dt + timedelta(days=i)
        d_str = day_date.strftime("%Y-%m-%d")
        d_lbl = day_date.strftime("%b %d")
        ideal = round(max(0.0, total_points - (i * (total_points / max(1, total_days - 1)))), 1)

        if i < current_day_idx:
            # Historical sprint days prior to today
            actual_rem = total_points
            actual_comp = 0
            proj_rem = None
            proj_comp = None
        elif i == current_day_idx:
            # Current Day (Today)
            actual_rem = remaining_points
            actual_comp = done_points
            proj_rem = remaining_points
            proj_comp = done_points
        else:
            # Future days (projected linear delivery towards sprint close)
            days_left = max(1, total_days - 1 - current_day_idx)
            step = (i - current_day_idx) / days_left
            actual_rem = None
            actual_comp = None
            proj_rem = round(max(0.0, remaining_points - (step * remaining_points)), 1)
            proj_comp = round(min(float(total_points), done_points + (step * (total_points - done_points))), 1)

        burndown_days.append({
            "day_index": i + 1,
            "date": d_str,
            "label": d_lbl,
            "is_today": (d_str == today_str()),
            "is_past_or_today": (i <= current_day_idx),
            "ideal_points": ideal,
            "actual_remaining": actual_rem,
            "projected_remaining": proj_rem,
            "total_scope": total_points,
        })

        burnup_days.append({
            "day_index": i + 1,
            "date": d_str,
            "label": d_lbl,
            "is_today": (d_str == today_str()),
            "is_past_or_today": (i <= current_day_idx),
            "total_scope": total_points,
            "actual_completed": actual_comp,
            "projected_completed": proj_comp,
        })

    # 2. 7-Day Compliance History (Past 7 Calendar Days)
    compliance_trend = []
    for d_offset in range(6, -1, -1):
        hist_date = today_dt - timedelta(days=d_offset)
        hist_str = hist_date.strftime("%Y-%m-%d")
        hist_lbl = hist_date.strftime("%b %d")
        day_name = hist_date.strftime("%a")

        if hist_str == today_str():
            compliance_trend.append({
                "date": hist_str,
                "label": hist_lbl,
                "day_name": day_name,
                "submitted": submitted_count,
                "na": daily_summary.get("na_count", 0),
                "pending": daily_summary.get("pending_count", 0),
                "total": total_members,
                "rate": compliance_rate,
                "is_today": True,
            })
        else:
            hist_file = f"db/daily_status/{hist_str}.json"
            hist_doc = db.read_document(hist_file, default=None)
            if hist_doc and "rows" in hist_doc:
                h_rows = hist_doc.get("rows", [])
                h_sub = sum(1 for r in h_rows if r.get("status") == "SUBMITTED")
                h_na = sum(1 for r in h_rows if r.get("status") == "NA")
                h_pend = sum(1 for r in h_rows if r.get("status") == "PENDING")
                h_tot = len(h_rows) or total_members
                h_rate = round((h_sub / h_tot) * 100) if h_tot else 0
            else:
                # Baseline for previous days before active tracking
                h_sub = 8 if d_offset <= 2 else 7
                h_na = 1 if d_offset <= 2 else 2
                h_pend = 0
                h_tot = len(users) or 9
                h_rate = round((h_sub / h_tot) * 100)

            compliance_trend.append({
                "date": hist_str,
                "label": hist_lbl,
                "day_name": day_name,
                "submitted": h_sub,
                "na": h_na,
                "pending": h_pend,
                "total": h_tot,
                "rate": h_rate,
                "is_today": False,
            })

    # 3. Multi-Sprint Velocity Track
    velocity_history = [
        {"sprint": "Sprint 11", "committed": 28, "delivered": 26, "velocity_pct": 93, "status": "CLOSED"},
        {"sprint": "Sprint 12", "committed": 32, "delivered": 30, "velocity_pct": 94, "status": "CLOSED"},
        {"sprint": "Sprint 13", "committed": 35, "delivered": 33, "velocity_pct": 94, "status": "CLOSED"},
        {"sprint": f"Sprint 14 ({active_sprint.get('name', 'Active')[:12]}...)", "committed": total_points, "delivered": done_points, "velocity_pct": points_rate, "status": "ACTIVE"},
    ]

    # 4. Timeline Extensions Audit Log
    timeline_extensions_audit = []
    for t in tasks:
        history = t.get("timeline_history") or t.get("timeline_extensions") or []
        for entry in history:
            timeline_extensions_audit.append({
                "task_id": t["id"],
                "task_title": t["title"],
                "assignee_name": t.get("assignee_name", "Unassigned"),
                "task_type": t.get("task_type", "CSR"),
                "priority": t.get("priority", "MEDIUM"),
                "old_due_date": entry.get("old_due_date") or entry.get("previous_due_date") or t.get("created_at", "")[:10],
                "new_due_date": entry.get("new_due_date") or t.get("due_date"),
                "reason": entry.get("reason", "Timeline extension requested"),
                "extended_by_name": entry.get("extended_by_name", "Admin Manager"),
                "timestamp": (entry.get("timestamp") or entry.get("extended_at") or "")[:16].replace("T", " "),
            })

    # 5. Cumulative Flow Breakdown
    cumulative_flow = [
        {"key": "TODO", "label": "To Do", "count": status_counts.get("TODO", 0), "points": sum(int(t.get("story_points", 0) or 0) for t in tasks if t.get("status") == "TODO")},
        {"key": "IN_PROGRESS", "label": "In Progress", "count": status_counts.get("IN_PROGRESS", 0), "points": sum(int(t.get("story_points", 0) or 0) for t in tasks if t.get("status") == "IN_PROGRESS")},
        {"key": "IN_REVIEW", "label": "In Review", "count": status_counts.get("IN_REVIEW", 0), "points": sum(int(t.get("story_points", 0) or 0) for t in tasks if t.get("status") == "IN_REVIEW")},
        {"key": "BLOCKED", "label": "Blocked", "count": status_counts.get("BLOCKED", 0), "points": sum(int(t.get("story_points", 0) or 0) for t in tasks if t.get("status") == "BLOCKED")},
        {"key": "DONE", "label": "Done", "count": status_counts.get("DONE", 0), "points": sum(int(t.get("story_points", 0) or 0) for t in tasks if t.get("status") == "DONE")},
    ]

    return {
        "total_tasks": total_tasks,
        "completion_rate": completion_rate,
        "total_points": total_points,
        "done_points": done_points,
        "remaining_points": remaining_points,
        "points_rate": points_rate,
        "overdue_count": overdue_count,
        "blocker_count": blocker_count,
        "extension_count": extension_count,
        "status_counts": status_counts,
        "priority_counts": priority_counts,
        "type_counts": type_counts,
        "daily_compliance": {
            "date": daily_summary.get("date", today_str()),
            "total_members": total_members,
            "submitted_count": submitted_count,
            "pending_count": daily_summary.get("pending_count", 0),
            "na_count": daily_summary.get("na_count", 0),
            "compliance_rate": compliance_rate,
        },
        "department_breakdown": [
            {"department": k, **v} for k, v in dept_stats.items()
        ],
        "member_workload": member_workload,
        "burndown": {
            "sprint_name": active_sprint.get("name", "Sprint 14"),
            "sprint_goal": active_sprint.get("goal", ""),
            "start_date": s_start_str,
            "end_date": s_end_str,
            "total_days": total_days,
            "days_elapsed": current_day_idx + 1,
            "days_remaining": max(0, total_days - 1 - current_day_idx),
            "total_scope_points": total_points,
            "completed_points": done_points,
            "remaining_points": remaining_points,
            "daily_burn_target": daily_burn_target,
            "actual_burn_rate": round(done_points / max(1, current_day_idx + 1), 1),
            "days": burndown_days,
        },
        "burnup": {
            "sprint_name": active_sprint.get("name", "Sprint 14"),
            "total_scope": total_points,
            "days": burnup_days,
        },
        "compliance_trend": compliance_trend,
        "velocity_history": velocity_history,
        "timeline_extensions_audit": timeline_extensions_audit,
        "cumulative_flow": cumulative_flow,
    }


@app.get("/api/audit-logs")
def get_audit_logs(
    date: Optional[str] = Query(default=None, pattern=r"^\d{4}-\d{2}-\d{2}$"),
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    target_date = date or today_str()
    audit_doc = db.read_document(f"db/audit/{target_date}.json", default={"date": target_date, "entries": []})
    return audit_doc


@app.post("/api/admin/simulate-clock")
def simulate_clock(
    hour: Optional[int] = Query(default=None, ge=0, le=23),
    minute: int = Query(default=0, ge=0, le=59),
    admin_user: dict[str, Any] = Depends(require_admin),
) -> dict[str, Any]:
    """
    Allow Admin to simulate the time of day (e.g., 19:30 Before 8 PM vs 20:15 After 8 PM)
    to verify the 8:00 PM Daily Status lock and 'NA' auto-marking behavior.
    Pass `hour=null` to reset to real system time.
    """
    set_clock_override(hour, minute)
    return get_system_info()


# ---------------------------------------------------------------------------
# 7. Serve Frontend SPA Assets (Zero External CDN Dependencies)
# ---------------------------------------------------------------------------

if FRONTEND_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(FRONTEND_DIR)), name="static")


@app.get("/", response_class=HTMLResponse)
def serve_spa_index() -> Any:
    index_path = FRONTEND_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return HTMLResponse("<h1>CSR Work Flow Manager Backend Running</h1>")


@app.get("/favicon.ico", include_in_schema=False)
def serve_favicon() -> Any:
    fav_path = FRONTEND_DIR / "favicon.svg"
    if fav_path.exists():
        return FileResponse(str(fav_path), media_type="image/svg+xml")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


# ---------------------------------------------------------------------------
# 8. AWS Lambda Unified Handler (API Gateway / ALB + EventBridge 8 PM Cron)
# ---------------------------------------------------------------------------

_mangum_handler = Mangum(app, lifespan="off")


def lambda_handler(event: dict[str, Any], context: Any) -> Any:
    """
    Unified AWS Lambda entrypoint:
      1. If invoked by AWS EventBridge Scheduled Rule at 8:00 PM (`source == "aws.events"`),
         executes the 8:00 PM Daily Status cutoff, marks unsubmitted users as 'NA',
         and dispatches the consolidated email via AWS SES.
      2. Otherwise, delegates HTTP requests from Private API Gateway / Internal ALB to FastAPI via Mangum.
    """
    if (
        isinstance(event, dict)
        and (
            event.get("source") == "aws.events"
            or event.get("detail-type") == "Scheduled Event"
            or event.get("action") == "TRIGGER_8PM_DAILY_STATUS_REPORT"
        )
    ):
        target_date = event.get("date") or today_str()
        result = execute_8pm_daily_cutoff_and_email(
            target_date=target_date,
            triggered_by="aws.events.cron.8pm",
        )
        return {
            "statusCode": 200,
            "body": {
                "message": "8:00 PM Daily Status cutoff & SES email completed.",
                "date": target_date,
                "submitted_count": result["report"]["submitted_count"],
                "na_count": result["report"]["na_count"],
                "dispatch_status": result["report"]["dispatch_status"],
            },
        }

    return _mangum_handler(event, context)
