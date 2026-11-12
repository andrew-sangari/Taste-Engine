import { NextResponse } from "next/server";
import { serverSupabase } from "../../../server/supabase.ts";
import { safeReturnPath } from "../../return-path.ts";

export const dynamic = "force-dynamic";

// Landing point of a sign-in email that carries a token hash. Unlike a code
// link it works in any browser, so opening the email on a phone is fine.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const supabase = await serverSupabase();
  const failure = new URL("/", url.origin);
  failure.searchParams.set("signin", "link-failed");
  if (!tokenHash || !supabase || !["email", "magiclink", "signup"].includes(String(type))) return NextResponse.redirect(failure);
  const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: type as "email" | "magiclink" | "signup" });
  return NextResponse.redirect(error ? failure : new URL(safeReturnPath(url.searchParams.get("next") ?? "/"), url.origin));
}
