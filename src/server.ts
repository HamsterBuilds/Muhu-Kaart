import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

const ROAD_MIRRORS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass.private.coffee/api/interpreter",
];

/**
 * Sama päritolu puhverserver teede jaoks. Avalikud Overpassi peeglid ei anna
 * alati brauserile CORS-päiseid, mistõttu kaart võib muidu täiesti tühjaks jääda.
 */
async function proxyRoads(request: Request): Promise<Response> {
  if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const body = await request.text();
  const query = new URLSearchParams(body).get("data");
  if (body.length > 75_000 || !query?.includes('way["highway"')) {
    return new Response("Invalid road query", { status: 400 });
  }
  // Avalikud Overpassi instantsid piiravad paralleelseid rakendusepäringuid.
  // Proovi peegleid ükshaaval ja identifitseeri rakendus, et vältida 429/406 vastuseid.
  for (const url of ROAD_MIRRORS) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "user-agent": "MuhuTrailMagic/1.0 (road overlay)",
        },
        body,
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) continue;
      return new Response(response.body, {
        status: 200,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "public, max-age=60",
        },
      });
    } catch {
      // jätka järgmise peegliga
    }
  }
  return new Response("Road service unavailable", { status: 503 });
}

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => (m.default ?? m) as ServerEntry,
    );
  }
  return serverEntryPromise;
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isH3SwallowedErrorBody(body)) return response;

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isH3SwallowedErrorBody(body: string): boolean {
  try {
    const payload = JSON.parse(body) as { unhandled?: unknown; message?: unknown };
    return payload.unhandled === true && payload.message === "HTTPError";
  } catch {
    return false;
  }
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    try {
      if (new URL(request.url).pathname === "/api/admin/delete-tracks") {
        const { deleteServerTracks } = await import("./lib/admin-tracks.server");
        return await deleteServerTracks(request);
      }
      if (new URL(request.url).pathname === "/api/roads") return await proxyRoads(request);
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return new Response(renderErrorPage(), {
        status: 500,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
  },
};
