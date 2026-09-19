import { deploymentEnvironment } from "./release.ts";

const PREFIX = "enc:v1";
const ADDITIONAL_DATA = new TextEncoder().encode("taste-engine:spotify-token:v1");

export async function sealSpotifyToken(value: string): Promise<string> {
  if (!value) return value;
  const key = await encryptionKey();
  if (!key) {
    const environment = deploymentEnvironment();
    if (["local", "test"].includes(environment) && process.env.TASTE_ALLOW_PLAINTEXT_SPOTIFY_TOKENS === "1") return value;
    throw new TokenEncryptionError("Spotify token encryption is not configured.");
  }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: ADDITIONAL_DATA },
    key,
    new TextEncoder().encode(value),
  );
  return `${PREFIX}:${base64Url(iv)}:${base64Url(new Uint8Array(ciphertext))}`;
}

export async function openSpotifyToken(value: string): Promise<string> {
  if (!value || !value.startsWith(`${PREFIX}:`)) return value;
  const parts = value.split(":");
  if (parts.length !== 4) throw new TokenEncryptionError("Stored Spotify token is invalid.");
  const key = await encryptionKey();
  if (!key) throw new TokenEncryptionError("Spotify token encryption key is unavailable.");
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: asArrayBuffer(fromBase64Url(parts[2])), additionalData: ADDITIONAL_DATA },
      key,
      asArrayBuffer(fromBase64Url(parts[3])),
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    throw new TokenEncryptionError("Stored Spotify token could not be decrypted.");
  }
}

export function isSealedSpotifyToken(value: string | null): boolean {
  return Boolean(value?.startsWith(`${PREFIX}:`));
}

export function spotifyTokenEncryptionStatus(): "configured" | "invalid" | "required" | "development-only" {
  if (process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY) {
    try {
      const bytes = fromBase64Url(process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY);
      return bytes.byteLength === 32 ? "configured" : "invalid";
    } catch {
      return "invalid";
    }
  }
  return ["local", "test"].includes(deploymentEnvironment()) && process.env.TASTE_ALLOW_PLAINTEXT_SPOTIFY_TOKENS === "1"
    ? "development-only"
    : "required";
}

async function encryptionKey(): Promise<CryptoKey | null> {
  const raw = process.env.SPOTIFY_TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const bytes = fromBase64Url(raw);
  if (bytes.byteLength !== 32) throw new TokenEncryptionError("Spotify token encryption key must contain exactly 32 bytes.");
  return crypto.subtle.importKey("raw", asArrayBuffer(bytes), "AES-GCM", false, ["encrypt", "decrypt"]);
}

function base64Url(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padding = "=".repeat((4 - normalized.length % 4) % 4);
  try {
    const binary = atob(`${normalized}${padding}`);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  } catch {
    throw new TokenEncryptionError("Spotify token encryption key is not valid base64url.");
  }
}

function asArrayBuffer(value: Uint8Array): ArrayBuffer {
  return value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength) as ArrayBuffer;
}

export class TokenEncryptionError extends Error {}
