"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

function Btn({ children, onClick, href, variant = "secondary", disabled }: any) {
  const base: React.CSSProperties = {
    borderRadius: 12,
    padding: "9px 12px",
    border: "1px solid rgba(0,0,0,0.12)",
    fontWeight: 700,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.06)",
    transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
  };

  const styles: any = {
    primary: { background: "linear-gradient(#f97316, #ea580c)", color: "white", border: "1px solid rgba(234,88,12,0.65)" },
    secondary: { background: "linear-gradient(#ffffff, #f3f4f6)", color: "#111827" },
  };

  const content = (
    <button onClick={onClick} disabled={disabled} style={{ ...base, ...styles[variant] }}>
      {children}
    </button>
  );

  if (href) return <Link href={href} style={{ textDecoration: "none" }}>{content}</Link>;
  return content;
}

export default function NewUserPage() {
  const router = useRouter();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<"user" | "admin">("user");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  async function handleCreate() {
    setErr(null);
    setOk(null);
    setBusy(true);
    try {
      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ firstName, lastName, role, email, password }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setErr(data?.error ?? `Fehler (${res.status})`);
        return;
      }

      setOk("✅ User angelegt.");
      // nach Erfolg zurück zur Profilverwaltung
      router.push("/profile");
    } catch (e: any) {
      setErr(e?.message ?? "Unbekannter Fehler.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>Neuen User anlegen</h1>
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn href="/dashboard" variant="secondary">Dashboard</Btn>
          <Btn href="/profile" variant="secondary">Profilverwaltung</Btn>
        </div>
      </header>

      <section style={{ marginTop: 14, padding: 16, border: "1px solid #e5e7eb", borderRadius: 16, background: "white" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <input
            value={firstName}
            onChange={(e) => setFirstName(e.target.value)}
            placeholder="Vorname"
            style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb" }}
          />
          <input
            value={lastName}
            onChange={(e) => setLastName(e.target.value)}
            placeholder="Nachname"
            style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb" }}
          />

          <select
            value={role}
            onChange={(e) => setRole(e.target.value as any)}
            style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", fontWeight: 800 }}
          >
            <option value="user">user</option>
            <option value="admin">admin</option>
          </select>

          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="E-Mail"
            style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb" }}
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Passwort (mind. 8 Zeichen)"
            type="password"
            style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb" }}
          />

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            <Btn variant="primary" onClick={handleCreate} disabled={busy}>
              {busy ? "Speichere…" : "User anlegen"}
            </Btn>
            <Btn href="/profile" variant="secondary">Abbrechen</Btn>
          </div>

          {err && <p style={{ color: "crimson", fontWeight: 800, marginTop: 8 }}>{err}</p>}
          {ok && <p style={{ color: "green", fontWeight: 800, marginTop: 8 }}>{ok}</p>}
        </div>
      </section>
    </main>
  );
}
