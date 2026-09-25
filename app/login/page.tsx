"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import GlassCard from "@/components/GlassCard";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginPage() {
  const search = useSearchParams();
  const dkey = search.get("dkey");
  const next = search.get("next");
  const supabase = createSupabaseBrowserClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleLogin() {
    setLoading(true);
    setError(null);

    const redirect = new URL(`${window.location.origin}/auth/callback`);
    if (dkey) redirect.searchParams.set("dkey", dkey);
    if (next) redirect.searchParams.set("next", next);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirect.toString() }
    });

    if (error) {
      setLoading(false);
      setError(error.message);
    }
    // On success the browser navigates away to Google — nothing else to do here.
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-6">
      <GlassCard className="w-full glow-border text-center">
        <h1 className="font-display text-2xl text-white">Log in to NexFetch</h1>
        <p className="mt-2 text-sm text-white/50">
          One click with Google — no password to manage. The extension uses this same session.
        </p>

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-full bg-white px-5 py-3 font-medium text-gray-900 shadow-lg transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
            <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.6 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.7-.4-3.5z" />
            <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.6 15.9 18.9 13 24 13c3.1 0 5.8 1.1 8 3l5.7-5.7C34.6 6 29.6 4 24 4 16.3 4 9.6 8.3 6.3 14.7z" />
            <path fill="#4CAF50" d="M24 44c5.5 0 10.4-1.9 14.3-5.1l-6.6-5.6C29.6 34.9 26.9 36 24 36c-5.3 0-9.7-3.4-11.3-8.1l-6.6 5.1C9.5 39.6 16.2 44 24 44z" />
            <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.3 5.7l6.6 5.6C41.6 36.1 44 30.5 44 24c0-1.3-.1-2.7-.4-3.5z" />
          </svg>
          {loading ? "Redirecting…" : "Continue with Google"}
        </button>

        <p className="mt-6 text-xs text-white/40">
          By continuing you agree to NexFetch&apos;s{" "}
          <a href="/terms-of-service" className="text-blue-glow hover:underline">
            Terms
          </a>{" "}
          and{" "}
          <a href="/privacy-policy" className="text-blue-glow hover:underline">
            Privacy Policy
          </a>
          .
        </p>
      </GlassCard>
    </div>
  );
}
