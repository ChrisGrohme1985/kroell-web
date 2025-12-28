// src/lib/functionsClient.ts

import { auth } from "@/lib/firebase";

function getBaseUrl(): string {
  const env = process.env.NEXT_PUBLIC_FUNCTIONS_BASE_URL?.trim();

  // ✅ Fallback: direkt auf Cloud Functions (dein Projekt)
  // (Wenn du in .env.local was setzt, überschreibt das diese Default-URL)
  const fallback = "https://us-central1-kroell-app.cloudfunctions.net";

  const base = env ? env : fallback;
  return base.replace(/\/+$/, ""); // trailing slashes weg
}

async function getIdTokenOrThrow(): Promise<string> {
  const user = auth.currentUser;
  if (!user) {
    throw new Error("Nicht eingeloggt. Bitte neu einloggen.");
  }

  // ✅ Das ist der Firebase ID Token (JWT), den verifyIdToken() erwartet
  const token = await user.getIdToken(true);
  if (!token || token.split(".").length < 3) {
    throw new Error("Kein gültiger Firebase ID Token (JWT). Bitte neu einloggen.");
  }

  return token;
}

async function fetchJson(url: string, options: RequestInit) {
  const res = await fetch(url, options);

  // Wenn möglich Body lesen (für bessere Fehler)
  const text = await res.text();
  let json: any = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = json?.error || json?.message || text || `HTTP ${res.status}`;
    throw new Error(msg);
  }

  return json;
}

export async function callHardDeleteAppointment(appointmentId: string) {
  const base = getBaseUrl();
  const url = `${base}/apiHardDeleteAppointment`;

  const idToken = await getIdTokenOrThrow();

  // ✅ Wir schicken "id", weil deine Function body.id oder body.appointmentId akzeptiert.
  // So ist es konsistent mit deiner Dashboard-Logik.
  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ id: appointmentId }),
  });
}

export async function callHardDeleteSeries(seriesId: string) {
  const base = getBaseUrl();
  const url = `${base}/apiHardDeleteSeries`;

  const idToken = await getIdTokenOrThrow();

  return fetchJson(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${idToken}`,
    },
    body: JSON.stringify({ seriesId }),
  });
}
