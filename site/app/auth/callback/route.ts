import { NextResponse } from "next/server";
import { serverSupabase } from "../../../server/supabase.ts";
import { safeReturnPath } from "../../return-path.ts";

export const dynamic = "force-dynamic";

// Landing point of a sign-in link: exchanges its one-time code for a session.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const destination = new URL(safeReturnPath(url.searchParams.get("next") ?? "/"), url.origin);
  const code = url.searchParams.get("code");
  const supabase = await serverSupabase();
  if (!code || !supabase) return NextResponse.redirect(failure(url));
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  return NextResponse.redirect(error ? failure(url) : destination);
}

function failure(url: URL): URL {
  const target = new URL("/", url.origin);
  target.searchParams.set("signin", "link-failed");
  return target;
}
