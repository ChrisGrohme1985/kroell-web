"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getOrCreateUserProfile } from "@/lib/authProfile";
import type { Role } from "@/lib/types";

/** ✅ Rolle überall schön anzeigen */
function roleLabel(r?: Role | string) {
  const x = String(r ?? "").toLowerCase();
  if (x === "admin") return "Admin";
  if (x === "user") return "User";
  return r ? String(r) : "—";
}

function Btn({
  children,
  onClick,
  href,
  variant = "secondary",
  disabled,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
}) {
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

  // ✅ NUR "User anlegen" in Navy: primary = navy
  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "linear-gradient(#1e3a8a, #1e40af)", // navy
      color: "white",
      border: "1px solid rgba(30,64,175,0.7)",
    },
    secondary: { background: "linear-gradient(#ffffff, #f3f4f6)", color: "#111827" },
    danger: {
      background: "linear-gradient(#ef4444, #dc2626)",
      color: "white",
      border: "1px solid rgba(220,38,38,0.6)",
    },
  };

  const content = (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...styles[variant] }}
      onMouseDown={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = "scale(0.98)")}
      onMouseUp={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)")}
      onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.transform = "scale(1)")}
    >
      {children}
    </button>
  );

  if (href)
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        {content}
      </Link>
    );
  return content;
}

function makeTempPassword() {
  // 14 chars: gut genug, inkl. Sonderzeichen
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!$%&*?";
  let out = "";
  for (let i = 0; i < 14; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

export default function AdminCreateUserPage() {
  const router = useRouter();

  const [myRole, setMyRole] = useState<Role>("user");
  const [roleLoaded, setRoleLoaded] = useState(false);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<Role>("user");

  // ✅ Email + Passwort
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const [createdInfo, setCreatedInfo] = useState<{ uid: string; email: string; password: string } | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }
      const prof = await getOrCreateUserProfile(u);
      setMyRole(prof.role);
      setRoleLoaded(true);

      if (prof.role !== "admin") {
        router.push("/dashboard");
      }
    });
    return () => unsub();
  }, [router]);

  const canSave = useMemo(() => {
    if (!firstName.trim()) return false;
    if (!lastName.trim()) return false;
    if (!email.trim()) return false;
    if (password.length < 6) return false;
    return true;
  }, [firstName, lastName, email, password]);

  async function handleCreate() {
    setErr(null);
    setOk(null);
    setCreatedInfo(null);

    const u = auth.currentUser;
    if (!u) return;

    setBusy(true);
    try {
      const idToken = await u.getIdToken();

      const res = await fetch("/api/admin/create-user", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          firstName: firstName.trim(),
          lastName: lastName.trim(),
          role,
          email: email.trim(),
          password: password.trim(),
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Fehler (${res.status})`);

      setOk("✅ User wurde angelegt.");
      setCreatedInfo({
        uid: data.uid ?? "—",
        email: data.email ?? email.trim(),
        password: data.password ?? password.trim(),
      });

      router.push("/profile");
    } catch (e: any) {
      setErr(e?.message ?? "Anlegen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  if (!roleLoaded) {
    return (
      <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
        <p>Lade…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 900, margin: "24px auto", padding: 16 }}>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 950, margin: 0 }}>Neuen User anlegen</h1>
          <p style={{ color: "#6b7280", marginTop: 6 }}>
            Nur Admin • Deine Rolle: <b>{roleLabel(myRole)}</b>
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn href="/dashboard" variant="secondary">
            Dashboard
          </Btn>
          <Btn href="/profile" variant="secondary">
            Zurück zur Profilverwaltung
          </Btn>
        </div>
      </header>

      <section style={{ marginTop: 14, padding: 16, border: "1px solid #e5e7eb", borderRadius: 16, background: "white" }}>
        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontWeight: 900 }}>Vorname</label>
            <input
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              placeholder="Max"
              style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb" }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontWeight: 900 }}>Nachname</label>
            <input
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              placeholder="Mustermann"
              style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb" }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontWeight: 900 }}>Rolle</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as Role)}
              style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", fontWeight: 800 }}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          <hr style={{ border: "none", borderTop: "1px solid #e5e7eb", margin: "6px 0" }} />

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontWeight: 900 }}>E-Mail (Login)</label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="max@firma.de"
              style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb" }}
            />
          </div>

          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontWeight: 900 }}>Passwort (initial)</label>
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Initialpasswort"
                style={{ padding: 10, borderRadius: 12, border: "1px solid #e5e7eb", flex: 1, minWidth: 220 }}
              />
              <Btn onClick={() => setPassword(makeTempPassword())} variant="secondary" disabled={busy}>
                Passwort generieren
              </Btn>
            </div>

            <p style={{ marginTop: 6, color: "#6b7280", fontSize: 12 }}>
              Mindestlänge: <b>6 Zeichen</b> (Firebase Auth Vorgabe)
              <br />
              Tipp: Generiere ein Passwort und gib es dem User. Er kann es später ändern.
            </p>
          </div>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            {/* ✅ NUR dieser Button ist navy */}
            <Btn variant="primary" onClick={handleCreate} disabled={busy || !canSave}>
              {busy ? "Speichere…" : "User anlegen"}
            </Btn>

            <Btn variant="secondary" onClick={() => router.push("/profile")} disabled={busy}>
              Abbrechen
            </Btn>
          </div>

          {err && <p style={{ color: "crimson", fontWeight: 800, marginTop: 8 }}>{err}</p>}
          {ok && <p style={{ color: "green", fontWeight: 800, marginTop: 8 }}>{ok}</p>}

          {createdInfo && (
            <div style={{ marginTop: 10, padding: 12, borderRadius: 12, border: "1px solid #e5e7eb", background: "#f9fafb" }}>
              <div style={{ fontWeight: 950 }}>Zugangsdaten</div>
              <div style={{ marginTop: 6, fontFamily: "monospace", fontSize: 12 }}>
                UID: {createdInfo.uid}
                <br />
                Email: {createdInfo.email}
                <br />
                Passwort: {createdInfo.password}
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
