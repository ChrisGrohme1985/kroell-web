import { NextRequest, NextResponse } from "next/server";
import archiver from "archiver";
import { PassThrough } from "stream";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";

export const runtime = "nodejs";

type Photo = { url: string; comment?: string };

async function fetchAsBytes(url: string): Promise<Uint8Array | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    return new Uint8Array(ab);
  } catch {
    return null;
  }
}

async function buildPdf(payload: any): Promise<Uint8Array> {
  const {
    title,
    description,
    startDate,
    endDate,
    status,
    documentationText,
    photos,
  }: {
    title: string;
    description: string;
    startDate: string;
    endDate: string;
    status: string;
    documentationText: string;
    photos: Photo[];
  } = payload;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([595.28, 841.89]);
  const { width, height } = page.getSize();
  const margin = 40;
  let y = height - margin;

  function drawLine(text: string, size = 11, isBold = false) {
    const f = isBold ? bold : font;
    page.drawText(text, { x: margin, y, size, font: f, color: rgb(0.07, 0.09, 0.13) });
    y -= size + 6;
  }

  function drawWrapped(text: string, size = 11, isBold = false) {
    const f = isBold ? bold : font;
    const maxWidth = width - margin * 2;
    const words = text.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      if (f.widthOfTextAtSize(test, size) > maxWidth) {
        if (line) { drawLine(line, size, isBold); }
        line = w;
      } else line = test;
    }
    if (line) drawLine(line, size, isBold);
  }

  page.drawText("Termin-Dokumentation", { x: margin, y, size: 20, font: bold, color: rgb(0.14, 0.39, 0.92) });
  y -= 30;

  drawWrapped(`Titel: ${title}`, 12, true);
  drawWrapped(`Zeitraum: ${startDate} – ${endDate}`, 11, false);
  drawWrapped(`Status: ${status}`, 11, false);
  y -= 8;

  if (description) {
    drawWrapped("Beschreibung:", 12, true);
    drawWrapped(description, 11, false);
    y -= 8;
  }

  drawWrapped("Dokumentationstext:", 12, true);
  drawWrapped(documentationText || "—", 11, false);
  y -= 8;

  drawWrapped("Fotos (Kommentare in ZIP als .txt):", 12, true);
  drawWrapped(`Anzahl: ${(photos?.length ?? 0)}`, 11, false);

  return await pdf.save();
}

export async function POST(req: NextRequest) {
  const payload = await req.json();
  const { title, photos }: { title: string; photos: Photo[] } = payload;

  const archive = archiver("zip", { zlib: { level: 9 } });
  const stream = new PassThrough();
  archive.pipe(stream);

  // PDF
  const pdfBytes = await buildPdf(payload);
  archive.append(Buffer.from(pdfBytes), { name: "Termin_Dokumentation.pdf" });

  // index
  const lines = [
    `Titel: ${title}`,
    `Export: ${new Date().toISOString()}`,
    "",
    "Fotos:",
    ...(photos ?? []).map((p, i) => `- foto_${i + 1}${p.comment ? " — " + p.comment : ""}`),
    "",
  ];
  archive.append(lines.join("\n"), { name: "index.txt" });

  // photos + comment files
  for (let i = 0; i < (photos?.length ?? 0); i++) {
    const p = photos[i];
    const bytes = await fetchAsBytes(p.url);
    if (!bytes) continue;
    const ext = p.url.includes("png") ? "png" : "jpg";
    archive.append(Buffer.from(bytes), { name: `fotos/foto_${i + 1}.${ext}` });
    if (p.comment) {
      archive.append(p.comment, { name: `fotos/foto_${i + 1}_kommentar.txt` });
    }
  }

  await archive.finalize();

  const safe = (title || "termin").replace(/[^a-z0-9_-]+/gi, "_");
  return new NextResponse(stream as any, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${safe}_bundle.zip"`,
    },
  });
}
