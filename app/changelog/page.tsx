import GlassCard from "@/components/GlassCard";

// Route: /changelog (Ot.whatsNew maps to this path) — opened from the
// popup's "what's new" prompt after an update. Static for now; wire
// this up to real release notes as versions ship.
const entries = [
  { version: "4.0.0", notes: ["Current release tracked by manifest.json."] }
];

export default function ChangelogPage() {
  return (
    <div className="mx-auto max-w-2xl px-6 py-20">
      <h1 className="font-display text-3xl text-white">What&apos;s new</h1>
      <div className="mt-8 flex flex-col gap-4">
        {entries.map((e) => (
          <GlassCard key={e.version}>
            <h2 className="font-display text-white">v{e.version}</h2>
            <ul className="mt-2 list-disc pl-5 text-sm text-white/60">
              {e.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
