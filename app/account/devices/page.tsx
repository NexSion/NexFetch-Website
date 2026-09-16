import { redirect } from "next/navigation";
import GlassCard from "@/components/GlassCard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import UnlinkDeviceButton from "./UnlinkDeviceButton";

export default async function DevicesPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: devices } = await supabase
    .from("devices")
    .select("device_key, browser, claimed_at, last_seen_at")
    .eq("user_id", user.id)
    .order("claimed_at", { ascending: false });

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="font-display text-3xl text-white">Linked devices</h1>
      <p className="mt-2 text-white/50">
        Every browser where you&apos;ve installed the NexFetch extension and logged in.
      </p>

      <div className="mt-8 flex flex-col gap-4">
        {!devices?.length && (
          <GlassCard>
            <p className="text-white/60">
              No devices linked yet. Install the extension and log in on this account —
              it claims itself automatically.
            </p>
          </GlassCard>
        )}

        {devices?.map((d) => (
          <GlassCard key={d.device_key} className="flex items-center justify-between">
            <div>
              <p className="text-white">{d.browser ?? "Unknown browser"}</p>
              <p className="mt-1 text-xs text-white/40">
                Claimed {new Date(d.claimed_at ?? d.last_seen_at).toLocaleDateString()}
              </p>
            </div>
            <UnlinkDeviceButton deviceKey={d.device_key} />
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
