#!/usr/bin/env node
// Drive one API scenario against one checkout over HTTP and record what happened.
// The backend counterpart of record.mjs: no browser and no screen recording, so each step's
// request, response, and the server log lines it produced are the "video".
//
//   node record-api.mjs --scenario s.json --repo <dir> --side before|after --out <dir> [--port 4100]
//
// Writes <out>/<side>.result.json (steps carry the transcript) and <out>/<side>.server.log.
// Exit codes: 0 a result was produced (the scenario may still have failed), 2 infrastructure
// failure (bad scenario, server never became ready).
import { readFileSync, writeFileSync, statSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { parseArgs, fail, validateScenario, waitForServer, stopServer, boot } from './lib.mjs';

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);
const SECRET_HEADER = /^(authorization|cookie|x-api-key)$/i;
const MAX_STORED = 4000;

const validateStep = (st) => {
  const errors = [];
  if (!METHODS.has(st.method)) errors.push(`unknown method "${st.method}"`);
  if (typeof st.path !== 'string' || !st.path.startsWith('/')) errors.push('"path" must start with /');
  return errors;
};

const trunc = (s) => (s.length > MAX_STORED ? `${s.slice(0, MAX_STORED)}\n...[truncated ${s.length - MAX_STORED} chars]` : s);
const redact = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, SECRET_HEADER.test(k) ? '[redacted]' : v]));

function readFrom(path, offset) {
  const size = statSync(path).size;
  if (size <= offset) return '';
  const buf = Buffer.alloc(size - offset);
  const fd = openSync(path, 'r');
  readSync(fd, buf, 0, buf.length, offset);
  closeSync(fd);
  return buf.toString('utf8');
}

function check(expect, { status, text, logs }) {
  if (expect.status !== undefined && status !== expect.status) throw new Error(`expected status ${expect.status}, got ${status}`);
  if (expect.bodyContains && !text.includes(expect.bodyContains)) throw new Error(`body does not contain "${expect.bodyContains}"`);
  if (expect.json) {
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      throw new Error('response body is not JSON');
    }
    for (const [path, want] of Object.entries(expect.json)) {
      const got = path.split('.').reduce((o, k) => o?.[k], body);
      if (JSON.stringify(got) !== JSON.stringify(want)) {
        throw new Error(`json ${path}: expected ${JSON.stringify(want)}, got ${JSON.stringify(got)}`);
      }
    }
  }
  if (expect.logContains && !logs.includes(expect.logContains)) throw new Error(`server log does not contain "${expect.logContains}"`);
  if (expect.logAbsent && logs.includes(expect.logAbsent)) throw new Error(`server log contains "${expect.logAbsent}"`);
}

async function runStep(step, baseURL, timeout, settleMs, logPath) {
  const offset = statSync(logPath).size;
  const headers = { ...step.headers };
  let body;
  if (step.body !== undefined) {
    body = typeof step.body === 'string' ? step.body : JSON.stringify(step.body);
    if (!Object.keys(headers).some((k) => k.toLowerCase() === 'content-type')) headers['content-type'] = 'application/json';
  }
  const record = { request: { method: step.method, path: step.path, headers: redact(headers), body: step.body } };
  const t0 = Date.now();
  const res = await fetch(new URL(step.path, baseURL), {
    method: step.method,
    headers,
    body,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeout),
  });
  const text = await res.text();
  record.ms = Date.now() - t0;
  // Give the server a moment to flush the log lines this request caused.
  await new Promise((r) => setTimeout(r, settleMs));
  const logs = readFrom(logPath, offset);
  record.response = { status: res.status, contentType: res.headers.get('content-type'), body: trunc(text) };
  record.logs = trunc(logs);
  return { record, observed: { status: res.status, text, logs } };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const k of ['scenario', 'repo', 'side', 'out']) if (!args[k]) fail(`missing --${k}`);
  if (!['before', 'after'].includes(args.side)) fail('--side must be before or after');

  const repoDir = resolve(args.repo);
  const outDir = resolve(args.out);
  const port = Number(args.port ?? 4100);
  const scenarioRaw = readFileSync(resolve(args.scenario), 'utf8');
  const scenario = JSON.parse(scenarioRaw);
  if (scenario.kind !== 'api') fail('scenario "kind" must be "api" (use record.mjs for UI scenarios)');
  const errors = validateScenario(scenario, validateStep);
  if (errors.length) fail(`invalid scenario:\n  ${errors.join('\n  ')}`);

  const timeout = scenario.stepTimeoutMs ?? 8000;
  const settleMs = scenario.logSettleMs ?? 250;
  const side = args.side;
  const { server, logPath, result, baseURL, readyURL, readyMs } = boot({ scenario, scenarioRaw, repoDir, outDir, side, port });

  try {
    const notReady = await waitForServer(readyURL, server, readyMs);
    // throw (not fail) so the finally block still stops the server
    if (notReady) throw new Error(`${notReady} (see ${logPath})`);

    const started = Date.now();
    for (const step of scenario.steps) {
      const entry = { id: step.id, caption: step.caption };
      let observed;
      try {
        const r = await runStep(step, baseURL, timeout, settleMs, logPath);
        Object.assign(entry, r.record);
        observed = r.observed;
        check(step.expect, observed);
        entry.status = 'ok';
      } catch (err) {
        entry.status = 'failed';
        entry.error = String(err?.message ?? err).split('\n')[0];
        result.status = 'failed';
        result.failedStep = step.id;
      }
      result.steps.push(entry);
      // Later steps depend on earlier state, so stop at the first failure like the UI driver.
      if (entry.status === 'failed') break;
    }
    result.durationMs = Date.now() - started;
  } finally {
    stopServer(server);
  }

  writeFileSync(join(outDir, `${side}.result.json`), JSON.stringify(result, null, 2) + '\n');
  console.error(`record-api[${side}]: ${result.status}${result.failedStep ? ` at ${result.failedStep}` : ''}`);
}

main().catch((err) => fail(String(err?.message ?? err)));
