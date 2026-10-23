// Messages between the extension and the BetterYouTube connector: a small
// native-messaging host the viewer installs once to let the extension use the
// coding agents already on their computer (Claude Code, Codex, Gemini CLI).
// The host lives in docs/connector/host.mjs; keep both sides in sync.
//
// Each request opens its own native port. The extension sends one request;
// the host answers with one or more messages and closes the port after the
// last one ('agents', 'done' or 'error').

/** The native messaging host name registered by the installer. */
export const CONNECTOR_HOST = 'dev.mekedron.betteryoutube';

/** Bumped when a message changes shape; the popup asks for a reinstall when it differs. */
export const CONNECTOR_PROTOCOL = 1;

export type AgentId = 'claude' | 'codex' | 'gemini';

export type ConnectorRequest =
  /** Which agents are installed. */
  | { type: 'detect' }
  /**
   * Runs one prompt through an agent with all its tools turned off and
   * streams the reply. `prompt` already holds the whole conversation.
   */
  | {
      type: 'run';
      agent: AgentId;
      /** Model id or alias the agent's CLI accepts; empty for the CLI's default. */
      model: string;
      /** 'default' leaves the CLI's own setting. */
      effort: 'default' | 'low' | 'medium' | 'high';
      system: string;
      prompt: string;
    };

export interface DetectedAgent {
  id: AgentId;
  /** First line of `<cli> --version`. */
  version: string;
}

export type ConnectorMessage =
  | { type: 'agents'; protocol: number; agents: DetectedAgent[] }
  /** A piece of the reply, in order. */
  | { type: 'delta'; text: string }
  | { type: 'done' }
  | { type: 'error'; message: string };
