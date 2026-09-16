"""
统一错误体：{ "error": "消息" }，与前端 api-client.ts 的 data.error 对齐。
校验失败额外返回 details。
"""
from __future__ import annotations

from rest_framework import status
from rest_framework.exceptions import APIException
from rest_framework.views import exception_handler


class ApiError(APIException):
    def __init__(self, message: str, http_status: int = 400, code: str = ""):
        self.status_code = http_status
        self.error_code = code or ""
        self.detail = message
        super().__init__(message)


def api_exception_handler(exc, context):
    from rest_framework.exceptions import AuthenticationFailed, NotAuthenticated

    response = exception_handler(exc, context)
    if response is None:
        return None
    if isinstance(exc, (AuthenticationFailed, NotAuthenticated)):
        response.status_code = status.HTTP_401_UNAUTHORIZED
        response.data = {"error": "Unauthorized"}
        return response

    detail = response.data
    if isinstance(detail, dict) and "error" in detail and len(detail) == 1:
        return response

    if isinstance(detail, dict):
        # DRF 校验错误 { field: [msg] }
        if "detail" in detail and len(detail) == 1:
            message = str(detail["detail"])
            response.data = {"error": message}
        else:
            first = None
            for value in detail.values():
                if isinstance(value, (list, tuple)) and value:
                    first = str(value[0])
                    break
                if isinstance(value, str):
                    first = value
                    break
            response.data = {
                "error": first or "参数错误",
                "details": detail,
            }
    elif isinstance(detail, list):
        response.data = {"error": str(detail[0]) if detail else "请求失败"}
    else:
        message = str(detail)
        if message in ("Authentication credentials were not provided.", "Unauthorized"):
            message = "Unauthorized"
        if message == "You do not have permission to perform this action.":
            message = "权限不足"
        response.data = {"error": message}

    if response.status_code == status.HTTP_401_UNAUTHORIZED:
        response.data = {"error": response.data.get("error") or "Unauthorized"}
    if isinstance(exc, ApiError) and getattr(exc, "error_code", "") and isinstance(response.data, dict):
        response.data["code"] = exc.error_code
    return response
