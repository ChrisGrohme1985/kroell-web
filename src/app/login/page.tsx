"use client";

import { useState } from "react";
import { auth } from "@/lib/firebase";
import { signInWithEmailAndPassword, createUserWithEmailAndPassword } from "firebase/auth";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();

  async function login() {
    setErr(null);
    try {
      await signInWithEmailAndPassword(auth, email, pw);
      router.push("/dashboard");
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function signup() {
    setErr(null);
    try {
      await createUserWithEmailAndPassword(auth, email, pw);
      router.push("/dashboard");
    } catch (e: any) {
      setErr(e.message);
    }
  }

  return (
    <main style={{ maxWidth: 420, margin: "40px auto", padding: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 900 }}>Login</h1>

      <div style={{ display: "grid", gap: 12, marginTop: 16 }}>
        <input
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
        />
        <input
          placeholder="Passwort"
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          style={{ padding: 10, borderRadius: 10, border: "1px solid #e5e7eb" }}
        />
        <div style={{ display: "flex", gap: 10 }}>
          <button onClick={login}>Anmelden</button>
          <button onClick={signup}>Registrieren</button>
        </div>
        {err && <p style={{ color: "crimson" }}>{err}</p>}
      </div>
    </main>
  );
}
