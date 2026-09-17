"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import GlassCard from "@/components/GlassCard";

// Route: /uninstalled?dkey=<uuid>&utm_campaign=uninstall
// Set as the extension's chrome.runtime.setUninstallURL() target — the
// only chance to hear why someone left.
export default function UninstalledPage() {
  const search = useSearchParams();
  const dkey = search.get("dkey");
  const [reason, setReason] = useState("");
  const [sent, setSent] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason.trim()) return;
    await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "uninstall_feedback",
        details: reason,
        device_key: dkey ?? undefined
      })
    }).catch(() => {});
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <h1 className="font-display text-3xl text-white">Sorry to see you go.</h1>
      <p className="mt-3 text-white/50">One line on what didn&apos;t work would help a lot.</p>

      <GlassCard className="mt-8 glow-border text-left">
        {sent ? (
          <p className="text-center text-white/70">Thanks — noted.</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-3">
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={4}
              placeholder="What made you uninstall NexFetch?"
              className="w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-blue-glow"
            />
            <button
              type="submit"
              className="self-end rounded-full bg-nex-gradient px-5 py-2 text-sm font-medium text-white"
            >
              Send feedback
            </button>
          </form>
        )}
      </GlassCard>
    </div>
  );
}
