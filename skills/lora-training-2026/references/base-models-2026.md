# Base Models for LoRA Fine-Tuning (2026)

Open-weight models you can legally and practically LoRA. This is the *reasoning* behind
`scripts/model_registry.json` — read it when the registry's ranking needs human judgment.

> **Verify before you commit.** Model families ship new point releases constantly. Confirm the
> exact checkpoint name, license, and context length on the model's Hugging Face card before a run.
> Treat the sizes/specs below as "good enough to choose by," not as a spec sheet.

## How to choose (decision order)

1. **License** — Can you ship what you build? Apache-2.0 / MIT are unrestricted. Llama and Gemma
   carry community licenses with acceptable-use terms and (for Llama) an MAU threshold. Some
   "open" models are research-only — disqualifying for commercial products.
2. **Base vs Instruct** — Fine-tuning an **instruct** checkpoint preserves chat/format ability and
   needs less data; fine-tune the **base** only when you want to fully own the behavior and have
   lots of data. For 90% of LoRA jobs, start from instruct.
3. **Size vs your VRAM** — See `local-vs-cloud.md`. With QLoRA: ~8B fits 16 GB, ~14B fits 24 GB,
   ~32B needs 48 GB, ~70B needs 2×48 GB or cloud.
4. **Capability fit** — reasoning, multilingual, long-context, coding, or vision. Don't pay for a
   reasoning model if you're doing format rewriting.
5. **Ecosystem** — Unsloth/Axolotl/llama.cpp support, tokenizer/chat-template stability, community
   adapters. Good support saves more time than a 2-point benchmark edge.

## Families and where they shine

### Qwen3 (Alibaba) — default recommendation for most LoRA work
- **Sizes**: dense 0.6B–32B plus MoE variants; strong instruct checkpoints.
- **Strengths**: excellent quality-per-parameter, very strong multilingual (esp. CJK), long context,
  first-class Unsloth/Axolotl support, permissive (Apache-2.0) on most checkpoints.
- **Weaknesses**: rapid release cadence means template/version churn — pin your checkpoint.
- **Pick when**: you want the best general-purpose 4–32B instruct base with a clean license.

### Llama 4 / Llama 3.3 (Meta)
- **Strengths**: huge ecosystem, every tool supports it, strong English + tool-use; Llama 4 brings
  MoE and very long context.
- **Weaknesses**: **community license** (acceptable-use terms; MAU clause). MoE checkpoints are
  heavier to host than their "active params" suggest — budget for total params in memory.
- **Pick when**: you need maximum tooling/community support and the license terms are acceptable.

### Gemma 3 (Google)
- **Strengths**: strong small models (1B–27B), good multilingual, **native vision** on larger sizes,
  efficient at small sizes, solid safety tuning.
- **Weaknesses**: Gemma license (use-restrictions), occasionally finicky chat template.
- **Pick when**: small-footprint deployment, multimodal, or you like the 4B/12B sweet spots.

### Mistral / Ministral / Mixtral (Mistral AI)
- **Strengths**: efficient dense models, true Apache-2.0 on the open line, great latency, strong
  European-language coverage; Mixtral MoE for higher capability.
- **Weaknesses**: not always top of raw benchmark tables; some newer models are weights-available
  under non-commercial research terms — check each.
- **Pick when**: you want a fast, permissively licensed Western-language workhorse.

### Phi-4 (Microsoft)
- **Strengths**: punches far above its weight on reasoning/STEM for its size; small and cheap to
  train; MIT-style permissive.
- **Weaknesses**: trained heavily on synthetic data — narrower world knowledge and weaker casual
  chat persona; can be brittle outside its strengths.
- **Pick when**: reasoning/structured tasks on a tight VRAM budget.

### DeepSeek-V3 / DeepSeek-R1 distills
- **Strengths**: frontier-level reasoning; the **R1 distills into Qwen/Llama** (1.5B–70B) are
  excellent, cheap-to-LoRA reasoning bases under permissive terms.
- **Weaknesses**: the full V3/R1 are very large MoE — not single-GPU LoRA targets; verbose
  "thinking" output needs handling in your data/template.
- **Pick when**: you want reasoning behavior — LoRA a **distill**, not the full model.

### SmolLM / small models (≤3B)
- **Strengths**: train on almost anything, even CPU-adjacent or 8 GB GPUs; instant iteration;
  great for on-device, classification, routing, and format tasks.
- **Weaknesses**: limited world knowledge and reasoning ceiling.
- **Pick when**: edge/on-device deployment or high-volume narrow tasks.

## Specialized axes

| Need | Good picks | Notes |
|------|-----------|-------|
| **Coding** | Qwen3-Coder, Codestral, DeepSeek-Coder | Use a code-pretrained base; general bases LoRA worse for code |
| **Vision (VLM)** | Qwen-VL, Gemma 3 (vision), Llama-4 vision, Pixtral | Data = image+text pairs; train vision-language projector + LoRA |
| **Reasoning** | R1-distill-Qwen, Phi-4, QwQ-class | Keep/strip `<think>` consistently in your training data |
| **Long context** | Qwen3, Llama 4 | LoRA does not extend context for free — base must already support it |
| **Multilingual** | Qwen3, Gemma 3, Mistral | Match the base's pretraining languages to your data |
| **Edge / on-device** | SmolLM, Gemma 3 1–4B, Llama 3.2 1–3B | Export to GGUF q4 for llama.cpp/Ollama |

## Strengths/weaknesses cheat-table

| Family | License | Sweet-spot sizes | Strong at | Watch out for |
|--------|---------|------------------|-----------|---------------|
| Qwen3 | Apache-2.0* | 4B / 8B / 14B / 32B | general, multilingual, long-ctx | version churn |
| Llama 4 / 3.3 | Community | 8B / 70B / MoE | ecosystem, tool-use | license terms, MoE memory |
| Gemma 3 | Gemma | 1B / 4B / 12B / 27B | small, vision, multilingual | use-restrictions, template |
| Mistral | Apache-2.0* | 7B / 8B / Mixtral | speed, EU langs | some newer = research-only |
| Phi-4 | MIT* | ~14B | reasoning/STEM, tiny | thin world knowledge |
| DeepSeek distill | Permissive* | 7B / 14B / 32B / 70B | reasoning | verbose thinking, full model huge |
| SmolLM | Apache-2.0 | 0.1–3B | edge, iteration | low ceiling |

\* Confirm per-checkpoint; licenses vary across a family's releases.

## Anti-patterns specific to base selection
- **Fine-tuning a base (non-instruct) checkpoint for a chat task with 500 examples** → you'll fight
  the lack of an instruction prior. Use the instruct checkpoint.
- **Picking a research-only model for a product** → legally unshippable; check the license first.
- **LoRA-ing the full DeepSeek-V3/R1 MoE on one GPU** → won't fit; use the distills.
- **Assuming MoE "active params" = memory** → you must hold *all* experts in VRAM.
