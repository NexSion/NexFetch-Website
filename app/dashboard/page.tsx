import { redirect } from "next/navigation";
import Link from "next/link";
import GlassCard from "@/components/GlassCard";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const [{ data: profile }, { count: savedCount }, { data: devices }] = await Promise.all([
    supabase.from("profiles").select("is_premium").eq("id", user.id).single(),
    supabase.from("saved_videos").select("id", { count: "exact", head: true }).eq("user_id", user.id),
    supabase.from("devices").select("device_key, browser, claimed_at").eq("user_id", user.id)
  ]);

  const today = new Date().toISOString().slice(0, 10);
  const { data: usage } = await supabase
    .from("streaming_usage")
    .select("kind, count")
    .eq("user_id", user.id)
    .eq("usage_date", today);

  const streamUsed = usage?.find((u) => u.kind === "stream")?.count ?? 0;
  const castUsed = usage?.find((u) => u.kind === "cast")?.count ?? 0;
  const isPremium = profile?.is_premium ?? false;

  return (
    <div className="mx-auto max-w-5xl px-6 py-16">
      <h1 className="font-display text-3xl text-white">Dashboard</h1>
      <p className="mt-2 text-white/50">Signed in as {user.email}</p>

      <div className="mt-10 grid gap-5 sm:grid-cols-3">
        <GlassCard>
          <p className="text-sm text-white/50">Plan</p>
          <p className="mt-2 font-display text-xl text-white">{isPremium ? "Premium" : "Free"}</p>
        </GlassCard>
        <GlassCard>
          <p className="text-sm text-white/50">Streams today</p>
          <p className="mt-2 font-display text-xl text-white">
            {isPremium ? "Unlimited" : `${streamUsed} / 10`}
          </p>
        </GlassCard>
        <GlassCard>
          <p className="text-sm text-white/50">Casts today</p>
          <p className="mt-2 font-display text-xl text-white">
            {isPremium ? "Unlimited" : `${castUsed} / 5`}
          </p>
        </GlassCard>
      </div>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <GlassCard>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Saved videos</h2>
            <Link href="/videos" className="text-sm text-blue-glow hover:underline">
              View all →
            </Link>
          </div>
          <p className="mt-3 text-3xl text-white">{savedCount ?? 0}</p>
          <p className="mt-1 text-sm text-white/50">synced across every linked device</p>
        </GlassCard>

        <GlassCard>
          <div className="flex items-center justify-between">
            <h2 className="font-display text-lg text-white">Linked devices</h2>
            <Link href="/account/devices" className="text-sm text-blue-glow hover:underline">
              Manage →
            </Link>
          </div>
          <p className="mt-3 text-3xl text-white">{devices?.length ?? 0}</p>
          <p className="mt-1 text-sm text-white/50">extension installs claimed to this account</p>
        </GlassCard>
      </div>
    </div>
  );
}
