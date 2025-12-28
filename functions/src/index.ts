import { onRequest } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import cors from "cors";
import * as admin from "firebase-admin";

admin.initializeApp();

const db = admin.firestore();
const bucket = admin.storage().bucket();

// ✅ CORS – erlaubte Origins
const corsHandler = cors({
  origin: [
    "http://localhost:3000",
    // "https://kroell-app.web.app",
    // "https://kroell-app.firebaseapp.com",
    // "https://deine-domain.de",
  ],
  methods: ["POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
});

function getBearerToken(req: any): string | null {
  const h = String(req.headers?.authorization ?? "");
  if (!h) return null;
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m?.[1] ?? null;
}

async function requireAdmin(req: any): Promise<{ uid: string }> {
  const token = getBearerToken(req);
  if (!token) {
    const err: any = new Error("Missing Authorization Bearer token");
    err.status = 401;
    throw err;
  }

  const decoded = await admin.auth().verifyIdToken(token);
  const uid = decoded.uid;

  const snap = await db.collection("users").doc(uid).get();
  const role = String(snap.data()?.role ?? "").toLowerCase();

  if (role !== "admin") {
    const err: any = new Error("Forbidden (admin only)");
    err.status = 403;
    throw err;
  }

  return { uid };
}


/**
 * ✅ FINAL: löscht den kompletten Storage-Ordner des Termins:
 * appointments/<appointmentId>/...
 * Damit gibt es keine Storage-Leichen mehr.
 */
async function deleteAppointmentStorageFolder(appointmentId: string) {
  const prefix = `appointments/${appointmentId}/`;

  try {
    const [files] = await bucket.getFiles({ prefix });
    if (!files || files.length === 0) return;

    await Promise.all(files.map((f) => f.delete({ ignoreNotFound: true } as any).catch(() => {})));
  } catch (e) {
    console.error("deleteAppointmentStorageFolder failed:", appointmentId, e);
  }
}

/**
 * ✅ Prüft, ob noch Termine zur Serie existieren (schnell: limit 1)
 */
async function seriesHasAnyAppointments(seriesId: string): Promise<boolean> {
  const q = await db.collection("appointments").where("seriesId", "==", seriesId).limit(1).get();
  return !q.empty;
}

/**
 * ✅ Löscht die Serien-Meta in Firestore zuverlässig:
 * - Primär: appointmentSeries/{seriesId} (Doc-ID)
 * - Fallback: wenn seriesId nicht die Doc-ID ist, suchen wir per Feld "firstAppointmentId"
 */
async function hardDeleteSeriesMeta(seriesId: string, fallbackFirstAppointmentId?: string | null) {
  // 1) Standard (bei dir im Screenshot): Doc-ID == seriesId
  const directRef = db.collection("appointmentSeries").doc(seriesId);
  const directSnap = await directRef.get();
  if (directSnap.exists) {
    await db.recursiveDelete(directRef);
    return;
  }

  // 2) Fallback: manche Systeme speichern seriesId anders und haben z.B. firstAppointmentId im Serien-Dokument
  const fallbackId = String(fallbackFirstAppointmentId ?? "").trim() || seriesId;
  const qs = await db.collection("appointmentSeries").where("firstAppointmentId", "==", fallbackId).limit(10).get();
  if (!qs.empty) {
    for (const docSnap of qs.docs) {
      await db.recursiveDelete(docSnap.ref);
    }
  }
}

/**
 * ✅ Hard Delete eines Termins:
 * - löscht Storage-Ordner des Termins vollständig (appointments/<id>/...)
 * - löscht Firestore Doc + Subcollections
 * - wenn es ein Serientermin war: und danach keine Instanzen mehr existieren → Serien-Meta ebenfalls löschen
 */
async function hardDeleteAppointmentById(appointmentId: string) {
  const ref = db.collection("appointments").doc(appointmentId);
  const snap = await ref.get();
  if (!snap.exists) {
    const err: any = new Error("Appointment not found");
    err.status = 404;
    throw err;
  }

  const data = snap.data() as any;
  const seriesId = String(data?.seriesId ?? "").trim(); // wichtig für Auto-Cleanup
  const firstAppointmentId = String(data?.firstAppointmentId ?? "").trim(); // optional, falls du sowas nutzt

  // ✅ Storage: ganzer Termin-Ordner weg
  await deleteAppointmentStorageFolder(appointmentId);

  // ✅ Firestore: Doc + Subcollections weg
  await db.recursiveDelete(ref);

  // ✅ Auto-Cleanup: wenn letzter Termin der Serie gelöscht wurde → Serien-Dokument auch weg
  if (seriesId) {
    const anyLeft = await seriesHasAnyAppointments(seriesId);
    if (!anyLeft) {
      await hardDeleteSeriesMeta(seriesId, firstAppointmentId || appointmentId);
    }
  }
}

/**
 * ✅ apiHardDeleteAppointment
 * Erwartet Body: { id: "..."} oder { appointmentId: "..." }
 */
export const apiHardDeleteAppointment = onRequest(
  { region: "us-central1", cors: false },
  (req, res) => {
    res.setHeader("Vary", "Origin");

    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
      }

      try {
        await requireAdmin(req);

        const body = (req.body ?? {}) as any;
        const appointmentId = String(body.id ?? body.appointmentId ?? "").trim();
        if (!appointmentId) {
          res.status(400).json({ ok: false, error: "Missing appointmentId (body.id or body.appointmentId)" });
          return;
        }

        await hardDeleteAppointmentById(appointmentId);

        res.status(200).json({ ok: true });
      } catch (e: any) {
        console.error("apiHardDeleteAppointment error:", e);
        res.status(Number(e?.status) || 500).json({ ok: false, error: e?.message ?? "unknown" });
      }
    });
  }
);

/**
 * ✅ apiHardDeleteSeries
 * Erwartet Body: { seriesId: "..." }
 * Löscht:
 * 1) alle appointments mit seriesId == ...
 * 2) danach appointmentSeries/{seriesId} (oder fallback per firstAppointmentId)
 */
export const apiHardDeleteSeries = onRequest(
  { region: "us-central1", cors: false },
  (req, res) => {
    res.setHeader("Vary", "Origin");

    corsHandler(req, res, async () => {
      if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
      }

      if (req.method !== "POST") {
        res.status(405).json({ ok: false, error: "Method not allowed" });
        return;
      }

      try {
        await requireAdmin(req);

        const body = (req.body ?? {}) as any;
        const seriesId = String(body.seriesId ?? "").trim();
        if (!seriesId) {
          res.status(400).json({ ok: false, error: "Missing seriesId" });
          return;
        }

        // Termine der Serie holen
        const q = await db.collection("appointments").where("seriesId", "==", seriesId).get();

        // nacheinander löschen (stabil)
        let deleted = 0;
        let anyAppointmentId: string | null = null;

        for (const docSnap of q.docs) {
          anyAppointmentId = anyAppointmentId ?? docSnap.id;
          await hardDeleteAppointmentById(docSnap.id);
          deleted++;
        }

        // Serien-Meta sicher löschen (auch wenn keine Instanzen existieren)
        await hardDeleteSeriesMeta(seriesId, anyAppointmentId);

        res.status(200).json({ ok: true, deleted, seriesDeleted: true });
      } catch (e: any) {
        console.error("apiHardDeleteSeries error:", e);
        res.status(Number(e?.status) || 500).json({ ok: false, error: e?.message ?? "unknown" });
      }
    });
  }
);

/**
 * ✅ Täglicher Cleanup 23:59 (Europe/Berlin)
 * Entfernt Serien-Dokumente, zu denen es KEINE Termine mehr gibt.
 *
 * Hinweis: Scheduled Functions brauchen i.d.R. Blaze Plan, weil Cloud Scheduler genutzt wird.
 */
export const dailyCleanupOrphans = onSchedule(
  {
    region: "us-central1",
    schedule: "59 23 * * *",
    timeZone: "Europe/Berlin",
  },
  async () => {
    console.log("[dailyCleanupOrphans] start");

    // Wir iterieren in Seiten, damit es skaliert.
    // Jede Serie: wenn keine appointments mit seriesId==doc.id existieren => Serie löschen.
    const pageSize = 200;
    let lastDoc: FirebaseFirestore.QueryDocumentSnapshot | null = null;

    let scanned = 0;
    let deletedSeries = 0;

    while (true) {
      let q = db.collection("appointmentSeries").orderBy(admin.firestore.FieldPath.documentId()).limit(pageSize);
      if (lastDoc) q = q.startAfter(lastDoc);

      const snap = await q.get();
      if (snap.empty) break;

      for (const d of snap.docs) {
        scanned++;
        const seriesId = d.id;

        const anyLeft = await seriesHasAnyAppointments(seriesId);
        if (!anyLeft) {
          try {
            await db.recursiveDelete(d.ref);
            deletedSeries++;
          } catch (e) {
            console.error("[dailyCleanupOrphans] delete failed:", seriesId, e);
          }
        }
      }

      lastDoc = snap.docs[snap.docs.length - 1];
      if (snap.size < pageSize) break;
    }

    console.log("[dailyCleanupOrphans] done", { scanned, deletedSeries });
  }
);
