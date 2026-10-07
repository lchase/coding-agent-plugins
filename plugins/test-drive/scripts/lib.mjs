// Shared by record.mjs (browser) and record-api.mjs (HTTP): argument parsing, scenario
// validation, booting the app under test, and stamping the result so compare can trust it.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

export function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1];
    i++;
  }
  return args;
}

export function fail(msg) {
  console.error(`test-drive: ${msg}`);
  process.exit(2);
}

// Checks the parts both drivers share; validateStep returns driver-specific errors for one step.
export function validateScenario(s, validateStep) {
  const errors = [];
  if (!s || typeof s !== 'object') return ['scenario must be an object'];
  if (!s.name) errors.push('missing "name"');
  if (!s.start?.command) errors.push('missing "start.command"');
  if (!Array.isArray(s.steps) || s.steps.length === 0) errors.push('"steps" must be a non-empty array');
  const ids = new Set();
  for (const [i, st] of (s.steps ?? []).entries()) {
    const where = `steps[${i}]`;
    if (!st.id) errors.push(`${where}: missing "id"`);
    else if (ids.has(st.id)) errors.push(`${where}: duplicate id "${st.id}"`);
    else ids.add(st.id);
    if (!st.caption) errors.push(`${where}: missing "caption"`);
    if (!st.expect) errors.push(`${where}: missing "expect" (every step must assert something)`);
    errors.push(...validateStep(st).map((e) => `${where}: ${e}`));
  }
  return errors;
}

export async function waitForServer(url, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) return `server exited early with code ${child.exitCode}`;
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(2000) });
      if (res.status < 500) return null;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 750));
  }
  return `server not ready at ${url} after ${timeoutMs / 1000}s`;
}

export function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

// Runs install and reset, starts the server with its output in <out>/<side>.server.log, and
// returns the result skeleton. The caller owns stopping the server and filling in the steps.
export function boot({ scenario, scenarioRaw, repoDir, outDir, side, port }) {
  const sub = (s) => s.replaceAll('{{PORT}}', String(port));
  mkdirSync(outDir, { recursive: true });

  for (const key of ['install', 'reset']) {
    if (!scenario.start[key]) continue;
    console.error(`test-drive[${side}]: ${sub(scenario.start[key])}`);
    const r = spawnSync(sub(scenario.start[key]), { cwd: repoDir, shell: true, stdio: 'inherit' });
    if (r.status !== 0) fail(`${key} command failed with status ${r.status}`);
  }

  const logPath = join(outDir, `${side}.server.log`);
  const logFd = openSync(logPath, 'w');
  const server = spawn(sub(scenario.start.command), {
    cwd: join(repoDir, scenario.start.cwd ?? '.'),
    shell: true,
    detached: true,
    env: { ...process.env, PORT: String(port) },
    stdio: ['ignore', logFd, logFd],
  });

  // The baseline is only a baseline if we know what code and scenario it came from.
  // .test-drive/ is excluded so our own artifacts do not make the tree look dirty.
  const git = (...a) => spawnSync('git', a, { cwd: repoDir, encoding: 'utf8' }).stdout?.trim() ?? '';
  const result = {
    side,
    scenario: scenario.name,
    scenarioHash: createHash('sha256').update(scenarioRaw).digest('hex'),
    git: { sha: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--', '.', ':!.test-drive') !== '' },
    port,
    status: 'ok',
    failedStep: null,
    steps: [],
  };
  return {
    server,
    logPath,
    result,
    baseURL: `http://127.0.0.1:${port}`,
    readyURL: `http://127.0.0.1:${port}${scenario.start.readyPath ?? '/'}`,
    readyMs: (scenario.start.readyTimeoutSec ?? 90) * 1000,
  };
}
