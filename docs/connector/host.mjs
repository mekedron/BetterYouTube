#!/usr/bin/env node
// BetterYouTube connector: a native messaging host that lets the extension use
// the coding agents already installed on this computer (Claude Code, Codex,
// Gemini CLI) to summarize videos. The protocol is described in
// components/ai/connectorProtocol.ts; keep both sides in sync.
//
// One connection carries one request. Native messaging frames every message
// as a 4-byte little-endian length followed by UTF-8 JSON, on stdin and
// stdout. Nothing but frames may ever reach stdout; diagnostics go to stderr.
//
// The prompt holds an untrusted YouTube transcript, so every agent runs with
// its tools turned off (or, where a CLI cannot turn them all off, read-only),
// in an empty temporary directory.

import { spawn } from 'node:child_process';
import { accessSync, constants, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';

const PROTOCOL = 1;
const AGENTS = ['claude', 'codex', 'gemini'];
const EFFORTS = ['low', 'medium', 'high'];
/** A run that takes longer than this is stopped. */
const RUN_TIMEOUT_MS = 5 * 60 * 1000;
/** A run with no output at all for this long is stopped (e.g. a CLI waiting for a login). */
const SILENCE_TIMEOUT_MS = 90 * 1000;
/** Chrome refuses host messages over 1 MB; deltas are split well below that. */
const MAX_DELTA_CHARS = 64 * 1024;

const log = (...args) => process.stderr.write(`[betteryoutube-connector] ${args.join(' ')}\n`);

// ---- Framing ----

function send(message) {
  const body = Buffer.from(JSON.stringify(message), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32LE(body.length, 0);
  process.stdout.write(Buffer.concat([header, body]));
}

function sendDelta(text) {
  for (let i = 0; i < text.length; i += MAX_DELTA_CHARS) send({ type: 'delta', text: text.slice(i, i + MAX_DELTA_CHARS) });
}

let finished = false;
/** Sends the last message of the connection and exits once stdout has drained. */
function finish(message) {
  if (finished) return;
  finished = true;
  send(message);
  process.stdout.end(() => process.exit(0));
}

function readRequest() {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);
    const onData = (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (buffer.length < 4) return;
      const length = buffer.readUInt32LE(0);
      if (buffer.length < 4 + length) return;
      process.stdin.off('data', onData);
      try {
        resolve(JSON.parse(buffer.subarray(4, 4 + length).toString('utf8')));
      } catch (error) {
        reject(error);
      }
    };
    process.stdin.on('data', onData);
    process.stdin.once('end', () => reject(new Error('no request')));
  });
}

// ---- Finding the agents ----

function findExecutable(name) {
  for (const dir of (process.env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, name);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {}
  }
  return null;
}

/** Runs a short command and returns its stdout, or null on failure or timeout. */
function capture(file, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    let out = '';
    let child;
    try {
      child = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], cwd: tmpdir() });
    } catch {
      resolve(null);
      return;
    }
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve(null);
    }, timeoutMs);
    child.stdout.on('data', (d) => (out += d));
    child.on('error', () => {
      clearTimeout(timer);
      resolve(null);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve(code === 0 ? out : null);
    });
  });
}

async function detect() {
  const agents = [];
  for (const id of AGENTS) {
    const path = findExecutable(id);
    if (!path) continue;
    const version = (await capture(path, ['--version'])) ?? '';
    agents.push({ id, version: version.split('\n').find((l) => l.trim())?.trim() ?? '' });
  }
  return agents;
}

// ---- Running an agent ----

// Codex features that give the model tools. Only the ones this Codex version
// knows are disabled, because Codex rejects an unknown feature name.
const CODEX_TOOL_FEATURES = [
  'shell_tool',
  'unified_exec',
  'apps',
  'browser_use',
  'browser_use_external',
  'computer_use',
  'image_generation',
  'in_app_browser',
  'plugins',
  'view_image',
];

async function codexDisabledFeatures(path) {
  const list = (await capture(path, ['features', 'list'])) ?? '';
  const known = new Set(list.split('\n').map((line) => line.trim().split(/\s+/)[0]));
  return CODEX_TOOL_FEATURES.filter((f) => known.has(f));
}

/**
 * The command line and stdin for one run, plus a parser that turns one line of
 * the CLI's output into text to stream (a string), an error (an Error), or
 * nothing (null).
 */
async function plan(request, path, cwd) {
  const { model, effort, system, prompt } = request;
  const withEffort = EFFORTS.includes(effort);

  if (request.agent === 'claude') {
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--no-session-persistence',
      '--setting-sources', '',
      '--strict-mcp-config',
      '--tools', '',
      '--system-prompt', system,
    ];
    if (model) args.push('--model', model);
    if (withEffort) args.push('--effort', effort);
    return {
      args,
      stdin: prompt,
      parse(event) {
        if (event.type === 'stream_event' && event.event?.type === 'content_block_delta') {
          return event.event.delta?.type === 'text_delta' ? event.event.delta.text : null;
        }
        if (event.type === 'result' && event.is_error) return new Error(String(event.result || 'Claude Code failed'));
        return null;
      },
    };
  }

  if (request.agent === 'codex') {
    // With the tool features off Codex has no shell; the read-only sandbox is
    // a second fence for any tool a newer version adds.
    const args = [
      'exec',
      '--ephemeral',
      '--skip-git-repo-check',
      '--ignore-user-config',
      '--ignore-rules',
      '--sandbox', 'read-only',
      '-C', cwd,
      '--json',
      '-c', 'web_search="disabled"',
    ];
    for (const feature of await codexDisabledFeatures(path)) args.push('--disable', feature);
    if (model) args.push('-m', model);
    if (withEffort) args.push('-c', `model_reasoning_effort="${effort}"`);
    args.push('-');
    return {
      args,
      stdin: `${system}\n\n${prompt}`,
      parse(event) {
        // Items of type 'error' are warnings about the local setup, not failures.
        if (event.type === 'item.completed' && event.item?.type === 'agent_message') return String(event.item.text ?? '');
        if (event.type === 'turn.failed') return new Error(String(event.error?.message || 'Codex failed'));
        if (event.type === 'error') return new Error(String(event.message || 'Codex failed'));
        return null;
      },
    };
  }

  // Gemini CLI has no system prompt flag and no effort flag. Plan mode keeps
  // it read-only; it cannot switch its read tools off.
  const args = ['-p', '', '-o', 'stream-json', '--approval-mode', 'plan', '--skip-trust'];
  if (model) args.push('-m', model);
  return {
    args,
    stdin: `${system}\n\n${prompt}`,
    parse(event) {
      if (event.type === 'message' && event.role === 'assistant') return String(event.content ?? '');
      if (event.type === 'result' && event.status === 'error') return new Error(String(event.error?.message || 'Gemini CLI failed'));
      if (event.type === 'error' && event.severity === 'error') return new Error(String(event.message || 'Gemini CLI failed'));
      return null;
    },
  };
}

async function run(request) {
  if (!AGENTS.includes(request.agent)) return finish({ type: 'error', message: `Unknown agent: ${request.agent}` });
  const path = findExecutable(request.agent);
  if (!path) return finish({ type: 'error', message: `${request.agent} is not installed or not on PATH.` });

  const cwd = mkdtempSync(join(tmpdir(), 'betteryoutube-'));
  const cleanup = () => {
    try {
      rmSync(cwd, { recursive: true, force: true });
    } catch {}
  };

  let child;
  try {
    const { args, stdin, parse } = await plan(request, path, cwd);
    // Each run gets its own process group: some CLIs (Gemini CLI) relaunch
    // themselves in a child process, and only killing the whole group frees
    // the output pipe so the run can end.
    child = spawn(path, args, {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, GEMINI_CLI_NO_RELAUNCH: 'true' },
    });
    const killAll = () => {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        child.kill('SIGKILL');
      }
    };
    let pending = '';
    let stderrTail = '';
    let failure = null;
    let silence;
    const stop = (message) => {
      failure ??= new Error(message);
      killAll();
    };
    const quiet = () => {
      clearTimeout(silence);
      silence = setTimeout(() => stop(`${request.agent} sent nothing for 90 seconds. Check that it works in a terminal.`), SILENCE_TIMEOUT_MS);
    };
    const total = setTimeout(() => stop(`${request.agent} did not finish in 5 minutes.`), RUN_TIMEOUT_MS);
    quiet();

    // The extension closing the port closes stdin; the run is no longer wanted.
    process.stdin.once('end', () => {
      killAll();
      cleanup();
      process.exit(0);
    });

    const handleLine = (line) => {
      if (!line.trim()) return;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        return;
      }
      const result = parse(event);
      if (result instanceof Error) failure ??= result;
      else if (result) sendDelta(result);
    };
    child.stdout.on('data', (chunk) => {
      quiet();
      pending += chunk;
      const lines = pending.split('\n');
      pending = lines.pop() ?? '';
      lines.forEach(handleLine);
    });
    child.stderr.on('data', (chunk) => {
      quiet();
      stderrTail = (stderrTail + chunk).slice(-4000);
    });
    child.on('error', (error) => {
      failure ??= error;
    });
    child.on('close', (code) => {
      clearTimeout(silence);
      clearTimeout(total);
      handleLine(pending);
      cleanup();
      if (!failure && code !== 0) {
        const tail = stderrTail.trim().split('\n').slice(-3).join('\n').slice(-600);
        failure = new Error(`${request.agent} exited with code ${code}${tail ? `: ${tail}` : ''}`);
      }
      finish(failure ? { type: 'error', message: failure.message } : { type: 'done' });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(stdin);
  } catch (error) {
    if (child) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {}
    }
    cleanup();
    finish({ type: 'error', message: error instanceof Error ? error.message : String(error) });
  }
}

// ---- Entry ----

try {
  const request = await readRequest();
  if (request?.type === 'detect') finish({ type: 'agents', protocol: PROTOCOL, agents: await detect() });
  else if (request?.type === 'run') await run(request);
  else finish({ type: 'error', message: `Unknown request: ${request?.type}` });
} catch (error) {
  log(error instanceof Error ? error.message : String(error));
  if (!finished) finish({ type: 'error', message: 'Could not read the request.' });
}
