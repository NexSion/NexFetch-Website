import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

// POST api/reports  { type, url?, device_key?, metadata? }
//
// Contract confirmed from popup.js's Go()/Ho():
//   Q.post("api/reports", { type: "no_video_found", url, device_key,
//                            metadata: {...extra, browser} })
//   if (!i.success || !i.data) throw new Error(...)
//   return i.data
// So — like check-limit — this needs `data` in the response, and the
// body key is `type`, not `reason` (fixed in this pass; the website's
// own /contact and /uninstalled pages were sending `reason`, updated
// to match).
const bodySchema = z.object({
  type: z.string().min(1).max(100),
  url: z.string().url().optional(),
  device_key: z.string().uuid().optional(),
  metadata: z.record(z.unknown()).optional(),
  details: z.string().max(2000).optional()
});

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { message: "INVALID_BODY" } }, { status: 400 });
  }

  const service = createSupabaseServiceClient();
  const { data, error } = await service
    .from("reports")
    .insert({
      user_id: user?.id ?? null,
      device_key: parsed.data.device_key ?? null,
      url: parsed.data.url ?? null,
      type: parsed.data.type,
      metadata: parsed.data.metadata ?? {},
      details: parsed.data.details ?? null
    })
    .select("id")
    .single();

  if (error) {
    return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { id: data.id } });
}
