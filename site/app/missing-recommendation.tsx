"use client";

import { useState, type FormEvent } from "react";

export function MissingRecommendation() {
  const [eventUrl, setEventUrl] = useState("");
  const [eventDetails, setEventDetails] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("Submitting…");
    const response = await fetch("/api/recommendation-misses", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ eventUrl, eventDetails }),
    });
    const body = await response.json().catch(() => ({})) as { error?: string };
    if (!response.ok) { setMessage(body.error ?? "The missed recommendation could not be saved."); return; }
    setEventUrl("");
    setEventDetails("");
    setMessage("Saved for owner review. This never changes source coverage automatically.");
  }

  return <section className="tasteBlock missingRecommendation" aria-labelledby="missing-recommendation-title">
    <div className="tasteBlockHeading"><p className="eyebrow">Coverage review</p><h3 id="missing-recommendation-title">Missing recommendation?</h3></div>
    <p>Send an event URL or basic details. Repeated retrieval gaps become a review candidate; this does not add scraping or a new source automatically.</p>
    <form onSubmit={submit}>
      <label>Event URL <input onChange={(event) => setEventUrl(event.target.value)} placeholder="https://…" type="url" value={eventUrl} /></label>
      <label>Or basic details <textarea maxLength={2000} onChange={(event) => setEventDetails(event.target.value)} placeholder="Artist, date, venue, and why it mattered" value={eventDetails} /></label>
      <button type="submit">Submit miss</button>
    </form>
    {message ? <small>{message}</small> : null}
  </section>;
}
