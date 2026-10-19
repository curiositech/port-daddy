"""RunPod Serverless starter — FLUX dev with Network Volume.

Dockerfile (alongside this file):
    FROM runpod/pytorch:2.4.0-py3.11-cuda12.4
    RUN pip install --no-cache-dir runpod diffusers transformers accelerate \
        huggingface_hub[hf_transfer] safetensors boto3
    ENV HF_HUB_ENABLE_HF_TRANSFER=1
    ENV HF_HOME=/runpod-volume/huggingface-cache
    ENV TRANSFORMERS_CACHE=/runpod-volume/huggingface-cache
    WORKDIR /app
    COPY runpod_handler.py .
    CMD ["python", "-u", "runpod_handler.py"]

Deploy:
    docker build -t <registry>/flux-runpod .
    docker push <registry>/flux-runpod
    # In RunPod console: create Serverless Endpoint
    #   - Image: <registry>/flux-runpod
    #   - Container disk: 20GB
    #   - Network Volume: attach a 100GB volume named e.g. "model-weights"
    #   - GPU type: RTX 4090 (cheap) or H100 (fast)
    #   - Active workers: 1 (sub-1s warm) or 0 (Flex, scale-to-zero)

Test (after deploy):
    curl -X POST https://api.runpod.ai/v2/<endpoint-id>/runsync \
      -H "Authorization: Bearer $RUNPOD_API_KEY" \
      -H "Content-Type: application/json" \
      -d '{"input": {"prompt": "a cat in a hat", "steps": 20}}'

Notes:
- Network Volume mounted at /runpod-volume/ — first cold boot downloads weights (~3 min);
  warm restart reuses cache (~20s).
- Module-level model load (not inside handler) so weights stay in VRAM across warm invocations.
- Outputs uploaded to S3/R2 via presigned URL pattern; return URL to user, not raw bytes.
"""
from __future__ import annotations

import base64
import io
import os
from typing import Any

import runpod
import torch
from diffusers import FluxPipeline

# Module-level: loaded once per worker process, reused across warm invocations.
print("[init] Loading FLUX.1-dev (cache: /runpod-volume/huggingface-cache)")
pipe = FluxPipeline.from_pretrained(
    "black-forest-labs/FLUX.1-dev",
    torch_dtype=torch.bfloat16,
    cache_dir="/runpod-volume/huggingface-cache",
).to("cuda")
print("[init] Loaded")


def handler(event: dict[str, Any]) -> dict[str, Any]:
    """RunPod handler. event['input'] = {prompt, steps?, guidance?, width?, height?, seed?}"""
    inp = event.get("input") or {}
    prompt = inp.get("prompt")
    if not prompt:
        return {"error": "missing 'prompt' in input"}

    seed = inp.get("seed")
    generator = (
        torch.Generator(device="cuda").manual_seed(int(seed)) if seed is not None else None
    )

    image = pipe(
        prompt=prompt,
        num_inference_steps=int(inp.get("steps", 20)),
        guidance_scale=float(inp.get("guidance", 3.5)),
        width=int(inp.get("width", 1024)),
        height=int(inp.get("height", 1024)),
        generator=generator,
    ).images[0]

    buf = io.BytesIO()
    image.save(buf, format="PNG")
    raw = buf.getvalue()

    # In production: upload to R2/S3 and return presigned URL instead of base64.
    # See production-patterns.md for the webhook + storage pattern.
    return {
        "image_b64": base64.b64encode(raw).decode("utf-8"),
        "format": "png",
        "size_bytes": len(raw),
    }


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
