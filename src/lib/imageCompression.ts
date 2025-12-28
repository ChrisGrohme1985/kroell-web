/**
 * Simple in-browser image processing using canvas.
 * - Keeps aspect ratio
 * - Optional resize to maxDimension (longest side)
 * - Optional JPEG/WebP encoding
 * - Optional watermark text (bottom-right)
 */
export async function processImageFile(
  file: File,
  opts?: {
    maxDimension?: number;
    quality?: number;
    mimeType?: "image/jpeg" | "image/webp";
    watermarkText?: string | null;
    // If true, always process; otherwise returns original if no resize/encode/watermark needed.
    force?: boolean;
  }
): Promise<File> {
  const maxDimension = opts?.maxDimension ?? 2000;
  const quality = opts?.quality ?? 0.75;
  const mimeType = opts?.mimeType ?? "image/jpeg";
  const watermarkText = opts?.watermarkText ?? null;
  const force = opts?.force ?? false;

  if (!file.type.startsWith("image/")) return file;

  const img = await loadImageFromFile(file);
  const { width, height } = img;

  const maxSide = Math.max(width, height);
  const scale = maxSide > maxDimension ? maxDimension / maxSide : 1;

  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);

  const needsResize = scale !== 1;
  const needsWatermark = !!watermarkText;

  if (!force && !needsResize && !needsWatermark && file.type === mimeType) {
    return file;
  }

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;

  const ctx = canvas.getContext("2d");
  if (!ctx) return file;

  ctx.drawImage(img, 0, 0, outW, outH);

  if (needsWatermark && watermarkText) {
    drawWatermark(ctx, outW, outH, watermarkText);
  }

  const blob: Blob = await new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b ?? new Blob()), mimeType, quality)
  );

  const ext = mimeType === "image/webp" ? "webp" : "jpg";
  const name = file.name.replace(/\.[^.]+$/, "") + `_processed.${ext}`;
  return new File([blob], name, { type: mimeType, lastModified: Date.now() });
}

function drawWatermark(ctx: CanvasRenderingContext2D, w: number, h: number, text: string) {
  const padding = 14;
  const fontSize = Math.max(14, Math.round(w * 0.018));
  ctx.font = `600 ${fontSize}px system-ui, -apple-system, Segoe UI, Roboto, Arial`;
  ctx.textBaseline = "bottom";

  const metrics = ctx.measureText(text);
  const boxW = Math.ceil(metrics.width) + padding * 2;
  const boxH = fontSize + padding;

  const x = w - boxW - padding;
  const y = h - padding;

  // background box
  ctx.fillStyle = "rgba(0,0,0,0.40)";
  ctx.fillRect(x, y - boxH, boxW, boxH);

  // text
  ctx.fillStyle = "rgba(255,255,255,0.95)";
  ctx.fillText(text, x + padding, y - padding / 2);
}

function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = (e) => {
      URL.revokeObjectURL(url);
      reject(e);
    };
    img.src = url;
  });
}
