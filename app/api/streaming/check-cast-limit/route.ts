import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { limitFor } from "@/lib/limits";

// POST api/streaming/check-cast-limit  { device_key?: string }
// Same shape and logic as check-limit, but tracks the "cast" quota
// separately (Chromecast sessions cost more bandwidth/CPU on our side
// than a plain stream, so they're metered on their own counter).
const bodySchema = z.object({ device_key: z.string().uuid().optional() });

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const json = await request.json().catch(() => ({}));
  const parsed = bodySchema.safeParse(json);
  const device_key = parsed.success ? parsed.data.device_key : undefined;

  if (!user && !device_key) {
    return NextResponse.json({ success: false, error: { message: "No identity provided" } }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  let isPremium = false;
  if (user) {
    const { data: profile } = await service
      .from("profiles")
      .select("is_premium")
      .eq("id", user.id)
      .single();
    isPremium = profile?.is_premium ?? false;
  }

  const limit = limitFor("cast", isPremium);
  if (limit === -1) {
    return NextResponse.json({
      success: true,
      data: { allowed: true, remaining: -1, limit: -1, reset_at: null, reason: null }
    });
  }

  const today = new Date().toISOString().slice(0, 10);
  const matchCol = user ? { user_id: user.id } : { device_key };

  const { data: existing } = await service
    .from("streaming_usage")
    .select("id, count")
    .match({ ...matchCol, kind: "cast", usage_date: today })
    .maybeSingle();

  const currentCount = existing?.count ?? 0;
  const allowed = currentCount < limit;

  if (allowed) {
    if (existing) {
      await service.from("streaming_usage").update({ count: currentCount + 1 }).eq("id", existing.id);
    } else {
      await service.from("streaming_usage").insert({
        ...matchCol,
        kind: "cast",
        usage_date: today,
        count: 1
      });
    }
  }

  const tomorrow = new Date();
  tomorrow.setUTCHours(24, 0, 0, 0);

  return NextResponse.json({
    success: true,
    data: {
      allowed,
      remaining: Math.max(limit - currentCount - (allowed ? 1 : 0), 0),
      limit,
      reset_at: tomorrow.toISOString(),
      reason: allowed ? null : "cast_limit_reached"
    }
  });
}
