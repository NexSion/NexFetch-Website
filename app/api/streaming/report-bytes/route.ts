import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

// POST api/streaming/report-bytes  { bytes: number }
// Called by the stream page right after a download finishes building
// its Blob (client-side — the server never sees the video content
// itself, only the final size), so tomorrow's check-limit call knows
// how much of today's 10GB free-plan cap has been used.
const bodySchema = z.object({ bytes: z.number().positive() });

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: { code: "LOGIN_REQUIRED" } }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { message: "INVALID_BODY" } }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const today = new Date().toISOString().slice(0, 10);

  const { data: existing } = await service
    .from("streaming_usage")
    .select("id, bytes")
    .match({ user_id: user.id, kind: "stream", usage_date: today })
    .maybeSingle();

  if (existing) {
    await service
      .from("streaming_usage")
      .update({ bytes: (existing.bytes ?? 0) + parsed.data.bytes })
      .eq("id", existing.id);
  } else {
    await service.from("streaming_usage").insert({
      user_id: user.id,
      kind: "stream",
      usage_date: today,
      count: 0,
      bytes: parsed.data.bytes
    });
  }

  return NextResponse.json({ success: true });
}
