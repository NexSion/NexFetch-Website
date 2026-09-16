"use client";

import { useSearchParams } from "next/navigation";
import GlassCard from "@/components/GlassCard";

// Route: /disabled?site=<hostname>&utm_content=unsupported_redirect
// Opened by the popup when NexFetch can't run on the current tab's site
// (see popup.js's qa() — an internal unsupported-sites list, not a
// user-configurable block list — that's settings:blockSite instead).
export default function DisabledPage() {
  const search = useSearchParams();
  const site = search.get("site");

  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <h1 className="font-display text-2xl text-white sm:text-3xl">
        NexFetch doesn&apos;t run on {site ?? "this site"}.
      </h1>
      <GlassCard className="mt-8 glow-border">
        <p className="text-white/60">
          Some sites use playback protections or page structures NexFetch can&apos;t safely detect
          streams on. This isn&apos;t a bug you can fix from settings — it&apos;s excluded on purpose.
        </p>
        <p className="mt-3 text-sm text-white/40">
          NexFetch still works normally on every other tab.
        </p>
      </GlassCard>
    </div>
  );
}
