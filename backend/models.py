"""
Pydantic Data Models & Schemas for CSR Work Flow Manager.
"""

from enum import Enum
from typing import Optional, List
from pydantic import BaseModel, Field, model_validator


class UserRole(str, Enum):
    ADMIN = "ADMIN"
    USER = "USER"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            up = value.strip().upper()
            if up in ("ADMIN", "MANAGER"):
                return cls.ADMIN
            if up in ("USER", "MEMBER"):
                return cls.USER
        return None


class TaskType(str, Enum):
    DESIGN_TASK = "DESIGN_TASK"
    CSR_WORKFLOW = "CSR_WORKFLOW"
    FEATURE = "FEATURE"
    BUG = "BUG"
    REVIEW = "REVIEW"

    @classmethod
    def _missing_(cls, value: object):
        if isinstance(value, str):
            up = value.strip().upper()
            mapping = {
                "DESIGN": cls.DESIGN_TASK,
                "DESIGN_TASK": cls.DESIGN_TASK,
                "CSR": cls.CSR_WORKFLOW,
                "CSR_WORKFLOW": cls.CSR_WORKFLOW,
                "WORKFLOW": cls.CSR_WORKFLOW,
                "FEATURE": cls.FEATURE,
                "BUG": cls.BUG,
                "REVIEW": cls.REVIEW,
            }
            if up in mapping:
                return mapping[up]
        return None


class TaskPriority(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"


class TaskStatus(str, Enum):
    TODO = "TODO"
    IN_PROGRESS = "IN_PROGRESS"
    BLOCKED = "BLOCKED"
    IN_REVIEW = "IN_REVIEW"
    DONE = "DONE"


class CommentType(str, Enum):
    COMMENT = "COMMENT"
    BLOCKER = "BLOCKER"
    REMARK = "REMARK"
    TIMELINE_EXTENSION = "TIMELINE_EXTENSION"
    STATUS_UPDATE = "STATUS_UPDATE"


class DailySubmissionState(str, Enum):
    SUBMITTED = "SUBMITTED"
    PENDING = "PENDING"
    NA = "NA"


# --- Auth & User Schemas ---

class LoginRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=64)
    password: str = Field(..., min_length=4, max_length=128)


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=2, max_length=50, pattern=r"^[a-zA-Z0-9_.-]+$")
    full_name: str = Field(..., min_length=2, max_length=100)
    email: str = Field(..., min_length=5, max_length=120)
    password: str = Field(..., min_length=6, max_length=128)
    role: UserRole = UserRole.USER
    department: str = Field(default="DevOps & Cloud Engineering", max_length=80)
    designation: str = Field(default="Team Member", max_length=80)
    team_id: Optional[str] = Field(default=None, max_length=80)
    is_active: bool = True


class UserUpdateRequest(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    email: Optional[str] = Field(default=None, min_length=5, max_length=120)
    password: Optional[str] = Field(default=None, min_length=6, max_length=128)
    role: Optional[UserRole] = None
    department: Optional[str] = Field(default=None, max_length=80)
    designation: Optional[str] = Field(default=None, max_length=80)
    team_id: Optional[str] = Field(default=None, max_length=80)
    is_active: Optional[bool] = None


# --- Team & Squad Schemas ---

class TeamCreateRequest(BaseModel):
    name: str = Field(..., min_length=2, max_length=100)
    description: str = Field(default="", max_length=500)
    lead_id: Optional[str] = Field(default=None, max_length=80)
    member_ids: List[str] = Field(default_factory=list)


class TeamUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=2, max_length=100)
    description: Optional[str] = Field(default=None, max_length=500)
    lead_id: Optional[str] = Field(default=None, max_length=80)
    member_ids: Optional[List[str]] = None


# --- Task & Workflow Schemas ---

class TaskCreateRequest(BaseModel):
    title: str = Field(..., min_length=3, max_length=200)
    description: str = Field(default="", max_length=4000)
    task_type: TaskType = TaskType.DESIGN_TASK
    priority: TaskPriority = TaskPriority.MEDIUM
    status: TaskStatus = TaskStatus.TODO
    assignee_id: str = Field(..., min_length=1)
    sprint_id: str = Field(default="SPRINT-1")
    story_points: int = Field(default=3, ge=1, le=21)
    due_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    estimated_hours: float = Field(default=8.0, ge=0.5, le=500.0)
    labels: List[str] = Field(default_factory=list)


class TaskUpdateRequest(BaseModel):
    title: Optional[str] = Field(default=None, min_length=3, max_length=200)
    description: Optional[str] = Field(default=None, max_length=4000)
    task_type: Optional[TaskType] = None
    priority: Optional[TaskPriority] = None
    status: Optional[TaskStatus] = None
    assignee_id: Optional[str] = None
    sprint_id: Optional[str] = None
    story_points: Optional[int] = Field(default=None, ge=1, le=21)
    estimated_hours: Optional[float] = Field(default=None, ge=0.0, le=500.0)
    logged_hours: Optional[float] = Field(default=None, ge=0.0, le=1000.0)
    labels: Optional[List[str]] = None
    has_blocker: Optional[bool] = None
    blocker_summary: Optional[str] = Field(default=None, max_length=500)


class TimelineExtendRequest(BaseModel):
    new_due_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    reason: str = Field(..., min_length=3, max_length=500)


class TaskCommentCreateRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=2000)
    comment_type: CommentType = CommentType.COMMENT
    mark_task_blocked: bool = False
    is_blocker: bool = False
    logged_hours_delta: float = Field(default=0.0, ge=0.0, le=24.0)

    @model_validator(mode="after")
    def _sync_blocker(self):
        if self.is_blocker:
            self.mark_task_blocked = True
            self.comment_type = CommentType.BLOCKER
        return self


# --- Daily Status (Before 8:00 PM Cutoff) Schemas ---

class DailyStatusSubmitRequest(BaseModel):
    tasks_worked_on: List[str] = Field(default_factory=list)
    tasks_summary: List[str] = Field(default_factory=list)
    accomplishments: str = Field(default="", max_length=3000)
    comments: str = Field(default="", max_length=3000)
    planned_next: str = Field(default="", max_length=2000)
    blockers_remarks: str = Field(default="None", max_length=2000)
    blockers: str = Field(default="", max_length=2000)
    hours_logged: float = Field(default=8.0, ge=0.0, le=24.0)

    @model_validator(mode="after")
    def _normalize_fields(self):
        if not self.tasks_worked_on and self.tasks_summary:
            self.tasks_worked_on = self.tasks_summary
        if not self.accomplishments and self.comments:
            self.accomplishments = self.comments
        if not self.accomplishments and self.tasks_worked_on:
            self.accomplishments = "; ".join(self.tasks_worked_on)
        if self.blockers and (not self.blockers_remarks or self.blockers_remarks == "None"):
            self.blockers_remarks = self.blockers
        return self


class SprintCreateRequest(BaseModel):
    name: str = Field(..., min_length=3, max_length=100)
    goal: str = Field(default="", max_length=500)
    start_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    end_date: str = Field(..., pattern=r"^\d{4}-\d{2}-\d{2}$")
    status: str = Field(default="ACTIVE")
