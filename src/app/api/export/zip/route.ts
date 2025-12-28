import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "stream";

export const runtime = "nodejs";

type Photo = { url: string; comment?: string };

async function fetchBuffer(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { title, photos }: { title: string; photos: Photo[] } = body;

  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = new PassThrough();

  archive.pipe(stream);

  // Add a small index.txt
  const lines = [
    `Titel: ${title}`,
    `Export: ${new Date().toISOString()}`,
    "",
    "Dateien:",
    ...(photos ?? []).map((p, i) => `- foto_${i + 1}${p.comment ? " — " + p.comment : ""}`),
    "",
  ];
  archive.append(lines.join("\n"), { name: "index.txt" });

  for (let i = 0; i < (photos?.length ?? 0); i++) {
    const p = photos[i];
    const buf = await fetchBuffer(p.url);
    if (!buf) continue;

    // Best-effort extension
    const ext = p.url.includes("png") ? "png" : "jpg";
    archive.append(buf, { name: `fotos/foto_${i + 1}.${ext}` });

    if (p.comment) {
      archive.append(p.comment, { name: `fotos/foto_${i + 1}_kommentar.txt` });
    }
  }

  await archive.finalize();

  return new NextResponse(stream as any, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${(title || "termin").replace(/[^a-z0-9_-]+/gi, "_")}_fotos.zip"`,
    },
  });
}
