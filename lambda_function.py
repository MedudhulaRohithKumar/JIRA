"""
AWS Lambda Entrypoint shim.
Supports both the default AWS Lambda runtime handler (`lambda_function.lambda_handler`)
and the explicit handler (`backend.app.lambda_handler`).
"""

from backend.app import lambda_handler

__all__ = ["lambda_handler"]
