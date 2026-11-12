"use client";

import { useActionState } from "react";
import { requestSignInCode, verifySignInCode, type SignInState } from "./signin-actions";

const START: SignInState = { step: "email", email: "", message: null };

export function SignInForm({ linkFailed = false }: { linkFailed?: boolean }) {
  const [requested, request, requesting] = useActionState(requestSignInCode, START);
  const [verified, verify, verifying] = useActionState(verifySignInCode, START);
  const onCodeStep = requested.step === "code";
  const email = requested.email;
  const message = onCodeStep ? verified.message : requested.message ?? (linkFailed ? "That sign-in link did not work or has expired. Request a new one." : null);

  return (
    <div className="signIn">
      {!onCodeStep ? (
        <form action={request} className="signInForm">
          <label htmlFor="signin-email">Email</label>
          <div className="signInRow">
            <input autoComplete="email" defaultValue={email} id="signin-email" inputMode="email" name="email" placeholder="you@example.com" required type="email" />
            <button disabled={requesting} type="submit">{requesting ? "Sending…" : "Email me a code"}</button>
          </div>
        </form>
      ) : (
        <form action={verify} className="signInForm">
          <input name="email" type="hidden" value={email} />
          <label htmlFor="signin-code">Code sent to {email}</label>
          <div className="signInRow">
            <input autoComplete="one-time-code" autoFocus id="signin-code" inputMode="numeric" maxLength={12} name="code" pattern="[0-9 ]{6,12}" placeholder="123456" required />
            <button disabled={verifying} type="submit">{verifying ? "Checking…" : "Sign in"}</button>
          </div>
          <p className="signInHint">If this address has access, the email arrives within a minute. You can also open the link in it.</p>
        </form>
      )}
      <p aria-live="polite" className="signInMessage" role="status">{message}</p>
    </div>
  );
}
