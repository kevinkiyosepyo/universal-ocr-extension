"""Dependency-free signed API client. Python 3.10+."""
import hashlib
import hmac
import json
import time
import uuid
from urllib.error import HTTPError
from urllib.parse import urlparse
from urllib.request import Request, urlopen, build_opener, HTTPRedirectHandler

class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None

class SolverClient:
    def __init__(self, key, endpoint="http://127.0.0.1:47821"):
        parsed = urlparse(endpoint)
        if parsed.username or parsed.password or parsed.query or parsed.fragment or not (parsed.scheme == "https" or (parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost", "::1"))):
            raise ValueError("Use HTTPS or a loopback HTTP endpoint, without credentials or query parameters")
        self.key = key.encode()
        self.endpoint = endpoint.rstrip("/")
        self.opener = build_opener(NoRedirect)

    def request(self, path, method="GET", body=None):
        encoded = b"" if body is None else json.dumps(body, separators=(",", ":")).encode()
        url = self.endpoint + "/" + path.lstrip("/")
        timestamp, nonce = str(int(time.time() * 1000)), str(uuid.uuid4())
        canonical = "\n".join((timestamp, nonce, method, urlparse(url).path, hashlib.sha256(encoded).hexdigest()))
        headers = {"Content-Type": "application/json", "X-OCR-Timestamp": timestamp, "X-OCR-Nonce": nonce, "X-OCR-Signature": hmac.new(self.key, canonical.encode(), hashlib.sha256).hexdigest()}
        request = Request(url, data=encoded or None, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=10) as response:
                return json.load(response)
        except HTTPError as error:
            detail = json.load(error).get("error", {})
            raise RuntimeError(detail.get("message", str(error))) from error

    def solve(self, task, timeout=180):
        created = self.request("v1/tasks", "POST", {**task, "requestId": str(uuid.uuid4())})
        path = "v1/tasks/" + created["id"]
        try:
            deadline = time.monotonic() + timeout
            while time.monotonic() < deadline:
                result = self.request(path)
                if result["state"] == "succeeded":
                    return result["solution"]
                if result["state"] in ("failed", "cancelled"):
                    raise RuntimeError(result.get("error", {}).get("message", "Task failed"))
                time.sleep(0.4)
            raise TimeoutError("Recognition timed out")
        finally:
            try:
                self.request(path, "DELETE")
            except Exception:
                pass
