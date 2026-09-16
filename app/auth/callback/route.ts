import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

// Handles Supabase's email-confirmation / magic-link redirect:
// ?code=...&dkey=... — code gets exchanged for a session cookie, and if
// a dkey tagged along (see app/register/page.tsx), it gets claimed
// immediately so the extension is linked the moment the account exists.
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const dkey = searchParams.get("dkey");

  if (code) {
    const supabase = createSupabaseServerClient();
    const { data } = await supabase.auth.exchangeCodeForSession(code);

    if (dkey && data.user) {
      const service = createSupabaseServiceClient();
      const { data: existing } = await service
        .from("devices")
        .select("user_id")
        .eq("device_key", dkey)
        .maybeSingle();

      if (!existing?.user_id || existing.user_id === data.user.id) {
        await service.from("devices").upsert(
          {
            device_key: dkey,
            user_id: data.user.id,
            claimed_at: new Date().toISOString(),
            last_seen_at: new Date().toISOString()
          },
          { onConflict: "device_key" }
        );
      }
    }
  }

  return NextResponse.redirect(`${origin}/dashboard`);
}
