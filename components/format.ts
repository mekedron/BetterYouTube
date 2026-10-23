type MessageKey = Parameters<typeof browser.i18n.getMessage>[0];

export function t(key: MessageKey, n?: number): string {
  const message = browser.i18n.getMessage(key) || key;
  return n === undefined ? message : message.replace('{n}', formatCount(n));
}

const compact = new Intl.NumberFormat(browser.i18n.getUILanguage(), {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export function formatCount(n: number): string {
  return compact.format(n);
}

/** Slider stops for view and subscriber thresholds. */
export const AUDIENCE_STEPS = [
  1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000, 2_000_000, 5_000_000,
];

/** Slider stops for the Shorts like threshold. */
export const LIKE_STEPS = [10, 50, 100, 200, 500, 1_000, 2_000, 5_000, 10_000, 20_000, 50_000, 100_000];
