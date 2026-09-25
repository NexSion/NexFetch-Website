import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";
import { limitFor, nextResetAt } from "@/lib/limits";

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
      { success: false, error: { code: "LOGIN_REQUIRED", message: "Log in to cast." } },
      { status: 401 }
    );
  }

  const service = createSupabaseServiceClient();
  const { data: profile } = await service.from("profiles").select("is_premium, role").eq("id", user.id).maybeSingle();
  const unlimited = Boolean(profile?.is_premium) || profile?.role === "admin";

  const limit = limitFor("cast", unlimited);

  return NextResponse.json({
    success: true,
    data: { allowed: true, remaining: limit, limit, reset_at: nextResetAt(), reason: null, trial_enabled: false }
  });
}
