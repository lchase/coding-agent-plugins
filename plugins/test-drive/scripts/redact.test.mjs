// Regression check for redact.mjs. Run: node plugins/test-drive/scripts/redact.test.mjs
import assert from 'node:assert/strict';
import { makeRedactor } from './redact.mjs';

const r = makeRedactor({ patterns: ['CUST-\\d+'], keys: ['ssn'] });
const gone = (out, secret) => assert.ok(!out.includes(secret), `leaked "${secret}" in: ${out}`);

// scheme credentials and header lines
gone(r.text('Authorization: Basic dXNlcjpwYXNzd29yZA=='), 'dXNl');
gone(r.text('Authorization: Digest username=leak1, nonce=leak2'), 'leak2');
gone(r.text('Cookie: sid=leak3; theme=dark'), 'leak3');
gone(r.text('Set-Cookie: sid=leak4; HttpOnly'), 'leak4');
gone(r.text('auth=Bearer abc123def456ghi789'), 'abc123');
gone(r.text('jwt eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4'), 'SflKxw');

// key/value text in every shape
gone(r.text('password: correct horse battery staple'), 'horse');
gone(r.text('password="correct horse battery staple"'), 'horse');
gone(r.text("{'password': 'leak5 leak6'}"), 'leak6');
gone(r.text('user=a&password=leak7&x=1'), 'leak7');
gone(r.text('/login?access_token=leak8&x=1'), 'leak8');
gone(r.text('{"token": {"a":"leak9"}} trailing'), 'leak9');
assert.ok(r.text('{"token": {"a":"leak9"}} trailing').endsWith(' trailing'), 'consumed text after the value');
gone(r.text('{"api_key": 12345, "x": 1'), '12345');
gone(r.text('{"ssn": "leak10"'), 'leak10'); // scenario key
gone(r.text('customer CUST-998877'), '998877'); // scenario pattern

// URL userinfo
gone(r.text('postgres://app:leak11@db:5432/x'), 'leak11');

// JSON bodies: by key at any depth, including when unparseable
gone(r.body('{"a":{"client_secret":"leak12"}}'), 'leak12');
gone(r.body('{"password":"leak13"} garbage'), 'leak13');
gone(JSON.stringify(r.headers({ 'X-Auth-Token': 'leak14', 'x-note': 'Bearer abcdefgh1234' })), 'leak14');
gone(JSON.stringify(r.headers({ 'x-note': 'Bearer abcdefgh1234' })), 'abcdefgh');

// ordinary text survives, and redaction is idempotent
for (const keep of ['status=200 path=/health', '{"user":"u1","qty":2}', 'order created sku=TEST-001']) {
  assert.equal(r.text(keep), keep);
}
const once = r.text('password=leak15 Cookie: a=b');
assert.equal(r.text(once), once);

console.log('redact: all checks passed');
