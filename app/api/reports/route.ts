import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// POST api/reports  { url?, reason, details?, device_key? }
// Contract: lets a user (logged in or not) flag a broken site/video.
// Not tied to auth — an anonymous device can still file a report —
// but we attach the user id when a session is present.
const bodySchema = z.object({
  url: z.string().url().optional(),
  reason: z.string().min(1).max(200),
  details: z.string().max(2000).optional(),
  device_key: z.string().uuid().optional()
});

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const { error } = await supabase.from("reports").insert({
    user_id: user?.id ?? null,
    device_key: parsed.data.device_key ?? null,
    url: parsed.data.url ?? null,
    reason: parsed.data.reason,
    details: parsed.data.details ?? null
  });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
