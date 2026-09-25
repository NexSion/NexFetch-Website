import Image from "next/image";
import Link from "next/link";
import GlassCard from "@/components/GlassCard";

const features = [
  {
    icon: "monitor",
    title: "Stream detection",
    body: "NexFetch watches every tab for m3u8, MPD, and direct MP4/WebM traffic and surfaces it the moment it appears — no page inspection required."
  },
  {
    icon: "download",
    title: "One-click download",
    body: "Downloads start immediately with no save-location prompt. HLS playlists are converted to a single MP4 in the background."
  },
  {
    icon: "cast",
    title: "Cast to your TV",
    body: "Send anything NexFetch detects straight to a Chromecast without leaving the tab you're already on."
  },
  {
    icon: "cloud",
    title: "Cloud-synced library",
    body: "Save a video on one device, watch it on another. Your Watch Later list follows your account, not your browser profile."
  }
];

function FeatureIcon({ name }: { name: string }) {
  const common = "h-5 w-5 stroke-current fill-none";
  switch (name) {
    case "monitor":
      return (
        <svg viewBox="0 0 24 24" className={common} strokeWidth="1.75">
          <rect x="3" y="4.5" width="18" height="12" rx="2" />
          <path d="M8 20h8M12 16.5V20" strokeLinecap="round" />
        </svg>
      );
    case "download":
      return (
        <svg viewBox="0 0 24 24" className={common} strokeWidth="1.75">
          <path d="M12 3v12m0 0-4-4m4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M5 19h14" strokeLinecap="round" />
        </svg>
      );
    case "cast":
      return (
        <svg viewBox="0 0 24 24" className={common} strokeWidth="1.75">
          <path d="M3 8V5a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 13a8 8 0 0 1 8 8M3 17a4 4 0 0 1 4 4" strokeLinecap="round" />
          <circle cx="4" cy="20" r="1" fill="currentColor" stroke="none" />
        </svg>
      );
    case "cloud":
      return (
        <svg viewBox="0 0 24 24" className={common} strokeWidth="1.75">
          <path d="M7 18a4.5 4.5 0 0 1-.5-8.97A5.5 5.5 0 0 1 17 8.5a4 4 0 0 1-1 7.9H7Z" strokeLinejoin="round" />
        </svg>
      );
    default:
      return null;
  }
}

export default function HomePage() {
  return (
    <div>
      <section className="relative overflow-hidden px-6 pb-24 pt-20">
        {/* soft ambient shapes, kept subtle — no busy gradient blobs */}
        <div className="pointer-events-none absolute -left-32 top-0 h-96 w-96 rounded-full bg-blue-deep/10 blur-3xl" />
        <div className="pointer-events-none absolute -right-24 top-24 h-80 w-80 rounded-full bg-violet-deep/10 blur-3xl" />

        <div className="relative mx-auto grid max-w-6xl items-center gap-16 lg:grid-cols-[1.1fr_0.9fr]">
          <div className="flex flex-col items-center text-center lg:items-start lg:text-left">
            <Image
              src="/logo.png"
              alt="NexFetch logo"
              width={72}
              height={72}
              className="mb-7 drop-shadow-[0_0_30px_rgba(59,130,246,0.35)]"
              priority
            />
            <h1 className="font-display text-4xl leading-[1.1] text-white sm:text-5xl">
              Every video your browser sees,
              <br className="hidden lg:block" /> <span className="bg-nex-gradient bg-clip-text text-transparent">one click</span> from being yours.
            </h1>
            <p className="mt-6 max-w-xl text-base text-white/55">
              NexFetch is a Chrome extension that detects streams as they load, downloads them with
              no prompts, and casts or saves them wherever you need — backed by an account that
              keeps your library in sync.
            </p>
            <div className="mt-9 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
              <a
                href="https://chrome.google.com/webstore"
                className="inline-flex items-center gap-2 rounded-xl bg-nex-gradient px-6 py-3 text-sm font-medium text-white shadow-lg shadow-blue-deep/30 hover:opacity-90 transition-opacity"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.75">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M3 12h18M12 3a13.5 13.5 0 0 1 0 18M12 3a13.5 13.5 0 0 0 0 18" strokeLinecap="round" />
                </svg>
                Add to Chrome — It&apos;s free
              </a>
              <Link
                href="/register"
                className="inline-flex items-center gap-2 rounded-xl border border-white/12 px-6 py-3 text-sm font-medium text-white/85 hover:border-blue-glow/60 transition-colors"
              >
                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.75">
                  <circle cx="12" cy="8" r="3.2" />
                  <path d="M5 20a7 7 0 0 1 14 0" strokeLinecap="round" />
                </svg>
                Create an account
              </Link>
            </div>
          </div>

          {/* Floating browser mockup */}
          <div className="relative hidden justify-self-center lg:block">
            <div className="w-80 rotate-2 rounded-2xl border border-white/10 bg-panel/90 p-3 shadow-2xl shadow-black/50">
              <div className="mb-3 flex items-center gap-1.5 px-1">
                <span className="h-2.5 w-2.5 rounded-full bg-red-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-400/70" />
                <span className="h-2.5 w-2.5 rounded-full bg-green-400/70" />
              </div>
              <div className="flex aspect-video items-center justify-center rounded-xl bg-black/60">
                <svg viewBox="0 0 24 24" className="h-10 w-10 fill-white/70">
                  <path d="M8 5v14l11-7z" />
                </svg>
              </div>
            </div>
            <div className="absolute -bottom-4 -right-6 flex items-center gap-1.5 rounded-full bg-nex-gradient px-4 py-2 text-xs font-medium text-white shadow-lg shadow-blue-deep/40">
              <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-none stroke-current" strokeWidth="2">
                <path d="M12 3v12m0 0-4-4m4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Download
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="px-6 pb-24">
        <div className="mx-auto grid max-w-5xl gap-4 sm:grid-cols-2">
          {features.map((f) => (
            <GlassCard key={f.title} className="group relative">
              <div className="flex items-start justify-between">
                <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-deep/15 text-blue-glow">
                  <FeatureIcon name={f.icon} />
                </div>
                <svg
                  viewBox="0 0 24 24"
                  className="h-4 w-4 fill-none stroke-current text-white/25 transition-transform group-hover:translate-x-0.5 group-hover:text-white/50"
                  strokeWidth="1.75"
                >
                  <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <h3 className="mt-4 font-display text-lg text-white">{f.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-white/55">{f.body}</p>
            </GlassCard>
          ))}
        </div>
      </section>

      <section className="px-6 pb-24">
        <GlassCard className="mx-auto flex max-w-4xl flex-col items-center gap-5 text-center">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-deep/15 text-blue-glow">
            <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
              <path d="M12 2l1.8 5.6L19 9l-5.2 1.4L12 16l-1.8-5.6L5 9l5.2-1.4L12 2Z" />
            </svg>
          </div>
          <h2 className="font-display text-2xl text-white sm:text-3xl">
            Free to start. Premium removes the daily limits.
          </h2>
          <p className="max-w-xl text-white/55">
            Every account gets a set number of streams and casts per day for free. Upgrade any
            time from your dashboard once you need more.
          </p>
          <Link
            href="/register"
            className="mt-2 inline-flex items-center gap-2 rounded-full bg-nex-gradient px-6 py-2.5 text-sm font-medium text-white shadow-lg shadow-blue-deep/30 hover:opacity-90 transition-opacity"
          >
            Get started
            <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="1.75">
              <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </GlassCard>
      </section>
    </div>
  );
}
