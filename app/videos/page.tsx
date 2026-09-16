import { redirect } from "next/navigation";
import Image from "next/image";
import GlassCard from "@/components/GlassCard";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import RemoveSavedButton from "./RemoveSavedButton";

export default async function SavedPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: videos } = await supabase
    .from("saved_videos")
    .select("hash, title, webpage_url, thumbnail, extension, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-4xl px-6 py-16">
      <h1 className="font-display text-3xl text-white">Saved videos</h1>
      <p className="mt-2 text-white/50">Synced from every device where you&apos;re logged in.</p>

      <div className="mt-8 flex flex-col gap-4">
        {!videos?.length && (
          <GlassCard>
            <p className="text-white/60">
              Nothing saved yet. Use the &quot;Save for later&quot; button in the NexFetch popup on
              any detected video.
            </p>
          </GlassCard>
        )}

        {videos?.map((v) => (
          <GlassCard key={v.hash} className="flex items-center gap-4">
            <div className="h-16 w-28 flex-shrink-0 overflow-hidden rounded-lg bg-black/40">
              {v.thumbnail ? (
                <Image src={v.thumbnail} alt="" width={112} height={64} className="h-full w-full object-cover" />
              ) : null}
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="truncate text-white">{v.title ?? "Untitled video"}</p>
              {v.webpage_url && (
                <a
                  href={v.webpage_url}
                  className="truncate text-xs text-white/40 hover:text-blue-glow"
                  target="_blank"
                >
                  {v.webpage_url}
                </a>
              )}
            </div>
            <RemoveSavedButton hash={v.hash} />
          </GlassCard>
        ))}
      </div>
    </div>
  );
}
