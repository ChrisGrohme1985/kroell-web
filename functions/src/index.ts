import { onRequest } from "firebase-functions/v2/https";
import { setGlobalOptions } from "firebase-functions/v2";
import * as logger from "firebase-functions/logger";
import * as admin from "firebase-admin";

setGlobalOptions({ region: "us-central1" });

admin.initializeApp();

async function verifyFirebaseIdToken(req: any) {
  const header = req.get("Authorization") || "";
  const match = header.match(/^Bearer (.+)$/);
  if (!match) throw new Error("Missing Authorization: Bearer <ID_TOKEN>");
  return admin.auth().verifyIdToken(match[1]);
}

/**
 * HARD DELETE APPOINTMENT (Gen2 HTTP)
 * - löscht appointments/{appointmentId} inkl. Subcollections (z.B. photos)
 * - löscht Storage-Dateien unter appointments/{appointmentId}/...
 *
 * Request Body:
 *  { "appointmentId": "<ID>" }  (oder { "id": "<ID>" })
 *
 * Header:
 *  Authorization: Bearer <FIREBASE_ID_TOKEN>
 */
export const apiHardDeleteAppointment = onRequest(
  {
    cors: ["https://kroell-web.vercel.app", "http://localhost:3000"],
  },
  async (req, res) => {
    try {
      if (req.method !== "POST") {
        res.status(405).json({ error: "Use POST" });
        return;
      }

      const decoded = await verifyFirebaseIdToken(req);

      // Admin nur über Custom Claim (admin=true) oder claim role=admin
      const requesterIsAdmin =
        (decoded as any).admin === true || (decoded as any).role === "admin";

      if (!requesterIsAdmin) {
        res.status(403).json({ error: "Admin only" });
        return;
      }

      const body =
        typeof req.body === "string" ? JSON.parse(req.body) : req.body ?? {};

      const appointmentId = String(body.appointmentId ?? body.id ?? "").trim();
      if (!appointmentId) {
        res.status(400).json({ error: "appointmentId missing" });
        return;
      }

      logger.info("Hard delete appointment requested", {
        requesterUid: decoded.uid,
        appointmentId,
      });

      const db = admin.firestore();
      const bucket = admin.storage().bucket();

      // 1) Firestore: appointments/{id} rekursiv löschen (inkl. Subcollections)
      const apptRef = db.doc(`appointments/${appointmentId}`);
      // @ts-ignore - recursiveDelete ist in Admin SDK verfügbar, TS-Typen manchmal nicht.
      await (db as any).recursiveDelete(apptRef);

      // 2) Storage: alles unter appointments/{id}/ löschen
      await bucket.deleteFiles({ prefix: `appointments/${appointmentId}/` }).catch(() => {});

      res.status(200).json({ ok: true, deletedAppointmentId: appointmentId });
    } catch (err: any) {
      logger.error("Hard delete appointment failed", err);
      res.status(401).json({ error: err?.message ?? "Unauthorized" });
    }
  }
);
