import GlassCard from "@/components/GlassCard";

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl text-white">Privacy</h1>
      <GlassCard className="mt-8 space-y-4 text-sm leading-relaxed text-white/70">
        <p>
          NexFetch stores only what the product needs to work: your account email, the
          device_key your browser generates on install, saved-video metadata you explicitly
          choose to sync, and daily stream/cast counts used to enforce plan limits.
        </p>
        <p>
          We don&apos;t collect browsing history, page content, or any data from tabs where you
          haven&apos;t used NexFetch. Video URLs that pass through
          <code className="mx-1 rounded bg-black/40 px-1.5 py-0.5">api/video/fetch-video-info</code>
          are cached briefly to avoid redundant fetches and are not linked to your identity.
        </p>
        <p>Replace this page with your actual policy before shipping to real users.</p>
      </GlassCard>
    </div>
  );
}
