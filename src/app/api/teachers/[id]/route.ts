import { NextResponse } from "next/server";
import { z } from "zod";
import {
  AuthError,
  invalidateProfileCache,
  logAuditEvent,
  requireAuth,
} from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  encodeTeacherColorAvatar,
  extractTeacherColorKey,
} from "@/lib/teacher-colors";

const availabilitySlotSchema = z.object({
  day_of_week: z.number().int().min(0).max(6),
  start_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  end_time: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  is_available: z.boolean().default(true),
  valid_from: z.string().nullable().optional(),
  valid_until: z.string().nullable().optional(),
});

const updateTeacherSchema = z.object({
  full_name: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().nullable().optional(),
  bio: z.string().nullable().optional(),
  color: z.string().optional(),
  is_active: z.boolean().optional(),
  instrument_ids: z.array(z.string().uuid()).optional(),
  availability: z.array(availabilitySlotSchema).optional(),
});

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await requireAuth();
    const { id } = await context.params;
    const isAdmin = actor.role === "admin";
    const isSelf = actor.id === id;

    if (!isAdmin && !isSelf) {
      return NextResponse.json(
        { error: "Forbidden. You can only modify your own teacher profile." },
        { status: 403 }
      );
    }

    const body = await request.json();
    const parsed = updateTeacherSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0]?.message || "Invalid input" },
        { status: 400 }
      );
    }

    const data = parsed.data;
    const admin = createAdminClient();

    // Update profile fields
    const validColorKey =
      data.color !== undefined ? extractTeacherColorKey(data.color) : null;
    if (
      data.full_name !== undefined ||
      (isAdmin && data.email !== undefined) ||
      validColorKey
    ) {
      const profileUpdate: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (data.full_name !== undefined) {
        profileUpdate.full_name = data.full_name.trim();
      }
      if (isAdmin && data.email !== undefined) {
        profileUpdate.email = data.email.trim().toLowerCase();
      }
      if (validColorKey) {
        profileUpdate.avatar_url = encodeTeacherColorAvatar(validColorKey);
      }

      const { error: profErr } = await admin
        .from("profiles")
        .update(profileUpdate)
        .eq("id", id);

      if (profErr) {
        return NextResponse.json({ error: profErr.message }, { status: 400 });
      }
    }

    // Update teacher fields
    const teacherUpdate: Record<string, unknown> = {};
    if (data.phone !== undefined) teacherUpdate.phone = data.phone;
    if (data.bio !== undefined) teacherUpdate.bio = data.bio;
    if (isAdmin && data.is_active !== undefined) {
      teacherUpdate.is_active = data.is_active;
    }

    if (Object.keys(teacherUpdate).length > 0) {
      const { error: tErr } = await admin
        .from("teachers")
        .update(teacherUpdate)
        .eq("id", id);

      if (tErr) {
        return NextResponse.json({ error: tErr.message }, { status: 400 });
      }
    }

    // Synchronize account activation state in Supabase Auth when toggled by Admin
    if (isAdmin && data.is_active !== undefined && id !== actor.id) {
      const { data: targetAuth } = await admin.auth.admin.getUserById(id);
      if (targetAuth?.user) {
        await admin.auth.admin.updateUserById(id, {
          ban_duration: data.is_active ? "none" : "876000h",
          user_metadata: {
            ...(targetAuth.user.user_metadata || {}),
            is_active: data.is_active,
          },
        });
      }
    }

    // Admin can update assigned instruments
    if (isAdmin && data.instrument_ids !== undefined) {
      await admin.from("teacher_instruments").delete().eq("teacher_id", id);
      if (data.instrument_ids.length > 0) {
        const rows = data.instrument_ids.map((instId) => ({
          teacher_id: id,
          instrument_id: instId,
        }));
        const { error: tiErr } = await admin
          .from("teacher_instruments")
          .insert(rows);
        if (tiErr) {
          return NextResponse.json({ error: tiErr.message }, { status: 400 });
        }
      }
    }

    // Update weekly availability (Admin or Teacher self)
    if (data.availability !== undefined) {
      for (const slot of data.availability) {
        if (slot.end_time <= slot.start_time) {
          return NextResponse.json(
            {
              error: `End time (${slot.end_time}) must be after start time (${slot.start_time}).`,
            },
            { status: 400 }
          );
        }
      }

      await admin.from("teacher_availability").delete().eq("teacher_id", id);
      if (data.availability.length > 0) {
        const availRows = data.availability.map((slot) => ({
          teacher_id: id,
          day_of_week: slot.day_of_week,
          start_time:
            slot.start_time.length === 5
              ? `${slot.start_time}:00`
              : slot.start_time,
          end_time:
            slot.end_time.length === 5 ? `${slot.end_time}:00` : slot.end_time,
          is_available: slot.is_available,
          valid_from: slot.valid_from ?? null,
          valid_until: slot.valid_until ?? null,
        }));
        const { error: avErr } = await admin
          .from("teacher_availability")
          .insert(availRows);
        if (avErr) {
          return NextResponse.json({ error: avErr.message }, { status: 400 });
        }
      }
    }

    await logAuditEvent({
      userId: actor.id,
      action: "UPDATE_TEACHER",
      tableName: "teachers",
      recordId: id,
      newData: data as Record<string, unknown>,
    });

    invalidateProfileCache(id);

    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "Failed to update teacher" },
      { status: 500 }
    );
  }
}

