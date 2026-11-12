import { normalizeArtistName } from './ranking.js';

// Promoter calendars publish marketing titles, not lineups: "unKommon Events &
// Framework present: ANOTR", "Duke Dumont NYE", "Afrojack Presents: CONTROL".
// Treating the whole title (or a co-promoter) as a performer breaks identity:
// the real artist never connects to preference evidence, and a promoter name
// becomes a fake artist. This parser separates three things a title mixes:
// who performs, who presents, and what the night is called.
//
// It is deterministic and never fuzzy. `knownArtistNames` (a promoter roster,
// the taste snapshot) is used only for exact normalized-name decisions: which
// side of a separator is the artist, and whether "A & B" is one act.

const SEPARATOR = /\s+b[23]b\s+|\s+&\s+|\s+\+\s+|\s*,\s+|\s+vs\.?\s+/i;
const TRAILING_DECORATION = /\s+(?:nye|nyd|halloween|new\s+year'?s?\s+(?:eve|day)|(?:day|night)\s+\d+|live|dj\s+set|all\s+night\s+long|open\s+to\s+close|extended\s+set)$/i;
const PLACEHOLDER = /^(?:tba|tbd|tbc|special\s+guests?|friends|more|support|guests?)$/i;
const DESCRIPTOR = /\b(?:anniversary|years?|party|experience|festival|halloween|nye|opening|closing|weekend|day|night|showcase|tour|edition|vol\.?|presents?)\b|\d/i;

export function parsePromoterTitle(rawTitle, { knownArtistNames = [], housePromoters = [] } = {}) {
  const known = knownArtistNames instanceof Set
    ? knownArtistNames
    : new Set([...knownArtistNames].map(normalizeArtistName).filter(Boolean));
  const house = new Set(housePromoters.map(normalizeArtistName).filter(Boolean));
  const title = String(rawTitle ?? '').replace(/\s+/g, ' ').trim();
  const notes = [...title.matchAll(/[([]([^)\]]*)[)\]]/g)].map((match) => match[1].trim()).filter(Boolean);
  const text = title.replace(/\s*[([][^)\]]*[)\]]/g, ' ').replace(/\s+/g, ' ').trim();
  const isKnown = (value) => known.has(normalizeArtistName(value));
  const anyKnown = (value) => splitNames(value, known).some(isKnown);

  let body = text;
  let eventName = null;
  let presenters = [];

  const presents = text.match(/^(.*?)\s*\bpresents?\b\s*:?\s*(.+)$/i);
  const colon = presents ? null : text.match(/^([^:]+):\s*(.+)$/);
  if (presents) {
    const [, left, right] = presents;
    const leftNames = splitNames(left, known);
    const houseLed = !left.trim() || leftNames.some((name) => house.has(normalizeArtistName(name)));
    if (houseLed || (anyKnown(right) && !anyKnown(left))) {
      // "Framework presents X", "A & Framework present: X", "Label presents Artist".
      presenters = leftNames;
      body = right;
    } else {
      // "Afrojack Presents: CONTROL" — the host is the act; the rest names the night.
      body = left;
      eventName = right.trim() || null;
    }
  } else if (colon) {
    const [, prefix, rest] = colon;
    if (anyKnown(rest)) [body, eventName] = [rest, prefix.trim()];
    else if (anyKnown(prefix)) [body, eventName] = [prefix, rest.trim()];
    else if (DESCRIPTOR.test(rest) && (!DESCRIPTOR.test(prefix) || /\d|anniversary/i.test(rest))) [body, eventName] = [prefix, rest.trim()];
    else [body, eventName] = [rest, prefix.trim()];
  }

  // A pass or ticket bundle is a product, not a performance: it has no lineup.
  if (/\b(?:passes|pass|ticket\s+bundle|bundle)\b/i.test(text) && !anyKnown(body)) {
    return { performers: [], presenters: presenters.map((name) => name.trim()).filter(Boolean), eventName: text, notes };
  }
  const names = [];
  const seen = new Set();
  for (const part of splitNames(body, known)) {
    const name = stripDecorations(part, known);
    const key = normalizeArtistName(name);
    if (!key || PLACEHOLDER.test(name) || seen.has(key)) continue;
    seen.add(key);
    names.push(name);
  }
  return {
    performers: names.map((name, index) => ({ name, primary: index === 0, identityVerified: isKnown(name) })),
    presenters: presenters.map((name) => name.trim()).filter(Boolean),
    eventName,
    notes
  };
}

// Split a billing string into acts, keeping a known act whole even when its
// name contains a separator ("Above & Beyond", "Chase & Status").
function splitNames(value, known) {
  const text = String(value ?? '').trim();
  if (!text) return [];
  if (known.has(normalizeArtistName(text))) return [text];
  const parts = text.split(SEPARATOR).map((part) => part.trim()).filter(Boolean);
  const merged = [];
  for (let index = 0; index < parts.length; index += 1) {
    const joined = index + 1 < parts.length ? `${parts[index]} & ${parts[index + 1]}` : null;
    if (joined && known.has(normalizeArtistName(joined))) {
      merged.push(joined);
      index += 1;
    } else {
      merged.push(parts[index]);
    }
  }
  return merged;
}

function stripDecorations(value, known) {
  let name = String(value ?? '').replace(/^['"“”‘’]+|['"“”‘’]+$/g, '').trim();
  while (!known.has(normalizeArtistName(name)) && TRAILING_DECORATION.test(name)) {
    name = name.replace(TRAILING_DECORATION, '').trim();
  }
  return name;
}
