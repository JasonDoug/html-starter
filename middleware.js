import { next } from "@vercel/edge";

export default function middleware(req) {
  const url = new URL(req.url);

  // COOP/COEP required for FFmpeg.wasm SharedArrayBuffer — only on main page
  // CDN resources (icons, scripts) must NOT have COEP or they get blocked
  if (url.pathname === "/" || url.pathname === "/index.html") {
    return next({
      headers: {
        "Cross-Origin-Opener-Policy": "same-origin",
        "Cross-Origin-Embedder-Policy": "credentialless",
        "Referrer-Policy": "origin-when-cross-origin",
        "X-Content-Type-Options": "nosniff",
        "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
      },
    });
  }

  return next({
    headers: {
      "Referrer-Policy": "origin-when-cross-origin",
      "X-Content-Type-Options": "nosniff",
      "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    },
  });
}
