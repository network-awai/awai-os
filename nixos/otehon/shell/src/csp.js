// CSP script/style sources for the shell pages. The OS image loads the
// shell over file://, so the default stays "file:". The "http" mode is for
// the loopback preview server (serve.mjs) only and must never ship in the
// image; it follows the link page, which already uses 'self'.
export function scriptSrc(mode) {
  return mode === "http" ? "script-src 'self'" : "script-src file:";
}

export function styleSrc(mode) {
  return mode === "http" ? "style-src 'self'" : "style-src file:";
}
