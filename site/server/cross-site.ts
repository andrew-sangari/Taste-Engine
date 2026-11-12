// A state-changing request must come from this site. Browsers attach
// Sec-Fetch-Site to every request, so a cross-site form or script is rejected
// here regardless of how the session cookie is configured. Non-browser
// clients (the scheduler, curl) send neither header and are authorized by
// their own secret or session instead.
export function crossSiteRejection(request: Request): Response | null {
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    return Response.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && !site) {
    try {
      if (new URL(origin).host !== new URL(request.url).host) {
        return Response.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
      }
    } catch {
      return Response.json({ error: "Cross-site requests are not accepted." }, { status: 403 });
    }
  }
  return null;
}
