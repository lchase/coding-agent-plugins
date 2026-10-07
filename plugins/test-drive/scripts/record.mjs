#!/usr/bin/env node
// Drive one scenario against one checkout and record it as video with Playwright.
// "before" is recorded by the baseline skill before the change is made, "after" by the
// compare skill once it is done. Both run against the working tree, never at the same time.
//
//   node record.mjs --scenario s.json --repo <dir> --side before|after --out <dir> [--port 4100]
//
// Writes <out>/<side>.webm and <out>/<side>.result.json. Exit codes:
//   0  a video and result were produced (the scenario itself may still have failed, read result.json)
//   2  infrastructure failure (bad scenario, server never became ready, Playwright missing)
//
// Captions and the BEFORE/AFTER badge are injected into the page, so they are burned into
// the recording without any ffmpeg text filter.
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, renameSync, openSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ACTIONS = new Set(['goto', 'click', 'fill', 'press', 'select', 'wait', 'waitFor']);

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    args[argv[i].slice(2)] = argv[i + 1];
    i++;
  }
  return args;
}

function fail(msg) {
  console.error(`record: ${msg}`);
  process.exit(2);
}

function validateScenario(s) {
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
    if (!ACTIONS.has(st.action)) errors.push(`${where}: unknown action "${st.action}"`);
    if (['click', 'fill', 'select', 'waitFor'].includes(st.action) && !st.selector) {
      errors.push(`${where}: action "${st.action}" needs "selector"`);
    }
    if (!st.caption) errors.push(`${where}: missing "caption"`);
    if (!st.expect) errors.push(`${where}: missing "expect" (every step must assert something)`);
  }
  return errors;
}

async function loadPlaywright(dirs) {
  for (const dir of dirs) {
    try {
      const resolved = createRequire(join(dir, 'noop.js')).resolve('playwright');
      const mod = await import(pathToFileURL(resolved).href);
      const chromium = mod.chromium ?? mod.default?.chromium;
      if (chromium) return chromium;
    } catch {
      // try the next location
    }
  }
  fail(
    'Playwright not found. In the repo under test run `npm i -D playwright` and ' +
      '`npx playwright install chromium`, or install it next to this script.'
  );
}

async function waitForServer(url, child, timeoutMs) {
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

function stopServer(child) {
  if (!child || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    child.kill('SIGTERM');
  }
}

async function check(page, expect, timeout) {
  if (expect.visible) await page.locator(expect.visible).first().waitFor({ state: 'visible', timeout });
  if (expect.absent) await page.locator(expect.absent).first().waitFor({ state: 'hidden', timeout });
  if (expect.text) {
    await page
      .locator(expect.text.selector)
      .filter({ hasText: expect.text.contains })
      .first()
      .waitFor({ state: 'visible', timeout });
  }
  if (expect.url) await page.waitForURL((u) => u.toString().includes(expect.url), { timeout });
}

async function runStep(page, step, baseURL, timeout) {
  switch (step.action) {
    case 'goto':
      await page.goto(new URL(step.path ?? '/', baseURL).toString(), { waitUntil: 'load', timeout });
      break;
    case 'click':
      await page.locator(step.selector).first().click({ timeout });
      break;
    case 'fill':
      await page.locator(step.selector).first().fill(step.value ?? '', { timeout });
      break;
    case 'select':
      await page.locator(step.selector).first().selectOption(step.value, { timeout });
      break;
    case 'press':
      await page.locator(step.selector ?? 'body').first().press(step.value, { timeout });
      break;
    case 'wait':
      await page.waitForTimeout(step.ms ?? 1000);
      break;
    case 'waitFor':
      await page.locator(step.selector).first().waitFor({ state: 'visible', timeout });
      break;
  }
  if (step.expect) await check(page, step.expect, timeout);
}

async function setCaption(page, text, isError = false) {
  try {
    await page.evaluate(
      ({ text, isError }) => {
        let el = document.getElementById('__td_caption');
        if (!el) {
          el = document.createElement('div');
          el.id = '__td_caption';
          el.style.cssText =
            'position:fixed;left:0;right:0;bottom:0;z-index:2147483647;padding:12px 20px;' +
            'font:500 18px system-ui,sans-serif;color:#fff;text-align:center;pointer-events:none;';
          document.documentElement.appendChild(el);
        }
        el.style.background = isError ? 'rgba(185,28,28,0.92)' : 'rgba(17,24,39,0.88)';
        el.textContent = text;
      },
      { text, isError }
    );
  } catch {
    // page is mid-navigation, the next step will set it again
  }
}

const badgeInit = ({ label, color }) => {
  const mount = () => {
    if (!document.documentElement || document.getElementById('__td_badge')) return;
    const b = document.createElement('div');
    b.id = '__td_badge';
    b.textContent = label;
    b.style.cssText =
      'position:fixed;top:12px;left:12px;z-index:2147483647;padding:6px 12px;border-radius:6px;' +
      `font:700 14px system-ui,sans-serif;color:#fff;background:${color};pointer-events:none;`;
    document.documentElement.appendChild(b);
  };
  mount();
  document.addEventListener('DOMContentLoaded', mount);
};

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const k of ['scenario', 'repo', 'side', 'out']) if (!args[k]) fail(`missing --${k}`);
  if (!['before', 'after'].includes(args.side)) fail('--side must be before or after');

  const repoDir = resolve(args.repo);
  const outDir = resolve(args.out);
  const port = Number(args.port ?? 4100);
  const scenarioRaw = readFileSync(resolve(args.scenario), 'utf8');
  const scenario = JSON.parse(scenarioRaw);
  const errors = validateScenario(scenario);
  if (errors.length) fail(`invalid scenario:\n  ${errors.join('\n  ')}`);
  mkdirSync(outDir, { recursive: true });

  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const chromium = await loadPlaywright([repoDir, scriptDir, process.cwd()]);

  const sub = (s) => s.replaceAll('{{PORT}}', String(port));
  const baseURL = `http://127.0.0.1:${port}`;
  const timeout = scenario.stepTimeoutMs ?? 8000;
  const viewport = scenario.viewport ?? { width: 1280, height: 720 };
  const side = args.side;
  const logPath = join(outDir, `${side}.server.log`);

  if (scenario.start.install) {
    console.error(`record[${side}]: ${sub(scenario.start.install)}`);
    const r = spawnSync(sub(scenario.start.install), { cwd: repoDir, shell: true, stdio: 'inherit' });
    if (r.status !== 0) fail(`install command failed with status ${r.status}`);
  }

  if (scenario.start.reset) {
    console.error(`record[${side}]: ${sub(scenario.start.reset)}`);
    const r = spawnSync(sub(scenario.start.reset), { cwd: repoDir, shell: true, stdio: 'inherit' });
    if (r.status !== 0) fail(`reset command failed with status ${r.status}`);
  }

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
  let browser;
  try {
    const notReady = await waitForServer(
      baseURL + (scenario.start.readyPath ?? '/'),
      server,
      (scenario.start.readyTimeoutSec ?? 90) * 1000
    );
    // throw (not fail) so the finally block still stops the server
    if (notReady) throw new Error(`${notReady} (see ${logPath})`);

    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport,
      recordVideo: { dir: join(outDir, `${side}-raw`), size: viewport },
    });
    await context.addInitScript(badgeInit, {
      label: side === 'before' ? 'BEFORE' : 'AFTER',
      color: side === 'before' ? '#b45309' : '#15803d',
    });
    const page = await context.newPage();
    const started = Date.now();

    for (const step of scenario.steps) {
      const t0 = Date.now();
      try {
        await runStep(page, step, baseURL, timeout);
        await setCaption(page, step.caption);
        await page.waitForTimeout(step.holdMs ?? 1200);
        result.steps.push({ id: step.id, caption: step.caption, status: 'ok', ms: Date.now() - t0 });
      } catch (err) {
        const msg = String(err?.message ?? err).split('\n')[0];
        result.steps.push({ id: step.id, caption: step.caption, status: 'failed', ms: Date.now() - t0, error: msg });
        result.status = 'failed';
        result.failedStep = step.id;
        await setCaption(page, `Step failed: ${step.caption}`, true);
        await page.waitForTimeout(2000);
        break;
      }
    }

    result.durationMs = Date.now() - started;
    const video = page.video();
    await context.close();
    const rawPath = await video.path();
    renameSync(rawPath, join(outDir, `${side}.webm`));
  } finally {
    if (browser) await browser.close().catch(() => {});
    stopServer(server);
  }

  writeFileSync(join(outDir, `${side}.result.json`), JSON.stringify(result, null, 2) + '\n');
  console.error(`record[${side}]: ${result.status}${result.failedStep ? ` at ${result.failedStep}` : ''}`);
}

main().catch((err) => fail(String(err?.message ?? err)));
