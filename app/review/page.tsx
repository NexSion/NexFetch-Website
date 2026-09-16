import GlassCard from "@/components/GlassCard";

// Replace CHROME_STORE_ITEM_ID with the real Web Store listing ID once
// NexFetch is published — popup.js opens this route from its
// "enjoying NexFetch?" prompt.
const CHROME_STORE_URL = "https://chrome.google.com/webstore/detail/CHROME_STORE_ITEM_ID/reviews";

export default function ReviewPage() {
  return (
    <div className="mx-auto max-w-lg px-6 py-20 text-center">
      <h1 className="font-display text-3xl text-white">Enjoying NexFetch?</h1>
      <GlassCard className="mt-8 glow-border">
        <p className="text-white/60">A quick review on the Chrome Web Store helps a lot.</p>
        <a
          href={CHROME_STORE_URL}
          className="mt-6 inline-block rounded-full bg-nex-gradient px-6 py-2.5 text-sm font-medium text-white"
        >
          Leave a review
        </a>
      </GlassCard>
    </div>
  );
}
