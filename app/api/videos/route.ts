import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET api/videos
// Contract: fetch(`${BASE}api/videos`, { credentials: "include" })
// expects { success: true, data: { videos: [...] } } — used by the
// extension's sync-on-startup flow to pull the saved/Watch Later list
// down from the cloud and merge it into local storage.
export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { data, error } = await supabase
    .from("saved_videos")
    .select("hash, title, url, webpage_url, thumbnail, duration, extension, quality, size, raw, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  // Flatten `raw` back onto each row so the extension gets the same
  // shape it originally sent (savedVideos:add passes the full video
  // object through, keyed by hash — see content_scripts/bridge.js).
  const videos = (data ?? []).map((row) => ({
    ...row.raw,
    hash: row.hash,
    title: row.title,
    url: row.url,
    webpage_url: row.webpage_url,
    thumbnail: row.thumbnail,
    duration: row.duration,
    extension: row.extension,
    quality: row.quality,
    size: row.size
  }));

  return NextResponse.json({ success: true, data: { videos } });
}

// POST api/videos  { video: { hash, title, url, ... } }
// Contract: called (directly or via the dashboard UI, which mirrors
// savedVideos:add) to push a newly-saved video up to the cloud so it
// syncs across the person's devices.
const videoSchema = z
  .object({
    hash: z.string().min(1)
  })
  .passthrough();

const bodySchema = z.object({ video: videoSchema });

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "INVALID_BODY" }, { status: 400 });
  }

  const v = parsed.data.video;

  const { error } = await supabase.from("saved_videos").upsert(
    {
      user_id: user.id,
      hash: v.hash,
      title: v.title ?? v.fileName ?? null,
      url: v.url ?? null,
      webpage_url: v.webpage_url ?? null,
      thumbnail: v.thumbnail ?? null,
      duration: typeof v.duration === "number" ? v.duration : null,
      extension: v.extension ?? null,
      quality: v.quality ?? null,
      size: typeof v.size === "number" ? v.size : null,
      raw: v
    },
    { onConflict: "user_id,hash" }
  );

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

// DELETE api/videos?hash=...
// Not in the discovered contract explicitly, but needed for the
// dashboard's "remove from saved" action — kept as a simple, safe
// addition rather than a redesign of the sync contract above.
export async function DELETE(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: "UNAUTHENTICATED" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const hash = searchParams.get("hash");
  if (!hash) {
    return NextResponse.json({ success: false, error: "HASH_REQUIRED" }, { status: 400 });
  }

  const { error } = await supabase
    .from("saved_videos")
    .delete()
    .eq("user_id", user.id)
    .eq("hash", hash);

  if (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
