import type { VideoContext } from '../protocol';
import type { AiProvider, AiSession, ChatTurn, ProviderConfig } from './types';

// Builds the prompts and runs a summary or a follow-up question through any
// provider. The prompts stay short on purpose: one instruction, the video's
// title, channel and length, and the transcript.

export const DEFAULT_INSTRUCTION =
  'What is this video about? Answer in 3 to 5 short bullet points with its key points.';

/** Input tokens kept free for the reply and the provider's own overhead. */
const REPLY_RESERVE = 700;

export type Stage =
  | { kind: 'downloading'; progress: number }
  | { kind: 'reading' }
  | { kind: 'part'; index: number; count: number }
  | { kind: 'writing' };

export interface RunOptions {
  provider: AiProvider;
  config: ProviderConfig;
  language: string;
  signal: AbortSignal;
  onStage: (stage: Stage) => void;
}

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function systemPrompt(language: string): string {
  return (
    'You summarize YouTube videos from their transcripts. Be brief and concrete. ' +
    'Start with the answer itself, with no introduction or closing remarks. ' +
    `Use only what the transcript says. Always answer in ${languageName(language)}.`
  );
}

function duration(seconds: number): string {
  if (!seconds) return 'unknown';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function videoBlock(video: VideoContext, label: string, body: string): string {
  return `Title: ${video.title}\nChannel: ${video.channel || 'unknown'}\nLength: ${duration(video.lengthSeconds)}\n\n${label}:\n${body}`;
}

// Splits text into pieces of at most `size` characters, at a sentence or word
// boundary when one is close.
function split(text: string, size: number): string[] {
  const parts: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf('. ', size);
    if (cut < size * 0.6) cut = rest.lastIndexOf(' ', size);
    if (cut < size * 0.6) cut = size;
    parts.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1);
  }
  if (rest.trim()) parts.push(rest.trim());
  return parts;
}

async function collect(stream: AsyncIterable<string>): Promise<string> {
  let text = '';
  for await (const chunk of stream) text += chunk;
  return text.trim();
}

async function openSession(options: RunOptions, history: ChatTurn[]): Promise<AiSession> {
  return options.provider.createSession({
    system: systemPrompt(options.language),
    history,
    language: options.language,
    config: options.config,
    signal: options.signal,
    onDownloadProgress: (progress) => options.onStage({ kind: 'downloading', progress }),
  });
}

/**
 * A summary run: yields the summary as it is written. When it finishes,
 * `conversation` holds the turns to continue from with ask().
 */
export class Conversation {
  history: ChatTurn[] = [];
  private session: AiSession | null = null;

  constructor(private options: RunOptions) {}

  /** Restores a finished conversation, for follow-up questions after the popup reopens. */
  static restore(options: RunOptions, history: ChatTurn[]): Conversation {
    const c = new Conversation(options);
    c.history = history;
    return c;
  }

  async *summarize(video: VideoContext, instruction: string): AsyncIterable<string> {
    const { onStage } = this.options;
    onStage({ kind: 'reading' });
    const session = await openSession(this.options, []);
    this.session = session;

    let prompt = `${instruction}\n\n${videoBlock(video, 'Transcript', video.transcript)}`;
    const whole = await session.measure(prompt);
    if (whole.tokens > whole.room - REPLY_RESERVE) {
      prompt = `${instruction}\n\n${videoBlock(video, 'Notes on the transcript, part by part', await this.notes(video, session, whole))}`;
    }

    onStage({ kind: 'writing' });
    let summary = '';
    for await (const chunk of session.ask(prompt, this.options.signal)) {
      summary += chunk;
      yield chunk;
    }
    this.history = [
      { role: 'user', content: prompt },
      { role: 'assistant', content: summary.trim() },
    ];
  }

  // A transcript longer than the model's window is read in parts, each in a
  // fresh session; the summary is then written from the parts' notes.
  private async notes(video: VideoContext, session: AiSession, whole: { tokens: number; room: number }) {
    const charsPerToken = video.transcript.length / Math.max(1, whole.tokens);
    const partTokens = Math.max(500, Math.floor((whole.room - REPLY_RESERVE - 200) * 0.85));
    const parts = split(video.transcript, Math.floor(partTokens * charsPerToken));
    const notes: string[] = [];
    for (const [i, part] of parts.entries()) {
      this.options.onStage({ kind: 'part', index: i + 1, count: parts.length });
      const partSession = await openSession(this.options, []);
      try {
        const ask =
          `This is part ${i + 1} of ${parts.length} of the transcript of a video titled "${video.title}". ` +
          `List its key points in at most 4 short bullet points.\n\nTranscript part:\n${part}`;
        notes.push(`Part ${i + 1}:\n${await collect(partSession.ask(ask, this.options.signal))}`);
      } finally {
        partSession.destroy();
      }
    }
    let joined = notes.join('\n\n');
    // Notes that still overflow lose their tail rather than failing the summary.
    const fit = await session.measure(joined);
    if (fit.tokens > fit.room - REPLY_RESERVE - 300) {
      joined = joined.slice(0, Math.floor((fit.room - REPLY_RESERVE - 300) * (joined.length / fit.tokens)));
    }
    return joined;
  }

  /** A follow-up question about the same video; yields the answer as it is written. */
  async *ask(question: string): AsyncIterable<string> {
    if (!this.session) {
      this.options.onStage({ kind: 'reading' });
      this.session = await openSession(this.options, this.history);
    }
    this.options.onStage({ kind: 'writing' });
    let answer = '';
    for await (const chunk of this.session.ask(question, this.options.signal)) {
      answer += chunk;
      yield chunk;
    }
    this.history = [...this.history, { role: 'user', content: question }, { role: 'assistant', content: answer.trim() }];
  }

  destroy() {
    this.session?.destroy();
    this.session = null;
  }
}
