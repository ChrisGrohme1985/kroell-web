import { NextRequest, NextResponse } from "next/server";
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

export async function POST(req: NextRequest) {
  const body = await req.json();

  const {
    title,
    description,
    startDate,
    endDate,
    status,
    documentationText,
    documentedByUserId,
    documentedAt,
    doneAt,
    photos,
  }: {
    title: string;
    description: string;
    startDate: string;
    endDate: string;
    status: string;
    documentationText: string;
    documentedByUserId?: string | null;
    documentedAt?: string | null;
    doneAt?: string | null;
    photos: Photo[];
  } = body;

  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const page = pdf.addPage([595.28, 841.89]); // A4 points
  const { width, height } = page.getSize();

  const margin = 40;
  let y = height - margin;

  function drawText(text: string, size = 12, isBold = false) {
    const f = isBold ? bold : font;
    const lines: string[] = [];
    const maxWidth = width - margin * 2;
    const words = text.split(/\s+/);
    let line = "";
    for (const w of words) {
      const test = line ? line + " " + w : w;
      const wWidth = f.widthOfTextAtSize(test, size);
      if (wWidth > maxWidth) {
        if (line) lines.push(line);
        line = w;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);

    for (const ln of lines) {
      page.drawText(ln, { x: margin, y, size, font: f, color: rgb(0.07, 0.09, 0.13) });
      y -= size + 6;
      if (y < margin + 120) {
        // create new page if needed (simple)
        const p2 = pdf.addPage([595.28, 841.89]);
        y = p2.getSize().height - margin;
        // switch page reference
        (page as any) = p2;
      }
    }
  }

  page.drawText("Termin-Dokumentation", { x: margin, y, size: 20, font: bold, color: rgb(0.14, 0.39, 0.92) });
  y -= 30;

  drawText(`Titel: ${title}`, 12, true);
  drawText(`Zeitraum: ${startDate} – ${endDate}`, 11, false);
  drawText(`Status: ${status}`, 11, false);
  if (documentedAt) drawText(`Dokumentiert am: ${documentedAt}`, 11, false);
  if (documentedByUserId) drawText(`Dokumentiert von: ${documentedByUserId}`, 11, false);
  if (doneAt) drawText(`Erledigt am: ${doneAt}`, 11, false);
  y -= 8;

  if (description) {
    drawText("Beschreibung:", 12, true);
    drawText(description, 11, false);
    y -= 8;
  }

  drawText("Dokumentationstext:", 12, true);
  drawText(documentationText || "—", 11, false);
  y -= 10;

  drawText("Fotos:", 12, true);

  // Add photos (best-effort)
  for (let i = 0; i < (photos?.length ?? 0); i++) {
    const p = photos[i];
    const bytes = await fetchAsBytes(p.url);
    if (!bytes) {
      drawText(`Foto ${i + 1}: (konnte nicht geladen werden)`, 11, true);
      if (p.comment) drawText(`Kommentar: ${p.comment}`, 11, false);
      y -= 6;
      continue;
    }

    let img;
    try {
      // try jpg then png
      img = await pdf.embedJpg(bytes);
    } catch {
      try {
        img = await pdf.embedPng(bytes);
      } catch {
        drawText(`Foto ${i + 1}: (Format nicht unterstützt)`, 11, true);
        continue;
      }
    }

    const maxW = width - margin * 2;
    const maxH = 240;
    const scale = Math.min(maxW / img.width, maxH / img.height, 1);
    const iw = img.width * scale;
    const ih = img.height * scale;

    if (y - ih < margin) {
      const p2 = pdf.addPage([595.28, 841.89]);
      (page as any) = p2;
      y = p2.getSize().height - margin;
    }

    (page as any).drawImage(img, { x: margin, y: y - ih, width: iw, height: ih });
    y -= ih + 8;

    if (p.comment) {
      drawText(`Kommentar: ${p.comment}`, 11, false);
      y -= 6;
    } else {
      y -= 4;
    }
  }

  const bytesOut = await pdf.save();

return new NextResponse(Buffer.from(bytesOut), {
  headers: {
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="Termin_Dokumentation.pdf"`,
  },
});


}
