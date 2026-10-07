"""Modal starter — FLUX dev with Volume + GPU memory snapshot.

Deploy:    modal deploy modal_flux.py
Test:      curl -X POST https://<your-org>--flux-dev-generate.modal.run \
             -H 'Content-Type: application/json' \
             -d '{"prompt": "a cat in a hat", "steps": 20, "guidance": 3.5}' \
             -o out.png

Notes:
- enable_memory_snapshot=True is the 10x cold-start win (alpha, requires Modal CUDA 570/575)
- min_containers=1 keeps one warm for sub-5s p99
- Volume mounted at /cache holds HF weights between cold starts
- HF_HUB_ENABLE_HF_TRANSFER=1 + hf_transfer = 3-5x faster downloads
"""
from __future__ import annotations

import io
from typing import Any

import modal

app = modal.App("flux-dev")
volume = modal.Volume.from_name("flux-weights", create_if_missing=True)

image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.4.0",
        "diffusers==0.31.0",
        "transformers==4.45.0",
        "accelerate==1.0.0",
        "huggingface_hub[hf_transfer]==0.25.2",
        "safetensors",
    )
    .env(
        {
            "HF_HUB_ENABLE_HF_TRANSFER": "1",
            "HF_HOME": "/cache/hf",
            "TRANSFORMERS_CACHE": "/cache/hf",
        }
    )
)


@app.cls(
    gpu="H100",
    image=image,
    volumes={"/cache": volume},
    enable_memory_snapshot=True,  # 10x cold-start improvement (alpha)
    min_containers=1,  # keep one warm; pay ~$70/mo idle
    timeout=300,
    secrets=[modal.Secret.from_name("huggingface")],  # HF_TOKEN for gated models
)
class FluxModel:
    @modal.enter(snap=True)
    def load(self) -> None:
        """Runs once per container; snapshotted into the GPU memory image."""
        import torch
        from diffusers import FluxPipeline

        self.pipe = FluxPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-dev",
            torch_dtype=torch.bfloat16,
            cache_dir="/cache/hf",
        ).to("cuda")

    @modal.method()
    def generate(
        self,
        prompt: str,
        steps: int = 20,
        guidance: float = 3.5,
        width: int = 1024,
        height: int = 1024,
        seed: int | None = None,
    ) -> bytes:
        import torch

        generator = (
            torch.Generator(device="cuda").manual_seed(seed) if seed is not None else None
        )
        image = self.pipe(
            prompt=prompt,
            num_inference_steps=steps,
            guidance_scale=guidance,
            width=width,
            height=height,
            generator=generator,
        ).images[0]

        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return buf.getvalue()


@app.function(image=image)
@modal.fastapi_endpoint(method="POST", docs=True)
def endpoint(item: dict[str, Any]) -> modal.Response:
    """HTTP endpoint. Body: {prompt, steps?, guidance?, width?, height?, seed?}"""
    png = FluxModel().generate.remote(
        prompt=item["prompt"],
        steps=item.get("steps", 20),
        guidance=item.get("guidance", 3.5),
        width=item.get("width", 1024),
        height=item.get("height", 1024),
        seed=item.get("seed"),
    )
    return modal.Response(content=png, media_type="image/png")


@app.local_entrypoint()
def main(prompt: str = "a serene mountain lake at sunset"):
    """CLI: modal run modal_flux.py --prompt 'your prompt'"""
    png = FluxModel().generate.remote(prompt=prompt)
    out = "/tmp/flux_output.png"
    with open(out, "wb") as f:
        f.write(png)
    print(f"Wrote {out}")
