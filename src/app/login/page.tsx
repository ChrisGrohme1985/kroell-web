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
    fontWeight
