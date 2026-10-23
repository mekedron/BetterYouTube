import { estimateTokens } from './http';
import type { AiSession, ChatTurn } from './types';

/** Streams a reply to the whole conversation so far. */
export type StreamReply = (system: string, turns: ChatTurn[], signal?: AbortSignal) => AsyncIterable<string>;

/**
 * A session for stateless backends: it keeps the conversation and sends all
 * of it with every question. Cloud APIs and the connector both work this way.
 */
export class HistorySession implements AiSession {
  private turns: ChatTurn[];

  constructor(
    private system: string,
    history: ChatTurn[],
    private stream: StreamReply,
    /** Input tokens the backend accepts; long transcripts are split to fit. */
    private contextTokens: number,
  ) {
    this.turns = [...history];
  }

  async *ask(text: string, signal?: AbortSignal): AsyncIterable<string> {
    const turns: ChatTurn[] = [...this.turns, { role: 'user', content: text }];
    let reply = '';
    for await (const chunk of this.stream(this.system, turns, signal)) {
      reply += chunk;
      yield chunk;
    }
    this.turns = [...turns, { role: 'assistant', content: reply }];
  }

  async measure(text: string) {
    const used = estimateTokens(this.system) + this.turns.reduce((n, t) => n + estimateTokens(t.content), 0);
    return { tokens: estimateTokens(text), room: this.contextTokens - used };
  }

  destroy() {}
}
