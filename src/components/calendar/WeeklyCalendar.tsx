"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import FullCalendar, {
  type CalendarRef,
  type DateClickInfo,
  type EventClickInfo,
  type EventDisplayInfo,
  type EventInput,
} from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/react/timegrid";
import dayGridPlugin from "@fullcalendar/react/daygrid";
import interactionPlugin from "@fullcalendar/react/interaction";
import classicTheme from "@fullcalendar/react/themes/classic";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Filter,
  Clock,
  MapPin,
  User,
  GraduationCap,
  Music,
  Calendar as CalendarIcon,
  FileText,
  Edit3,
  GitPullRequest,
  Ban,
  CheckCircle2,
  XCircle,
  X,
  Repeat,
  Loader2,
  AlertCircle,
  SlidersHorizontal,
} from "lucide-react";
import { useCurrentUser } from "@/components/layout/AppShell";
import {
  broadcastRealtimeSync,
  getCachedApiData,
  setCachedApiData,
  useRealtimeSubscription,
} from "@/lib/realtime";
import { getTeacherPastelTheme } from "@/lib/teacher-colors";
import {
  addDaysToDateString,
  formatJakartaDate,
  formatJakartaTimeRange,
  formatWeekRangeHeader,
  generateTimeSlots,
  getDurationMinutes,
  getJakartaDayOfWeek,
  getJakartaWeekBounds,
  ORDERED_DAYS_MON_TO_SUN,
  toJakartaDateString,
  toJakartaTimeString,
} from "@/lib/timezone";
import type {
  AttendanceStatus,
  Instrument,
  Room,
  ScheduleStatus,
  ScheduleWithDetails,
  Student,
  TeacherWithDetails,
} from "@/types/database";

const DAY_SHORT_LABELS: Record<number, string> = {
  1: "Mon",
  2: "Tue",
  3: "Wed",
  4: "Thu",
  5: "Fri",
  6: "Sat",
  0: "Sun",
};

export function WeeklyCalendar() {
  const { profile, refreshNotifications } = useCurrentUser();
  const calendarRef = useRef<CalendarRef | null>(null);
  const isAdmin = profile.role === "admin";

  // Current anchor date (YYYY-MM-DD in Asia/Jakarta)
  const [anchorDate, setAnchorDate] = useState<string>(() =>
    toJakartaDateString(new Date())
  );
  const [isMobile, setIsMobile] = useState(false);

  // Configurable operating hours (default 08:00 - 20:00)
  const [startHour, setStartHour] = useState<number>(8);
  const [endHour, setEndHour] = useState<number>(20);
  const [showHoursConfig, setShowHoursConfig] = useState(false);

  // Filters
  const [teacherFilter, setTeacherFilter] = useState<string>("all");
  const [instrumentFilter, setInstrumentFilter] = useState<string>("all");
  const [roomFilter, setRoomFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("active");

  // Data state
  const cachedMeta = getCachedApiData<{
    teachers: TeacherWithDetails[];
    students: Student[];
    instruments: Instrument[];
    rooms: Room[];
  }>("/api/schedules:meta");
  const [schedules, setSchedules] = useState<ScheduleWithDetails[]>(
    () => getCachedApiData<ScheduleWithDetails[]>("/api/schedules:latest") ?? []
  );
  const [teachers, setTeachers] = useState<TeacherWithDetails[]>(
    () => cachedMeta?.teachers ?? []
  );
  const [students, setStudents] = useState<Student[]>(
    () => cachedMeta?.students ?? []
  );
  const [instruments, setInstruments] = useState<Instrument[]>(
    () => cachedMeta?.instruments ?? []
  );
  const [rooms, setRooms] = useState<Room[]>(() => cachedMeta?.rooms ?? []);
  const [loading, setLoading] = useState<boolean>(
    () => !getCachedApiData<ScheduleWithDetails[]>("/api/schedules:latest")
  );
  const [metaLoaded, setMetaLoaded] = useState<boolean>(() => !!cachedMeta);

  // Selected event ID for detail modal (derived from schedules array)
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(
    null
  );
  const selectedSchedule = useMemo(
    () => schedules.find((s) => s.id === selectedScheduleId) ?? null,
    [schedules, selectedScheduleId]
  );

  // Create / Edit Schedule Modal state (Admin)
  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] =
    useState<ScheduleWithDetails | null>(null);

  // Schedule Form State
  const [formTeacherId, setFormTeacherId] = useState("");
  const [formStudentId, setFormStudentId] = useState("");
  const [formInstrumentId, setFormInstrumentId] = useState("");
  const [formRoomId, setFormRoomId] = useState("");
  const [formDate, setFormDate] = useState("");
  const [formStartTime, setFormStartTime] = useState("09:00");
  const [formEndTime, setFormEndTime] = useState("10:00");
  const [formStatus, setFormStatus] = useState<ScheduleStatus>("confirmed");
  const [formNotes, setFormNotes] = useState("");
  const [formIsRecurring, setFormIsRecurring] = useState(false);
  const [formRecurrenceEndDate, setFormRecurrenceEndDate] = useState("");
  const [formRecurrenceWeekdays, setFormRecurrenceWeekdays] = useState<
    number[]
  >([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [formSubmitting, setFormSubmitting] = useState(false);

  // Request Schedule Change Modal State (Teacher & Admin)
  const [requestModalOpen, setRequestModalOpen] = useState(false);
  const [reqDate, setReqDate] = useState("");
  const [reqStartTime, setReqStartTime] = useState("10:00");
  const [reqEndTime, setReqEndTime] = useState("11:00");
  const [reqReason, setReqReason] = useState("");
  const [reqError, setReqError] = useState<string | null>(null);
  const [reqSubmitting, setReqSubmitting] = useState(false);

  // Cancel Confirmation State
  const [confirmCancelOpen, setConfirmCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [markingAttendance, setMarkingAttendance] = useState(false);

  // Toast feedback
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = useCallback((msg: string) => {
    setToastMessage(msg);
    setTimeout(() => {
      setToastMessage((prev) => (prev === msg ? null : prev));
    }, 4000);
  }, []);

  // Responsive viewport detection
  useEffect(() => {
    const checkViewport = () => {
      const mobile = window.innerWidth < 768;
      setIsMobile(mobile);
      const api = calendarRef.current?.getApi();
      if (api) {
        const targetView = mobile ? "timeGridDay" : "timeGridWeek";
        if (api.view.type !== targetView) {
          api.changeView(targetView);
        }
      }
    };
    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, []);

  const weekBounds = useMemo(
    () => getJakartaWeekBounds(anchorDate),
    [anchorDate]
  );

  const timeSlotOptions = useMemo(
    () => generateTimeSlots(startHour, endHour),
    [startHour, endHour]
  );

  // Fetch schedules for visible week range
  const fetchWeekSchedules = useCallback(
    async (includeMeta = false) => {
      try {
        const params = new URLSearchParams({
          start: weekBounds.startIso,
          end: weekBounds.endIso,
        });
        if (includeMeta || !metaLoaded) {
          params.set("include_meta", "true");
        }

        const res = await fetch(`/api/schedules?${params.toString()}`, {
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();

        setSchedules(data.schedules || []);
        setCachedApiData("/api/schedules:latest", data.schedules || []);
        if (data.meta) {
          setTeachers(data.meta.teachers || []);
          setStudents(data.meta.students || []);
          setInstruments(data.meta.instruments || []);
          setRooms(data.meta.rooms || []);
          setCachedApiData("/api/schedules:meta", data.meta);
          setMetaLoaded(true);
        }
      } finally {
        setLoading(false);
      }
    },
    [weekBounds.startIso, weekBounds.endIso, metaLoaded]
  );

  useEffect(() => {
    let active = true;
    (async () => {
      if (active) {
        await fetchWeekSchedules(!metaLoaded);
      }
    })();
    return () => {
      active = false;
    };
  }, [fetchWeekSchedules, metaLoaded]);

  // Realtime subscription
  useRealtimeSubscription(() => {
    fetchWeekSchedules(false);
  }, "weekly-calendar");

  // Filtered schedules
  const filteredSchedules = useMemo(() => {
    return schedules.filter((s) => {
      if (statusFilter === "active" && s.status === "cancelled") return false;
      if (statusFilter === "confirmed" && s.status !== "confirmed")
        return false;
      if (statusFilter === "pending" && s.status !== "pending") return false;
      if (teacherFilter !== "all" && s.teacher_id !== teacherFilter)
        return false;
      if (instrumentFilter !== "all" && s.instrument_id !== instrumentFilter)
        return false;
      if (roomFilter !== "all" && s.room_id !== roomFilter) return false;
      return true;
    });
  }, [
    schedules,
    statusFilter,
    teacherFilter,
    instrumentFilter,
    roomFilter,
  ]);

  // Convert schedules to FullCalendar events
  const calendarEvents: EventInput[] = useMemo(() => {
    return filteredSchedules.map((s) => ({
      id: s.id,
      title: `${s.instrument?.name || "Lesson"} — ${
        s.teacher?.profile?.full_name || "Teacher"
      }`,
      start: s.start_at,
      end: s.end_at,
      extendedProps: {
        schedule: s,
      },
    }));
  }, [filteredSchedules]);

  // Navigation handlers
  const syncCalendarDate = (newDateStr: string) => {
    setAnchorDate(newDateStr);
    const api = calendarRef.current?.getApi();
    if (api) {
      api.gotoDate(`${newDateStr}T12:00:00+07:00`);
    }
  };

  const handlePrev = () => {
    const step = isMobile ? -1 : -7;
    syncCalendarDate(addDaysToDateString(anchorDate, step));
  };

  const handleNext = () => {
    const step = isMobile ? 1 : 7;
    syncCalendarDate(addDaysToDateString(anchorDate, step));
  };

  const handleToday = () => {
    syncCalendarDate(toJakartaDateString(new Date()));
  };

  // Qualified instruments for the currently selected teacher in Create/Edit modal
  const qualifiedInstrumentsForTeacher = useMemo(() => {
    if (!formTeacherId) return instruments.filter((i) => i.is_active);
    const teacher = teachers.find((t) => t.id === formTeacherId);
    if (!teacher || !teacher.instruments || teacher.instruments.length === 0) {
      return [];
    }
    return teacher.instruments.filter((i) => i.is_active);
  }, [formTeacherId, teachers, instruments]);

  // Open Create Schedule Modal
  const openCreateModal = (prefillDate?: string, prefillStart?: string) => {
    const defaultTeacher =
      teachers.find((t) => t.is_active) || teachers[0] || null;
    const defaultInst =
      defaultTeacher?.instruments?.[0] ||
      instruments.find((i) => i.is_active) ||
      null;
    const defaultStudent = students.find((s) => s.is_active) || null;
    const defaultRoom = rooms.find((r) => r.is_active) || null;

    const targetDate = prefillDate || anchorDate;
    const startT = prefillStart || "09:00";

    // Calculate +1 hour default end time
    const [h, m] = startT.split(":").map(Number);
    const endH = Math.min(endHour, h + 1);
    const endT =
      endH > h
        ? `${String(endH).padStart(2, "0")}:${String(m).padStart(2, "0")}`
        : `${String(h).padStart(2, "0")}:30`;

    setEditingSchedule(null);
    setFormTeacherId(defaultTeacher?.id || "");
    setFormInstrumentId(defaultInst?.id || "");
    setFormStudentId(defaultStudent?.id || "");
    setFormRoomId(defaultRoom?.id || "");
    setFormDate(targetDate);
    setFormStartTime(startT);
    setFormEndTime(endT);
    setFormStatus("confirmed");
    setFormNotes("");
    setFormIsRecurring(false);
    setFormRecurrenceEndDate(addDaysToDateString(targetDate, 28));
    setFormRecurrenceWeekdays([getJakartaDayOfWeek(targetDate)]);
    setFormError(null);
    setScheduleModalOpen(true);
  };

  // Open Edit Schedule Modal
  const openEditModal = (sched: ScheduleWithDetails) => {
    setEditingSchedule(sched);
    setFormTeacherId(sched.teacher_id);
    setFormInstrumentId(sched.instrument_id);
    setFormStudentId(sched.student_id);
    setFormRoomId(sched.room_id);
    setFormDate(toJakartaDateString(sched.start_at));
    setFormStartTime(toJakartaTimeString(sched.start_at));
    setFormEndTime(toJakartaTimeString(sched.end_at));
    setFormStatus(sched.status);
    setFormNotes(sched.notes || "");
    setFormIsRecurring(false);
    setFormError(null);
    setScheduleModalOpen(true);
  };

  // Handle clicking an empty slot on the calendar
  const handleDateClick = (arg: DateClickInfo) => {
    const clickedDate = toJakartaDateString(arg.date);
    const clickedTime = toJakartaTimeString(arg.date);
    if (isAdmin) {
      openCreateModal(clickedDate, clickedTime);
    } else {
      showToast(
        `Slot ${formatJakartaDate(arg.date)} at ${clickedTime} WIB is available. Click one of your lessons to request a schedule change.`
      );
    }
  };

  // Handle clicking an event card
  const handleEventClick = (arg: EventClickInfo) => {
    const sched = arg.event.extendedProps.schedule as ScheduleWithDetails;
    if (sched) {
      setSelectedScheduleId(sched.id);
    }
  };

  // Submit Create or Edit Schedule Form
  const handleScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    setFormSubmitting(true);

    const effectiveEndTime =
      formEndTime > formStartTime
        ? formEndTime
        : timeSlotOptions.find((t) => t > formStartTime) || formEndTime;

    try {
      if (editingSchedule) {
        const res = await fetch(`/api/schedules/${editingSchedule.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teacher_id: formTeacherId,
            student_id: formStudentId,
            instrument_id: formInstrumentId,
            room_id: formRoomId,
            date: formDate,
            start_time: formStartTime,
            end_time: effectiveEndTime,
            status: formStatus,
            notes: formNotes.trim() || null,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setFormError(json.error || "Failed to update schedule");
          return;
        }
        setScheduleModalOpen(false);
        setSelectedScheduleId(json.schedule?.id ?? null);
        showToast("Schedule updated and synchronized.");
      } else {
        const res = await fetch("/api/schedules", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            teacher_id: formTeacherId,
            student_id: formStudentId,
            instrument_id: formInstrumentId,
            room_id: formRoomId,
            date: formDate,
            start_time: formStartTime,
            end_time: effectiveEndTime,
            status: formStatus,
            notes: formNotes.trim() || null,
            is_recurring: formIsRecurring,
            recurrence_end_date: formIsRecurring
              ? formRecurrenceEndDate
              : null,
            recurrence_weekdays: formIsRecurring
              ? formRecurrenceWeekdays
              : undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          setFormError(json.error || "Failed to create schedule");
          return;
        }
        setScheduleModalOpen(false);
        showToast(
          json.count > 1
            ? `Created ${json.count} recurring weekly lessons.`
            : "Lesson schedule created."
        );
      }

      await fetchWeekSchedules(false);
      await refreshNotifications();
      await broadcastRealtimeSync("schedule_changed");
    } finally {
      setFormSubmitting(false);
    }
  };

  // Confirm a Pending Schedule (Admin)
  const handleQuickConfirmSchedule = async (sched: ScheduleWithDetails) => {
    try {
      const res = await fetch(`/api/schedules/${sched.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "confirmed" }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Could not confirm schedule");
        return;
      }
      setSelectedScheduleId(json.schedule?.id ?? sched.id);
      showToast("Schedule confirmed.");
      await fetchWeekSchedules(false);
      await broadcastRealtimeSync("schedule_changed");
    } catch {
      showToast("Failed to confirm schedule");
    }
  };

  // Mark Student Attendance (Present / Absent) on a Schedule
  const handleMarkAttendance = async (
    sched: ScheduleWithDetails,
    clickedStatus: "present" | "absent"
  ) => {
    if (markingAttendance) return;
    const nextAttendance: AttendanceStatus =
      sched.attendance_status === clickedStatus ? null : clickedStatus;

    setMarkingAttendance(true);
    // Optimistically update local state for instant visual feedback
    setSchedules((prev) =>
      prev.map((item) =>
        item.id === sched.id
          ? { ...item, attendance_status: nextAttendance }
          : item
      )
    );

    try {
      const res = await fetch(`/api/schedules/${sched.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ attendance_status: nextAttendance }),
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Failed to update attendance");
        await fetchWeekSchedules(false);
        return;
      }

      if (json.schedule) {
        setSchedules((prev) =>
          prev.map((item) =>
            item.id === sched.id ? (json.schedule as ScheduleWithDetails) : item
          )
        );
      }

      showToast(
        nextAttendance === "present"
          ? `Marked ${sched.student?.full_name || "student"} as Present (recorded in student report).`
          : nextAttendance === "absent"
          ? `Marked ${sched.student?.full_name || "student"} as Absent (recorded in student report).`
          : "Attendance status cleared."
      );
      await broadcastRealtimeSync("schedule_changed");
    } catch {
      showToast("Failed to save attendance");
      await fetchWeekSchedules(false);
    } finally {
      setMarkingAttendance(false);
    }
  };

  // Cancel Schedule (Admin)
  const handleConfirmCancelSchedule = async () => {
    if (!selectedSchedule) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/schedules/${selectedSchedule.id}`, {
        method: "DELETE",
      });
      const json = await res.json();
      if (!res.ok) {
        showToast(json.error || "Failed to cancel schedule");
        return;
      }
      setConfirmCancelOpen(false);
      setSelectedScheduleId(null);
      showToast("Schedule cancelled.");
      await fetchWeekSchedules(false);
      await refreshNotifications();
      await broadcastRealtimeSync("schedule_changed");
    } finally {
      setCancelling(false);
    }
  };

  // Open Request Schedule Change Modal
  const openRequestChangeModal = (sched: ScheduleWithDetails) => {
    setReqDate(toJakartaDateString(sched.start_at));
    setReqStartTime(toJakartaTimeString(sched.start_at));
    setReqEndTime(toJakartaTimeString(sched.end_at));
    setReqReason("");
    setReqError(null);
    setRequestModalOpen(true);
  };

  // Submit Schedule Change Request
  const handleRequestSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSchedule) return;
    setReqError(null);
    setReqSubmitting(true);

    const effectiveReqEndTime =
      reqEndTime > reqStartTime
        ? reqEndTime
        : timeSlotOptions.find((t) => t > reqStartTime) || reqEndTime;

    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          schedule_id: selectedSchedule.id,
          proposed_date: reqDate,
          proposed_start_time: reqStartTime,
          proposed_end_time: effectiveReqEndTime,
          reason: reqReason.trim(),
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        setReqError(json.error || "Failed to submit schedule change request");
        return;
      }
      setRequestModalOpen(false);
      setSelectedScheduleId(null);
      showToast(
        "Schedule change request submitted! Administrators have been notified."
      );
      await refreshNotifications();
      await broadcastRealtimeSync("request_changed");
    } finally {
      setReqSubmitting(false);
    }
  };

  // Custom Minimalist Pastel Event Card Renderer
  // Strictly displays ONLY Instrument Name + Teacher Name + subtle status indicator
  const renderEventContent = (eventInfo: EventDisplayInfo) => {
    const sched = eventInfo.event.extendedProps
      .schedule as ScheduleWithDetails | undefined;
    if (!sched) return null;

    const instrumentName = sched.instrument?.name || "Music";
    const teacherName = sched.teacher?.profile?.full_name || "Teacher";
    const status = sched.status;
    const isOwnSchedule = sched.teacher_id === profile.id;

    if (status === "cancelled") {
      return (
        <div className="h-full w-full rounded-lg border border-zinc-200 bg-zinc-100/90 px-2 py-1.5 flex flex-col justify-between text-zinc-400 line-through cursor-pointer select-none overflow-hidden">
          <div className="min-w-0">
            <div className="flex items-center justify-between gap-1">
              <span className="text-[11px] font-semibold tracking-tight truncate leading-tight">
                {instrumentName}
              </span>
              <span
                className="h-1.5 w-1.5 rounded-full shrink-0 bg-zinc-400"
                title="Status: cancelled"
              />
            </div>
            <p className="text-[11px] truncate leading-tight mt-0.5 text-zinc-400">
              {teacherName}
            </p>
          </div>
        </div>
      );
    }

    const theme = getTeacherPastelTheme(
      sched.teacher_id,
      sched.teacher?.profile?.avatar_url
    );

    return (
      <div
        style={{
          backgroundColor: theme.bg,
          borderColor: theme.border,
          borderLeftColor: theme.accent,
          borderLeftWidth: "3.5px",
          borderStyle: status === "pending" ? "dashed" : "solid",
          color: theme.text,
        }}
        className={`h-full w-full rounded-lg border px-2 py-1.5 flex flex-col justify-between transition-opacity hover:opacity-90 cursor-pointer select-none overflow-hidden ${
          isOwnSchedule ? "ring-1 ring-zinc-900/20 shadow-2xs" : ""
        }`}
      >
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-1">
            <span className="text-[11px] font-semibold tracking-tight truncate leading-tight">
              {instrumentName}
            </span>
            {sched.attendance_status === "present" ? (
              <span
                className="inline-flex items-center justify-center h-3.5 px-1 rounded bg-emerald-600 text-white text-[9px] font-bold shrink-0"
                title="Attendance: Present"
              >
                ✓
              </span>
            ) : sched.attendance_status === "absent" ? (
              <span
                className="inline-flex items-center justify-center h-3.5 px-1 rounded bg-red-600 text-white text-[9px] font-bold shrink-0"
                title="Attendance: Absent"
              >
                ✕
              </span>
            ) : (
              <span
                style={{
                  backgroundColor:
                    status === "pending" ? "#F59E0B" : theme.accent,
                }}
                className="h-1.5 w-1.5 rounded-full shrink-0"
                title={`Status: ${status}`}
              />
            )}
          </div>
          <p
            style={{ color: theme.subtext }}
            className="text-[11px] font-medium truncate leading-tight mt-0.5"
          >
            {teacherName}
          </p>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4 max-w-[1600px] mx-auto">
      {/* Toast Notification Banner */}
      {toastMessage && (
        <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2.5 rounded-xl bg-zinc-900 px-4 py-3 text-xs font-medium text-white shadow-lg border border-zinc-800">
          <CheckCircle2 className="h-4 w-4 text-emerald-400 shrink-0" />
          <span>{toastMessage}</span>
          <button
            type="button"
            onClick={() => setToastMessage(null)}
            className="ml-2 text-zinc-400 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Calendar Top Control Bar */}
      <div className="bg-white rounded-xl border border-zinc-200/80 p-4 space-y-3.5">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          {/* Left: Week Navigation & Date Range Header */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="inline-flex items-center rounded-lg border border-zinc-200 bg-white p-0.5">
              <button
                type="button"
                onClick={handlePrev}
                className="h-7 w-7 flex items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors cursor-pointer"
                aria-label="Previous week"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={handleToday}
                className="px-2.5 h-7 text-xs font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-900 rounded-md transition-colors cursor-pointer"
              >
                Today
              </button>
              <button
                type="button"
                onClick={handleNext}
                className="h-7 w-7 flex items-center justify-center rounded-md text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 transition-colors cursor-pointer"
                aria-label="Next week"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <h2 className="text-sm sm:text-base font-semibold tracking-tight text-zinc-900">
              {formatWeekRangeHeader(
                weekBounds.mondayDate,
                weekBounds.sundayDate
              )}
            </h2>

            {loading && (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-400 ml-1" />
            )}
          </div>

          {/* Right: Legend + Operating Hours Config + New Schedule Button */}
          <div className="flex flex-wrap items-center gap-2.5">
            <div className="hidden xl:flex items-center gap-3 text-[11px] text-zinc-500 mr-2">
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-sky-500" />
                Confirmed (Solid)
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full bg-amber-500" />
                Pending (Dashed)
              </span>
            </div>

            {/* Quick toggle for Teachers to filter their own schedule vs all */}
            {!isAdmin && (
              <button
                type="button"
                onClick={() =>
                  setTeacherFilter((prev) =>
                    prev === profile.id ? "all" : profile.id
                  )
                }
                className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors cursor-pointer ${
                  teacherFilter === profile.id
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
                }`}
              >
                <User className="h-3.5 w-3.5" />
                {teacherFilter === profile.id
                  ? "Showing My Lessons"
                  : "My Lessons Only"}
              </button>
            )}

            {/* Operating Hours Button */}
            <div className="relative">
              <button
                type="button"
                onClick={() => setShowHoursConfig((o) => !o)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 transition-colors cursor-pointer"
              >
                <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-400" />
                <span>
                  {String(startHour).padStart(2, "0")}:00–
                  {String(endHour).padStart(2, "0")}:00
                </span>
              </button>

              {showHoursConfig && (
                <div className="absolute right-0 mt-2 w-60 rounded-xl bg-white border border-zinc-200 shadow-lg p-3.5 z-30 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-900">
                      Operating Hours
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowHoursConfig(false)}
                      className="text-zinc-400 hover:text-zinc-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">
                        Open Hour
                      </label>
                      <select
                        value={startHour}
                        onChange={(e) =>
                          setStartHour(
                            Math.min(Number(e.target.value), endHour - 1)
                          )
                        }
                        className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
                      >
                        {[6, 7, 8, 9, 10].map((h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, "0")}:00
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-[11px] text-zinc-500 mb-1">
                        Close Hour
                      </label>
                      <select
                        value={endHour}
                        onChange={(e) =>
                          setEndHour(
                            Math.max(Number(e.target.value), startHour + 1)
                          )
                        }
                        className="w-full rounded-lg border border-zinc-200 px-2 py-1.5 text-xs"
                      >
                        {[17, 18, 19, 20, 21, 22].map((h) => (
                          <option key={h} value={h}>
                            {String(h).padStart(2, "0")}:00
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {isAdmin && (
              <button
                type="button"
                onClick={() => openCreateModal()}
                className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                New Schedule
              </button>
            )}
          </div>
        </div>

        {/* Filter Bar */}
        <div className="pt-3 border-t border-zinc-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
          <div className="flex items-center gap-2">
            <Filter className="h-3.5 w-3.5 text-zinc-400 shrink-0" />
            <select
              value={teacherFilter}
              onChange={(e) => setTeacherFilter(e.target.value)}
              aria-label="Filter by teacher"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50/60 px-2.5 py-1.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-hidden"
            >
              <option value="all">All Teachers</option>
              {teachers.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.profile?.full_name}
                  {t.id === profile.id ? " (Me)" : ""}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={instrumentFilter}
              onChange={(e) => setInstrumentFilter(e.target.value)}
              aria-label="Filter by instrument"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50/60 px-2.5 py-1.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-hidden"
            >
              <option value="all">All Instruments</option>
              {instruments.map((inst) => (
                <option key={inst.id} value={inst.id}>
                  {inst.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <select
              value={roomFilter}
              onChange={(e) => setRoomFilter(e.target.value)}
              aria-label="Filter by room"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50/60 px-2.5 py-1.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-hidden"
            >
              <option value="all">All Rooms</option>
              {rooms.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-2">
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter by status"
              className="w-full rounded-lg border border-zinc-200 bg-zinc-50/60 px-2.5 py-1.5 text-xs text-zinc-800 focus:bg-white focus:border-zinc-400 focus:outline-hidden"
            >
              <option value="active">Active (Confirmed & Pending)</option>
              <option value="confirmed">Confirmed Only</option>
              <option value="pending">Pending Only</option>
              <option value="all">All (Include Cancelled)</option>
            </select>

            {(teacherFilter !== "all" ||
              instrumentFilter !== "all" ||
              roomFilter !== "all" ||
              statusFilter !== "active") && (
              <button
                type="button"
                onClick={() => {
                  setTeacherFilter("all");
                  setInstrumentFilter("all");
                  setRoomFilter("all");
                  setStatusFilter("active");
                }}
                className="shrink-0 text-[11px] font-medium text-zinc-500 hover:text-zinc-900 underline cursor-pointer"
              >
                Reset
              </button>
            )}
          </div>
        </div>

        {/* Teacher Pastel Color Legend Bar */}
        {teachers.filter((t) => t.is_active).length > 0 && (
          <div className="pt-2.5 border-t border-zinc-100 flex flex-wrap items-center gap-1.5">
            <span className="text-[11px] font-medium text-zinc-400 mr-1">
              Teachers:
            </span>
            {teachers
              .filter((t) => t.is_active)
              .map((t) => {
                const tTheme = getTeacherPastelTheme(
                  t.id,
                  t.profile?.avatar_url
                );
                const selected = teacherFilter === t.id;
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      setTeacherFilter((prev) =>
                        prev === t.id ? "all" : t.id
                      )
                    }
                    style={{
                      backgroundColor: tTheme.bg,
                      borderColor: selected ? tTheme.accent : tTheme.border,
                      color: tTheme.text,
                    }}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium transition-all cursor-pointer ${
                      selected
                        ? "ring-2 ring-zinc-900/15 font-semibold"
                        : "hover:opacity-85"
                    }`}
                    title={`Filter calendar by ${t.profile?.full_name}`}
                  >
                    <span
                      style={{ backgroundColor: tTheme.accent }}
                      className="h-2 w-2 rounded-full shrink-0"
                    />
                    <span>{t.profile?.full_name}</span>
                  </button>
                );
              })}
          </div>
        )}

        {/* Mobile Day Pill Selector (visible on mobile screens so users can jump across Mon-Sun easily) */}
        <div className="flex md:hidden items-center justify-between gap-1 pt-2 border-t border-zinc-100 overflow-x-auto">
          {weekBounds.weekDays.map((wd) => {
            const isSelected = wd.dateStr === anchorDate;
            return (
              <button
                key={wd.dateStr}
                type="button"
                onClick={() => syncCalendarDate(wd.dateStr)}
                className={`flex-1 min-w-[44px] rounded-lg py-1.5 px-1 text-center transition-colors ${
                  isSelected
                    ? "bg-zinc-900 text-white"
                    : wd.isToday
                    ? "bg-blue-50 text-blue-700 font-semibold"
                    : "text-zinc-600 hover:bg-zinc-100"
                }`}
              >
                <span className="block text-[10px] uppercase">
                  {wd.shortDay}
                </span>
                <span className="block text-xs font-semibold mt-0.5">
                  {wd.dayNumber}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Weekly TimeGrid Calendar Surface */}
      <div className="bg-white rounded-xl border border-zinc-200/80 overflow-hidden shadow-2xs">
        <FullCalendar
          ref={calendarRef}
          plugins={[
            classicTheme,
            timeGridPlugin,
            dayGridPlugin,
            interactionPlugin,
          ]}
          initialView={isMobile ? "timeGridDay" : "timeGridWeek"}
          initialDate={`${anchorDate}T12:00:00+07:00`}
          firstDay={1} // Monday first column (Monday -> Sunday)
          headerToolbar={false}
          allDaySlot={false}
          slotDuration="00:30:00"
          slotHeaderInterval="00:30:00"
          slotMinHeight={44}
          slotMinTime={`${String(startHour).padStart(2, "0")}:00:00`}
          slotMaxTime={`${String(endHour).padStart(2, "0")}:00:00`}
          slotHeaderFormat={{
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          }}
          eventColor="transparent"
          eventContrastColor="#18181b"
          blockEventInnerClass="p-0 h-full w-full"
          columnEventClass="border-0 bg-transparent shadow-none p-0"
          dayHeaderContent={(args) => {
            const dStr = toJakartaDateString(args.date);
            const todayStr = toJakartaDateString(new Date());
            const isToday = dStr === todayStr;
            const weekdayName = new Intl.DateTimeFormat("en-US", {
              timeZone: "Asia/Jakarta",
              weekday: "short",
            }).format(args.date);
            const dayNum = new Intl.DateTimeFormat("en-US", {
              timeZone: "Asia/Jakarta",
              day: "numeric",
            }).format(args.date);

            return (
              <div className="flex items-center justify-center gap-1.5 py-0.5">
                <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
                  {weekdayName}
                </span>
                <span
                  className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold ${
                    isToday
                      ? "bg-blue-600 text-white"
                      : "text-zinc-900"
                  }`}
                >
                  {dayNum}
                </span>
              </div>
            );
          }}
          events={calendarEvents}
          eventContent={renderEventContent}
          eventClick={handleEventClick}
          dateClick={handleDateClick}
          nowIndicator={true}
          height="auto"
          expandRows={true}
          tableHeaderSticky={true}
          eventOverlap={true}
          slotEventOverlap={false}
        />
      </div>

      {/* =========================================================
          1. SCHEDULE DETAIL POPUP / MODAL
          ========================================================= */}
      {selectedSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="px-5 py-4 border-b border-zinc-100 flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${
                      selectedSchedule.status === "confirmed"
                        ? "bg-emerald-50 text-emerald-700"
                        : selectedSchedule.status === "pending"
                        ? "bg-amber-50 text-amber-700"
                        : "bg-zinc-100 text-zinc-600"
                    }`}
                  >
                    {selectedSchedule.status}
                  </span>
                  {selectedSchedule.series_id && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-zinc-100 px-2 py-0.5 text-[10px] font-medium text-zinc-600">
                      <Repeat className="h-3 w-3" />
                      Weekly Series
                    </span>
                  )}
                  {selectedSchedule.attendance_status === "present" && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-emerald-800">
                      <CheckCircle2 className="h-3 w-3" />
                      Present
                    </span>
                  )}
                  {selectedSchedule.attendance_status === "absent" && (
                    <span className="inline-flex items-center gap-1 rounded-md bg-red-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-red-700">
                      <XCircle className="h-3 w-3" />
                      Absent
                    </span>
                  )}
                </div>
                <h3 className="mt-1.5 text-base font-semibold text-zinc-900">
                  {selectedSchedule.instrument?.name || "Music Lesson"}
                </h3>
              </div>

              <button
                type="button"
                onClick={() => setSelectedScheduleId(null)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Modal Body — Complete Lesson Details */}
            <div className="p-5 space-y-3.5 text-xs">
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-xl bg-zinc-50/80 border border-zinc-100 p-3">
                  <div className="flex items-center gap-1.5 text-zinc-400 mb-1">
                    <Music className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">Instrument</span>
                  </div>
                  <p className="font-semibold text-zinc-900">
                    {selectedSchedule.instrument?.name}
                  </p>
                </div>

                <div className="rounded-xl bg-zinc-50/80 border border-zinc-100 p-3">
                  <div className="flex items-center gap-1.5 text-zinc-400 mb-1">
                    <MapPin className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">Room</span>
                  </div>
                  <p className="font-semibold text-zinc-900">
                    {selectedSchedule.room?.name}
                  </p>
                </div>

                {(() => {
                  const popupTheme = getTeacherPastelTheme(
                    selectedSchedule.teacher_id,
                    selectedSchedule.teacher?.profile?.avatar_url
                  );
                  return (
                    <div
                      style={{
                        backgroundColor: popupTheme.bg,
                        borderColor: popupTheme.border,
                      }}
                      className="rounded-xl border p-3"
                    >
                      <div
                        style={{ color: popupTheme.subtext }}
                        className="flex items-center gap-1.5 mb-1"
                      >
                        <User className="h-3.5 w-3.5" />
                        <span className="text-[11px] font-medium">Teacher</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span
                          style={{ backgroundColor: popupTheme.accent }}
                          className="h-2 w-2 rounded-full shrink-0"
                        />
                        <p
                          style={{ color: popupTheme.text }}
                          className="font-semibold truncate"
                        >
                          {selectedSchedule.teacher?.profile?.full_name}
                        </p>
                      </div>
                    </div>
                  );
                })()}

                <div className="rounded-xl bg-zinc-50/80 border border-zinc-100 p-3">
                  <div className="flex items-center gap-1.5 text-zinc-400 mb-1">
                    <GraduationCap className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">Student</span>
                  </div>
                  <p className="font-semibold text-zinc-900">
                    {selectedSchedule.student?.full_name}
                  </p>
                </div>
              </div>

              <div className="rounded-xl bg-zinc-50/80 border border-zinc-100 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-zinc-500">
                    <CalendarIcon className="h-3.5 w-3.5 text-zinc-400" />
                    Date
                  </span>
                  <span className="font-medium text-zinc-900">
                    {formatJakartaDate(selectedSchedule.start_at)}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="inline-flex items-center gap-1.5 text-zinc-500">
                    <Clock className="h-3.5 w-3.5 text-zinc-400" />
                    Time (WIB)
                  </span>
                  <span className="font-medium text-zinc-900">
                    {formatJakartaTimeRange(
                      selectedSchedule.start_at,
                      selectedSchedule.end_at
                    )}
                  </span>
                </div>

                <div className="flex items-center justify-between">
                  <span className="text-zinc-500">Duration</span>
                  <span className="font-medium text-zinc-900">
                    {getDurationMinutes(
                      selectedSchedule.start_at,
                      selectedSchedule.end_at
                    )}{" "}
                    minutes
                  </span>
                </div>
              </div>

              {/* Lesson Attendance Box (Present / Absent) */}
              {selectedSchedule.status !== "cancelled" && (
                <div className="rounded-xl border border-zinc-200 bg-white p-3.5 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs font-semibold text-zinc-900">
                        Student Attendance
                      </p>
                      <p className="text-[11px] text-zinc-500">
                        Automatically recorded in{" "}
                        <span className="font-medium text-zinc-700">
                          {selectedSchedule.student?.full_name}
                        </span>
                        &apos;s monthly report
                      </p>
                    </div>
                    {selectedSchedule.attendance_status ? (
                      <span
                        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-semibold uppercase ${
                          selectedSchedule.attendance_status === "present"
                            ? "bg-emerald-50 text-emerald-700"
                            : "bg-red-50 text-red-700"
                        }`}
                      >
                        {selectedSchedule.attendance_status === "present"
                          ? "Present"
                          : "Absent"}
                      </span>
                    ) : (
                      <span className="text-[10px] font-medium text-zinc-400">
                        Not marked yet
                      </span>
                    )}
                  </div>

                  {isAdmin || selectedSchedule.teacher_id === profile.id ? (
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        disabled={markingAttendance}
                        onClick={() =>
                          handleMarkAttendance(selectedSchedule, "present")
                        }
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 ${
                          selectedSchedule.attendance_status === "present"
                            ? "bg-emerald-600 text-white shadow-xs ring-2 ring-emerald-600/20"
                            : "border border-emerald-200 bg-emerald-50/50 text-emerald-700 hover:bg-emerald-100/70"
                        }`}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        Present (Hadir)
                      </button>

                      <button
                        type="button"
                        disabled={markingAttendance}
                        onClick={() =>
                          handleMarkAttendance(selectedSchedule, "absent")
                        }
                        className={`inline-flex items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold transition-all cursor-pointer disabled:opacity-50 ${
                          selectedSchedule.attendance_status === "absent"
                            ? "bg-red-600 text-white shadow-xs ring-2 ring-red-600/20"
                            : "border border-red-200 bg-red-50/50 text-red-700 hover:bg-red-100/70"
                        }`}
                      >
                        <XCircle className="h-4 w-4" />
                        Absent (Tidak Hadir)
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-zinc-400">
                      Only administrators or the assigned teacher can mark
                      attendance.
                    </p>
                  )}
                </div>
              )}

              {selectedSchedule.notes && (
                <div className="rounded-xl bg-zinc-50/80 border border-zinc-100 p-3.5">
                  <div className="flex items-center gap-1.5 text-zinc-400 mb-1">
                    <FileText className="h-3.5 w-3.5" />
                    <span className="text-[11px] font-medium">Lesson Notes</span>
                  </div>
                  <p className="text-zinc-700 leading-relaxed">
                    {selectedSchedule.notes}
                  </p>
                </div>
              )}
            </div>

            {/* Modal Footer — Role-Gated Actions */}
            <div className="px-5 py-3.5 bg-zinc-50 border-t border-zinc-100 flex flex-wrap items-center justify-between gap-2">
              {isAdmin ? (
                <>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => openEditModal(selectedSchedule)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                      Edit
                    </button>

                    {selectedSchedule.status === "pending" && (
                      <button
                        type="button"
                        onClick={() =>
                          handleQuickConfirmSchedule(selectedSchedule)
                        }
                        className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 cursor-pointer"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Confirm
                      </button>
                    )}

                    {selectedSchedule.status !== "cancelled" && (
                      <button
                        type="button"
                        onClick={() => openRequestChangeModal(selectedSchedule)}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                      >
                        <GitPullRequest className="h-3.5 w-3.5" />
                        Request Change
                      </button>
                    )}
                  </div>

                  {selectedSchedule.status !== "cancelled" && (
                    <button
                      type="button"
                      onClick={() => setConfirmCancelOpen(true)}
                      className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-red-50/60 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-100/70 cursor-pointer"
                    >
                      <Ban className="h-3.5 w-3.5" />
                      Cancel
                    </button>
                  )}
                </>
              ) : (
                <div className="w-full flex items-center justify-between gap-2">
                  {selectedSchedule.teacher_id === profile.id &&
                  selectedSchedule.status !== "cancelled" ? (
                    <button
                      type="button"
                      onClick={() => openRequestChangeModal(selectedSchedule)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-3.5 py-2 text-xs font-medium text-white hover:bg-zinc-800 cursor-pointer"
                    >
                      <GitPullRequest className="h-3.5 w-3.5" />
                      Request Schedule Change
                    </button>
                  ) : (
                    <span className="text-[11px] text-zinc-400">
                      Read-only view (assigned to{" "}
                      {selectedSchedule.teacher?.profile?.full_name})
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => setSelectedScheduleId(null)}
                    className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-100 cursor-pointer"
                  >
                    Close
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================
          2. CREATE / EDIT SCHEDULE MODAL (ADMIN)
          ========================================================= */}
      {scheduleModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-lg overflow-hidden my-8">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  {editingSchedule ? "Edit Lesson Schedule" : "Create New Schedule"}
                </h3>
                <p className="text-xs text-zinc-500">
                  {editingSchedule
                    ? "Modifying this occurrence will not alter other dates in a recurring series."
                    : "Schedule a single lesson or a weekly recurring lesson series."}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScheduleModalOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleScheduleSubmit} className="p-5 space-y-4">
              {formError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{formError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Teacher
                  </label>
                  <select
                    value={formTeacherId}
                    onChange={(e) => {
                      const newTid = e.target.value;
                      setFormTeacherId(newTid);
                      const tObj = teachers.find((t) => t.id === newTid);
                      if (
                        tObj?.instruments &&
                        tObj.instruments.length > 0 &&
                        !tObj.instruments.some((i) => i.id === formInstrumentId)
                      ) {
                        setFormInstrumentId(tObj.instruments[0].id);
                      }
                    }}
                    required
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  >
                    <option value="">Select teacher...</option>
                    {teachers
                      .filter((t) => t.is_active)
                      .map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.profile?.full_name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Instrument (Qualified)
                  </label>
                  <select
                    value={formInstrumentId}
                    onChange={(e) => setFormInstrumentId(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  >
                    {qualifiedInstrumentsForTeacher.length === 0 ? (
                      <option value="">No instruments assigned</option>
                    ) : (
                      qualifiedInstrumentsForTeacher.map((inst) => (
                        <option key={inst.id} value={inst.id}>
                          {inst.name}
                        </option>
                      ))
                    )}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Student
                  </label>
                  <select
                    value={formStudentId}
                    onChange={(e) => setFormStudentId(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  >
                    <option value="">Select student...</option>
                    {students
                      .filter((s) => s.is_active)
                      .map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.full_name}
                        </option>
                      ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Practice Room
                  </label>
                  <select
                    value={formRoomId}
                    onChange={(e) => setFormRoomId(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  >
                    <option value="">Select room...</option>
                    {rooms
                      .filter((r) => r.is_active)
                      .map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Date
                  </label>
                  <input
                    type="date"
                    value={formDate}
                    onChange={(e) => setFormDate(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Start Time (WIB)
                  </label>
                  <select
                    value={formStartTime}
                    onChange={(e) => {
                      const nextStart = e.target.value;
                      setFormStartTime(nextStart);
                      if (formEndTime <= nextStart) {
                        const nextValidEnd = timeSlotOptions.find(
                          (t) => t > nextStart
                        );
                        if (nextValidEnd) {
                          setFormEndTime(nextValidEnd);
                        }
                      }
                    }}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  >
                    {timeSlotOptions.slice(0, -1).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    End Time (WIB)
                  </label>
                  <select
                    value={
                      formEndTime > formStartTime
                        ? formEndTime
                        : timeSlotOptions.find((t) => t > formStartTime) ||
                          formEndTime
                    }
                    onChange={(e) => setFormEndTime(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  >
                    {timeSlotOptions
                      .filter((t) => t > formStartTime)
                      .map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Schedule Status
                  </label>
                  <select
                    value={formStatus}
                    onChange={(e) =>
                      setFormStatus(e.target.value as ScheduleStatus)
                    }
                    className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                  >
                    <option value="confirmed">
                      Confirmed (locks room & teacher slot)
                    </option>
                    <option value="pending">Pending</option>
                    {editingSchedule && (
                      <option value="cancelled">Cancelled</option>
                    )}
                  </select>
                </div>

                {!editingSchedule && (
                  <div className="flex items-end pb-1">
                    <label className="inline-flex items-center gap-2 text-xs font-medium text-zinc-800 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={formIsRecurring}
                        onChange={(e) => setFormIsRecurring(e.target.checked)}
                        className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-900"
                      />
                      <span>Repeat weekly (Recurring Series)</span>
                    </label>
                  </div>
                )}
              </div>

              {/* Recurring Weekly Configuration */}
              {!editingSchedule && formIsRecurring && (
                <div className="rounded-xl bg-zinc-50 border border-zinc-200/80 p-3.5 space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-zinc-900">
                      Weekly Recurrence Pattern
                    </span>
                    <span className="text-[11px] text-zinc-500">
                      Creates individual editable occurrences
                    </span>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 mb-1.5">
                      Weekdays
                    </label>
                    <div className="flex flex-wrap gap-1.5">
                      {ORDERED_DAYS_MON_TO_SUN.map((dow) => {
                        const active = formRecurrenceWeekdays.includes(dow);
                        return (
                          <button
                            key={dow}
                            type="button"
                            onClick={() => {
                              setFormRecurrenceWeekdays((prev) =>
                                prev.includes(dow)
                                  ? prev.length > 1
                                    ? prev.filter((d) => d !== dow)
                                    : prev
                                  : [...prev, dow]
                              );
                            }}
                            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                              active
                                ? "bg-zinc-900 text-white"
                                : "bg-white border border-zinc-200 text-zinc-600 hover:bg-zinc-100"
                            }`}
                          >
                            {DAY_SHORT_LABELS[dow]}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div>
                    <label className="block text-[11px] font-medium text-zinc-600 mb-1">
                      Series End Date
                    </label>
                    <input
                      type="date"
                      value={formRecurrenceEndDate}
                      min={formDate}
                      onChange={(e) => setFormRecurrenceEndDate(e.target.value)}
                      required={formIsRecurring}
                      className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-900"
                    />
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Lesson Notes (Optional)
                </label>
                <textarea
                  rows={2}
                  value={formNotes}
                  onChange={(e) => setFormNotes(e.target.value)}
                  placeholder="Repertoire, technique goals, or special setup notes..."
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formSubmitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                >
                  {formSubmitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  {editingSchedule ? "Save Changes" : "Create Schedule"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================
          3. REQUEST SCHEDULE CHANGE MODAL (TEACHER / ADMIN)
          ========================================================= */}
      {requestModalOpen && selectedSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-md overflow-hidden">
            <div className="px-5 py-4 border-b border-zinc-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-zinc-900">
                  Request Schedule Change
                </h3>
                <p className="text-xs text-zinc-500">
                  Original schedule remains active until approved by Admin.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setRequestModalOpen(false)}
                className="h-7 w-7 rounded-lg flex items-center justify-center text-zinc-400 hover:text-zinc-700 hover:bg-zinc-100"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleRequestSubmit} className="p-5 space-y-4">
              <div className="rounded-xl bg-zinc-50 border border-zinc-100 p-3 text-xs space-y-1">
                <p className="font-semibold text-zinc-900">
                  Current: {selectedSchedule.instrument?.name} with{" "}
                  {selectedSchedule.student?.full_name}
                </p>
                <p className="text-zinc-500">
                  {formatJakartaDate(selectedSchedule.start_at)} ·{" "}
                  {formatJakartaTimeRange(
                    selectedSchedule.start_at,
                    selectedSchedule.end_at
                  )}{" "}
                  · {selectedSchedule.room?.name}
                </p>
              </div>

              {reqError && (
                <div className="flex items-start gap-2 rounded-xl bg-red-50 border border-red-200 p-3 text-xs text-red-700">
                  <AlertCircle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{reqError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Proposed Date
                  </label>
                  <input
                    type="date"
                    value={reqDate}
                    onChange={(e) => setReqDate(e.target.value)}
                    required
                    className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-xs text-zinc-900"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    Start Time
                  </label>
                  <select
                    value={reqStartTime}
                    onChange={(e) => {
                      const nextStart = e.target.value;
                      setReqStartTime(nextStart);
                      if (reqEndTime <= nextStart) {
                        const nextValidEnd = timeSlotOptions.find(
                          (t) => t > nextStart
                        );
                        if (nextValidEnd) {
                          setReqEndTime(nextValidEnd);
                        }
                      }
                    }}
                    className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-xs text-zinc-900"
                  >
                    {timeSlotOptions.slice(0, -1).map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-zinc-700 mb-1">
                    End Time
                  </label>
                  <select
                    value={
                      reqEndTime > reqStartTime
                        ? reqEndTime
                        : timeSlotOptions.find((t) => t > reqStartTime) ||
                          reqEndTime
                    }
                    onChange={(e) => setReqEndTime(e.target.value)}
                    className="w-full rounded-lg border border-zinc-200 px-2.5 py-2 text-xs text-zinc-900"
                  >
                    {timeSlotOptions
                      .filter((t) => t > reqStartTime)
                      .map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-zinc-700 mb-1">
                  Reason for Change
                </label>
                <textarea
                  rows={3}
                  required
                  value={reqReason}
                  onChange={(e) => setReqReason(e.target.value)}
                  placeholder="Explain why you need to move this lesson..."
                  className="w-full rounded-lg border border-zinc-200 px-3 py-2 text-xs text-zinc-900 focus:border-zinc-900 focus:outline-hidden"
                />
              </div>

              <div className="pt-2 flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setRequestModalOpen(false)}
                  className="rounded-lg border border-zinc-200 bg-white px-3.5 py-2 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
                >
                  Back
                </button>
                <button
                  type="submit"
                  disabled={reqSubmitting}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-zinc-900 px-4 py-2 text-xs font-medium text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                >
                  {reqSubmitting && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  )}
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* =========================================================
          4. DESTRUCTIVE ACTION CONFIRMATION DIALOG (CANCEL LESSON)
          ========================================================= */}
      {confirmCancelOpen && selectedSchedule && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-[1px] p-4">
          <div className="bg-white rounded-2xl border border-zinc-200 shadow-xl w-full max-w-sm p-5 space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-zinc-900">
                Cancel Scheduled Lesson?
              </h3>
              <p className="mt-1 text-xs text-zinc-500">
                Are you sure you want to cancel the{" "}
                <span className="font-medium text-zinc-800">
                  {selectedSchedule.instrument?.name}
                </span>{" "}
                lesson with{" "}
                <span className="font-medium text-zinc-800">
                  {selectedSchedule.student?.full_name}
                </span>{" "}
                on {formatJakartaDate(selectedSchedule.start_at)}? The assigned
                teacher will be notified immediately.
              </p>
            </div>
            <div className="flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmCancelOpen(false)}
                className="rounded-lg border border-zinc-200 bg-white px-3.5 py-1.5 text-xs font-medium text-zinc-700 hover:bg-zinc-50 cursor-pointer"
              >
                Keep Lesson
              </button>
              <button
                type="button"
                disabled={cancelling}
                onClick={handleConfirmCancelSchedule}
                className="inline-flex items-center gap-1.5 rounded-lg bg-red-600 px-3.5 py-1.5 text-xs font-medium text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
              >
                {cancelling && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                Yes, Cancel Lesson
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
