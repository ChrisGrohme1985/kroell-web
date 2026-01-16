"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { apiHardDeleteAppointment } from "@/lib/functionsClient";
import { getOrCreateUserProfile } from "@/lib/authProfile";
import type { Role, AppointmentStatus } from "@/lib/types";
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  type QueryConstraint,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { deleteObject, getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";
import JSZip from "jszip";

/** ---------- typography ---------- */
const FONT_FAMILY =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, "Apple Color Emoji", "Segoe UI Emoji"';
const FW_REG = 500;
const FW_MED = 550;
const FW_SEMI = 600;

/** ---------- helpers ---------- */
function pad2(n: number) {
  return String(n).padStart(2, "0");
}
function toDateInputValue(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function toTimeInputValue(d: Date) {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}
function parseLocalDateTime(dateStr: string, timeStr: string) {
  const [y, m, dd] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  return new Date(y, (m ?? 1) - 1, dd ?? 1, hh ?? 0, mm ?? 0, 0, 0);
}
function addMinutes(d: Date, mins: number) {
  return new Date(d.getTime() + mins * 60_000);
}
function clampInt(n: number, min: number, max: number) {
  if (Number.isNaN(n)) return min;
  return Math.max(min, Math.min(max, n));
}
function ceilTo5Minutes(d: Date) {
  const ms = d.getTime();
  const step = 5 * 60_000;
  const rounded = Math.ceil(ms / step) * step;
  const out = new Date(rounded);
  out.setSeconds(0, 0);
  return out;
}
function fmtDateTime(d: Date) {
  const dd = d.toLocaleDateString();
  const tt = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return `${dd} • ${tt}`;
}

/** ✅ date input (YYYY-MM-DD) -> DD.MM.YYYY (de-DE) */
function fmtDateFromInput(dateStr: string) {
  if (!dateStr) return "—";
  const [y, m, d] = dateStr.split("-").map(Number);
  if (!y || !m || !d) return dateStr;
  return new Date(y, m - 1, d).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** ✅ Header-Format: "am DD.MM.YYYY um HH:MM Uhr" */
function fmtHeaderDateTime(d: Date) {
  const dd = d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  const tt = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${dd} um ${tt} Uhr`;
}

function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date) {
  return aStart.getTime() < bEnd.getTime() && aEnd.getTime() > bStart.getTime();
}
function statusLabel(s: string) {
  switch (s) {
    case "open":
      return "Offen";
    case "documented":
      return "Dokumentiert";
    case "done":
      return "Erledigt";
    case "deleted":
      return "Gelöscht";
    default:
      return s;
  }
}
function statusTone(s: AppointmentStatus) {
  if (s === "documented") return "yellow";
  if (s === "done") return "green";
  if (s === "deleted") return "red";
  return "blue";
}
function roleLabel(r?: Role | string) {
  const x = String(r ?? "").toLowerCase();
  if (x === "admin") return "Admin";
  if (x === "user") return "User";
  return r ? String(r) : "—";
}

/** ✅ duration formatting */
function formatDurationLabel(totalMinutes: number) {
  const mins = Math.max(1, Math.round(totalMinutes));
  if (mins < 60) return `${mins} Minuten`;
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    const hourLabel = h === 1 ? "Stunde" : "Stunden";
    if (m === 0) return `${h} ${hourLabel}`;
    return `${h} ${hourLabel} ${m} Minuten`;
  }
  const d = Math.floor(mins / (24 * 60));
  const rest = mins % (24 * 60);
  const h = Math.floor(rest / 60);
  const m = rest % 60;
  const dayLabel = d === 1 ? "Tag" : "Tage";
  const parts: string[] = [`${d} ${dayLabel}`];
  if (h > 0) parts.push(`${h} ${h === 1 ? "Stunde" : "Stunden"}`);
  if (m > 0) parts.push(`${m} Minuten`);
  return parts.join(" ");
}
type DurationUnitUi = "minutes" | "hours" | "days";

function unitUiFactor(u: DurationUnitUi) {
  if (u === "minutes") return 1;
  if (u === "hours") return 60;
  return 24 * 60;
}
function toUiValueAndUnit(totalMinutes: number): { value: number; unit: DurationUnitUi } {
  const mins = Math.max(1, Math.round(totalMinutes));
  if (mins % (24 * 60) === 0) return { value: mins / (24 * 60), unit: "days" };
  if (mins % 60 === 0) return { value: mins / 60, unit: "hours" };
  return { value: mins, unit: "minutes" };
}

/** ---------- UI ---------- */
function Btn({
  children,
  onClick,
  href,
  variant = "secondary",
  disabled,
  style,
  title,
  type = "button",
  target,
  rel,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  href?: string;
  variant?: "primary" | "secondary" | "danger" | "navy" | "mint" | "yellow" | "green";
  disabled?: boolean;
  style?: React.CSSProperties;
  title?: string;
  type?: "button" | "submit";
  target?: string;
  rel?: string;
}) {
  const base: React.CSSProperties = {
    borderRadius: 12,
    padding: "10px 14px",
    border: "1px solid rgba(0,0,0,0.12)",
    fontFamily: FONT_FAMILY,
    fontWeight: FW_SEMI,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.6 : 1,
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 10px 22px rgba(0,0,0,0.06)",    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    textDecoration: "none",
    lineHeight: 1,
  };

  const styles: Record<string, React.CSSProperties> = {
    navy: {
      background: "linear-gradient(#0f2a4a, #0b1f35)",
      color: "white",
      border: "1px solid rgba(11,31,53,0.75)",
    },
    mint: {
      background: "linear-gradient(#ecfdf5, #d1fae5)",
      color: "#065f46",
      border: "1px solid #34d399",
    },
    primary: {
      background: "linear-gradient(#f97316, #ea580c)",
      color: "white",
      border: "1px solid rgba(234,88,12,0.65)",
    },
    secondary: { background: "linear-gradient(#ffffff, #f3f4f6)", color: "#111827" },
    danger: {
      background: "linear-gradient(#ef4444, #dc2626)",
      color: "white",
      border: "1px solid rgba(220,38,38,0.6)",
    },
    yellow: {
      background: "linear-gradient(#FEF9C3, #FDE68A)",
      color: "#92400E",
      border: "1px solid rgba(251,191,36,0.9)",
    },
    green: {
      background: "linear-gradient(#DCFCE7, #BBF7D0)",
      color: "#065F46",
      border: "1px solid rgba(34,197,94,0.75)",
    },
  };

  const commonBtnProps = {
    title,
    style: { ...base, ...styles[variant], ...(style ?? {}) },
    onMouseDown: (e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(0.98)"),
    onMouseUp: (e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)"),
    onMouseLeave: (e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)"),
  };

  if (href) {
    if (target === "_blank") {
      return (
        <a href={href} target={target} rel={rel ?? "noreferrer"} {...commonBtnProps}>
          {children}
        </a>
      );
    }
    return (
      <Link href={href} style={{ textDecoration: "none" }}>
        <span {...(commonBtnProps as any)}>{children}</span>
      </Link>
    );
  }

  return (
    <button type={type} onClick={onClick} disabled={disabled} {...commonBtnProps}>
      {children}
    </button>
  );
}

function Chip({
  label,
  tone,
}: {
  label: string;
  tone: "gray" | "yellow" | "green" | "red" | "blue" | "navy";
}) {
  const map: Record<string, React.CSSProperties> = {
    gray: { background: "linear-gradient(#ffffff,#f3f4f6)", border: "1px solid #e5e7eb", color: "#111827" },
    yellow: {
      background: "linear-gradient(#FEF9C3,#FDE68A)",
      border: "1px solid rgba(251,191,36,0.9)",
      color: "#92400E",
    },
    green: {
      background: "linear-gradient(#DCFCE7,#BBF7D0)",
      border: "1px solid rgba(34,197,94,0.75)",
      color: "#065f46",
    },
    red: {
      background: "linear-gradient(#fff1f2,#ffe4e6)",
      border: "1px solid rgba(244,63,94,0.35)",
      color: "#9f1239",
    },
    blue: {
      background: "linear-gradient(#DBEAFE,#BFDBFE)",
      border: "1px solid rgba(147,197,253,0.95)",
      color: "#1E3A8A",
    },
    navy: {
      background: "linear-gradient(#0f2a4a,#0b1f35)",
      border: "1px solid rgba(11,31,53,0.75)",
      color: "white",
    },
  };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        whiteSpace: "nowrap",
        lineHeight: 1.1,
        borderRadius: 999,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 12,
        ...map[tone],
      }}
    >
      {label}
    </span>
  );
}

function ChipButton({
  label,
  tone,
  onClick,
  disabled,
  title,
}: {
  label: string;
  tone: "yellow" | "green" | "red" | "blue" | "navy"; // ✅ navy ergänzt
  onClick: () => void;
  disabled?: boolean;
  title?: string;
}) {
  const map: Record<string, React.CSSProperties> = {
    yellow: {
      background: "linear-gradient(#FEF9C3,#FDE68A)",
      border: "1px solid rgba(251,191,36,0.9)",
      color: "#92400E",
    },
    green: {
      background: "linear-gradient(#DCFCE7,#BBF7D0)",
      border: "1px solid rgba(34,197,94,0.75)",
      color: "#065f46",
    },
    red: {
      background: "linear-gradient(#fff1f2,#ffe4e6)",
      border: "1px solid rgba(244,63,94,0.35)",
      color: "#9f1239",
    },
    blue: {
      background: "linear-gradient(#DBEAFE,#BFDBFE)",
      border: "1px solid rgba(147,197,253,0.95)",
      color: "#1E3A8A",
    },
    navy: {
      background: "linear-gradient(#0f2a4a, #0b1f35)",
      border: "1px solid rgba(11,31,53,0.75)",
      color: "white",
    },
  };

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "6px 10px",
        whiteSpace: "nowrap",
        lineHeight: 1.1,
        borderRadius: 999,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        ...map[tone],
      }}
      onMouseDown={(e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(0.98)")}
      onMouseUp={(e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)")}
>
      {label}
    </button>
  );
}

function Toggle({
  checked,
  onChange,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={() => !disabled && onChange(!checked)}
      aria-pressed={checked}
      disabled={disabled}
      style={{
        width: 54,
        height: 30,
        borderRadius: 999,
        border: "1px solid rgba(0,0,0,0.12)",
        background: checked ? "linear-gradient(#0f2a4a, #0b1f35)" : "linear-gradient(#ffffff, #f3f4f6)",
        boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 8px 20px rgba(0,0,0,0.06)",
        display: "inline-flex",
        alignItems: "center",
        padding: 3,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        transition: "background 120ms ease",
        fontFamily: FONT_FAMILY,
        fontWeight: FW_REG,
      }}
    >
      <span
        style={{
          width: 24,
          height: 24,
          borderRadius: 999,
          background: "white",
          transform: checked ? "translateX(24px)" : "translateX(0px)",
          transition: "transform 140ms ease",
          boxShadow: "0 1px 2px rgba(0,0,0,0.18)",
        }}
      />
    </button>
  );
}

/** ---------- types ---------- */
type UserOption = { uid: string; name: string };
function niceUserName(x: any) {
  const fn = String(x?.firstName ?? "").trim();
  const ln = String(x?.lastName ?? "").trim();
  const full = `${fn} ${ln}`.trim();
  const dn = String(x?.displayName ?? "").trim();
  const em = String(x?.email ?? x?.mail ?? x?.userEmail ?? "").trim();
  return full || dn || em || "—";
}

function buildUserNameMap(uids: string[], known: Record<string, string>) {
  const map: Record<string, string> = {};
  for (const uid of uids.filter(Boolean)) {
    const name = String(known?.[uid] ?? "").trim();
    if (name) map[uid] = name;
  }
  return map;
}


type PhotoDoc = {
  id: string;
  url: string;
  path?: string;
  originalName?: string;
  comment?: string;
  uploadedAt?: Date | null;
  uploadedByUserId?: string;
  uploadedByName?: string;
};

type PendingPhoto = {
  id: string;
  file: File;
  comment: string;
  previewUrl: string;
};

function uidLike() {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

type ApptLite = {
  id: string;
  title: string;
  startDate: Date;
  endDate: Date;
  status: AppointmentStatus;
  createdByUserId?: string;
  userIds?: string[];
};

/** ---------- time slots ---------- */
function makeTimeSlots(stepMinutes = 5) {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += stepMinutes) out.push(`${pad2(h)}:${pad2(m)}`);
  return out;
}
const TIME_SLOTS = makeTimeSlots(5);
const TIME_SLOTS_ALLDAY = makeTimeSlots(1);
const TIME_SLOTS_WORKING = TIME_SLOTS.filter((t) => t >= "06:00" && t <= "16:00");

function truncateLabel(s: string, max = 18) {
  const x = String(s ?? "");
  if (x.length <= max) return x;
  return x.slice(0, Math.max(0, max - 1)) + "…";
}

/** -----------------------------
 * Recurrence (Serie)
 * ----------------------------- */
type RepeatUnit = "day" | "week" | "month" | "year";
type EndMode = "never" | "onDate" | "afterCount";
type RecurrenceRule = {
  enabled: boolean;
  interval: number;
  unit: RepeatUnit;
  weekdays?: number[];
  monthDay?: number;
  endMode: EndMode;
  endOnDate?: string;
  endAfterCount?: number;
};

const WEEKDAYS: { k: number; label: string }[] = [
  { k: 1, label: "Montag" },
  { k: 2, label: "Dienstag" },
  { k: 3, label: "Mittwoch" },
  { k: 4, label: "Donnerstag" },
  { k: 5, label: "Freitag" },
  { k: 6, label: "Samstag" },
  { k: 0, label: "Sonntag" },
];

function unitLabel(u: RepeatUnit) {
  if (u === "day") return "Tag";
  if (u === "week") return "Woche";
  if (u === "month") return "Monat";
  return "Jahr";
}

function addDays(d: Date, days: number) {
  return new Date(d.getTime() + days * 24 * 60_000);
}
function addMonthsKeepTime(d: Date, months: number) {
  const y = d.getFullYear();
  const m = d.getMonth();
  const day = d.getDate();
  const hh = d.getHours();
  const mm = d.getMinutes();
  const target = new Date(y, m + months, 1, hh, mm, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}
function addYearsKeepTime(d: Date, years: number) {
  const y = d.getFullYear() + years;
  const m = d.getMonth();
  const day = d.getDate();
  const hh = d.getHours();
  const mm = d.getMinutes();
  const target = new Date(y, m, 1, hh, mm, 0, 0);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

function generateOccurrences(params: { startDt: Date; rule: RecurrenceRule; maxCountCap: number }): Date[] {
  const { startDt, rule, maxCountCap } = params;

  let targetCount = maxCountCap;
  let endOn: Date | null = null;

  if (rule.endMode === "afterCount") {
    targetCount = clampInt(rule.endAfterCount ?? 1, 1, maxCountCap);
  } else if (rule.endMode === "onDate") {
    if (!rule.endOnDate) return [startDt];
    const [y, m, d] = rule.endOnDate.split("-").map(Number);
    endOn = new Date(y, (m ?? 1) - 1, d ?? 1, 23, 59, 59, 999);
  } else {
    targetCount = maxCountCap;
  }

  const out: Date[] = [];
  const interval = clampInt(rule.interval ?? 1, 1, 999);

  const shouldStop = (candidate: Date) => {
    if (endOn && candidate.getTime() > endOn.getTime()) return true;
    if (!endOn && out.length >= targetCount) return true;
    return false;
  };

  if (rule.unit === "day") {
    let cur = new Date(startDt);
    while (true) {
      if (shouldStop(cur)) break;
      out.push(new Date(cur));
      cur = addDays(cur, interval);
    }
    return out;
  }

  if (rule.unit === "week") {
    const wd = (rule.weekdays?.[0] ?? startDt.getDay()) as number;
    let cur = new Date(startDt);
    const delta = (wd - cur.getDay() + 7) % 7;
    cur = addDays(cur, delta);

    while (true) {
      if (shouldStop(cur)) break;
      out.push(new Date(cur));
      cur = addDays(cur, interval * 7);
    }
    return out;
  }

  if (rule.unit === "month") {
    const md = clampInt(rule.monthDay ?? startDt.getDate(), 1, 27);
    let cur = new Date(startDt);
    cur = new Date(cur.getFullYear(), cur.getMonth(), md, cur.getHours(), cur.getMinutes(), 0, 0);
    if (cur.getTime() < startDt.getTime()) cur = addMonthsKeepTime(cur, interval);

    while (true) {
      if (shouldStop(cur)) break;
      out.push(new Date(cur));
      cur = addMonthsKeepTime(cur, interval);
      cur = new Date(cur.getFullYear(), cur.getMonth(), md, cur.getHours(), cur.getMinutes(), 0, 0);
    }
    return out;
  }

  {
    let cur = new Date(startDt);
    while (true) {
      if (shouldStop(cur)) break;
      out.push(new Date(cur));
      cur = addYearsKeepTime(cur, interval);
    }
    return out;
  }
}

/** batch helper for series edits */
async function commitBatches(batches: ReturnType<typeof writeBatch>[]) {
  for (const b of batches) await b.commit();
}

/** ✅ download helpers */
function filenameFromPhoto(p: PhotoDoc) {
  // Prefer original uploaded filename (if available)
  if (p.originalName && String(p.originalName).trim()) return String(p.originalName).trim();
  const fromPath = p.path ? p.path.split("/").slice(-1)[0] : "";
  if (fromPath) return fromPath;
  try {
    const u = new URL(p.url);
    const last = u.pathname.split("/").slice(-1)[0];
    return last || "foto.jpg";
  } catch {
    return "foto.jpg";
  }
}
async function downloadBlobAsFile(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
async function fetchAsBlob(url: string) {
  const res = await fetch(`/api/storage-proxy?url=${encodeURIComponent(url)}`);
  if (!res.ok) throw new Error("Download fehlgeschlagen.");
  return await res.blob();
}

export default function AppointmentUnifiedPage() {
  const router = useRouter();
  const params = useParams();
  const rawId = String((params as any)?.id ?? "");
  const isNew = rawId === "new" || !rawId;
  const id = isNew ? "" : rawId;

  /** auth/role */
  const [role, setRole] = useState<Role>("user");
  const [roleLoaded, setRoleLoaded] = useState(false);
  // Aktuell eingeloggter User (UID) – unabhängig von Auswahlfeldern im Termin
  const [authUid, setAuthUid] = useState<string | null>(null);
  const isAdmin = roleLoaded && role === "admin";

  /** ✅ user name map (für Foto-Uploader + Header „Erstellt von“) */
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});
  /** ✅ Namen aus dem Termin-Dokument (damit User keine UIDs sieht, auch wenn users-Collection gesperrt ist) */
  const [apptUserNameById, setApptUserNameById] = useState<Record<string, string>>({});


  /** loading/err/busy */
  const [ready, setReady] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** user options for admin dropdown */
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>(""); // legacy (single)
  const [createdByUserId, setCreatedByUserId] = useState<string>(""); // legacy (single)
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [createdByActorUserId, setCreatedByActorUserId] = useState<string>("");

  /** ✅ Admin-only: Thumbnail Hover Preview (Browser) */
  const [hoverPreview, setHoverPreview] = useState<{ url: string; x: number; y: number } | null>(null);
  const createdByActorName = useMemo(() => {
    return nameFromUid((createdByActorUserId as any) || undefined);
  }, [createdByActorUserId, userNameById]);
  

  /** ✅ Admin: User-Picker UI */
  const [userPickerOpen, setUserPickerOpen] = useState(false);
  const [userSearch, setUserSearch] = useState("");

  const userSearchRef = useRef<HTMLInputElement | null>(null);
  const [isMobileView, setIsMobileView] = useState(false);





  const sortedUserOptions = useMemo(() => {
    return [...userOptions].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "de"));
  }, [userOptions]);

  const filteredUserOptions = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    if (!q) return sortedUserOptions;
    return sortedUserOptions.filter((u) => (u.name || "").toLowerCase().includes(q));
  }, [sortedUserOptions, userSearch]);


  const allUsersSelected = useMemo(() => {
    if (!sortedUserOptions.length) return false;
    return sortedUserOptions.every((u) => selectedUserIds.includes(u.uid));
  }, [sortedUserOptions, selectedUserIds]);

  function toggleUser(uid: string) {
    setSelectedUserIds((prev) => {
      const has = prev.includes(uid);
      const next = has ? prev.filter((x) => x !== uid) : [...prev, uid];
      const primary = next[0] ?? "";
      setCreatedByUserId(primary);
      setSelectedUserId(primary);
      return next;
    });
  }

  function toggleAllUsers() {
    setSelectedUserIds(() => {
      const next = allUsersSelected ? [] : sortedUserOptions.map((u) => u.uid);
      const primary = next[0] ?? "";
      setCreatedByUserId(primary);
      setSelectedUserId(primary);
      return next;
    });
  }

  /** ✅ Ganztägig */
  const [allDay, setAllDay] = useState(false);

  const startTimeSlots = useMemo(() => (allDay ? TIME_SLOTS_ALLDAY : TIME_SLOTS_WORKING), [allDay]);

  /** appointment fields */
  const APPOINTMENT_TYPES = useMemo(() => ["-", "Urlaub"] as const, []);
  const [appointmentType, setAppointmentType] = useState<(typeof APPOINTMENT_TYPES)[number]>("-");
  const [typeOpen, setTypeOpen] = useState(false);
  // ✅ Mobile detection (for compact dropdown on small screens)
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setIsMobileView(Boolean(mq.matches));
    apply();

    // addEventListener is not supported in very old Safari for MediaQueryList
    try {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    } catch {
      mq.addListener(apply);
      return () => mq.removeListener(apply);
    }
  }, []);


  // ✅ Autofocus search input when opening the picker (mobile + desktop)
  useEffect(() => {
    if (!userPickerOpen) return;
    const t = window.setTimeout(() => userSearchRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [userPickerOpen]);

  // ✅ ESC closes the picker
  useEffect(() => {
    if (!userPickerOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setUserPickerOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [userPickerOpen]);
const typeRef = useRef<HTMLDivElement | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  /** ✅ Admin: Rich-Text Toolbar (Beschreibung) */
  const descEditorRef = useRef<HTMLDivElement | null>(null);
  const DESC_COLOR_PRESETS = useMemo(
    () => ["#111827", "#374151", "#ef4444", "#f97316", "#10b981", "#3b82f6", "#8b5cf6"],
    []
  );
  const [descColor, setDescColor] = useState<string>("#111827");

  // Schriftgrößen (3 Stufen)
  type DescFontSize = "small" | "medium" | "large";
  const DESC_FONT_SIZE_MAP: Record<DescFontSize, string> = {
    small: "2",
    medium: "3",
    large: "5",
  };

  const DESC_TOOLBTN_STYLE: React.CSSProperties = {
    padding: "6px 10px",
    borderRadius: 10,
    fontSize: 12,
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 6px 14px rgba(0,0,0,0.06)",
  };

  function escapeHtml(s: string) {
    return String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function descriptionToHtml(raw: string) {
    const v = String(raw ?? "");
    // Wenn HTML-Tags vorhanden sind, rendern wir es direkt (Admin-Editor speichert HTML).
    if (/<[a-z][\s\S]*>/i.test(v)) return v;
    return escapeHtml(v).replace(/\n/g, "<br/>");
  }

  function syncDescFromEditor() {
    const el = descEditorRef.current;
    if (!el) return;
    setDescription(el.innerHTML ?? "");
  }

  function execDesc(cmd: string, value?: string) {
    const el = descEditorRef.current;
    if (!el) return;
    try {
      el.focus();
      if (typeof value !== "undefined") document.execCommand(cmd, false, value);
      else document.execCommand(cmd);
    } catch {}
    syncDescFromEditor();
  }

  function hasDescSelection() {
    if (typeof window === "undefined") return false;
    const el = descEditorRef.current;
    if (!el) return false;
    const sel = window.getSelection?.();
    if (!sel || sel.rangeCount === 0) return false;
    if (sel.isCollapsed) return false;
    const a = sel.anchorNode as any;
    const f = sel.focusNode as any;
    return (a && el.contains(a)) || (f && el.contains(f));
  }


  // Beim Fokussieren sicherstellen, dass NICHT "Bold" als Default aktiv ist
  function ensureDescNotBoldByDefault() {
    try {
      // toggelt nur den Eingabemodus, vorhandene <b>/<strong> bleiben bestehen
      if ((document as any)?.queryCommandState?.("bold")) document.execCommand("bold");
    } catch {}
  }

  // Sync: wenn Beschreibung aus Firestore/State kommt, in den Editor schreiben (ohne Cursor zu zerstören)
  useEffect(() => {
    if (!isAdmin) return;
    const el = descEditorRef.current;
    if (!el) return;
    if (typeof document === "undefined") return;
    if (document.activeElement === el) return;
    // Wenn Beschreibung als Plain-Text (mit \n) gespeichert ist, im Editor korrekt als HTML anzeigen
    const desired = descriptionToHtml(String(description ?? ""));
    if ((el.innerHTML ?? "") !== desired) el.innerHTML = desired;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, description]);

  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  

  useEffect(() => {
    if (allDay) return;
    if (!startTime) return;
    if (startTime < "06:00" || startTime > "16:00") setStartTime("06:00");
  }, [allDay, startTime]);

  const [durationMinutes, setDurationMinutes] = useState<number>(15);

  /** ✅ neue UX-States */
  const [durationValue, setDurationValue] = useState<number>(15);
  const [durationUnit, setDurationUnit] = useState<DurationUnitUi>("minutes");
  const [durationQuick, setDurationQuick] = useState<string>("");

  /** documentation text (Admin + User) */
  const [documentationText, setDocumentationText] = useState("");

  /** status/trash info */
  const [status, setStatus] = useState<AppointmentStatus>("open");
  const [deletedAt, setDeletedAt] = useState<Date | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [seriesIndex, setSeriesIndex] = useState<number | null>(null);

  /** ✅ created/updated for header line */
  const [createdAt, setCreatedAt] = useState<Date | null>(null);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  const isTrash = !!deletedAt;
  const canEditAdmin = isAdmin && !isTrash && !isNew;
  const canEditAdminFields = isAdmin && !isTrash;

  /** ✅ prev/next navigation (GLOBAL innerhalb des gleichen Status) */
  const [prevAppt, setPrevAppt] = useState<ApptLite | null>(null);
  const [nextAppt, setNextAppt] = useState<ApptLite | null>(null);

  function effectiveStatusForNav(): AppointmentStatus {
    // Gelöscht soll IMMER als "deleted" navigieren
    if (isTrash) return "deleted";
    return (status ?? "open") as AppointmentStatus;
  }

  async function loadPrevNextByStatus(params: {
    status: AppointmentStatus;
    start: Date;
    currentId: string;
    /**
     * Für Nicht-Admins dürfen wir i.d.R. nur Termine lesen, bei denen sie Teilnehmer sind.
     * Damit die Navigation (Vorheriger/Nächster) auch für User funktioniert,
     * filtern wir per array-contains auf den aktuellen User.
     */
    restrictToParticipantUid?: string;
  }) {
    const { status, start, currentId, restrictToParticipantUid } = params;

    // ✅ Ziel: Vorheriger/Nächster Termin darf NICHT an fehlenden Composite-Indexes scheitern.
    // Firestore braucht für Kombinationen wie:
    //   where('userIds','array-contains',uid) + where('startDate','>',...) + orderBy('startDate')
    // häufig einen zusammengesetzten Index. Wenn der fehlt, kommt FAILED_PRECONDITION.
    // Damit die Navigation trotzdem zuverlässig funktioniert, machen wir für Nicht-Admins
    // nur "sichere" Queries (ohne orderBy/inequality) und filtern/sortieren clientseitig.
    const baseCol = collection(db, "appointments");

    // ✅ Admin: robuster Fallback (darf alle lesen)
    const adminPrevQ = query(
      baseCol,
      where("startDate", "<", Timestamp.fromDate(start)),
      orderBy("startDate", "desc"),
      limit(80)
    );
    const adminNextQ = query(
      baseCol,
      where("startDate", ">", Timestamp.fromDate(start)),
      orderBy("startDate", "asc"),
      limit(80)
    );

    let prevDocs: any[] = [];
    let nextDocs: any[] = [];

    if (restrictToParticipantUid) {
      const uid = restrictToParticipantUid;

      // ✅ User: wir versuchen zuerst "schöne" Queries mit orderBy(startDate),
      // damit wir zuverlässig alle Termine bekommen (und nicht zufällig von Firestore abgeschnitten werden).
      // Falls dafür ein Composite-Index fehlt, fällt die Query mit FAILED_PRECONDITION.
      // In dem Fall fallen wir auf eine "sichere" Query ohne orderBy zurück.
      const tryGet = async (q: any): Promise<{ ok: boolean; docs: any[] }> => {
        try {
          const snap = await getDocs(q);
          return { ok: true, docs: snap.docs };
        } catch {
          return { ok: false, docs: [] };
        }
      };

      // 1) Erst versuchen wir orderBy(startDate), damit wir die Termine deterministisch und "vollständig" erhalten.
      //    Wenn dafür ein Composite-Index fehlt, fällt die Query → dann Fallback ohne orderBy.
      const participantOrderedQ = query(
        baseCol,
        where("userIds", "array-contains", uid),
        orderBy("startDate", "asc"),
        limit(2000)
      );
      const creatorOrderedQ = query(
        baseCol,
        where("createdByUserId", "==", uid),
        orderBy("startDate", "asc"),
        limit(2000)
      );

      const participantUnorderedQ = query(baseCol, where("userIds", "array-contains", uid), limit(2000));
      const creatorUnorderedQ = query(baseCol, where("createdByUserId", "==", uid), limit(2000));

      const [p1, c1] = await Promise.all([tryGet(participantOrderedQ), tryGet(creatorOrderedQ)]);
      const [p2, c2] = await Promise.all([
        p1.ok ? Promise.resolve({ ok: true, docs: p1.docs }) : tryGet(participantUnorderedQ),
        c1.ok ? Promise.resolve({ ok: true, docs: c1.docs }) : tryGet(creatorUnorderedQ),
      ]);

      const participantDocs = p2.docs;
      const creatorDocs = c2.docs;

      // Wir berechnen prev/next clientseitig aus der Union.
      const allDocs = [...participantDocs, ...creatorDocs];
      prevDocs = allDocs;
      nextDocs = allDocs;
    } else {
      // Admin: darf alle lesen, daher performante serverseitige Queries
      const [prevSnap, nextSnap] = await Promise.all([getDocs(adminPrevQ), getDocs(adminNextQ)]);
      prevDocs = prevSnap.docs;
      nextDocs = nextSnap.docs;
    }


    const mapDocToLite = (d: any): ApptLite => {
      const x = d.data() as any;
      const s = (x.startDate as Timestamp).toDate();
      const e = (x.endDate as Timestamp).toDate();
      const whoArrRaw = Array.isArray(x.userIds) ? x.userIds : (x.createdByUserId ? [x.createdByUserId] : []);
      const whoArr = (whoArrRaw as any[]).map((v) => String(v)).filter(Boolean);
      return {
        id: d.id,
        title: String(x.title ?? ""),
        startDate: s,
        endDate: e,
        status: (x.status ?? "open") as AppointmentStatus,
        createdByUserId: String(x.createdByUserId ?? ""),
        userIds: whoArr,
      };
    };

    const uniqById = (arr: ApptLite[]) => {
      const m = new Map<string, ApptLite>();
      for (const a of arr) m.set(a.id, a);
      return Array.from(m.values());
    };

    const canSee = (a: ApptLite) => {
      if (!restrictToParticipantUid) return true;
      const uid = restrictToParticipantUid;
      if (!uid) return true;
      if (a.createdByUserId === uid) return true;
      return Array.isArray(a.userIds) && a.userIds.includes(uid);
    };

    // Status-Regel für Navigation (wie in der UI gefiltert):
    // - Offen -> nur offen
    // - Dokumentiert -> nur dokumentiert
    // - Erledigt -> nur erledigt
    // - Gelöscht -> nur gelöscht
    const statusOk = (s: AppointmentStatus) => s === status;

    const all = uniqById(
      // bei User sind prevDocs/nextDocs identisch (Union), bei Admin getrennt
      Array.from(new Set([...prevDocs, ...nextDocs])).map(mapDocToLite)
    )
      .filter((x) => x.id !== currentId)
      .filter((x) => statusOk(x.status))
      .filter(canSee);

    const prevCandidates = all
      .filter((x) => x.startDate.getTime() < start.getTime())
      .sort((a, b) => b.startDate.getTime() - a.startDate.getTime());

    const nextCandidates = all
      .filter((x) => x.startDate.getTime() > start.getTime())
      .sort((a, b) => a.startDate.getTime() - b.startDate.getTime());

    const prev = prevCandidates[0] ?? null;
    const next = nextCandidates[0] ?? null;

    setPrevAppt(prev?.id && prev.id !== currentId ? prev : null);
    setNextAppt(next?.id && next.id !== currentId ? next : null);
  }

  useEffect(() => {
    setPrevAppt(null);
    setNextAppt(null);

    if (!roleLoaded) return;
    if (isNew) return;
    if (!id) return;
    if (!startDate || !startTime) return;

    const localStart = parseLocalDateTime(startDate, startTime);

    loadPrevNextByStatus({
      status: effectiveStatusForNav(),
      start: localStart,
      currentId: id,
	      restrictToParticipantUid: isAdmin ? undefined : authUid ?? undefined,
    }).catch(() => {
      setPrevAppt(null);
      setNextAppt(null);
    });
	  }, [roleLoaded, isNew, id, startDate, startTime, status, deletedAt, isAdmin, authUid]);

  /** photos list in edit */
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);
  const [confirmDeletePhotoId, setConfirmDeletePhotoId] = useState<string | null>(null);
  const [deletePhotoBusyId, setDeletePhotoBusyId] = useState<string | null>(null);
  const [deletePhotoErr, setDeletePhotoErr] = useState<string | null>(null);

  /** ✅ Admin: Foto-Kommentare in jedem Status editierbar */
  const [photoCommentDraftById, setPhotoCommentDraftById] = useState<Record<string, string>>({});
  const [photoCommentSaveBusyId, setPhotoCommentSaveBusyId] = useState<string | null>(null);
  const [photoCommentSaveErrId, setPhotoCommentSaveErrId] = useState<string | null>(null);
  const [photoCommentSaveErr, setPhotoCommentSaveErr] = useState<string | null>(null);

  /** create pending photos (new) */
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  /** admin edit pending photos (edit) — EXAKT wie create */
  const [adminPendingPhotos, setAdminPendingPhotos] = useState<PendingPhoto[]>([]);
  const adminFileInputRef = useRef<HTMLInputElement | null>(null);
  const [adminUploadBusy, setAdminUploadBusy] = useState(false);
  const [adminUploadErr, setAdminUploadErr] = useState<string | null>(null);

  /** ✅ user edit pending photos (edit) — EXAKT wie create */
  const [userPendingPhotos, setUserPendingPhotos] = useState<PendingPhoto[]>([]);
  const userFileInputRef = useRef<HTMLInputElement | null>(null);
  const [userDocBusy, setUserDocBusy] = useState(false);
  const [userDocErr, setUserDocErr] = useState<string | null>(null);

  /** collision UX */
  const [dayAppts, setDayAppts] = useState<ApptLite[]>([]);
  const [disabledTimes, setDisabledTimes] = useState<Set<string>>(new Set());
  const [conflictByTime, setConflictByTime] = useState<Record<string, ApptLite>>({});
  const [collisionMsgVisible, setCollisionMsgVisible] = useState(false);
  const [mobileMediaOpen, setMobileMediaOpen] = useState(false);

  // ✅ Mobile: Fotos & Doku-Bilder beim Öffnen immer aufgeklappt (Admin + User)
  useEffect(() => {
    if (isMobileView) setMobileMediaOpen(true);
  }, [isMobileView]);

  const [selectedConflict, setSelectedConflict] = useState<ApptLite | null>(null);

  /** ✅ collision: conflict open as frame */
  const [conflictFrameOpen, setConflictFrameOpen] = useState(false);

  /** SERIES (create) */
  const [recurringEnabled, setRecurringEnabled] = useState(false);
  const [repeatEvery, setRepeatEvery] = useState<number>(1);
  const [repeatUnit, setRepeatUnit] = useState<RepeatUnit>("week");
  const [weekdaySingle, setWeekdaySingle] = useState<number>(1);
  const [monthDay, setMonthDay] = useState<number>(1);
  const [endMode, setEndMode] = useState<EndMode>("never");
  const [endOnDate, setEndOnDate] = useState("");
  const [endAfterCount, setEndAfterCount] = useState<number>(10);

  /** SERIES (edit) */
  const [editSeriesEnabled, setEditSeriesEnabled] = useState(false);
  const hasSeries = !!seriesId;

  /** click outside for appointmentType dropdown */
  useEffect(() => {
    function onDocDown(e: MouseEvent) {
      const el = typeRef.current;
      if (typeOpen && el && !el.contains(e.target as Node)) setTypeOpen(false);
    }
    function onEsc(e: KeyboardEvent) {
      if (e.key === "Escape") setTypeOpen(false);
    }
    document.addEventListener("mousedown", onDocDown, true);
    document.addEventListener("keydown", onEsc, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown, true);
      document.removeEventListener("keydown", onEsc, true);
    };
  }, [typeOpen]);

  useEffect(() => {
    const factor = unitUiFactor(durationUnit);
    const next = clampInt(Math.round(Number(durationValue) * factor), 1, Number.MAX_SAFE_INTEGER);
    if (next !== durationMinutes) setDurationMinutes(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationValue, durationUnit]);

  /** cleanup previews */
  useEffect(() => {
    return () => {
      for (const p of pendingPhotos) URL.revokeObjectURL(p.previewUrl);
      for (const p of adminPendingPhotos) URL.revokeObjectURL(p.previewUrl);
      for (const p of userPendingPhotos) URL.revokeObjectURL(p.previewUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** auth init */
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        router.push("/login");
        return;
      }

      const prof = await getOrCreateUserProfile(u);
      setRole(prof.role);
      setRoleLoaded(true);
	      setAuthUid(u.uid);

      const nowRounded = ceilTo5Minutes(new Date());
      const sDate = toDateInputValue(nowRounded);
      const sTime = toTimeInputValue(nowRounded);
      const end = addMinutes(nowRounded, 15);

      setStartDate(sDate);
      setStartTime(sTime);
      setEndDate(toDateInputValue(end));
      setEndTime(toTimeInputValue(end));
      setDurationMinutes(15);
      setDurationValue(15);
      setDurationUnit("minutes");
      setDurationQuick("");
      setAllDay(false);

      setMonthDay(clampInt(nowRounded.getDate(), 1, 27));

      setSelectedUserId(u.uid);
      setCreatedByUserId(u.uid);
      setSelectedUserIds([u.uid]);

      // USER default "-"
      setAppointmentType("-");

      setReady(true);
    });

    return () => unsub();
  }, [router]);

  /** ✅ load users (Name map) for EVERYONE (für Uploader/Erstellt von) */
  useEffect(() => {
    if (!roleLoaded) return;
    const qUsers = query(collection(db, "users"), limit(2000));
    const unsub = onSnapshot(
      qUsers,
      (snap) => {
        const map: Record<string, string> = {};
        const opts: UserOption[] = [];
        snap.docs.forEach((d) => {
          const data = d.data() as any;
          const name = niceUserName(data);
          map[d.id] = name;
          opts.push({ uid: d.id, name });
        });

        opts.sort((a, b) => a.name.localeCompare(b.name, "de"));
        setUserNameById(map);

        // admin dropdown
        if (isAdmin) {
          setUserOptions(opts);
          setSelectedUserId((cur) => cur || opts[0]?.uid || auth.currentUser?.uid || "");
        } else {
          setUserOptions([]);
        }
      },
      async () => {
        // Falls User keine Berechtigung hat, alle "users" zu lesen (typisch für Nicht-Admins),
        // versuchen wir zumindest den eigenen Namen zu laden.
        if (isAdmin) return;
        const uid = auth.currentUser?.uid;
        if (!uid) return;
        try {
          const me = await getDoc(doc(db, "users", uid));
          if (!me.exists()) return;
          setUserNameById({ [uid]: niceUserName(me.data()) });
        } catch {}
      }
    );
    return () => unsub();
  }, [roleLoaded, isAdmin]);

  /** ✅ For Nicht-Admins: fehlende User-Namen gezielt nachladen (Teilnehmer-Liste, Created-By, Foto-Infos) */
  useEffect(() => {
    if (!roleLoaded) return;
    if (isAdmin) return;

    const ids = Array.from(
      new Set(
        [
          ...(selectedUserIds ?? []),
          ...(createdByUserId ? [createdByUserId] : []),
          ...(createdByActorUserId ? [createdByActorUserId] : []),
        ].filter(Boolean)
      )
    ) as string[];

    const missing = ids.filter((uid) => uid && !userNameById[uid]);
    if (!missing.length) return;

    let cancelled = false;

    (async () => {
      try {
        const docs = await Promise.all(missing.map((uid) => getDoc(doc(db, "users", uid))));
        const next: Record<string, string> = {};
        docs.forEach((snap, i) => {
          if (!snap.exists()) return;
          next[missing[i]] = niceUserName(snap.data());
        });
        if (cancelled) return;
        if (Object.keys(next).length) setUserNameById((prev) => ({ ...prev, ...next }));
      } catch {}
    })();

    return () => {
      cancelled = true;
    };
  }, [roleLoaded, isAdmin, selectedUserIds.join("|"), createdByUserId, createdByActorUserId, Object.keys(userNameById).length]);

  function nameFromUid(uid?: string) {
    if (!uid) return "—";
    return apptUserNameById[uid] || userNameById[uid] || uid;
  }

  /** load existing appointment when edit */
  useEffect(() => {
    if (!roleLoaded) return;
    if (isNew) {
      setLoadingDoc(false);
      return;
    }
    if (!id) return;

    setLoadingDoc(true);
    setErr(null);

    const refAppt = doc(db, "appointments", id);
    const unsub = onSnapshot(
      refAppt,
      (snap) => {
        if (!snap.exists()) {
          setErr("Termin nicht gefunden.");
          setLoadingDoc(false);
          return;
        }

        const d = snap.data() as any;
        const s = (d.startDate as Timestamp).toDate();
        const e = (d.endDate as Timestamp).toDate();

        setTitle(d.title ?? "");
        setDescription(d.description ?? "");
        setAppointmentType((d.appointmentType ?? "-") as any);

        setStartDate(toDateInputValue(s));
        setStartTime(toTimeInputValue(s));
        setEndDate(toDateInputValue(e));
        setEndTime(toTimeInputValue(e));

        const diff = Math.max(1, Math.round((e.getTime() - s.getTime()) / 60_000));
        setDurationMinutes(diff);
        const ui = toUiValueAndUnit(diff);
        setDurationValue(ui.value);
        setDurationUnit(ui.unit);
        setDurationQuick("");

        setAllDay(false);

        setDocumentationText(d.documentationText ?? "");

        setStatus((d.status ?? "open") as any);
        setDeletedAt(d.deletedAt ? (d.deletedAt as Timestamp).toDate() : null);

        setSeriesId(d.seriesId ?? null);
        setSeriesIndex(d.seriesIndex ?? null);

        const whoArrRaw = Array.isArray(d.userIds) ? d.userIds : (d.createdByUserId ? [d.createdByUserId] : []);
        const whoArr = (whoArrRaw as any[]).map((x) => String(x)).filter(Boolean);
        setSelectedUserIds(whoArr);
        const who = whoArr[0] ?? "";
        setCreatedByUserId(who);
        setSelectedUserId(who);

        setCreatedByActorUserId(String(d.createdByActorUserId ?? ""));

        setCreatedAt(d.createdAt ? (d.createdAt as Timestamp).toDate() : null);
        setUpdatedAt(d.updatedAt ? (d.updatedAt as Timestamp).toDate() : null);

        // ✅ Namen-Mapping aus Termin-Dokument (für User sichtbar, auch ohne Zugriff auf users-Collection)
        const mapFromDoc = (d.userNameById && typeof d.userNameById === 'object') ? d.userNameById : null;
        if (mapFromDoc) {
          const cleaned: Record<string, string> = {};
          for (const [k,v] of Object.entries(mapFromDoc)) {
            if (!k) continue;
            const vv = String(v ?? '').trim();
            if (vv) cleaned[String(k)] = vv;
          }
          setApptUserNameById(cleaned);
        } else {
          setApptUserNameById({});
        }

        // ✅ Admin: Mapping im Termin nachpflegen, damit User später Namen statt UIDs sehen
        if (isAdmin) {
          try {
            const extraIds = [
              ...whoArr,
              String(d.createdByActorUserId ?? ""),
              String(d.documentedByUserId ?? ""),
            ].filter(Boolean);
            const desired = buildUserNameMap(Array.from(new Set(extraIds)), userNameById);
            // nur schreiben, wenn wirklich neue Infos da sind
            const current = (mapFromDoc && typeof mapFromDoc === 'object') ? mapFromDoc : {};
            let changed = false;
            for (const [k,v] of Object.entries(desired)) {
              const cur = String((current as any)[k] ?? '').trim();
              const nv = String(v ?? '').trim();
              if (nv && nv !== cur) {
                changed = true;
                break;
              }
            }
            if (changed) {
              updateDoc(doc(db, "appointments", id), { userNameById: { ...(current as any), ...desired } }).catch(() => {});
            }
          } catch {}
        }

        setLoadingDoc(false);
      },
      (e) => {
        setErr(e?.message ?? "Fehler beim Laden.");
        setLoadingDoc(false);
      }
    );

    return () => unsub();
  }, [roleLoaded, isNew, id, isAdmin, Object.keys(userNameById).length, Object.keys(apptUserNameById).length]);

  /** subscribe photos list in edit */
  useEffect(() => {
    if (!roleLoaded) return;
    if (isNew) return;
    if (!id) return;

    const qPhotos = query(collection(db, "appointments", id, "photos"), orderBy("uploadedAt", "desc"));
    const unsub = onSnapshot(
      qPhotos,
      (snap) => {
        const list: PhotoDoc[] = snap.docs.map((d) => {
          const x = d.data() as any;
          const up =
            x.uploadedAt instanceof Timestamp
              ? x.uploadedAt.toDate()
              : x.uploadedAt?.seconds
              ? new Date(x.uploadedAt.seconds * 1000)
              : null;

          return {
            id: d.id,
            url: x.url ?? "",
            path: x.path ?? "",
            originalName: String(x.originalName ?? ""),
            comment: x.comment ?? "",
            uploadedAt: up,
            uploadedByUserId: String(x.uploadedByUserId ?? ""),
            uploadedByName: String(x.uploadedByName ?? ""),
          };
        });
        setPhotos(list);


        // ✅ Admin: auch Foto-Uploader im Mapping nachpflegen (damit User in Doku-Bildern Namen sieht)
        if (isAdmin && id) {
          try {
            const uploaderIds = Array.from(new Set(list.map((p) => String(p.uploadedByUserId ?? "")).filter(Boolean)));
            const missing = uploaderIds.filter((uid) => uid && !apptUserNameById[uid]);
            if (missing.length) {
              const desired = buildUserNameMap(missing, userNameById);
              if (Object.keys(desired).length) {
                updateDoc(doc(db, "appointments", id), {
                  userNameById: { ...(apptUserNameById as any), ...desired },
                }).catch(() => {});
              }
            }
          } catch {}
        }

      },
      () => {}
    );

    return () => unsub();
  }, [roleLoaded, isNew, id, isAdmin, Object.keys(userNameById).length, Object.keys(apptUserNameById).length]);

  /** dt memos */
  const startDt = useMemo(() => {
    if (!startDate || !startTime) return null;
    return parseLocalDateTime(startDate, startTime);
  }, [startDate, startTime]);

  // ✅ Serie (wöchentlich): Standard-Wochentag an Startdatum anpassen
  useEffect(() => {
    if (!recurringEnabled) return;
    if (repeatUnit !== "week") return;
    if (!startDt) return;
    setWeekdaySingle(startDt.getDay());
  }, [recurringEnabled, repeatUnit, startDt]);


  const endDt = useMemo(() => {
    if (!endDate || !endTime) return null;
return parseLocalDateTime(endDate, endTime);
  }, [endDate, endTime]);

  

  /** ✅ effective duration */
  const effectiveDurationMinutes = useMemo(() => {
    if (!allDay) return durationMinutes;
    if (!startDt || !endDt) return durationMinutes;
    const diff = Math.round((endDt.getTime() - startDt.getTime()) / 60_000);
    return diff > 0 ? diff : durationMinutes;
  }, [allDay, durationMinutes, startDt, endDt]);
/** auto end from start+duration (or allDay) */
  const updatingEndRef = useRef(false);
  useEffect(() => {
    if (!startDt) return;
    if (allDay) return;
    updatingEndRef.current = true;

    const nextEnd = addMinutes(startDt, effectiveDurationMinutes);
    setEndDate(toDateInputValue(nextEnd));
    setEndTime(toTimeInputValue(nextEnd));

    const t = setTimeout(() => (updatingEndRef.current = false), 0);
    return () => clearTimeout(t);
  }, [startDate, startTime, durationMinutes, startDt, allDay, effectiveDurationMinutes]);

  /** if end changed manually -> adjust duration (nur wenn nicht ganztägig) */
  useEffect(() => {
    if (!startDt || !endDt) return;
    if (updatingEndRef.current) return;
    if (allDay) return;

    const diff = Math.round((endDt.getTime() - startDt.getTime()) / 60_000);
    if (diff <= 0) return;
    if (diff !== durationMinutes) {
      setDurationMinutes(diff);
      const ui = toUiValueAndUnit(diff);
      setDurationValue(ui.value);
      setDurationUnit(ui.unit);
      setDurationQuick("");
    }
  }, [endDate, endTime, startDt, endDt, durationMinutes, allDay]);

  /** Month day an Start anlehnen, wenn "month" */
  useEffect(() => {
    if (!startDt) return;
    if (repeatUnit !== "month") return;
    setMonthDay(clampInt(startDt.getDate(), 1, 27));
  }, [repeatUnit, startDt]);

  /** recurrence rules */
  const recurrenceRuleCreate: RecurrenceRule = useMemo(() => {
    const base: RecurrenceRule = {
      enabled: !!recurringEnabled,
      interval: clampInt(repeatEvery, 1, 999),
      unit: repeatUnit,
      endMode,
    };

    const withUnit =
      repeatUnit === "week"
        ? { ...base, weekdays: [weekdaySingle] }
        : repeatUnit === "month"
        ? { ...base, monthDay: clampInt(monthDay, 1, 27) }
        : base;

    const withEnd =
      endMode === "onDate"
        ? { ...withUnit, endOnDate: endOnDate || "" }
        : endMode === "afterCount"
        ? { ...withUnit, endAfterCount: clampInt(endAfterCount, 1, 1000) }
        : withUnit;

    return withEnd;
  }, [recurringEnabled, repeatEvery, repeatUnit, weekdaySingle, monthDay, endMode, endOnDate, endAfterCount]);

  const recurrenceUiOkCreate = useMemo(() => {
    if (!recurringEnabled) return true;
    if (repeatEvery < 1) return false;
    if (repeatUnit === "month" && (monthDay < 1 || monthDay > 27)) return false;
    if (repeatUnit === "week" && (weekdaySingle < 0 || weekdaySingle > 6)) return false;
    if (endMode === "onDate") {
      if (!endOnDate) return false;
      if (startDate && endOnDate < startDate) return false;
    }
    if (endMode === "afterCount" && endAfterCount < 1) return false;
    return true;
  }, [recurringEnabled, repeatEvery, repeatUnit, monthDay, weekdaySingle, endMode, endOnDate, startDate, endAfterCount]);

  const seriesRuleEdit: RecurrenceRule = useMemo(() => {
    const base: RecurrenceRule = {
      enabled: true,
      interval: clampInt(repeatEvery, 1, 999),
      unit: repeatUnit,
      endMode,
    };

    const withUnit =
      repeatUnit === "week"
        ? { ...base, weekdays: [weekdaySingle] }
        : repeatUnit === "month"
        ? { ...base, monthDay: clampInt(monthDay, 1, 27) }
        : base;

    const withEnd =
      endMode === "onDate"
        ? { ...withUnit, endOnDate: endOnDate || "" }
        : endMode === "afterCount"
        ? { ...withUnit, endAfterCount: clampInt(endAfterCount, 1, 1000) }
        : withUnit;

    return withEnd;
  }, [repeatEvery, repeatUnit, weekdaySingle, monthDay, endMode, endOnDate, endAfterCount]);

  const seriesUiOkEdit = useMemo(() => {
    if (!editSeriesEnabled) return true;
    if (!hasSeries) return false;
    if (repeatEvery < 1) return false;
    if (repeatUnit === "month" && (monthDay < 1 || monthDay > 27)) return false;
    if (repeatUnit === "week" && (weekdaySingle < 0 || weekdaySingle > 6)) return false;
    if (endMode === "onDate") {
      if (!endOnDate) return false;
      if (startDate && endOnDate < startDate) return false;
    }
    if (endMode === "afterCount" && endAfterCount < 1) return false;
    return true;
  }, [editSeriesEnabled, hasSeries, repeatEvery, repeatUnit, monthDay, weekdaySingle, endMode, endOnDate, startDate, endAfterCount]);

  /** collision strategy */
  const effectiveUserId = useMemo(() => {
    if (isNew) return isAdmin ? selectedUserId : auth.currentUser?.uid ?? "";
    return createdByUserId;
  }, [isNew, isAdmin, selectedUserId, createdByUserId]);

  useEffect(() => {
    async function loadDay() {
      setDayAppts([]);
      setDisabledTimes(new Set());
      setConflictByTime({});
      setSelectedConflict(null);
      setCollisionMsgVisible(false);
      setConflictFrameOpen(false);

      if (!roleLoaded) return;
      if (!effectiveUserId) return;
      if (!startDate) return;

      const dayStart = parseLocalDateTime(startDate, "00:00");
      const nextDay = addMinutes(dayStart, 24 * 60);

      const qDay = query(
        collection(db, "appointments"),
        where("createdByUserId", "==", effectiveUserId),
        where("startDate", "<", Timestamp.fromDate(nextDay)),
        where("endDate", ">", Timestamp.fromDate(dayStart))
      );

      const snap = await getDocs(qDay);

      const list: ApptLite[] = snap.docs
        .map((d) => {
          const x = d.data() as any;
          const st = (x.status ?? "open") as any;
          const isDel = !!x.deletedAt || st === "deleted";
          if (isDel) return null;

          const s = (x.startDate as Timestamp).toDate();
          const e = (x.endDate as Timestamp).toDate();

          return {
            id: d.id,
            title: String(x.title ?? ""),
            startDate: s,
            endDate: e,
            status: st,
            createdByUserId: String(x.createdByUserId ?? ""),
          } as ApptLite;
        })
        .filter(Boolean) as ApptLite[];

      const filtered = isNew ? list : list.filter((a) => a.id !== id);
      filtered.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
      setDayAppts(filtered);
    }

    loadDay().catch(() => setDayAppts([]));
  }, [roleLoaded, effectiveUserId, startDate, isNew, id]);

  useEffect(() => {
    if (!startDate) return;
    if (!dayAppts.length) {
      setDisabledTimes(new Set());
      setConflictByTime({});
      setCollisionMsgVisible(false);
      setSelectedConflict(null);
      return;
    }

    const disabled = new Set<string>();
    const conflictMap: Record<string, ApptLite> = {};

    for (const t of startTimeSlots) {
      const candidateStart = parseLocalDateTime(startDate, t);
      const candidateEnd = addMinutes(candidateStart, effectiveDurationMinutes);

      const hit = dayAppts.find((a) => overlaps(candidateStart, candidateEnd, a.startDate, a.endDate));
      if (hit) {
        disabled.add(t);
        conflictMap[t] = hit;
      }
    }

    setDisabledTimes(disabled);
    setConflictByTime(conflictMap);

    if (startTime && disabled.has(startTime)) {
      setCollisionMsgVisible(true);
      setSelectedConflict(conflictMap[startTime] ?? null);
    } else {
      setCollisionMsgVisible(false);
      setSelectedConflict(null);
    }
  }, [dayAppts, startDate, startTime, effectiveDurationMinutes, startTimeSlots]);

  function onPickStartTime(next: string) {
    setStartTime(next);

    if (disabledTimes.has(next)) {
      setCollisionMsgVisible(true);
      setSelectedConflict(conflictByTime[next] ?? null);
      setConflictFrameOpen(false);
    } else {
      setCollisionMsgVisible(false);
      setSelectedConflict(null);
      setConflictFrameOpen(false);
    }
  }

  function openSelectedConflictInFrame() {
    if (!selectedConflict?.id) return;
    setCollisionMsgVisible(false);
    setErr(null);
    setConflictFrameOpen(true);
  }

  async function findCollisionExact(params: { userId: string; start: Date; end: Date; excludeId?: string }) {
    const { userId, start, end, excludeId } = params;
    const qCol = query(
      collection(db, "appointments"),
      where("createdByUserId", "==", userId),
      where("startDate", "<", Timestamp.fromDate(end)),
      where("endDate", ">", Timestamp.fromDate(start))
    );

    const snap = await getDocs(qCol);

    const hits = snap.docs
      .map((d) => {
        const x = d.data() as any;
        const st = (x.status ?? "open") as any;
        const isDel = !!x.deletedAt || st === "deleted";
        if (isDel) return null;

        const s = (x.startDate as Timestamp).toDate();
        const e = (x.endDate as Timestamp).toDate();

        return {
          id: d.id,
          title: String(x.title ?? ""),
          startDate: s,
          endDate: e,
          status: st,
          createdByUserId: String(x.createdByUserId ?? ""),
        } as ApptLite;
      })
      .filter(Boolean) as ApptLite[];

    const filtered = excludeId ? hits.filter((x) => x.id !== excludeId) : hits;
    filtered.sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    return filtered[0] ?? null;
  }

  async function findFirstCollisionInStarts(params: {
    userId: string;
    starts: Date[];
    durationMinutes: number;
    excludeId?: string;
  }) {
    const { userId, starts, durationMinutes, excludeId } = params;
    for (const s of starts) {
      const e = addMinutes(s, durationMinutes);
      const c = await findCollisionExact({ userId, start: s, end: e, excludeId });
      if (c) return c;
    }
    return null;
  }

  /** pending photo helpers (generic) */
  function addSelectedFilesToState(
    files: FileList | null,
    setter: React.Dispatch<React.SetStateAction<PendingPhoto[]>>,
    inputRef?: React.RefObject<HTMLInputElement | null>
  ) {
    if (!files || files.length === 0) return;

    const next: PendingPhoto[] = [];
    for (const f of Array.from(files)) {
      if (!f.type?.startsWith("image/")) continue;
      const previewUrl = URL.createObjectURL(f);
      next.push({ id: uidLike(), file: f, comment: "", previewUrl });
    }

    if (next.length) setter((prev) => [...prev, ...next]);
    if (inputRef?.current) inputRef.current.value = "";
  }

  function removePendingPhotoFromState(pid: string, setter: React.Dispatch<React.SetStateAction<PendingPhoto[]>>) {
    setter((prev) => {
      const p = prev.find((x) => x.id === pid);
      if (p) URL.revokeObjectURL(p.previewUrl);
      return prev.filter((x) => x.id !== pid);
    });
  }

  function clearPendingState(setter: React.Dispatch<React.SetStateAction<PendingPhoto[]>>) {
    setter((prev) => {
      for (const p of prev) URL.revokeObjectURL(p.previewUrl);
      return [];
    });
  }

  function guessExt(name: string) {
    const m = name.toLowerCase().match(/\.(jpg|jpeg|png|webp|gif)$/);
    return m?.[1] ?? "jpg";
  }

function stripExtension(filename: string) {
  const lastDot = filename.lastIndexOf(".");
  if (lastDot <= 0) return filename;
  return filename.slice(0, lastDot);
}

function truncateForUi(value: string, max = 25) {
  const v = String(value ?? "");
  if (v.length <= max) return v;
  return `${v.slice(0, Math.max(0, max - 1))}…`;
}

function displayUploadFilename(fullName: string) {
  // UI: max 25 Zeichen, ohne Dateiendung
  return truncateForUi(stripExtension(fullName), 25);
}
/** ---------- photo upload: resize/compress ---------- */
/**
 * Ziel: Storage nicht vollmüllen.
 * - Max. Kantenlänge: 1200px
 * - JPEG Qualität: 0.8
 * - GIFs bleiben unverändert (sonst geht Animation verloren)
 */
const UPLOAD_MAX_EDGE_PX = 1200;
const UPLOAD_JPEG_QUALITY = 0.8;

async function loadImageSource(file: File): Promise<{
  width: number;
  height: number;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup?: () => void;
}> {
  // Prefer createImageBitmap (schnell + robust), fallback auf <img> falls nicht verfügbar
  const anyWin = window as any;
  if (typeof anyWin.createImageBitmap === "function") {
    const bmp = await createImageBitmap(file);
    return {
      width: bmp.width,
      height: bmp.height,
      draw: (ctx, w, h) => ctx.drawImage(bmp as any, 0, 0, w, h),
      cleanup: () => {
        try {
          (bmp as any).close?.();
        } catch {}
      },
    };
  }

  const url = URL.createObjectURL(file);
  const img = new Image();
  (img as any).decoding = "async";
  img.src = url;
  try {
    await (img as any).decode?.();
  } catch {
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("Bild konnte nicht geladen werden."));
    });
  } finally {
    URL.revokeObjectURL(url);
  }

  return {
    width: img.naturalWidth || img.width,
    height: img.naturalHeight || img.height,
    draw: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
  };
}

async function resizeToJpegBlob(file: File, maxEdgePx = UPLOAD_MAX_EDGE_PX, quality = UPLOAD_JPEG_QUALITY): Promise<Blob> {
  // GIF unverändert lassen (Animation)
  if (String(file.type || "").toLowerCase() === "image/gif") return file;

  const src = await loadImageSource(file);

  const maxEdge = Math.max(1, Math.floor(maxEdgePx));
  const scale = Math.min(1, maxEdge / Math.max(src.width, src.height));
  const w = Math.max(1, Math.round(src.width * scale));
  const h = Math.max(1, Math.round(src.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas nicht verfügbar.");

  // High quality downscale
  (ctx as any).imageSmoothingEnabled = true;
  (ctx as any).imageSmoothingQuality = "high";

  src.draw(ctx, w, h);
  src.cleanup?.();

  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("JPEG-Konvertierung fehlgeschlagen."))),
      "image/jpeg",
      Math.min(1, Math.max(0.1, Number(quality) || UPLOAD_JPEG_QUALITY))
    );
  });

  return blob;
}


  /** ✅ Upload PendingPhoto[] -> Storage + photos subcollection */
  async function uploadPendingPhotoArray(params: {
    apptId: string;
    items: PendingPhoto[];
    allowPhotoCountUpdate: boolean;
  }) {
    const { apptId, items, allowPhotoCountUpdate } = params;

    const u = auth.currentUser;
    if (!u) throw new Error("Nicht eingeloggt.");

    let success = 0;

    for (let i = 0; i < items.length; i++) {
      const p = items[i];

      // ✅ Standard: Fotos clientseitig verkleinern + als JPEG komprimieren (wie "Apple Mail: Groß")
      // GIFs bleiben original (sonst geht Animation verloren)
      const isGif = String(p.file.type || "").toLowerCase() === "image/gif" || guessExt(p.file.name) === "gif";

      let body: Blob | File = p.file;
      let contentType = p.file.type || "application/octet-stream";
      let outExt = guessExt(p.file.name);

      if (!isGif) {
        try {
          body = await resizeToJpegBlob(p.file, UPLOAD_MAX_EDGE_PX, UPLOAD_JPEG_QUALITY);
          contentType = "image/jpeg";
          outExt = "jpg";
        } catch {
          // Fallback: Original hochladen, falls Resize fehlschlägt
          body = p.file;
          contentType = p.file.type || "application/octet-stream";
          outExt = guessExt(p.file.name);
        }
      }

      const path = `appointments/${apptId}/photos/${u.uid}/${Date.now()}_${i}_${u.uid}.${outExt}`;
      const sRef = storageRef(storage, path);

      await uploadBytes(sRef, body, { contentType });
      const url = await getDownloadURL(sRef);

      await addDoc(collection(db, "appointments", apptId, "photos"), {
        url,
        path,
        originalName: p.file.name,
        comment: p.comment?.trim() ?? "",
        uploadedAt: serverTimestamp(),
        uploadedByUserId: u.uid,
        uploadedByName: nameFromUid(u.uid),
      });

      success++;

      if (allowPhotoCountUpdate) {
        await updateDoc(doc(db, "appointments", apptId), {
          photoCount: increment(1),
          updatedAt: serverTimestamp(),
        });
      }
    }

    return success;
  }

  /** create: upload pending photos to first appointment (no count update: already set on create) */
  async function uploadPendingPhotos(apptId: string) {
    if (pendingPhotos.length === 0) return 0;
    const items = pendingPhotos;
    const success = await uploadPendingPhotoArray({ apptId, items, allowPhotoCountUpdate: false });
    clearPendingState(setPendingPhotos);
    return success;
  }

  /** admin edit: upload pending photos */
  async function uploadAdminPendingPhotos() {
    if (!isAdmin || isTrash || !id) return;
    if (adminPendingPhotos.length === 0) return;

    if (status === "documented" || status === "done") {
      setAdminUploadErr("Hochladen nicht möglich, Termin bereits dokumentiert/erledigt.");
      return;
    }

    setAdminUploadBusy(true);
    setAdminUploadErr(null);
    try {
      await uploadPendingPhotoArray({ apptId: id, items: adminPendingPhotos, allowPhotoCountUpdate: true });
      clearPendingState(setAdminPendingPhotos);
    } catch (e: any) {
      setAdminUploadErr(e?.message ?? "Upload fehlgeschlagen.");
    } finally {
      setAdminUploadBusy(false);
    }
  }

  /** ✅ user edit: documentation save -> upload pending like create UI, then status documented */
  async function handleUserDocumentationSave() {
    if (isNew) return;
    if (!id) return;
    if (isTrash) return;

    if (status !== "open") {
      setUserDocErr("Dokumentation nicht möglich: Termin ist nicht mehr offen.");
      return;
    }

    const u = auth.currentUser;
    if (!u) return;

    setUserDocBusy(true);
    setUserDocErr(null);

    try {
      if (userPendingPhotos.length > 0) {
        await uploadPendingPhotoArray({ apptId: id, items: userPendingPhotos, allowPhotoCountUpdate: false });
        clearPendingState(setUserPendingPhotos);
      }

      await updateDoc(doc(db, "appointments", id), {
        documentationText: documentationText.trim(),
        status: "documented",
        documentedAt: serverTimestamp(),
        documentedByUserId: u.uid,
        updatedAt: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      setUserDocErr(e?.message ?? "Dokumentation speichern fehlgeschlagen.");
    } finally {
      setUserDocBusy(false);
    }
  }

  /** admin: status actions */
  async function markAsDocumentedAdmin() {
    if (!canEditAdmin || !id) return;
    if (deletedAt) return;

    setBusy(true);
    setErr(null);
    try {
      await updateDoc(doc(db, "appointments", id), {
        status: "documented",
        documentedAt: serverTimestamp(),
        documentedByUserId: auth.currentUser?.uid ?? null,
        updatedAt: serverTimestamp(),
      });
      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Status ändern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function markAsDoneAdmin() {
    if (!canEditAdmin || !id) return;
    if (deletedAt) return;

    setBusy(true);
    setErr(null);
    try {
      await updateDoc(doc(db, "appointments", id), {
        status: "done",
        doneAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Status ändern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  /** ✅ Status-Chip Rotation: Offen → Dokumentiert → Erledigt → Offen (Admin only, nicht bei Gelöscht) */
  async function cycleStatusChip() {
    if (!canEditAdmin || !id) return;
    if (deletedAt) return; // ✅ gelöscht: keine Rotation

    const next: AppointmentStatus =
      status === "open" ? "documented" : status === "documented" ? "done" : "open";

    setBusy(true);
    setErr(null);
    try {
      const payload: any = {
        status: next,
        updatedAt: serverTimestamp(),
      };

      if (next === "documented") {
        payload.documentedAt = serverTimestamp();
        payload.documentedByUserId = auth.currentUser?.uid ?? null;
        payload.doneAt = null;
      } else if (next === "done") {
        payload.doneAt = serverTimestamp();
      } else {
        // back to open
        payload.documentedAt = null;
        payload.documentedByUserId = null;
        payload.doneAt = null;
      }

      await updateDoc(doc(db, "appointments", id), payload);
      setStatus(next);
    } catch (e: any) {
      setErr(e?.message ?? "Status ändern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** admin: delete appointment (soft delete) */
  async function deleteAppointmentAdmin() {
    if (!canEditAdmin || !id) return;

    const ok = window.confirm("Soll dieser Termin wirklich gelöscht werden? (Papierkorb)");
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await updateDoc(doc(db, "appointments", id), {
        deletedAt: serverTimestamp(),
        deletedByUserId: auth.currentUser?.uid ?? null,
        status: "deleted",
        updatedAt: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }
  /** admin: restore appointment (undo soft delete) */
  async function restoreAppointmentAdmin() {
    if (!isAdmin || !id) return;
    if (!deletedAt) return;

    const ok = window.confirm("Soll dieser Termin wiederhergestellt werden?");
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await updateDoc(doc(db, "appointments", id), {
        deletedAt: null,
        deletedByUserId: null,
        status: "open",
        updatedAt: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Wiederherstellen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** admin: permanently delete appointment (hard delete) */
  async function hardDeleteAppointmentAdmin() {
    if (!isAdmin || !id) return;

    const ok = window.confirm(
      "ACHTUNG: Soll dieser Termin endgültig gelöscht werden?\n\nDies kann nicht rückgängig gemacht werden."
    );
    if (!ok) return;

    setBusy(true);
    setErr(null);
    try {
      await apiHardDeleteAppointment(id);
      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Endgültig löschen fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** ✅ Admin: Termin kopieren -> neues Doc, Status open, gleiche Daten, ✅ MIT Fotos & allen Usern */
  async function copyAppointmentAdmin() {
    if (!isAdmin || isNew || isTrash || !id) return;

    const ok = window.confirm(`Termin kopieren?

Es wird ein neuer Termin mit Status „Offen“ erstellt – inklusive aller ausgewählten User und aller Fotos.`);
    if (!ok) return;

    setBusy(true);
    setErr(null);

    try {
      // 1) Quelle laden
      const srcSnap = await getDoc(doc(db, "appointments", id));
      if (!srcSnap.exists()) throw new Error("Quelle nicht gefunden.");
      const d = srcSnap.data() as any;

      const s = (d.startDate as Timestamp).toDate();
      const e = (d.endDate as Timestamp).toDate();

      const srcUserIds: string[] = Array.isArray(d.userIds)
        ? (d.userIds as any[]).map((x) => String(x)).filter(Boolean)
        : [String(d.createdByUserId ?? "").trim()].filter(Boolean);

      // 2) Neues Termin-Doc erstellen
      const newRef = await addDoc(collection(db, "appointments"), {
        title: String(d.title ?? "").trim(),
        description: String(d.description ?? "").trim(),
        startDate: Timestamp.fromDate(s),
        endDate: Timestamp.fromDate(e),
        status: "open",

        // ✅ Teilnehmer / Multi-User
        createdByUserId: String(d.createdByUserId ?? auth.currentUser?.uid ?? ""),
        userIds: srcUserIds,
        // ✅ Namenmapping im Termin speichern (damit User Teilnehmernamen sieht)
        userNameById: buildUserNameMap(srcUserIds, userNameById),

        appointmentType: String(d.appointmentType ?? "-"),

        // wie vorher: neue Doku starten
        documentationText: "",
        adminNote: "",

        photoCount: 0,
        deletedAt: null,
        locked: false,
        documentedByUserId: null,
        documentedAt: null,
        doneAt: null,

        isRecurring: false,
        seriesId: null,
        recurrence: null,
        seriesIndex: null,

        createdAt: serverTimestamp(),
        createdByActorUserId: auth.currentUser?.uid ?? null,
        updatedAt: serverTimestamp(),
      });

      // 3) Fotos kopieren (Firestore + Storage)
      const srcPhotosSnap = await getDocs(query(collection(db, "appointments", id, "photos"), orderBy("uploadedAt", "asc")));
      if (!srcPhotosSnap.empty) {
        let copied = 0;

        for (let i = 0; i < srcPhotosSnap.docs.length; i++) {
          const pd = srcPhotosSnap.docs[i].data() as any;
          const url = String(pd.url ?? "");
          if (!url) continue;

          // blob holen
          const blob = await fetchAsBlob(url);

          const originalName = String(pd.originalName ?? "").trim();
          const ext = guessExt(originalName || url) || "jpg";
          const byUid = String(pd.uploadedByUserId ?? "system").trim() || "system";

          const path = `appointments/${newRef.id}/photos/${byUid}/${Date.now()}_${i}_${byUid}.${ext}`;
          const sRef = storageRef(storage, path);

          const contentType = (blob as any).type || "application/octet-stream";
          await uploadBytes(sRef, blob, { contentType });
          const newUrl = await getDownloadURL(sRef);

          await addDoc(collection(db, "appointments", newRef.id, "photos"), {
            url: newUrl,
            path,
            originalName,
            comment: String(pd.comment ?? ""),
            uploadedAt: serverTimestamp(),
            uploadedByUserId: byUid,
            uploadedByName: String(pd.uploadedByName ?? "").trim() || nameFromUid(byUid),
          });

          copied++;
        }

        if (copied > 0) {
          await updateDoc(doc(db, "appointments", newRef.id), {
            photoCount: copied,
            updatedAt: serverTimestamp(),
          });
        }
      }

      router.push(`/appointments/${newRef.id}`);
    } catch (e: any) {
      setErr(e?.message ?? "Kopieren fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** ✅ Download: einzelnes Foto */
  async function downloadSinglePhoto(p: PhotoDoc) {
    try {
      const blob = await fetchAsBlob(p.url);
      await downloadBlobAsFile(blob, filenameFromPhoto(p));
    } catch (e: any) {
      alert(e?.message ?? "Download fehlgeschlagen.");
    }
  }

  /** ✅ Admin: Foto-Kommentar speichern (in jedem Status, auch Papierkorb) */
  function photoCommentUiValue(p: PhotoDoc) {
    if (!p?.id) return "";
    return photoCommentDraftById[p.id] ?? (p.comment ?? "");
  }

  async function savePhotoCommentAdmin(p: PhotoDoc) {
    if (!isAdmin || isNew || !id || !p?.id) return;
    const draft = photoCommentDraftById[p.id];
    if (draft === undefined) return;

    const next = String(draft ?? "").trim();
    const prev = String(p.comment ?? "").trim();
    if (next === prev) {
      // nichts geändert -> Draft weg
      setPhotoCommentDraftById((cur) => {
        const copy = { ...cur };
        delete copy[p.id];
        return copy;
      });
      return;
    }

    setPhotoCommentSaveBusyId(p.id);
    setPhotoCommentSaveErr(null);
    setPhotoCommentSaveErrId(null);
    try {
      await updateDoc(doc(db, "appointments", id, "photos", p.id), {
        comment: next,
      });
      // Draft entfernen, Snapshot übernimmt
      setPhotoCommentDraftById((cur) => {
        const copy = { ...cur };
        delete copy[p.id];
        return copy;
      });
    } catch (e: any) {
      setPhotoCommentSaveErrId(p.id);
      setPhotoCommentSaveErr(e?.message ?? "Kommentar speichern fehlgeschlagen.");
    } finally {
      setPhotoCommentSaveBusyId(null);
    }
  }

  /** ✅ Admin: einzelnes Foto löschen (ohne Popup) */
  async function deleteSinglePhotoAdmin(p: PhotoDoc) {
    // Admin darf Fotos in *jedem* Status löschen (auch wenn der Termin im Papierkorb/"gelöscht" ist)
    if (!isAdmin || isNew || !id) return;
    setDeletePhotoBusyId(p.id);
    setDeletePhotoErr(null);
    let ok = false;
    try {
      // 1) Storage (best effort)
      if (p.path) {
        try {
          await deleteObject(storageRef(storage, p.path));
        } catch {}
      }

      // 2) Firestore doc
      await deleteDoc(doc(db, "appointments", id, "photos", p.id));

      // 3) Count + updatedAt
      await updateDoc(doc(db, "appointments", id), {
        photoCount: increment(-1),
        updatedAt: serverTimestamp(),
      });

      ok = true;
    } catch (e: any) {
      setDeletePhotoErr(e?.message ?? "Löschen fehlgeschlagen.");
    } finally {
      setDeletePhotoBusyId(null);
      if (ok) setConfirmDeletePhotoId(null);
    }
  }

  /** ✅ Download: alle Fotos als ZIP */
  async function downloadAllPhotosZip() {
    if (photos.length === 0) return;
    setZipBusy(true);
    setZipErr(null);
    try {
      const zip = new JSZip();
      const folder = zip.folder(`termin_${id}_bilder`) ?? zip;

      for (let i = 0; i < photos.length; i++) {
        const p = photos[i];
        const blob = await fetchAsBlob(p.url);
        const fn = filenameFromPhoto(p) || `foto_${i + 1}.jpg`;
        folder.file(fn, blob);
      }

      const zipBlob = await zip.generateAsync({ type: "blob" });
      await downloadBlobAsFile(zipBlob, `termin_${id}_bilder.zip`);
    } catch (e: any) {
      setZipErr(e?.message ?? "ZIP Download fehlgeschlagen.");
    } finally {
      setZipBusy(false);
    }
  }

  async function deletePhotoAdmin(p: PhotoDoc) {
    if (!isAdmin) return;
    if (!id) return;
    if (!p?.id) return;

    let ok = false;
    setDeletePhotoErr(null);
    setDeletePhotoBusyId(p.id);
    try {
      // Storage first (ignore if missing)
      if (p.path) {
        try {
          await deleteObject(storageRef(storage, p.path));
        } catch {
          // ignore
        }
      }

      await deleteDoc(doc(db, "appointments", id, "photos", p.id));

      // keep counters in sync (best effort)
      try {
        await updateDoc(doc(db, "appointments", id), { photoCount: increment(-1), updatedAt: serverTimestamp() });
      } catch {
        // ignore
      }

      ok = true;
    } catch (e: any) {
      setDeletePhotoErr(e?.message ?? "Löschen fehlgeschlagen.");
    } finally {
      setDeletePhotoBusyId(null);
      if (ok) setConfirmDeletePhotoId(null);
    }
  }

  /** ---- actions ---- */
  const canSaveCreate = useMemo(() => {
    if (!roleLoaded) return false;
    if (!title.trim()) return false;
    if (!startDt || !endDt) return false;
    if (endDt.getTime() <= startDt.getTime()) return false;
    if (!recurrenceUiOkCreate) return false;

    const uid = isAdmin ? selectedUserId : auth.currentUser?.uid ?? "";
    if (!uid) return false;

    if (!isAdmin && startTime && disabledTimes.has(startTime)) return false;
    return true;
  }, [roleLoaded, isAdmin, title, startDt, endDt, recurrenceUiOkCreate, selectedUserId, startTime, disabledTimes]);

  const canSaveEdit = useMemo(() => {
    if (!isAdmin || isTrash || isNew) return false;
    if (!title.trim()) return false;
    if (!startDt || !endDt) return false;
    if (endDt.getTime() <= startDt.getTime()) return false;
    if (!createdByUserId) return false;
    if (!isAdmin && startTime && disabledTimes.has(startTime)) return false;
    if (editSeriesEnabled && !seriesUiOkEdit) return false;
    return true;
  }, [isAdmin, isTrash, isNew, title, startDt, endDt, createdByUserId, startTime, disabledTimes, editSeriesEnabled, seriesUiOkEdit]);

  async function handleCreate() {
    setErr(null);

    const u = auth.currentUser;
    if (!u) return;

    const createdFor = isAdmin ? (selectedUserId || u.uid) : u.uid;

    if (!startDt || !endDt) {
      setErr("Bitte Start- und Endzeit prüfen.");
      return;
    }
    if (endDt.getTime() <= startDt.getTime()) {
      setErr("Ende muss nach dem Start liegen.");
      return;
    }
    if (!recurrenceUiOkCreate) {
      setErr("Bitte die Einstellungen für den Serientermin prüfen.");
      return;
    }
    if (!createdFor) {
      setErr("User fehlt.");
      return;
    }

    const MAX_INSTANCES_CAP = 200;
    const starts = recurringEnabled
      ? generateOccurrences({ startDt, rule: recurrenceRuleCreate, maxCountCap: MAX_INSTANCES_CAP })
      : [startDt];

    if (!starts.length) {
      setErr("Keine Termine generiert. Bitte Einstellungen prüfen.");
      return;
    }

    const collision = await findFirstCollisionInStarts({
      userId: createdFor,
      starts,
      durationMinutes: effectiveDurationMinutes,
    });
    if (collision) {
      setCollisionMsgVisible(true);
      setSelectedConflict(collision);
      setConflictFrameOpen(false);

      const endLabel = collision.endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const msg = `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${endLabel})`;
      setErr(msg);

      // Option 4: Nur Admins dürfen trotzdem speichern – mit Bestätigung.
      if (!isAdmin) return;
      const ok = window.confirm(`${msg}\n\nTrotzdem speichern?`);
      if (!ok) return;
    }

    setBusy(true);
    try {
      let newSeriesId: string | null = null;

      if (recurringEnabled) {
        const seriesRef = await addDoc(collection(db, "appointmentSeries"), {
          createdForUserId: createdFor,
          createdByUserId: u.uid,
          title: title.trim(),
          description: description.trim(),
          startDate: Timestamp.fromDate(starts[0]),
          endDate: Timestamp.fromDate(addMinutes(starts[0], effectiveDurationMinutes)),
          durationMinutes: effectiveDurationMinutes,
          recurrence: recurrenceRuleCreate,
          status: "active",
          deletedAt: null,
          locked: false,
          appointmentType: isAdmin ? appointmentType : "-",
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        newSeriesId = seriesRef.id;
      }

      const initialPhotoCountFirst = pendingPhotos.length;

      const batch = writeBatch(db);
      const apptIds: string[] = [];

      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const e = addMinutes(s, effectiveDurationMinutes);
        const apptRef = doc(collection(db, "appointments"));
        apptIds.push(apptRef.id);

        batch.set(apptRef, {
          title: title.trim(),
          description: description.trim(),
          startDate: Timestamp.fromDate(s),
          endDate: Timestamp.fromDate(e),
          status: "open",
          createdByUserId: createdFor,
          userIds: isAdmin ? (selectedUserIds.length ? selectedUserIds : [createdFor]) : [createdFor],

          // ✅ Namenmapping im Termin speichern (damit User Teilnehmernamen sieht)
          userNameById: buildUserNameMap(isAdmin ? (selectedUserIds.length ? selectedUserIds : [createdFor]) : [createdFor], userNameById),

          appointmentType: isAdmin ? appointmentType : "-",

          documentationText: "",
          adminNote: "",

          photoCount: i === 0 ? initialPhotoCountFirst : 0,
          deletedAt: null,
          locked: false,
          documentedByUserId: null,
          documentedAt: null,
          doneAt: null,

          isRecurring: !!newSeriesId,
          seriesId: newSeriesId,
          recurrence: newSeriesId ? recurrenceRuleCreate : null,
          seriesIndex: newSeriesId ? i + 1 : null,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      await batch.commit();

      const firstApptId = apptIds[0];

      // Upload pending photos nur in die 1. Instanz
      await uploadPendingPhotos(firstApptId);

      if (newSeriesId) {
        await updateDoc(doc(db, "appointmentSeries", newSeriesId), {
          instanceCount: starts.length,
          firstAppointmentId: firstApptId,
          updatedAt: serverTimestamp(),
        });
      }

      router.push("/dashboard");
    } catch (e: any) {
      setErr(String(e?.message ?? "Speichern fehlgeschlagen."));
    } finally {
      setBusy(false);
    }
  }

  async function applySeriesEdit(redirectToDashboard: boolean) {
    if (!canEditAdmin) return;
    if (!seriesId) return;

    if (!startDt) {
      setErr("Bitte Start prüfen.");
      return;
    }
    if (!selectedUserIds.length) {
      setErr("Bitte einen oder mehrere User auswählen.");
      return;
    }
    if (!seriesUiOkEdit) {
      setErr("Bitte die Serien-Einstellungen prüfen.");
      return;
    }

    const ok = window.confirm(
      "Serie bearbeiten?\n\nDabei werden ALLE Termine dieser Serie neu erzeugt (bisherige Serien-Termine werden in den Papierkorb verschoben)."
    );
    if (!ok) return;

    setBusy(true);
    try {
      const qAll = query(collection(db, "appointments"), where("seriesId", "==", seriesId));
      const snap = await getDocs(qAll);
      const apptIds = snap.docs.map((d) => d.id);

      const batches: ReturnType<typeof writeBatch>[] = [];
      let curBatch = writeBatch(db);
      let ops = 0;

      const pushOp = () => {
        if (ops >= 450) {
          batches.push(curBatch);
          curBatch = writeBatch(db);
          ops = 0;
        }
      };

      for (const apptId of apptIds) {
        pushOp();
        curBatch.update(doc(db, "appointments", apptId), {
          deletedAt: serverTimestamp(),
          deletedByUserId: auth.currentUser?.uid ?? null,
          status: "deleted",
          updatedAt: serverTimestamp(),
        });
        ops++;
      }

      const maxCap = 200;
      const starts = generateOccurrences({ startDt, rule: seriesRuleEdit, maxCountCap: maxCap });
      if (!starts.length) throw new Error("Keine Termine generiert.");

      let collision: ApptLite | null = null;
      let collisionUserId: string | null = null;
      for (const uid of (selectedUserIds.length ? selectedUserIds : [createdByUserId].filter(Boolean))) {
        collision = await findFirstCollisionInStarts({
          userId: uid,
          starts,
          durationMinutes: effectiveDurationMinutes,
          excludeId: id,
        });
        if (collision) {
          collisionUserId = uid;
          break;
        }
      }
      if (collision) {
        setCollisionMsgVisible(true);
        setSelectedConflict(collision);
        setConflictFrameOpen(false);

        const endLabel = collision.endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        const who = collisionUserId ? nameFromUid(collisionUserId) : "User";
        const msg = `Kollision (${who}): ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${endLabel})`;
        setErr(msg);

        const ok = window.confirm(`${msg}

Trotzdem speichern?`);
        if (!ok) {
          setBusy(false);
          return;
        }
      }

      pushOp();
      curBatch.update(doc(db, "appointmentSeries", seriesId), {
        createdForUserId: createdByUserId,
        title: title.trim(),
        description: description.trim(),
        startDate: Timestamp.fromDate(starts[0]),
        endDate: Timestamp.fromDate(addMinutes(starts[0], effectiveDurationMinutes)),
        durationMinutes: effectiveDurationMinutes,
        recurrence: seriesRuleEdit,
        appointmentType: appointmentType,
        updatedAt: serverTimestamp(),
        instanceCount: starts.length,
      });
      ops++;

      const newIds: string[] = [];
      for (let i = 0; i < starts.length; i++) {
        const s = starts[i];
        const e = addMinutes(s, effectiveDurationMinutes);
        const newRef = doc(collection(db, "appointments"));
        newIds.push(newRef.id);

        pushOp();
        curBatch.set(newRef, {
          title: title.trim(),
          description: description.trim(),
          startDate: Timestamp.fromDate(s),
          endDate: Timestamp.fromDate(e),
          status: "open",
          createdByUserId: (selectedUserIds[0] ?? createdByUserId),
          userIds: selectedUserIds,
          userNameById: buildUserNameMap(selectedUserIds, userNameById),

          appointmentType: appointmentType,

          documentationText: "",
          adminNote: "",

          photoCount: 0,
          deletedAt: null,
          locked: false,
          documentedByUserId: null,
          documentedAt: null,
          doneAt: null,

          isRecurring: true,
          seriesId: seriesId,
          recurrence: seriesRuleEdit,
          seriesIndex: i + 1,

          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        ops++;
      }

      batches.push(curBatch);
      await commitBatches(batches);

      if (redirectToDashboard) router.push("/dashboard");
      else router.push(`/appointments/${newIds[0]}`);
    } catch (e: any) {
      setErr(e?.message ?? "Serie bearbeiten fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteSeries() {
    if (!canEditAdmin) return;
    if (!seriesId) return;

    const ok = window.confirm("Soll die gesamte Serie wirklich gelöscht werden? (Papierkorb)");
    if (!ok) return;

    setBusy(true);
    try {
      const qAll = query(collection(db, "appointments"), where("seriesId", "==", seriesId));
      const snap = await getDocs(qAll);

      const batches: ReturnType<typeof writeBatch>[] = [];
      let curBatch = writeBatch(db);
      let ops = 0;

      const pushOp = () => {
        if (ops >= 450) {
          batches.push(curBatch);
          curBatch = writeBatch(db);
          ops = 0;
        }
      };

      for (const d of snap.docs) {
        pushOp();
        curBatch.update(doc(db, "appointments", d.id), {
          deletedAt: serverTimestamp(),
          deletedByUserId: auth.currentUser?.uid ?? null,
          status: "deleted",
          updatedAt: serverTimestamp(),
        });
        ops++;
      }

      pushOp();
      curBatch.update(doc(db, "appointmentSeries", seriesId), {
        deletedAt: serverTimestamp(),
        deletedByUserId: auth.currentUser?.uid ?? null,
        status: "deleted",
        updatedAt: serverTimestamp(),
      });
      ops++;

      batches.push(curBatch);
      await commitBatches(batches);

      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Serie löschen fehlgeschlagen.");
      setBusy(false);
    } finally {
      setBusy(false);
    }
  }

  async function handleSave() {
    if (isNew) return;
    if (!isAdmin || isTrash) return;
    if (!id) return;

    setErr(null);

    if (!startDt || !endDt) {
      setErr("Bitte Start/Ende prüfen.");
      return;
    }
    if (endDt.getTime() <= startDt.getTime()) {
      setErr("Ende muss nach dem Start liegen.");
      return;
    }
    if (!selectedUserIds.length) {
      setErr("Bitte einen oder mehrere User auswählen.");
      return;
    }

    if (editSeriesEnabled && hasSeries) {
      await applySeriesEdit(true);
      return;
    }

    let collision: ApptLite | null = null;
    let collisionUserId: string | null = null;
    for (const uid of selectedUserIds.length ? selectedUserIds : [createdByUserId].filter(Boolean)) {
      collision = await findCollisionExact({ userId: uid, start: startDt, end: endDt, excludeId: id });
      if (collision) {
        collisionUserId = uid;
        break;
      }
    }
    if (collision) {
      setCollisionMsgVisible(true);
      setSelectedConflict(collision);
      setConflictFrameOpen(false);

      const endLabel = collision.endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
      const who = collisionUserId ? nameFromUid(collisionUserId) : "User";
      const msg = `Kollision (${who}): ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${endLabel})`;
      setErr(msg);

      // Option 4: Admin darf trotzdem speichern – mit Bestätigung.
      const ok = window.confirm(`${msg}

Trotzdem speichern?`);
      if (!ok) return;
    }

    setBusy(true);
    try {
      await updateDoc(doc(db, "appointments", id), {
        createdByUserId: (selectedUserIds[0] ?? createdByUserId),
        userIds: selectedUserIds,
        userNameById: buildUserNameMap(selectedUserIds, userNameById),

        title: title.trim(),
        description: description.trim(),
        documentationText: documentationText.trim(),
        appointmentType: appointmentType,
        startDate: Timestamp.fromDate(startDt),
        endDate: Timestamp.fromDate(endDt),
        updatedAt: serverTimestamp(),
      });

      router.push("/dashboard");
    } catch (e: any) {
      setErr(e?.message ?? "Speichern fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  /** ---------- render ---------- */
  if (!ready || !roleLoaded || loadingDoc) {
    return (
      <main style={{ maxWidth: 1100, margin: "24px auto", padding: 16, fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>
        <p style={{ fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>Lade…</p>
      </main>
    );
  }

  const frameStyle: React.CSSProperties = {
    padding: 16,
    border: "1px solid #e5e7eb",
    borderRadius: 16,
    background: "white",
  };

  const navyBorder = "1px solid rgba(11,31,53,0.35)";
  const navySelectedBorder = "1px solid rgba(11,31,53,0.85)";
  const navySelectedBg = "linear-gradient(#0f2a4a, #0b1f35)";
  const navyLightBg = "linear-gradient(#ffffff, #f9fafb)";

  const userReadOnly = !isAdmin && !isNew;
  const userCanDocument = userReadOnly && !isTrash && status === "open";

  const statusChipTone: "gray" | "yellow" | "green" | "red" | "blue" =
    isTrash ? "red" : status === "documented" ? "yellow" : status === "done" ? "green" : "blue";

  // ✅ Für Anzeige: erstellt/letzte Änderung getrennt (Mobil: besser lesbar)
  const createdPart = !isNew
    ? `Erstellt von: ${nameFromUid(createdByActorUserId || createdByUserId)} am ${createdAt ? fmtHeaderDateTime(createdAt) : "—"}`
    : "";
  const updatedPart = !isNew && updatedAt ? `Letzte Änderung am: ${fmtHeaderDateTime(updatedAt)}` : "";

  // (createdLine bleibt für Rückwärtskompatibilität / Debug, wird aber nicht mehr direkt gerendert)
  const createdLine = !isNew ? `${createdPart}${updatedPart ? ` • ${updatedPart}` : ""}` : "";

  // ✅ Mobil: Fotos/Doku ans Ende vor die Buttons (einklappbar) – Desktop bleibt rechts
  const mediaPanel = (
    <>
          {isNew ? (
            <>
              {/* Fotos hochladen (create) */}
              <div style={{ borderRadius: 16, border: "1px solid rgba(11,31,53,0.35)", overflow: "hidden" }}>
                <div
                  style={{
                    padding: "12px 14px",
                    background: "linear-gradient(#0f2a4a, #0b1f35)",
                    color: "white",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_SEMI,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 10,
                  }}
                >
                  <div>Fotos hochladen</div>

                  <div style={{ display: "flex", gap: 10 }}>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      onChange={(e) => addSelectedFilesToState(e.target.files, setPendingPhotos, fileInputRef)}
                      style={{ display: "none" }}
                    />
                    <Btn variant="mint" onClick={() => fileInputRef.current?.click()} disabled={busy}>
                      Dateien auswählen
                    </Btn>

                    <Btn variant="secondary" onClick={() => clearPendingState(setPendingPhotos)} disabled={busy || pendingPhotos.length === 0}>
                      Leeren
                    </Btn>
                  </div>
                </div>

                <div style={{ padding: 14, background: "white" }}>
                  {pendingPhotos.length === 0 ? (
                    <div
                      style={{
                        padding: 14,
                        borderRadius: 14,
                        border: "1px dashed #e5e7eb",
                        color: "#6b7280",
                        fontFamily: FONT_FAMILY,
                        fontWeight: FW_MED,
                      }}
                    >
                      Noch keine Fotos ausgewählt.
                    </div>
                  ) : (
                    <div style={{ display: "grid", gap: 10 }}>
                      {pendingPhotos.map((p) => (
                        <div
                          key={p.id}
                          className="pendingCard"
                          style={{
                            display: "grid",
                            gridTemplateColumns: "1fr 110px",
                            gap: 10,
                            padding: 8,
                            border: "1px solid #e5e7eb",
                            borderRadius: 14,
                            background: "#fff",
                            alignItems: "start",
                          }}
                        >
                          <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                              <div style={{ minWidth: 0 }}>
                                <div
                                  title={p.file.name}
                                  style={{
                                    fontFamily: FONT_FAMILY,
                                    fontWeight: FW_SEMI,
                                    color: "#111827",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {displayUploadFilename(p.file.name)}
                                </div>
                                <div style={{ fontSize: 12, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
                                  {(p.file.size / 1024 / 1024).toFixed(2)} MB
                                </div>
                              </div>
                            </div>

                            <div style={{ display: "grid", gap: 6 }}>
                              <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>Kommentar (optional)</label>
                              <div style={{ display: "grid", gap: 10 }}>
                                <textarea
                                  value={p.comment}
                                  onChange={(e) =>
                                    setPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, comment: e.target.value } : x)))
                                  }
                                  rows={2}
                                  placeholder="Optional…"
                                  style={{
                                    padding: 10,
                                    borderRadius: 12,
                                    border: "1px solid #e5e7eb",
                                    resize: "vertical",
                                    fontFamily: FONT_FAMILY,
                                    fontWeight: FW_REG,
                                  }}
                                  disabled={busy}
                                />

                              </div>
                            </div>
                          </div>

                          <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                            <img
                              src={p.previewUrl}
                              alt="Vorschau"
                              style={{
                                width: 96,
                                height: 72,
                                borderRadius: 12,
                                border: "1px solid #e5e7eb",
                                objectFit: "cover",
                              }}
                            />

                            <Btn
                              variant="danger"
                              onClick={() => removePendingPhotoFromState(p.id, setPendingPhotos)}
                              disabled={busy}
                            >
                              Entfernen
                            </Btn>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Serie (create) */}
              <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                  <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Serientermin aktivieren</div>
                  <Toggle checked={recurringEnabled} onChange={setRecurringEnabled} disabled={busy} />
                </div>

                {recurringEnabled && (
                  <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: navyBorder, background: navyLightBg }}>
                    <div style={{ display: "grid", gap: 12 }}>
                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Wiederholen alle:</div>

                        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                          <input
                            type="number"
                            min={1}
                            max={999}
                            value={repeatEvery}
                            onChange={(e) => setRepeatEvery(clampInt(Number(e.target.value), 1, 999))}
                            style={{
                              width: 110,
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid #e5e7eb",
                              fontFamily: FONT_FAMILY,
                              fontWeight: FW_SEMI,
                            }}
                            disabled={busy}
                          />

                          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                            {(["day", "week", "month", "year"] as RepeatUnit[]).map((u) => {
                              const selected = repeatUnit === u;
                              return (
                                <button
                                  key={u}
                                  type="button"
                                  onClick={() => !busy && setRepeatUnit(u)}
                                  disabled={busy}
                                  style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    gap: 6,
                                    padding: "6px 10px",
                                    borderRadius: 12,
                                    border: selected ? navySelectedBorder : "1px solid #e5e7eb",
                                    background: selected ? navySelectedBg : "linear-gradient(#ffffff, #f3f4f6)",
                                    color: selected ? "white" : "#111827",
                                    fontFamily: FONT_FAMILY,
                                    fontWeight: FW_SEMI,
                                    cursor: busy ? "not-allowed" : "pointer",
                                  }}
                                >
                                  <span>{unitLabel(u)}</span>
                                </button>
                              );
                            })}
                          </div>
                        </div>

                        {repeatUnit === "week" && (
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Wiederholen am:</div>
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {WEEKDAYS.map((d) => {
                                const selected = weekdaySingle === d.k;
                                return (
                                  <button
                                    key={d.k}
                                    type="button"
                                    onClick={() => !busy && setWeekdaySingle(d.k)}
                                    disabled={busy}
                                    style={{
                                      padding: "9px 10px",
                                      borderRadius: 999,
                                      border: selected ? navySelectedBorder : "1px solid #e5e7eb",
                                      background: selected ? navySelectedBg : "linear-gradient(#ffffff, #f3f4f6)",
                                      color: selected ? "white" : "#111827",
                                      fontFamily: FONT_FAMILY,
                                      fontWeight: FW_SEMI,
                                      cursor: busy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    {d.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {repeatUnit === "month" && (
                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Monatlich am:</div>
                            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                              <input
                                type="number"
                                min={1}
                                max={27}
                                value={monthDay}
                                onChange={(e) => setMonthDay(clampInt(Number(e.target.value), 1, 27))}
                                style={{
                                  width: 110,
                                  padding: 10,
                                  borderRadius: 12,
                                  border: "1px solid #e5e7eb",
                                  fontFamily: FONT_FAMILY,
                                  fontWeight: FW_SEMI,
                                }}
                                disabled={busy}
                              />
                              <span style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Tag im Monat</span>
                            </div>
                          </div>
                        )}
                      </div>

                      <div style={{ display: "grid", gap: 8 }}>
                        <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Endet:</div>

                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                          {([
                            { key: "never" as const, label: "Nie" },
                            { key: "onDate" as const, label: "Am" },
                            { key: "afterCount" as const, label: "Nach" },
                          ] as const).map((x) => {
                            const selected = endMode === x.key;
                            return (
                              <button
                                key={x.key}
                                type="button"
                                onClick={() => !busy && setEndMode(x.key)}
                                disabled={busy}
                                style={{
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "6px 10px",
                                  borderRadius: 12,
                                  border: selected ? navySelectedBorder : "1px solid #e5e7eb",
                                  background: selected ? navySelectedBg : "linear-gradient(#ffffff, #f3f4f6)",
                                  color: selected ? "white" : "#111827",
                                  fontFamily: FONT_FAMILY,
                                  fontWeight: FW_SEMI,
                                  cursor: busy ? "not-allowed" : "pointer",
                                }}
                              >
                                <span>{x.label}</span>
                              </button>
                            );
                          })}
                        </div>

                        {endMode === "onDate" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <input
                              type="date"
                              value={endOnDate}
                              onChange={(e) => setEndOnDate(e.target.value)}
                              style={{
                                padding: 10,
                                borderRadius: 12,
                                border: "1px solid #e5e7eb",
                                fontFamily: FONT_FAMILY,
                                fontWeight: FW_SEMI,
                              }}
                              disabled={busy}
                            />
                            {startDate && endOnDate && endOnDate < startDate && (
                              <span style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                                Enddatum muss am/ nach dem Startdatum liegen.
                              </span>
                            )}
                          </div>
                        )}

                        {endMode === "afterCount" && (
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <input
                              type="number"
                              min={1}
                              max={1000}
                              value={endAfterCount}
                              onChange={(e) => setEndAfterCount(clampInt(Number(e.target.value), 1, 1000))}
                              style={{
                                width: 130,
                                padding: 10,
                                borderRadius: 12,
                                border: "1px solid #e5e7eb",
                                fontFamily: FONT_FAMILY,
                                fontWeight: FW_SEMI,
                              }}
                              disabled={busy}
                            />
                            <span style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Terminen</span>
                          </div>
                        )}
                      </div>

                      {!recurrenceUiOkCreate && (
                        <div style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>
                          Bitte die Serien-Einstellungen vollständig ausfüllen.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </>
          ) : (
            <>
              {/* ✅ Admin Fotodoku im Edit: EXAKT wie create */}
              {isAdmin && !isTrash && (
                <div style={{ borderRadius: 16, border: "1px solid rgba(11,31,53,0.35)", overflow: "hidden" }}>
                  <div
                    style={{
                      padding: "12px 14px",
                      background: "linear-gradient(#0f2a4a, #0b1f35)",
                      color: "white",
                      fontFamily: FONT_FAMILY,
                      fontWeight: FW_SEMI,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    <div>Fotos hochladen</div>

                    <div style={{ display: "flex", gap: 10 }}>
                      <input
                        ref={adminFileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) => addSelectedFilesToState(e.target.files, setAdminPendingPhotos, adminFileInputRef)}
                        style={{ display: "none" }}
                      />
                      <Btn
                        variant="mint"
                        onClick={() => adminFileInputRef.current?.click()}
                        disabled={busy || adminUploadBusy || status === "documented" || status === "done"}
                      >
                        Dateien auswählen
                      </Btn>

                      <Btn
                        variant="secondary"
                        onClick={() => clearPendingState(setAdminPendingPhotos)}
                        disabled={busy || adminUploadBusy || adminPendingPhotos.length === 0}
                      >
                        Leeren
                      </Btn>
                    </div>
                  </div>

                  <div style={{ padding: 14, background: "white" }}>
                    {adminPendingPhotos.length === 0 ? (
                      <div
                        style={{
                          padding: 14,
                          borderRadius: 14,
                          border: "1px dashed #e5e7eb",
                          color: "#6b7280",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_MED,
                        }}
                      >
                        Noch keine Fotos ausgewählt.
                      </div>
                    ) : (
                      <div style={{ display: "grid", gap: 10 }}>
                        {adminPendingPhotos.map((p) => (
                          <div
                            key={p.id}
                            className="pendingCard"
                            style={{
                              display: "grid",
                              gridTemplateColumns: "1fr 110px",
                              gap: 10,
                              padding: 10,
                              border: "1px solid #e5e7eb",
                              borderRadius: 14,
                              background: "#fff",
                              alignItems: "start",
                            }}
                          >
                            <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    title={p.file.name}
                                    style={{
                                      fontFamily: FONT_FAMILY,
                                      fontWeight: FW_SEMI,
                                      color: "#111827",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {displayUploadFilename(p.file.name)}
                                  </div>
                                  <div style={{ fontSize: 12, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
                                    {(p.file.size / 1024 / 1024).toFixed(2)} MB
                                  </div>
                                </div>

                              </div>

                              <div style={{ display: "grid", gap: 6 }}>
                                <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>Kommentar (optional)</label>
                                <textarea
                                  value={p.comment}
                                  onChange={(e) =>
                                    setAdminPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, comment: e.target.value } : x)))
                                  }
                                  rows={2}
                                  placeholder="Optional…"
                                  style={{
                                    padding: 10,
                                    borderRadius: 12,
                                    border: "1px solid #e5e7eb",
                                    resize: "vertical",
                                    fontFamily: FONT_FAMILY,
                                    fontWeight: FW_REG,
                                  }}
                                  disabled={busy || adminUploadBusy}
                                />
                              </div>
                            </div>

                            <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                              <img
                                src={p.previewUrl}
                                alt="Vorschau"
                                style={{
                                  width: 96,
                                  height: 72,
                                  borderRadius: 12,
                                  border: "1px solid #e5e7eb",
                                  objectFit: "cover",
                                }}
                              />

                              <Btn
                                variant="danger"
                                onClick={() => removePendingPhotoFromState(p.id, setAdminPendingPhotos)}
                                disabled={busy || adminUploadBusy}
                              >
                                Entfernen
                              </Btn>
                            </div>
                          </div>
                        ))}

                        <div style={{ display: "flex", gap: 10, flexWrap: "nowrap",
                      overflowX: "auto", alignItems: "center" }}>
                          <Btn
                            variant="navy"
                            onClick={uploadAdminPendingPhotos}
                            disabled={busy || adminUploadBusy || adminPendingPhotos.length === 0 || status === "documented" || status === "done"}
                          >
                            {adminUploadBusy ? "Upload…" : "Hochladen"}
                          </Btn>

                          {adminUploadBusy && (
                            <span style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Upload…</span>
                          )}
                        </div>

                        {adminUploadErr && <p style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{adminUploadErr}</p>}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", alignItems: "baseline", gap: 6, marginTop: 14 }}>
              <h2 style={{ fontSize: 16, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, margin: 0 }}>Doku-Bilder</h2>
              {photos.length > 0 && (
                <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_MED, fontSize: 12, color: "#9ca3af" }}>
                  ({photos.length})
                </span>
              )}
            </div>

              {/* ✅ Alle herunterladen (ZIP) */}
              {photos.length > 0 && (
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "nowrap",
                      overflowX: "auto", alignItems: "center" }}>
                  <Btn variant="navy" onClick={downloadAllPhotosZip} disabled={zipBusy}>
                    {zipBusy ? "ZIP wird erstellt…" : "Alle herunterladen"}
                  </Btn>
                  {zipErr && <span style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{zipErr}</span>}
                </div>
              )}

              {photos.length === 0 ? (
                <p style={{ color: "#6b7280", marginTop: 10, fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>Noch keine Bilder vorhanden.</p>
              ) : (
                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {photos.map((p) => (
                    <div
                      key={p.id}
                      className="photoCard"
                      style={{
                        display: "grid",
                        gridTemplateColumns: "96px 1fr",
                        gap: 12,
                        padding: 10,
                        border: "1px solid #e5e7eb",
                        borderRadius: 14,
                        background: "#fff",
                        alignItems: "start",
                      }}
                    >
                      {isAdmin ? (
                      <div
                        onMouseEnter={(e) => {
                          const ev = e as any;
                          setHoverPreview({ url: p.url, x: ev.clientX ?? 0, y: ev.clientY ?? 0 });
                        }}
                        onMouseMove={(e) => {
                          const ev = e as any;
                          setHoverPreview((prev) => (prev ? { ...prev, x: ev.clientX ?? prev.x, y: ev.clientY ?? prev.y } : prev));
                        }}
                        onMouseLeave={() => setHoverPreview(null)}
                        style={{ textDecoration: "none", cursor: "zoom-in" }}
                      >
                        <img
                          src={p.url}
                          alt="Foto"
                          style={{
                            width: 96,
                            height: 72,
                            borderRadius: 12,
                            border: "1px solid #e5e7eb",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </div>
                    ) : (
                      <a href={p.url} target="_blank" rel="noreferrer" style={{ textDecoration: "none" }}>
                        <img
                          src={p.url}
                          alt="Foto"
                          style={{
                            width: 96,
                            height: 72,
                            borderRadius: 12,
                            border: "1px solid #e5e7eb",
                            objectFit: "cover",
                            display: "block",
                          }}
                        />
                      </a>
                    )}

                      <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                          <div style={{ minWidth: 0 }}>
                            {/* ✅ Datum • Uhrzeit • Uploader */}
                            <div style={{ color: "#6b7280", fontSize: 12, fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
                              {p.uploadedAt ? fmtDateTime(p.uploadedAt) : "—"} • {String((p as any).uploadedByName || "").trim() || nameFromUid(p.uploadedByUserId)}
                            </div>

                            {(() => {
                              const fullName = (p.originalName && p.originalName.trim()) || filenameFromPhoto(p);
                              return (
                                <div
                                  style={{
                                marginTop: 4,
                                fontFamily: FONT_FAMILY,
                                fontWeight: FW_SEMI,
                                color: "#111827",
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                  }}
                                  title={fullName}
                                >
                                  {displayUploadFilename(fullName)}
                                </div>
                              );
                            })()}
                          </div>

                          {/* ✅ Öffnen + Download nebeneinander, gleiche Optik */}
                          <div style={{ display: "flex", gap: 10, flexWrap: "nowrap",
                      overflowX: "auto", alignItems: "center" }}>
                            <Btn href={p.url} target="_blank" rel="noreferrer" variant="navy" title="Foto öffnen">
                              Öffnen
                            </Btn>
                            <Btn variant="navy" onClick={() => downloadSinglePhoto(p)} title="Foto herunterladen">
                              Download
                            </Btn>

                            {isAdmin && (
                              <>
                                {confirmDeletePhotoId === p.id ? (
                                  <div style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                                    <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12, color: "#6b7280" }}>
                                      Wirklich löschen?
                                    </span>
                                    <Btn
                                      variant="danger"
                                      onClick={() => deleteSinglePhotoAdmin(p)}
                                      disabled={deletePhotoBusyId === p.id}
                                      title="Foto löschen"
                                    >
                                      Ja
                                    </Btn>
                                    <Btn
                                      variant="secondary"
                                      onClick={() => setConfirmDeletePhotoId(null)}
                                      disabled={deletePhotoBusyId === p.id}
                                    >
                                      Nein
                                    </Btn>
                                  </div>
                                ) : (
                                  <Btn
                                    variant="danger"
                                    onClick={() => {
                                      setDeletePhotoErr(null);
                                      setConfirmDeletePhotoId(p.id);
                                    }}
                                    disabled={deletePhotoBusyId === p.id}
                                    title="Foto löschen"
                                  >
                                    Löschen
                                  </Btn>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {deletePhotoErr && confirmDeletePhotoId === p.id && (
                          <div style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>{deletePhotoErr}</div>
                        )}

                        <div style={{ display: "grid", gap: 6 }}>
                          <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>Kommentar</label>
                          <textarea
                            value={isAdmin ? photoCommentUiValue(p) : (p.comment ?? "")}
                            readOnly={!isAdmin}
                            onChange={(e) => {
                              if (!isAdmin) return;
                              setPhotoCommentDraftById((cur) => ({ ...cur, [p.id]: e.target.value }));
                            }}
                            onFocus={() => {
                              if (!isAdmin) return;
                              if (photoCommentSaveErrId === p.id) {
                                setPhotoCommentSaveErrId(null);
                                setPhotoCommentSaveErr(null);
                              }
                            }}
                            onBlur={() => {
                              if (!isAdmin) return;
                              savePhotoCommentAdmin(p);
                            }}
                            rows={2}
                            style={{
                              padding: 10,
                              borderRadius: 12,
                              border: "1px solid #e5e7eb",
                              resize: "vertical",
                              fontFamily: FONT_FAMILY,
                              fontWeight: FW_REG,
                              background: isAdmin ? "white" : "linear-gradient(#ffffff, #f9fafb)",
                              opacity: photoCommentSaveBusyId === p.id ? 0.7 : 1,
                            }}
                            disabled={photoCommentSaveBusyId === p.id}
                          />
                        </div>

                        {photoCommentSaveErr && photoCommentSaveErrId === p.id && (
                          <div style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                            {photoCommentSaveErr}
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* ✅ USER: Fotos (optional) rechts unterhalb Doku-Bilder, exakt wie Create */}
              {!isAdmin && userCanDocument && (
                <div style={{ marginTop: 14 }}>
                  <div style={{ borderRadius: 16, border: "1px solid rgba(11,31,53,0.35)", overflow: "hidden" }}>
                    <div
                      style={{
                        padding: "12px 14px",
                        background: "linear-gradient(#0f2a4a, #0b1f35)",
                        color: "white",
                        fontFamily: FONT_FAMILY,
                        fontWeight: FW_SEMI,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 10,
                      }}
                    >
                      <div>Fotos hochladen</div>

                      <div style={{ display: "flex", gap: 10 }}>
                        <input
                          ref={userFileInputRef}
                          type="file"
                          accept="image/*"
                          multiple
                          onChange={(e) => addSelectedFilesToState(e.target.files, setUserPendingPhotos, userFileInputRef)}
                          style={{ display: "none" }}
                        />
                        <Btn variant="mint" onClick={() => userFileInputRef.current?.click()} disabled={busy || userDocBusy}>
                          Dateien auswählen
                        </Btn>

                        <Btn
                          variant="secondary"
                          onClick={() => clearPendingState(setUserPendingPhotos)}
                          disabled={busy || userDocBusy || userPendingPhotos.length === 0}
                        >
                          Leeren
                        </Btn>
                      </div>
                    </div>

                    <div style={{ padding: 14, background: "white" }}>
                      {userPendingPhotos.length === 0 ? (
                        <div
                          style={{
                            padding: 14,
                            borderRadius: 14,
                            border: "1px dashed #e5e7eb",
                            color: "#6b7280",
                            fontFamily: FONT_FAMILY,
                            fontWeight: FW_MED,
                          }}
                        >
                          Noch keine Fotos ausgewählt.
                        </div>
                      ) : (
                        <div style={{ display: "grid", gap: 10 }}>
                          {userPendingPhotos.map((p) => (
                            <div
                              key={p.id}
                              className="pendingCard"
                              style={{
                                display: "grid",
                                gridTemplateColumns: "1fr 110px",
                                gap: 10,
                                padding: 10,
                                border: "1px solid #e5e7eb",
                                borderRadius: 14,
                                background: "#fff",
                                alignItems: "start",
                              }}
                            >
                              <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      title={p.file.name}
                                      style={{
                                        fontFamily: FONT_FAMILY,
                                        fontWeight: FW_SEMI,
                                        color: "#111827",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                      }}
                                    >
                                      {displayUploadFilename(p.file.name)}
                                    </div>
                                    <div style={{ fontSize: 12, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
                                      {(p.file.size / 1024 / 1024).toFixed(2)} MB
                                    </div>
                                  </div>

                                </div>

                                <div style={{ display: "grid", gap: 6 }}>
                                  <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>Kommentar (optional)</label>
                                  <textarea
                                    value={p.comment}
                                    onChange={(e) =>
                                      setUserPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, comment: e.target.value } : x)))
                                    }
                                    rows={2}
                                    placeholder="Optional…"
                                    style={{
                                      padding: 10,
                                      borderRadius: 12,
                                      border: "1px solid #e5e7eb",
                                      resize: "vertical",
                                      fontFamily: FONT_FAMILY,
                                      fontWeight: FW_REG,
                                    }}
                                    disabled={busy || userDocBusy}
                                  />
                                </div>
                              </div>

                              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                                <img
                                  src={p.previewUrl}
                                  alt="Vorschau"
                                  style={{
                                    width: 96,
                                    height: 72,
                                    borderRadius: 12,
                                    border: "1px solid #e5e7eb",
                                    objectFit: "cover",
                                  }}
                                />

                                <Btn
                                  variant="danger"
                                  onClick={() => removePendingPhotoFromState(p.id, setUserPendingPhotos)}
                                  disabled={busy || userDocBusy}
                                >
                                  Entfernen
                                </Btn>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      {userDocErr && <p style={{ marginTop: 10, color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{userDocErr}</p>}
                    </div>
                  </div>
                </div>
              )}

              {/* Serie bearbeiten */}
              {isAdmin && canEditAdmin && hasSeries && (
                <div style={{ marginTop: 14, borderTop: "1px solid #e5e7eb", paddingTop: 14 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                    <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Serie bearbeiten</div>
                    <Toggle checked={editSeriesEnabled} onChange={setEditSeriesEnabled} disabled={busy} />
                  </div>

                  {editSeriesEnabled && (
                    <div style={{ marginTop: 12, padding: 12, borderRadius: 14, border: navyBorder, background: navyLightBg }}>
                      <div style={{ display: "grid", gap: 12 }}>
                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Wiederholen alle:</div>
                          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                            <input
                              type="number"
                              min={1}
                              max={999}
                              value={repeatEvery}
                              onChange={(e) => setRepeatEvery(clampInt(Number(e.target.value), 1, 999))}
                              style={{
                                width: 110,
                                padding: 10,
                                borderRadius: 12,
                                border: "1px solid #e5e7eb",
                                fontFamily: FONT_FAMILY,
                                fontWeight: FW_SEMI,
                              }}
                              disabled={busy}
                            />
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              {(["day", "week", "month", "year"] as RepeatUnit[]).map((u) => {
                                const selected = repeatUnit === u;
                                return (
                                  <button
                                    key={u}
                                    type="button"
                                    onClick={() => !busy && setRepeatUnit(u)}
                                    disabled={busy}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 6,
                                      padding: "6px 10px",
                                      borderRadius: 12,
                                      border: selected ? navySelectedBorder : "1px solid #e5e7eb",
                                      background: selected ? navySelectedBg : "linear-gradient(#ffffff, #f3f4f6)",
                                      color: selected ? "white" : "#111827",
                                      fontFamily: FONT_FAMILY,
                                      fontWeight: FW_SEMI,
                                      cursor: busy ? "not-allowed" : "pointer",
                                    }}
                                  >
                                    <span>{unitLabel(u)}</span>
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {repeatUnit === "week" && (
                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Wiederholen am:</div>
                              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                                {WEEKDAYS.map((d) => {
                                  const selected = weekdaySingle === d.k;
                                  return (
                                    <button
                                      key={d.k}
                                      type="button"
                                      onClick={() => !busy && setWeekdaySingle(d.k)}
                                      disabled={busy}
                                      style={{
                                        padding: "9px 10px",
                                        borderRadius: 999,
                                        border: selected ? navySelectedBorder : "1px solid #e5e7eb",
                                        background: selected ? navySelectedBg : "linear-gradient(#ffffff, #f3f4f6)",
                                        color: selected ? "white" : "#111827",
                                        fontFamily: FONT_FAMILY,
                                        fontWeight: FW_SEMI,
                                        cursor: busy ? "not-allowed" : "pointer",
                                      }}
                                    >
                                      {d.label}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          )}

                          {repeatUnit === "month" && (
                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>Monatlich am:</div>
                              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                                <input
                                  type="number"
                                  min={1}
                                  max={27}
                                  value={monthDay}
                                  onChange={(e) => setMonthDay(clampInt(Number(e.target.value), 1, 27))}
                                  style={{
                                    width: 110,
                                    padding: 10,
                                    borderRadius: 12,
                                    border: "1px solid #e5e7eb",
                                    fontFamily: FONT_FAMILY,
                                    fontWeight: FW_SEMI,
                                  }}
                                  disabled={busy}
                                />
                                <span style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Tag im Monat</span>
                              </div>
                            </div>
                          )}
                        </div>

                        <div style={{ display: "flex", justifyContent: "flex-end", gap: 10, flexWrap: "wrap" }}>
                          <Btn variant="danger" onClick={deleteSeries} disabled={busy}>
                            Serie löschen
                          </Btn>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
    </>
  );

  return (
   <main
      className="appt-page"
      style={{
        maxWidth: 1280,
       margin: "24px auto",
        padding: 16,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_REG,
        // ✅ kein künstliches "Scaling" mehr – stattdessen echte Responsive-Regeln
      }}
    >
<style jsx global>{`
  .appt-meta-desktop { display: block; }
  .appt-meta-mobile { display: none; }
  @media (max-width: 767px) {
    .appt-meta-desktop { display: none; }
    .appt-meta-mobile { display: block; }
  }
`}</style>

      <div style={{ width: "100%" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 26, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, margin: 0 }}>
            {isNew ? "Neuen Termin erstellen" : "Termin"}
          </h1>

          <p style={{ marginTop: 6, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
            {isNew ? (
              <>Start wird automatisch auf das nächste 5-Minuten-Intervall gesetzt.</>
            ) : (
              <>
<div style={{ fontSize: 12, lineHeight: 1.35, opacity: 0.85 }}>
  {/* Desktop/Web: wie vorher */}
  <div className='appt-meta-desktop'>
    <div>
      {createdPart}
      {updatedPart ? <> • {updatedPart}</> : null}
    </div>
    {selectedUserIds.length > 0 ? (
      <div>
        Teilnehmer: {selectedUserIds.map((uid) => nameFromUid(uid)).join(", ")}
      </div>
    ) : null}
  </div>

  {/* Mobil: 3 Zeilen */}
  <div className='appt-meta-mobile'>
    <div>{createdPart}</div>
    {updatedPart ? <div>{updatedPart}</div> : null}
    {selectedUserIds.length > 0 ? (
      <div>
        Teilnehmer: {selectedUserIds.map((uid) => nameFromUid(uid)).join(", ")}
      </div>
    ) : null}
  </div>
</div>

                {seriesId ? (
                  <>
                    {" "}
                    • Serie: {seriesId}
                    {seriesIndex ? (
                      <>
                        {" "}
                        • Nr. {seriesIndex}
                      </>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </p>

          {!isNew && (
            <>
              <div
                className="appt-header-chips"
                style={{
                  display: "flex",
                  gap: 10,
                  alignItems: "center",
                  flexWrap: "nowrap",
                  marginTop: 8,
                  overflowX: "auto",
                  WebkitOverflowScrolling: "touch",
                  maxWidth: "100%",
                }}
              >
{canEditAdmin && !isTrash ? (
  <ChipButton
    label={statusLabel(String(status))}
    tone={statusTone(status)}
    onClick={cycleStatusChip}
    disabled={busy || !!deletedAt}
    title="Status wechseln: Offen → Dokumentiert → Erledigt → Offen"
  />
) : (
  <Chip
    label={isTrash ? "Gelöscht" : statusLabel(String(status))}
    tone={statusTone(status)}
  />
)}


  <ChipButton
    label="← Vorheriger Termin"
    tone="blue"
    disabled={!prevAppt}
    onClick={() => prevAppt && router.push(`/appointments/${prevAppt.id}`)}
    title={
      prevAppt
        ? `Vorheriger (${statusLabel(prevAppt.status)}): ${prevAppt.title || "Ohne Titel"}`
        : `Kein vorheriger Termin (${statusLabel(effectiveStatusForNav())})`
    }
  />

  <ChipButton
    label="Nächster Termin →"
    tone="navy"
    disabled={!nextAppt}
    onClick={() => nextAppt && router.push(`/appointments/${nextAppt.id}`)}
    title={
      nextAppt
        ? `Nächster (${statusLabel(nextAppt.status)}): ${nextAppt.title || "Ohne Titel"}`
        : `Kein nächster Termin (${statusLabel(effectiveStatusForNav())})`
    }
  />
</div>
</>

              
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn href="/dashboard" variant="secondary">
            Dashboard
          </Btn>
        </div>
      </header>

      <div className="appt-layout" style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 12, alignItems: "start" }}>
        {/* LEFT */}
        <section className="appt-left" style={frameStyle}>
          <div style={{ display: "grid", gap: 12 }}>
            {conflictFrameOpen && selectedConflict && (
              <div
                style={{
                  padding: 12,
                  borderRadius: 14,
                  border: "1px solid rgba(11,31,53,0.35)",
                  background: "linear-gradient(#ffffff, #f9fafb)",
                }}
              >
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>
                    Geöffneter Termin: <b>{selectedConflict.title || "Ohne Titel"}</b> ({fmtDateTime(selectedConflict.startDate)}–{" "}
                    {selectedConflict.endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
                  </div>

                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Btn href={`/appointments/${selectedConflict.id}`} target="_blank" rel="noreferrer" variant="navy" title="Termin in neuem Tab öffnen">
                      In neuem Tab
                    </Btn>
                    <Btn variant="danger" onClick={() => setConflictFrameOpen(false)} title="Frame schließen">
                      Frame schließen
                    </Btn>
                  </div>
                </div>

                <iframe
                  src={`/appointments/${selectedConflict.id}`}
                  title="Termin-Frame"
                  style={{
                    width: "100%",
                    height: 520,
                    border: "1px solid #e5e7eb",
                    borderRadius: 12,
                    marginTop: 10,
                    background: "white",
                  }}
                />
              </div>
            )}

            {collisionMsgVisible && selectedConflict && (
              <div
                style={{
                  padding: "6px 10px",
                  borderRadius: 12,
                  border: "1px solid rgba(153,27,27,0.25)",
                  background: "linear-gradient(#fff1f2, #ffe4e6)",
                  color: "#991b1b",
                  fontFamily: FONT_FAMILY,
                  fontWeight: FW_SEMI,
                }}
              >
                Termin bereits belegt: <b>{selectedConflict.title || "Ohne Titel"}</b> ({fmtDateTime(selectedConflict.startDate)}–{" "}
                {selectedConflict.endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })})
                <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Btn variant="navy" onClick={openSelectedConflictInFrame} title="Termin öffnen und Meldung ausblenden">
                    Termin öffnen
                  </Btn>
                  <Btn variant="secondary" onClick={() => setCollisionMsgVisible(false)} title="Meldung ausblenden">
                    Meldung ausblenden
                  </Btn>
                </div>
              </div>
            )}

            {isAdmin && (
              <div className="appt-admin-row">
                {/* User */}
                <div className="appt-admin-field" style={{ display: "grid", gap: 6, minWidth: 0 }}>
                  <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>User</label>

                  {/* ✅ Mehrfachauswahl (Klickboxen) + alphabetisch + "Alle" */}
                  <div
                    className="appt-compact-select"
                    style={{
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      fontFamily: FONT_FAMILY,
                      fontWeight: FW_SEMI,
                      background: "white",
                      minWidth: 0,
                      width: "100%",
                      padding: 10,
                      display: "grid",
                      gap: 6,
                    }}
                  >
                    {/* ✅ Auswahl-Zusammenfassung */}
                    <div
                      style={{
                        display: "flex",
                        flexWrap: "nowrap",
                      overflowX: "auto",
                        alignItems: "center",
                        gap: 6,
                        padding: "8px 10px",
                        borderRadius: 12,
                        border: "1px solid rgba(0,0,0,0.08)",
                        background: "linear-gradient(#ffffff, #f9fafb)",
                      }}
                    >
                      {selectedUserIds.length === 0 ? (
                        <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_REG, fontSize: 12, color: "#6b7280" }}>
                          Kein User ausgewählt
                        </span>
                      ) : selectedUserIds.length <= 3 ? (
                        selectedUserIds.map((uid) => (
                          <span
                            key={uid}
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              borderRadius: 999,
                              padding: "6px 10px",
                              border: "1px solid rgba(11,31,53,0.25)",
                              background: "linear-gradient(#DBEAFE,#BFDBFE)",
                              color: "#1E3A8A",
                              fontFamily: FONT_FAMILY,
                              fontWeight: FW_SEMI,
                              fontSize: 12,
                              lineHeight: 1,
                            }}
                            title={nameFromUid(uid)}
                          >
                            {truncateLabel(nameFromUid(uid), 20)}
                            <span
                              onClick={() => toggleUser(uid)}
                              style={{ cursor: "pointer", fontWeight: 900, opacity: 0.85, userSelect: "none" }}
                              title="Entfernen"
                              aria-label="User entfernen"
                            >
                              ×
                            </span>
                          </span>
                        ))
                      ) : (
                        <>
                          <span
                            style={{
                              display: "inline-flex",
                              alignItems: "center",
                              gap: 6,
                              borderRadius: 999,
                              padding: "6px 10px",
                              border: "1px solid rgba(11,31,53,0.4)",
                              background: "linear-gradient(#0f2a4a,#0b1f35)",
                              color: "white",
                              fontFamily: FONT_FAMILY,
                              fontWeight: FW_SEMI,
                              fontSize: 12,
                              lineHeight: 1,
                            }}
                            title={selectedUserIds.map((u) => nameFromUid(u)).join(", ")}
                          >
                            {selectedUserIds.length} User ausgewählt
                          </span>
                          <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_REG, fontSize: 12, color: "#6b7280" }}>
                            (Hover für Liste)
                          </span>
                        </>
                      )}
                    </div>

                    {/* ✅ Controls */}
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <button
                        type="button"
                        onClick={() => setUserPickerOpen((v) => !v)}
                        disabled={busy || (isNew ? false : !canEditAdminFields)}
                        style={{
                          flex: "1 1 auto",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: 10,
                          padding: "8px 10px",
                          borderRadius: 12,
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "linear-gradient(#ffffff,#f3f4f6)",
                          cursor: busy ? "not-allowed" : "pointer",
                          opacity: busy ? 0.6 : 1,
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_SEMI,
                          fontSize: 12,
                          textAlign: "left",
                        }}
                        title={userPickerOpen ? "Userliste einklappen" : "Userliste ausklappen"}
                      >
                        <span>{userPickerOpen ? "Userliste ausblenden" : "Userliste anzeigen"}</span>
                        <span style={{ color: "#6b7280", flex: "0 0 auto" }}>{userPickerOpen ? "▴" : "▾"}</span>
                      </button>

                      <button
                        type="button"
                        onClick={toggleAllUsers}
                        disabled={busy || (isNew ? false : !canEditAdminFields)}
                        style={{
                          flex: "0 0 auto",
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "8px 10px",
                          borderRadius: 12,
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: allUsersSelected ? "linear-gradient(#DBEAFE,#BFDBFE)" : "linear-gradient(#ffffff,#f3f4f6)",
                          cursor: busy ? "not-allowed" : "pointer",
                          opacity: busy ? 0.6 : 1,
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_SEMI,
                          fontSize: 12,
                          whiteSpace: "nowrap",
                        }}
                        title={allUsersSelected ? "Alle abwählen" : "Alle auswählen"}
                      >
                        <span
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: 6,
                            border: allUsersSelected ? "1px solid rgba(11,31,53,0.75)" : "1px solid rgba(0,0,0,0.18)",
                            background: allUsersSelected ? "linear-gradient(#0f2a4a,#0b1f35)" : "linear-gradient(#ffffff,#f3f4f6)",
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: "white",
                            fontSize: 12,
                            lineHeight: 1,
                            flex: "0 0 auto",
                          }}
                        >
                          {allUsersSelected ? "✓" : ""}
                        </span>
                        Alle
                      </button>
                    </div>

                    {/* ✅ Collapsible list + search */}
                    {userPickerOpen && (
                      <>
                        {isMobileView && (
                          <div
                            onClick={() => setUserPickerOpen(false)}
                            style={{
                              position: "fixed",
                              inset: 0,
                              background: "rgba(0,0,0,0.35)",
                              backdropFilter: "blur(2px)",
                              WebkitBackdropFilter: "blur(2px)",
                              zIndex: 9998,
                            }}
                          />
                        )}

                        <div
                          style={
                            isMobileView
                              ? {
                                  position: "fixed",
                                  left: 12,
                                  right: 12,
                                  bottom: 12,
                                  zIndex: 9999,
                                  borderRadius: 16,
                                  border: "1px solid rgba(0,0,0,0.10)",
                                  background: "linear-gradient(#ffffff,#f9fafb)",
                                  boxShadow: "0 18px 60px rgba(0,0,0,0.22)",
                                  padding: 12,
                                  display: "grid",
                                  gap: 10,
                                }
                              : {
                                  borderRadius: 12,
                                  border: "1px solid rgba(0,0,0,0.08)",
                                  background: "linear-gradient(#ffffff,#f9fafb)",
                                  padding: 10,
                                  display: "grid",
                                  gap: 6,
                                }
                          }
                        >
                          {isMobileView && (
                            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
                              <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>User auswählen</div>
                              <button
                                type="button"
                                onClick={() => setUserPickerOpen(false)}
                                style={{
                                  borderRadius: 999,
                                  padding: "8px 10px",
                                  border: "1px solid rgba(0,0,0,0.10)",
                                  background: "linear-gradient(#ffffff,#f3f4f6)",
                                  fontFamily: FONT_FAMILY,
                                  fontWeight: FW_SEMI,
                                  fontSize: 12,
                                  cursor: "pointer",
                                }}
                                aria-label="Schließen"
                                title="Schließen"
                              >
                                Schließen
                              </button>
                            </div>
                          )}

                          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                            <div style={{ position: "relative", flex: "1 1 auto" }}>
                              <input
                                ref={userSearchRef}
                                value={userSearch}
                                onChange={(e) => setUserSearch(e.target.value)}
                                placeholder="User suchen…"
                                style={{
                                  width: "100%",
                                  borderRadius: 10,
                                  border: "1px solid rgba(0,0,0,0.12)",
                                  padding: "8px 36px 8px 10px",
                                  fontFamily: FONT_FAMILY,
                                  fontWeight: FW_REG,
                                  fontSize: 13,
                                  outline: "none",
                                }}
                              />
                              {userSearch.trim().length > 0 && (
                                <button
                                  type="button"
                                  onClick={() => setUserSearch("")}
                                  style={{
                                    position: "absolute",
                                    right: 6,
                                    top: "50%",
                                    transform: "translateY(-50%)",
                                    width: 28,
                                    height: 28,
                                    borderRadius: 10,
                                    border: "1px solid rgba(0,0,0,0.10)",
                                    background: "linear-gradient(#ffffff,#f3f4f6)",
                                    fontFamily: FONT_FAMILY,
                                    fontWeight: FW_SEMI,
                                    cursor: "pointer",
                                    color: "#6b7280",
                                  }}
                                  aria-label="Suche leeren"
                                  title="Suche leeren"
                                >
                                  ×
                                </button>
                              )}
                            </div>

                            {isMobileView && (
                              <button
                                type="button"
                                onClick={toggleAllUsers}
                                disabled={busy || (isNew ? false : !canEditAdminFields)}
                                style={{
                                  flex: "0 0 auto",
                                  display: "inline-flex",
                                  alignItems: "center",
                                  gap: 6,
                                  padding: "8px 10px",
                                  borderRadius: 12,
                                  border: "1px solid rgba(0,0,0,0.08)",
                                  background: allUsersSelected ? "linear-gradient(#DBEAFE,#BFDBFE)" : "linear-gradient(#ffffff,#f3f4f6)",
                                  cursor: busy ? "not-allowed" : "pointer",
                                  opacity: busy ? 0.6 : 1,
                                  fontFamily: FONT_FAMILY,
                                  fontWeight: FW_SEMI,
                                  fontSize: 12,
                                  whiteSpace: "nowrap",
                                }}
                                title={allUsersSelected ? "Alle abwählen" : "Alle auswählen"}
                              >
                                <span
                                  style={{
                                    width: 18,
                                    height: 18,
                                    borderRadius: 6,
                                    border: allUsersSelected ? "1px solid rgba(11,31,53,0.75)" : "1px solid rgba(0,0,0,0.18)",
                                    background: allUsersSelected ? "linear-gradient(#0f2a4a,#0b1f35)" : "linear-gradient(#ffffff,#f3f4f6)",
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color: "white",
                                    fontSize: 12,
                                    lineHeight: 1,
                                    flex: "0 0 auto",
                                  }}
                                >
                                  {allUsersSelected ? "✓" : ""}
                                </span>
                                Alle
                              </button>
                            )}
                          </div>

                          {filteredUserOptions.length === 0 ? (
                            <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 13, color: "#6b7280" }}>
                              Keine Treffer
                            </div>
                          ) : (
                            <div style={{ maxHeight: isMobileView ? "60vh" : 220, overflow: "auto", display: "grid", gap: 6 }}>
                              {filteredUserOptions.map((u) => {
                                const checked = selectedUserIds.includes(u.uid);
                                return (
                                  <button
                                    key={u.uid}
                                    type="button"
                                    onClick={() => toggleUser(u.uid)}
                                    disabled={busy || (isNew ? false : !canEditAdminFields)}
                                    style={{
                                      width: "100%",
                                      display: "flex",
                                      alignItems: "center",
                                      justifyContent: "space-between",
                                      gap: 10,
                                      padding: "10px 10px",
                                      borderRadius: 12,
                                      border: "1px solid rgba(0,0,0,0.08)",
                                      background: checked ? "linear-gradient(#DBEAFE,#BFDBFE)" : "white",
                                      cursor: busy ? "not-allowed" : "pointer",
                                      opacity: busy ? 0.6 : 1,
                                      fontFamily: FONT_FAMILY,
                                      textAlign: "left",
                                    }}
                                    title={u.name}
                                  >
                                    <span style={{ display: "inline-flex", alignItems: "center", gap: 10, minWidth: 0 }}>
                                      <span
                                        style={{
                                          width: 18,
                                          height: 18,
                                          borderRadius: 6,
                                          border: checked ? "1px solid rgba(11,31,53,0.75)" : "1px solid rgba(0,0,0,0.18)",
                                          background: checked ? "linear-gradient(#0f2a4a,#0b1f35)" : "linear-gradient(#ffffff,#f3f4f6)",
                                          display: "inline-flex",
                                          alignItems: "center",
                                          justifyContent: "center",
                                          color: "white",
                                          fontSize: 12,
                                          lineHeight: 1,
                                          flex: "0 0 auto",
                                        }}
                                      >
                                        {checked ? "✓" : ""}
                                      </span>

                                      <span
                                        style={{
                                          fontWeight: checked ? FW_SEMI : FW_REG,
                                          fontSize: 14,
                                          color: "#111827",
                                          overflow: "hidden",
                                          textOverflow: "ellipsis",
                                          whiteSpace: "nowrap",
                                        }}
                                      >
                                        {u.name}
                                      </span>
                                    </span>

                                    <span style={{ fontSize: 12, color: checked ? "#1E3A8A" : "#9ca3af", whiteSpace: "nowrap" }}>
                                      {checked ? "Ausgewählt" : ""}
                                    </span>
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </>
                    )}

                  </div>
                </div>

                {/* Terminart */}
                <div className="appt-admin-field" style={{ display: "grid", gap: 6, minWidth: 0 }} ref={typeRef}>
                  <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Terminart</label>
                  <button
                    type="button"
                    onClick={() => !busy && setTypeOpen((v) => !v)}
                    disabled={busy || (!isNew && !canEditAdminFields)}
                    className="appt-compact-select"
                    style={{
                      width: "100%",
                      textAlign: "left",
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      fontFamily: FONT_FAMILY,
                      fontWeight: FW_SEMI,
                      background: "white",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      gap: 10,
                      cursor: busy ? "not-allowed" : "pointer",
                      opacity: busy ? 0.6 : 1,
                      minWidth: 0,
                    }}
                    title="Terminart auswählen"
                  >
                    <span style={{ color: "#111827", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {appointmentType}
                    </span>
                    <span style={{ color: "#6b7280", flex: "0 0 auto" }}>▾</span>
                  </button>

                  {typeOpen && (
                    <div style={{ position: "relative", overflow: "visible" }}>
                    <div
                      style={{
                        position: "absolute",
                        top: 8,
                        left: 0,
                        right: 0,
                        borderRadius: 14,
                        border: "1px solid #e5e7eb",
                        background: "white",
                        boxShadow: "0 18px 55px rgba(0,0,0,0.18)",
                        padding: 8,
                        zIndex: 9999,
                      }}
                        role="dialog"
                        aria-label="Terminart auswählen"
                      >
                      {APPOINTMENT_TYPES.map((t) => {
                        const selected = appointmentType === t;
                        return (
                          <button
                            key={t}
                            type="button"
                            onClick={() => {
                              setAppointmentType(t);
                              setTypeOpen(false);
                            }}
                            style={{
                              width: "100%",
                              textAlign: "left",
                              padding: "6px 10px",
                              borderRadius: 12,
                              border: selected ? "1px solid rgba(11,31,53,0.35)" : "1px solid transparent",
                              background: selected ? "rgba(15,42,74,0.06)" : "white",
                              cursor: "pointer",
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "space-between",
                              gap: 10,
                              fontFamily: FONT_FAMILY,
                              fontWeight: FW_SEMI,
                              color: "#111827",
                            }}
                          >
                            <span>{t}</span>
                            <span
                              style={{
                                width: 18,
                                height: 18,
                                borderRadius: 999,
                                border: selected ? `2px solid #0f2a4a` : "2px solid rgba(0,0,0,0.12)",
                                background: selected ? "rgba(15,42,74,0.10)" : "white",
                                color: selected ? "#0f2a4a" : "transparent",
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                lineHeight: 1,
                                fontSize: 12.5,
                                fontFamily: FONT_FAMILY,
                                fontWeight: FW_SEMI,
                              }}
                              aria-hidden="true"
                            >
                              ✓
                            </span>
                          </button>
                        );
                      })}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Title & Description */}
            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Titel</label>
              {isAdmin || isNew ? (
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="z.B. Wartung / Besichtigung"
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_REG,
                  }}
                  disabled={busy || (!isNew && !canEditAdminFields)}
                />
              ) : (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "linear-gradient(#ffffff, #f9fafb)",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_SEMI,
                    color: "#111827",
                  }}
                >
                  {title?.trim() ? title : "—"}
                </div>
              )}
            </div>

            <div style={{ display: "grid", gap: 6 }}>
              <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Beschreibung</label>

              {/* ✅ Admin: Rich Text (ohne Kursiv) */}
              {isAdmin ? (
                <div style={{ display: "grid", gap: 8 }}>
                  <style>{`
                    .rt-desc-editor { font-size: 14px; line-height: 1.4; }
                    .rt-desc-editor b, .rt-desc-editor strong { font-weight: 800 !important; }
                    .rt-desc-editor font[size="2"] { font-size: 12px; }
                    .rt-desc-editor font[size="3"] { font-size: 14px; }
                    .rt-desc-editor font[size="5"] { font-size: 18px; }
                  `}</style>
                  <div
                    style={{
                      display: "flex",
                      flexWrap: "nowrap",
                      overflowX: "auto",
                      gap: 6,
                      alignItems: "center",
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      background: "linear-gradient(#ffffff, #f9fafb)",
                    }}
                  >
                    <Btn
                      variant="secondary"
                      onClick={() => execDesc("bold")}
                      disabled={busy || (!isNew && !canEditAdminFields)}
                      title="Fett"
                      style={DESC_TOOLBTN_STYLE}
                    >
                      <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>B</span>
                    </Btn>

                    <Btn
                      variant="secondary"
                      onClick={() => execDesc("underline")}
                      disabled={busy || (!isNew && !canEditAdminFields)}
                      title="Unterstrichen"
                      style={DESC_TOOLBTN_STYLE}
                    >
                      <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, textDecoration: "underline" }}>U</span>
                    </Btn>

	                    <div style={{ display: "flex", alignItems: "center", gap: 6, paddingLeft: 4 }}>
	                      <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#6b7280", fontSize: 12 }}>Größe:</span>
	                      <Btn
	                        variant="secondary"
	                        onClick={() => execDesc("fontSize", DESC_FONT_SIZE_MAP.small)}
	                        disabled={busy || (!isNew && !canEditAdminFields)}
	                        title="Schriftgröße: klein"
                        style={DESC_TOOLBTN_STYLE}
	                      >
	                        A-
	                      </Btn>
	                      <Btn
	                        variant="secondary"
	                        onClick={() => execDesc("fontSize", DESC_FONT_SIZE_MAP.medium)}
	                        disabled={busy || (!isNew && !canEditAdminFields)}
	                        title="Schriftgröße: mittel"
                        style={DESC_TOOLBTN_STYLE}
	                      >
	                        A
	                      </Btn>
	                      <Btn
	                        variant="secondary"
	                        onClick={() => execDesc("fontSize", DESC_FONT_SIZE_MAP.large)}
	                        disabled={busy || (!isNew && !canEditAdminFields)}
	                        title="Schriftgröße: groß"
                        style={DESC_TOOLBTN_STYLE}
	                      >
	                        A+
	                      </Btn>

	                      <span style={{ width: 1, height: 20, background: "#e5e7eb", marginLeft: 6, marginRight: 2 }} />

                      <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#6b7280", fontSize: 12 }}>Farbe:</span>
                      <input
                        type="color"
                        value={descColor}
                        onMouseDown={(e) => {
                          // Wenn Text markiert ist, Farbe sofort anwenden (Picker nicht öffnen).
                          if (hasDescSelection()) {
                            e.preventDefault();
                            execDesc("foreColor", descColor);
                          }
                        }}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDescColor(v);
                          execDesc("foreColor", v);
                        }}
                        disabled={busy || (!isNew && !canEditAdminFields)}
                        title="Textfarbe wählen"
                        style={{ width: 36, height: 32, borderRadius: 10, border: "1px solid #e5e7eb", padding: 0, background: "white" }}
                      />
                      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                        {DESC_COLOR_PRESETS.map((c) => (
                          <button
                            key={c}
                            type="button"
                            onClick={() => {
                              setDescColor(c);
                              execDesc("foreColor", c);
                            }}
                            title={c}
                            disabled={busy || (!isNew && !canEditAdminFields)}
                            style={{
                              width: 18,
                              height: 18,
                              borderRadius: 999,
                              border: c.toLowerCase() == String(descColor).toLowerCase() ? "2px solid #0b1f35" : "1px solid rgba(0,0,0,0.18)",
                              background: c,
                              cursor: busy ? "not-allowed" : "pointer",
                            }}
                          />
                        ))}
                      </div>

                      <span style={{ width: 1, height: 20, background: "#e5e7eb", marginLeft: 6, marginRight: 2 }} />

                      <span style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#6b7280", fontSize: 12 }}>Listen:</span>
                      <Btn
                        variant="secondary"
                        onClick={() => execDesc("insertUnorderedList")}
                        disabled={busy || (!isNew && !canEditAdminFields)}
                        title="Aufzählung"
                        style={DESC_TOOLBTN_STYLE}
                      >
                        •
                      </Btn>
                      <Btn
                        variant="secondary"
                        onClick={() => execDesc("insertOrderedList")}
                        disabled={busy || (!isNew && !canEditAdminFields)}
                        title="Nummerierung"
                        style={DESC_TOOLBTN_STYLE}
                      >
                        1.
                      </Btn>

                      <Btn
                        variant="secondary"
                        onClick={() => execDesc("removeFormat")}
                        disabled={busy || (!isNew && !canEditAdminFields)}
                        title="Formatierung entfernen"
                        style={DESC_TOOLBTN_STYLE}
                      >
                        ⌫
                      </Btn>
                    </div>
                  </div>

                  <div
                    ref={descEditorRef}
                    className="rt-desc-editor"
                    contentEditable={!busy && (isNew || canEditAdminFields)}
                    suppressContentEditableWarning
	                    onFocus={ensureDescNotBoldByDefault}
                    onInput={() => setDescription(descEditorRef.current?.innerHTML ?? "")}
                    onBlur={() => setDescription(descEditorRef.current?.innerHTML ?? "")}
                    style={{
                      padding: 10,
                      borderRadius: 12,
                      border: "1px solid #e5e7eb",
                      minHeight: 98,
                      background: "white",
                      fontFamily: FONT_FAMILY,
                      fontWeight: FW_REG,
                      outline: "none",
                      whiteSpace: "pre-wrap",
                    }}
                  />
                </div>
              ) : isNew ? (
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Optional…"
                  rows={4}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    resize: "vertical",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_REG,
                  }}
                  disabled={busy}
                />
              ) : (
                <div
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    background: "linear-gradient(#ffffff, #f9fafb)",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_REG,
                    color: "#111827",
                    whiteSpace: "pre-wrap",
                  }}
                  dangerouslySetInnerHTML={{ __html: description?.trim() ? descriptionToHtml(description) : "—" }}
                />
              )}
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb" }} />

            {/* Zeiten */}
            {isAdmin || isNew ? (
              <>
                <div className="appt-grid-2" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Datum</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        fontFamily: FONT_FAMILY,
                        fontWeight: FW_REG,
                      }}
                      disabled={busy || (!isNew && !canEditAdminFields)}
                    />
                  </div>

                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Startuhrzeit</label>
                    <select
                      value={startTime}
                      onChange={(e) => onPickStartTime(e.target.value)}
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: collisionMsgVisible ? "1px solid rgba(153,27,27,0.55)" : "1px solid #e5e7eb",
                        fontFamily: FONT_FAMILY,
                        fontWeight: FW_SEMI,
                        background: "white",
                      }}
                      disabled={busy || (!isNew && !canEditAdminFields)}
                    >
                      {startTimeSlots.map((t) => {
                        const dis = disabledTimes.has(t);
                        const hit = conflictByTime[t];
                        return (
                          <option key={t} value={t} disabled={!isAdmin && dis}>
                            {t}
                            {dis && hit ? `  (belegt: ${truncateLabel(hit.title || "Ohne Titel", 18)})` : ""}
                          </option>
                        );
                      })}
                    </select>

                    {collisionMsgVisible && (
                      <div style={{ marginTop: 4, color: "#991b1b", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                        Bitte wähle eine freie Uhrzeit.
                      </div>
                    )}
                  </div>
                </div>

                <div className="appt-grid-2 appt-grid-2--duration" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
                      <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Termindauer</label>

                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>Ganztägig</span>
                        <Toggle
                          checked={allDay}
                          onChange={(v) => {
                            setAllDay(v);
                            if (v) {
                              if (startDate) setStartTime("00:00");
                              if (endDate) setEndTime("23:59");
                            }
                          }}
                          disabled={busy || (!isNew && !canEditAdminFields)}
                        />
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: 10, flexWrap: "nowrap",
                      overflowX: "auto", alignItems: "center" }}>
                      <input
                        type="number"
                        min={1}
                        inputMode="numeric"
                        value={durationValue}
                        onChange={(e) => {
                          setDurationQuick("");
                          setDurationValue(clampInt(Number(e.target.value), 1, Number.MAX_SAFE_INTEGER));
                        }}
                        placeholder="z.B. 2"
                        className="appt-duration-value"
                        style={{
                          width: 110,
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_SEMI,
                        }}
                        disabled={allDay || busy || (!isNew && !canEditAdminFields)}
                      />

                      <select
                        value={durationUnit}
                        onChange={(e) => {
                          setDurationQuick("");
                          setDurationUnit(e.target.value as DurationUnitUi);
                        }}
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_SEMI,
                          background: "white",
                        }}
                        disabled={allDay || busy || (!isNew && !canEditAdminFields)}
                      >
                        <option value="minutes">Minuten</option>
                        <option value="hours">Stunden</option>
                        <option value="days">Tage</option>
                      </select>

                      <select
                        value={durationQuick}
                        onChange={(e) => {
                          const v = e.target.value;
                          setDurationQuick(v);
                          if (!v) return;

                          const mins = Number(v);
                          if (!Number.isFinite(mins) || mins <= 0) return;

                          setDurationMinutes(mins);
                          const ui = toUiValueAndUnit(mins);
                          setDurationValue(ui.value);
                          setDurationUnit(ui.unit);
                        }}
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_SEMI,
                          background: "white",
                        }}
                        disabled={allDay || busy || (!isNew && !canEditAdminFields)}
                      >
                        <option value="">Schnellauswahl…</option>
                        <option value="15">15 Minuten</option>
                        <option value="30">30 Minuten</option>
                        <option value="45">45 Minuten</option>
                        <option value="60">60 Minuten</option>
                      </select>

                      <span
                        style={{
                          color: "#6b7280",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_SEMI,
                          fontSize: 12,
                          padding: "8px 10px",
                          borderRadius: 999,
                          border: "1px solid rgba(0,0,0,0.08)",
                          background: "linear-gradient(#ffffff, #f9fafb)",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {allDay ? "1 Tag" : formatDurationLabel(durationMinutes)}
                      </span>
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Ende (Datum / Uhrzeit)</label>
                    <div className="appt-grid-2-tight" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr)", gap: 10 }}>
                      <input
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_REG,
                        }}
                        disabled={allDay || busy || (!isNew && !canEditAdminFields)}
                      />
                      <input
                        type="time"
                        value={endTime}
                        onChange={(e) => setEndTime(e.target.value)}
                        style={{
                          padding: 10,
                          borderRadius: 12,
                          border: "1px solid #e5e7eb",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_REG,
                        }}
                        disabled={allDay || busy || (!isNew && !canEditAdminFields)}
                      />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="appt-grid-3" style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) minmax(0,1fr)", gap: 12 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Datum</label>
                    <div
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        background: "linear-gradient(#ffffff, #f9fafb)",
                        fontFamily: FONT_FAMILY,
                        fontWeight: FW_SEMI,
                        color: "#111827",
                      }}
                    >
                      {fmtDateFromInput(startDate)}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Startuhrzeit</label>
                    <div
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        background: "linear-gradient(#ffffff, #f9fafb)",
                        fontFamily: FONT_FAMILY,
                        fontWeight: FW_SEMI,
                        color: "#111827",
                      }}
                    >
                      {allDay ? "00:00" : (startTime || "—")}
                    </div>
                  </div>

                  <div style={{ display: "grid", gap: 6, minWidth: 0 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Enduhrzeit</label>
                    <div
                      style={{
                        padding: 10,
                        borderRadius: 12,
                        border: "1px solid #e5e7eb",
                        background: "linear-gradient(#ffffff, #f9fafb)",
                        fontFamily: FONT_FAMILY,
                        fontWeight: FW_SEMI,
                        color: "#111827",
                      }}
                    >
                      {allDay ? "23:59" : (endTime || "—")}
                    </div>
                  </div>
                </div>

                {/* Falls Termin ueber Mitternacht geht oder ganztags: Enddatum als Zusatzinfo */}
                {(allDay || (endDate && endDate !== startDate)) && (
                  <div style={{ marginTop: 8, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                    Ende am: {fmtDateFromInput(endDate)}{allDay ? "" : ""}
                  </div>
                )}
              </>
            )}

            {/* Dokumentationstext */}
            {!isNew && !isTrash && (
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{isAdmin ? "Dokumentationstext" : "Dokumentation"}</label>
                <textarea
                  value={documentationText}
                  onChange={(e) => setDocumentationText(e.target.value)}
                  rows={4}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    resize: "vertical",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_REG,
                  }}
                  disabled={busy || (isAdmin ? false : status !== "open")}
                  placeholder={isAdmin ? "Interne Doku…" : "Bitte Termin dokumentieren…"}
                />
                {!isAdmin && status !== "open" && (
                  <div style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>
                    Dokumentation ist gesperrt, weil der Termin nicht mehr „Offen“ ist.
                  </div>
                )}
              </div>
            )}

            {err && <p style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, marginTop: 4 }}>{err}</p>}

              <div className="mobile-only" style={{ marginTop: 12 }}>
                <div
                  onClick={() => setMobileMediaOpen((v) => !v)}
                  style={{
                    padding: "6px 10px",
                    borderRadius: 14,
                    border: "1px solid rgba(11,31,53,0.35)",
                    background: "linear-gradient(#0f2a4a, #0b1f35)",
                    color: "white",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_SEMI,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: "pointer",
                    userSelect: "none",
                  }}
                >
                  <span>Fotos &amp; Doku-Bilder</span>
                  <span style={{ fontSize: 18, lineHeight: 1 }}>{mobileMediaOpen ? "−" : "+"}</span>
                </div>

                {mobileMediaOpen && <div style={{ marginTop: 10 }}>{mediaPanel}</div>}
              </div>

            {/* Actions */}
            {isNew ? (
              <div style={{ display: "flex", gap: 10, flexWrap: "nowrap",
                      overflowX: "auto", marginTop: 6 }}>
                <Btn variant="navy" onClick={handleCreate} disabled={busy || !canSaveCreate}>
                  {busy ? "Speichere…" : recurringEnabled ? "Termine erstellen" : "Termin erstellen"}
                </Btn>
                <Btn variant="secondary" href="/dashboard" disabled={busy}>
                  Abbrechen
                </Btn>
              </div>
            ) : isAdmin ? (
              <div style={{ marginTop: 4 }}>
                {/* Desktop: unverändert (eine Zeile, Wrap) */}
                <div className="desktop-only" style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <ChipButton
                                          label={busy ? "Speichere…" : editSeriesEnabled && hasSeries ? "Serie speichern" : "Termin speichern"}
                                          tone="navy"
                                          onClick={handleSave}
                                          disabled={busy || !canSaveEdit}
                                          title="Termin speichern"
                                        />
                    <ChipButton
                                          label="Termin kopieren"
                                          tone="blue"
                                          onClick={copyAppointmentAdmin}
                                          disabled={busy || !canEditAdmin}
                                          title="Termin kopieren (Status wird Offen, mit Fotos & allen Usern)"
                                        />
                                        {isTrash ? (
  <>
   <ChipButton
  label="Termin wiederherstellen"
  tone="green"
  onClick={restoreAppointmentAdmin}
  disabled={busy || !isAdmin}
/>
<ChipButton
  label="Endgültig löschen"
  tone="red"
  onClick={hardDeleteAppointmentAdmin}
  disabled={busy || !isAdmin}
/>

  </>
) : (
  <ChipButton
    label="Termin löschen"
    tone="red"
    onClick={deleteAppointmentAdmin}
    disabled={busy || !canEditAdmin}
  />
)}

                </div>

                {/* Mobil: 2 Zeilen (Speichern+Kopieren / Rest) */}
                <div className="mobile-only">
                  <div style={{ marginTop: 4, display: "grid", gap: 10 }}>
                                  <div className="appt-admin-actions">
                                    {/* Row 1: Speichern + Kopieren */}
                                    <div className="appt-admin-actions-row">
                                      <ChipButton
                                        label={busy ? "Speichere…" : editSeriesEnabled && hasSeries ? "Serie speichern" : "Termin speichern"}
                                        tone="navy"
                                        onClick={handleSave}
                                        disabled={busy || !canSaveEdit}
                                        title="Termin speichern"
                                      />
                  
                                      <ChipButton
                                        label="Termin kopieren"
                                        tone="blue"
                                        onClick={copyAppointmentAdmin}
                                        disabled={busy || !canEditAdmin}
                                        title="Termin kopieren (Status wird Offen, mit Fotos & allen Usern)"
                                      />
                                    </div>
                  
                                    {/* Row 2: Rest */}
                                    <div className="appt-admin-actions-row">
                                      
                  
                                      {isTrash ? (
  <>
    <ChipButton
  label="Termin wiederherstellen"
  tone="green"
  onClick={restoreAppointmentAdmin}
  disabled={busy || !isAdmin}
/>
<ChipButton
  label="Endgültig löschen"
  tone="red"
  onClick={hardDeleteAppointmentAdmin}
  disabled={busy || !isAdmin}
/>

  </>
) : (
  <ChipButton
    label="Termin löschen"
    tone="red"
    onClick={deleteAppointmentAdmin}
    disabled={busy || !canEditAdmin}
  />
)}

                                    </div>
                                  </div>
                                </div>
                </div>
              </div>
            ) : (
              <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
                                {userDocErr && <p style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{userDocErr}</p>}

                <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Btn variant="navy" onClick={handleUserDocumentationSave} disabled={busy || userDocBusy || !userCanDocument}>
                    {userDocBusy ? "Speichere…" : "Dokumentation speichern"}
                  </Btn>
                  <Btn variant="secondary" href="/dashboard" disabled={busy || userDocBusy}>
                    Zurück
                  </Btn>
                </div>
              </div>
            )}
          </div>
        </section>

        {/* RIGHT */}
        <section className="desktop-only appt-right" style={frameStyle}>
          {mediaPanel}
        </section>
      </div>
      </div>

      <style jsx>{`
        :global(body) {
          font-family: ${FONT_FAMILY};
          font-weight: ${FW_REG};
        }
        :global(b),
        :global(strong) {
          font-weight: ${FW_SEMI};
        }
      `}</style>

      <style jsx>{`
        :global(*),
        :global(*::before),
        :global(*::after) {
          box-sizing: border-box;
        }

        /* ✅ Admin: User links, Terminart rechts (Web + Mobile) */
        .appt-admin-row {
          display: grid;
          grid-template-columns: minmax(0, 1.35fr) minmax(0, 0.65fr);
          gap: 12px;
          align-items: start;
          width: 100%;
          max-width: 820px;
        }
        .appt-admin-field {
          min-width: 0;
        }

        /* kompaktere Inputs/Selects für Mobile & generell angenehmer */
        .appt-compact-select {
          padding: 9px 10px;
          font-size: 14px;
          line-height: 1.2;
        }

        /* ✅ Zwei-Spalten-Grids dürfen wirklich schrumpfen (verhindert Abschneiden) */
        :global(.appt-grid-2) > * {
          min-width: 0;
        }

        /* ✅ Mobile: Dauer/Ende untereinander (sonst wird rechts abgeschnitten) */
        @media (max-width: 560px) {
          :global(.appt-grid-2--duration) {
            grid-template-columns: 1fr !important;
          }
        }

        @media (max-width: 1100px) {
          main > div[style*="grid-template-columns"] {
            grid-template-columns: 1fr !important;
          }
        }
        @media (max-width: 520px) {
          :global(.pendingCard) {
            grid-template-columns: 1fr !important;
          }
          :global(.photoCard) {
            grid-template-columns: 1fr !important;
          }
          :global(.photoCard img) {
            width: 100% !important;
            height: 160px !important;
          }
        }

        /* ✅ Mobile-only / Desktop-only helper */
        .mobile-only { display: none; }
        .desktop-only { display: block; }

        /* ✅ Page width: Mobile nutzt volle Breite sauber (kein zu breit / nicht voll ausgenutzt) */
        .appt-page {
          width: 100%;
          overflow-x: hidden;
        }

        /* ✅ Layout: Mobile = eine Spalte (damit links volle Breite nutzt und nichts überläuft) */
        .appt-layout { width: 100%; }
        .appt-left, .appt-right { min-width: 0; }

        @media (max-width: 600px) {
          .appt-layout {
            display: block !important;
            grid-template-columns: 1fr !important;
          }
          .appt-right {
            display: none !important;
          }
          .appt-left { width: 100% !important; }

          /* ✅ Mobile: Inputs/Textareas dürfen nie über den Viewport laufen */
          .appt-page input,
          .appt-page select,
          .appt-page textarea,
          .appt-page button {
            max-width: 100% !important;
          }

          .appt-page input:not(.appt-duration-value),
          .appt-page select,
          .appt-page textarea {
            width: 100% !important;
          }

          /* Termindauer-Zahlfeld: kompakter */
          .appt-duration-value { width: 72px !important; }
        }

        @media (max-width: 600px) {
          .appt-page {
            max-width: 100% !important;
            margin: 0 auto !important;
            padding: 12px !important;
          }
        }

        /* ✅ Header Chips: eine Zeile, bei Bedarf horizontal scrollen */
        .appt-header-chips::-webkit-scrollbar { height: 0; }
        .appt-header-chips { scrollbar-width: none; }

        /* ✅ Admin Actions: zwei Zeilen (Mobil), Desktop bleibt kompakt */
        .appt-admin-actions {
          display: grid;
          gap: 10px;
        }
        .appt-admin-actions-row {
          display: flex;
          gap: 10px;
          flex-wrap: wrap;
          align-items: center;
        }

        @media (max-width: 600px) {
          /* Row 1 soll auf Mobil in einer Zeile bleiben */
          .appt-admin-actions-row:first-child {
            flex-wrap: nowrap;
            overflow-x: auto;
            -webkit-overflow-scrolling: touch;
          }
          .appt-admin-actions-row:first-child::-webkit-scrollbar { height: 0; }
        }

        @media (max-width: 1100px) {
          .mobile-only { display: block !important; }
          .desktop-only { display: none !important; }

          /* Mobil: rechten Panel ausblenden (erscheint unten im Inhalt) */
          .appt-right { display: none !important; }

          /* Mobil: Hinweistext "Du kannst rechts unten..." ausblenden */
          .appt-doc-hint { display: none !important; }
        }
      `}</style>

      {/* ✅ Admin Hover Preview (nur Browser) */}
      {isAdmin && hoverPreview ? (
        <>
        <div
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(0,0,0,0.35)",
            backdropFilter: "blur(2px)",
            WebkitBackdropFilter: "blur(2px)",
            zIndex: 9998,
            pointerEvents: "none",
          }}
        />
        <div
          style={{
            position: "fixed",
            left: "50%",
            top: "50%",
            transform: "translate(-50%, -50%)",
            zIndex: 9999,
            pointerEvents: "none",
          }}
        >
          <img
            src={hoverPreview.url}
            alt="Vorschau"
            style={{
              width: 720,
              maxWidth: "92vw",
              height: "auto",
              maxHeight: "85vh",
              borderRadius: 14,
              border: "1px solid rgba(229,231,235,0.95)",
              boxShadow: "0 18px 60px rgba(0,0,0,0.22)",
              background: "white",
              objectFit: "contain",
              display: "block",
            }}
          />
        </div>
        </>
      ) : null}

    </main>
  );
}