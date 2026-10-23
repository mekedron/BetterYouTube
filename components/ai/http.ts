import { ProviderError } from './types';

// Shared plumbing for providers that call an HTTP API.

/** Yields the `data:` payloads of a server-sent event stream. */
export async function* readSse(response: Response, signal?: AbortSignal): AsyncIterable<string> {
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += value;
      let end: number;
      while ((end = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const event = buffer.slice(0, end);
        buffer = buffer.slice(end).replace(/^\r?\n\r?\n/, '');
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart())
          .join('\n');
        if (data) yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Throws a ProviderError carrying the API's own message for a failed response. */
export async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message ?? body?.message ?? (typeof body?.error === 'string' ? body.error : '');
  } catch {}
  throw new ProviderError(`${response.status}${detail ? `: ${detail}` : ` ${response.statusText}`}`);
}

/**
 * Posts a request and, when the API rejects it with 400 and an optional
 * setting (such as reasoning effort) was included, retries once without it:
 * models differ in which settings they accept.
 */
export async function postWithFallback(
  url: string,
  init: RequestInit,
  body: object,
  optional: object | null,
): Promise<Response> {
  const send = (payload: object) => fetch(url, { ...init, method: 'POST', body: JSON.stringify(payload) });
  if (!optional) return send(body);
  const first = await send({ ...body, ...optional });
  if (first.status !== 400) return first;
  return send(body);
}

/** A rough token count for APIs without a counting endpoint: about four characters a token. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}
