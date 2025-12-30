// app/api/upload-appointment-photo/route.ts
import { NextResponse } from "next/server";
import crypto from "crypto";
import { adminAuth, adminBucket } from "@/lib/firebaseAdmin"; // <-- nutzt DEINE Datei

export const runtime = "nodejs";

function jsonError(message: string, status = 400) {
  return NextResponse.json({ ok: false, error: message }, { status });
}

function guessExtFromMime(mime: string) {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("gif")) return "gif";
  return "jpg";
}

export async function POST(req: Request) {
  try {
    // 1) Firebase ID Token aus Header prüfen
    const authHeader = req.headers.get("authorization") || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) return jsonError("Missing Authorization Bearer token", 401);

    const decoded = await adminAuth.verifyIdToken(token);
    const uid = decoded.uid;

    // 2) FormData lesen
    const form = await req.formData();
    const apptId = String(form.get("apptId") || "").trim();
    const comment = String(form.get("comment") || "").trim();

    const file = form.get("file");
    if (!apptId) return jsonError("Missing apptId", 400);
    if (!file || !(file instanceof File)) return jsonError("Missing file", 400);

    // 3) Validierung
    const MAX_MB = 15;
    const sizeMb = file.size / 1024 / 1024;
    if (sizeMb > MAX_MB) return jsonError(`File too large (${sizeMb.toFixed(2)} MB). Max ${MAX_MB} MB`, 413);

    const contentType = file.type || "application/octet-stream";
    if (!contentType.startsWith("image/")) return jsonError("Only image uploads allowed", 415);

    // 4) Pfad bauen (immer unter uploader uid)
    const ext = guessExtFromMime(contentType);
    const ts = Date.now();
    const filename = `${ts}_${uid}.${ext}`;
    const path = `appointments/${apptId}/photos/${uid}/${filename}`;

    // 5) Upload serverseitig in Bucket
    const buf = Buffer.from(await file.arrayBuffer());

    // Firebase Download Token (für stabile Download-URL)
    const downloadToken = crypto.randomUUID();

    const gcsFile = adminBucket.file(path);
    await gcsFile.save(buf, {
      resumable: false,
      contentType,
      metadata: {
        metadata: {
          firebaseStorageDownloadTokens: downloadToken,
          uploadedBy: uid,
          apptId,
          comment,
        },
      },
    });

    // 6) Download URL erzeugen
    const bucketName = adminBucket.name; // sollte kroell-app.appspot.com sein
    const encodedPath = encodeURIComponent(path);
    const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodedPath}?alt=media&token=${downloadToken}`;

    return NextResponse.json({
      ok: true,
      uid,
      apptId,
      path,
      url,
      contentType,
      comment,
    });
  } catch (e: any) {
    return jsonError(e?.message || "Upload failed", 500);
  }
}
