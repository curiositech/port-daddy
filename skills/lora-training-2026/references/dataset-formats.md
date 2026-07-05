# Dataset Formats for LoRA

`prepare_dataset.py` converts these into the trainer's expected shape and applies the model's chat
template. Read this to pick the right `--format` and to structure raw data.

## Golden rules
- **Apply the model's own chat template** — never hand-roll `<|im_start|>` strings. The trainer pulls
  `tokenizer.apply_chat_template`, which is per-model. Mismatched templates = garbage outputs.
- **Mask the prompt, train on the response** — by default you compute loss only on assistant turns
  (`train_on_responses_only`). Training on the user's text too dilutes the signal.
- **One behavior per example, consistent shape** — mixed formats confuse a small adapter.
- **Hold out eval** — split *before* dedup leakage can cross the boundary.

## 1. ChatML / messages (default for instruct models)
```json
{"messages": [
  {"role": "system", "content": "You are a terse support agent."},
  {"role": "user", "content": "My order is late."},
  {"role": "assistant", "content": "Sorry about that. What's your order number?"}
]}
```
- `--format chatml`. Multi-turn supported — include the whole conversation; loss is on assistant turns.
- System prompt optional but powerful for persona/behavior tasks. Keep it consistent with serving.

## 2. Instruction / Alpaca
```json
{"instruction": "Summarize in one sentence.", "input": "<long text>", "output": "<summary>"}
```
- `--format alpaca`. Converted to messages internally. Good for single-turn task data.

## 3. Completion / raw text
```json
{"text": "Full document or pre-templated string to train on verbatim."}
```
- `--format completion`. Trains on the **entire** string (no masking). Use for base-model continued
  style training or when you've already templated. Easy to misuse — prefer chatml for instruct.

## 4. Preference pairs (DPO/ORPO/KTO)
```json
{"prompt": "Explain gravity to a 5-year-old.",
 "chosen": "Things fall because Earth pulls them...",
 "rejected": "Gravity is the curvature of spacetime described by..."}
```
- `--format dpo`. For preference tuning **after** an SFT LoRA, not from scratch.

## 5. Vision-language (VLM)
```json
{"messages": [
  {"role": "user", "content": [
     {"type": "image", "image": "imgs/receipt_01.png"},
     {"type": "text", "text": "Extract the total."}]},
  {"role": "assistant", "content": "$42.17"}
]}
```
- `--format vision`. Requires a VLM base (Qwen-VL, Gemma-3 vision, Pixtral). Images referenced by
  path or URL; the processor handles them. Train projector + LoRA.

## 6. Tool / function calling
Encode tool calls in assistant turns using the model's tool schema (often a `tool_calls` field or a
templated block the chat template understands). Keep the schema identical to serving. Validate that
your model's template actually renders tool calls before training on them.

## Sizing guidance
| Goal | Examples (rough) |
|------|------------------|
| Tone / format / persona | 100 – 1,000 |
| New narrow skill | 1,000 – 10,000 |
| Broad domain adaptation | 10,000 – 100,000+ |
| Preference (DPO) on top of SFT | 500 – 5,000 pairs |

Quality ≫ quantity: 500 clean, diverse, correctly-formatted examples beat 50k scraped ones.

## Common data defects (the visualizer flags these)
- **Truncation**: examples longer than `max_seq_len` get cut — the assistant's answer may be lost.
  Fix seq-len or split the example.
- **Label leakage**: the answer appears in the prompt/system text.
- **Role imbalance / missing assistant turn**: nothing to train on.
- **Near-duplicates**: inflate apparent size, cause memorization. `prepare_dataset.py --dedup`.
- **Length outliers**: a few 16k-token monsters set your seq-len and triple cost. Trim or bucket.
- **Template residue**: literal `<|im_start|>` inside `content` (double-templating). Strip it.
- **Inconsistent system prompt**: train and serve with the same system prompt, or none.
