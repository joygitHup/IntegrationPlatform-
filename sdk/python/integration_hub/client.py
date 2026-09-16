from __future__ import annotations

import json
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


class IntegrationHubError(RuntimeError):
    def __init__(self, message: str, status: int = 0, payload: Any = None):
        super().__init__(message)
        self.status = status
        self.payload = payload


class IntegrationHub:
    """集成中台开放服务客户端。鉴权：X-Api-Key。"""

    def __init__(self, api_key: str, base_url: str = "http://127.0.0.1:8000/api", *, environment: str = "dev", workspace_id: str = ""):
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.environment = environment
        self.workspace_id = workspace_id

    def request(self, method: str, path: str, body: dict | list | None = None, *, headers: dict | None = None) -> Any:
        url = path if path.startswith("http") else f"{self.base_url}{path if path.startswith('/') else '/' + path}"
        hdrs = {
            "Accept": "application/json",
            "Content-Type": "application/json",
            "X-Environment": self.environment,
            **(headers or {}),
        }
        if self.api_key:
            hdrs["X-Api-Key"] = self.api_key
        if self.workspace_id:
            hdrs["X-Workspace-Id"] = self.workspace_id
        raw = json.dumps(body, ensure_ascii=False, default=str).encode("utf-8") if body is not None else None
        req = Request(url, data=raw, headers=hdrs, method=method.upper())
        try:
            with urlopen(req, timeout=30) as resp:
                text = resp.read().decode("utf-8", "ignore")
                return json.loads(text) if text else {}
        except HTTPError as exc:
            text = exc.read().decode("utf-8", "ignore") if exc.fp else ""
            try:
                payload = json.loads(text) if text else {}
            except json.JSONDecodeError:
                payload = {"error": text}
            raise IntegrationHubError(str(payload.get("error") or exc), status=exc.code, payload=payload) from exc
        except URLError as exc:
            raise IntegrationHubError(str(exc.reason)) from exc

    @classmethod
    def register(
        cls,
        name: str,
        code: str,
        *,
        base_url: str = "http://127.0.0.1:8000/api",
        invite_code: str = "",
        description: str = "",
    ) -> dict:
        body: dict[str, Any] = {"name": name, "code": code}
        if description:
            body["description"] = description
        if invite_code:
            body["inviteCode"] = invite_code
        return cls(api_key="", base_url=base_url).request("POST", "/open/register", body)

    def catalog(self) -> dict:
        return self.request("GET", "/open/catalog")

    def sdk(self) -> dict:
        return self.request("GET", "/open/sdk")

    def me(self) -> dict:
        return self.request("GET", "/open/me")

    def datasources(self) -> dict:
        return self.request("GET", "/open/datasources")

    def jobs(self) -> dict:
        return self.request("GET", "/open/jobs")

    def inspect(self, datasource_id: str, table: str = "") -> dict:
        return self.request("POST", "/open/datasources/inspect", {"datasourceId": datasource_id, "table": table})

    def trigger_job(self, job_id: str) -> dict:
        return self.request("POST", "/open/jobs/trigger", {"jobId": job_id})

    def ingest(self, job_id: str, records: list[dict] | None = None, *, idempotency_key: str = "") -> dict:
        body: dict[str, Any] = {"jobId": job_id}
        if records is not None:
            body["records"] = records
        extra = {"Idempotency-Key": idempotency_key} if idempotency_key else {}
        return self.request("POST", "/open/jobs/ingest", body, headers=extra)
