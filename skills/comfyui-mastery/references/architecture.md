# ComfyUI Architecture (May 2026)

The graph executor, what's actually happening when you hit Queue, the JSON formats, and the headless API.

---

## Graph Executor

ComfyUI is a **DAG executor for diffusion models**. Each node is a Python class with:
- A classmethod `INPUT_TYPES` declaring typed inputs.
- A `RETURN_TYPES` declaring typed outputs.
- A `FUNCTION` name pointing at the execution method.
- The execution method, which receives inputs and returns a tuple matching `RETURN_TYPES`.

**The cache is the magic.** The executor hashes each node's inputs (model state + parameters) and only re-executes nodes whose inputs changed. When you re-roll a seed:

```
CheckpointLoader → unchanged (cache hit)
DualCLIPLoader → unchanged (cache hit)
CLIPTextEncode → unchanged (cache hit)
EmptyLatentImage → seed changed (cache miss)
KSampler → upstream changed (cache miss)
VAEDecode → upstream changed (cache miss)
SaveImage → upstream changed (cache miss)
```

Only the bottom 4 nodes re-run. This is why iterating on a Flux dev workflow at 30s/image feels fast — the model loaders (the slow part) cache.

---

## The Pipeline Split — MODEL / CLIP / VAE

Diffusion models in ComfyUI are split into three independent graph objects:

| Object | What it is | Loader nodes |
|---|---|---|
| `MODEL` | The UNet (SD1.5/SDXL) or DiT (Flux/SD3/Wan/Hunyuan) weights | `CheckpointLoaderSimple`, `UNETLoader`, `UnetLoaderGGUF` |
| `CLIP` | Text encoder. Single for SD1.5, dual (CLIP-L + T5/CLIP-G) for SDXL/Flux/SD3 | `CLIPLoader`, `DualCLIPLoader`, `TripleCLIPLoader`, `DualCLIPLoaderGGUF` |
| `VAE` | Latent ↔ pixel space encoder/decoder | `VAELoader` (or bundled in `CheckpointLoaderSimple`) |

Why this matters:
- **You can swap a VAE independently.** Flux uses `ae.safetensors`; SDXL uses `sdxl_vae.safetensors`; never mix.
- **You can stack LoRAs against just MODEL or both MODEL and CLIP.**
- **You can apply ControlNet conditioning to one branch without touching the others.**
- **You can quantize CLIP separately from MODEL** — a common 12GB-card pattern is fp16 UNet + fp8 CLIP-L + Q5_K_M T5.

### Triple-encoder note (SD3.5)

SD3.5 needs `clip_l.safetensors` + `clip_g.safetensors` + `t5xxl_fp16.safetensors` loaded via `TripleCLIPLoader`. Forgetting any one yields broken outputs.

---

## Conditioning

`CONDITIONING` is a list of `(token-embedding-tensor, dict-of-extras)` pairs produced by `CLIPTextEncode`. Nodes that mutate it:

- `ConditioningConcat` — concatenate two conditionings (regional prompts)
- `ConditioningCombine` — combine via element-wise add
- `ConditioningSetArea` — apply a conditioning only inside a rectangular region
- `ConditioningSetTimestepRange` — apply only at certain denoise timesteps
- `ControlNetApplyAdvanced` — inject ControlNet hint via the conditioning slot
- IPAdapter / Flux Redux nodes — inject reference-image conditioning the same way

Regional prompting, ControlNet, and IPAdapter all hook into the same conditioning surface. Once you internalize that, advanced workflows feel obvious.

---

## Samplers and Schedulers

**Samplers** are integration algorithms (math): `euler`, `dpmpp_2m`, `dpmpp_3m_sde`, `heun`, `lcm`, `restart`, `ipndm`, `deis`.

**Schedulers** are noise schedules: `normal`, `karras`, `exponential`, `simple`, `sgm_uniform`, `beta`, `linear_quadratic`.

The pair determines visual quality. Empirical defaults (May 2026):

| Model | Sampler | Scheduler | Steps | Guidance/CFG |
|---|---|---|---|---|
| Flux dev | `euler` | `simple` or `beta` | 20 | 3.5 |
| Flux schnell | `euler` | `simple` | 4 | 1.0 |
| Flux Kontext dev | `euler` | `simple` | 20 | 2.5 |
| SDXL | `dpmpp_2m` | `karras` | 25 | 6 |
| SD3.5 Large | `dpmpp_2m` | `sgm_uniform` | 28 | 4.5 |
| HiDream Dev | `dpmpp_2m_sde` | `karras` | 28 | 5 |
| LTX Video distilled | `euler` | `simple` | 5–8 | — |

**Advanced samplers** — `KSamplerAdvanced`, `SamplerCustom`, `SamplerCustomAdvanced` — expose `add_noise`, `start_at_step`, `end_at_step` for two-pass workflows (base → refiner, or base → high-res-fix).

---

## Workflow JSON — UI vs API format

**Two distinct shapes.** This trips up everyone the first time.

### UI format (default Save)

Graph with positional metadata:
```json
{
  "last_node_id": 12,
  "last_link_id": 18,
  "nodes": [
    { "id": 1, "type": "CheckpointLoaderSimple", "pos": [100, 200], "widgets_values": [...], ... }
  ],
  "links": [ [link_id, from_node, from_slot, to_node, to_slot, type] ],
  "groups": [...],
  "config": {},
  "extra": {}
}
```
This is also what's embedded as PNG metadata when you drag a generated image back into ComfyUI.

### API format (Save (API Format) after enabling Dev mode in Settings)

Flat object keyed by node ID:
```json
{
  "1": {
    "class_type": "CheckpointLoaderSimple",
    "inputs": { "ckpt_name": "flux1-dev.safetensors" }
  },
  "2": {
    "class_type": "CLIPTextEncode",
    "inputs": { "clip": ["1", 1], "text": "a cat" }
  }
}
```

Outputs reference upstream nodes as `[node_id, output_index]`. **This is what you POST to `/prompt`.**

**Always check both into git.** UI format preserves visual layout; API format is what runs.

---

## Headless HTTP / WebSocket API

Default bind is `127.0.0.1:8188`.

### Endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/prompt` | Queue a workflow. Body: `{prompt, client_id, extra_data}`. Returns `prompt_id`. |
| GET | `/queue` | View pending + running prompts. |
| GET | `/history/{prompt_id}` | Final outputs + metadata. |
| GET | `/view?filename=...&subfolder=...&type=output` | Download file. `type` ∈ `input` / `output` / `temp`. |
| POST | `/upload/image` | Multipart upload of input image. |
| POST | `/interrupt` | Cancel current prompt. |
| POST | `/free` | Free GPU memory. |
| GET | `/object_info` | Schema of every available node. |
| WS | `/ws?clientId=...` | Live events. |

### WebSocket events

```
status              — overall queue state
execution_start     — prompt began
executing           — current node about to run
progress            — current node progress (sampling steps)
executed            — node finished, with output references
execution_cached    — node skipped (cache hit)
execution_error     — node failed
execution_success   — prompt finished
```

### Reference Python client

`ComfyUI/script_examples/websockets_api_example.py` — minimal pattern for queueing + listening.

```python
import json, urllib.request, uuid
from websocket import WebSocketApp

server = "127.0.0.1:8188"
client_id = str(uuid.uuid4())

def queue_prompt(prompt):
    data = json.dumps({"prompt": prompt, "client_id": client_id}).encode()
    req = urllib.request.Request(f"http://{server}/prompt", data=data,
                                 headers={"Content-Type": "application/json"})
    return json.loads(urllib.request.urlopen(req).read())

# WS subscribe + filter for prompt_id of interest
```

For deployment patterns (RunPod serverless wrapper, Modal endpoint, ComfyDeploy), see `deployment.md` and the `media-gen-deployment` skill.

---

## ComfyUI vs Forge / A1111 / Invoke / Swarm

| UI | Strength | Weakness |
|---|---|---|
| **ComfyUI** | Fastest, day-zero new model support, regional/multi-pass workflows, headless API | Steep learning curve, no canvas-style inpainting |
| **Forge** | A1111 UX + Flux + lower VRAM | Less workflow flexibility |
| **A1111** | Familiar UX, biggest extension catalog | Slowest, lagging on new models |
| **InvokeAI** | Best canvas / inpainting studio | Smaller node ecosystem |
| **SwarmUI** | Multi-user, shared GPU, **uses ComfyUI as backend** | Adds a layer on top |

If you're considering this skill, you're already on ComfyUI. SwarmUI users should still read this doc — the backend is ComfyUI.

---

## Launch Flags Worth Knowing

```bash
python main.py [flags]
  --listen 127.0.0.1            # default; only bind external behind auth
  --port 8188
  --lowvram | --normalvram | --highvram | --gpu-only | --cpu | --novram
  --use-sage-attention          # RTX 30/40/50; ~1.3-1.7x DiT attention speed
  --use-flash-attention
  --use-pytorch-cross-attention # default fallback
  --reserve-vram 1.5            # reserve N GB for other apps
  --front-end-version Comfy-Org/ComfyUI_frontend@latest
  --verbose
  --log-file /path/to/log
```

For the per-platform setup (Mac MPS, NVIDIA CUDA, AMD ROCm) see `deployment.md`.
