"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function RemoveSavedButton({ hash }: { hash: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleRemove() {
    setLoading(true);
    await fetch(`/api/videos?hash=${encodeURIComponent(hash)}`, {
      method: "DELETE",
      credentials: "include"
    });
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleRemove}
      disabled={loading}
      className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:border-red-400/60 hover:text-red-300 transition-colors disabled:opacity-50"
    >
      {loading ? "Removing…" : "Remove"}
    </button>
  );
}
