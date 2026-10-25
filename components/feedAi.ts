import { ProviderError } from './ai/types';
import { ensureOk } from './ai/http';

// The feed's AI mode: a decision model judges each recommended video against
// the viewer's own description of what is worth their time. One request
// carries a whole batch of cards: the viewer's description is the shared
// input, and every video is one yes/no question about it. Both services bill
// input tokens only, so a batch of 30 videos costs a fraction of a cent.

export type FeedAiService = 'openai' | 'jev';

/** What a card shows about its video, read from YouTube's data on the card. */
export interface VideoFacts {
  id: string;
  title: string;
  /** Channel name, views, age, badges such as "Auto-dubbed", in card order. */
  details: string[];
  /** "9:24", or empty when the card shows no length. */
  length: string;
  /** The channel's subscriber count, when the small-channel lookup has it. */
  subscribers: number | null;
  /** From the video's own page, in the 'full' depth only. */
  page?: { description: string; tags: string[]; category: string; published: string };
}

/** Probability, 0..1, that each video is worth the viewer's time, by video id. */
export type Verdicts = Record<string, number>;

export const DEFAULT_CRITERIA = `Worth my time: videos with real substance. Expert knowledge, careful research, real craft, honest reviews, original ideas, or entertainment made by people who care.

Not worth my time: clickbait, padded filler, reaction and compilation videos, AI-generated slop, low-effort content farms, drama and rage bait.`;

/** Below this probability a video is filtered, per strictness setting. */
export const STRICTNESS_THRESHOLD = { lenient: 0.25, balanced: 0.5, strict: 0.75 } as const;
export type Strictness = keyof typeof STRICTNESS_THRESHOLD;

/** The most videos sent in one request. */
export const BATCH_SIZE = 30;

/** Where each service's API key is stored in components/ai/secrets.ts. */
export const KEY_SLOT: Record<FeedAiService, string> = { openai: 'openai', jev: 'typesafe' };

/** Hosts the background script calls; Jev's API does not answer extensions' cross-origin requests. */
export const HOST_PERMISSION: Record<FeedAiService, string | null> = {
  openai: null,
  jev: 'https://api.typesafe.ai/*',
};

function sharedInput(criteria: string): string {
  return `A viewer describes which YouTube videos are worth their time:\n\n${criteria.trim() || DEFAULT_CRITERIA}`;
}

function question(video: VideoFacts): string {
  const lines = [`Title: ${video.title}`];
  if (video.details.length) lines.push(`Shown on the card: ${video.details.join(' · ')}`);
  if (video.length) lines.push(`Length: ${video.length}`);
  if (video.subscribers !== null) lines.push(`Channel subscribers: ${video.subscribers}`);
  if (video.page) {
    const { description, tags, category, published } = video.page;
    if (published) lines.push(`Published: ${published}`);
    if (category) lines.push(`Category: ${category}`);
    if (tags.length) lines.push(`Tags: ${tags.join(', ')}`);
    if (description) lines.push(`Description: ${description}`);
  }
  return `Judged by the viewer's description, this video is worth their time.\n\n${lines.join('\n')}`;
}

async function askOpenAi(key: string, criteria: string, videos: VideoFacts[], signal?: AbortSignal): Promise<Verdicts> {
  const res = await fetch('https://api.openai.com/v1/decisions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    signal,
    body: JSON.stringify({
      model: 'gpt-6-luna',
      input: sharedInput(criteria),
      questions: videos.map((video, i) => ({ type: 'predicate', name: `v${i}`, instructions: question(video) })),
    }),
  });
  await ensureOk(res);
  const body = (await res.json()) as { answers?: Array<{ type: string; name: string; probability?: number }> };
  const verdicts: Verdicts = {};
  // A refused question gets no verdict, so its card stays as it is.
  for (const answer of body.answers ?? []) {
    const video = videos[Number(answer.name.slice(1))];
    if (video && answer.type === 'predicate' && typeof answer.probability === 'number') {
      verdicts[video.id] = answer.probability;
    }
  }
  return verdicts;
}

async function askJev(key: string, criteria: string, videos: VideoFacts[], signal?: AbortSignal): Promise<Verdicts> {
  const res = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    signal,
    body: JSON.stringify({
      model: 'jev-latest',
      state: sharedInput(criteria),
      questions: Object.fromEntries(videos.map((video, i) => [`v${i}`, { type: 'noul', instructions: question(video) }])),
    }),
  });
  await ensureOk(res);
  const body = (await res.json()) as { answers?: Record<string, { type: string; noul?: number }> };
  const verdicts: Verdicts = {};
  for (const [name, answer] of Object.entries(body.answers ?? {})) {
    const video = videos[Number(name.slice(1))];
    if (video && answer.type === 'noul' && typeof answer.noul === 'number') verdicts[video.id] = answer.noul;
  }
  return verdicts;
}

/** Asks the service about a batch of videos. Throws a ProviderError with the API's own message on failure. */
export async function judgeVideos(
  service: FeedAiService,
  key: string,
  criteria: string,
  videos: VideoFacts[],
  signal?: AbortSignal,
): Promise<Verdicts> {
  if (!key) throw new ProviderError('no-key');
  return service === 'jev' ? askJev(key, criteria, videos, signal) : askOpenAi(key, criteria, videos, signal);
}
