// API keys, per provider. They live in storage.local: they never sync to
// other devices and never reach the YouTube page, which only ever receives
// the synced settings.

const KEY = 'ai-keys';

export async function loadApiKeys(): Promise<Record<string, string>> {
  try {
    return ((await browser.storage.local.get(KEY))[KEY] as Record<string, string> | undefined) ?? {};
  } catch {
    return {};
  }
}

export async function saveApiKey(provider: string, key: string): Promise<void> {
  const keys = await loadApiKeys();
  if (key) keys[provider] = key;
  else delete keys[provider];
  await browser.storage.local.set({ [KEY]: keys });
}
