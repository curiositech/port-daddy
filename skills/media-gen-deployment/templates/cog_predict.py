"""Cog starter — FLUX dev for Replicate.

Deploy:
    cog login
    cog push r8.im/<your-username>/flux-dev

cog.yaml:
    build:
      gpu: true
      cuda: "12.4"
      python_version: "3.11"
      python_packages:
        - "torch==2.4.0"
        - "diffusers==0.31.0"
        - "transformers==4.45.0"
        - "accelerate==1.0.0"
        - "safetensors"
    predict: "predict.py:Predictor"

Notes:
- Cog has NO persistent volumes. Weights bake into the image.
- Image will be ~30GB; cold starts on public model 10-180s.
- For weights-on-volume pattern, use Modal or RunPod instead.
- Use Replicate Deployments + min_instances=1 for sub-10s cold starts.
"""
from __future__ import annotations

from cog import BasePredictor, Input, Path
import torch
from diffusers import FluxPipeline


class Predictor(BasePredictor):
    def setup(self) -> None:
        """Load model into GPU memory once at container start."""
        self.pipe = FluxPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-dev",
            torch_dtype=torch.bfloat16,
        ).to("cuda")

    def predict(
        self,
        prompt: str = Input(description="Text prompt"),
        negative_prompt: str = Input(
            description="Negative prompt (Flux uses guidance, not CFG; often ignored)",
            default="",
        ),
        steps: int = Input(default=20, ge=1, le=50),
        guidance: float = Input(default=3.5, ge=1.0, le=10.0),
        width: int = Input(default=1024, ge=512, le=2048),
        height: int = Input(default=1024, ge=512, le=2048),
        seed: int = Input(
            description="Random seed; -1 for random",
            default=-1,
        ),
    ) -> Path:
        if seed < 0:
            seed = torch.randint(0, 2**32 - 1, (1,)).item()
        generator = torch.Generator(device="cuda").manual_seed(seed)

        image = self.pipe(
            prompt=prompt,
            num_inference_steps=steps,
            guidance_scale=guidance,
            width=width,
            height=height,
            generator=generator,
        ).images[0]

        out = Path("/tmp/output.png")
        image.save(out)
        return out
