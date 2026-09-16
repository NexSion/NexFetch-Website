import GlassCard from "@/components/GlassCard";

export default function TermsPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl text-white">Terms</h1>
      <GlassCard className="mt-8 space-y-4 text-sm leading-relaxed text-white/70">
        <p>
          NexFetch is provided to help you save and cast video content you already have the
          right to access. You&apos;re responsible for how you use downloaded or cast material —
          respect the copyright and terms of the sites you use it with.
        </p>
        <p>Placeholder terms — replace with your actual legal text before shipping to real users.</p>
      </GlassCard>
    </div>
  );
}
