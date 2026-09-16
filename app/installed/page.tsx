"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import GlassCard from "@/components/GlassCard";

// Route: /installed?browser=chrome&v=4.0.0&utm_source=extension&...&dkey=<uuid>
// This is exactly the URL chrome.tabs.create()'d by the extension's
// onInstalled listener (see ur()/Rn(Fn.installed, {...}) in
// background/service_worker.js) — it's the very first page a new
// install lands on, and the `dkey` param is the freshly-generated
// device_key waiting to be claimed.
export default function InstalledPage() {
  const search = useSearchParams();
  const dkey = search.get("dkey");
  const browser = search.get("browser");

  const [state, setState] = useState<"checking" | "claimed" | "needs-auth" | "no-key" | "error">(
    "checking"
  );

  useEffect(() => {
    if (!dkey) {
      setState("no-key");
      return;
    }

    fetch("/api/device/claim", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_key: dkey })
    })
      .then(async (res) => {
        if (res.status === 401) {
          setState("needs-auth");
          return;
        }
        const json = await res.json();
        setState(json.success ? "claimed" : "error");
      })
      .catch(() => setState("error"));
  }, [dkey]);

  return (
    <div className="mx-auto max-w-2xl px-6 py-20 text-center">
      <h1 className="font-display text-3xl text-white sm:text-4xl">
        NexFetch is installed{browser ? ` on ${browser}` : ""}.
      </h1>

      <GlassCard className="mt-10 glow-border">
        {state === "checking" && <p className="text-white/60">Linking this browser to your account…</p>}

        {state === "claimed" && (
          <>
            <p className="text-white">This browser is linked to your account.</p>
            <p className="mt-2 text-sm text-white/50">
              Streams you save here will sync everywhere you&apos;re logged in.
            </p>
            <Link
              href="/dashboard"
              className="mt-6 inline-block rounded-full bg-nex-gradient px-6 py-2.5 text-sm font-medium text-white"
            >
              Go to dashboard
            </Link>
          </>
        )}

        {state === "needs-auth" && (
          <>
            <p className="text-white">Log in to link this browser to your account.</p>
            <p className="mt-2 text-sm text-white/50">
              Once you&apos;re signed in, this device is claimed automatically — no extra steps.
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <Link
                href={`/login?dkey=${encodeURIComponent(dkey ?? "")}`}
                className="rounded-full bg-nex-gradient px-6 py-2.5 text-sm font-medium text-white"
              >
                Log in
              </Link>
              <Link
                href={`/register?dkey=${encodeURIComponent(dkey ?? "")}`}
                className="rounded-full border border-white/15 px-6 py-2.5 text-sm text-white/85"
              >
                Create account
              </Link>
            </div>
          </>
        )}

        {state === "no-key" && (
          <p className="text-white/60">
            Welcome! Open the NexFetch toolbar icon on any tab with video to get started.
          </p>
        )}

        {state === "error" && (
          <p className="text-white/60">
            Something went wrong linking this device. You can also link it later from{" "}
            <Link href="/account/devices" className="text-blue-glow hover:underline">
              your account&apos;s device list
            </Link>
            .
          </p>
        )}
      </GlassCard>
    </div>
  );
}
