/**
 * Pin `ws` to its pure-JS frame masker. Import this BEFORE `ws`.
 *
 * RFC 6455 requires client→server frames be masked, and `ws` picks its masker
 * once at load time: it `require`s the optional native `bufferutil` addon and
 * falls back to JS only when that require *throws*. Bundlers break the fallback
 * — webpack rewrites the unresolvable require into an ignored-module stub that
 * returns `{}`, so `ws` believes the addon exists and calls `bufferUtil.mask`
 * (undefined) for every frame ≥48 bytes. Small frames still work, so the socket
 * looks healthy while real payloads never leave the process.
 *
 * `WS_NO_BUFFER_UTIL` makes `ws` skip that require entirely, so masking cannot
 * depend on how the server was bundled. Cost is the native fast path on large
 * frames, which we don't have installed anyway; set the variable explicitly to
 * an empty string to opt back in.
 */
process.env.WS_NO_BUFFER_UTIL ??= "1";
