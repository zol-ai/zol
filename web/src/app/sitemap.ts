import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/*
  The landing page and the About page. The waitlist page is deliberately not
  here — it is reachable by link but not something to be found; see
  `waitlistPath` in lib/site.ts. Sign-in, sign-up, the app and the portal
  are noindex and stay out too.
*/
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    {
      url: site.url,
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
    {
      url: `${site.url}${site.aboutPath}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
  ];
}
