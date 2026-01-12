import type { APIRoute } from "astro";
import { getCollection, type CollectionEntry } from "astro:content";
import { getPath } from "@/utils/getPath";
import { generateOgImageForPost } from "@/utils/generateOgImages";
import { SITE } from "@/config";

export async function getStaticPaths() {
  if (!SITE.dynamicOgImage) {
    return [];
  }

  const posts = (await getCollection("blog")).filter(({ data }) => !data.draft);

  return posts.map(post => {
    const p = getPath(post.id, post.filePath, false);
    return {
      params: { page: p },
      props: post,
    };
  });
}

export const GET: APIRoute = async ({ props, params }) => {
  if (!SITE.dynamicOgImage) return new Response(null, { status: 404 });

  let post = props as CollectionEntry<"blog"> | undefined;

  if (!post) {
    const posts = (await getCollection("blog")).filter(
      ({ data }) => !data.draft
    );
    const slug = Array.isArray(params.page)
      ? params.page.join("/")
      : params.page;
    post = posts.find(p => getPath(p.id, p.filePath, false) === slug);
    if (!post) return new Response(null, { status: 404 });
  }

  const buffer = await generateOgImageForPost(post);
  return new Response(new Uint8Array(buffer), {
    headers: { "Content-Type": "image/png" },
  });
};
