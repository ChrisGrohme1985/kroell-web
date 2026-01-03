"use client";

import { useState, type CSSProperties } from "react";
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

  const inputStyle: CSSProperties = {
    padding: 11,
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    fontSize: 14,
    outline: "none",
  };

  const primaryBtn: CSSProperties = {
    padding: "11px 18px",
    borderRadius: 12,
    border: "1px solid rgba(29,78,216,0.65)",
    background: "linear-gradient(#1e3a8a, #1d4ed8)", // Navy Primary
    color: "white",
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.72 : 1,
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 10px 22px rgba(0,0,0,0.06)",
  };

  const secondaryBtn: CSSProperties = {
    padding: "11px 18px",
    borderRadius: 12,
    border: "1px solid #c7d2fe",
    background: "linear-gradient(#ffffff, #f3f4f6)", // Secondary hell
    color: "#1e3a8a",
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.72 : 1,
    boxShadow: "0 1px 1px rgba(0,0,0,0.05), 0 10px 18px rgba(0,0,0,0.06)",
  };

  return (
    <main
      style={{
        maxWidth: 440,
        margin: "48px 0 0 48px",
        padding: 16,
        fontFamily: "system-ui",
      }}
    >
      <img
        src="/web/logo.svg"
        alt="Logo"
        style={{ height: 110, width: "auto", display: "block", marginBottom: 18 }}
      />

      <h1 style={{ fontSize: 24, fontWeight: 800, margin: "0 0 6px 0" }}>Login</h1>
      <p style={{ color: "#6b7280", fontSize: 14, margin: "0 0 18px 0" }}>
        Bitte melde dich mit deinem Konto an.
      </p>

      <div style={{ display: "grid", gap: 12 }}>
        <input
          placeholder="E-Mail"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          style={inputStyle}
        />

        <input
          placeholder="Passwort"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          autoComplete="current-password"
          style={inputStyle}
        />

        <div style={{ display: "flex", gap: 12, marginTop: 6 }}>
          <button onClick={login} disabled={loading} style={primaryBtn}>
            {loading ? "..." : "Anmelden"}
          </button>

          <button onClick={signup} disabled={loading} style={secondaryBtn}>
            {loading ? "..." : "Registrieren"}
          </button>
        </div>

        {err && (
          <pre
            style={{
              marginTop: 10,
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
