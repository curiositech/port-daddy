# Deployment Formats — Cog, Modal, Truss, BentoML, RunPod, ComfyUI-as-API (May 2026)

Each platform has a preferred format. Pick the one that fits your platform; switching formats later is painful.

---

## Cog (Replicate)

**Files**: `cog.yaml` + `predict.py`.

```yaml
# cog.yaml
build:
  gpu: true
  python_version: "3.11"
  python_packages:
    - "torch==2.4.0"
    - "diffusers==0.31.0"
    - "transformers==4.45.0"
    - "accelerate==1.0.0"
predict: "predict.py:Predictor"
```

```python
# predict.py
from cog import BasePredictor, Input, Path
from diffusers import FluxPipeline
import torch

class Predictor(BasePredictor):
    def setup(self):
        self.pipe = FluxPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-dev",
            torch_dtype=torch.bfloat16,
        ).to("cuda")

    def predict(
        self,
        prompt: str = Input(description="Prompt"),
        steps: int = Input(default=20, ge=1, le=50),
        guidance: float = Input(default=3.5, ge=1.0, le=10.0),
    ) -> Path:
        image = self.pipe(prompt=prompt, num_inference_steps=steps,
                          guidance_scale=guidance).images[0]
        out = Path("/tmp/output.png")
        image.save(out)
        return out
```

Push: `cog push r8.im/<user>/<model>`.

**Strengths**: Simplest "I have a script, give me an HTTP endpoint" tool. Webhooks reliable. Public marketplace.

**Weaknesses**: Restrictive — weights bake into image (no volumes). Cold starts on public models notoriously bad.

**When to use**: Public Replicate model, simple in/out.

---

## Modal

**Files**: A single Python file.

```python
import modal

app = modal.App("flux-dev")
volume = modal.Volume.from_name("flux-weights", create_if_missing=True)

image = (modal.Image.debian_slim()
    .pip_install("torch==2.4.0", "diffusers==0.31.0", "transformers==4.45.0",
                 "accelerate==1.0.0", "huggingface_hub[hf_transfer]")
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_HOME": "/cache/hf"}))

@app.function(
    gpu="H100",
    image=image,
    volumes={"/cache": volume},
    enable_memory_snapshot=True,
    min_containers=1,
    timeout=300,
)
@modal.fastapi_endpoint(method="POST")
def generate(item: dict):
    import torch
    from diffusers import FluxPipeline

    pipe = FluxPipeline.from_pretrained(
        "black-forest-labs/FLUX.1-dev",
        torch_dtype=torch.bfloat16,
        cache_dir="/cache/hf",
    ).to("cuda")

    image = pipe(prompt=item["prompt"],
                 num_inference_steps=item.get("steps", 20),
                 guidance_scale=item.get("guidance", 3.5)).images[0]

    import io
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return modal.Response(content=buf.getvalue(),
                          media_type="image/png")
```

Deploy: `modal deploy flux.py`.

**Strengths**: Best-in-class DX. Volumes for weights. Memory snapshots → sub-2s cold start. Same code can do `.map()` for batch, `.spawn()` for async, `@web_endpoint` for HTTP, cron schedules. Prod and dev in one file.

**Weaknesses**: Modal lock-in. Python only.

**When to use**: Python team, full control, serverless + batch + cron in one repo.

---

## Truss (Baseten)

**Files**: `config.yaml` + `model.py`.

```yaml
# config.yaml
model_name: flux-dev
python_version: py311
requirements:
  - torch==2.4.0
  - diffusers==0.31.0
  - transformers==4.45.0
  - accelerate==1.0.0
resources:
  accelerator: H100
  use_gpu: true
runtime:
  predict_concurrency: 1
```

```python
# model.py
class Model:
    def __init__(self, **kwargs):
        self._pipe = None

    def load(self):
        import torch
        from diffusers import FluxPipeline
        self._pipe = FluxPipeline.from_pretrained(
            "black-forest-labs/FLUX.1-dev",
            torch_dtype=torch.bfloat16,
        ).to("cuda")

    def predict(self, request: dict) -> dict:
        image = self._pipe(prompt=request["prompt"]).images[0]
        import base64, io
        buf = io.BytesIO()
        image.save(buf, format="PNG")
        return {"image": base64.b64encode(buf.getvalue()).decode()}
```

Deploy: `truss push`.

**Strengths**: Heavy investment in TensorRT-LLM compilation, throughput optimization. Enterprise SLAs.

**Weaknesses**: Most expensive in this list (H100 $6.50/hr vs Modal $3.95/hr).

**When to use**: Enterprise LLM throughput-optimized serving, willing to pay for TRT-LLM compile.

---

## RunPod Serverless Worker

**Files**: Dockerfile + handler.

```python
# handler.py
import runpod, torch, base64, io
from diffusers import FluxPipeline

# Load once at module level (cached across warm invocations)
pipe = FluxPipeline.from_pretrained(
    "black-forest-labs/FLUX.1-dev",
    torch_dtype=torch.bfloat16,
    cache_dir="/runpod-volume/huggingface-cache",
).to("cuda")

def handler(event):
    inp = event["input"]
    image = pipe(prompt=inp["prompt"],
                 num_inference_steps=inp.get("steps", 20),
                 guidance_scale=inp.get("guidance", 3.5)).images[0]
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    return {"image_b64": base64.b64encode(buf.getvalue()).decode()}

runpod.serverless.start({"handler": handler})
```

```dockerfile
FROM runpod/pytorch:2.4.0-py3.11-cuda12.4
RUN pip install runpod diffusers transformers accelerate
ENV HF_HOME=/runpod-volume/huggingface-cache
WORKDIR /app
COPY handler.py .
CMD ["python", "-u", "handler.py"]
```

Deploy: build image → push to registry → create RunPod Serverless endpoint pointing at image + Network Volume.

**Strengths**: Cheapest serverless H100. Network Volume for weights. Real Linux Docker container.

**Weaknesses**: Worker handler model is awkward vs Modal. Logging basic.

**When to use**: Cost-sensitive scale, RunPod ecosystem.

---

## BentoML

`bentofile.yaml` + service.py + Bento format. More ceremony than Modal/Cog but more flexible for multi-model services.

**When to use**: Multi-model service in one deployment, want vendor-portable format. Otherwise pick Modal or Cog.

---

## Plain FastAPI + Docker on Pods

Just a FastAPI app in a container, deployed to a RunPod Pod / Lambda Pod / CoreWeave node.

```python
from fastapi import FastAPI
from pydantic import BaseModel
import torch
from diffusers import FluxPipeline

app = FastAPI()

class Request(BaseModel):
    prompt: str
    steps: int = 20

@app.on_event("startup")
async def startup():
    global pipe
    pipe = FluxPipeline.from_pretrained(
        "black-forest-labs/FLUX.1-dev",
        torch_dtype=torch.bfloat16,
    ).to("cuda")

@app.post("/generate")
async def generate(req: Request):
    image = pipe(prompt=req.prompt, num_inference_steps=req.steps).images[0]
    # ... save and return
```

**When to use**: Custom workflows, full control, cost-sensitive long-running. Pair with Network Volume for weights.

---

## ComfyUI-as-API

Different problem: turning a ComfyUI workflow into an API endpoint.

| Tool | Approach |
|---|---|
| **ComfyDeploy** (`BennyKok/comfyui-deploy`) | Open-source "Vercel for ComfyUI" — versioning + staging + prod, multi-machine orchestration. Best for teams. |
| **BentoML `comfy-pack`** | Defines schema, deploys to BentoCloud. |
| **RunComfy** | Turnkey hosted with workflow library + autoscaling production API. Best for artists. |
| **ViewComfy** | Pick workflow + GPU → autoscaling API. |
| **`pydn/ComfyUI-to-Python-Extension`** | Exports any workflow as a runnable Python script. Tight, no HTTP overhead. |
| **`runpod-workers/worker-comfyui`** | RunPod serverless wrapper exposing `/runsync` and `/run` endpoints. |
| **Custom websocket bridge** | See `templates/comfyui_bridge.py`. |

For ComfyUI deep detail, see the `comfyui-mastery` skill.

---

## Format Decision Matrix

| You want... | Pick |
|---|---|
| Simplest public-model HTTP endpoint | **Cog** → Replicate |
| Full Python control, batch + serve + cron | **Modal** |
| TRT-LLM compiled LLM throughput | **Truss** → Baseten |
| Cheapest serverless H100 | **RunPod handler** |
| Multi-model service, vendor-portable | **BentoML** |
| Custom workflow, full control | **FastAPI + Docker on Pod** |
| ComfyUI workflow as API | **ComfyDeploy** or **`worker-comfyui`** |

For platform comparison, see `serverless-platforms.md`. For starter code, see `templates/`.
