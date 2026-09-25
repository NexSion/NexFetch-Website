import Link from "next/link";
import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ThemeToggle from "@/components/ThemeToggle";

export default async function Navbar() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  const links = [
    { href: "/", label: "Home" },
    { href: "/#features", label: "Features" },
    { href: "/pricing", label: "Pricing" },
    { href: "/help", label: "Help" }
  ];

  return (
    <header className="sticky top-4 z-40 px-4">
      <div className="mx-auto flex max-w-6xl items-center justify-between rounded-2xl border border-white/10 bg-panel/35 px-6 py-4 shadow-xl shadow-black/30 backdrop-blur-2xl">
        <Link href="/" className="flex items-center gap-2.5 pr-6">
          <Image src="/logo.png" alt="NexFetch" width={36} height={36} className="rounded-lg" />
          <span className="font-display text-lg font-semibold tracking-tight text-white">NexFetch</span>
        </Link>

        <nav className="hidden items-center gap-1 text-sm text-white/60 md:flex">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-xl px-4 py-2 transition-colors hover:bg-white/5 hover:text-white"
            >
              {l.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-3">
          <ThemeToggle />
          {user ? (
            <Link
              href="/account"
              className="hidden rounded-xl border border-white/10 px-4 py-2 text-sm text-white/90 transition-colors hover:border-blue-glow/60 sm:inline-block"
            >
              {user.email}
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-xl bg-nex-gradient px-5 py-2 text-sm font-medium text-white shadow-md shadow-blue-deep/30 transition-opacity hover:opacity-90"
            >
              Log in with Google
            </Link>
          )}
        </div>
      </div>
    </header>
  );
}
