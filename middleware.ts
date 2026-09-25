import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// NexFetch now requires a real account for everything except the
// marketing pages and the login flow itself — the old anonymous,
// device-key-only free tier is retired. Every route below redirects
// to /login when there's no session.
const PROTECTED_PREFIXES = [
  "/dashboard",
  "/account",
  "/videos",
  "/saved",
  "/admin",
  "/video/stream",
  "/video/cast",
  "/video/download"
];

export async function middleware(request: NextRequest) {
  const { response, user } = await updateSession(request);

  const path = request.nextUrl.pathname;
  const isProtected = PROTECTED_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));

  if (isProtected && !user) {
    const loginUrl = new URL("/login", request.url);
    const dkey = request.nextUrl.searchParams.get("dkey");
    if (dkey) loginUrl.searchParams.set("dkey", dkey);
    loginUrl.searchParams.set("next", path + request.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.png|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"]
};
