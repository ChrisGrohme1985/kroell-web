"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db } from "@/lib/firebase";
import { getOrCreateUserProfile } from "@/lib/authProfile";
import type { Role, AppointmentStatus } from "@/lib/types";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  increment,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
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
  const dd = d.toLocaleDateString("de-DE");
  const tt = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  return `${dd} • ${tt}`;
}
function fmtDateGerman(d: Date) {
  return d.toLocaleDateString("de-DE");
}
function fmtTimeGerman(d: Date) {
  return d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
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
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 10px 22px rgba(0,0,0,0.06)",
    transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease",
    userSelect: "none",
    WebkitTapHighlightColor: "transparent",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
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
  tone: "gray" | "yellow" | "green" | "red" | "navy";
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
  tone: "yellow" | "green" | "red" | "blue" | "navy";
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
        padding: "10px 12px",
        borderRadius: 999,
        fontFamily: FONT_FAMILY,
        fontWeight: FW_SEMI,
        fontSize: 13,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled ? 0.6 : 1,
        boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 10px 22px rgba(0,0,0,0.06)",
        transition: "transform 80ms ease, box-shadow 120ms ease, background 120ms ease",
        userSelect: "none",
        WebkitTapHighlightColor: "transparent",
        ...map[tone],
      }}
      onMouseDown={(e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(0.98)")}
      onMouseUp={(e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)")}
      onMouseLeave={(e: any) => ((e.currentTarget as HTMLElement).style.transform = "scale(1)")}
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
  return full || String(x?.displayName ?? "").trim() || "—";
}

type PhotoDoc = {
  id: string;
  url: string;
  path?: string;
  comment?: string;
  uploadedAt?: Date | null;
  uploadedByUserId?: string;
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
};

/** ---------- time slots ---------- */
function makeTimeSlots(stepMinutes = 5) {
  const out: string[] = [];
  for (let h = 0; h < 24; h++) for (let m = 0; m < 60; m += stepMinutes) out.push(`${pad2(h)}:${pad2(m)}`);
  return out;
}
const TIME_SLOTS = makeTimeSlots(5);

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
  return new Date(d.getTime() + days * 24 * 60_000 * 60);
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

/** ✅ Upload via Next API (Option B, kein CORS) */
async function uploadPhotoViaApi(params: { apptId: string; file: File; comment: string }) {
  const u = auth.currentUser;
  if (!u) throw new Error("Nicht eingeloggt.");

  const token = await u.getIdToken(true);

  const fd = new FormData();
  fd.append("apptId", params.apptId);
  fd.append("comment", params.comment ?? "");
  fd.append("file", params.file);

  const res = await fetch("/api/upload-appointment-photo", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: fd,
  });

  const data = await res.json().catch(() => null);

  if (!res.ok || !data?.ok) {
    const msg = data?.error || `Upload fehlgeschlagen (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return data as {
    ok: true;
    uid: string;
    apptId: string;
    path: string;
    url: string;
    contentType: string;
    comment: string;
  };
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
  const isAdmin = roleLoaded && role === "admin";

  /** ✅ user name map (für Foto-Uploader + Header „Erstellt von“) */
  const [userNameById, setUserNameById] = useState<Record<string, string>>({});

  /** loading/err/busy */
  const [ready, setReady] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(!isNew);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  /** user options for admin dropdown */
  const [userOptions, setUserOptions] = useState<UserOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>(""); // create
  const [createdByUserId, setCreatedByUserId] = useState<string>(""); // edit

  /** appointment fields */
  const APPOINTMENT_TYPES = useMemo(() => ["-", "Urlaub"] as const, []);
  const [appointmentType, setAppointmentType] = useState<(typeof APPOINTMENT_TYPES)[number]>("-");
  const [typeOpen, setTypeOpen] = useState(false);
  const typeRef = useRef<HTMLDivElement | null>(null);

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");

  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  const [durationMinutes, setDurationMinutes] = useState<number>(15);

  /** ✅ neue UX-States */
  const [durationValue, setDurationValue] = useState<number>(15);
  const [durationUnit, setDurationUnit] = useState<DurationUnitUi>("minutes");
  const [durationQuick, setDurationQuick] = useState<string>("");

  /** ✅ Ganztägig */
  const [allDay, setAllDay] = useState(false);

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

  /** photos list in edit */
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);
  const [zipBusy, setZipBusy] = useState(false);
  const [zipErr, setZipErr] = useState<string | null>(null);

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

  /** ✅ effective duration */
  const effectiveDurationMinutes = useMemo(() => (allDay ? 24 * 60 : durationMinutes), [allDay, durationMinutes]);

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
      () => {}
    );
    return () => unsub();
  }, [roleLoaded, isAdmin]);

  function nameFromUid(uid?: string) {
    if (!uid) return "—";
    return userNameById[uid] || uid;
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

        const who = String(d.createdByUserId ?? "");
        setCreatedByUserId(who);

        setCreatedAt(d.createdAt ? (d.createdAt as Timestamp).toDate() : null);
        setUpdatedAt(d.updatedAt ? (d.updatedAt as Timestamp).toDate() : null);

        setLoadingDoc(false);
      },
      (e) => {
        setErr(e?.message ?? "Fehler beim Laden.");
        setLoadingDoc(false);
      }
    );

    return () => unsub();
  }, [roleLoaded, isNew, id]);

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
            comment: x.comment ?? "",
            uploadedAt: up,
            uploadedByUserId: String(x.uploadedByUserId ?? ""),
          };
        });
        setPhotos(list);
      },
      () => {}
    );

    return () => unsub();
  }, [roleLoaded, isNew, id]);

  /** dt memos */
  const startDt = useMemo(() => {
    if (!startDate || !startTime) return null;
    return parseLocalDateTime(startDate, startTime);
  }, [startDate, startTime]);

  const endDt = useMemo(() => {
    if (!endDate || !endTime) return null;
    return parseLocalDateTime(endDate, endTime);
  }, [endDate, endTime]);

  /** auto end from start+duration (or allDay) */
  const updatingEndRef = useRef(false);
  useEffect(() => {
    if (!startDt) return;
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

    for (const t of TIME_SLOTS) {
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
  }, [dayAppts, startDate, startTime, effectiveDurationMinutes]);

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

  async function findFirstCollisionInStarts(params: { userId: string; starts: Date[]; durationMinutes: number; excludeId?: string }) {
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

  /** ✅ Upload PendingPhoto[] -> via Next API + photos subcollection */
  async function uploadPendingPhotoArray(params: { apptId: string; items: PendingPhoto[]; allowPhotoCountUpdate: boolean }) {
    const { apptId, items, allowPhotoCountUpdate } = params;

    const u = auth.currentUser;
    if (!u) throw new Error("Nicht eingeloggt.");

    let success = 0;

    for (let i = 0; i < items.length; i++) {
      const p = items[i];

      // ✅ Upload über API (kein CORS)
      const uploaded = await uploadPhotoViaApi({
        apptId,
        file: p.file,
        comment: p.comment?.trim() ?? "",
      });

      // ✅ Firestore-Doc wie bisher
      await addDoc(collection(db, "appointments", apptId, "photos"), {
        url: uploaded.url,
        path: uploaded.path,
        comment: p.comment?.trim() ?? "",
        uploadedAt: serverTimestamp(),
        uploadedByUserId: u.uid,
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

  /** ✅ Admin: Termin kopieren -> neues Doc, Status open, gleiche Daten, KEINE Fotos kopieren */
  async function copyAppointmentAdmin() {
    if (!isAdmin || isNew || isTrash || !id) return;
    const ok = window.confirm("Termin kopieren?\n\nEs wird ein neuer Termin mit Status „Offen“ erstellt (ohne Fotos).");
    if (!ok) return;

    setBusy(true);
    setErr(null);

    try {
      const snap = await getDocs(query(collection(db, "appointments"), where("__name__", "==", id)));
      const srcDoc = snap.docs?.[0];
      if (!srcDoc) throw new Error("Quelle nicht gefunden.");

      const d = srcDoc.data() as any;
      const s = (d.startDate as Timestamp).toDate();
      const e = (d.endDate as Timestamp).toDate();

      const newRef = await addDoc(collection(db, "appointments"), {
        title: String(d.title ?? "").trim(),
        description: String(d.description ?? "").trim(),
        startDate: Timestamp.fromDate(s),
        endDate: Timestamp.fromDate(e),
        status: "open",
        createdByUserId: String(d.createdByUserId ?? auth.currentUser?.uid ?? ""),
        appointmentType: String(d.appointmentType ?? "-"),
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
        updatedAt: serverTimestamp(),
      });

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

  /** ---- actions ---- */
  const canSaveCreate = useMemo(() => {
    if (!roleLoaded) return false;
    if (!title.trim()) return false;
    if (!startDt || !endDt) return false;
    if (endDt.getTime() <= startDt.getTime()) return false;
    if (!recurrenceUiOkCreate) return false;

    const uid = isAdmin ? selectedUserId : auth.currentUser?.uid ?? "";
    if (!uid) return false;

    if (startTime && disabledTimes.has(startTime)) return false;
    return true;
  }, [roleLoaded, isAdmin, title, startDt, endDt, recurrenceUiOkCreate, selectedUserId, startTime, disabledTimes]);

  const canSaveEdit = useMemo(() => {
    if (!isAdmin || isTrash || isNew) return false;
    if (!title.trim()) return false;
    if (!startDt || !endDt) return false;
    if (endDt.getTime() <= startDt.getTime()) return false;
    if (!createdByUserId) return false;
    if (startTime && disabledTimes.has(startTime)) return false;
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
    const starts = recurringEnabled ? generateOccurrences({ startDt, rule: recurrenceRuleCreate, maxCountCap: MAX_INSTANCES_CAP }) : [startDt];

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
      setErr(
        `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        })})`
      );
      return;
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
    if (!createdByUserId) {
      setErr("Bitte einen User auswählen.");
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

      const collision = await findFirstCollisionInStarts({
        userId: createdByUserId,
        starts,
        durationMinutes: effectiveDurationMinutes,
        excludeId: id,
      });
      if (collision) {
        setCollisionMsgVisible(true);
        setSelectedConflict(collision);
        setConflictFrameOpen(false);
        setErr(
          `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString("de-DE", {
            hour: "2-digit",
            minute: "2-digit",
          })})`
        );
        setBusy(false);
        return;
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
          createdByUserId: createdByUserId,

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
    if (!createdByUserId) {
      setErr("Bitte einen User auswählen.");
      return;
    }

    if (editSeriesEnabled && hasSeries) {
      await applySeriesEdit(true);
      return;
    }

    const collision = await findCollisionExact({ userId: createdByUserId, start: startDt, end: endDt, excludeId: id });
    if (collision) {
      setCollisionMsgVisible(true);
      setSelectedConflict(collision);
      setConflictFrameOpen(false);
      setErr(
        `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString("de-DE", {
          hour: "2-digit",
          minute: "2-digit",
        })})`
      );
      return;
    }

    setBusy(true);
    try {
      await updateDoc(doc(db, "appointments", id), {
        createdByUserId,
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

  /** ---------------------------------
   * UI: derived display
   * --------------------------------- */
  const headerWho = useMemo(() => {
    if (isNew) return isAdmin ? nameFromUid(selectedUserId) : nameFromUid(auth.currentUser?.uid ?? "");
    return nameFromUid(createdByUserId);
  }, [isNew, isAdmin, selectedUserId, createdByUserId, userNameById]);

  const headerCreatedLine = useMemo(() => {
    const who = headerWho;
    const created = createdAt ? fmtDateTime(createdAt) : "—";
    const updated = updatedAt ? fmtDateTime(updatedAt) : null;
    const upd = updated ? ` • aktualisiert: ${updated}` : "";
    return `Erstellt von: ${who} • erstellt: ${created}${upd}`;
  }, [headerWho, createdAt, updatedAt]);

  const statusChip = useMemo(() => {
    if (isTrash) return <Chip label="Papierkorb" tone="red" />;
    if (status === "open") return <Chip label="Offen" tone="yellow" />;
    if (status === "documented") return <Chip label="Dokumentiert" tone="green" />;
    if (status === "done") return <Chip label="Erledigt" tone="navy" />;
    return <Chip label={statusLabel(status)} tone="gray" />;
  }, [isTrash, status]);

  const pageTitle = useMemo(() => {
    if (isNew) return "Termin anlegen";
    return "Termin bearbeiten";
  }, [isNew]);

  const durationLabel = useMemo(() => formatDurationLabel(effectiveDurationMinutes), [effectiveDurationMinutes]);

  /** ✅ quick durations */
  const QUICK_OPTIONS: { k: string; minutes: number; label: string }[] = useMemo(
    () => [
      { k: "15m", minutes: 15, label: "15 Min" },
      { k: "30m", minutes: 30, label: "30 Min" },
      { k: "45m", minutes: 45, label: "45 Min" },
      { k: "1h", minutes: 60, label: "1 Std" },
      { k: "2h", minutes: 120, label: "2 Std" },
      { k: "4h", minutes: 240, label: "4 Std" },
      { k: "1d", minutes: 24 * 60, label: "1 Tag" },
    ],
    []
  );

  function applyQuickDuration(key: string) {
    const o = QUICK_OPTIONS.find((x) => x.k === key);
    if (!o) return;
    setDurationQuick(key);

    const ui = toUiValueAndUnit(o.minutes);
    setDurationMinutes(o.minutes);
    setDurationValue(ui.value);
    setDurationUnit(ui.unit);

    if (o.minutes >= 24 * 60) setAllDay(true);
    else setAllDay(false);
  }

  function onToggleAllDay(v: boolean) {
    setAllDay(v);
    if (v) {
      setDurationQuick("1d");
      setDurationMinutes(24 * 60);
      setDurationValue(1);
      setDurationUnit("days");
    } else {
      // back to sensible default if leaving all day:
      const fallback = 15;
      setDurationQuick("15m");
      setDurationMinutes(fallback);
      setDurationValue(15);
      setDurationUnit("minutes");
    }
  }

  /** UI: reusable input styles */
  const cardStyle: React.CSSProperties = {
    borderRadius: 18,
    border: "1px solid rgba(0,0,0,0.10)",
    boxShadow: "0 1px 1px rgba(0,0,0,0.06), 0 12px 30px rgba(0,0,0,0.06)",
    background: "linear-gradient(#ffffff, #f9fafb)",
    padding: 16,
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: FONT_FAMILY,
    fontWeight: FW_SEMI,
    color: "#111827",
    fontSize: 13,
    marginBottom: 6,
    display: "block",
  };

  const inputStyle: React.CSSProperties = {
    width: "100%",
    borderRadius: 12,
    border: "1px solid rgba(0,0,0,0.14)",
    padding: "11px 12px",
    fontFamily: FONT_FAMILY,
    fontWeight: FW_REG,
    outline: "none",
    boxShadow: "inset 0 1px 2px rgba(0,0,0,0.06)",
    background: "white",
  };

  const textareaStyle: React.CSSProperties = {
    ...inputStyle,
    minHeight: 110,
    resize: "vertical",
  };

  const grid2: React.CSSProperties = {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: 12,
  };

  const row: React.CSSProperties = {
    display: "flex",
    gap: 12,
    alignItems: "center",
    flexWrap: "wrap",
  };

  /** ✅ disable fields when locked by state */
  const adminEditLocked = useMemo(() => {
    if (!isAdmin) return true;
    if (isTrash) return true;
    if (status === "documented" || status === "done") return true; // keep consistent
    return false;
  }, [isAdmin, isTrash, status]);

  const userCanDocument = useMemo(() => {
    if (isAdmin) return false;
    if (isNew) return false;
    if (isTrash) return false;
    return status === "open";
  }, [isAdmin, isNew, isTrash, status]);

  /** ------------- render ------------- */
  if (!ready || !roleLoaded) {
    return (
      <div style={{ fontFamily: FONT_FAMILY, padding: 24 }}>
        <div style={{ ...cardStyle, maxWidth: 980, margin: "0 auto" }}>Lade…</div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: FONT_FAMILY, padding: 18, background: "#f3f4f6", minHeight: "100vh" }}>
      <div style={{ maxWidth: 1040, margin: "0 auto", display: "grid", gap: 14 }}>
        {/* TOP BAR */}
        <div style={{ ...cardStyle, padding: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 6 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <h1 style={{ margin: 0, fontSize: 22, fontWeight: 800, letterSpacing: -0.2 }}>
                  {pageTitle}
                </h1>
                {statusChip}
                {hasSeries && !isTrash ? <Chip label="Serie" tone="gray" /> : null}
              </div>
              <div style={{ fontSize: 13, color: "#374151", fontWeight: FW_MED }}>{headerCreatedLine}</div>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
              <Btn href="/dashboard" variant="secondary">
                Zurück
              </Btn>

              {/* ✅ Admin: Kopieren */}
              {isAdmin && !isNew && !isTrash ? (
                <Btn onClick={copyAppointmentAdmin} variant="mint" disabled={busy}>
                  Termin kopieren
                </Btn>
              ) : null}
            </div>
          </div>

          {/* Errors */}
          {(err || zipErr || adminUploadErr || userDocErr) && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(244,63,94,0.35)",
                background: "linear-gradient(#fff1f2,#ffe4e6)",
                color: "#9f1239",
                fontWeight: FW_SEMI,
                fontSize: 13,
              }}
            >
              {err || zipErr || adminUploadErr || userDocErr}
            </div>
          )}

          {/* Collision banner */}
          {collisionMsgVisible && selectedConflict && (
            <div
              style={{
                marginTop: 12,
                padding: 12,
                borderRadius: 12,
                border: "1px solid rgba(251,191,36,0.9)",
                background: "linear-gradient(#FEF9C3,#FDE68A)",
                color: "#92400E",
                fontWeight: FW_SEMI,
                fontSize: 13,
                display: "flex",
                justifyContent: "space-between",
                gap: 10,
                alignItems: "center",
                flexWrap: "wrap",
              }}
            >
              <div>
                Kollision mit: <b>{selectedConflict.title || "Termin"}</b> •{" "}
                {fmtDateGerman(selectedConflict.startDate)} {fmtTimeGerman(selectedConflict.startDate)}–{fmtTimeGerman(selectedConflict.endDate)}
              </div>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                <Btn onClick={openSelectedConflictInFrame} variant="yellow">
                  Termin öffnen
                </Btn>
                <Btn
                  onClick={() => {
                    setCollisionMsgVisible(false);
                    setSelectedConflict(null);
                  }}
                  variant="secondary"
                >
                  Schließen
                </Btn>
              </div>
            </div>
          )}
        </div>

        {/* ✅ conflict frame */}
        {conflictFrameOpen && selectedConflict?.id && (
          <div style={{ ...cardStyle, padding: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <div style={{ fontWeight: 800, fontSize: 14 }}>Konflikt-Termindetails</div>
              <Btn onClick={() => setConflictFrameOpen(false)} variant="secondary">
                Schließen
              </Btn>
            </div>
            <div style={{ marginTop: 10, borderRadius: 14, overflow: "hidden", border: "1px solid rgba(0,0,0,0.10)" }}>
              <iframe
                src={`/appointments/${selectedConflict.id}`}
                style={{ width: "100%", height: 520, border: 0, background: "white" }}
                title="Konflikttermin"
              />
            </div>
          </div>
        )}

        {/* MAIN GRID */}
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 14 }}>
          {/* LEFT: FORM */}
          <div style={{ ...cardStyle }}>
            {/* Admin user select (create) */}
            {isNew && isAdmin && (
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>User</label>
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                >
                  {userOptions.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Admin user select (edit) */}
            {!isNew && isAdmin && (
              <div style={{ marginBottom: 12 }}>
                <label style={labelStyle}>User</label>
                <select
                  value={createdByUserId}
                  onChange={(e) => setCreatedByUserId(e.target.value)}
                  disabled={adminEditLocked}
                  style={{ ...inputStyle, cursor: adminEditLocked ? "not-allowed" : "pointer", opacity: adminEditLocked ? 0.6 : 1 }}
                >
                  {userOptions.map((u) => (
                    <option key={u.uid} value={u.uid}>
                      {u.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Type dropdown */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Terminart</label>

              <div ref={typeRef} style={{ position: "relative" }}>
                <button
                  type="button"
                  onClick={() => setTypeOpen((v) => !v)}
                  disabled={!isAdmin} // ✅ user cannot change
                  style={{
                    ...inputStyle,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    cursor: isAdmin ? "pointer" : "not-allowed",
                    opacity: isAdmin ? 1 : 0.7,
                  }}
                  title={isAdmin ? "Terminart wählen" : "Terminart kann nur ein Admin ändern"}
                >
                  <span style={{ fontWeight: FW_SEMI }}>{appointmentType}</span>
                  <span style={{ opacity: 0.6 }}>▾</span>
                </button>

                {typeOpen && isAdmin && (
                  <div
                    style={{
                      position: "absolute",
                      zIndex: 50,
                      top: "calc(100% + 8px)",
                      left: 0,
                      right: 0,
                      background: "white",
                      borderRadius: 14,
                      border: "1px solid rgba(0,0,0,0.10)",
                      boxShadow: "0 20px 40px rgba(0,0,0,0.10)",
                      padding: 8,
                    }}
                  >
                    {APPOINTMENT_TYPES.map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => {
                          setAppointmentType(t);
                          setTypeOpen(false);
                        }}
                        style={{
                          width: "100%",
                          padding: "10px 12px",
                          borderRadius: 12,
                          border: "1px solid transparent",
                          background: t === appointmentType ? "linear-gradient(#0f2a4a,#0b1f35)" : "white",
                          color: t === appointmentType ? "white" : "#111827",
                          fontFamily: FONT_FAMILY,
                          fontWeight: FW_SEMI,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Title */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Titel</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="z.B. Baustelle / Projekt / Urlaub"
                style={inputStyle}
                disabled={(!isNew && adminEditLocked && isAdmin) || (isNew && busy)}
              />
            </div>

            {/* Description */}
            <div style={{ marginBottom: 12 }}>
              <label style={labelStyle}>Beschreibung</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
                style={textareaStyle}
                disabled={(!isNew && adminEditLocked && isAdmin) || (isNew && busy)}
              />
            </div>

            {/* Date/time grid */}
            <div style={{ ...grid2, marginBottom: 12 }}>
              <div>
                <label style={labelStyle}>Startdatum</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  style={inputStyle}
                  disabled={(!isNew && adminEditLocked && isAdmin) || busy}
                />
              </div>

              <div>
                <label style={labelStyle}>Startzeit</label>
                <select
                  value={startTime}
                  onChange={(e) => onPickStartTime(e.target.value)}
                  style={{ ...inputStyle, cursor: "pointer" }}
                  disabled={(!isNew && adminEditLocked && isAdmin) || busy}
                  title={disabledTimes.has(startTime) ? "Kollision" : undefined}
                >
                  {TIME_SLOTS.map((t) => {
                    const dis = disabledTimes.has(t);
                    const c = conflictByTime[t];
                    const label = dis && c ? `${t}  (belegt: ${c.title || "Termin"})` : t;
                    return (
                      <option key={t} value={t} disabled={dis}>
                        {label}
                      </option>
                    );
                  })}
                </select>
              </div>

              <div>
                <label style={labelStyle}>Enddatum</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  style={inputStyle}
                  disabled={true /* end auto */}
                  title="Ende wird automatisch aus Start + Dauer berechnet"
                />
              </div>

              <div>
                <label style={labelStyle}>Endzeit</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  style={inputStyle}
                  disabled={true /* end auto */}
                  title="Ende wird automatisch aus Start + Dauer berechnet"
                />
              </div>
            </div>

            {/* Duration + All-day */}
            <div style={{ marginBottom: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ ...labelStyle, marginBottom: 0 }}>Dauer</span>
                  <Chip label={durationLabel} tone="gray" />
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 13, fontWeight: FW_SEMI, color: "#111827" }}>Ganztägig</span>
                  <Toggle checked={allDay} onChange={onToggleAllDay} disabled={(!isNew && adminEditLocked && isAdmin) || busy} />
                </div>
              </div>

              {/* Quick buttons */}
              <div style={{ marginTop: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
                {QUICK_OPTIONS.map((o) => (
                  <ChipButton
                    key={o.k}
                    label={o.label}
                    tone={durationQuick === o.k ? "navy" : "blue"}
                    onClick={() => applyQuickDuration(o.k)}
                    disabled={(!isNew && adminEditLocked && isAdmin) || busy}
                  />
                ))}
              </div>

              {/* Value + unit */}
              <div style={{ ...row, marginTop: 10 }}>
                <input
                  type="number"
                  min={1}
                  value={durationValue}
                  onChange={(e) => setDurationValue(clampInt(Number(e.target.value), 1, 99999))}
                  disabled={allDay || ((!isNew && adminEditLocked && isAdmin) || busy)}
                  style={{ ...inputStyle, width: 140, opacity: allDay ? 0.6 : 1 }}
                />
                <select
                  value={durationUnit}
                  onChange={(e) => setDurationUnit(e.target.value as DurationUnitUi)}
                  disabled={allDay || ((!isNew && adminEditLocked && isAdmin) || busy)}
                  style={{ ...inputStyle, width: 180, cursor: allDay ? "not-allowed" : "pointer", opacity: allDay ? 0.6 : 1 }}
                >
                  <option value="minutes">Minuten</option>
                  <option value="hours">Stunden</option>
                  <option value="days">Tage</option>
                </select>

                <div style={{ fontSize: 13, color: "#374151", fontWeight: FW_MED }}>
                  Ende: <b>{endDate}</b> <b>{endTime}</b>
                </div>
              </div>
            </div>

            {/* SERIES: create only */}
            {isNew && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>Serientermin</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: FW_SEMI }}>Aktiv</span>
                    <Toggle checked={recurringEnabled} onChange={setRecurringEnabled} disabled={busy} />
                  </div>
                </div>

                {recurringEnabled && (
                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    <div style={grid2}>
                      <div>
                        <label style={labelStyle}>Wiederholen alle</label>
                        <input
                          type="number"
                          min={1}
                          value={repeatEvery}
                          onChange={(e) => setRepeatEvery(clampInt(Number(e.target.value), 1, 999))}
                          style={inputStyle}
                          disabled={busy}
                        />
                      </div>

                      <div>
                        <label style={labelStyle}>Einheit</label>
                        <select value={repeatUnit} onChange={(e) => setRepeatUnit(e.target.value as RepeatUnit)} style={{ ...inputStyle, cursor: "pointer" }} disabled={busy}>
                          <option value="day">Tag</option>
                          <option value="week">Woche</option>
                          <option value="month">Monat</option>
                          <option value="year">Jahr</option>
                        </select>
                      </div>
                    </div>

                    {repeatUnit === "week" && (
                      <div>
                        <label style={labelStyle}>Wochentag</label>
                        <select value={weekdaySingle} onChange={(e) => setWeekdaySingle(Number(e.target.value))} style={{ ...inputStyle, cursor: "pointer" }} disabled={busy}>
                          {WEEKDAYS.map((w) => (
                            <option key={w.k} value={w.k}>
                              {w.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {repeatUnit === "month" && (
                      <div>
                        <label style={labelStyle}>Tag im Monat (1–27)</label>
                        <input type="number" min={1} max={27} value={monthDay} onChange={(e) => setMonthDay(clampInt(Number(e.target.value), 1, 27))} style={inputStyle} disabled={busy} />
                      </div>
                    )}

                    <div style={grid2}>
                      <div>
                        <label style={labelStyle}>Ende</label>
                        <select value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)} style={{ ...inputStyle, cursor: "pointer" }} disabled={busy}>
                          <option value="never">Nie</option>
                          <option value="onDate">Am Datum</option>
                          <option value="afterCount">Nach Anzahl</option>
                        </select>
                      </div>

                      {endMode === "onDate" ? (
                        <div>
                          <label style={labelStyle}>Enddatum</label>
                          <input type="date" value={endOnDate} onChange={(e) => setEndOnDate(e.target.value)} style={inputStyle} disabled={busy} />
                        </div>
                      ) : endMode === "afterCount" ? (
                        <div>
                          <label style={labelStyle}>Anzahl</label>
                          <input type="number" min={1} value={endAfterCount} onChange={(e) => setEndAfterCount(clampInt(Number(e.target.value), 1, 1000))} style={inputStyle} disabled={busy} />
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>

                    {!recurrenceUiOkCreate && (
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: "1px solid rgba(244,63,94,0.35)",
                          background: "linear-gradient(#fff1f2,#ffe4e6)",
                          color: "#9f1239",
                          fontWeight: FW_SEMI,
                          fontSize: 13,
                        }}
                      >
                        Bitte Serien-Einstellungen prüfen (Enddatum darf nicht vor dem Start liegen, Werte gültig).
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* ACTIONS */}
            <div style={{ marginTop: 18, display: "flex", gap: 10, flexWrap: "wrap" }}>
              {isNew ? (
                <Btn onClick={handleCreate} variant="primary" disabled={!canSaveCreate || busy}>
                  {busy ? "Speichere…" : "Termin anlegen"}
                </Btn>
              ) : (
                <>
                  {isAdmin && !isTrash && (
                    <Btn onClick={handleSave} variant="primary" disabled={!canSaveEdit || busy}>
                      {busy ? "Speichere…" : "Speichern"}
                    </Btn>
                  )}
                </>
              )}

              {/* Admin status chips */}
              {!isNew && isAdmin && !isTrash && (
                <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <ChipButton
                    label="Auf dokumentiert setzen"
                    tone="green"
                    onClick={markAsDocumentedAdmin}
                    disabled={busy || status !== "open"}
                    title={status !== "open" ? "Nur möglich wenn Status = Offen" : undefined}
                  />
                  <ChipButton
                    label="Erledigt"
                    tone="navy"
                    onClick={markAsDoneAdmin}
                    disabled={busy || status === "done"}
                    title={status === "done" ? "Schon erledigt" : undefined}
                  />
                  <ChipButton
                    label="Löschen"
                    tone="red"
                    onClick={deleteAppointmentAdmin}
                    disabled={busy}
                    title="In den Papierkorb verschieben"
                  />

                  {/* Serie löschen (wenn Serie) */}
                  {hasSeries ? (
                    <ChipButton
                      label="Serie löschen"
                      tone="red"
                      onClick={deleteSeries}
                      disabled={busy}
                      title="Alle Termine dieser Serie in den Papierkorb"
                    />
                  ) : null}
                </div>
              )}
            </div>

            {/* SERIES EDIT (admin, edit, series only) */}
            {!isNew && isAdmin && hasSeries && !isTrash && (
              <div style={{ marginTop: 18, paddingTop: 16, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>Serie bearbeiten</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span style={{ fontSize: 13, fontWeight: FW_SEMI }}>Aktiv</span>
                    <Toggle checked={editSeriesEnabled} onChange={setEditSeriesEnabled} disabled={busy} />
                  </div>
                </div>

                {editSeriesEnabled && (
                  <div style={{ marginTop: 12, display: "grid", gap: 12 }}>
                    <div style={grid2}>
                      <div>
                        <label style={labelStyle}>Wiederholen alle</label>
                        <input
                          type="number"
                          min={1}
                          value={repeatEvery}
                          onChange={(e) => setRepeatEvery(clampInt(Number(e.target.value), 1, 999))}
                          style={inputStyle}
                          disabled={busy}
                        />
                      </div>

                      <div>
                        <label style={labelStyle}>Einheit</label>
                        <select value={repeatUnit} onChange={(e) => setRepeatUnit(e.target.value as RepeatUnit)} style={{ ...inputStyle, cursor: "pointer" }} disabled={busy}>
                          <option value="day">Tag</option>
                          <option value="week">Woche</option>
                          <option value="month">Monat</option>
                          <option value="year">Jahr</option>
                        </select>
                      </div>
                    </div>

                    {repeatUnit === "week" && (
                      <div>
                        <label style={labelStyle}>Wochentag</label>
                        <select value={weekdaySingle} onChange={(e) => setWeekdaySingle(Number(e.target.value))} style={{ ...inputStyle, cursor: "pointer" }} disabled={busy}>
                          {WEEKDAYS.map((w) => (
                            <option key={w.k} value={w.k}>
                              {w.label}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {repeatUnit === "month" && (
                      <div>
                        <label style={labelStyle}>Tag im Monat (1–27)</label>
                        <input type="number" min={1} max={27} value={monthDay} onChange={(e) => setMonthDay(clampInt(Number(e.target.value), 1, 27))} style={inputStyle} disabled={busy} />
                      </div>
                    )}

                    <div style={grid2}>
                      <div>
                        <label style={labelStyle}>Ende</label>
                        <select value={endMode} onChange={(e) => setEndMode(e.target.value as EndMode)} style={{ ...inputStyle, cursor: "pointer" }} disabled={busy}>
                          <option value="never">Nie</option>
                          <option value="onDate">Am Datum</option>
                          <option value="afterCount">Nach Anzahl</option>
                        </select>
                      </div>

                      {endMode === "onDate" ? (
                        <div>
                          <label style={labelStyle}>Enddatum</label>
                          <input type="date" value={endOnDate} onChange={(e) => setEndOnDate(e.target.value)} style={inputStyle} disabled={busy} />
                        </div>
                      ) : endMode === "afterCount" ? (
                        <div>
                          <label style={labelStyle}>Anzahl</label>
                          <input type="number" min={1} value={endAfterCount} onChange={(e) => setEndAfterCount(clampInt(Number(e.target.value), 1, 1000))} style={inputStyle} disabled={busy} />
                        </div>
                      ) : (
                        <div />
                      )}
                    </div>

                    {!seriesUiOkEdit && (
                      <div
                        style={{
                          padding: 12,
                          borderRadius: 12,
                          border: "1px solid rgba(244,63,94,0.35)",
                          background: "linear-gradient(#fff1f2,#ffe4e6)",
                          color: "#9f1239",
                          fontWeight: FW_SEMI,
                          fontSize: 13,
                        }}
                      >
                        Bitte Serien-Einstellungen prüfen (Enddatum darf nicht vor dem Start liegen, Werte gültig).
                      </div>
                    )}

                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <Btn onClick={() => applySeriesEdit(true)} variant="primary" disabled={busy || !seriesUiOkEdit}>
                        Serie speichern (und zurück)
                      </Btn>
                      <Btn onClick={() => applySeriesEdit(false)} variant="secondary" disabled={busy || !seriesUiOkEdit}>
                        Serie speichern (erste Instanz öffnen)
                      </Btn>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* RIGHT: PHOTOS + DOCUMENTATION */}
          <div style={{ display: "grid", gap: 14 }}>
            {/* PHOTOS LIST (edit) */}
            {!isNew && (
              <div style={{ ...cardStyle }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>Bilder</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Btn onClick={downloadAllPhotosZip} variant="secondary" disabled={zipBusy || photos.length === 0}>
                      {zipBusy ? "ZIP…" : "Alle als ZIP"}
                    </Btn>
                  </div>
                </div>

                <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                  {photos.length === 0 ? (
                    <div style={{ fontSize: 13, color: "#6b7280", fontWeight: FW_MED }}>Noch keine Bilder.</div>
                  ) : (
                    photos.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 14,
                          overflow: "hidden",
                          background: "white",
                        }}
                      >
                        <div style={{ display: "grid", gridTemplateColumns: "110px 1fr", gap: 10, padding: 10 }}>
                          <div
                            style={{
                              width: 110,
                              height: 86,
                              borderRadius: 12,
                              overflow: "hidden",
                              border: "1px solid rgba(0,0,0,0.08)",
                              background: "#f3f4f6",
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.url} alt="Foto" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>

                          <div style={{ display: "grid", gap: 6, alignContent: "start" }}>
                            <div style={{ fontWeight: 800, fontSize: 13 }}>
                              {p.uploadedAt ? fmtDateTime(p.uploadedAt) : "—"}
                            </div>
                            <div style={{ fontSize: 13, color: "#374151", fontWeight: FW_MED }}>
                              Uploader: <b>{nameFromUid(p.uploadedByUserId)}</b>
                            </div>
                            {p.comment ? (
                              <div style={{ fontSize: 13, color: "#111827" }}>
                                <b>Kommentar:</b> {p.comment}
                              </div>
                            ) : (
                              <div style={{ fontSize: 13, color: "#6b7280" }}>Kein Kommentar.</div>
                            )}

                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 4 }}>
                              <Btn onClick={() => window.open(p.url, "_blank", "noreferrer")} variant="secondary">
                                Öffnen
                              </Btn>
                              <Btn onClick={() => downloadSinglePhoto(p)} variant="secondary">
                                Download
                              </Btn>
                            </div>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* ✅ Admin upload area (edit) */}
                {isAdmin && !isTrash && !adminEditLocked && (
                  <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px solid rgba(0,0,0,0.08)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                      <div style={{ fontWeight: 800, fontSize: 14 }}>Bilder hinzufügen (Admin)</div>
                      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                        <Btn onClick={() => adminFileInputRef.current?.click()} variant="secondary" disabled={adminUploadBusy}>
                          Bilder wählen
                        </Btn>
                        <Btn onClick={uploadAdminPendingPhotos} variant="primary" disabled={adminUploadBusy || adminPendingPhotos.length === 0}>
                          {adminUploadBusy ? "Upload…" : "Hochladen"}
                        </Btn>
                      </div>

                      <input
                        ref={adminFileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: "none" }}
                        onChange={(e) => addSelectedFilesToState(e.target.files, setAdminPendingPhotos, adminFileInputRef)}
                      />
                    </div>

                    {adminPendingPhotos.length > 0 && (
                      <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                        {adminPendingPhotos.map((p) => (
                          <div
                            key={p.id}
                            style={{
                              display: "grid",
                              gridTemplateColumns: "110px 1fr",
                              gap: 10,
                              border: "1px solid rgba(0,0,0,0.08)",
                              borderRadius: 14,
                              overflow: "hidden",
                              background: "white",
                              padding: 10,
                            }}
                          >
                            <div
                              style={{
                                width: 110,
                                height: 86,
                                borderRadius: 12,
                                overflow: "hidden",
                                border: "1px solid rgba(0,0,0,0.08)",
                                background: "#f3f4f6",
                              }}
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={p.previewUrl} alt="Vorschau" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                            </div>

                            <div style={{ display: "grid", gap: 8 }}>
                              <div style={{ fontWeight: 800, fontSize: 13 }}>{p.file.name}</div>
                              <input
                                value={p.comment}
                                onChange={(e) =>
                                  setAdminPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, comment: e.target.value } : x)))
                                }
                                placeholder="Kommentar (optional)"
                                style={inputStyle}
                              />
                              <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                                <Btn onClick={() => removePendingPhotoFromState(p.id, setAdminPendingPhotos)} variant="danger" disabled={adminUploadBusy}>
                                  Entfernen
                                </Btn>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* CREATE: pending photos */}
            {isNew && (
              <div style={{ ...cardStyle }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <div style={{ fontWeight: 800, fontSize: 15 }}>Bilder (optional)</div>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <Btn onClick={() => fileInputRef.current?.click()} variant="secondary" disabled={busy}>
                      Bilder wählen
                    </Btn>
                    {pendingPhotos.length > 0 ? (
                      <Btn onClick={() => clearPendingState(setPendingPhotos)} variant="danger" disabled={busy}>
                        Auswahl leeren
                      </Btn>
                    ) : null}
                  </div>

                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: "none" }}
                    onChange={(e) => addSelectedFilesToState(e.target.files, setPendingPhotos, fileInputRef)}
                  />
                </div>

                {pendingPhotos.length > 0 ? (
                  <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                    {pendingPhotos.map((p) => (
                      <div
                        key={p.id}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "110px 1fr",
                          gap: 10,
                          border: "1px solid rgba(0,0,0,0.08)",
                          borderRadius: 14,
                          overflow: "hidden",
                          background: "white",
                          padding: 10,
                        }}
                      >
                        <div
                          style={{
                            width: 110,
                            height: 86,
                            borderRadius: 12,
                            overflow: "hidden",
                            border: "1px solid rgba(0,0,0,0.08)",
                            background: "#f3f4f6",
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={p.previewUrl} alt="Vorschau" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                        </div>

                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ fontWeight: 800, fontSize: 13 }}>{p.file.name}</div>
                          <input
                            value={p.comment}
                            onChange={(e) => setPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, comment: e.target.value } : x)))}
                            placeholder="Kommentar (optional)"
                            style={inputStyle}
                          />
                          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                            <Btn onClick={() => removePendingPhotoFromState(p.id, setPendingPhotos)} variant="danger" disabled={busy}>
                              Entfernen
                            </Btn>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280", fontWeight: FW_MED }}>Noch keine Bilder ausgewählt.</div>
                )}
              </div>
            )}

            {/* USER documentation (edit, user only) */}
            {userCanDocument && (
              <div style={{ ...cardStyle }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>Dokumentation (User)</div>
                <div style={{ marginTop: 10 }}>
                  <label style={labelStyle}>Text</label>
                  <textarea
                    value={documentationText}
                    onChange={(e) => setDocumentationText(e.target.value)}
                    placeholder="Dokumentation eintragen…"
                    style={textareaStyle}
                    disabled={userDocBusy}
                  />
                </div>

                {/* ✅ user add photos exactly like create */}
                <div style={{ marginTop: 12 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                    <div style={{ fontWeight: 800, fontSize: 14 }}>Bilder hinzufügen</div>
                    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                      <Btn onClick={() => userFileInputRef.current?.click()} variant="secondary" disabled={userDocBusy}>
                        Bilder wählen
                      </Btn>
                      {userPendingPhotos.length > 0 ? (
                        <Btn onClick={() => clearPendingState(setUserPendingPhotos)} variant="danger" disabled={userDocBusy}>
                          Auswahl leeren
                        </Btn>
                      ) : null}
                    </div>

                    <input
                      ref={userFileInputRef}
                      type="file"
                      accept="image/*"
                      multiple
                      style={{ display: "none" }}
                      onChange={(e) => addSelectedFilesToState(e.target.files, setUserPendingPhotos, userFileInputRef)}
                    />
                  </div>

                  {userPendingPhotos.length > 0 ? (
                    <div style={{ marginTop: 12, display: "grid", gap: 10 }}>
                      {userPendingPhotos.map((p) => (
                        <div
                          key={p.id}
                          style={{
                            display: "grid",
                            gridTemplateColumns: "110px 1fr",
                            gap: 10,
                            border: "1px solid rgba(0,0,0,0.08)",
                            borderRadius: 14,
                            overflow: "hidden",
                            background: "white",
                            padding: 10,
                          }}
                        >
                          <div
                            style={{
                              width: 110,
                              height: 86,
                              borderRadius: 12,
                              overflow: "hidden",
                              border: "1px solid rgba(0,0,0,0.08)",
                              background: "#f3f4f6",
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={p.previewUrl} alt="Vorschau" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                          </div>

                          <div style={{ display: "grid", gap: 8 }}>
                            <div style={{ fontWeight: 800, fontSize: 13 }}>{p.file.name}</div>
                            <input
                              value={p.comment}
                              onChange={(e) =>
                                setUserPendingPhotos((prev) => prev.map((x) => (x.id === p.id ? { ...x, comment: e.target.value } : x)))
                              }
                              placeholder="Kommentar (optional)"
                              style={inputStyle}
                              disabled={userDocBusy}
                            />
                            <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                              <Btn onClick={() => removePendingPhotoFromState(p.id, setUserPendingPhotos)} variant="danger" disabled={userDocBusy}>
                                Entfernen
                              </Btn>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div style={{ marginTop: 12, fontSize: 13, color: "#6b7280", fontWeight: FW_MED }}>Noch keine Bilder ausgewählt.</div>
                  )}
                </div>

                <div style={{ marginTop: 14, display: "flex", gap: 10, flexWrap: "wrap" }}>
                  <Btn onClick={handleUserDocumentationSave} variant="primary" disabled={userDocBusy}>
                    {userDocBusy ? "Speichere…" : "Dokumentation abschließen"}
                  </Btn>
                </div>

                <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280", fontWeight: FW_MED }}>
                  Hinweis: Beim Abschließen wird der Termin auf <b>„Dokumentiert“</b> gesetzt.
                </div>
              </div>
            )}

            {/* ADMIN documentation textarea (edit + admin only, if not locked) */}
            {!isNew && isAdmin && !isTrash && (
              <div style={{ ...cardStyle }}>
                <div style={{ fontWeight: 800, fontSize: 15 }}>Dokumentation</div>
                <div style={{ marginTop: 10 }}>
                  <textarea
                    value={documentationText}
                    onChange={(e) => setDocumentationText(e.target.value)}
                    placeholder="Dokumentation / Notizen…"
                    style={textareaStyle}
                    disabled={adminEditLocked || busy}
                  />
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280", fontWeight: FW_MED }}>
                  Status: <b>{statusLabel(status)}</b> • Rolle: <b>{roleLabel(role)}</b>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer spacer */}
        <div style={{ height: 18 }} />
      </div>
    </div>
  );
}
