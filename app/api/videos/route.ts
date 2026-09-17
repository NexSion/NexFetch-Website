import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

// GET api/videos — used by the extension's cloud-sync-on-startup flow.
// Kept as { success, data: { videos: [...] } }; no evidence in the
// popup bundle that this shape needs changing (only the write side —
// POST/DELETE — turned out to differ from the first pass).
export async function GET() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ success: false, error: { code: "LOGIN_REQUIRED", message: "Unauthenticated." } }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("saved_videos")
    .select("hash, title, url, webpage_url, thumbnail, duration, extension, quality, size, raw, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
  }

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

// POST api/videos  { hash, title?, link?, thumbnail? }
//
// Contract confirmed from popup.js's un()/tn(): the "Watch Later"
// button builds a URLSearchParams with exactly these four fields (note
// "link", not "url"/"webpage_url" — the extension's own naming) and
// posts them as a flat JSON body, not wrapped in { video: {...} }
// like the first pass assumed. Response must echo back
// { success, data: { video: {...} } } — rn() in popup.js reads
// `e.data?.video` and forwards it straight into local storage via a
// savedVideos:add background message, so the object needs a `hash` at
// minimum.
//
// Unauthenticated must NOT be a bare 401 — popup.js's http client (see
// storageLock.js's request()) throws away the response body on a true
// 401 status, so watch_later's specific "please log in" messaging
// never fires. Returning 403 with { error: { code: "LOGIN_REQUIRED" } }
// is what actually reaches Ae() in popup.js and shows the right UX.
const bodySchema = z.object({
  hash: z.string().min(1),
  title: z.string().optional(),
  link: z.string().optional(),
  thumbnail: z.string().optional()
});

export async function POST(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "LOGIN_REQUIRED", message: "Unauthenticated." } },
      { status: 403 }
    );
  }

  const json = await request.json().catch(() => null);
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: { message: "INVALID_BODY" } }, { status: 400 });
  }

  const { hash, title, link, thumbnail } = parsed.data;

  const { error } = await supabase.from("saved_videos").upsert(
    {
      user_id: user.id,
      hash,
      title: title ?? null,
      webpage_url: link ?? null,
      thumbnail: thumbnail ?? null,
      raw: parsed.data
    },
    { onConflict: "user_id,hash" }
  );

  if (error) {
    return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
  }

  return NextResponse.json({
    success: true,
    data: { video: { hash, title, link, thumbnail } }
  });
}

// DELETE api/videos  { id?, hash? }  (JSON body, not query params —
// popup.js's on()/Q.delete() sends it as a DELETE body)
const deleteSchema = z.object({
  id: z.number().optional(),
  hash: z.string().optional()
});

export async function DELETE(request: Request) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json(
      { success: false, error: { code: "LOGIN_REQUIRED", message: "Unauthenticated." } },
      { status: 403 }
    );
  }

  const json = await request.json().catch(() => null);
  // Fall back to query params too, since the website's own /videos page
  // (RemoveSavedButton) calls this with ?hash= rather than a body.
  const { searchParams } = new URL(request.url);
  const parsed = deleteSchema.safeParse(json ?? {});
  const hash = parsed.success ? parsed.data.hash : undefined;
  const finalHash = hash ?? searchParams.get("hash") ?? undefined;

  if (!finalHash) {
    return NextResponse.json({ success: false, error: { message: "HASH_REQUIRED" } }, { status: 400 });
  }

  const { error } = await supabase.from("saved_videos").delete().eq("user_id", user.id).eq("hash", finalHash);

  if (error) {
    return NextResponse.json({ success: false, error: { message: error.message } }, { status: 500 });
  }

  return NextResponse.json({ success: true, data: { hash: finalHash } });
}
