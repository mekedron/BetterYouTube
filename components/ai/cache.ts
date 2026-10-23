import type { ChatTurn } from './types';

// Finished summaries and follow-ups, per video, for the rest of the browser
// session: reopening the popup shows them at once instead of asking the model
// again. A change of provider, language or instruction makes a fresh summary.

interface Entry {
  fingerprint: string;
  history: ChatTurn[];
}

const key = (videoId: string) => `summary:${videoId}`;

export function fingerprint(provider: string, language: string, instruction: string): string {
  return JSON.stringify([provider, language, instruction]);
}

export async function loadConversation(videoId: string, print: string): Promise<ChatTurn[] | null> {
  try {
    const stored = (await browser.storage.session.get(key(videoId)))[key(videoId)] as Entry | undefined;
    return stored?.fingerprint === print ? stored.history : null;
  } catch {
    return null;
  }
}

export async function saveConversation(videoId: string, print: string, history: ChatTurn[]): Promise<void> {
  try {
    await browser.storage.session.set({ [key(videoId)]: { fingerprint: print, history } satisfies Entry });
  } catch {}
}

export async function forgetConversation(videoId: string): Promise<void> {
  try {
    await browser.storage.session.remove(key(videoId));
  } catch {}
}
