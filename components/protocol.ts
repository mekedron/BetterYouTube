import type { Settings } from './settings';

// The filter runs in the page's own JavaScript world, because it reads
// YouTube's data models and page config, which the isolated content-script
// world cannot see. The two worlds talk through DOM events on `document`.
// Event details cross worlds only as strings, so every payload is JSON.

/** Bridge -> page: the current config. */
export const CONFIG_EVENT = 'betteryoutube:config';
/** Page -> bridge: the page script started and needs the config. */
export const HELLO_EVENT = 'betteryoutube:hello';
/** Page -> bridge: what the filter is doing in this tab right now. */
export const STATS_EVENT = 'betteryoutube:stats';
/** Bridge -> page: a one-off command from the popup. */
export const COMMAND_EVENT = 'betteryoutube:command';
/** Bridge -> page: a question that expects an answer (see PageRequest). */
export const REQUEST_EVENT = 'betteryoutube:request';
/** Page -> bridge: the answer to a PageRequest, matched by requestId. */
export const RESPONSE_EVENT = 'betteryoutube:response';

/** Texts the page script shows; the bridge localizes them. */
export interface PageStrings {
  /** "{n}" is replaced with the like count. */
  shortHiddenLikes: string;
  shortNoLikes: string;
}

export interface PageConfig {
  settings: Settings;
  strings: PageStrings;
}

export interface TabStats {
  /** Video cards dimmed or hidden on the page right now. */
  filteredCards: number;
  /** Shorts covered in this tab since it was opened. */
  skippedShorts: number;
}

/** What the popup learns about its tab: the stats, and the video on screen. */
export interface TabInfo extends TabStats {
  /** The id of the video on a watch page, else null. */
  videoId: string | null;
}

export type PageCommand = { type: 'clear-channel-cache' };

export type PageRequest = { requestId: string; type: 'get-video-context' };

export type PageResponse =
  | { requestId: string; ok: true; data: VideoContext }
  | { requestId: string; ok: false; error: VideoContextError };

/** What the summary is built from: the video on screen and its transcript. */
export interface VideoContext {
  videoId: string;
  title: string;
  channel: string;
  lengthSeconds: number;
  /** The transcript as plain text, without timestamps. */
  transcript: string;
}

/**
 * Why there is no context: the tab is not on a video, the video has no
 * transcript, or YouTube refused the request.
 */
export type VideoContextError = 'not-a-video' | 'no-transcript' | 'failed';

/** Messages between the popup, the background worker and the bridge. */
export type RuntimeMessage =
  | { type: 'get-tab-stats' }
  | { type: 'tab-stats'; stats: TabStats }
  | { type: 'clear-channel-cache' }
  | { type: 'get-video-context' }
  | { type: 'video-opened'; videoId: string }
  | { type: 'summary-started'; videoId: string };
