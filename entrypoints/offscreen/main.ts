import { chromeBuiltin } from '../../components/ai/chromeBuiltin';
import { WARM_KEEP_MS } from '../../components/ai/prepare';
import type { PrepareMessage, PreparedStatus } from '../../components/ai/prepare';
import { Conversation, systemPrompt } from '../../components/ai/summarize';
import type { AiSession, ProviderConfig } from '../../components/ai/types';

// Runs Chrome's built-in model while the popup is closed (see
// components/ai/prepare.ts). It holds at most one loaded session and one
// summary at a time; a newer video replaces both.

const CONFIG: ProviderConfig = { model: '', effort: 'default', baseUrl: '', agent: 'claude', apiKey: '' };

let warm: { session: AiSession; timer: number } | null = null;
let job: { videoId: string; print: string; abort: AbortController; status: PreparedStatus } | null = null;

function release() {
  if (!warm) return;
  clearTimeout(warm.timer);
  warm.session.destroy();
  warm = null;
}

async function warmUp(language: string) {
  if (warm) {
    clearTimeout(warm.timer);
    warm.timer = window.setTimeout(release, WARM_KEEP_MS);
    return;
  }
  // Chrome downloads the model only after a click, never from here.
  if ((await chromeBuiltin.status(language, CONFIG)) !== 'ready') return;
  const session = await chromeBuiltin.createSession({
    system: systemPrompt(language),
    history: [],
    language,
    config: CONFIG,
    signal: new AbortController().signal,
  });
  release();
  warm = { session, timer: window.setTimeout(release, WARM_KEEP_MS) };
}

async function summarize(message: Extract<PrepareMessage, { type: 'offscreen-summarize' }>) {
  const { videoId, print, language, instruction, video } = message;
  if (job?.videoId === videoId && job.print === print) return;
  job?.abort.abort();
  release();
  const abort = new AbortController();
  const current: NonNullable<typeof job> = {
    videoId,
    print,
    abort,
    status: { state: 'running', text: '', stage: { kind: 'reading' } },
  };
  job = current;
  if ((await chromeBuiltin.status(language, CONFIG)) !== 'ready') {
    current.status = { state: 'failed' };
    return;
  }
  const conversation = new Conversation({
    provider: chromeBuiltin,
    config: CONFIG,
    language,
    signal: abort.signal,
    onStage: (stage) => {
      if (stage.kind !== 'downloading' && current.status.state === 'running') current.status.stage = stage;
    },
  });
  try {
    for await (const chunk of conversation.summarize(video, instruction)) {
      if (current.status.state === 'running') current.status.text += chunk;
    }
    current.status = { state: 'done', history: conversation.history };
    const done: PrepareMessage = { type: 'prepared-done', videoId, print, history: conversation.history };
    await browser.runtime.sendMessage(done).catch(() => {});
  } catch {
    current.status = { state: 'failed' };
  } finally {
    conversation.destroy();
  }
}

browser.runtime.onMessage.addListener((message: PrepareMessage, _sender, sendResponse) => {
  if (message?.type === 'offscreen-warm') {
    void warmUp(message.language).catch(() => {});
  } else if (message?.type === 'offscreen-summarize') {
    void summarize(message);
  } else if (message?.type === 'prepared-status') {
    sendResponse(job?.videoId === message.videoId && job.print === message.print ? job.status : null);
  }
  return undefined;
});
