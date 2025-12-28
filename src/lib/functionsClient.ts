import { auth } from "@/lib/firebase";

/**
 * Base URL for Firebase Functions (Gen2 / Cloud Run)
 * Fallback only for local/dev if needed
 */
const GEN2_BASE_URL =
  "https://apiharddeleteappointment-ml3irepnnq-uc.a.run.app";

/**
 * Call Hard Delete Appointment (Admin only)
 */
export async function apiHardDeleteAppointment(appointmentId: string) {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not authenticated");
  }

  const token = await user.getIdToken();

  const res = await fetch(GEN2_BASE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ appointmentId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Hard delete failed: ${text}`);
  }

  return res.json();
}
