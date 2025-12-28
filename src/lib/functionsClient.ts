import { auth } from "@/lib/firebase";

type HardDeleteOk = { ok: true };
type HardDeleteErr = { ok: false; error?: string; message?: string };

type HardDeleteResponse = HardDeleteOk | HardDeleteErr;

/**
 * Gen2 Cloud Run Function URL (FULL URL)
 * Recommended: set in Vercel env:
 * NEXT_PUBLIC_HARD_DELETE_APPOINTMENT_URL=https://apiharddeleteappointment-xxxxx-uc.a.run.app
 */
const HARD_DELETE_URL =
  process.env.NEXT_PUBLIC_HARD_DELETE_APPOINTMENT_URL ||
  "https://apiharddeleteappointment-ml3irepnnq-uc.a.run.app";

function extractErrorMessage(payload: unknown): string {
  if (typeof payload === "string") return payload;

  if (payload && typeof payload === "object") {
    // TS-safe checks:
    const obj = payload as Record<string, unknown>;
    if (typeof obj.error === "string") return obj.error;
    if (typeof obj.message === "string") return obj.message;
  }

  try {
    return JSON.stringify(payload);
  } catch {
    return "Unknown error";
  }
}

/**
 * Call Hard Delete Appointment (Admin only)
 */
export async function apiHardDeleteAppointment(appointmentId: string) {
  const user = auth.currentUser;
  if (!user) throw new Error("Not authenticated");

  const token = await user.getIdToken();

  const res = await fetch(HARD_DELETE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ appointmentId }),
  });

  const contentType = res.headers.get("content-type") || "";
  const payload: unknown = contentType.includes("application/json")
    ? await res.json().catch(() => null)
    : await res.text().catch(() => "");

  if (!res.ok) {
    const msg = extractErrorMessage(payload);
    throw new Error(`Hard delete failed (${res.status}): ${msg}`);
  }

  // Optional: if you expect {ok:true} shape
  return payload as HardDeleteResponse;
}
