import { redirect } from "next/navigation";
import { requireAdmin } from "@/lib/admin";
import { createSupabaseServiceClient } from "@/lib/supabase/server";
import GlassCard from "@/components/GlassCard";
import UserRow, { type User } from "./UserRow";

export default async function AdminPage() {
  const admin = await requireAdmin();
  if (!admin) redirect("/login");

  const service = createSupabaseServiceClient();
  const { data: users }: { data: User[] | null } = await service
    .from("profiles")
    .select("id, email, role, is_premium, created_at")
    .order("created_at", { ascending: false })
    .limit(500);

  const total = users?.length ?? 0;
  const premiumCount = users?.filter((u: User) => u.is_premium || u.role === "admin").length ?? 0;

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <h1 className="font-display text-3xl text-white">Admin</h1>
      <p className="mt-2 text-white/50">Manage plans for every account. You&apos;re signed in as an admin.</p>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <GlassCard>
          <p className="text-sm text-white/50">Total accounts</p>
          <p className="mt-2 font-display text-2xl text-white">{total}</p>
        </GlassCard>
        <GlassCard>
          <p className="text-sm text-white/50">On Premium (incl. admins)</p>
          <p className="mt-2 font-display text-2xl text-white">{premiumCount}</p>
        </GlassCard>
      </div>

      <div className="mt-8 flex flex-col gap-3">
        {!users?.length && (
          <GlassCard>
            <p className="text-white/60">No accounts yet.</p>
          </GlassCard>
        )}
        {users?.map((u: User) => (
          <UserRow key={u.id} user={u} />
        ))}
      </div>
    </div>
  );
}
