# GraceNote — Church Music Scheduling Management System

A full-stack, real-time web application designed for church music education ministries where multiple teachers instruct multiple students across various musical instruments and practice rooms.

---

## 1. Technology Stack

- **Framework**: Next.js 16.4.5 (App Router, Turbopack, React Compiler enabled)
- **Language**: TypeScript 5 (Strict mode)
- **UI & Styling**: React 19.3, Tailwind CSS v4, Lucide React Icons
- **Calendar Engine**: FullCalendar React v7 (`timeGridWeek`, `timeGridDay`, `interaction`, `classicTheme`)
- **Forms & Validation**: React Hook Form, Zod v4, `@hookform/resolvers`
- **Backend & Database**: Supabase PostgreSQL, Supabase Auth, Supabase Realtime, Row Level Security (RLS), GiST Exclusion Constraints (`btree_gist`)
- **Timezone**: `Asia/Jakarta` (`UTC+07:00` / WIB) stored as PostgreSQL `TIMESTAMPTZ`

---

## 2. Core Features

1. **Weekly Lesson Calendar (`/schedule`)**
   - 7-day Monday–Sunday TimeGrid calendar on desktop and responsive day switcher on mobile.
   - 30-minute time intervals with configurable operating hours (default `08:00–20:00`).
   - Minimalist schedule event cards showing only **Instrument Name** and **Teacher Name** with a subtle status indicator dot.
   - **Schedule Detail Modal** displaying full lesson details (Instrument, Teacher, Student, Room, Date, Start/End Time, Duration, Status, Series info, Notes) and role-gated actions.
   - Filtering by Teacher, Instrument, Room, and Status.
2. **Double Booking Prevention & Qualification Checks**
   - Prevents overlapping confirmed schedules for the same **Teacher**, **Student**, or **Room** at both the application layer and PostgreSQL database level (`no_teacher_double_booking`, `no_student_double_booking`, `no_room_double_booking` GiST exclusion constraints).
   - Validates that the assigned teacher is active and qualified to teach the selected instrument (`teacher_instruments`).
3. **Recurring Weekly Schedules**
   - Supports creating weekly recurring lesson series (`schedule_series`) with start date, end date, and selected weekdays.
   - Editing or cancelling a single occurrence modifies only that occurrence without unintentionally altering future occurrences.
4. **Schedule Change Requests (`/requests`)**
   - Teachers can request a new date/time for their scheduled lessons with conflict pre-validation and a reason.
   - Original schedules remain unchanged while a request is `pending`.
   - Administrators receive in-app notifications and can approve or reject requests with atomic conflict re-verification.
5. **Real-Time Synchronization & In-App Notifications (`/notifications`)**
   - Powered by Supabase Realtime (`postgres_changes` + `broadcast`), keeping calendars, dashboards, and notification badges synchronized live across connected browsers without manual page refresh.
6. **Role-Based Access Control (Admin & Teacher)**
   - Enforced via Next.js 16 `src/proxy.ts`, server-side session verification (`src/lib/auth.ts`), and Supabase Row Level Security (`supabase/migrations/0001_schema_and_rls.sql`).

---

## 3. Environment Setup

Create `.env` (or `.env.local`) in the project root:

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project-ref.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-publishable-or-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-or-secret-key
```

---

## 4. Pre-Seeded Test Accounts

The login screen (`/login`) includes quick-fill buttons for testing both roles:

| Role | Name | Email | Password |
| :--- | :--- | :--- | :--- |
| **ADMIN** | Pastor Daniel Hartono | `admin@churchmusic.org` | `Admin123!` |
| **TEACHER** | David Chen (Piano, Keyboard) | `david.chen@churchmusic.org` | `Teacher123!` |
| **TEACHER** | Sarah Wijaya (Vocal, Violin, Piano) | `sarah.wijaya@churchmusic.org` | `Teacher123!` |
| **TEACHER** | Michael Tan (Guitar, Bass, Drums) | `michael.tan@churchmusic.org` | `Teacher123!` |

---

## 5. Development & Build Commands

```bash
# Start development server
npm run dev

# Run TypeScript check
npx tsc --noEmit

# Run ESLint
npm run lint

# Build for production
npm run build
```
