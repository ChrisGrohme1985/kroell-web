"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";

function firebaseNiceError(err: any) {
  const code = err?.code || "";
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

  const primaryBtn: React.CSSProperties = {
    flex: 1,
    padding: "11px 16px",
    borderRadius: 12,
    border: "1px solid rgba(29,78,216,0.65)",
    background: "linear-gradient(#1e3a8a, #1d4ed8)", // navyblau
    color: "white",
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.7 : 1,
  };

  return (
    <main
      style={{
        maxWidth: 420,
        margin: "40px auto",
        padding: 16,
        fontFamily: "system-ui",
      }}
    >
      {/* Logo (wie Dashboard) */}
      <div style={{ display: "flex", justifyContent: "center", marginBottom: 24 }}>
        <img
          src="/web/logo.svg"
          alt="Logo"
          style={{ height: 110, width: "auto", display: "block" }}
        />
      </div>

      <h1 style={{ fontSize: 24, fontWeight: 800, textAlign: "center", marginBottom: 8 }}>
        Login
      </h1>

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

        <div style={{ display: "flex", gap: 10, marginTop: 8 }}>
          <button onClick={login} disabled={loading} style={primaryBtn}>
            {loading ? "..." : "Anmelden"}
          </button>
          <button onClick={signup} disabled={loading} style={primaryBtn}>
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
