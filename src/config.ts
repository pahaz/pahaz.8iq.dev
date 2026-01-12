export const SITE = {
  website: "https://pahaz.8iq.dev/", // replace this with your deployed domain
  author: "Pahaz White",
  profile: "https://pahaz.8iq.dev/",
  desc: "Pahaz technical blog",
  title: "PahazBlog",
  ogImage: "astropaper-og.jpg",
  lightAndDarkMode: true,
  postPerIndex: 4,
  postPerPage: 4,
  scheduledPostMargin: 15 * 60 * 1000, // 15 minutes
  showArchives: true,
  showBackButton: true, // show back button in post detail
  editPost: {
    enabled: true,
    text: "Edit page",
    url: "https://github.com/pahaz/pahaz.8iq.dev/edit/main/",
  },
  dynamicOgImage: true,
  dir: "ltr", // "rtl" | "auto"
  lang: "en", // html lang code. Set this empty and default will be "en"
  timezone: "Asia/Bangkok", // Default global timezone (IANA format) https://en.wikipedia.org/wiki/List_of_tz_database_time_zones
} as const;

export const LOGO_IMAGE = {
  enable: true,
  src: "/favicon.svg",
  height: 30,
} as const;
