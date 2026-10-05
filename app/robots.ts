import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api", "/profile", "/members", "/mfa"] },
    sitemap: "https://www.popperscraft.org/sitemap.xml",
  };
}
