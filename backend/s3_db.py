"""
Amazon S3 Document Database Engine with Optimistic Concurrency Control (ETag / If-Match).
Supports:
  1. AWS S3 Production Mode (`STORAGE_MODE=s3`): Uses boto3 S3 with conditional `IfMatch` writes,
     SSE-KMS / AES256 server-side encryption, and exponential backoff retry.
  2. Local S3 Emulator Mode (`STORAGE_MODE=local`): Mirrors S3 key structure and ETag validation
     on local disk (`.s3_local_db/`) for zero-dependency local testing and development.
"""

import hashlib
import json
import os
import random
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable, Tuple

import boto3
from botocore.exceptions import ClientError

from backend.config import (
    AWS_REGION,
    KMS_KEY_ID,
    LOCAL_S3_DIR,
    S3_BUCKET_NAME,
    STORAGE_MODE,
    now_local,
    today_str,
)


class ConcurrencyConflictError(Exception):
    """Raised when an S3 document ETag does not match during conditional put_object."""


class S3DocumentDB:
    """
    Document Database backed by Amazon S3 JSON objects with ETag Optimistic Concurrency Control.
    """

    def __init__(self) -> None:
        self.mode = STORAGE_MODE
        self.bucket = S3_BUCKET_NAME
        self.local_root = LOCAL_S3_DIR
        self._local_lock = threading.RLock()
        self._s3_client = None

        if self.mode == "s3":
            self._s3_client = boto3.client("s3", region_name=AWS_REGION)
        else:
            self.local_root.mkdir(parents=True, exist_ok=True)

    @staticmethod
    def _compute_etag(raw_bytes: bytes) -> str:
        return f'"{hashlib.md5(raw_bytes).hexdigest()}"'

    def _local_path(self, key: str) -> Path:
        safe_key = key.lstrip("/").replace("..", "")
        full_path = self.local_root / safe_key
        full_path.parent.mkdir(parents=True, exist_ok=True)
        return full_path

    def get_document_with_etag(self, key: str, default: Any = None) -> Tuple[Any, str | None]:
        """
        Fetch a JSON document and its current ETag from S3 (or local S3 emulator).
        Returns (data, etag). If object does not exist, returns (default_copy, None).
        """
        default_val = json.loads(json.dumps(default)) if default is not None else {}

        if self.mode == "s3":
            try:
                resp = self._s3_client.get_object(Bucket=self.bucket, Key=key)
                raw = resp["Body"].read()
                etag = resp.get("ETag")
                return json.loads(raw.decode("utf-8")), etag
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                if code in ("NoSuchKey", "404"):
                    return default_val, None
                raise
        else:
            with self._local_lock:
                path = self._local_path(key)
                if not path.exists():
                    return default_val, None
                raw = path.read_bytes()
                etag = self._compute_etag(raw)
                return json.loads(raw.decode("utf-8")), etag

    def put_document_conditional(
        self,
        key: str,
        data: Any,
        expected_etag: str | None = None,
    ) -> str:
        """
        Write a JSON document to S3 with conditional ETag verification (Optimistic Concurrency).
        Returns the new ETag.
        """
        raw = json.dumps(data, indent=2, ensure_ascii=False).encode("utf-8")

        if self.mode == "s3":
            put_kwargs: dict[str, Any] = {
                "Bucket": self.bucket,
                "Key": key,
                "Body": raw,
                "ContentType": "application/json",
            }
            if KMS_KEY_ID:
                put_kwargs["ServerSideEncryption"] = "aws:kms"
                put_kwargs["SSEKMSKeyId"] = KMS_KEY_ID
            else:
                put_kwargs["ServerSideEncryption"] = "AES256"

            if expected_etag is not None:
                put_kwargs["IfMatch"] = expected_etag
            else:
                put_kwargs["IfNoneMatch"] = "*"

            try:
                resp = self._s3_client.put_object(**put_kwargs)
                return resp.get("ETag", self._compute_etag(raw))
            except ClientError as exc:
                code = exc.response.get("Error", {}).get("Code", "")
                if code in ("PreconditionFailed", "ConditionalRequestConflict", "412", "409"):
                    raise ConcurrencyConflictError(
                        f"S3 ETag conflict on key '{key}' (expected {expected_etag})"
                    ) from exc
                raise
        else:
            with self._local_lock:
                path = self._local_path(key)
                if expected_etag is not None:
                    if not path.exists():
                        raise ConcurrencyConflictError(f"Expected existing key '{key}', but missing.")
                    current_etag = self._compute_etag(path.read_bytes())
                    if current_etag != expected_etag:
                        raise ConcurrencyConflictError(
                            f"Local S3 ETag conflict on '{key}': expected {expected_etag}, got {current_etag}"
                        )
                elif path.exists():
                    raise ConcurrencyConflictError(f"Key '{key}' already exists (IfNoneMatch=* failed).")

                tmp_path = path.with_suffix(f".tmp.{uuid.uuid4().hex}")
                tmp_path.write_bytes(raw)
                os.replace(tmp_path, path)
                return self._compute_etag(raw)

    def read_document(self, key: str, default: Any = None) -> Any:
        """Read a JSON document from S3 without needing the ETag."""
        doc, _ = self.get_document_with_etag(key, default=default)
        return doc

    def atomic_update(
        self,
        key: str,
        default: Any,
        mutator_fn: Callable[[Any], Tuple[Any, Any]],
        max_retries: int = 6,
    ) -> Any:
        """
        Perform an atomic read-modify-write cycle on an S3 JSON document using ETag OCC.
        `mutator_fn(doc)` must return `(updated_doc, result_to_return)`.
        Retries automatically with exponential backoff on concurrent write conflicts.
        """
        for attempt in range(max_retries):
            doc, etag = self.get_document_with_etag(key, default=default)
            updated_doc, result = mutator_fn(doc)
            try:
                self.put_document_conditional(key, updated_doc, expected_etag=etag)
                return result
            except ConcurrencyConflictError:
                if attempt == max_retries - 1:
                    raise
                sleep_sec = (0.02 * (2 ** attempt)) + random.uniform(0.005, 0.025)
                time.sleep(sleep_sec)
        raise RuntimeError(f"Failed atomic update on {key} after {max_retries} attempts.")

    def list_keys(self, prefix: str) -> list[str]:
        """List all S3 object keys under a given prefix."""
        if self.mode == "s3":
            keys: list[str] = []
            paginator = self._s3_client.get_paginator("list_objects_v2")
            for page in paginator.paginate(Bucket=self.bucket, Prefix=prefix):
                for obj in page.get("Contents", []):
                    keys.append(obj["Key"])
            return sorted(keys)
        else:
            with self._local_lock:
                base = self.local_root
                if not base.exists():
                    return []
                results: list[str] = []
                for file_path in base.rglob("*"):
                    if file_path.is_file() and not file_path.name.startswith(".tmp."):
                        rel_key = file_path.relative_to(base).as_posix()
                        if rel_key.startswith(prefix):
                            results.append(rel_key)
                return sorted(results)

    def append_audit_log(
        self,
        actor_id: str,
        actor_name: str,
        actor_role: str,
        action: str,
        resource_type: str,
        resource_id: str,
        details: str,
        ip_address: str = "internal-vpc",
    ) -> dict[str, Any]:
        """Append an immutable security & workflow audit log entry partitioned by date in S3."""
        date_key = today_str()
        s3_key = f"db/audit/{date_key}.json"
        entry = {
            "id": f"AUD-{uuid.uuid4().hex[:8].upper()}",
            "timestamp": now_local().isoformat(),
            "actor_id": actor_id,
            "actor_name": actor_name,
            "actor_role": actor_role,
            "action": action,
            "resource_type": resource_type,
            "resource_id": resource_id,
            "details": details,
            "ip_address": ip_address,
        }

        def _mutate(doc: dict[str, Any]) -> Tuple[dict[str, Any], dict[str, Any]]:
            logs = doc.get("entries", [])
            logs.insert(0, entry)  # newest first
            doc["date"] = date_key
            doc["entries"] = logs[:1000]
            return doc, entry

        return self.atomic_update(s3_key, default={"date": date_key, "entries": []}, mutator_fn=_mutate)


# Singleton S3 Document DB instance
db = S3DocumentDB()
