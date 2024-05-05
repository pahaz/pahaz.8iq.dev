import type { Site, SocialObjects } from "./types";

export const SITE: Site = {
  website: "https://pahaz.8iq.dev/",
  author: "Pahaz White",
  desc: "Pahaz technical blog",
  title: "Pahaz",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerPage: 3,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
};

export const LOCALE = {
  lang: "en", // html lang code. Set this empty and default will be "en"
  langTag: ["en-EN"], // BCP 47 Language Tags. Set this empty [] to use the environment default
} as const;

export const LOGO_IMAGE = {
  enable: false,
  svg: true,
  width: 216,
  height: 46,
};

export const SOCIALS: SocialObjects = [
  {
    name: "Github",
    href: "https://github.com/pahaz",
    linkTitle: ` ${SITE.title} on Github`,
    active: true,
  },
  {
    name: "Facebook",
    href: "https://fb.com/pahazx",
    linkTitle: `${SITE.title} on Facebook`,
    active: true,
  },
  {
    name: "Mail",
    href: "mailto:pahaz@8iq.dev",
    linkTitle: `Send an email to ${SITE.title}`,
    active: true,
  },
  {
    name: "Telegram",
    href: "https://t.me/pahaz",
    linkTitle: `${SITE.title} on Telegram`,
    active: true,
  },
];
