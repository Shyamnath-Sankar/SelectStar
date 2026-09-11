/**
 * TEMPORARY DEBUG PAGE — REMOVE AFTER DIAGNOSIS.
 *
 * GET /debug-status — inspects the running container from the inside:
 * whether compiled route modules exist on disk, whether they can be
 * required, and what they export. All /api/* routes currently return
 * empty 405s on Render while pages render fine, so this page (which
 * renders fine) reports on the route layer from the inside.
 */
import { headers } from "next/headers";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nodeRequire(id: string): any {
  // Indirect eval so Turbopack leaves this require alone at build time.
  // eslint-disable-next-line @typescript-eslint/no-implied-eval
  const req = (0, eval)("require") as (p: string) => unknown;
  return req(id);
}

function tryKeys(absPath: string) {
  try {
    const mod = nodeRequire(absPath) as Record<string, unknown>;
    return { ok: true, keys: Object.keys(mod), typeofMod: typeof mod };
  } catch (e) {
    const err = e as Error;
    return {
      ok: false,
      message: err.message,
      code: (err as unknown as { code?: string }).code,
      stack: (err.stack || "").split("\n").slice(0, 10),
    };
  }
}

export default async function DebugStatusPage() {
  // Force dynamic rendering so this runs at request time, not build time.
  void headers();

  const fs = nodeRequire("node:fs") as typeof import("fs");
  const report: Record<string, unknown> = {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cwd: process.cwd(),
    envPresent: {
      PORT: process.env.PORT ?? null,
      HOSTNAME: process.env.HOSTNAME ?? null,
      NODE_ENV: process.env.NODE_ENV ?? null,
      DATABASE_URL_SET: !!process.env.DATABASE_URL,
    },
  };

  const check = (p: string) => {
    try {
      const st = fs.statSync(p);
      return { exists: true, isDir: st.isDirectory(), size: st.isFile() ? st.size : null };
    } catch {
      return { exists: false };
    }
  };

  report.paths = {
    "/app/server.js": check("/app/server.js"),
    "/app/.next/server/app/api/route.js": check("/app/.next/server/app/api/route.js"),
    "/app/.next/server/app/api/classic/upload/route.js": check(
      "/app/.next/server/app/api/classic/upload/route.js"
    ),
    "/app/.next/server/chunks": (() => {
      try {
        const dir = "/app/.next/server/chunks";
        return { exists: true, files: fs.readdirSync(dir).length };
      } catch {
        return { exists: false };
      }
    })(),
    "/app/node_modules/next/package.json": check("/app/node_modules/next/package.json"),
    "/app/node_modules/better-sqlite3": check("/app/node_modules/better-sqlite3"),
    "/app/node_modules/.prisma/client": check("/app/node_modules/.prisma/client"),
    "/app/node_modules/xlsx": check("/app/node_modules/xlsx"),
    "/app/node_modules/openai": check("/app/node_modules/openai"),
  };

  report.apiRouteModule = tryKeys("/app/.next/server/app/api/route.js");
  report.uploadRouteModule = tryKeys("/app/.next/server/app/api/classic/upload/route.js");

  report.requireTests = {
    "next/server": (() => {
      try {
        nodeRequire("next/server");
        return { ok: true };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      }
    })(),
    "better-sqlite3": (() => {
      try {
        nodeRequire("better-sqlite3");
        return { ok: true };
      } catch (e) {
        return { ok: false, message: (e as Error).message.slice(0, 300) };
      }
    })(),
  };

  return <pre>{JSON.stringify(report, null, 2)}</pre>;
}
