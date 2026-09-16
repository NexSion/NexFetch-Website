"use client";

import { useState } from "react";
import GlassCard from "@/components/GlassCard";

export default function ContactPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    await fetch("/api/reports", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason: "contact_form", details: `${email}: ${message}` })
    }).catch(() => {});
    setLoading(false);
    setSent(true);
  }

  return (
    <div className="mx-auto max-w-lg px-6 py-20">
      <h1 className="font-display text-3xl text-white">Contact</h1>
      <p className="mt-2 text-white/50">Bug reports, feature requests, anything else.</p>

      <GlassCard className="mt-8 glow-border">
        {sent ? (
          <p className="text-white/70">Sent — we&apos;ll get back to you at {email}.</p>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-sm text-white/70">Your email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-blue-glow"
              />
            </div>
            <div>
              <label className="text-sm text-white/70">Message</label>
              <textarea
                required
                rows={5}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                className="mt-1 w-full rounded-lg border border-white/10 bg-black/30 px-3 py-2 text-white outline-none focus:border-blue-glow"
              />
            </div>
            <button
              type="submit"
              disabled={loading}
              className="self-start rounded-full bg-nex-gradient px-5 py-2.5 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Sending…" : "Send"}
            </button>
          </form>
        )}
      </GlassCard>
    </div>
  );
}
