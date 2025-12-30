export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const url = searchParams.get("url");

  if (!url) {
    return new Response("Missing url", { status: 400 });
  }

  // Optional: nur Firebase Storage URLs erlauben (Sicherheit)
  const allowed =
    url.startsWith("https://firebasestorage.googleapis.com/") ||
    url.startsWith("https://storage.googleapis.com/");

  if (!allowed) {
    return new Response("URL not allowed", { status: 403 });
  }

  const upstream = await fetch(url);
  if (!upstream.ok) {
    return new Response("Upstream download failed", { status: 502 });
  }

  const contentType = upstream.headers.get("content-type") ?? "application/octet-stream";
  const contentLength = upstream.headers.get("content-length") ?? undefined;

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      ...(contentLength ? { "Content-Length": contentLength } : {}),
      // kein Cache erzwingen (optional)
      "Cache-Control": "private, max-age=0, no-store",
    },
  });
}
