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
    } finally {
      setLoading(false);
    }
  }

  const primaryBtn: React.CSSProperties = {
    padding: "11px 18px",
    borderRadius: 12,
    border: "1px solid rgba(29,78,216,0.65)",
    background: "linear-gradient(#1e3a8a, #1d4ed8)",
    color: "white",
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.7 : 1,
  };

  const secondaryBtn: React.CSSProperties = {
    padding: "11px 18px",
    borderRadius: 12,
    border: "1px solid #c7d2fe",
    background: "linear-gradient(#ffffff, #f3f4f6)",
    color: "#1e3a8a",
    fontWeight: 600,
    cursor: loading ? "not-allowed" : "pointer",
    opacity: loading ? 0.7 : 1,
  };

  return (
    <main
      style={{
        maxWidth: 420,
        margin: "48px 0 0 48px",
        padding: 16,
        fontFamily: "system-ui",
      }}
    >
      {/* Logo linksbündig */}
      <img
        src="/web/logo.svg"
        alt="Logo"
        style={{ height: 110, width: "auto", display: "block", marginBottom: 24 }}
      />

      <h1 style={{ fontSize: 24, fontWeight: 800, marginBottom: 4 }}>
        Login
      </h1>

      <p style={{ color: "#6b7280", fontSize: 14, marginBottom: 20 }}>
        Bitte meld
