import { createSupabaseServerClient, createSupabaseServiceClient } from "@/lib/supabase/server";

// Returns the current user if they're logged in AND their profile has
// role='admin', otherwise null. Uses the service-role client for the
// profile read so it isn't dependent on an RLS policy existing for
// self-reads of `role` (profiles' own RLS only grants read of your
// own row anyway, but this keeps the admin check independent of RLS
// changes elsewhere).
export async function requireAdmin() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();
  if (!user) return null;

  const service = createSupabaseServiceClient();
  const { data: profile } = await service.from("profiles").select("role").eq("id", user.id).maybeSingle();
  if (profile?.role !== "admin") return null;

  return user;
}
