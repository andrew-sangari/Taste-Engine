"use client";

import { useEffect, useState } from "react";

type Playlist = { id: string; name: string; tracks?: number; enabled?: boolean; weight?: number };
type RuntimeStatus = {
  spotify: { configured: boolean; connected: boolean; missingScopes: string[]; selectedPlaylistCount: number };
  ollama: { configured: boolean; baseUrl: string; model: string | null; concurrency: number };
};

export function HostedConnections() {
  const [status, setStatus] = useState<RuntimeStatus | null>(null);
  const [available, setAvailable] = useState<Playlist[] | null>(null);
  const [selected, setSelected] = useState<Playlist[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => { void loadStatus(); }, []);

  async function loadStatus() {
    const response = await fetch("/api/runtime/status", { cache: "no-store" });
    if (response.ok) setStatus(await response.json());
  }

  async function loadPlaylists() {
    setMessage("Loading Spotify playlists…");
    const response = await fetch("/api/spotify/playlists?available=1", { cache: "no-store" });
    if (!response.ok) {
      setMessage("Spotify playlists are unavailable. Reconnect Spotify and try again.");
      return;
    }
    const body = await response.json() as { selected: Playlist[]; available: Playlist[] };
    const selectedIds = new Set(body.selected.map((item) => item.id));
    setSelected(body.selected);
    setAvailable(body.available.map((item) => ({ ...item, enabled: selectedIds.has(item.id) })));
    setMessage(null);
  }

  async function savePlaylists() {
    if (!available) return;
    const playlists = available.filter((item) => item.enabled).map((item) => ({
      id: item.id,
      name: item.name,
      enabled: true,
      weight: selected.find((selectedItem) => selectedItem.id === item.id)?.weight ?? 1,
    }));
    const response = await fetch("/api/spotify/playlists", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playlists }),
    });
    if (!response.ok) {
      setMessage("Playlist selection could not be saved.");
      return;
    }
    setSelected((await response.json()).selected);
    setMessage("Playlist selection saved to Taste Engine.");
    await loadStatus();
  }

  async function refreshTopArtists() {
    setMessage("Refreshing Spotify affinity windows…");
    const response = await fetch("/api/spotify/top-artists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ limit: 50 }),
    });
    setMessage(response.ok ? "Spotify Top Artists refreshed." : "Top Artists could not refresh; valid cached windows remain eligible.");
    await loadStatus();
  }

  async function refreshEverything() {
    setMessage("Refreshing every hosted source, ranking the result, and running Ollama Cloud…");
    const response = await fetch("/api/runtime/refresh", { method: "POST" });
    const body = await response.json() as {
      status?: string;
      projectionPublished?: boolean;
      publicationBlockers?: string[];
      error?: string;
    };
    if (response.ok && body.projectionPublished) {
      setMessage("Hosted refresh completed and the new validated recommendation snapshot is live.");
      window.location.reload();
      return;
    }
    setMessage(body.publicationBlockers?.[0] ?? body.error ?? "Hosted refresh did not publish; the previous snapshot remains live.");
  }

  async function disconnect() {
    if (!window.confirm("Disconnect Spotify and delete hosted Spotify tokens, playlist selections, and Top Artists cache?")) return;
    const response = await fetch("/api/spotify/status", { method: "DELETE" });
    if (response.ok) {
      setAvailable(null);
      setSelected([]);
      setMessage("Spotify disconnected and its hosted snapshots were deleted.");
      await loadStatus();
    }
  }

  return (
    <section className="tasteBlock" aria-labelledby="hosted-connections-title">
      <div className="tasteBlockHeading">
        <p className="eyebrow">Hosted engine</p>
        <h3 id="hosted-connections-title">Sources that run while your computer is off.</h3>
      </div>
      {!status ? <p className="tasteQuietEmpty">Sign in with ChatGPT to inspect hosted connections.</p> : (
        <div className="timelineList">
          <article className="timelineRow">
            <div>
              <strong>Spotify</strong>
              <span>{status.spotify.connected
                ? `${status.spotify.selectedPlaylistCount} selected playlist${status.spotify.selectedPlaylistCount === 1 ? "" : "s"}`
                : status.spotify.configured ? "Ready to connect" : "Needs a hosted client ID"}</span>
            </div>
            <div className="checkInOptions">
              {!status.spotify.connected ? <a className="cardAction" href="/api/spotify/connect">Connect Spotify</a> : <>
                <button onClick={loadPlaylists} type="button">Choose playlists</button>
                <button onClick={refreshTopArtists} type="button">Refresh affinity</button>
                <button onClick={refreshEverything} type="button">Refresh everything</button>
                <button className="quietAction" onClick={disconnect} type="button">Disconnect</button>
              </>}
            </div>
          </article>
          <article className="timelineRow">
            <div>
              <strong>Ollama Cloud</strong>
              <span>{status.ollama.configured
                ? `${status.ollama.model} · sequential passes`
                : "Needs OLLAMA_API_KEY and OLLAMA_MODEL hosted secrets"}</span>
            </div>
            <p>{status.ollama.configured ? "Configured" : "Deterministic fallback active"}</p>
          </article>
        </div>
      )}
      {available ? <div className="playlistPicker">
        {available.map((playlist) => <label key={playlist.id}>
          <input
            checked={Boolean(playlist.enabled)}
            onChange={(event) => setAvailable((current) => current?.map((item) => item.id === playlist.id ? { ...item, enabled: event.target.checked } : item) ?? null)}
            type="checkbox"
          />
          <span>{playlist.name}{playlist.tracks != null ? ` · ${playlist.tracks} tracks` : ""}</span>
        </label>)}
        <button onClick={savePlaylists} type="button">Save playlist selection</button>
      </div> : null}
      {message ? <small>{message}</small> : null}
    </section>
  );
}
