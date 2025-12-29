"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";

function firebaseNiceError(err: any) {
  const code = err?.code || "";
  // Firebase Auth errors are usually: auth/invalid-credential, auth/user-not-found, auth/wrong-password, auth/operation-not-allowed, ...
  const map: Record<string, string> = {
    "auth/invalid-credential": "Login fehlgeschlagen (E-Mail oder Passwort falsch).",
    "auth/user-not-found": "User nicht gefunden.",
    "auth/wrong-password": "Passwort falsch.",
    "auth/invalid-email": "Ungültige E-Mail-Adresse.",
    "auth/too-many-requests": "Zu viele Versuche – bitte kurz warten.",
    "auth/operation-not-allowed": "Email/Password Login ist in Firebase deaktiviert.",
    "auth/network-request-failed": "Netzwerkfehler (Adblocker/Firewall/Offline?).",
    "auth/user-disabled": "Dieser User ist deaktiviert.",
  };

  const nice = map[code] || "Unbekannter Login-Fehler.";
  const message = err?.message || "";
  return `${nice}\n\ncode: ${code}\nmessage: ${message}`;
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function login() {
    setErr(null);
    setLoading(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), pw);
      router.push("/dashboard");
    } catch (e: any) {
      setErr(firebaseNiceError(e));
      console.error("LOGIN ERROR:", e);
    } finally {
      setLoading(false);
    }
  }

  async function signup() {
    setErr(null);
    setLoading(true);
    try {
      await createUserWithEmailAndPassword(auth, email.trim(), pw);
      router.push("/dashboard");
    } catch (e: any) {
      setErr(firebaseNiceError(e));
      console.error("SIGNUP ERROR:", e);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16, fontFamily: "system-ui" }}>
      <h1 style={{ fontSize: 24, fontWeight: 900 }}>Login</h1>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
        />
        <input
          placeholder="Passwort"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="current-password"
          style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
        />

        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={login} disabled={loading} style={{ padding: "10px 14px" }}>
            {loading ? "..." : "Anmelden"}
          </button>
          <button onClick={signup} disabled={loading} style={{ padding: "10px 14px" }}>
            {loading ? "..." : "Registrieren"}
          </button>
        </div>

        {err && (
          <pre
            style={{
              whiteSpace: "pre-wrap",
              background: "#fff1f2",
              border: "1px solid #fecdd3",
              padding: 12,
              borderRadius: 10,
              color: "#9f1239",
              fontSize: 12,
            }}
          >
            {err}
          </pre>
        )}
      </div>
    </main>
  );
}
