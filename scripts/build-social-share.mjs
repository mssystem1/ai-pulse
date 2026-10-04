import { readFile, mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname, basename } from "node:path";

// X can retain a page's card after its image URL has changed. Give each image
// version its own crawlable page, with its own OG/X URL and the site's canonical.
export function socialSharePage(html) {
  const image = html.match(/<meta\s+property="og:image"\s+content="([^"]+)"\s*\/>/)?.[1];
  if (!image) throw new Error("Missing Open Graph image in the built homepage");
  const imageUrl = new URL(image);
  const version = basename(imageUrl.pathname, ".png").replace(/^og-image-/, "");
  if (!/^v\d+$/.test(version)) throw new Error("The social image must have a versioned PNG filename");
  const url = new URL(`/share/${version}`, imageUrl.origin).href;
  let page = html;
  for (const tag of ['property="og:url"', 'name="twitter:url"']) {
    const pattern = new RegExp(`(<meta\\s+${tag}\\s+content=")[^"]*("\\s*\\/>)`);
    if (!pattern.test(page)) throw new Error(`Missing ${tag} in the built homepage`);
    page = page.replace(pattern, `$1${url}$2`);
  }
  // The compiled application opens the normal homepage. Crawlers receive this
  // page's static metadata without needing to execute any JavaScript.
  page = page.replace("</head>", '<script>history.replaceState(history.state, "", "/" + location.search + location.hash);</script>\n  </head>');
  return { fileName: `share/${version}.html`, url, html: page };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const dist = resolve(dirname(fileURLToPath(import.meta.url)), "../apps/web/dist");
  const page = socialSharePage(await readFile(resolve(dist, "index.html"), "utf8"));
  // Keep the main-link crawler redirect on the image version emitted by this
  // build. Otherwise a later image update could send X to a missing share page.
  for (const configUrl of [new URL("../vercel.json", import.meta.url), new URL("../apps/web/vercel.json", import.meta.url)]) {
    const config = JSON.parse(await readFile(configUrl, "utf8"));
    const redirect = config.redirects?.find(rule => rule.source === "/" && rule.has?.some(condition => condition.type === "header" && condition.key === "user-agent" && typeof condition.value === "string" && condition.value.includes("witterbot")));
    if (redirect?.destination !== new URL(page.url).pathname || redirect.permanent !== false) {
      throw new Error(`Update the Twitterbot homepage redirect in ${fileURLToPath(configUrl)} to ${new URL(page.url).pathname}`);
    }
  }
  await mkdir(resolve(dist, "share"), { recursive: true });
  await writeFile(resolve(dist, page.fileName), page.html, "utf8");
  console.log(`Social sharing URL: ${page.url}`);
}
