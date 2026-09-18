#!/usr/bin/env python3
"""Run Serpentine's browser test suite in headless Chrome.

Serves the project over HTTP on a free local port, opens tests/index.html in
headless Chrome with a throwaway profile, waits for the page to POST its
results, prints them and exits non-zero on any failure.

Standard library only. Needs Google Chrome or Chromium; set CHROME to point
at a specific binary.

    python3 tests/run.py                   # everything
    python3 tests/run.py --filter layout   # only tests whose name contains "layout"
    python3 tests/run.py --screenshots DIR # also save screenshots at common sizes
"""

import argparse
import functools
import html
import http.server
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

CHROME_CANDIDATES = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "google-chrome",
    "google-chrome-stable",
    "chromium",
    "chromium-browser",
]

SCREENSHOT_SIZES = [
    ("desktop-1440x900", 1440, 900, "desktop"),
    ("laptop-1280x720", 1280, 720, "desktop"),
    ("short-1280x500", 1280, 500, "desktop"),
    ("phone-390x844", 390, 844, "touch"),
    ("phone-360x640", 360, 640, "touch"),
    ("phone-landscape-844x390", 844, 390, "touch"),
    ("tablet-768x1024", 768, 1024, "touch"),
    ("tablet-landscape-1024x768", 1024, 768, "touch"),
]


def find_chrome():
    explicit = os.environ.get("CHROME")
    if explicit:
        return explicit
    for candidate in CHROME_CANDIDATES:
        if os.path.isabs(candidate) and os.path.exists(candidate):
            return candidate
        found = shutil.which(candidate)
        if found:
            return found
    sys.exit("Chrome not found. Install Google Chrome or set CHROME=/path/to/chrome.")


class Handler(http.server.SimpleHTTPRequestHandler):
    results = None
    done = threading.Event()

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        # /__frame?w=&h=&src= wraps a page in an exact-size iframe, for
        # screenshots narrower than headless Chrome's minimum window width.
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path != "/__frame":
            super().do_GET()
            return
        query = urllib.parse.parse_qs(parsed.query)
        width = int(query["w"][0])
        height = int(query["h"][0])
        src = html.escape(query["src"][0], quote=True)
        body = (
            "<!doctype html><body style='margin:0;background:#000'>"
            f"<iframe src='{src}' style='position:fixed;left:0;top:0;border:0;width:{width}px;height:{height}px'>"
            "</iframe></body>"
        ).encode()
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if urllib.parse.urlparse(self.path).path != "/__results":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0"))
        Handler.results = json.loads(self.rfile.read(length) or b"[]")
        self.send_response(204)
        self.end_headers()
        Handler.done.set()

    def log_message(self, *args):
        pass


def chrome_args(chrome, profile, extra):
    return [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--mute-audio",
        f"--user-data-dir={profile}",
        "--disable-background-timer-throttling",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        *extra,
    ]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--filter", default="", help="only run tests whose name contains this text")
    parser.add_argument("--timeout", type=int, default=300, help="seconds to wait for the suite")
    parser.add_argument("--screenshots", metavar="DIR", help="save screenshots at common viewport sizes")
    args = parser.parse_args()

    chrome = find_chrome()
    handler = functools.partial(Handler, directory=ROOT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), handler)
    port = server.server_address[1]
    threading.Thread(target=server.serve_forever, daemon=True).start()
    base = f"http://127.0.0.1:{port}"

    exit_code = 0
    try:
        with tempfile.TemporaryDirectory(prefix="serpentine-tests-") as profile:
            query = urllib.parse.urlencode({"filter": args.filter}) if args.filter else ""
            url = f"{base}/tests/index.html" + (f"?{query}" if query else "")
            proc = subprocess.Popen(
                chrome_args(chrome, profile, ["--window-size=1920,1080", url]),
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            try:
                finished = Handler.done.wait(args.timeout)
            finally:
                proc.terminate()
                try:
                    proc.wait(10)
                except subprocess.TimeoutExpired:
                    proc.kill()

        if not finished:
            print(f"Timed out after {args.timeout}s waiting for results.")
            return 2

        results = Handler.results or []
        failed = [r for r in results if not r["ok"]]
        suite = None
        for r in results:
            if r["suite"] != suite:
                suite = r["suite"]
                print(f"\n{suite}")
            mark = "  ok  " if r["ok"] else "  FAIL"
            print(f"{mark} {r['name']} ({r['ms']}ms)")
            if r["error"]:
                print("        " + r["error"].replace("\n", "\n        "))
        print(f"\n{len(results) - len(failed)}/{len(results)} passed" + (f", {len(failed)} failed" if failed else ""))
        exit_code = 1 if failed or not results else 0

        if args.screenshots:
            os.makedirs(args.screenshots, exist_ok=True)
            for name, width, height, input_type in SCREENSHOT_SIZES:
                for theme in ("dark", "light"):
                    out = os.path.join(os.path.abspath(args.screenshots), f"{name}-{theme}.png")
                    if os.path.exists(out):
                        os.remove(out)
                    with tempfile.TemporaryDirectory(prefix="serpentine-shot-") as profile:
                        # Chrome writes the screenshot but may not exit on its own
                        # (the registered service worker keeps it alive), so wait
                        # for the file and then stop it.
                        # Headless Chrome has a minimum window width (~500px), so
                        # narrow sizes render in an exact-size iframe at the left
                        # of a 600px-wide shot.
                        game_url = f"/index.html?input={input_type}&seed=7"
                        frame = f"{base}/__frame?" + urllib.parse.urlencode({"w": width, "h": height, "src": game_url})
                        shot = subprocess.Popen(
                            chrome_args(
                                chrome,
                                profile,
                                [
                                    f"--window-size={max(width, 600)},{height}",
                                    f"--screenshot={out}",
                                    f"--blink-settings=preferredColorScheme={0 if theme == 'dark' else 1}",
                                    frame,
                                ],
                            ),
                            stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL,
                        )
                        deadline = time.monotonic() + 30
                        while time.monotonic() < deadline and not (os.path.exists(out) and os.path.getsize(out) > 0):
                            if shot.poll() is not None:
                                break
                            time.sleep(0.2)
                        time.sleep(0.3)
                        shot.terminate()
                        try:
                            shot.wait(10)
                        except subprocess.TimeoutExpired:
                            shot.kill()
                    print(f"screenshot: {out}" if os.path.exists(out) else f"screenshot FAILED: {out}")
    finally:
        server.shutdown()
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
