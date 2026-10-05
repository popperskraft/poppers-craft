import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Не сообщаем наружу, на чём собран сайт. */
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
  /* Описания для подключения нейросетей (lib/ai-connect): ChatGPT и Claude
     ищут их по стандартным адресам /.well-known/… */
  async rewrites() {
    return [
      { source: "/.well-known/oauth-protected-resource", destination: "/api/ai/protected-resource" },
      { source: "/.well-known/oauth-protected-resource/:path*", destination: "/api/ai/protected-resource" },
      { source: "/.well-known/oauth-authorization-server", destination: "/api/ai/authorization-server" },
      { source: "/.well-known/oauth-authorization-server/:path*", destination: "/api/ai/authorization-server" },
    ];
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
      ],
    }, {
      /* Шрифт подгружают письма (lib/mail.ts), а почтовые программы берут
         чужие шрифты только с разрешением CORS. */
      source: "/Monocraft.ttf",
      headers: [{ key: "Access-Control-Allow-Origin", value: "*" }],
    }];
  },
};

export default nextConfig;
