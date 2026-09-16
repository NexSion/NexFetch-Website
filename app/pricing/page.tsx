import Link from "next/link";
import GlassCard from "@/components/GlassCard";

// No payment provider wired up on purpose (per brief §7: "do not
// invent a payment provider"). This shows the two tiers honestly;
// the "Upgrade" button links to contact until billing exists.
const tiers = [
  {
    name: "Free",
    price: "$0",
    features: ["10 streams / day", "5 casts / day", "Cloud-synced saved videos", "Unlimited downloads"]
  },
  {
    name: "Premium",
    price: "—",
    features: ["Unlimited streams", "Unlimited casts", "Everything in Free", "Priority support"]
  }
];

export default function PricingPage() {
  return (
    <div className="mx-auto max-w-3xl px-6 py-20">
      <h1 className="text-center font-display text-3xl text-white">Plans</h1>
      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {tiers.map((t) => (
          <GlassCard key={t.name} className="glow-border">
            <h2 className="font-display text-xl text-white">{t.name}</h2>
            <p className="mt-2 text-2xl text-white">{t.price}</p>
            <ul className="mt-4 space-y-2 text-sm text-white/60">
              {t.features.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
            {t.name === "Premium" && (
              <Link
                href="/contact"
                className="mt-6 inline-block rounded-full bg-nex-gradient px-5 py-2 text-sm font-medium text-white"
              >
                Ask about upgrading
              </Link>
            )}
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
