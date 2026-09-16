"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import GlassCard from "@/components/GlassCard";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function RegisterPage() {
  const search = useSearchParams();
  const dkey = search.get("dkey");
  const supabase = createSupabaseBrowserClient();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGoogleSignup() {
    setLoading(true);
    setError(null);

    // Same dkey hand-off as /login — /auth/callback claims it once the
    // OAuth session exists.
    const redirect = new URL(`${window.location.origin}/auth/callback`);
    if (dkey) redirect.searchParams.set("dkey", dkey);

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: redirect.toString() }
    });

    if (error) {
      setLoading(false);
      setError(error.message);
    }
  }

  return (
    <div className="mx-auto flex min-h-[70vh] max-w-md items-center px-6">
      <GlassCard className="w-full glow-border text-center">
        <h1 className="font-display text-2xl text-foreground">Create your NexFetch account</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Needed to sync saved videos and lift daily stream/cast limits.
        </p>

        <button
          type="button"
          onClick={handleGoogleSignup}
          disabled={loading}
          className="mt-6 flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-secondary px-5 py-2.5 font-medium text-foreground transition-colors hover:bg-accent disabled:opacity-50"
        >
          <GoogleIcon />
          {loading ? "Redirecting..." : "Continue with Google"}
        </button>

        {error && <p className="mt-4 text-sm text-destructive">{error}</p>}

        <p className="mt-4 text-xs text-muted-foreground">
          No separate password to set{dkey ? " — this browser links automatically" : ""}.
        </p>

        <p className="mt-6 text-center text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link
            href={dkey ? `/login?dkey=${encodeURIComponent(dkey)}` : "/login"}
            className="text-primary hover:underline"
          >
            Log in
          </Link>
        </p>
      </GlassCard>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.9c1.7-1.57 2.7-3.88 2.7-6.62z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.9-2.26c-.8.54-1.84.86-3.06.86-2.35 0-4.34-1.59-5.05-3.72H.95v2.33A9 9 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.95 10.7A5.4 5.4 0 0 1 3.67 9c0-.59.1-1.16.28-1.7V4.97H.95A9 9 0 0 0 0 9c0 1.45.35 2.83.95 4.03l3-2.33z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.32 0 2.51.46 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .95 4.97l3 2.33C4.66 5.17 6.65 3.58 9 3.58z"
      />
    </svg>
  );
}
