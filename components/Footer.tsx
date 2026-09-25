import Link from "next/link";

export default function Footer() {
  return (
    <footer className="border-t border-white/5 py-6">
      <div className="mx-auto flex max-w-5xl flex-col items-center justify-between gap-3 px-6 text-sm text-white/40 sm:flex-row">
        <p>© {new Date().getFullYear()} NexApp › NexFetch Ltd. Built by MR. ARX + Arabi Islam.</p>
        <div className="flex gap-6">
          <Link href="/privacy-policy" className="hover:text-white/70 transition-colors">
            Privacy
          </Link>
          <Link href="/terms-of-service" className="hover:text-white/70 transition-colors">
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
}
