"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import GlassCard from "@/components/GlassCard";

export interface User {
  id: string;
  email: string | null;
  role: string;
  is_premium: boolean;
  created_at: string;
}

export default function UserRow({ user }: { user: User }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const isAdmin = user.role === "admin";

  async function setPremium(value: boolean) {
    setLoading(true);
    await fetch(`/api/admin/users/${user.id}/plan`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ is_premium: value })
    }).catch(() => {});
    setLoading(false);
    router.refresh();
  }

  return (
    <GlassCard className="flex items-center justify-between gap-4">
      <div className="min-w-0">
        <p className="truncate text-white">{user.email ?? user.id}</p>
        <p className="mt-1 text-xs text-white/40">
          {isAdmin ? "Admin" : user.is_premium ? "Premium" : "Free"} · joined{" "}
          {new Date(user.created_at).toLocaleDateString()}
        </p>
      </div>

      {isAdmin ? (
        <span className="shrink-0 rounded-full border border-blue-glow/40 px-4 py-1.5 text-xs text-blue-glow">
          Admin — always Premium
        </span>
      ) : (
        <button
          onClick={() => setPremium(!user.is_premium)}
          disabled={loading}
          className="shrink-0 rounded-full border border-white/15 px-4 py-1.5 text-sm text-white/80 transition-colors hover:border-blue-glow/60 disabled:opacity-50"
        >
          {loading ? "Saving…" : user.is_premium ? "Revoke Premium" : "Make Premium"}
        </button>
      )}
    </GlassCard>
  );
}
