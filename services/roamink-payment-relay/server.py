import json
import os
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse

HOST = "0.0.0.0"
PORT = int(os.environ.get("PORT", "8791"))

IPAYMU_BASES = {
    "sandbox": "https://sandbox.ipaymu.com",
    "production": "https://my.ipaymu.com",
}
IPAYMU_ALLOWED = {
    ("GET", "/api/areas/province"),
    ("POST", "/api/v2/payment"),
}
DIGIFLAZZ_ENDPOINTS = {
    "/digiflazz/price-list": "https://api.digiflazz.com/v1/price-list",
    "/digiflazz/transaction": "https://api.digiflazz.com/v1/transaction",
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
    server_version = "ROAMINKRelay/1.1"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args), flush=True)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/_healthcheck":
            return send_json(self, {
                "ok": True,
                "service": "roamink-payment-relay",
                "ipaymu": True,
                "digiflazz": True,
            })
        if parsed.path == "/api/_egress":
            try:
                with urllib.request.urlopen("https://api.ipify.org", timeout=10) as res:
                    ip = res.read(128).decode().strip()
                return send_json(self, {"ok": True, "outbound_ipv4": ip})
            except Exception:
                return send_json(self, {"ok": False, "error": "EGRESS_LOOKUP_FAILED"}, 502)
        return self.proxy_ipaymu("GET", parsed.path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path in DIGIFLAZZ_ENDPOINTS:
            return self.proxy_digiflazz(path)
        return self.proxy_ipaymu("POST", path)

    def read_body(self):
        content_length = int(self.headers.get("Content-Length", "0") or "0")
        if content_length > 262144:
            send_json(self, {"ok": False, "error": "BODY_TOO_LARGE"}, 413)
            return None
        return self.rfile.read(content_length) if content_length else b""

    def forward(self, url, method, body, headers, upstream_name):
        request = urllib.request.Request(
            url,
            data=body if method != "GET" else None,
            method=method,
            headers=headers,
        )
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                payload = response.read()
                status = response.status
                content_type = response.headers.get("Content-Type", "application/json; charset=utf-8")
        except urllib.error.HTTPError as exc:
            payload = exc.read()
            status = exc.code
            content_type = exc.headers.get("Content-Type", "application/json; charset=utf-8")
        except Exception as exc:
            print(f"{upstream_name} upstream error:", repr(exc), flush=True)
            return send_json(self, {"ok": False, "error": f"{upstream_name.upper()}_UPSTREAM_UNREACHABLE"}, 502)

        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def proxy_digiflazz(self, path):
        body = self.read_body()
        if body is None:
            return
        if not body:
            return send_json(self, {"ok": False, "error": "MISSING_BODY"}, 400)

        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            return send_json(self, {"ok": False, "error": "INVALID_JSON"}, 400)

        if not isinstance(payload, dict) or not payload.get("username") or not payload.get("sign"):
            return send_json(self, {"ok": False, "error": "MISSING_DIGIFLAZZ_AUTH"}, 400)

        if path == "/digiflazz/price-list":
            if payload.get("cmd") != "prepaid" or payload.get("brand") != "eSIM":
                return send_json(self, {"ok": False, "error": "DIGIFLAZZ_CATALOG_SCOPE_DENIED"}, 403)
        elif path == "/digiflazz/transaction":
            if not payload.get("buyer_sku_code") or not payload.get("ref_id"):
                return send_json(self, {"ok": False, "error": "INVALID_DIGIFLAZZ_TRANSACTION"}, 400)

        return self.forward(
            DIGIFLAZZ_ENDPOINTS[path],
            "POST",
            body,
            {"Content-Type": "application/json"},
            "digiflazz",
        )

    def proxy_ipaymu(self, method, path):
        parts = path.split("/", 3)
        if len(parts) != 4 or parts[1] != "ipaymu":
            return send_json(self, {"ok": False, "error": "NOT_FOUND"}, 404)

        environment = parts[2]
        upstream_path = "/" + parts[3]

        if environment not in IPAYMU_BASES or (method, upstream_path) not in IPAYMU_ALLOWED:
            return send_json(self, {"ok": False, "error": "UPSTREAM_NOT_ALLOWED"}, 403)

        body = self.read_body()
        if body is None:
            return

        headers = {}
        for name in ("Content-Type", "va", "signature", "timestamp"):
            value = self.headers.get(name)
            if value:
                headers[name] = value

        if not headers.get("va") or not headers.get("signature") or not headers.get("timestamp"):
            return send_json(self, {"ok": False, "error": "MISSING_IPAYMU_AUTH_HEADERS"}, 400)

        return self.forward(
            IPAYMU_BASES[environment] + upstream_path,
            method,
            body,
            headers,
            "ipaymu",
        )

if __name__ == "__main__":
    print(f"ROAMINK supplier/payment relay listening on {HOST}:{PORT}", flush=True)
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()
