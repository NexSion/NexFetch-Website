// Decodes the `?data=` query param the extension builds via its own
// `ue()` helper in core.js: btoa(UTF-8 bytes of JSON.stringify(obj)).
// Used by /video/stream, /video/cast, /video/download — none of them
// are dynamic [id] routes; the extension embeds the whole payload in
// this one param instead of asking the page to look anything up.
export function decodeDataParam<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    const binary = atob(raw);
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    const json = new TextDecoder().decode(bytes);
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}
