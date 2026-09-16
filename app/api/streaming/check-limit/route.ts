import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { limitFor } from "@/lib/limits";

// POST api/streaming/check-limit  { device_key?: string }
// Contract: called before the website's /video/stream/[id] page starts
// playback, to enforce a daily per-account (or per-device, if signed
// out) stream limit. Response: { success, allowed, remaining, limit }.
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
    return NextResponse.json({ success: false, error: "NO_IDENTITY" }, { status: 400 });
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

  const limit = limitFor("stream", isPremium);
  if (limit === -1) {
    return NextResponse.json({ success: true, allowed: true, remaining: -1, limit: -1 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const matchCol = user ? { user_id: user.id } : { device_key };

  const { data: existing } = await service
    .from("streaming_usage")
    .select("id, count")
    .match({ ...matchCol, kind: "stream", usage_date: today })
    .maybeSingle();

  const currentCount = existing?.count ?? 0;
  const allowed = currentCount < limit;

  if (allowed) {
    if (existing) {
      await service.from("streaming_usage").update({ count: currentCount + 1 }).eq("id", existing.id);
    } else {
      await service.from("streaming_usage").insert({
        ...matchCol,
        kind: "stream",
        usage_date: today,
        count: 1
      });
    }
  }

  return NextResponse.json({
    success: true,
    allowed,
    remaining: Math.max(limit - currentCount - (allowed ? 1 : 0), 0),
    limit
  });
}
