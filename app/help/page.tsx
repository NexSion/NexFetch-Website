import GlassCard from "@/components/GlassCard";

const faqs = [
  {
    q: "Why isn't NexFetch detecting a video?",
    a: "Some sites load video behind DRM or block extension access entirely — check /disabled for the list of known-unsupported patterns. Otherwise, try refreshing the tab after the video starts playing; detection runs on network activity, not page load."
  },
  {
    q: "Where do downloads go?",
    a: "By default, your browser's normal download location, with no save-as prompt. You can change this under the extension's Settings → Downloads."
  },
  {
    q: "Why do I have a daily stream/cast limit?",
    a: "Free accounts get a daily allowance shown on your dashboard. Premium removes it entirely."
  },
  {
    q: "How do I unlink a device?",
    a: "Go to Account → Linked devices and unlink it from there."
  }
];

export default function HelpPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-display text-3xl text-white">Help</h1>
      <div className="mt-8 flex flex-col gap-4">
        {faqs.map((f) => (
          <GlassCard key={f.q}>
            <h2 className="text-white">{f.q}</h2>
            <p className="mt-2 text-sm text-white/60">{f.a}</p>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
