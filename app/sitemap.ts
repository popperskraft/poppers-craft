import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: "https://www.popperscraft.org/", changeFrequency: "weekly", priority: 1 },
    { url: "https://www.popperscraft.org/wiki", changeFrequency: "weekly", priority: 0.7 },
    { url: "https://www.popperscraft.org/wiki/metro", changeFrequency: "weekly", priority: 0.7 },
    { url: "https://www.popperscraft.org/wiki/mods", changeFrequency: "weekly", priority: 0.6 },
    { url: "https://www.popperscraft.org/rules", changeFrequency: "monthly", priority: 0.5 },
    { url: "https://www.popperscraft.org/launcher", changeFrequency: "monthly", priority: 0.6 },
    { url: "https://www.popperscraft.org/cookies", changeFrequency: "monthly", priority: 0.4 },
  ];
}
