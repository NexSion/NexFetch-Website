import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { limitFor, nextResetAt } from "@/lib/limits";

// POST api/streaming/check-limit  { device_key?: string }
//
// Login is now required — the anonymous/device-only free tier is
// retired, so this always resolves the caller from the session
// cookie, not device_key (device_key is still accepted for backward
// compatibility with older extension builds but no longer used to
// look up premium status).
//
// The limit enforced here is a 10GB/day *data* cap for free-plan
// accounts (not a stream count — that stays unlimited for everyone).
// Admins and Premium accounts are always unlimited.
const bodySchema = z.object({ device_key: z.string().uuid().optional() });

export async function POST(request: Request) {
  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json ?? {});
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { message: "INVALID_BODY" } }, { status: 400 });
  }

  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "LOGIN_REQUIRED", message: "Log in to stream or download." } },
      { status: 401 }
    );
  }

  const service = createSupabaseServiceClient();
  const { data: profile } = await service.from("profiles").select("is_premium, role").eq("id", user.id).maybeSingle();
  const unlimited = Boolean(profile?.is_premium) || profile?.role === "admin";

  const bytesLimit = limitFor("bytes", unlimited);

  if (bytesLimit === -1) {
    return NextResponse.json({
      success: true,
      data: { allowed: true, remaining: -1, limit: -1, reset_at: null, reason: null }
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: existing } = await service
    .from("streaming_usage")
    .select("bytes")
    .match({ user_id: user.id, kind: "stream", usage_date: today })
    .maybeSingle();

  const bytesUsed = existing?.bytes ?? 0;
  const allowed = bytesUsed < bytesLimit;

  return NextResponse.json({
    success: true,
    data: {
      allowed,
      remaining: Math.max(bytesLimit - bytesUsed, 0),
      limit: bytesLimit,
      reset_at: nextResetAt(),
      reason: allowed ? null : "daily_data_limit_reached"
    }
  });
}
