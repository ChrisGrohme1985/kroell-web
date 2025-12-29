// C:\Users\chriZ\Downloads\Kroell\web\src\lib\functionsClient.ts

import { auth } from "@/lib/firebase";

/**
 * Löscht einen Termin endgültig (Firestore rekursiv + Storage) via Cloud Function.
 *
 * Erwartet .env.local:
 * NEXT_PUBLIC_HARD_DELETE_APPOINTMENT_URL=https://<deine-cloud-run-url>
 */
export async function apiHardDeleteAppointment(appointmentId: string) {
  const url = process.env.NEXT_PUBLIC_HARD_DELETE_APPOINTMENT_URL;

  if (!url) {
    throw new Error(
      "NEXT_PUBLIC_HARD_DELETE_APPOINTMENT_URL fehlt. Prüfe web/.env.local"
    );
  }

  const user = auth.currentUser;
  if (!user) {
    throw new Error("Nicht eingeloggt (auth.currentUser ist null).");
  }

  // ID-Token holen (inkl. Claims)
  const idToken = await user.getIdToken(true);

  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ appointmentId }),
  });

  // Cloud Function liefert JSON
  const data = await resp.json().catch(() => ({}));

  if (!resp.ok) {
    const msg =
      data?.error ||
      `Hard delete failed (HTTP ${resp.status})`;
    throw new Error(msg);
  }

  return data as { ok: boolean; deletedAppointmentId?: string };
}
