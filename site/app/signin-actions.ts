"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { isAllowedProfileEmail } from "../server/profiles.ts";
import { serverSupabase } from "../server/supabase.ts";

export type SignInState = {
  step: "email" | "code";
  email: string;
  message: string | null;
};

const EMAIL = /^[^@\s]{1,64}@[^@\s]{1,255}$/;

/**
 * Step one: email a one-time sign-in code. An address that is not on the
 * allowlist gets the same answer and no email, so the form reveals nothing
 * about who has access and cannot be used to send mail to strangers.
 */
export async function requestSignInCode(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (!EMAIL.test(email)) return { step: "email", email: "", message: "Enter the email address you use for Taste Engine." };
  const supabase = await serverSupabase();
  if (!supabase) return { step: "email", email, message: "Sign-in is not configured for this deployment." };
  if (isAllowedProfileEmail(email)) {
    const requestHeaders = await headers();
    const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host");
    const protocol = requestHeaders.get("x-forwarded-proto") ?? "https";
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true, ...(host ? { emailRedirectTo: `${protocol}://${host}/auth/callback` } : {}) },
    });
    if (error) {
      return { step: "email", email, message: error.status === 429 ? "A sign-in email was sent recently. Wait a minute and try again." : "The sign-in email could not be sent. Try again shortly." };
    }
  }
  return { step: "code", email, message: null };
}

/** Step two: exchange the emailed code for a session. */
export async function verifySignInCode(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const token = String(form.get("code") ?? "").replace(/\s+/g, "");
  if (!EMAIL.test(email)) return { step: "email", email: "", message: "Start again with your email address." };
  if (!/^\d{6,10}$/.test(token)) return { step: "code", email, message: "Enter the code from the email, digits only." };
  const supabase = await serverSupabase();
  if (!supabase || !isAllowedProfileEmail(email)) return { step: "code", email, message: "That code did not work or has expired." };
  const { error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
  if (error) return { step: "code", email, message: "That code did not work or has expired." };
  redirect("/");
}
