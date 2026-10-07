#!/usr/bin/env node
// Render the before/after transcripts of an API test drive into <dir>/report.md.
// Run after verdict.mjs: the verdict's summary.md becomes the top of the report.
//
//   node report.mjs --dir <out>
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const args = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
if (!args.dir) {
  console.error('usage: report.mjs --dir <out>');
  process.exit(2);
}
const dir = resolve(args.dir);
const read = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), 'utf8')) : null);
const before = read('before.result.json');
const after = read('after.result.json');
if (!after) {
  console.error('report: after.result.json is missing');
  process.exit(2);
}
const summary = existsSync(join(dir, 'summary.md')) ? readFileSync(join(dir, 'summary.md'), 'utf8') : '';

function block(step) {
  if (!step) return '_not run_';
  const lines = [];
  if (step.request) {
    lines.push(`> ${step.request.method} ${step.request.path}`);
    for (const [k, v] of Object.entries(step.request.headers ?? {})) lines.push(`> ${k}: ${v}`);
    if (step.request.body !== undefined) {
      lines.push(`> ${typeof step.request.body === 'string' ? step.request.body : JSON.stringify(step.request.body)}`);
    }
  }
  if (step.response) {
    lines.push(`< ${step.response.status} ${step.response.contentType ?? ''} (${step.ms}ms)`);
    lines.push(step.response.body);
  }
  if (step.logs?.trim()) lines.push('', '# server log', step.logs.trimEnd());
  if (step.error) lines.push('', `# FAILED: ${step.error}`);
  return '```\n' + lines.join('\n') + '\n```';
}

const out = ['__BANNER__', summary.trimEnd(), '', '## Transcript', ''];
for (const step of after.steps.length >= (before?.steps.length ?? 0) ? after.steps : before.steps) {
  const b = before?.steps.find((s) => s.id === step.id);
  const a = after.steps.find((s) => s.id === step.id);
  out.push(`### ${step.caption}`, '');
  out.push(`<details><summary>Before: ${b ? b.status : 'n/a'}</summary>`, '', block(b), '', '</details>', '');
  out.push(`<details open><summary>After: ${a ? a.status : 'not run'}</summary>`, '', block(a), '', '</details>', '');
}
// Redaction is best effort. Scan the finished report and say so if anything still looks secret.
// Only line numbers are reported, never the matched text.
const SUSPECT = [
  [/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/, 'JWT'],
  [/\bBearer\s+(?!\[redacted\])\S{8,}/i, 'bearer token'],
  [/\bAKIA[0-9A-Z]{16}\b/, 'AWS access key id'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/[A-Za-z0-9+/_]{32,}={0,2}/, 'long token-like string (may be a hash)'],
];
const body = out.join('\n');
const hits = [];
body.split('\n').forEach((line, i) => {
  for (const [re, what] of SUSPECT) if (re.test(line)) hits.push(`line ${i + 1}: ${what}`);
});
const banner = hits.length
  ? `> **WARNING: this report may still contain secrets.** Review before sharing.\n> ${hits.slice(0, 10).join('; ')}${hits.length > 10 ? `; and ${hits.length - 10} more` : ''}\n`
  : '';
writeFileSync(join(dir, 'report.md'), body.replace('__BANNER__', banner));
if (hits.length) console.error(`report: WARNING possible secrets in report.md (${hits.length} match${hits.length > 1 ? 'es' : ''}), review before sharing`);
console.log(join(dir, 'report.md'));
