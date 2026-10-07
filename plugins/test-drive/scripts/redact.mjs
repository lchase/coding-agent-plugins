// Scrubs secrets from what record-api.mjs stores. Assertions run on the raw values; only
// the transcript (result.json, report.md) is redacted. This is best effort, not a guarantee,
// so report.mjs also scans the finished report and warns about anything that still looks secret.
const SENSITIVE_KEY = /token|secret|pass(word|wd)?|authorization|cookie|api[-_]?key|credential|session|private|signature/i;

const TEXT_PATTERNS = [
  /\bBearer\s+[\w.~+/=-]+/gi,
  /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g, // JWT
  /([\w-]*(?:token|secret|password|passwd|api[_-]?key|authorization))(["']?\s*[=:]\s*["']?)[^\s"'&,;}]+/gi,
];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// extra: the scenario's optional { keys: string[], patterns: string[] }
export function makeRedactor(extra = {}) {
  const keys = (extra.keys ?? []).map(escapeRe);
  const keyRe = keys.length ? new RegExp(`${SENSITIVE_KEY.source}|${keys.join('|')}`, 'i') : SENSITIVE_KEY;
  const patterns = [...TEXT_PATTERNS, ...(extra.patterns ?? []).map((p) => new RegExp(p, 'g'))];

  const text = (s) =>
    patterns.reduce(
      (acc, re) =>
        acc.replace(re, (m, k, sep) => (typeof k === 'string' && typeof sep === 'string' ? `${k}${sep}[redacted]` : '[redacted]')),
      String(s)
    );

  const deep = (v) => {
    if (Array.isArray(v)) return v.map(deep);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, keyRe.test(k) ? '[redacted]' : deep(x)]));
    }
    return typeof v === 'string' ? text(v) : v;
  };

  const body = (s) => {
    try {
      return JSON.stringify(deep(JSON.parse(s)));
    } catch {
      return text(s);
    }
  };

  const headers = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k, keyRe.test(k) ? '[redacted]' : text(v)]));

  return { text, deep, body, headers };
}
