import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET api/user
// Contract (from NexFetch-Chrome background/service_worker.js):
//   fetch(`${BASE}api/user`, { credentials: "include" })
//   expects { success: true, data: { is_premium: boolean } } on 200,
//   and a 401 status when the browser has no valid session.
export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_premium, email")
    .eq("id", user.id)
    .single();

  return NextResponse.json({
    success: true,
    data: {
      id: user.id,
      email: profile?.email ?? user.email,
      is_premium: profile?.is_premium ?? false
    }
  });
}
