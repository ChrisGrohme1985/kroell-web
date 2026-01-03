"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { getOrCreateUserProfile } from "@/lib/authProfile";
import type { Role } from "@/lib/types";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  Timestamp,
  getDoc,
  where,
  limit,
} from "firebase/firestore";

/** ---------- typography ---------- */

const FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';

const FW_REG = 500;
const FW_MED = 550;
const FW_SEMI = 600;

/** ---------- helpers ---------- */

function roleLabel(r?: Role | string) {
  const x = String(r ?? "").toLowerCase();
  if (x === "admin") return "Admin";
  if (x === "user") return "User";
  return r ? String(r) : "—";
}

const softFieldStyle: React.CSSProperties = {
  padding: 10,
  borderRadius: 14,
  border: "1px solid rgba(0,0,0,0.12)",
  fontFamily: FONT_FAMILY,
  fontWeight: FW_SEMI,
  background: "linear-gradient(#ffffff, #f3f4f6)",
  color: "#111827",
  boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.06)",
  outline: "none",
};

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
    fontFamily: FONT_FAMILY,
    fontWeight: FW_SEMI,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.06)",
    transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
  };

  const styles: Record<string, React.CSSProperties> = {
    primary: {
      background: "linear-gradient(#1e3a8a, #1e40af)",
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

  if (href) {
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        {content}
      </Link>
    );
  }
  return content;
}

function makeTempPassword(len = 12) {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!$%&*?";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function fullNameFromUserDoc(d: any) {
  const fn = String(d?.firstName ?? "").trim();
  const ln = String(d?.lastName ?? "").trim();
  return `${fn} ${ln}`.trim() || String(d?.displayName ?? "").trim() || "—";
}

/** ---------- Urlaub types + date helpers ---------- */

type VacationAppt = {
  id: string;
  title?: string;
  description?: string;
  startDate: Date;
  endDate: Date;
  appointmentType?: string;
  createdByUserId: string;
  deletedAt?: Date | null;
  status?: string; // open/documented/done/...
};

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
function fmtDate(d: Date) {
  return d.toLocaleDateString("de-DE");
}
function dateToYmd(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function ymdToDate(ymd: string) {
  const [y, m, d] = ymd.split("-").map((x) => parseInt(x, 10));
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 12, 0, 0, 0);
}

// Werktage (Mo–Fr) inkl. Start+Ende
function countWeekdaysInclusive(start: Date, end: Date) {
  const s = startOfDay(start);
  const e = startOfDay(end);
  if (e < s) return 0;

  let cnt = 0;
  for (let cur = new Date(s); cur <= e; cur.setDate(cur.getDate() + 1)) {
    const dow = cur.getDay(); // 0=So..6=Sa
    if (dow >= 1 && dow <= 5) cnt++;
  }
  return cnt;
}

function overlapsRangeInclusive(v: VacationAppt, rangeStart: Date, rangeEnd: Date) {
  const s = startOfDay(v.startDate);
  const e = startOfDay(v.endDate);
  const rs = startOfDay(rangeStart);
  const re = startOfDay(rangeEnd);
  return e >= rs && s <= re;
}

function vacationWorkdaysWithinRange(v: VacationAppt, rangeStart: Date, rangeEnd: Date) {
  const s = startOfDay(v.startDate);
  const e = startOfDay(v.endDate);
  const rs = startOfDay(rangeStart);
  const re = startOfDay(rangeEnd);

  const from = s < rs ? rs : s;
  const to = e > re ? re : e;
  if (to < from) return 0;
  return countWeekdaysInclusive(from, to);
}

function isLeapYear(y: number) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

/**
 * Pro-rata Anspruch im laufenden Jahr (tagebasiert):
 * Rundung: Math.round
 */
function proratedEntitlementDays(annual: number, entryDate: Date | null, year: number) {
  const annualSafe = Number.isFinite(annual) ? Math.max(0, annual) : 0;
  if (!entryDate) return annualSafe;

  const yearStart = startOfDay(new Date(year, 0, 1));
  const yearEnd = startOfDay(new Date(year, 11, 31));
  const entry = startOfDay(entryDate);

  if (entry <= yearStart) return annualSafe;
  if (entry > yearEnd) return 0;

  const totalDaysInYear = isLeapYear(year) ? 366 : 365;

  const msPerDay = 24 * 60 * 60 * 1000;
  const employedDays = Math.floor((yearEnd.getTime() - entry.getTime()) / msPerDay) + 1;

  const raw = annualSafe * (employedDays / totalDaysInYear);
  return Math.round(raw);
}

/** ---------- Firestore mapping (appointments) ---------- */

function tsToDate(x: any): Date | null {
  if (!x) return null;
  if (x instanceof Date) return x;
  if (x instanceof Timestamp) return x.toDate();
  if (x?.toDate) return x.toDate();
  if (x?.seconds) return new Date(x.seconds * 1000);
  return null;
}

function fromAppointmentDoc(docu: any): VacationAppt {
  const d = docu.data();
  return {
    id: docu.id,
    title: d.title ?? "",
    description: d.description ?? "",
    startDate: (d.startDate as Timestamp).toDate(),
    endDate: (d.endDate as Timestamp).toDate(),
    appointmentType: String(d.appointmentType ?? "").trim(),
    createdByUserId: String(d.createdByUserId ?? ""),
    deletedAt: tsToDate(d.deletedAt),
    status: String(d.status ?? "").trim(),
  };
}

/** ---------- status display ---------- */

function statusTagProps(kind: "deleted" | "open" | "documented" | "done") {
  if (kind === "deleted") {
    return { text: "Gelöscht", bg: "rgba(239,68,68,0.10)", border: "1px solid rgba(239,68,68,0.30)", color: "#b91c1c" };
  }
  if (kind === "open") {
    return { text: "Offen", bg: "rgba(16,185,129,0.12)", border: "1px solid rgba(16,185,129,0.28)", color: "#065f46" };
  }
  if (kind === "documented") {
    return { text: "Dokumentiert", bg: "rgba(250,204,21,0.18)", border: "1px solid rgba(250,204,21,0.35)", color: "#854d0e" };
  }
  // done
  return { text: "Erledigt", bg: "rgba(59,130,246,0.12)", border: "1px solid rgba(59,130,246,0.30)", color: "#1e3a8a" };
}

function StatusTag({ kind }: { kind: "deleted" | "open" | "documented" | "done" }) {
  const t = statusTagProps(kind);
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "4px 8px",
        borderRadius: 999,
        background: t.bg,
        border: t.border,
        color: t.color,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 12,
        lineHeight: 1,
        whiteSpace: "nowrap",
      }}
    >
      {t.text}
    </span>
  );
}

function normalizeStatusKind(v: VacationAppt): "deleted" | "open" | "documented" | "done" {
  if (v.deletedAt) return "deleted";
  const s = String(v.status ?? "").toLowerCase();
  if (s === "documented") return "documented";
  if (s === "done") return "done";
  return "open";
}

/** ---------- small toggle ---------- */

function SmallToggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation();
        onChange(!checked);
      }}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        border: "1px solid rgba(0,0,0,0.10)",
        background: "linear-gradient(#fff,#f7f7fb)",
        padding: "6px 10px",
        borderRadius: 999,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxShadow: "0 1px 1px rgba(0,0,0,0.05), 0 10px 18px rgba(0,0,0,0.06)",
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 12,
        color: "#111827",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
      title={label}
    >
      <span style={{ color: "#6b7280" }}>{label}</span>
      <span
        aria-hidden="true"
        style={{
          width: 38,
          height: 22,
          borderRadius: 999,
          background: checked ? "rgba(16,185,129,0.30)" : "rgba(156,163,175,0.35)",
          border: checked ? "1px solid rgba(16,185,129,0.55)" : "1px solid rgba(156,163,175,0.55)",
          position: "relative",
          transition: "all 120ms ease",
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: checked ? 18 : 2,
            width: 18,
            height: 18,
            borderRadius: 999,
            background: "white",
            boxShadow: "0 1px 1px rgba(0,0,0,0.20)",
            transition: "left 120ms ease",
          }}
        />
      </span>
    </button>
  );
}

/** ---------- page ---------- */

export default function ProfilePage() {
  const router = useRouter();

  const [myUid, setMyUid] = useState<string>("");
  const [myRole, setMyRole] = useState<Role>("user");
  const [myName, setMyName] = useState("");
  const [roleLoaded, setRoleLoaded] = useState(false);

  // admin list
  const [users, setUsers] = useState<any[]>([]);
  const [selectedUid, setSelectedUid] = useState<string>("");

  // edit selected user
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [role, setRole] = useState<Role>("user");

  // password field
  const [newPassword, setNewPassword] = useState("");


  // email field (Admin)
  const [newEmail, setNewEmail] = useState("");
  // Urlaub-Felder (Admin editierbar)
  const [entryDateYmd, setEntryDateYmd] = useState<string>("");
  const [annualVacationDays, setAnnualVacationDays] = useState<number>(30);
  const [vacationCorrection, setVacationCorrection] = useState<number>(0);
  const [vacationCorrectionReason, setVacationCorrectionReason] = useState<string>("");

  // ✅ Neu: einzelne gelöschte Urlaube NICHT einrechnen (IDs)
  // Feld im User-Doc: vacationExcludeDeletedIds: string[]
  const [vacationExcludeDeletedIds, setVacationExcludeDeletedIds] = useState<string[]>([]);

  // ✅ Neu: Jahr-Auswahl (abhängig vom Eintrittsjahr)
  const thisYear = new Date().getFullYear();
  const [vacationYear, setVacationYear] = useState<number>(thisYear);

  const entryDateObj = useMemo(() => (entryDateYmd ? ymdToDate(entryDateYmd) : null), [entryDateYmd]);

  const availableVacationYears = useMemo(() => {
    const minYearRaw = entryDateObj ? entryDateObj.getFullYear() : thisYear;
    const minYear = Math.min(minYearRaw, thisYear);
    const years: number[] = [];
    for (let y = thisYear; y >= minYear; y--) years.push(y);
    return years;
  }, [entryDateObj, thisYear]);

  useEffect(() => {
    const minYearRaw = entryDateObj ? entryDateObj.getFullYear() : thisYear;
    const minYear = Math.min(minYearRaw, thisYear);
    setVacationYear((cur) => {
      if (cur > thisYear) return thisYear;
      if (cur < minYear) return thisYear;
      return cur;
    });
  }, [entryDateObj, thisYear]);

  const yearSelectStyle: React.CSSProperties = useMemo(() => {
    const arrowColor = "#93c5fd"; // hellblau
    const svg = encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 20 20" fill="none"><path d="M5 7l5 6 5-6" stroke="${arrowColor}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
    );
    return {
      ...softFieldStyle,
      padding: "6px 40px 6px 10px",
      borderRadius: 14,
      fontSize: 13,
      lineHeight: 1.2,
      appearance: "none",
      WebkitAppearance: "none",
      MozAppearance: "none",
      backgroundImage: `url("data:image/svg+xml,${svg}")`,
      backgroundRepeat: "no-repeat",
      backgroundPosition: "right 12px center",
      backgroundSize: "18px 18px",
    };
  }, []);

  // Urlaub-Liste (aktiv + gelöscht)
  const [vacationsActive, setVacationsActive] = useState<VacationAppt[]>([]);
  const [vacationsDeleted, setVacationsDeleted] = useState<VacationAppt[]>([]);
  const vacationsAll = useMemo(() => {
    const merged = [...vacationsActive, ...vacationsDeleted];
    merged.sort((a, b) => b.startDate.getTime() - a.startDate.getTime());
    return merged;
  }, [vacationsActive, vacationsDeleted]);

  const [vacationsLoaded, setVacationsLoaded] = useState(false);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // load my profile
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) return router.push("/login");

      setMyUid(u.uid);

      const prof = await getOrCreateUserProfile(u);
      setMyRole(prof.role);

      try {
        const snap = await getDoc(doc(db, "users", u.uid));
        if (snap.exists()) setMyName(fullNameFromUserDoc(snap.data()));
        else setMyName("—");
      } catch {
        setMyName("—");
      }

      setRoleLoaded(true);
    });

    return () => unsub();
  }, [router]);

  const isAdmin = roleLoaded && myRole === "admin";
  const editingSelf = !!myUid && !!selectedUid && selectedUid === myUid;

  // load users for admin
  useEffect(() => {
    if (!isAdmin) {
      setUsers([]);
      setSelectedUid("");
      return;
    }

    const qUsers = query(collection(db, "users"), orderBy("createdAt", "desc"));
    return onSnapshot(
      qUsers,
      (snap) => {
        const list = snap.docs.map((d) => ({ uid: d.id, ...d.data() }));
        setUsers(list);
        setSelectedUid((cur) => cur || list[0]?.uid || "");
      },
      (e) => console.error("USERS query error:", e)
    );
  }, [isAdmin]);

  const selectedUser = useMemo(() => users.find((x) => x.uid === selectedUid) ?? null, [users, selectedUid]);
  const selectedEmail = useMemo(() => String(selectedUser?.email ?? "").trim(), [selectedUser]);

  // fill form on selection change
  useEffect(() => {
    const u = users.find((x) => x.uid === selectedUid);
    if (!u) return;

    setFirstName(u.firstName ?? "");
    setLastName(u.lastName ?? "");
    setRole((u.role ?? "user") as Role);
    setNewPassword("");
    setNewEmail("");

    const ed: Timestamp | null | undefined = u.entryDate ?? null;
    const edDate = ed?.toDate?.() ?? null;
    setEntryDateYmd(edDate ? dateToYmd(edDate) : "");

    const annual = Number(u.annualVacationDays);
    setAnnualVacationDays(Number.isFinite(annual) ? annual : 30);

    const corr = Number(u.vacationCorrection);
    setVacationCorrection(Number.isFinite(corr) ? corr : 0);

    setVacationCorrectionReason(String(u.vacationCorrectionReason ?? ""));

    const ex = Array.isArray(u.vacationExcludeDeletedIds) ? u.vacationExcludeDeletedIds : [];
    setVacationExcludeDeletedIds(ex.map((x: any) => String(x)).filter(Boolean));

    setMsg(null);
    setErr(null);
  }, [users, selectedUid]);

  // ✅ Admin darf sich selbst NICHT auf user runtersetzen
  useEffect(() => {
    if (!editingSelf) return;
    if (role !== "admin") setRole("admin");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingSelf]);

  // ✅ Urlaube laden: appointments, Terminart == "Urlaub"
  useEffect(() => {
    if (!isAdmin || !selectedUid) {
      setVacationsActive([]);
      setVacationsDeleted([]);
      setVacationsLoaded(false);
      return;
    }

    setVacationsLoaded(false);

    const base = collection(db, "appointments");
    const epochTs = Timestamp.fromDate(new Date(1970, 0, 1));

    // ✅ KEIN Status-Filter -> offen + dokumentiert + done werden alle geladen
    const qActive = query(
      base,
      where("createdByUserId", "==", selectedUid),
      where("appointmentType", "==", "Urlaub"),
      where("deletedAt", "==", null),
      orderBy("startDate", "desc"),
      limit(600)
    );

    const qDel = query(
      base,
      where("createdByUserId", "==", selectedUid),
      where("appointmentType", "==", "Urlaub"),
      where("deletedAt", ">", epochTs),
      orderBy("deletedAt", "desc"),
      limit(600)
    );

    const unsub1 = onSnapshot(
      qActive,
      (snap) => setVacationsActive(snap.docs.map(fromAppointmentDoc)),
      (e) => console.error("VACATIONS active query error:", e)
    );

    const unsub2 = onSnapshot(
      qDel,
      (snap) => setVacationsDeleted(snap.docs.map(fromAppointmentDoc)),
      (e) => console.error("VACATIONS deleted query error:", e)
    );

    const t = setTimeout(() => setVacationsLoaded(true), 150);

    return () => {
      clearTimeout(t);
      unsub1();
      unsub2();
    };
  }, [isAdmin, selectedUid]);

  const canSaveProfile = useMemo(() => {
    if (!isAdmin) return false;
    if (!selectedUid) return false;
    if (!firstName.trim()) return false;
    if (!lastName.trim()) return false;
    if (!role) return false;
    if (editingSelf && role !== "admin") return false;
    return true;
  }, [isAdmin, selectedUid, firstName, lastName, role, editingSelf]);

  const canSetPassword = useMemo(() => {
    if (!isAdmin) return false;
    if (!selectedUid) return false;
    if (newPassword.trim().length < 6) return false;
    return true;
  }, [isAdmin, selectedUid, newPassword]);


  const canSetEmail = useMemo(() => {
    if (!isAdmin) return false;
    if (!selectedUid) return false;
    const em = newEmail.trim();
    if (!em) return false;
    // simple email sanity check
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) return false;
    return true;
  }, [isAdmin, selectedUid, newEmail]);

  // ✅ Für Berechnung: gelöschte Urlaube zählen nur, wenn NICHT explizit ausgeschlossen
  const vacationsForCalc = useMemo(() => {
    return vacationsAll.filter((v) => {
      if (!v.deletedAt) return true;
      return !vacationExcludeDeletedIds.includes(v.id);
    });
  }, [vacationsAll, vacationExcludeDeletedIds]);

  // ✅ Urlaub-Berechnung
  const vacationStats = useMemo(() => {
    const now = new Date();
    const currentYear = now.getFullYear();
    const year = vacationYear;

    const todayReal = startOfDay(now);
    const yearStart = startOfDay(new Date(year, 0, 1));
    const yearEnd = startOfDay(new Date(year, 11, 31));

    const isPastYear = year < currentYear;
    const isCurrentYear = year === currentYear;
    const isFutureYear = year > currentYear;

    const today = isCurrentYear ? todayReal : isPastYear ? yearEnd : yearStart;

    const cutTakenEnd = isCurrentYear ? todayReal : isPastYear ? yearEnd : startOfDay(new Date(year, 0, 0)); // 31.12. Vorjahr
    const cutUpcomingStart = isCurrentYear ? startOfDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)) : yearStart;

    const entryDate = entryDateYmd ? ymdToDate(entryDateYmd) : null;

    const prorated = proratedEntitlementDays(annualVacationDays, entryDate, year);
    const corr = Number.isFinite(vacationCorrection) ? vacationCorrection : 0;

    let taken = 0;
    if (isPastYear || isCurrentYear) {
      for (const v of vacationsForCalc) {
        if (overlapsRangeInclusive(v, yearStart, cutTakenEnd)) taken += vacationWorkdaysWithinRange(v, yearStart, cutTakenEnd);
      }
    }

    let upcoming = 0;
    if (isFutureYear) {
      for (const v of vacationsForCalc) {
        if (overlapsRangeInclusive(v, yearStart, yearEnd)) upcoming += vacationWorkdaysWithinRange(v, yearStart, yearEnd);
      }
    } else {
      for (const v of vacationsForCalc) {
        if (overlapsRangeInclusive(v, cutUpcomingStart, yearEnd)) upcoming += vacationWorkdaysWithinRange(v, cutUpcomingStart, yearEnd);
      }
    }

    const restToday = prorated + corr - taken;
    const restEnd = prorated + corr - (taken + (isPastYear ? 0 : upcoming));

    return {
      year,
      today,
      prorated,
      taken,
      upcoming: isPastYear ? 0 : upcoming,
      restToday,
      restEnd,
      activeCount: vacationsActive.length,
      deletedCount: vacationsDeleted.length,
      excludedDeletedCount: vacationExcludeDeletedIds.length,
    };
  }, [
    vacationsForCalc,
    annualVacationDays,
    entryDateYmd,
    vacationCorrection,
    vacationsActive.length,
    vacationsDeleted.length,
    vacationExcludeDeletedIds.length,
    vacationYear,
  ]);

  async function handleSaveProfile() {
    if (!isAdmin || !selectedUid) return;

    if (selectedUid === myUid && role !== "admin") {
      setErr("Du kannst dich selbst nicht auf User-Level herunterstufen.");
      return;
    }

    setBusy(true);
    setErr(null);
    setMsg(null);

    try {
      const entryDate = entryDateYmd ? ymdToDate(entryDateYmd) : null;

      await updateDoc(doc(db, "users", selectedUid), {
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        role,
        displayName: `${firstName.trim()} ${lastName.trim()}`.trim(),
        updatedAt: Timestamp.now(),

        entryDate: entryDate ? Timestamp.fromDate(entryDate) : null,
        annualVacationDays: Number.isFinite(annualVacationDays) ? Number(annualVacationDays) : 0,
        vacationCorrection: Number.isFinite(vacationCorrection) ? Number(vacationCorrection) : 0,
        vacationCorrectionReason: String(vacationCorrectionReason ?? ""),

        // ✅ Neu
        vacationExcludeDeletedIds: vacationExcludeDeletedIds,
      });

      setMsg("✅ Profil gespeichert.");
    } catch (e: any) {
      setErr(e?.message ?? "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetPassword() {
    if (!isAdmin || !selectedUid) return;

    const pw = newPassword.trim();
    if (pw.length < 6) {
      setErr("Passwort muss mindestens 6 Zeichen haben.");
      return;
    }

    const ok = window.confirm("Passwort wirklich ändern?");
    if (!ok) return;

    setBusy(true);
    setErr(null);
    setMsg(null);

    try {
      const me = auth.currentUser;
      if (!me) throw new Error("Nicht eingeloggt.");
      const idToken = await me.getIdToken();

      const res = await fetch("/api/admin/set-password", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ uid: selectedUid, password: pw }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Fehler (${res.status})`);

      setNewPassword("");
      setMsg("✅ Passwort geändert.");
    } catch (e: any) {
      setErr(e?.message ?? "Passwort ändern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function handleSetEmail() {
    if (!isAdmin || !selectedUid) return;

    const em = newEmail.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setErr("Bitte eine gültige E-Mail-Adresse eingeben.");
      return;
    }

    const ok = window.confirm("E-Mail wirklich ändern?");
    if (!ok) return;

    setBusy(true);
    setErr(null);
    setMsg(null);

    try {
      const me = auth.currentUser;
      if (!me) throw new Error("Nicht eingeloggt.");
      const idToken = await me.getIdToken();

      const res = await fetch("/api/admin/set-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ uid: selectedUid, email: em }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Fehler (${res.status})`);

      // keep user doc in sync
      try {
        await updateDoc(doc(db, "users", selectedUid), { email: em, updatedAt: Timestamp.now() });
      } catch {
        // ignore; API updated auth email, doc can be fixed via profile save if needed
      }

      setNewEmail("");
      setMsg("✅ E-Mail geändert.");
    } catch (e: any) {
      setErr(e?.message ?? "E-Mail ändern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }


  async function handleDeleteUser() {
    if (!isAdmin || !selectedUid) return;

    if (selectedUid === myUid) {
      setErr("Du kannst dich nicht selbst löschen.");
      return;
    }

    const name = selectedUser ? fullNameFromUserDoc(selectedUser) : selectedUid;
    const ok = window.confirm(`User "${name}" wirklich löschen?\n\nDies kann nicht rückgängig gemacht werden.`);
    if (!ok) return;

    setBusy(true);
    setErr(null);
    setMsg(null);

    try {
      const me = auth.currentUser;
      if (!me) throw new Error("Nicht eingeloggt.");
      const idToken = await me.getIdToken();

      const res = await fetch("/api/admin/delete-user", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ uid: selectedUid }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error ?? `Fehler (${res.status})`);

      setMsg("✅ User gelöscht.");
      setSelectedUid("");
    } catch (e: any) {
      setErr(e?.message ?? "User löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeletedVacationInCalc(vacationId: string, shouldCount: boolean) {
    if (!isAdmin || !selectedUid) return;

    const next = shouldCount
      ? vacationExcludeDeletedIds.filter((x) => x !== vacationId)
      : Array.from(new Set([...vacationExcludeDeletedIds, vacationId]));

    setVacationExcludeDeletedIds(next);

    // ✅ optional: sofort speichern (damit es nicht vergessen wird)
    try {
      await updateDoc(doc(db, "users", selectedUid), {
        vacationExcludeDeletedIds: next,
        updatedAt: Timestamp.now(),
      });
    } catch (e) {
      // Fallback: bleibt lokal, wird beim "Profil speichern" endgültig persistiert
      console.error("toggleDeletedVacationInCalc failed:", e);
    }
  }

  if (!roleLoaded) {
    return (
      <main style={{ maxWidth: 1600, margin: "24px auto", padding: 16, fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>
        <p style={{ fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>Lade…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1600, margin: "24px auto", padding: 16, fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, margin: 0 }}>Profilverwaltung</h1>
          <p style={{ color: "#6b7280", marginTop: 6, fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
            {myName || "—"} • Rolle: <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{roleLabel(myRole)}</span>
          </p>
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn href="/dashboard" variant="secondary">
            Zurück zum Dashboard
          </Btn>
          {isAdmin && (
            <Btn href="/admin/users/new" variant="primary">
              + User anlegen
            </Btn>
          )}
        </div>
      </header>

      {isAdmin ? (
        <section style={{ marginTop: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "minmax(520px, 700px) minmax(420px, 560px)", gap: 18, alignItems: "start" }}>
            {/* LEFT */}
            <div style={{ padding: 16, border: "1px solid #e5e7eb", borderRadius: 16, background: "#f3f4f6" }}>
              <div style={{ display: "grid", gap: 12 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>User auswählen</label>
                  <select value={selectedUid} onChange={(e) => setSelectedUid(e.target.value)} style={softFieldStyle} disabled={busy}>
                    {users.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {fullNameFromUserDoc(u)}
                      </option>
                    ))}
                  </select>

                  <div style={{ marginTop: 8, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                    {selectedEmail ? (
                      <>
                        E-Mail: <span style={{ color: "#111827", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{selectedEmail}</span>
                      </>
                    ) : (
                      <>
                        E-Mail: <span style={{ color: "#111827", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>—</span>
                      </>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 10 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Vorname</label>
                    <input value={firstName} onChange={(e) => setFirstName(e.target.value)} style={softFieldStyle} disabled={busy} />
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Nachname</label>
                    <input value={lastName} onChange={(e) => setLastName(e.target.value)} style={softFieldStyle} disabled={busy} />
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Rolle</label>
                    <select
                      value={role}
                      onChange={(e) => setRole(e.target.value as Role)}
                      style={softFieldStyle}
                      disabled={busy || editingSelf}
                      title={editingSelf ? "Du kannst deine eigene Rolle nicht ändern." : undefined}
                    >
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>

                    {editingSelf && (
                      <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        Hinweis: Du kannst deine eigene Rolle nicht ändern.
                      </div>
                    )}
                  </div>

                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Passwort ändern (mind. 6 Zeichen)</label>

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                      <input
                        type="text"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        placeholder="Neues Passwort…"
                        style={{ ...softFieldStyle, flex: 1, minWidth: 220 }}
                        disabled={busy}
                      />

                      <Btn variant="secondary" onClick={() => setNewPassword(makeTempPassword(12))} disabled={busy}>
                        Passwort generieren
                      </Btn>

                      <Btn variant="primary" onClick={handleSetPassword} disabled={busy || !canSetPassword}>
                        Passwort speichern
                      </Btn>
                    </div>

                    {newPassword.trim().length > 0 && newPassword.trim().length < 6 ? (
                      <p style={{ margin: "6px 0 0", color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        Mindestlänge: 6 Zeichen.
                      </p>
                    ) : (
                      <p style={{ margin: "6px 0 0", color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        Tipp: Generiere ein Passwort und gib es dem User. Er kann es später ändern.
                      </p>
                    )}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>E-Mail ändern</label>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <input
                      type="email"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      placeholder="Neue E-Mail…"
                      style={{ ...softFieldStyle, flex: 1, minWidth: 220 }}
                      disabled={busy}
                    />

                    <Btn variant="primary" onClick={handleSetEmail} disabled={busy || !canSetEmail}>
                      E-Mail speichern
                    </Btn>
                  </div>

                  <p style={{ margin: "6px 0 0", color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                    Hinweis: Die E-Mail wird im Auth-Account geändert (und nach Möglichkeit im User-Profil synchronisiert).
                  </p>
                </div>

                <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.10)" }}>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                    <Btn variant="primary" onClick={handleSaveProfile} disabled={busy || !canSaveProfile}>
                      {busy ? "Speichere…" : "Profil speichern"}
                    </Btn>

                    {!editingSelf ? (
                      <Btn variant="danger" onClick={handleDeleteUser} disabled={busy || !selectedUid}>
                        User löschen
                      </Btn>
                    ) : (
                      <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        Du kannst deinen eigenen Account nicht löschen.
                      </div>
                    )}
                  </div>

                  {err && <p style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, marginTop: 10 }}>{err}</p>}
                  {msg && <p style={{ color: "green", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, marginTop: 10 }}>{msg}</p>}
                </div>
              </div>
            </div>

            {/* RIGHT: Urlaub */}
            <aside
              style={{
                border: "1px solid rgba(0,0,0,0.10)",
                borderRadius: 16,
                background: "white",
                padding: 14,
                boxShadow: "0 1px 1px rgba(0,0,0,0.04)",
                position: "sticky",
                top: 16,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "baseline" }}>
                <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
                  <h2 style={{ margin: 0, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 16 }}>Urlaubstage</h2>

                  {/* ✅ Neu: Jahr-Auswahl (Multibox mit Pfeil in hellblau) */}
                  <select
                    value={vacationYear}
                    onChange={(e) => setVacationYear(Number(e.target.value))}
                    style={yearSelectStyle}
                    disabled={busy}
                    aria-label="Urlaubstage Jahr auswählen"
                    title="Jahr auswählen"
                  >
                    {availableVacationYears.map((y) => (
                      <option key={y} value={y}>
                        {y}
                      </option>
                    ))}
                  </select>
                </div>

                <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                  Stand: {fmtDate(vacationStats.today)}
                </div>
              </div>

              <div style={{ display: "grid", gap: 10, marginTop: 10 }}>
                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Eintrittsdatum</label>
                  <input
                    type="date"
                    value={entryDateYmd}
                    onChange={(e) => setEntryDateYmd(e.target.value)}
                    style={softFieldStyle}
                    disabled={busy}
                  />
                  <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                    Anspruch wird im Eintrittsjahr automatisch anteilig berechnet.
                  </div>
                </div>

                <div style={{ display: "grid", gap: 6 }}>
                  <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Jahresurlaubstage</label>
                  <input
                    type="number"
                    value={annualVacationDays}
                    onChange={(e) => setAnnualVacationDays(Number(e.target.value))}
                    style={softFieldStyle}
                    disabled={busy}
                    min={0}
                    step={1}
                  />
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <Row label="Anteiliges Jahreskontingent" value={vacationStats.prorated} />
                  <Row label="Genommener Urlaub" value={vacationStats.taken} />
                  <Row label="Bevorstehender Urlaub" value={vacationStats.upcoming} />
                  <Row label="Resturlaub Stand heute" value={vacationStats.restToday} />
                  <Row label="Resturlaub Stand 31.12" value={vacationStats.restEnd} />

                  <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12, marginTop: 4 }}>
                    Aktive Urlaube: {vacationStats.activeCount} • Gelöschte Urlaube: {vacationStats.deletedCount}
                    {vacationStats.excludedDeletedCount > 0 ? ` • Ausgeschlossen: ${vacationStats.excludedDeletedCount}` : ""}
                  </div>
                </div>

                <div style={{ marginTop: 6, paddingTop: 10, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                  <div style={{ display: "grid", gap: 10 }}>
                    <div style={{ display: "grid", gap: 6 }}>
                      <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Korrigierter Urlaub</label>
                      <input
                        type="number"
                        value={vacationCorrection}
                        onChange={(e) => setVacationCorrection(Number(e.target.value))}
                        style={softFieldStyle}
                        disabled={busy}
                        step={1}
                      />
                      <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        Für den Fall, dass Urlaub nicht stattgefunden hat (z.B. negative Korrektur).
                      </div>
                    </div>

                    <div style={{ display: "grid", gap: 6 }}>
                      <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Begründung</label>
                      <textarea
                        value={vacationCorrectionReason}
                        onChange={(e) => setVacationCorrectionReason(e.target.value)}
                        disabled={busy}
                        placeholder="Kommentar des Admins…"
                        rows={9}
                        style={{
                          padding: 14,
                          borderRadius: 18,
                          border: "1px solid rgba(0,0,0,0.14)",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_MED,
                          background: "linear-gradient(#ffffff, #f7f7fb)",
                          color: "#111827",
                          outline: "none",
                          resize: "vertical",
                          minHeight: 200,
                          lineHeight: 1.45,
                          boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 12px 26px rgba(0,0,0,0.06)",
                        }}
                      />
                      <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        Optionaler Kommentar, warum korrigiert wurde.
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10 }}>
                    <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Urlaubsübersicht</div>
                    <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                      {vacationsLoaded ? `${vacationsAll.length} Einträge` : "Lade…"}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 8, marginTop: 10 }}>
                    {vacationsLoaded && vacationsAll.length === 0 ? (
                      <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        Keine Urlaube gefunden (Terminart „Urlaub“).
                      </div>
                    ) : (
                      vacationsAll.slice(0, 12).map((v) => {
                        const kind = normalizeStatusKind(v);
                        const workdays = countWeekdaysInclusive(v.startDate, v.endDate);

                        const isDeleted = kind === "deleted";
                        const counts = !isDeleted || !vacationExcludeDeletedIds.includes(v.id);

                        return (
                          <div
                            key={v.id}
                            onClick={() => router.push(`/appointments/${v.id}`)}
                            style={{
                              padding: "10px 10px",
                              borderRadius: 12,
                              border: "1px solid rgba(0,0,0,0.08)",
                              cursor: "pointer",
                              background:
                                kind === "deleted"
                                  ? "rgba(239,68,68,0.06)"
                                  : kind === "open"
                                  ? "rgba(16,185,129,0.06)"
                                  : kind === "documented"
                                  ? "rgba(250,204,21,0.08)"
                                  : "rgba(59,130,246,0.06)",
                              display: "grid",
                              gridTemplateColumns: "1fr auto",
                              gap: 10,
                              alignItems: "start",
                            }}
                          >
                            <div style={{ minWidth: 0 }}>
                              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                                <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13, color: "#111827" }}>
                                  {fmtDate(v.startDate)} – {fmtDate(v.endDate)}
                                </div>
                                <StatusTag kind={kind} />
                              </div>

                              <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12, marginTop: 4 }}>
                                {v.title?.trim() ? v.title : "Urlaub"} • {workdays} Werktage
                              </div>
                            </div>

                            {/* ✅ Toggle nur bei GELÖSCHTEN Urlaubs-Terminen */}
                            {isDeleted ? (
                              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                                <SmallToggle
                                  disabled={busy}
                                  checked={counts}
                                  label="In Berechnung"
                                  onChange={(next) => toggleDeletedVacationInCalc(v.id, next)}
                                />
                              </div>
                            ) : (
                              <div />
                            )}
                          </div>
                        );
                      })
                    )}

                    {vacationsAll.length > 12 && (
                      <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        … und {vacationsAll.length - 12} weitere
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </aside>
          </div>
        </section>
      ) : (
        <section style={{ marginTop: 14, padding: 16, border: "1px solid #e5e7eb", borderRadius: 16, background: "white" }}>
          <p style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827", marginTop: 0 }}>
            Du bist eingeloggt als <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{myName || "—"}</span> • Rolle:{" "}
            <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{roleLabel(myRole)}</span>
          </p>
          <p style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
            Als User kannst du hier aktuell nur dein Profil ansehen.
          </p>
        </section>
      )}

      <style jsx>{`
        :global(body) {
          font-family: ${FONT_FAMILY};
          font-weight: ${FW_REG};
        }
        :global(b),
        :global(strong) {
          font-weight: ${FW_SEMI};
        }

        @media (max-width: 1180px) {
          section > div[style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
          aside {
            position: relative !important;
            top: auto !important;
          }
        }
      `}</style>
    </main>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
      <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{label}</div>
      <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{value}</div>
    </div>
  );
}
