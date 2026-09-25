import { redirect } from "next/navigation";

// No separate sign-up flow anymore — Google login creates the account
// automatically (see supabase/schema.sql's handle_new_user trigger).
// This route stays only so old links (Navbar CTA, extension redirects
// with ?dkey=) keep working.
export default function RegisterPage({
  searchParams
}: {
  searchParams: { dkey?: string };
}) {
  redirect(searchParams.dkey ? `/login?dkey=${encodeURIComponent(searchParams.dkey)}` : "/login");
}
