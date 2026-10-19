// bun serve.ts              -> live board for the repo in the current directory (./.factory/jobs)
// bun serve.ts example      -> dummy data bundled with the plugin
// bun serve.ts <dir>        -> any dir containing jobs/*/job.json
// GET /board.json is assembled from jobs/*/job.json so every orchestrator session owns one file.
import { resolve } from "path";
const arg = Bun.argv[2];
const root = arg === "example" ? `${import.meta.dir}/example` : resolve(arg ?? ".factory");

async function board() {
  const jobs = [];
  for await (const p of new Bun.Glob("jobs/*/job.json").scan({ cwd: root })) jobs.push(await Bun.file(`${root}/${p}`).json());
  jobs.sort((a, b) => a.id.localeCompare(b.id));
  return Response.json({ jobs }, { headers: { "cache-control": "no-store" } });
}

Bun.serve({
  port: 8765,
  async fetch(req) {
    const path = decodeURIComponent(new URL(req.url).pathname);
    if (path.includes("..")) return new Response("nope", { status: 400 });
    if (path === "/board.json") return board();
    const file = Bun.file(path === "/" || path === "/dashboard.html" ? `${import.meta.dir}/dashboard.html` : root + path);
    return (await file.exists()) ? new Response(file, { headers: { "cache-control": "no-store" } }) : new Response("not found", { status: 404 });
  },
});
console.log(`factory board: http://localhost:8765  (jobs: ${root}/jobs)`);
