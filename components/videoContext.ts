import type { PageResponse, VideoContext } from './protocol';

// Reads the video on the watch page and its transcript. Runs in YouTube's
// page world, next to the filter, because it needs the player object and the
// page's innertube config.

interface PlayerDetails {
  videoId?: string;
  title?: string;
  author?: string;
  lengthSeconds?: string;
}

type Player = Element & { getPlayerResponse?: () => { videoDetails?: PlayerDetails } | undefined };

function currentVideoId(): string | null {
  if (location.pathname !== '/watch') return null;
  return new URLSearchParams(location.search).get('v');
}

// The "Show transcript" button sends the transcript panel's id and this
// parameter: a protobuf message that holds only the video id (field 149 ->
// field 1 = id, field 3 = 1). Building it from the id avoids depending on
// where YouTube keeps the button in the page data.
function transcriptParams(videoId: string): string {
  const id = [...videoId].map((c) => c.charCodeAt(0));
  const inner = [0x0a, id.length, ...id, 0x18, 0x01];
  const outer = [0xaa, 0x09, inner.length, ...inner];
  return btoa(String.fromCharCode(...outer));
}

async function fetchTranscript(videoId: string): Promise<string | null> {
  const cfg = (window as unknown as { ytcfg?: { data_?: Record<string, any> } }).ytcfg?.data_;
  if (!cfg?.INNERTUBE_CONTEXT) return null;
  const res = await fetch('/youtubei/v1/get_panel?prettyPrint=false', {
    method: 'POST',
    credentials: 'same-origin',
    headers: {
      'content-type': 'application/json',
      'x-youtube-client-name': String(cfg.INNERTUBE_CONTEXT_CLIENT_NAME ?? 1),
      'x-youtube-client-version': String(cfg.INNERTUBE_CONTEXT_CLIENT_VERSION ?? ''),
    },
    body: JSON.stringify({
      context: cfg.INNERTUBE_CONTEXT,
      panelId: 'PAmodern_transcript_view',
      params: transcriptParams(videoId),
    }),
  });
  if (!res.ok) return null;
  const lines: string[] = [];
  collectSegments(await res.json(), lines, 0);
  return lines.length ? lines.join(' ').replace(/\s+/g, ' ').trim() : null;
}

function collectSegments(node: any, out: string[], depth: number) {
  if (!node || typeof node !== 'object' || depth > 40) return;
  const text = node.transcriptSegmentViewModel?.simpleText;
  if (typeof text === 'string') {
    out.push(text);
    return;
  }
  for (const value of Object.values(node)) collectSegments(value, out, depth + 1);
}

export async function readVideoContext(requestId: string): Promise<PageResponse> {
  const videoId = currentVideoId();
  if (!videoId) return { requestId, ok: false, error: 'not-a-video' };
  const details = (document.querySelector('#movie_player') as Player | null)?.getPlayerResponse?.()?.videoDetails;
  // While YouTube swaps videos, the player can still describe the previous one.
  const fresh = details?.videoId === videoId ? details : undefined;
  let transcript: string | null;
  try {
    transcript = await fetchTranscript(videoId);
  } catch {
    return { requestId, ok: false, error: 'failed' };
  }
  if (!transcript) return { requestId, ok: false, error: 'no-transcript' };
  const context: VideoContext = {
    videoId,
    title: fresh?.title || document.title.replace(/ - YouTube$/, ''),
    channel: fresh?.author || '',
    lengthSeconds: Number(fresh?.lengthSeconds) || 0,
    transcript,
  };
  return { requestId, ok: true, data: context };
}
