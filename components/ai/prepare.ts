import type { Stage } from './summarize';
import type { ChatTurn } from './types';
import type { VideoContext } from '../protocol';

// Getting Chrome's built-in model ready before the popup opens. When the
// viewer turns it on, the background script waits until a video has stayed
// open for PREPARE_DELAY_MS, then asks the offscreen document either to load
// the model or to write the summary. The offscreen document is an extension
// page, the one place the model can run while the popup is closed. A
// finished summary goes to the same cache the popup reads; one still being
// written is shown by the popup as it grows.

export const PREPARE_DELAY_MS = 3000;

/** How long a loaded model is kept in memory with no new video. */
export const WARM_KEEP_MS = 10 * 60_000;

export type PreparedStatus =
  | { state: 'running'; text: string; stage: Stage }
  | { state: 'done'; history: ChatTurn[] }
  | { state: 'failed' };

/** Messages to and from the offscreen document. */
export type PrepareMessage =
  | { type: 'offscreen-warm'; language: string }
  | { type: 'offscreen-summarize'; videoId: string; print: string; language: string; instruction: string; video: VideoContext }
  | { type: 'prepared-status'; videoId: string; print: string }
  | { type: 'prepared-done'; videoId: string; print: string; history: ChatTurn[] };

/** What the offscreen document knows about this video's summary, or null. */
export async function preparedStatus(videoId: string, print: string): Promise<PreparedStatus | null> {
  const message: PrepareMessage = { type: 'prepared-status', videoId, print };
  try {
    return ((await browser.runtime.sendMessage(message)) as PreparedStatus | undefined) ?? null;
  } catch {
    // No offscreen document: nothing was prepared.
    return null;
  }
}
