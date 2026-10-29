"""
Security, Password Hashing (PBKDF2-HMAC-SHA256), JWT Token Management, and RBAC Dependencies.
Designed for Private VPC / Zero-Internet-Exposure deployment.
"""

import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.config import (
    JWT_ALGORITHM,
    JWT_EXPIRE_MINUTES,
    JWT_SECRET_KEY,
)
from backend.s3_db import db

PBKDF2_ITERATIONS = 600_000
bearer_scheme = HTTPBearer(auto_error=False)


def hash_password(plain_password: str) -> str:
    """Hash a password using OWASP-recommended PBKDF2-HMAC-SHA256 with a 16-byte cryptographic salt."""
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac(
        "sha256",
        plain_password.encode("utf-8"),
        salt.encode("utf-8"),
        PBKDF2_ITERATIONS,
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${dk.hex()}"


def verify_password(plain_password: str, stored_hash: str) -> bool:
    """Verify a plaintext password against a stored PBKDF2-HMAC-SHA256 hash in constant time."""
    try:
        algo, iter_str, salt, expected_hex = stored_hash.split("$", 3)
        if algo != "pbkdf2_sha256":
            return False
        iterations = int(iter_str)
        dk = hashlib.pbkdf2_hmac(
            "sha256",
            plain_password.encode("utf-8"),
            salt.encode("utf-8"),
            iterations,
        )
        return hmac.compare_digest(dk.hex(), expected_hex)
    except Exception:
        return False


def create_access_token(user: dict[str, Any]) -> str:
    """Issue a signed JWT containing user identity and role claims."""
    now_utc = datetime.now(timezone.utc)
    exp = now_utc + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        "sub": user["id"],
        "username": user["username"],
        "full_name": user["full_name"],
        "role": user["role"],
        "iat": int(now_utc.timestamp()),
        "exp": int(exp.timestamp()),
    }
    return jwt.encode(payload, JWT_SECRET_KEY, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict[str, Any]:
    """Decode and validate a signed JWT token."""
    try:
        return jwt.decode(token, JWT_SECRET_KEY, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired. Please sign in again.",
        ) from exc
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid authentication token.",
        ) from exc


def sanitize_user(user: dict[str, Any]) -> dict[str, Any]:
    """Strip sensitive password hash fields before returning user data to clients."""
    return {k: v for k, v in user.items() if k != "password_hash"}


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
) -> dict[str, Any]:
    """
    FastAPI Dependency: Authenticate request via Bearer token or HttpOnly cookie,
    and verify user is still active in S3 Document DB (`db/users.json`).
    """
    token: str | None = None
    if credentials and credentials.credentials:
        token = credentials.credentials
    elif "csr_access_token" in request.cookies:
        token = request.cookies.get("csr_access_token")

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please log in to CSR Work Flow Manager.",
        )

    payload = decode_access_token(token)
    user_id = payload.get("sub")

    users_doc = db.read_document("db/users.json", default={"users": []})
    for user in users_doc.get("users", []):
        if user["id"] == user_id:
            if not user.get("is_active", True):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="User account has been deactivated by Admin.",
                )
            return sanitize_user(user)

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="User account no longer exists.",
    )


def require_admin(current_user: dict[str, Any] = Depends(get_current_user)) -> dict[str, Any]:
    """FastAPI Dependency: Enforce ADMIN (Manager) role for privileged operations."""
    if str(current_user.get("role", "")).upper() != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied. Only Admin / Manager can perform this operation.",
        )
    return current_user
