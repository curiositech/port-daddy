"""ComfyUI HTTP/WebSocket bridge — minimal Python client.

Submits an API-format workflow to a running ComfyUI instance, listens via
WebSocket for progress, downloads outputs.

Use as a building block for your own ComfyUI-as-API service. For productionized
versions see ComfyDeploy, BentoComfy, RunComfy, or runpod-workers/worker-comfyui.
See `comfyui-mastery` skill for ComfyUI internals; this is the deployment side.

Install:
    uv pip install websocket-client requests

Run a ComfyUI server first:
    cd ComfyUI && python main.py --listen 127.0.0.1 --port 8188

Then:
    python comfyui_bridge.py path/to/api_format_workflow.json
"""
from __future__ import annotations

import io
import json
import sys
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

from websocket import WebSocket  # websocket-client


class ComfyClient:
    def __init__(self, server: str = "127.0.0.1:8188") -> None:
        self.server = server
        self.client_id = str(uuid.uuid4())

    def queue(self, workflow: dict[str, Any]) -> str:
        """POST workflow to /prompt. Returns prompt_id."""
        payload = json.dumps({"prompt": workflow, "client_id": self.client_id}).encode()
        req = urllib.request.Request(
            f"http://{self.server}/prompt",
            data=payload,
            headers={"Content-Type": "application/json"},
        )
        resp = json.loads(urllib.request.urlopen(req).read())
        if resp.get("node_errors"):
            raise RuntimeError(f"node_errors: {resp['node_errors']}")
        return resp["prompt_id"]

    def wait(self, prompt_id: str, on_progress=None) -> dict[str, Any]:
        """Subscribe to /ws and wait for the prompt to finish.

        on_progress(node_id, value, max) is called for each step event.
        Returns /history/{prompt_id} payload on completion.
        """
        ws = WebSocket()
        ws.connect(f"ws://{self.server}/ws?clientId={self.client_id}")
        try:
            while True:
                raw = ws.recv()
                if not isinstance(raw, str):
                    continue  # binary frames are preview images; skip
                msg = json.loads(raw)
                t = msg.get("type")
                d = msg.get("data") or {}

                if t == "progress" and on_progress:
                    on_progress(d.get("node"), d.get("value"), d.get("max"))

                if t == "executing" and d.get("prompt_id") == prompt_id and d.get("node") is None:
                    break  # prompt complete

                if t == "execution_error" and d.get("prompt_id") == prompt_id:
                    raise RuntimeError(f"execution_error: {d}")
        finally:
            ws.close()

        hist_url = f"http://{self.server}/history/{prompt_id}"
        return json.loads(urllib.request.urlopen(hist_url).read())[prompt_id]

    def view(self, filename: str, subfolder: str = "", folder_type: str = "output") -> bytes:
        params = urllib.parse.urlencode(
            {"filename": filename, "subfolder": subfolder, "type": folder_type}
        )
        return urllib.request.urlopen(f"http://{self.server}/view?{params}").read()

    def upload_image(self, path: Path, image_type: str = "input") -> dict[str, Any]:
        """POST multipart upload to /upload/image. Returns server response."""
        boundary = uuid.uuid4().hex
        body = io.BytesIO()
        body.write(f"--{boundary}\r\n".encode())
        body.write(b'Content-Disposition: form-data; name="image"; filename="')
        body.write(path.name.encode())
        body.write(b'"\r\n')
        body.write(b"Content-Type: application/octet-stream\r\n\r\n")
        body.write(path.read_bytes())
        body.write(f"\r\n--{boundary}\r\n".encode())
        body.write(f'Content-Disposition: form-data; name="type"\r\n\r\n{image_type}\r\n'.encode())
        body.write(f"--{boundary}--\r\n".encode())

        req = urllib.request.Request(
            f"http://{self.server}/upload/image",
            data=body.getvalue(),
            headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
        )
        return json.loads(urllib.request.urlopen(req).read())


def run_workflow(workflow_path: Path, server: str = "127.0.0.1:8188") -> list[Path]:
    """Run a workflow, save outputs locally, return list of paths."""
    workflow = json.loads(workflow_path.read_text())
    # Accept both raw API-format and {"prompt": <api-format>, ...} envelopes.
    if "prompt" in workflow and isinstance(workflow["prompt"], dict):
        workflow = workflow["prompt"]

    client = ComfyClient(server=server)

    def on_progress(node, value, max_):
        print(f"  node={node} {value}/{max_}", end="\r", flush=True)

    prompt_id = client.queue(workflow)
    print(f"queued prompt_id={prompt_id}")
    history = client.wait(prompt_id, on_progress=on_progress)

    out_paths: list[Path] = []
    out_dir = Path("./comfy_outputs")
    out_dir.mkdir(exist_ok=True)
    for node_id, node_output in (history.get("outputs") or {}).items():
        for img in node_output.get("images", []) or []:
            data = client.view(img["filename"], img.get("subfolder", ""), img.get("type", "output"))
            dest = out_dir / f"{node_id}_{img['filename']}"
            dest.write_bytes(data)
            out_paths.append(dest)
            print(f"\n  → {dest}")
    return out_paths


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("usage: comfyui_bridge.py <workflow.json> [server=127.0.0.1:8188]")
        sys.exit(1)
    server = sys.argv[2] if len(sys.argv) > 2 else "127.0.0.1:8188"
    paths = run_workflow(Path(sys.argv[1]), server=server)
    print(f"\nDone. {len(paths)} output(s).")
