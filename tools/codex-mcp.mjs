import { createInterface } from 'node:readline';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, isAbsolute } from 'node:path';

const binary = process.env.CODEX_MCP_BINARY || '/Applications/Codex.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex';
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n');
const tool = {
  name: 'codex',
  description: 'Ask the locally authenticated Codex CLI to analyze or edit a project. Supply the absolute project cwd. Defaults to read-only; select workspace-write for requested edits. Each call starts a fresh session. Commands requiring approval fail instead of bypassing the sandbox.',
  inputSchema: {
    type: 'object', additionalProperties: false, required: ['prompt', 'cwd'],
    properties: {
      prompt: { type: 'string', minLength: 1 },
      cwd: { type: 'string', description: 'Absolute project directory' },
      model: { type: 'string', default: 'gpt-6.1-sol', description: 'Codex model override. Defaults to gpt-6.1-sol rather than the global config.' },
      sandbox: { type: 'string', enum: ['read-only', 'workspace-write'], default: 'read-only' },
    },
  },
};

async function invoke(args, request) {
  if (!args || typeof args.prompt !== 'string' || !args.prompt.trim() || typeof args.cwd !== 'string' || !isAbsolute(args.cwd)) throw new Error('prompt and absolute cwd are required');
  const sandbox = args.sandbox || 'read-only';
  if (!['read-only', 'workspace-write'].includes(sandbox)) throw new Error('Invalid sandbox');
  const model = args.model || 'gpt-6.1-sol';
  if (typeof model !== 'string' || !/^[a-zA-Z0-9._-]+$/.test(model)) throw new Error('Invalid model');
  const temp = await mkdtemp(join(tmpdir(), 'codex-mcp-'));
  const output = join(temp, 'response.txt');
  try {
    let stderr = '';
    const child = spawn(binary, ['--ask-for-approval', 'never', 'exec', '--model', model, '--sandbox', sandbox, '--skip-git-repo-check', '--color', 'never', '--output-last-message', output, '-'], { cwd: args.cwd, stdio: ['pipe', 'ignore', 'pipe'] });
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); });
    child.stdin.on('error', () => {});
    child.stdin.end(args.prompt);
    const token = request.params?._meta?.progressToken;
    let elapsed = 0;
    const progress = setInterval(() => {
      elapsed += 15;
      if (token !== undefined) send({ method: 'notifications/progress', params: { progressToken: token, progress: elapsed, message: 'Codex is working' } });
    }, 15000);
    const timeout = setTimeout(() => child.kill('SIGTERM'), 20 * 60 * 1000);
    let code;
    try {
      code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    } finally { clearInterval(progress); clearTimeout(timeout); }
    const response = await readFile(output, 'utf8').catch(() => '');
    return { content: [{ type: 'text', text: response || stderr || `Codex exited with code ${code}` }], ...(code !== 0 ? { isError: true } : {}) };
  } finally { await rm(temp, { recursive: true, force: true }); }
}

async function handle(request) {
  if (request.id === undefined) return;
  try {
    let result;
    switch (request.method) {
      case 'initialize': result = { protocolVersion: request.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: 'local-codex-cli-bridge', version: '1.0.0' } }; break;
      case 'ping': result = {}; break;
      case 'tools/list': result = { tools: [tool] }; break;
      case 'tools/call':
        if (request.params.name !== 'codex') throw new Error('Unknown tool');
        result = await invoke(request.params.arguments, request); break;
      default: send({ id: request.id, error: { code: -32601, message: 'Method not found' } }); return;
    }
    send({ id: request.id, result });
  } catch (error) { send({ id: request.id, error: { code: -32603, message: error.message } }); }
}
createInterface({ input: process.stdin }).on('line', line => {
  try { void handle(JSON.parse(line)); }
  catch { send({ id: null, error: { code: -32700, message: 'Invalid JSON' } }); }
});
