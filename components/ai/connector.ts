import { CONNECTOR_HOST, CONNECTOR_PROTOCOL } from './connectorProtocol';
import type { AgentId, ConnectorMessage, ConnectorRequest, DetectedAgent } from './connectorProtocol';
import { HistorySession } from './historySession';
import type { StreamReply } from './historySession';
import { ProviderError } from './types';
import type { AiProvider, ChatTurn, ProviderConfig, ProviderStatus } from './types';

// The coding agents on the viewer's computer, reached through the connector
// (native messaging). The browser lets the extension talk to the connector
// only after the viewer grants the optional "nativeMessaging" permission, and
// only once the connector is installed.

export const INSTALL_COMMAND = 'curl -fsSL https://mekedron.github.io/BetterYouTube/connector/install.sh | sh';

/** The Chrome Web Store copy, which the connector allows without being told. */
const STORE_ID = 'dbbghiihkgjghkgbhflpnhajdbfpgnag';

/**
 * The install command for this copy of the extension. A copy loaded from a
 * folder has its own id, and the connector answers only the ids it was
 * installed for, so the command names it.
 */
export function installCommand(): string {
  const id = browser.runtime.id;
  return /^[a-p]{32}$/.test(id) && id !== STORE_ID ? `${INSTALL_COMMAND} -s -- --extension-id ${id}` : INSTALL_COMMAND;
}

/** Agents' context windows are large; this keeps requests reasonable. */
const CONTEXT_TOKENS = 150_000;

const PERMISSION = { permissions: ['nativeMessaging' as const] };

export function hasConnectorPermission(): Promise<boolean> {
  return browser.permissions.contains(PERMISSION).catch(() => false);
}

/** Asks for the permission; must run inside a click handler. */
export function requestConnectorPermission(): Promise<boolean> {
  return browser.permissions.request(PERMISSION).catch(() => false);
}

/** One request on its own native port; yields every message the connector sends. */
async function* talk(request: ConnectorRequest, signal?: AbortSignal): AsyncIterable<ConnectorMessage> {
  const port = browser.runtime.connectNative(CONNECTOR_HOST);
  const queue: ConnectorMessage[] = [];
  let wake: (() => void) | null = null;
  let closed: string | null = null;
  port.onMessage.addListener((message: ConnectorMessage) => {
    queue.push(message);
    wake?.();
  });
  port.onDisconnect.addListener(() => {
    closed = browser.runtime.lastError?.message ?? (port as { error?: { message: string } }).error?.message ?? '';
    wake?.();
  });
  const abort = () => port.disconnect();
  signal?.addEventListener('abort', abort);
  try {
    port.postMessage(request);
    for (;;) {
      if (queue.length) {
        const message = queue.shift()!;
        yield message;
        if (message.type === 'agents' || message.type === 'done' || message.type === 'error') return;
        continue;
      }
      if (closed !== null) {
        // Chrome says "Specified native messaging host not found." or, for an
        // extension the connector does not list, "Access to the specified
        // native messaging host is forbidden."; Firefox says "No such native
        // application".
        if (/forbidden/i.test(closed)) throw new ProviderError('connector-forbidden');
        throw new ProviderError(/not found|no such native/i.test(closed) ? 'connector-missing' : closed || 'connector-closed');
      }
      await new Promise<void>((resolve) => (wake = resolve));
      wake = null;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    try {
      port.disconnect();
    } catch {}
  }
}

export type Detection =
  | { ok: true; agents: DetectedAgent[] }
  | { ok: false; reason: 'no-permission' | 'not-installed' | 'not-allowed' | 'outdated' | 'failed'; message?: string };

let cached: Promise<Detection> | null = null;

/** Which agents the connector finds; remembered for the life of the popup. */
export function detectAgents(refresh = false): Promise<Detection> {
  if (!cached || refresh) cached = detect();
  return cached;
}

async function detect(): Promise<Detection> {
  if (!(await hasConnectorPermission())) return { ok: false, reason: 'no-permission' };
  try {
    for await (const message of talk({ type: 'detect' })) {
      if (message.type === 'agents') {
        if (message.protocol !== CONNECTOR_PROTOCOL) return { ok: false, reason: 'outdated' };
        return { ok: true, agents: message.agents };
      }
      if (message.type === 'error') return { ok: false, reason: 'failed', message: message.message };
    }
  } catch (e) {
    if (e instanceof ProviderError && e.message === 'connector-missing') return { ok: false, reason: 'not-installed' };
    if (e instanceof ProviderError && e.message === 'connector-forbidden') return { ok: false, reason: 'not-allowed' };
    return { ok: false, reason: 'failed', message: e instanceof Error ? e.message : String(e) };
  }
  return { ok: false, reason: 'failed' };
}

// The CLIs take one prompt, so a follow-up carries the conversation as text.
function asPrompt(turns: ChatTurn[]): string {
  if (turns.length === 1) return turns[0].content;
  const lines = turns.map((t) => `${t.role === 'user' ? 'User' : 'Assistant'}:\n${t.content}`);
  return `${lines.join('\n\n')}\n\nReply to the last user message.`;
}

const stream =
  (c: ProviderConfig): StreamReply =>
  async function* (system, turns, signal) {
    const request: ConnectorRequest = {
      type: 'run',
      agent: c.agent,
      model: c.model,
      effort: c.effort,
      system,
      prompt: asPrompt(turns),
    };
    for await (const message of talk(request, signal)) {
      if (message.type === 'delta') yield message.text;
      if (message.type === 'error') throw new ProviderError(message.message);
    }
  };

/** Model names each agent's CLI accepts as shortcuts; any other id can be typed in. */
export const AGENT_MODELS: Record<AgentId, string[]> = {
  claude: ['haiku', 'sonnet', 'opus'],
  codex: [],
  gemini: [],
};

export const connector: AiProvider = {
  id: 'agent',
  languages: null,
  needsKey: false,
  async status(_language, config): Promise<ProviderStatus> {
    const found = await detectAgents();
    return found.ok && found.agents.some((a) => a.id === config.agent) ? 'ready' : 'needs-setup';
  },
  async createSession(options) {
    return new HistorySession(options.system, options.history, stream(options.config), CONTEXT_TOKENS);
  },
};
