import { NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase/server";

const bodySchema = z.object({ is_premium: z.boolean() });

export async function POST(request: Request, { params }: { params: { id: string } }) {
  const admin = await requireAdmin();
  if (!admin) {
    return NextResponse.json({ success: false, error: "FORBIDDEN" }, { status: 403 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const service = createSupabaseServiceClient();

  // Admins are always treated as Premium regardless of this flag (see
  // lib/admin.ts / check-limit's `unlimited` check) — refuse to touch
  // an admin row here so the button on that row (disabled client-side
  // anyway) can't be forced via a raw request either.
  const { data: target } = await service.from("profiles").select("role").eq("id", params.id).maybeSingle();
  if (target?.role === "admin") {
    return NextResponse.json({ success: false, error: "CANNOT_MODIFY_ADMIN" }, { status: 400 });
  }

  const { error } = await service.from("profiles").update({ is_premium: parsed.data.is_premium }).eq("id", params.id);
  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
