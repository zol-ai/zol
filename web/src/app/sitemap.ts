import type { MetadataRoute } from "next";
import { site } from "@/lib/site";

/*
  The landing page, the waitlist, the About page and the two legal pages. Sign-in, sign-up, the
  app and the portal are noindex and stay out.
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
      url: `${site.url}${site.waitlistPath}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${site.url}${site.aboutPath}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${site.url}${site.privacyPath}`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${site.url}${site.smsTermsPath}`,
      lastModified: now,
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];
}
