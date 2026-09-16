import Image from "next/image";
import Link from "next/link";
import GlassCard from "@/components/GlassCard";

const features = [
  {
    title: "Stream detection",
    body: "NexFetch watches every tab for m3u8, MPD, and direct MP4/WebM traffic and surfaces it the moment it appears — no page inspection required."
  },
  {
    title: "One-click download",
    body: "Downloads start immediately with no save-location prompt. HLS playlists are converted to a single MP4 in the background."
  },
  {
    title: "Cast to your TV",
    body: "Send anything NexFetch detects straight to a Chromecast without leaving the tab you're already on."
  },
  {
    title: "Cloud-synced library",
    body: "Save a video on one device, watch it on another. Your Watch Later list follows your account, not your browser profile."
  }
];

export default function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden px-6 pt-24 pb-32">
        <div className="mx-auto flex max-w-5xl flex-col items-center text-center">
          <Image
            src="/logo.png"
            alt="NexFetch logo"
            width={96}
            height={96}
            className="mb-8 drop-shadow-[0_0_40px_rgba(99,102,241,0.45)]"
            priority
          />
          <h1 className="font-display text-4xl leading-tight text-white sm:text-6xl">
            Every video your browser sees,
            <br className="hidden sm:block" /> one click from being yours.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-white/60">
            NexFetch is a Chrome extension that detects streams as they load, downloads them with
            no prompts, and casts or saves them wherever you need — backed by an account that
            keeps your library in sync.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-4">
            <a
              href="https://chrome.google.com/webstore"
              className="rounded-full bg-nex-gradient px-7 py-3 font-medium text-white shadow-xl shadow-violet-deep/30 hover:opacity-90 transition-opacity"
            >
              Add to Chrome — it&apos;s free
            </a>
            <Link
              href="/signup"
              className="rounded-full border border-white/15 px-7 py-3 font-medium text-white/85 hover:border-blue-glow/60 transition-colors"
            >
              Create an account
            </Link>
          </div>
        </div>
      </section>

      <section id="features" className="px-6 pb-28">
        <div className="mx-auto grid max-w-5xl gap-5 sm:grid-cols-2">
          {features.map((f) => (
            <GlassCard key={f.title} className="glow-border">
              <h3 className="font-display text-xl text-white">{f.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-white/60">{f.body}</p>
            </GlassCard>
          ))}
        </div>
      </section>

      <section className="px-6 pb-28">
        <GlassCard className="mx-auto max-w-4xl text-center">
          <h2 className="font-display text-2xl text-white sm:text-3xl">
            Free to start. Premium removes the daily limits.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-white/60">
            Every account gets a set number of streams and casts per day for free. Upgrade any
            time from your dashboard once you need more.
          </p>
          <Link
            href="/signup"
            className="mt-8 inline-block rounded-full bg-nex-gradient px-7 py-3 font-medium text-white shadow-xl shadow-violet-deep/30 hover:opacity-90 transition-opacity"
          >
            Get started
          </Link>
        </GlassCard>
      </section>
    </div>
  );
}
