#!/usr/bin/env python3
"""
Lightweight HTTP server for TikZ WYSIWYG Figure Layout Studio.
Serves static assets and receives layout position updates from the browser.
Zero external dependencies (uses standard library http.server).
"""

import http.server
import json
import os
import sys

PORT = 8765
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

class StudioHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=BASE_DIR, **kwargs)

    def do_POST(self):
        if self.path == "/api/save-positions":
            content_length = int(self.headers.get("Content-Length", 0))
            post_data = self.rfile.read(content_length)
            try:
                data = json.loads(post_data.decode("utf-8"))
                output_path = os.path.join(BASE_DIR, "figure-positions.json")
                with open(output_path, "w", encoding="utf-8") as f:
                    json.dump(data, f, indent=2)
                
                # Also synchronize to whitepaper twin if present
                twin_path = os.path.abspath(os.path.join(BASE_DIR, "../../../whitepaper/figure-positions.json"))
                if os.path.exists(os.path.dirname(twin_path)):
                    with open(twin_path, "w", encoding="utf-8") as f:
                        json.dump(data, f, indent=2)

                print(f"[TikZ Studio] Received and saved positions for {data.get('figure')} to {output_path}")

                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Access-Control-Allow-Origin", "*")
                self.end_headers()
                self.wfile.write(json.dumps({"status": "ok", "file": output_path}).encode("utf-8"))
            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode("utf-8"))
        else:
            self.send_response(404)
            self.end_headers()

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

if __name__ == "__main__":
    server = http.server.HTTPServer(("127.0.0.1", PORT), StudioHandler)
    print(f"==================================================================")
    print(f" TikZ WYSIWYG Figure Studio running at:")
    print(f" http://localhost:{PORT}/wysiwyg-figure-editor.html")
    print(f"==================================================================")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server.")
        server.server_close()
