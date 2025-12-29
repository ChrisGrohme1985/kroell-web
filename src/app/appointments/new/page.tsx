"use client";

import Link from "next/link";
import type React from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { auth, db, storage } from "@/lib/firebase";
import { getOrCreateUserProfile } from "@/lib/authProfile";
import type { Role, AppointmentStatus } from "@/lib/types";
import {
  addDoc,
  collection,
  doc,
  getDoc,
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

import { getDownloadURL, ref as storageRef, uploadBytes } from "firebase/storage";

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

/** ✅ duration formatting (logisch, wie gewünscht) */
function formatDurationLabel(totalMinutes: number) {
  const mins = Math.max(1, Math.round(totalMinutes));

  // Bis 59 Minuten = x Minuten
  if (mins < 60) return `${mins} Minuten`;

  // Ab 60 Minuten = Stunden (+ Rest-Minuten)
  if (mins < 24 * 60) {
    const h = Math.floor(mins / 60);
    const m = mins % 60;

    const hourLabel = h === 1 ? "Stunde" : "Stunden";
    if (m === 0) return `${h} ${hourLabel}`;
    return `${h} ${hourLabel} ${m} Minuten`;
  }

  // Ab 24 Stunden = Tage (+ Rest-Stunden/Minuten)
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

function unitUiLabel(u: DurationUnitUi) {
  if (u === "minutes") return "Minuten";
  if (u === "hours") return "Stunden";
  return "Tage";
}

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
    green: { background: "linear-gradient(#DCFCE7,#BBF7D0)", border: "1px solid rgba(34,197,94,0.75)", color: "#065f46" },
    red: { background: "linear-gradient(#fff1f2,#ffe4e6)", border: "1px solid rgba(244,63,94,0.35)", color: "#9f1239" },
    navy: { background: "linear-gradient(#0f2a4a,#0b1f35)", border: "1px solid rgba(11,31,53,0.75)", color: "white" },
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

// ✅ neue UX-States
const [durationValue, setDurationValue] = useState<number>(15);
const [durationUnit, setDurationUnit] = useState<DurationUnitUi>("minutes");
const [durationQuick, setDurationQuick] = useState<string>("");

const durationPresets = [15, 30, 45, 60];

  /** ✅ Ganztägig */
  const [allDay, setAllDay] = useState(false);

  /** documentation text (Admin + User) */
  const [documentationText, setDocumentationText] = useState("");

  /** status/trash info */
  const [status, setStatus] = useState<AppointmentStatus>("open");
  const [deletedAt, setDeletedAt] = useState<Date | null>(null);
  const [seriesId, setSeriesId] = useState<string | null>(null);
  const [seriesIndex, setSeriesIndex] = useState<number | null>(null);

  /** ✅ last changed */
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
/** ✅ createdAt */
const [createdAt, setCreatedAt] = useState<Date | null>(null);

/** ✅ display names */
const [createdByName, setCreatedByName] = useState<string>("—");
const [photoUserNameById, setPhotoUserNameById] = useState<Record<string, string>>({});


  const isTrash = !!deletedAt;
  const canEditAdmin = isAdmin && !isTrash && !isNew;
  const canEditAdminFields = isAdmin && !isTrash;

  /** photos list in edit */
  const [photos, setPhotos] = useState<PhotoDoc[]>([]);

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

  /** load users for admin dropdown */
  useEffect(() => {
    if (!roleLoaded) return;
    if (!isAdmin) {
      setUserOptions([]);
      return;
    }

    const qUsers = query(collection(db, "users"), limit(2000));
    const unsub = onSnapshot(
      qUsers,
      (snap) => {
        const opts: UserOption[] = snap.docs.map((d) => {
          const data = d.data() as any;
          return { uid: d.id, name: niceUserName(data) };
        });

        opts.sort((a, b) => a.name.localeCompare(b.name, "de"));
        setUserOptions(opts);
        setSelectedUserId((cur) => cur || opts[0]?.uid || auth.currentUser?.uid || "");
      },
      () => {}
    );

    return () => unsub();
  }, [roleLoaded, isAdmin]);

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

// ✅ Name des Erstellers laden
fetchUserNameById(who).then((name) => setCreatedByName(name));

setUpdatedAt(d.updatedAt ? (d.updatedAt as Timestamp).toDate() : null);

// ✅ createdAt aus DB
setCreatedAt(d.createdAt ? (d.createdAt as Timestamp).toDate() : null);

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
// ✅ Uploader-Namen nachladen
(async () => {
  const ids = Array.from(new Set(list.map((x) => String(x.uploadedByUserId ?? "")).filter(Boolean)));

  if (ids.length === 0) {
    setPhotoUserNameById({});
    return;
  }

  const pairs = await Promise.all(ids.map(async (uid) => [uid, await fetchUserNameById(uid)] as const));

  const map: Record<string, string> = {};
  for (const [uid, name] of pairs) map[uid] = name;

  setPhotoUserNameById(map);
})();

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
useEffect(() => {
  // Umrechnung von UI (Zahl + Einheit) → Minuten
  const factor = unitUiFactor(durationUnit);
  const calculatedMinutes = clampInt(
    Math.round(Number(durationValue) * factor),
    1,
    Number.MAX_SAFE_INTEGER
  );

  // Nur setzen, wenn sich wirklich etwas ändert
  if (calculatedMinutes !== durationMinutes) {
    setDurationMinutes(calculatedMinutes);
  }
}, [durationValue, durationUnit]);


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
async function fetchUserNameById(uid: string) {
  if (!uid) return "—";
  try {
    const snap = await getDoc(doc(db, "users", uid));
    if (!snap.exists()) return "—";
    return niceUserName(snap.data());
  } catch {
    return "—";
  }
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
      const ext = guessExt(p.file.name);

      const path = `appointments/${apptId}/photos/${u.uid}/${Date.now()}_${i}_${u.uid}.${ext}`;
      const sRef = storageRef(storage, path);

      await uploadBytes(sRef, p.file, { contentType: p.file.type || `image/${ext}` });
      const url = await getDownloadURL(sRef);

      await addDoc(collection(db, "appointments", apptId, "photos"), {
        url,
        path,
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
      setErr(
        `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString([], {
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
          `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString([], {
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
        `Kollision: ${collision.title || "Termin"} (${fmtDateTime(collision.startDate)}–${collision.endDate.toLocaleTimeString([], {
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
async function downloadUrlAsFile(url: string, filename: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Download fehlgeschlagen.");
  const blob = await res.blob();

  const a = document.createElement("a");
  const objUrl = URL.createObjectURL(blob);
  a.href = objUrl;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}

function filenameFromPhoto(p: PhotoDoc) {
  const raw = p.path ? p.path.split("/").slice(-1)[0] : "";
  if (raw) return raw;
  const ts = p.uploadedAt ? p.uploadedAt.getTime() : Date.now();
  return `foto_${ts}.jpg`;
}

async function handleDownloadPhoto(p: PhotoDoc) {
  if (!p?.url) return;
  const name = filenameFromPhoto(p);
  await downloadUrlAsFile(p.url, name);
}

async function handleDownloadAllPhotos() {
  if (!photos.length) return;

  for (const p of photos) {
    try {
      // eslint-disable-next-line no-await-in-loop
      await handleDownloadPhoto(p);
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => setTimeout(r, 200));
    } catch {
      // weiter
    }
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

  const showAppointmentTypeForUser =
    !isAdmin &&
    !isNew &&
    !isTrash &&
    String(appointmentType ?? "-").trim() !== "-" &&
    String(appointmentType ?? "").trim() !== "";

  const statusChipTone: "gray" | "yellow" | "green" | "red" =
    isTrash ? "red" : status === "documented" ? "yellow" : status === "done" ? "green" : "gray";

  return (
    <main style={{ maxWidth: 1280, margin: "24px auto", padding: 16, fontFamily: FONT_FAMILY, fontWeight: FW_REG }}>
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
                Status: <b>{isTrash ? "Gelöscht" : statusLabel(String(status))}</b> • Rolle: <b>{roleLabel(role)}</b>
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
  <p style={{ marginTop: 6, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
    Erstellt von: <b>{createdByName || "—"}</b> am <b>{createdAt ? fmtDateTime(createdAt) : "—"}</b>
    {updatedAt ? (
      <>
        {" "}
        • Letzte Änderung: <b>{fmtDateTime(updatedAt)}</b>
      </>
    ) : null}
  </p>
)}


          {!isNew && (
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
              <Chip label={isTrash ? "Gelöscht" : statusLabel(String(status))} tone={statusChipTone} />
              {showAppointmentTypeForUser && <Chip label={`Terminart: ${String(appointmentType)}`} tone="navy" />}
            </div>
          )}
        </div>

        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Btn href="/dashboard" variant="secondary">
            Dashboard
          </Btn>
        </div>
      </header>

      <div style={{ marginTop: 14, display: "grid", gridTemplateColumns: "1.15fr 1fr", gap: 12, alignItems: "start" }}>
        {/* LEFT */}
        <section style={frameStyle}>
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
                  padding: "10px 12px",
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
              <div style={{ display: "grid", gap: 6, maxWidth: 520 }}>
                <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>User</label>
                <select
                  value={isNew ? selectedUserId : createdByUserId}
                  onChange={(e) => (isNew ? setSelectedUserId(e.target.value) : setCreatedByUserId(e.target.value))}
                  style={{
                    padding: 10,
                    borderRadius: 12,
                    border: "1px solid #e5e7eb",
                    fontFamily: FONT_FAMILY,
                    fontWeight: FW_SEMI,
                    background: "white",
                  }}
                  disabled={busy || (isNew ? false : !canEditAdminFields)}
                >
                  {userOptions.length === 0 ? (
                    <option value="">Keine User gefunden</option>
                  ) : (
                    userOptions.map((u) => (
                      <option key={u.uid} value={u.uid}>
                        {u.name}
                      </option>
                    ))
                  )}
                </select>
              </div>
            )}

            {/* Terminart: NUR Admin */}
            {isAdmin && (
              <div style={{ display: "grid", gap: 6 }} ref={typeRef}>
                <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Terminart</label>
                <button
                  type="button"
                  onClick={() => !busy && setTypeOpen((v) => !v)}
                  disabled={busy || (!isNew && !canEditAdminFields)}
                  style={{
                    width: "100%",
                    textAlign: "left",
                    padding: 10,
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
                  }}
                  title="Terminart auswählen"
                >
                  <span style={{ color: "#111827" }}>{appointmentType}</span>
                  <span style={{ color: "#6b7280" }}>▾</span>
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
                              padding: "10px 12px",
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
              {isAdmin || isNew ? (
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
                    fontWeight: FW_REG,
                    color: "#111827",
                    whiteSpace: "pre-wrap",
                  }}
                >
                  {description?.trim() ? description : "—"}
                </div>
              )}
            </div>

            <hr style={{ border: "none", borderTop: "1px solid #e5e7eb" }} />

            {/* Zeiten */}
            {isAdmin || isNew ? (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Startdatum</label>
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

                  <div style={{ display: "grid", gap: 6 }}>
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
                      {TIME_SLOTS.map((t) => {
                        const dis = disabledTimes.has(t);
                        const hit = conflictByTime[t];
                        return (
                          <option key={t} value={t} disabled={dis}>
                            {t}
                            {dis && hit ? `  (belegt: ${hit.title || "Ohne Titel"})` : ""}
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

                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                  <div style={{ display: "grid", gap: 6 }}>
  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Termindauer</label>

    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <span style={{ color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>Ganztägig</span>
      <Toggle checked={allDay} onChange={(v) => setAllDay(v)} disabled={busy || (!isNew && !canEditAdminFields)} />
    </div>
  </div>

  {/* Zeile darunter: Zahl | Einheit | Schnellauswahl */}
  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
    {/* Freies Eingabefeld für Zahl */}
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


    {/* Dropdown: Minuten / Stunden / Tage */}
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

    {/* Schnellauswahl Dropdown */}
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


                  <div style={{ display: "grid", gap: 6 }}>
                    <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>Ende (Datum / Uhrzeit)</label>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
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
            ) : null}

            {/* Dokumentationstext */}
            {!isNew && !isTrash && (
              <div style={{ display: "grid", gap: 6 }}>
                <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>
                  {isAdmin ? "Dokumentationstext" : "Dokumentation"}
                </label>
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

            {/* Actions */}
{isNew ? (
  <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
    <Btn variant="navy" onClick={handleCreate} disabled={busy || !canSaveCreate}>
      {busy ? "Speichere…" : recurringEnabled ? "Termine erstellen" : "Termin erstellen"}
    </Btn>
    <Btn variant="secondary" href="/dashboard" disabled={busy}>
      Abbrechen
    </Btn>
  </div>
) : isAdmin ? (
  <div style={{ marginTop: 4, display: "grid", gap: 10 }}>
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
      <Btn variant="navy" onClick={handleSave} disabled={busy || !canSaveEdit}>
        {busy ? "Speichere…" : editSeriesEnabled && hasSeries ? "Serie speichern" : "Speichern"}
      </Btn>

      <Btn
        variant="yellow"
        onClick={markAsDocumentedAdmin}
        disabled={busy || !canEditAdmin || status === "documented" || status === "done"}
      >
        Als dokumentiert markieren
      </Btn>

      <Btn variant="green" onClick={markAsDoneAdmin} disabled={busy || !canEditAdmin || status === "done"}>
        Als erledigt markieren
      </Btn>

      <Btn variant="danger" onClick={deleteAppointmentAdmin} disabled={busy || !canEditAdmin}>
        Löschen
      </Btn>
    </div>
  </div>
) : (
  <div style={{ marginTop: 8, display: "grid", gap: 10 }}>
    <div
      style={{
        padding: 12,
        borderRadius: 14,
        border: "1px solid #e5e7eb",
        background: "linear-gradient(#ffffff, #f9fafb)",
      }}
    >
      <div style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, color: "#111827" }}>
        Termin dokumentieren
      </div>

      <div
        style={{
          marginTop: 6,
          color: "#6b7280",
          fontFamily: FONT_FAMILY,
          fontWeight: FW_MED,
          fontSize: 12,
        }}
      >
        Du kannst rechts unten Fotos hochladen und hier einen Text eingeben. Beim Speichern wird der Status automatisch auf
        „Dokumentiert“ gesetzt.
      </div>

      {status !== "open" && (
        <div
          style={{
            marginTop: 8,
            color: "#991b1b",
            fontFamily: FONT_FAMILY,
            fontWeight: FW_SEMI,
            fontSize: 12,
          }}
        >
          Dieser Termin ist nicht mehr „Offen“. Dokumentation ist nicht möglich.
        </div>
      )}
    </div>

    {userDocErr && (
      <p style={{ color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>
        {userDocErr}
      </p>
    )}
  </div>
)}

        </section>

        {/* RIGHT */}
        <section style={frameStyle}>

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
                            gridTemplateColumns: "1fr 96px",
                            gap: 10,
                            padding: 10,
                            border: "1px solid #e5e7eb",
                            borderRadius: 14,
                            background: "#fff",
                            alignItems: "start",
                          }}
                        >
                          <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                              <div style={{ minWidth: 0 }}>
                                <div
                                  style={{
                                    fontFamily: FONT_FAMILY,
                                    fontWeight: FW_SEMI,
                                    color: "#111827",
                                    whiteSpace: "nowrap",
                                    overflow: "hidden",
                                    textOverflow: "ellipsis",
                                  }}
                                >
                                  {p.file.name}
                                </div>
                                <div style={{ fontSize: 12, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
                                  {(p.file.size / 1024 / 1024).toFixed(2)} MB
                                </div>
                              </div>

                              <Btn variant="danger" onClick={() => removePendingPhotoFromState(p.id, setPendingPhotos)} disabled={busy}>
                                Entfernen
                              </Btn>
                            </div>

                            <div style={{ display: "grid", gap: 6 }}>
                              <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>Kommentar (optional)</label>
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

                          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                                    gap: 8,
                                    padding: "10px 12px",
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
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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

                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                                  gap: 8,
                                  padding: "10px 12px",
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
                              gridTemplateColumns: "1fr 96px",
                              gap: 10,
                              padding: 10,
                              border: "1px solid #e5e7eb",
                              borderRadius: 14,
                              background: "#fff",
                              alignItems: "start",
                            }}
                          >
                            <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                              <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                <div style={{ minWidth: 0 }}>
                                  <div
                                    style={{
                                      fontFamily: FONT_FAMILY,
                                      fontWeight: FW_SEMI,
                                      color: "#111827",
                                      whiteSpace: "nowrap",
                                      overflow: "hidden",
                                      textOverflow: "ellipsis",
                                    }}
                                  >
                                    {p.file.name}
                                  </div>
                                  <div style={{ fontSize: 12, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
                                    {(p.file.size / 1024 / 1024).toFixed(2)} MB
                                  </div>
                                </div>

                                <Btn variant="danger" onClick={() => removePendingPhotoFromState(p.id, setAdminPendingPhotos)} disabled={busy || adminUploadBusy}>
                                  Entfernen
                                </Btn>
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
                          </div>
                        ))}

                        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center" }}>
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

              <div
  style={{
    marginTop: 14,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 10,
    flexWrap: "wrap",
  }}
>
  <h2 style={{ fontSize: 16, fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, margin: 0 }}>Doku-Bilder</h2>

  {isAdmin && photos.length > 0 && (
    <Btn variant="secondary" onClick={handleDownloadAllPhotos} title="Alle Fotos nacheinander herunterladen">
      Alle herunterladen
    </Btn>
  )}
</div>

{photos.length === 0 ? (
  <p style={{ color: "#6b7280", marginTop: 10, fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
    Noch keine Bilder vorhanden.
  </p>
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

        <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
          {/* Meta + Dateiname */}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ color: "#6b7280", fontSize: 12, fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
                {p.uploadedAt ? fmtDateTime(p.uploadedAt) : "—"}
                {" • "}
                {p.uploadedByUserId ? (photoUserNameById[p.uploadedByUserId] ?? "—") : "—"}
              </div>

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
                title={p.path || ""}
              >
                {p.path ? p.path.split("/").slice(-1)[0] : "Foto"}
              </div>
            </div>
          </div>

          {/* Buttons */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Btn href={p.url} target="_blank" rel="noreferrer" variant="navy" title="Foto öffnen">
              Öffnen
            </Btn>

            {isAdmin && (
              <Btn variant="secondary" onClick={() => handleDownloadPhoto(p)} title="Foto herunterladen">
                Download
              </Btn>
            )}
          </div>

          {/* Kommentar */}
          <div style={{ display: "grid", gap: 6 }}>
            <label style={{ fontFamily: FONT_FAMILY, fontWeight: FW_SEMI, fontSize: 12 }}>Kommentar</label>
            <textarea
              value={p.comment ?? ""}
              readOnly
              rows={2}
              style={{
                padding: 10,
                borderRadius: 12,
                border: "1px solid #e5e7eb",
                resize: "vertical",
                fontFamily: FONT_FAMILY,
                fontWeight: FW_REG,
                background: "linear-gradient(#ffffff, #f9fafb)",
              }}
            />
          </div>
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
                      <div>Fotos hochladen (optional)</div>

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

                        <Btn variant="secondary" onClick={() => clearPendingState(setUserPendingPhotos)} disabled={busy || userDocBusy || userPendingPhotos.length === 0}>
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
                                gridTemplateColumns: "1fr 96px",
                                gap: 10,
                                padding: 10,
                                border: "1px solid #e5e7eb",
                                borderRadius: 14,
                                background: "#fff",
                                alignItems: "start",
                              }}
                            >
                              <div style={{ display: "grid", gap: 8, minWidth: 0 }}>
                                <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center" }}>
                                  <div style={{ minWidth: 0 }}>
                                    <div
                                      style={{
                                        fontFamily: FONT_FAMILY,
                                        fontWeight: FW_SEMI,
                                        color: "#111827",
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                      }}
                                    >
                                      {p.file.name}
                                    </div>
                                    <div style={{ fontSize: 12, color: "#6b7280", fontFamily: FONT_FAMILY, fontWeight: FW_MED }}>
                                      {(p.file.size / 1024 / 1024).toFixed(2)} MB
                                    </div>
                                  </div>

                                  <Btn variant="danger" onClick={() => removePendingPhotoFromState(p.id, setUserPendingPhotos)} disabled={busy || userDocBusy}>
                                    Entfernen
                                  </Btn>
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
                            </div>
                          ))}
                        </div>
                      )}

                      {userDocErr && (
                        <p style={{ marginTop: 10, color: "crimson", fontFamily: FONT_FAMILY, fontWeight: FW_SEMI }}>{userDocErr}</p>
                      )}
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
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
                                      gap: 8,
                                      padding: "10px 12px",
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
                              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
        </section>
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
      `}</style>
    </main>
  );
}
