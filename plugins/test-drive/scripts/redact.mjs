// Scrubs secrets from what record-api.mjs stores. Assertions run on the raw values; only
// the transcript (result.json, report.md) is redacted. This is best effort, not a guarantee,
// so report.mjs also scans the finished report and warns about anything that still looks secret.
//
// Known limit: an UNQUOTED value after "=" ends at whitespace (logfmt, query strings, forms
// all work that way), so `password=two words` leaves the second word. Quote it or add a
// scenario `redact.patterns` entry. Header-style `key: value` text is redacted to end of line.
const SENSITIVE_KEY = /token|secret|pass(?:word|wd)?|authorization|cookie|api[-_]?key|credential|session|private|signature/i;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Header lines in logs or raw text: everything after the colon is the credential.
const HEADER_LINE = /\b((?:proxy-)?authorization|set-cookie|cookie)([ \t]*[:=][ \t]*)[^\r\n]*/gi;
const SCHEME_CREDENTIAL = /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const JWT = /\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/g;
const URL_USERINFO = /(\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]*:)[^\s/@]+(@)/gi;

// Index just past the quoted string starting at s[i].
function quotedEnd(s, i) {
  const q = s[i];
  for (let j = i + 1; j < s.length; j++) {
    if (s[j] === '\\') j++;
    else if (s[j] === q) return j + 1;
  }
  return s.length;
}

// Index just past the value that starts at s[i], given the separator that preceded it.
function valueEnd(s, i, sep) {
  const c = s[i];
  if (c === '"' || c === "'") return quotedEnd(s, i);
  if (c === '{' || c === '[') {
    let depth = 0;
    for (let j = i; j < s.length; j++) {
      const d = s[j];
      if (d === '"' || d === "'") j = quotedEnd(s, j) - 1;
      else if (d === '{' || d === '[') depth++;
      else if (d === '}' || d === ']') if (--depth === 0) return j + 1;
    }
    return s.length;
  }
  // Unquoted. "=" is logfmt, query string, or form; a quote before the colon is JSON-ish;
  // a plain colon is header or YAML style, where the value runs to end of line.
  const stop = sep.includes('=') ? /[\s&;]/ : /["']/.test(sep) ? /[\s,}\]]/ : /\r?\n/;
  const m = stop.exec(s.slice(i));
  return m ? i + m.index : s.length;
}

// Replaces the whole value after every sensitive key, however it is written.
function scrubKeyValues(s, keyScan) {
  let out = '';
  let last = 0;
  let m;
  keyScan.lastIndex = 0;
  while ((m = keyScan.exec(s))) {
    const start = m.index + m[0].length;
    const end = valueEnd(s, start, m[2]);
    out += `${s.slice(last, start)}[redacted]`;
    last = end;
    keyScan.lastIndex = Math.max(end, start);
  }
  return out + s.slice(last);
}

// extra: the scenario's optional { keys: string[], patterns: string[] }
export function makeRedactor(extra = {}) {
  const keys = (extra.keys ?? []).map(escapeRe);
  const keySource = keys.length ? `${SENSITIVE_KEY.source}|${keys.join('|')}` : SENSITIVE_KEY.source;
  const keyRe = new RegExp(keySource, 'i');
  const keyScan = new RegExp(`([\\w-]*(?:${keySource})[\\w-]*)(["']?\\s*[=:]\\s*)`, 'gi');
  const custom = (extra.patterns ?? []).map((p) => new RegExp(p, 'g'));

  const text = (input) => {
    let s = String(input)
      .replace(HEADER_LINE, '$1$2[redacted]')
      .replace(SCHEME_CREDENTIAL, '[redacted]')
      .replace(JWT, '[redacted]');
    s = scrubKeyValues(s, keyScan).replace(URL_USERINFO, '$1[redacted]$2');
    return custom.reduce((acc, re) => acc.replace(re, '[redacted]'), s);
  };

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
