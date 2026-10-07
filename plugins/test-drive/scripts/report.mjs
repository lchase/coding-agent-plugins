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

const out = [summary.trimEnd(), '', '## Transcript', ''];
for (const step of after.steps.length >= (before?.steps.length ?? 0) ? after.steps : before.steps) {
  const b = before?.steps.find((s) => s.id === step.id);
  const a = after.steps.find((s) => s.id === step.id);
  out.push(`### ${step.caption}`, '');
  out.push(`<details><summary>Before: ${b ? b.status : 'n/a'}</summary>`, '', block(b), '', '</details>', '');
  out.push(`<details open><summary>After: ${a ? a.status : 'not run'}</summary>`, '', block(a), '', '</details>', '');
}
writeFileSync(join(dir, 'report.md'), out.join('\n'));
console.log(join(dir, 'report.md'));
