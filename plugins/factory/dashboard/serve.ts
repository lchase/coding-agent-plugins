// bun serve.ts              -> board for every repo that ever ran it (registry: ~/.factory/repos.json); the current
//                              repo's ./.factory is added to the registry first
// bun serve.ts example      -> dummy data bundled with the plugin (no registry)
// bun serve.ts <dir>        -> any dir containing jobs/*/job.json (no registry)
// GET /board.json is assembled from <root>/jobs/*/job.json plus what the job folder's files say (title, rounds, PR
// quality); each job gets key "<repo>/<id>", repo = folder holding .factory.
// Loopback only, and a Host header that is not localhost is refused (a DNS-rebinding page cannot read the board).
// If the port is taken, a board is already up: the repo is registered (the running server re-reads the registry) and we exit.
import { existsSync, mkdirSync } from "fs";
import { basename, dirname, resolve } from "path";
import { homedir } from "os";
const arg = Bun.argv[2];
const PORT = Number(Bun.env.PORT ?? 8765);
const registry = `${homedir()}/.factory/repos.json`;

async function roots(): Promise<string[]> {
  if (arg === "example") return [`${import.meta.dir}/example`];
  if (arg) return [resolve(arg)];
  const known: string[] = existsSync(registry) ? await Bun.file(registry).json() : [];
  return known.filter(existsSync);
}
const repoOf = (root: string) => basename(root) === ".factory" ? basename(dirname(root)) : basename(root);

if (!arg) {
  const here = resolve(".factory");
  const known = await roots();
  if (existsSync(here) && !known.includes(here)) known.push(here);
  mkdirSync(dirname(registry), { recursive: true });
  await Bun.write(registry, JSON.stringify(known, null, 2));
}

const version: string = (await Bun.file(`${import.meta.dir}/../.claude-plugin/plugin.json`).json()).version;

// Rounds come from the round-N/ folders (source of truth), not from job.json bookkeeping the orchestrator may skip.
// -> [{ n, v: { security?, ux?, ui?, code?, pr? } }], verdict = first line of review-<k>.md, undefined while missing.
async function history(dir: string) {
  const out = [];
  for await (const d of new Bun.Glob("round-*").scan({ cwd: dir, onlyFiles: false })) {
    const n = Number(d.slice(6)), v: Record<string, string> = {};
    for await (const f of new Bun.Glob("review-*.md").scan({ cwd: `${dir}/${d}` }))
      v[f.slice(7, -3)] = ((await Bun.file(`${dir}/${d}/${f}`).text()).split("\n")[0].match(/^VERDICT:\s*(\w+)/) ?? [])[1] ?? "";
    out.push({ n, v });
  }
  return out.sort((a, b) => a.n - b.n);
}

const read = async (p: string) => (await Bun.file(p).exists()) ? Bun.file(p).text() : "";

// Title: spec.md's first heading, else feature.md's first line after "Source:".
async function title(dir: string) {
  const spec = (await read(`${dir}/spec.md`)).match(/^# (.+)$/m)?.[1];
  return spec ?? (await read(`${dir}/feature.md`)).split("\n").find(l => l.trim() && !l.startsWith("Source:"))?.replace(/^#+\s*/, "");
}

// PR quality: rounds with review-pr.md, and items fixed per human/bot. Items are "### <id> ... (human|bot <author>)"
// in review-pr.md; outcomes are the builder's "- <id> (<gist>): fixed|declined|no-change" lines in build.md.
async function quality(dir: string, hist: { n: number; v: Record<string, string> }[]) {
  const out = await read(`${dir}/build.md`), fixed = new Set<string>(), q = { rounds: 0, human: 0, bot: 0 };
  for (const m of out.matchAll(/^- (\S+) \(.*?\): (fixed|declined|no-change)\b/gm)) if (m[2] === "fixed") fixed.add(m[1]);
  for (const { n, v } of hist) {
    if (v.pr === undefined) continue;
    q.rounds++;
    for (const m of (await read(`${dir}/round-${n}/review-pr.md`)).matchAll(/^### (\S+) .*\((human|bot)\b/gm))
      if (fixed.has(m[1])) q[m[2] as "human" | "bot"]++;
  }
  return q;
}

async function board() {
  const jobs = [];
  for (const root of await roots())
    for await (const p of new Bun.Glob("jobs/*/job.json").scan({ cwd: root })) {
      const j = await Bun.file(`${root}/${p}`).json(), dir = `${root}/jobs/${j.id}`, hist = await history(dir);
      jobs.push({
        ...j, title: await title(dir) ?? j.id, history: hist, quality: await quality(dir, hist),
        repo: repoOf(root), key: `${repoOf(root)}/${j.id}`,
      });
    }
  jobs.sort((a, b) => a.key.localeCompare(b.key));
  const repos = (await roots()).map(repoOf);
  return Response.json({ jobs, repos, version }, { headers: { "cache-control": "no-store" } });
}

const HOSTS = [`localhost:${PORT}`, `127.0.0.1:${PORT}`];

try {
  Bun.serve({
    port: PORT,
    hostname: "127.0.0.1",
    async fetch(req) {
      if (!HOSTS.includes(req.headers.get("host") ?? "")) return new Response("bad host", { status: 403 });
      const path = decodeURIComponent(new URL(req.url).pathname);
      if (path.includes("..")) return new Response("nope", { status: 400 });
      if (path === "/board.json") return board();
      let file = Bun.file(`${import.meta.dir}/dashboard.html`);
      if (path !== "/" && path !== "/dashboard.html") {
        // /jobs/<repo>/<id>/<file> -> <root of repo>/jobs/<id>/<file>
        const [, jobs, repo, ...rest] = path.split("/");
        const root = jobs === "jobs" ? (await roots()).find(r => repoOf(r) === repo) : undefined;
        if (!root) return new Response("not found", { status: 404 });
        file = Bun.file(`${root}/jobs/${rest.join("/")}`);
      }
      return (await file.exists()) ? new Response(file, { headers: { "cache-control": "no-store" } }) : new Response("not found", { status: 404 });
    },
  });
  console.log(`factory board: http://localhost:${PORT}  (repos: ${(await roots()).join(", ")})`);
} catch (e: any) {
  if (e.code !== "EADDRINUSE") throw e;
  console.log(`factory board already running at http://localhost:${PORT}, repo registered`);
}
