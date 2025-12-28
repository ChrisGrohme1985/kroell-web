import { auth } from "@/lib/firebase";

/**
 * Vercel ENV (Production):
 *   NEXT_PUBLIC_HARD_DELETE_APPOINTMENT_URL=https://apiharddeleteappointment-xxxxx-uc.a.run.app
 *
 * Lokal kannst du es auch setzen, oder der Default greift.
 */
const DEFAULT_HARD_DELETE_URL =
  "https://apiharddeleteappointment-ml3irepnnq-uc.a.run.app";

function normalizeUrl(url: string): string {
  // Entfernt nur ein einziges trailing "/" damit fetch nicht auf "...app/" läuft
  // (macht bei Cloud Run manchmal Unterschiede je nach Routing)
  return url.endsWith("/") ? url.slice(0, -1) : url;
}

function getHardDeleteUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_HARD_DELETE_APPOINTMENT_URL?.trim();
  return normalizeUrl(envUrl && envUrl.length > 0 ? envUrl : DEFAULT_HARD_DELETE_URL);
}

type HardDeleteOk = { ok: true } | { ok: true; [k: string]: any };
type HardDeleteErr = { ok?: false; error?: string; message?: string; [k: string]: any };

async function readResponsePayload(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    try {
      return await res.json();
    } catch {
      return null;
    }
  }

  try {
    return await res.text();
  } catch {
    return "";
  }
}

/**
 * Hard Delete Appointment (Admin only)
 * - sendet Firebase ID Token als Bearer
 * - Server MUSS CORS + OPTIONS korrekt behandeln (weil Authorization + JSON => Preflight)
 */
export async function apiHardDeleteAppointment(appointmentId: string): Promise<HardDeleteOk> {
  if (!appointmentId || typeof appointmentId !== "string") {
    throw new Error("Hard delete failed: appointmentId is missing/invalid");
  }

  const user = auth.currentUser;
  if (!user) {
    throw new Error("Not authenticated");
  }

  const token = await user.getIdToken();
  const url = getHardDeleteUrl();

  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ appointmentId }),
    });
  } catch (e: any) {
    // Netzwerkfehler (CORS block, DNS, offline, etc.)
    throw new Error(`Hard delete failed: network error (${e?.message ?? "unknown"})`);
  }

  const payload: HardDeleteOk | HardDeleteErr | string | null = await readResponsePayload(res);

  if (!res.ok) {
    const msg =
      typeof payload === "string"
        ? payload
        : payload?.error || payload?.message || JSON.stringify(payload);

    throw new Error(`Hard delete failed (${res.status}): ${msg}`);
  }

  // Manche Functions geben {ok:true} zurück, manche nur {} – wir normalisieren:
  if (payload && typeof payload === "object") {
    return (payload as any).ok === undefined ? ({ ok: true, ...(payload as any) } as any) : (payload as any);
  }

  return { ok: true };
}

/**
 * Alias export (falls irgendwo noch der alte Import genutzt wird)
 * z.B. in dashboard/page.tsx: import { callHardDeleteAppointment } from "@/lib/functionsClient"
 */
export const callHardDeleteAppointment = apiHardDeleteAppointment;
