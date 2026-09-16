import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

// POST api/device/claim  { device_key: string }
// Contract: extension calls this once it detects the person is logged in
// on nexfetch.vercel.app, linking its locally-generated device_key (a
// crypto.randomUUID() stored under storage key "popup_device_key") to
// the authenticated account. Response: { success: boolean }.
//
// Auth is verified with the cookie-bound anon client (so we know exactly
// who is asking); the actual write goes through the service-role client
// because "claim a device_key that may not exist yet" needs an insert
// that regular per-user RLS deliberately doesn't grant (see schema.sql —
// devices has no client-facing insert policy on purpose).
const bodySchema = z.object({
  device_key: z.string().uuid()
});

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const { device_key } = parsed.data;
  const service = createSupabaseServiceClient();

  // Ownership check: a device_key already claimed by a *different*
  // account must not be silently reassigned.
  const { data: existing } = await service
    .from("devices")
    .select("user_id")
    .eq("device_key", device_key)
    .maybeSingle();

  if (existing?.user_id && existing.user_id !== user.id) {
    return NextResponse.json({ success: false, error: "DEVICE_ALREADY_CLAIMED" }, { status: 409 });
  }

  const { error } = await service.from("devices").upsert(
    {
      device_key,
      user_id: user.id,
      claimed_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString()
    },
    { onConflict: "device_key" }
  );

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
