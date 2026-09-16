import { redirect } from "next/navigation";
import GlassCard from "@/components/GlassCard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import SignOutButton from "./SignOutButton";

export default async function AccountPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile } = await supabase
    .from("profiles")
    .select("is_premium, created_at")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl text-white">Account</h1>

      <GlassCard className="mt-8">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-white/50">Email</p>
            <p className="text-white">{user.email}</p>
          </div>
          <SignOutButton />
        </div>

        <div className="mt-6 border-t border-white/10 pt-6">
          <p className="text-sm text-white/50">Plan</p>
          <p className="mt-1 text-white">{profile?.is_premium ? "Premium" : "Free"}</p>
          {!profile?.is_premium && (
            <p className="mt-2 text-sm text-white/40">
              Billing isn&apos;t wired up yet — this account structure is ready for a
              subscription provider whenever NexFetch adds one.
            </p>
          )}
        </div>
      </GlassCard>
    </div>
  );
}
