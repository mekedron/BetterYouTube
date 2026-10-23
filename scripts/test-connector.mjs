// Drives docs/connector/host.mjs the way the browser does: one framed request
// per process, framed replies on stdout. Runs `detect`, then a tiny prompt
// through every detected agent, and prints timings and the streamed text.
//
//   node scripts/test-connector.mjs            Claude Code and Codex
//   node scripts/test-connector.mjs gemini     only the named ones
//
// Gemini CLI is left out by default: on macOS each run reads its API key from
// the login keychain, which asks the user for their password.
import { spawn } from 'node:child_process';

const HOST = new URL('../docs/connector/host.mjs', import.meta.url).pathname;

function request(message, onMessage) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [HOST], { stdio: ['pipe', 'pipe', 'inherit'] });
    let buffer = Buffer.alloc(0);
    const messages = [];
    child.stdout.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      while (buffer.length >= 4) {
        const length = buffer.readUInt32LE(0);
        if (buffer.length < 4 + length) break;
        const parsed = JSON.parse(buffer.subarray(4, 4 + length).toString('utf8'));
        buffer = buffer.subarray(4 + length);
        messages.push(parsed);
        onMessage?.(parsed);
      }
    });
    child.on('error', reject);
    // stdin stays open until the host is done: closing it means "cancel".
    child.on('close', (code) => {
      if (buffer.length) reject(new Error('host left a partial frame'));
      else resolve({ code, messages });
    });
    const body = Buffer.from(JSON.stringify(message), 'utf8');
    const header = Buffer.alloc(4);
    header.writeUInt32LE(body.length, 0);
    child.stdin.write(Buffer.concat([header, body]));
  });
}

const only = process.argv.length > 2 ? process.argv.slice(2) : ['claude', 'codex'];
let failed = false;

const t0 = Date.now();
const detected = await request({ type: 'detect' });
const agents = detected.messages[0]?.agents ?? [];
console.log(`detect: ${Date.now() - t0} ms, protocol ${detected.messages[0]?.protocol}`);
for (const a of agents) console.log(`  ${a.id}: ${a.version}`);

for (const agent of agents) {
  if (!only.includes(agent.id)) continue;
  const start = Date.now();
  let first = null;
  let text = '';
  const { messages } = await request(
    {
      type: 'run',
      agent: agent.id,
      model: agent.id === 'claude' ? 'haiku' : '',
      effort: 'low',
      system: 'Answer in one word.',
      prompt: 'Say hi.',
    },
    (m) => {
      if (m.type === 'delta') {
        first ??= Date.now() - start;
        text += m.text;
      }
    },
  );
  const last = messages[messages.length - 1];
  const ok = last?.type === 'done' && text.trim().length > 0;
  if (!ok) failed = true;
  console.log(
    `${agent.id}: ${ok ? 'ok' : 'FAILED'} first chunk ${first ?? '-'} ms, total ${Date.now() - start} ms, ` +
      `text ${JSON.stringify(text.trim())}${last?.type === 'error' ? `, error: ${last.message}` : ''}`,
  );
}

process.exit(failed ? 1 : 0);
