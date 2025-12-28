// src/app/admin/appointments/hard-delete/route.ts
import { NextResponse } from "next/server";
import { adminDb, adminBucket } from "@/lib/firebaseAdmin";

type Body = { appointmentId?: string };

/**
 * Erwartet JSON:
 * { "appointmentId": "ABC123" }
 *
 * Ablauf (Beispiel):
 * - Firestore Doc laden (appointments/{appointmentId})
 * - ggf. Storage-Dateien löschen (wenn Pfade im Doc liegen)
 * - Doc löschen
 *
 * Passe die Collection/Fields unten an dein Schema an.
 */
export async function POST(req: Request) {
  try {
    const body = (await req.json()) as Body;
    const appointmentId = body.appointmentId?.trim();

    if (!appointmentId) {
      return NextResponse.json(
        { ok: false, error: "appointmentId fehlt" },
        { status: 400 }
      );
    }

    // >>> 1) Firestore-Dokument laden
    // Passe "appointments" an, falls deine Collection anders heißt.
    const ref = adminDb.collection("appointments").doc(appointmentId);
    const snap = await ref.get();

    if (!snap.exists) {
      return NextResponse.json(
        { ok: false, error: "Termin nicht gefunden" },
        { status: 404 }
      );
    }

    const data = snap.data() as Record<string, unknown>;

    // >>> 2) Optional: Dateien im Storage löschen
    // Passe an dein Datenmodell an!
    //
    // Häufige Varianten:
    // - data.filePath: string
    // - data.filePaths: string[]
    // - data.storagePaths: string[]
    //
    // Ich unterstütze hier 2 Felder: filePath (string) und filePaths (string[])
    const filePath = typeof data.filePath === "string" ? data.filePath : null;
    const filePaths = Array.isArray(data.filePaths)
      ? (data.filePaths.filter((p) => typeof p === "string") as string[])
      : [];

    const pathsToDelete = [
      ...(filePath ? [filePath] : []),
      ...filePaths,
    ].filter(Boolean);

    // Löschen (fehlende Dateien ignorieren)
    await Promise.all(
      pathsToDelete.map(async (p) => {
        try {
          await adminBucket.file(p).delete();
        } catch (err: any) {
          // Wenn Datei nicht existiert oder schon gelöscht ist -> ignorieren
          // Du kannst hier optional loggen
        }
      })
    );

    // >>> 3) Firestore-Dokument löschen
    await ref.delete();

    return NextResponse.json({
      ok: true,
      deleted: {
        appointmentId,
        filesAttempted: pathsToDelete.length,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Unbekannter Fehler" },
      { status: 500 }
    );
  }
}
