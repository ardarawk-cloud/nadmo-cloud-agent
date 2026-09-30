import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8791"))
BASES = {
    "sandbox": "https://sandbox.ipaymu.com",
    "production": "https://my.ipaymu.com",
}
ALLOWED = {
    ("GET", "/api/areas/province"),
    ("POST", "/api/v2/payment"),
}

def send_json(handler, payload, status=200):
    body = json.dumps(payload, separators=(",", ":")).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json; charset=utf-8")
    handler.send_header("Cache-Control", "no-store")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)

class Handler(BaseHTTPRequestHandler):
    server_version = "ROAMINKRelay/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/_healthcheck":
            return send_json(self, {"ok": True, "service": "roamink-payment-relay"})
        if parsed.path == "/api/_egress":
            try:
                with urllib.request.urlopen("https://api.ipify.org", timeout=10) as res:
                    ip = res.read(128).decode().strip()
                return send_json(self, {"ok": True, "outbound_ipv4": ip})
            except Exception:
                return send_json(self, {"ok": False, "error": "EGRESS_LOOKUP_FAILED"}, 502)
        return self.proxy_request("GET", parsed.path)

    def do_POST(self):
        return self.proxy_request("POST", urlparse(self.path).path)

    def proxy_request(self, method, path):
        parts = path.split("/", 3)
        if len(parts) != 4 or parts[1] != "ipaymu":
            return send_json(self, {"ok": False, "error": "NOT_FOUND"}, 404)

        environment = parts[2]
        upstream_path = "/" + parts[3]

        if environment not in BASES or (method, upstream_path) not in ALLOWED:
            return send_json(self, {"ok": False, "error": "UPSTREAM_NOT_ALLOWED"}, 403)

        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length > 65536:
            return send_json(self, {"ok": False, "error": "BODY_TOO_LARGE"}, 413)

        body = self.rfile.read(content_length) if content_length else None
        headers = {}
        for name in ("Content-Type", "va", "signature", "timestamp"):
            value = self.headers.get(name)
            if value:
                headers[name] = value

        if not headers.get("va") or not headers.get("signature") or not headers.get("timestamp"):
            return send_json(self, {"ok": False, "error": "MISSING_IPAYMU_AUTH_HEADERS"}, 400)

        request = urllib.request.Request(
            BASES[environment] + upstream_path,
            data=body,
            method=method,
            headers=headers,
        )

        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = response.read()
                status = response.status
                content_type = response.headers.get("Content-Type", "application/json; charset=utf-8")
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
            content_type = exc.headers.get("Content-Type", "application/json; charset=utf-8")
        except Exception as exc:
            print("Upstream error:", repr(exc), flush=True)
            return send_json(self, {"ok": False, "error": "IPAYMU_UPSTREAM_UNREACHABLE"}, 502)

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

if __name__ == "__main__":
    print(f"ROAMINK payment relay listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
