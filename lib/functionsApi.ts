// web/lib/functionsApi.ts
export const FUNCTIONS_BASE =
  process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL ||
  "https://us-central1-kroell-app.cloudfunctions.net";

type Json = Record<string, any>;

async function postJson<T = any>(path: string, body: Json, idToken: string): Promise<T> {
  const res = await fetch(`${FUNCTIONS_BASE}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify(body),
  });

  const data = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) throw new Error(data?.error ?? `Fehler (${res.status})`);
  return data as T;
}

export async function hardDeleteAppointment(opts: { appointmentId: string; idToken: string }) {
  return postJson("/apiHardDeleteAppointment", { appointmentId: opts.appointmentId }, opts.idToken);
}

export async function hardDeleteSeries(opts: { seriesId: string; idToken: string }) {
  return postJson("/apiHardDeleteSeries", { seriesId: opts.seriesId }, opts.idToken);
}

export async function cleanupOrphans(opts: { dryRun?: boolean; limit?: number; idToken: string }) {
  return postJson("/apiCleanupOrphans", { dryRun: !!opts.dryRun, limit: opts.limit ?? 200 }, opts.idToken);
}
