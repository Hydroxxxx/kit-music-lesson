-- =========================================
-- CHURCH MUSIC SCHEDULING MANAGEMENT SYSTEM
-- Migration: 0001_schema_and_rls.sql
-- =========================================

-- 1. EXTENSIONS & ENUMS
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

do $$ begin
  create type public.user_role as enum ('admin', 'teacher');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.schedule_status as enum ('pending', 'confirmed', 'cancelled');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  create type public.request_status as enum ('pending', 'approved', 'rejected', 'cancelled');
exception
  when duplicate_object then null;
end $$;

-- 2. PROFILES (Connected to Supabase Auth)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null,
  email text,
  role public.user_role not null default 'teacher',
  avatar_url text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 3. TEACHERS
create table if not exists public.teachers (
  id uuid primary key references public.profiles(id) on delete cascade,
  phone text,
  bio text,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- 4. STUDENTS
create table if not exists public.students (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  notes text,
  is_active boolean not null default true,
  created_at timestamptz default now()
);

-- 5. INSTRUMENTS
create table if not exists public.instruments (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true
);

-- 6. TEACHER INSTRUMENTS (Many-to-many)
create table if not exists public.teacher_instruments (
  teacher_id uuid references public.teachers(id) on delete cascade,
  instrument_id uuid references public.instruments(id) on delete restrict,
  primary key (teacher_id, instrument_id)
);

-- 7. ROOMS
create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  description text,
  is_active boolean not null default true
);

-- 8. SCHEDULE SERIES (Recurring weekly lessons)
create table if not exists public.schedule_series (
  id uuid primary key default gen_random_uuid(),
  recurrence_type text not null default 'weekly'
    check (recurrence_type in ('weekly')),
  start_date date not null,
  end_date date,
  created_at timestamptz default now(),
  check (end_date is null or end_date >= start_date)
);

-- 9. SCHEDULES (Main scheduling table)
create table if not exists public.schedules (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete restrict,
  student_id uuid not null references public.students(id) on delete restrict,
  instrument_id uuid not null references public.instruments(id) on delete restrict,
  room_id uuid not null references public.rooms(id) on delete restrict,
  series_id uuid references public.schedule_series(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status public.schedule_status not null default 'pending',
  notes text,
  created_by uuid references public.profiles(id),
  updated_by uuid references public.profiles(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  check (end_at > start_at)
);

-- GiST Exclusion Constraints for Double Booking Prevention
do $$ begin
  alter table public.schedules
  add constraint no_teacher_double_booking
  exclude using gist (
    teacher_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status = 'confirmed');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table public.schedules
  add constraint no_student_double_booking
  exclude using gist (
    student_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status = 'confirmed');
exception
  when duplicate_object then null;
end $$;

do $$ begin
  alter table public.schedules
  add constraint no_room_double_booking
  exclude using gist (
    room_id with =,
    tstzrange(start_at, end_at, '[)') with &&
  )
  where (status = 'confirmed');
exception
  when duplicate_object then null;
end $$;

-- 10. TEACHER AVAILABILITY
create table if not exists public.teacher_availability (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references public.teachers(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  is_available boolean not null default true,
  valid_from date,
  valid_until date,
  check (end_time > start_time),
  check (
    valid_until is null
    or valid_from is null
    or valid_until >= valid_from
  )
);

-- 11. SCHEDULE REQUESTS
create table if not exists public.schedule_requests (
  id uuid primary key default gen_random_uuid(),
  schedule_id uuid not null references public.schedules(id) on delete restrict,
  requested_by uuid not null references public.profiles(id),
  proposed_start_at timestamptz not null,
  proposed_end_at timestamptz not null,
  reason text,
  status public.request_status not null default 'pending',
  reviewed_by uuid references public.profiles(id),
  reviewed_at timestamptz,
  created_at timestamptz default now(),
  check (proposed_end_at > proposed_start_at)
);

-- 12. NOTIFICATIONS
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  message text not null,
  is_read boolean not null default false,
  created_at timestamptz default now()
);

-- 13. AUDIT LOGS
create table if not exists public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  action text not null,
  table_name text not null,
  record_id uuid,
  old_data jsonb,
  new_data jsonb,
  created_at timestamptz default now()
);

-- 14. INDEXES
create index if not exists idx_schedules_start_at on public.schedules(start_at);
create index if not exists idx_schedules_teacher on public.schedules(teacher_id);
create index if not exists idx_schedules_student on public.schedules(student_id);
create index if not exists idx_schedules_status on public.schedules(status);
create index if not exists idx_requests_status on public.schedule_requests(status);
create index if not exists idx_notifications_user on public.notifications(user_id, created_at desc);

-- 15. UPDATED_AT TRIGGERS
create or replace function public.handle_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
before update on public.profiles
for each row execute function public.handle_updated_at();

drop trigger if exists set_schedules_updated_at on public.schedules;
create trigger set_schedules_updated_at
before update on public.schedules
for each row execute function public.handle_updated_at();

-- 16. ROW LEVEL SECURITY (RLS)
alter table public.profiles enable row level security;
alter table public.teachers enable row level security;
alter table public.students enable row level security;
alter table public.instruments enable row level security;
alter table public.teacher_instruments enable row level security;
alter table public.rooms enable row level security;
alter table public.schedule_series enable row level security;
alter table public.schedules enable row level security;
alter table public.teacher_availability enable row level security;
alter table public.schedule_requests enable row level security;
alter table public.notifications enable row level security;
alter table public.audit_logs enable row level security;

-- Helper function to check if current user is admin
create or replace function public.is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin'
  );
$$;

-- Profiles: authenticated users can read profiles; users can update their own name/avatar; admins can manage all
create policy "Authenticated users can read profiles"
  on public.profiles for select to authenticated using (true);

create policy "Users can update own profile non-role fields"
  on public.profiles for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Admins have full access to profiles"
  on public.profiles for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Teachers: authenticated users can view; admins manage; teachers can update own bio/phone
create policy "Authenticated users can view teachers"
  on public.teachers for select to authenticated using (true);

create policy "Teachers can update own teacher row"
  on public.teachers for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "Admins manage teachers"
  on public.teachers for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Instruments, Rooms, Teacher Instruments, Teacher Availability: readable by all authenticated
create policy "Authenticated users can view instruments"
  on public.instruments for select to authenticated using (true);

create policy "Admins manage instruments"
  on public.instruments for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Authenticated users can view rooms"
  on public.rooms for select to authenticated using (true);

create policy "Admins manage rooms"
  on public.rooms for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Authenticated users can view teacher_instruments"
  on public.teacher_instruments for select to authenticated using (true);

create policy "Admins manage teacher_instruments"
  on public.teacher_instruments for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Authenticated users can view teacher_availability"
  on public.teacher_availability for select to authenticated using (true);

create policy "Teachers can manage own availability"
  on public.teacher_availability for all to authenticated
  using (teacher_id = auth.uid() or public.is_admin())
  with check (teacher_id = auth.uid() or public.is_admin());

-- Students: readable by authenticated users; managed by admins
create policy "Authenticated users can view students"
  on public.students for select to authenticated using (true);

create policy "Admins manage students"
  on public.students for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Schedules & Schedule Series: readable by all authenticated users (shared weekly calendar)
create policy "Authenticated users can view schedules"
  on public.schedules for select to authenticated using (true);

create policy "Admins manage schedules"
  on public.schedules for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Authenticated users can view schedule_series"
  on public.schedule_series for select to authenticated using (true);

create policy "Admins manage schedule_series"
  on public.schedule_series for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Schedule Requests: teachers can view and create requests for their own schedules; admins can manage all
create policy "Authenticated users can view schedule_requests"
  on public.schedule_requests for select to authenticated
  using (requested_by = auth.uid() or public.is_admin());

create policy "Teachers can insert schedule_requests"
  on public.schedule_requests for insert to authenticated
  with check (requested_by = auth.uid());

create policy "Admins manage schedule_requests"
  on public.schedule_requests for all to authenticated
  using (public.is_admin())
  with check (public.is_admin());

-- Notifications: users can read and mark their own notifications as read
create policy "Users can view own notifications"
  on public.notifications for select to authenticated
  using (user_id = auth.uid());

create policy "Users can update own notifications"
  on public.notifications for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Audit logs: admins can view all audit logs
create policy "Admins can view audit_logs"
  on public.audit_logs for select to authenticated
  using (public.is_admin());

-- 17. REALTIME PUBLICATION
alter publication supabase_realtime add table public.schedules;
alter publication supabase_realtime add table public.schedule_requests;
alter publication supabase_realtime add table public.notifications;

