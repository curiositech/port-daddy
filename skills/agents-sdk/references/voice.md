# Voice (beta)

Cloudflare’s [Voice documentation](https://developers.cloudflare.com/agents/communication-channels/voice/) was read on 2026-09-24 through the overview, quick start, `withVoice`, `onTurn`, lifecycle, and pipeline-hook sections. It documents `withVoice` for STT, LLM response, TTS, and persistence, and `withVoiceInput` for transcription only.

```ts
import { Agent } from "agents";
import { withVoice, WorkersAIFluxSTT, WorkersAITTS, type VoiceTurnContext } from "@cloudflare/voice";
const VoiceAgent = withVoice(Agent);
export class MyAgent extends VoiceAgent<Env> {
  transcriber = new WorkersAIFluxSTT(this.env.AI);
  tts = new WorkersAITTS(this.env.AI);
  async onTurn(transcript: string, context: VoiceTurnContext) { return `I heard: ${transcript}`; }
}
```

`onTurn` receives completed prior conversation in `context.messages` and an abort signal on interruption/disconnect; it may return a string, async iterable, or readable stream. Append the current transcript once when building a prompt. The source documents `beforeCallStart` (return false to reject), call-start/end and interrupt hooks, and `afterTranscribe`, `beforeSynthesize`, `afterSynthesize` hooks that may return `null` to skip an utterance.

```tsx
const { status, transcript, interimTranscript, startCall, endCall, toggleMute } = useVoiceAgent({ agent: "MyAgent" });
```

Authenticate before accepting a call, retain audio/transcripts under application policy, and use a separate confirmation/receipt for sensitive effects. The original `WorkersAINova3STT`, fixed model, and old `connect`/`disconnect` names were corrected because the checked current page uses `WorkersAIFluxSTT` and `startCall`/`endCall`; verify other providers and deployment configuration at the installed version.
