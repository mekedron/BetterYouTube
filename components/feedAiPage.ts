import { BATCH_SIZE, DEFAULT_CRITERIA, STRICTNESS_THRESHOLD } from './feedAi';
import type { VideoFacts } from './feedAi';
import { JUDGE_EVENT, VERDICTS_EVENT } from './protocol';
import type { JudgeRequest, JudgeResponse } from './protocol';
import type { Settings } from './settings';

// The page-world half of the feed's AI mode: it reads what each card shows,
// sends new videos to the bridge in batches, and remembers the verdicts.
// A card waits as it is until its verdict arrives, so a good video never
// flashes dimmed.

type YtElement = Element & { data?: any; componentProps?: { data?: () => any } };

/** Requests sent at once; more cards wait for a free slot. */
const MAX_IN_FLIGHT = 2;
/** New cards are collected this long before a request, so one request covers a page. */
const COLLECT_MS = 300;
/** Video-page lookups at once in the 'full' depth. */
const MAX_PARALLEL_LOOKUPS = 6;

function text(node: any): string {
  if (!node) return '';
  if (typeof node === 'string') return node;
  return node.content ?? node.simpleText ?? (node.runs ?? []).map((r: any) => r.text).join('') ?? '';
}

function lockupModel(card: YtElement): any {
  const lockup = (card.matches('yt-lockup-view-model') ? card : card.querySelector('yt-lockup-view-model')) as YtElement | null;
  try {
    const model = lockup?.componentProps?.data?.();
    if (model) return model;
  } catch {}
  return card.data?.content?.lockupViewModel ?? (card.data?.contentId ? card.data : null);
}

/**
 * What the card shows about its video, or null for anything that is not a
 * plain video: playlists, mixes, ads, Shorts shelves.
 */
export function factsOf(card: YtElement): Omit<VideoFacts, 'subscribers'> | null {
  const lockup = lockupModel(card);
  if (lockup) {
    if (lockup.contentType !== 'LOCKUP_CONTENT_TYPE_VIDEO' || !lockup.contentId) return null;
    const meta = lockup.metadata?.lockupMetadataViewModel;
    const rows: any[] = meta?.metadata?.contentMetadataViewModel?.metadataRows ?? [];
    const details = rows.flatMap((row) => [
      ...(row.metadataParts ?? []).map((part: any) => text(part.text)),
      ...(row.badges ?? []).map((badge: any) => badge.badgeViewModel?.badgeText ?? ''),
    ]);
    const badges: any[] = (lockup.contentImage?.thumbnailViewModel?.overlays ?? []).flatMap(
      (o: any) => o.thumbnailBottomOverlayViewModel?.badges ?? [],
    );
    const length = badges.map((b) => b.thumbnailBadgeViewModel?.text ?? '').find((t: string) => /^\d+(:\d\d)+$/.test(t)) ?? '';
    return { id: lockup.contentId, title: text(meta?.title), details: details.filter(Boolean), length };
  }
  // The older ytd-*-video-renderer layout, still served in search and some experiments.
  const data = card.data;
  if (!data?.videoId) return null;
  const details = [data.ownerText ?? data.shortBylineText, data.viewCountText, data.publishedTimeText, data.descriptionSnippet ?? data.detailedMetadataSnippets?.[0]?.snippetText]
    .map(text)
    .filter(Boolean);
  return { id: data.videoId, title: text(data.title), details, length: text(data.lengthText) };
}

export interface AiJudgeHooks {
  /** The channel's subscriber count when it is already known, else null. */
  subscribersOf(card: YtElement): number | null;
  /** The video page's description, tags, category and date ('full' depth). */
  lookUp(videoId: string): Promise<VideoFacts['page']>;
  /** Called when verdicts arrive or the error changes, to redraw the cards. */
  changed(): void;
}

export class AiJudge {
  /** Why judging stopped, shown in the popup; cleared when the settings change. */
  error: string | null = null;
  private verdicts = new Map<string, number>();
  private requested = new Set<string>();
  private waiting = new Map<string, VideoFacts>();
  private inFlight = 0;
  private timer = 0;
  private print = '';
  private depth: Settings['feed']['ai']['depth'] = 'card';
  private threshold = 0.5;

  constructor(private hooks: AiJudgeHooks) {
    document.addEventListener(VERDICTS_EVENT, (event) => this.receive(event as CustomEvent<string>));
  }

  /** Applies the settings; a new service, depth or criteria starts over. */
  configure(ai: Settings['feed']['ai']) {
    this.threshold = STRICTNESS_THRESHOLD[ai.strictness];
    this.depth = ai.depth;
    const print = JSON.stringify([ai.service, ai.depth, ai.criteria.trim() || DEFAULT_CRITERIA]);
    if (print === this.print) return;
    this.print = print;
    this.error = null;
    this.verdicts.clear();
    this.requested.clear();
    this.waiting.clear();
  }

  /** true or false once the card's video has a verdict; null while it waits or is not a video. */
  filter(card: YtElement): boolean | null {
    const facts = factsOf(card);
    if (!facts) return null;
    const verdict = this.verdicts.get(facts.id);
    if (verdict !== undefined) return verdict < this.threshold;
    if (!this.error && !this.requested.has(facts.id)) {
      this.requested.add(facts.id);
      this.waiting.set(facts.id, { ...facts, subscribers: this.hooks.subscribersOf(card) });
      this.scheduleSend();
    }
    return null;
  }

  private scheduleSend() {
    if (this.timer) return;
    this.timer = window.setTimeout(() => {
      this.timer = 0;
      this.send();
    }, COLLECT_MS);
  }

  private send() {
    while (this.inFlight < MAX_IN_FLIGHT && this.waiting.size && !this.error) {
      const batch = [...this.waiting.values()].slice(0, BATCH_SIZE);
      for (const video of batch) this.waiting.delete(video.id);
      this.inFlight++;
      void this.prepare(batch).then((videos) => {
        const request: JudgeRequest = { batchId: `${this.print}\n${crypto.randomUUID()}`, videos };
        document.dispatchEvent(new CustomEvent(JUDGE_EVENT, { detail: JSON.stringify(request) }));
      });
    }
  }

  // In the 'full' depth every video also gets its page's data. A lookup that
  // fails leaves the video with what its card shows.
  private async prepare(batch: VideoFacts[]): Promise<VideoFacts[]> {
    if (this.depth !== 'full') return batch;
    const queue = [...batch];
    const worker = async () => {
      for (let video = queue.shift(); video; video = queue.shift()) {
        try {
          video.page = await this.hooks.lookUp(video.id);
        } catch {}
      }
    };
    await Promise.all(Array.from({ length: MAX_PARALLEL_LOOKUPS }, worker));
    return batch;
  }

  private receive(event: CustomEvent<string>) {
    let response: JudgeResponse;
    try {
      response = JSON.parse(event.detail);
    } catch {
      return;
    }
    const [print] = response.batchId.split('\n');
    this.inFlight = Math.max(0, this.inFlight - 1);
    // An answer to settings that have since changed is dropped.
    if (print !== this.print) return this.send();
    if (response.ok) {
      for (const [id, probability] of Object.entries(response.verdicts)) this.verdicts.set(id, probability);
    } else {
      this.error = response.error;
    }
    this.hooks.changed();
    this.send();
  }
}
