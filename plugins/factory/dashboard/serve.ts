// bun serve.ts              -> board for every repo that ever ran it (registry: ~/.factory/repos.json); the current
//                              repo's ./.factory is added to the registry first
// bun serve.ts example      -> dummy data bundled with the plugin (no registry)
// bun serve.ts <dir>        -> any dir containing jobs/*/job.json (no registry)
// GET /board.json is assembled from <root>/jobs/*/job.json; each job gets key "<repo>/<id>", repo = folder holding .factory.
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

async function board() {
  const jobs = [];
  for (const root of await roots())
    for await (const p of new Bun.Glob("jobs/*/job.json").scan({ cwd: root })) {
      const j = await Bun.file(`${root}/${p}`).json();
      jobs.push({ ...j, repo: repoOf(root), key: `${repoOf(root)}/${j.id}` });
    }
  jobs.sort((a, b) => a.key.localeCompare(b.key));
  return Response.json({ jobs, version }, { headers: { "cache-control": "no-store" } });
}

try {
  Bun.serve({
    port: PORT,
    async fetch(req) {
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
