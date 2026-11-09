export const APP_TIMEZONE = "Asia/Jakarta";
export const JAKARTA_OFFSET = "+07:00";

/**
 * Convert any Date or ISO string to its YYYY-MM-DD representation in Asia/Jakarta
 */
export function toJakartaDateString(dateInput: Date | string): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: APP_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((p) => p.type === "year")?.value ?? "2026";
  const month = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}

/**
 * Convert any Date or ISO string to its HH:mm (24h) representation in Asia/Jakarta
 */
export function toJakartaTimeString(dateInput: Date | string): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: APP_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const hour = parts.find((p) => p.type === "hour")?.value ?? "00";
  const minute = parts.find((p) => p.type === "minute")?.value ?? "00";
  return `${hour === "24" ? "00" : hour}:${minute}`;
}

/**
 * Build an ISO 8601 TIMESTAMPTZ string in Asia/Jakarta (+07:00) from YYYY-MM-DD and HH:mm
 */
export function buildJakartaTimestamptz(dateStr: string, timeStr: string): string {
  const cleanTime = timeStr.length === 5 ? `${timeStr}:00` : timeStr;
  return `${dateStr}T${cleanTime}${JAKARTA_OFFSET}`;
}

/**
 * Format an ISO timestamp into a readable date in Asia/Jakarta (e.g. "Mon, Nov 9, 2026")
 */
export function formatJakartaDate(
  dateInput: Date | string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  }
): string {
  const date = typeof dateInput === "string" ? new Date(dateInput) : dateInput;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    ...options,
  }).format(date);
}

/**
 * Format an ISO timestamp range into "09:00 – 10:00" in Asia/Jakarta
 */
export function formatJakartaTimeRange(startIso: string, endIso: string): string {
  return `${toJakartaTimeString(startIso)} – ${toJakartaTimeString(endIso)}`;
}

/**
 * Calculate duration in minutes between two ISO timestamps
 */
export function getDurationMinutes(startIso: string, endIso: string): number {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return Math.max(0, Math.round((end - start) / 60000));
}

/**
 * Get the day of week (0 = Sunday ... 6 = Saturday) in Asia/Jakarta for a given Date or ISO string
 */
export function getJakartaDayOfWeek(dateInput: Date | string): number {
  const dateStr = typeof dateInput === "string" && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)
    ? dateInput
    : toJakartaDateString(dateInput);
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Add days to a YYYY-MM-DD string and return a new YYYY-MM-DD string
 */
export function addDaysToDateString(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + days));
  const year = dt.getUTCFullYear();
  const month = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Get Monday and Sunday YYYY-MM-DD strings (and ISO bounds) for the week containing referenceDate in Asia/Jakarta
 */
export function getJakartaWeekBounds(referenceDate: Date | string = new Date()): {
  mondayDate: string;
  sundayDate: string;
  startIso: string;
  endIso: string;
  weekDays: { dateStr: string; label: string; shortDay: string; dayNumber: string; isToday: boolean }[];
} {
  const todayStr = toJakartaDateString(new Date());
  const refStr =
    typeof referenceDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)
      ? referenceDate
      : toJakartaDateString(referenceDate);

  const dow = getJakartaDayOfWeek(refStr); // 0=Sun, 1=Mon, ..., 6=Sat
  const diffToMonday = dow === 0 ? -6 : 1 - dow;
  const mondayDate = addDaysToDateString(refStr, diffToMonday);
  const sundayDate = addDaysToDateString(mondayDate, 6);

  const startIso = `${mondayDate}T00:00:00${JAKARTA_OFFSET}`;
  const endIso = `${sundayDate}T23:59:59.999${JAKARTA_OFFSET}`;

  const weekDays = Array.from({ length: 7 }, (_, idx) => {
    const dateStr = addDaysToDateString(mondayDate, idx);
    const dt = new Date(`${dateStr}T12:00:00${JAKARTA_OFFSET}`);
    const shortDay = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIMEZONE,
      weekday: "short",
    }).format(dt);
    const dayNumber = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIMEZONE,
      day: "numeric",
    }).format(dt);
    const label = new Intl.DateTimeFormat("en-US", {
      timeZone: APP_TIMEZONE,
      weekday: "short",
      month: "short",
      day: "numeric",
    }).format(dt);

    return {
      dateStr,
      label,
      shortDay,
      dayNumber,
      isToday: dateStr === todayStr,
    };
  });

  return { mondayDate, sundayDate, startIso, endIso, weekDays };
}

/**
 * Format week header range like "October 19 – October 25, 2026"
 */
export function formatWeekRangeHeader(mondayDateStr: string, sundayDateStr: string): string {
  const startDt = new Date(`${mondayDateStr}T12:00:00${JAKARTA_OFFSET}`);
  const endDt = new Date(`${sundayDateStr}T12:00:00${JAKARTA_OFFSET}`);

  const startStr = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "long",
    day: "numeric",
  }).format(startDt);

  const endStr = new Intl.DateTimeFormat("en-US", {
    timeZone: APP_TIMEZONE,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(endDt);

  return `${startStr} – ${endStr}`;
}

/**
 * Generate 30-minute time slot options from startHour to endHour (e.g. "08:00" to "20:00")
 */
export function generateTimeSlots(startHour = 8, endHour = 20): string[] {
  const slots: string[] = [];
  for (let h = startHour; h <= endHour; h++) {
    const hh = String(h).padStart(2, "0");
    slots.push(`${hh}:00`);
    if (h < endHour) {
      slots.push(`${hh}:30`);
    }
  }
  return slots;
}

export const DAY_OF_WEEK_LABELS: Record<number, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  0: "Sunday",
};

export const ORDERED_DAYS_MON_TO_SUN = [1, 2, 3, 4, 5, 6, 0];

