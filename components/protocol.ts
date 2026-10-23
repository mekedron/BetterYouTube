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

export type PageCommand = { type: 'clear-channel-cache' };

/** Messages between the popup, the background worker and the bridge. */
export type RuntimeMessage =
  | { type: 'get-tab-stats' }
  | { type: 'tab-stats'; stats: TabStats }
  | { type: 'clear-channel-cache' };
