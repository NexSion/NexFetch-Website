import Link from "next/link";
import Image from "next/image";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function Navbar() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  return (
    <header className="sticky top-0 z-40 glass">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2.5">
          <Image src="/logo.png" alt="NexFetch" width={30} height={30} className="rounded-md" />
          <span className="font-display text-lg tracking-tight text-white">NexFetch</span>
        </Link>

        <nav className="hidden items-center gap-8 text-sm text-white/70 md:flex">
          <Link href="/#features" className="hover:text-white transition-colors">
            Features
          </Link>
          <Link href="/videos" className="hover:text-white transition-colors">
            Saved videos
          </Link>
          <Link href="/dashboard" className="hover:text-white transition-colors">
            Dashboard
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          {user ? (
            <Link
              href="/account"
              className="rounded-full border border-white/10 px-4 py-1.5 text-sm text-white/90 hover:border-blue-glow/60 transition-colors"
            >
              {user.email}
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm text-white/70 hover:text-white transition-colors">
                Log in
              </Link>
              <Link
                href="/register"
                className="rounded-full bg-nex-gradient px-4 py-1.5 text-sm font-medium text-white shadow-lg shadow-violet-deep/30 hover:opacity-90 transition-opacity"
              >
                Get NexFetch
              </Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}
