import { NextResponse } from "next/server";
import { crossSiteRejection } from "../../../server/cross-site.ts";
import { serverSupabase } from "../../../server/supabase.ts";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rejection = crossSiteRejection(request);
  if (rejection) return rejection;
  const supabase = await serverSupabase();
  if (supabase) await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/", request.url), { status: 303 });
}
