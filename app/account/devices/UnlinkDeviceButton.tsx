"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function UnlinkDeviceButton({ deviceKey }: { deviceKey: string }) {
  const router = useRouter();
  const supabase = createSupabaseBrowserClient();
  const [loading, setLoading] = useState(false);

  async function handleUnlink() {
    setLoading(true);
    await supabase.from("devices").update({ user_id: null }).eq("device_key", deviceKey);
    setLoading(false);
    router.refresh();
  }

  return (
    <button
      onClick={handleUnlink}
      disabled={loading}
      className="rounded-full border border-white/15 px-3 py-1 text-xs text-white/70 hover:border-red-400/60 hover:text-red-300 transition-colors disabled:opacity-50"
    >
      {loading ? "Unlinking…" : "Unlink"}
    </button>
  );
}
