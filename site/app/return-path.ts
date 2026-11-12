/** Only same-site relative paths are followed after sign-in. */
export function safeReturnPath(value: unknown): string {
  const input = typeof value === "string" ? value : "";
  if (!input.startsWith("/") || input.startsWith("//") || input.startsWith("/\\")) return "/";
  let url: URL;
  try {
    url = new URL(input, "https://app.local");
  } catch {
    return "/";
  }
  if (url.origin !== "https://app.local" || url.pathname.startsWith("/auth/")) return "/";
  return `${url.pathname}${url.search}${url.hash}`;
}
