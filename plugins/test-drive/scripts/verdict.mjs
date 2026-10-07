#!/usr/bin/env node
// Deterministic verdict for a test drive. No model involved.
//
//   node verdict.mjs --scenario s.json --dir <out> [--repo <dir>]
//
// --repo enables the check that the baseline commit is an ancestor of HEAD.
// Reads <dir>/before.result.json (optional) and <dir>/after.result.json, writes
// <dir>/summary.md, prints it, and exits:
//   0 PASS   1 FAIL   3 WARN   2 error
//
// The scenario asserts the INTENDED behavior (what should be true after the change).
// "expectBefore" says what the baseline should do with it:
//   fail  feature or bugfix: the baseline should break at the changed step
//   pass  refactor or regression guard: the baseline should behave the same
//   any   no expectation (default)
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 2) args[argv[i].replace(/^--/, '')] = argv[i + 1];
  return args;
}

const args = parseArgs(process.argv.slice(2));
if (!args.scenario || !args.dir) {
  console.error('usage: verdict.mjs --scenario <file> --dir <out>');
  process.exit(2);
}

const dir = resolve(args.dir);
const scenario = JSON.parse(readFileSync(resolve(args.scenario), 'utf8'));
const read = (side) => {
  const p = join(dir, `${side}.result.json`);
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
};
const before = read('before');
const after = read('after');
if (!after) {
  console.error('verdict: after.result.json is missing');
  process.exit(2);
}

// A baseline from a different scenario is not a baseline. Refuse rather than compare.
if (before && before.scenarioHash !== after.scenarioHash) {
  console.error('verdict: the scenario changed since the baseline was recorded. Re-record the baseline.');
  process.exit(2);
}

const expectBefore = scenario.expectBefore ?? 'any';
const notes = [];
const caveats = [];
let verdict = 'PASS';

if (before?.git?.dirty) {
  caveats.push('The baseline was recorded on a dirty tree, so it may already include part of the change.');
}
if (before?.git?.sha && args.repo) {
  const r = spawnSync('git', ['merge-base', '--is-ancestor', before.git.sha, 'HEAD'], { cwd: resolve(args.repo) });
  if (r.status !== 0) caveats.push(`The baseline commit ${before.git.sha.slice(0, 7)} is not an ancestor of HEAD, so the two runs may not be of the same work.`);
}

if (after.status !== 'ok') {
  verdict = 'FAIL';
  notes.push(`After the change, the scenario fails at step "${after.failedStep}". The change does not do what the scenario asserts.`);
} else if (!before) {
  verdict = 'WARN';
  notes.push('No before recording, so the baseline was not compared.');
} else if (expectBefore === 'fail' && before.status === 'ok') {
  verdict = 'WARN';
  notes.push('The baseline also passes. The scenario may not exercise the change, or the bug is not reproduced.');
} else if (expectBefore === 'pass' && before.status !== 'ok') {
  verdict = 'WARN';
  notes.push(`The baseline already fails at step "${before.failedStep}", so this is not a regression from the change.`);
} else if (expectBefore === 'fail') {
  notes.push(`The baseline fails at step "${before.failedStep}" and the change fixes it, as expected.`);
} else if (expectBefore === 'pass') {
  notes.push('The baseline and the change behave the same, as expected.');
}

if (verdict === 'PASS' && caveats.length) verdict = 'WARN';
notes.push(...caveats);

const cell = (r, id) => {
  if (!r) return 'n/a';
  const s = r.steps.find((x) => x.id === id);
  return s ? (s.status === 'ok' ? 'ok' : 'FAILED') : 'not run';
};

const lines = [
  `## Test drive: ${scenario.name}`,
  '',
  `**Verdict: ${verdict}** (expectBefore: ${expectBefore})`,
  '',
  ...notes.map((n) => `- ${n}`),
  '',
  '| Step | Before | After |',
  '|---|---|---|',
  ...scenario.steps.map((s) => `| ${s.caption} | ${cell(before, s.id)} | ${cell(after, s.id)} |`),
  '',
];
const md = lines.join('\n');
writeFileSync(join(dir, 'summary.md'), md);
console.log(md);
process.exit({ PASS: 0, FAIL: 1, WARN: 3 }[verdict]);
