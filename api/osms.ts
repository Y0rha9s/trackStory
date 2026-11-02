/**
 * Proxy mínimo para Vercel: reenvía los archivos públicos de OSMS Data Explorer cuando el
 * navegador no puede pedirlos directo (CORS). Solo permite los archivos que usa la app
 * y deja que la CDN de Vercel los guarde un día, para no cargar el sitio de OSMS.
 *
 *   GET /api/osms?file=maps.json
 */
const ALLOWED = new Set(["maps.json", "monsters.json", "lookups.json", "items.json", "crafting.json", "quests.json", "skills.json"]);
const UPSTREAM = "https://osmsdataexplorer.com/data/current/";

export default async function handler(req: Request): Promise<Response> {
  const file = new URL(req.url).searchParams.get("file") ?? "";
  if (!ALLOWED.has(file)) return new Response("archivo no permitido", { status: 400 });
  const upstream = await fetch(UPSTREAM + file, { headers: { "user-agent": "maple-track (proxy de caché; 1 pedido por archivo al día)" } });
  if (!upstream.ok) return new Response(`OSMS respondió ${upstream.status}`, { status: 502 });
  return new Response(upstream.body, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, s-maxage=86400, stale-while-revalidate=86400",
      "access-control-allow-origin": "*",
    },
  });
}

export const config = { runtime: "edge" };
