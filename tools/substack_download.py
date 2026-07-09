#!/usr/bin/env python3
"""Download the full post history of one or more Substack publications.

Uses Substack's public JSON API (the same one the website itself uses):

  1. GET {publication}/api/v1/archive?sort=new&offset=N&limit=50
     - paginates through every post's metadata
  2. GET {publication}/api/v1/posts/{slug}
     - returns the full post, including body_html

Free posts need no authentication. For paywalled posts you must pass your
subscriber session cookie (see --cookie / --cookie-file and tools/README.md).

Output: one folder per publication containing each post as Markdown (with a
YAML front-matter header) and/or the original HTML, plus an index.json of all
archive metadata. Already-downloaded posts are skipped, so re-running only
fetches new posts.

No third-party dependencies — Python 3.8+ standard library only.

Examples:
  python3 substack_download.py https://someauthor.substack.com
  python3 substack_download.py someauthor.substack.com https://www.custom-domain.com \
      --cookie-file cookies.txt --format both --images --out ~/substack-archive
"""

import argparse
import html
import html.parser
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ARCHIVE_PAGE_SIZE = 50
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/125.0 Safari/537.36"
)


# --------------------------------------------------------------------------
# HTTP helpers
# --------------------------------------------------------------------------

def http_get(url, cookie=None, retries=4, timeout=30, binary=False):
    """GET a URL with retries and backoff. Returns bytes if binary else str."""
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if cookie:
        headers["Cookie"] = cookie
    delay = 2
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = resp.read()
                return data if binary else data.decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            # 429 = rate limited, 5xx = transient; anything else is permanent.
            if e.code == 429 or e.code >= 500:
                last_err = e
            else:
                raise
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last_err = e
        if attempt < retries:
            time.sleep(delay)
            delay *= 2
    raise last_err


def get_json(url, cookie=None):
    return json.loads(http_get(url, cookie=cookie))


# --------------------------------------------------------------------------
# HTML -> Markdown
# --------------------------------------------------------------------------

class MarkdownConverter(html.parser.HTMLParser):
    """Converts Substack post HTML to Markdown.

    Substack bodies are regular HTML: headings, paragraphs, lists,
    blockquotes, images inside figure/captioned-image-container divs,
    code blocks, embeds. Unknown tags degrade to their text content.
    """

    BLOCK_TAGS = {"p", "div", "figure", "section", "article", "footer", "header"}
    SKIP_TAGS = {"script", "style", "head", "title", "svg", "button", "form"}

    def __init__(self, image_handler=None):
        super().__init__(convert_charrefs=True)
        self.out = []
        self.image_handler = image_handler  # optional fn(src) -> local path
        self.list_stack = []            # "ul" / "ol" with item counters
        self.href = None
        self.link_text = []
        self.in_pre = False
        self.in_code = False
        self.blockquote_depth = 0
        self.skip_depth = 0
        self.pending_ordinal = None

    # -- output helpers ----------------------------------------------------

    def _write(self, text):
        if self.href is not None:
            self.link_text.append(text)
        else:
            self.out.append(text)

    def _block_break(self):
        """Ensure the output ends with a blank line (paragraph separator)."""
        joined = "".join(self.out)
        if joined and not joined.endswith("\n\n"):
            self.out.append("\n" if joined.endswith("\n") else "\n\n")

    def _prefix(self):
        prefix = "> " * self.blockquote_depth
        if self.list_stack:
            prefix += "    " * (len(self.list_stack) - 1)
        return prefix

    # -- parser events -----------------------------------------------------

    def handle_starttag(self, tag, attrs):
        if self.skip_depth or tag in self.SKIP_TAGS:
            if tag in self.SKIP_TAGS:
                self.skip_depth += 1
            return
        a = dict(attrs)
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._block_break()
            self._write(self._prefix() + "#" * int(tag[1]) + " ")
        elif tag in ("strong", "b"):
            self._write("**")
        elif tag in ("em", "i"):
            self._write("*")
        elif tag in ("s", "del", "strike"):
            self._write("~~")
        elif tag == "a":
            self.href = a.get("href", "")
            self.link_text = []
        elif tag == "img":
            src = a.get("src") or ""
            if src:
                if self.image_handler:
                    src = self.image_handler(src)
                alt = (a.get("alt") or "").replace("]", ")")
                self._write("![{}]({})".format(alt, src))
        elif tag == "br":
            self._write("\n" + self._prefix())
        elif tag == "hr":
            self._block_break()
            self._write("---")
            self._block_break()
        elif tag == "blockquote":
            self._block_break()
            self.blockquote_depth += 1
        elif tag in ("ul", "ol"):
            if not self.list_stack:
                self._block_break()
            else:
                self._write("\n")
            self.list_stack.append({"tag": tag, "n": 0})
        elif tag == "li":
            if self.list_stack:
                item = self.list_stack[-1]
                item["n"] += 1
                joined = "".join(self.out)
                if joined and not joined.endswith("\n"):
                    self.out.append("\n")
                bullet = "-" if item["tag"] == "ul" else "{}.".format(item["n"])
                self._write("{}{} ".format(self._prefix(), bullet))
        elif tag == "pre":
            self._block_break()
            self._write("```\n")
            self.in_pre = True
        elif tag == "code":
            if not self.in_pre:
                self._write("`")
                self.in_code = True
        elif tag == "figcaption":
            self._block_break()
            self._write("*")
        elif tag == "iframe":
            src = a.get("src") or ""
            if src:
                self._block_break()
                self._write("[Embedded content]({})".format(src))
                self._block_break()
        elif tag in self.BLOCK_TAGS:
            self._block_break()
            if self._prefix() and (not self.out or self.out[-1].endswith("\n")):
                self._write(self._prefix())

    def handle_endtag(self, tag):
        if tag in self.SKIP_TAGS:
            self.skip_depth = max(0, self.skip_depth - 1)
            return
        if self.skip_depth:
            return
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            self._block_break()
        elif tag in ("strong", "b"):
            self._write("**")
        elif tag in ("em", "i"):
            self._write("*")
        elif tag in ("s", "del", "strike"):
            self._write("~~")
        elif tag == "a":
            text = "".join(self.link_text).strip() or self.href or ""
            href = self.href or ""
            self.href = None
            self.link_text = []
            if href and href != text:
                self._write("[{}]({})".format(text, href))
            else:
                self._write(text)
        elif tag == "blockquote":
            self.blockquote_depth = max(0, self.blockquote_depth - 1)
            self._block_break()
        elif tag in ("ul", "ol"):
            if self.list_stack:
                self.list_stack.pop()
            if not self.list_stack:
                self._block_break()
        elif tag == "pre":
            self.in_pre = False
            joined = "".join(self.out)
            if not joined.endswith("\n"):
                self._write("\n")
            self._write("```")
            self._block_break()
        elif tag == "code":
            if self.in_code:
                self._write("`")
                self.in_code = False
        elif tag == "figcaption":
            self._write("*")
            self._block_break()
        elif tag in self.BLOCK_TAGS:
            self._block_break()

    def handle_data(self, data):
        if self.skip_depth:
            return
        if self.in_pre:
            self._write(data)
            return
        text = re.sub(r"\s+", " ", data)
        if text.strip():
            joined = "".join(self.link_text if self.href is not None else self.out)
            if joined.endswith("\n") or not joined:
                text = text.lstrip()
                if self.href is None:
                    text = self._prefix() + text
            self._write(text)

    def result(self):
        text = "".join(self.out)
        text = re.sub(r"[ \t]+\n", "\n", text)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip() + "\n"


def html_to_markdown(body_html, image_handler=None):
    conv = MarkdownConverter(image_handler=image_handler)
    conv.feed(body_html)
    return conv.result()


# --------------------------------------------------------------------------
# Substack download logic
# --------------------------------------------------------------------------

def normalize_base_url(pub):
    """'author.substack.com' or a full URL -> 'https://author.substack.com'."""
    pub = pub.strip().rstrip("/")
    if not re.match(r"^https?://", pub):
        pub = "https://" + pub
    parsed = urllib.parse.urlparse(pub)
    return "{}://{}".format(parsed.scheme, parsed.netloc)


def fetch_archive(base_url, cookie=None, delay=0.5):
    """Yield metadata for every post, newest first."""
    offset = 0
    while True:
        url = "{}/api/v1/archive?sort=new&search=&offset={}&limit={}".format(
            base_url, offset, ARCHIVE_PAGE_SIZE
        )
        posts = get_json(url, cookie=cookie)
        if not posts:
            return
        for post in posts:
            yield post
        offset += len(posts)
        time.sleep(delay)


def safe_filename(text, max_len=80):
    text = re.sub(r"[^\w\-]+", "-", text, flags=re.UNICODE).strip("-")
    return text[:max_len] or "post"


def front_matter(post):
    """YAML front matter from archive/post metadata."""
    def q(value):
        return '"{}"'.format(str(value).replace("\\", "\\\\").replace('"', '\\"'))

    lines = ["---"]
    lines.append("title: {}".format(q(post.get("title") or "")))
    if post.get("subtitle"):
        lines.append("subtitle: {}".format(q(post["subtitle"])))
    if post.get("post_date"):
        lines.append("date: {}".format(q(post["post_date"])))
    authors = [b.get("name") for b in post.get("publishedBylines") or [] if b.get("name")]
    if authors:
        lines.append("authors: [{}]".format(", ".join(q(a) for a in authors)))
    if post.get("canonical_url"):
        lines.append("url: {}".format(q(post["canonical_url"])))
    if post.get("type"):
        lines.append("type: {}".format(q(post["type"])))
    lines.append("paywalled: {}".format(
        "true" if post.get("audience") not in (None, "everyone") else "false"
    ))
    if post.get("podcast_url"):
        lines.append("audio: {}".format(q(post["podcast_url"])))
    lines.append("---")
    return "\n".join(lines)


def make_image_handler(images_dir, base_url, cookie, stats):
    """Returns fn(src) -> local relative path, downloading each image once."""
    seen = {}

    def handler(src):
        if src in seen:
            return seen[src]
        name = os.path.basename(urllib.parse.urlparse(src).path)
        name = urllib.parse.unquote(name)
        name = safe_filename(os.path.splitext(name)[0]) + os.path.splitext(name)[1]
        if not name or name.startswith("."):
            name = "image-{}.jpg".format(len(seen) + 1)
        # de-duplicate names across posts
        target = os.path.join(images_dir, name)
        n = 1
        while os.path.exists(target) and target not in seen.values():
            root, ext = os.path.splitext(name)
            target = os.path.join(images_dir, "{}-{}{}".format(root, n, ext))
            n += 1
        rel = os.path.join("images", os.path.basename(target))
        if not os.path.exists(target):
            try:
                data = http_get(src, cookie=None, binary=True)
                os.makedirs(images_dir, exist_ok=True)
                with open(target, "wb") as f:
                    f.write(data)
                stats["images"] += 1
            except Exception as e:
                print("      ! image failed: {} ({})".format(src, e))
                return src
        seen[src] = rel
        return rel

    return handler


def download_publication(base_url, out_root, cookie, fmt, want_images, delay, force):
    host = urllib.parse.urlparse(base_url).netloc
    pub_dir = os.path.join(out_root, safe_filename(host))
    os.makedirs(pub_dir, exist_ok=True)
    print("\n== {} -> {}".format(base_url, pub_dir))

    print("   Listing archive...")
    archive = list(fetch_archive(base_url, cookie=cookie, delay=delay))
    print("   {} posts found".format(len(archive)))
    with open(os.path.join(pub_dir, "index.json"), "w", encoding="utf-8") as f:
        json.dump(archive, f, ensure_ascii=False, indent=1)

    stats = {"new": 0, "skipped": 0, "locked": 0, "failed": 0, "images": 0}
    total = len(archive)
    for i, meta in enumerate(archive):
        # number posts oldest -> newest so filenames sort chronologically
        num = total - i
        slug = meta.get("slug") or str(meta.get("id"))
        date = (meta.get("post_date") or "")[:10]
        stem = "{:04d}_{}_{}".format(num, date, safe_filename(slug))
        md_path = os.path.join(pub_dir, stem + ".md")
        html_path = os.path.join(pub_dir, stem + ".html")

        need_md = fmt in ("md", "both") and (force or not os.path.exists(md_path))
        need_html = fmt in ("html", "both") and (force or not os.path.exists(html_path))
        if not need_md and not need_html:
            stats["skipped"] += 1
            continue

        try:
            post = get_json(
                "{}/api/v1/posts/{}".format(base_url, urllib.parse.quote(slug)),
                cookie=cookie,
            )
        except Exception as e:
            print("   [{}/{}] FAILED {} ({})".format(i + 1, total, slug, e))
            stats["failed"] += 1
            continue

        body = post.get("body_html")
        if not body:
            print("   [{}/{}] LOCKED {} (paywalled - need a valid cookie)".format(
                i + 1, total, slug))
            stats["locked"] += 1
            time.sleep(delay)
            continue

        title = post.get("title") or slug
        print("   [{}/{}] {}".format(i + 1, total, title))

        image_handler = None
        if want_images:
            image_handler = make_image_handler(
                os.path.join(pub_dir, "images"), base_url, cookie, stats)

        if need_html:
            doc = (
                "<!doctype html>\n<html><head><meta charset=\"utf-8\">"
                "<title>{}</title></head>\n<body>\n<h1>{}</h1>\n{}\n</body></html>\n"
            ).format(html.escape(title), html.escape(title), body)
            with open(html_path, "w", encoding="utf-8") as f:
                f.write(doc)

        if need_md:
            md = html_to_markdown(body, image_handler=image_handler)
            parts = [front_matter(post), "", "# " + title, ""]
            if post.get("subtitle"):
                parts += ["*" + post["subtitle"] + "*", ""]
            parts.append(md)
            with open(md_path, "w", encoding="utf-8") as f:
                f.write("\n".join(parts))

        stats["new"] += 1
        time.sleep(delay)

    print("   done: {new} downloaded, {skipped} already saved, "
          "{locked} locked, {failed} failed, {images} images".format(**stats))
    return stats


def main(argv=None):
    ap = argparse.ArgumentParser(
        description="Download the full post history of Substack publications.",
        epilog="Paywalled posts require your subscriber cookie; "
               "see tools/README.md for how to copy it from your browser.",
    )
    ap.add_argument("publications", nargs="+",
                    help="Publication URLs or hostnames "
                         "(author.substack.com or a custom domain)")
    ap.add_argument("--out", default="substack-archive",
                    help="Output directory (default: ./substack-archive)")
    ap.add_argument("--format", choices=("md", "html", "both"), default="md",
                    help="Save as Markdown, original HTML, or both (default: md)")
    ap.add_argument("--images", action="store_true",
                    help="Download images locally and rewrite links")
    ap.add_argument("--cookie",
                    help='Cookie header for paywalled posts, e.g. "substack.sid=..."')
    ap.add_argument("--cookie-file",
                    help="File containing the cookie header (safer than --cookie)")
    ap.add_argument("--delay", type=float, default=0.5,
                    help="Seconds between requests (default: 0.5)")
    ap.add_argument("--force", action="store_true",
                    help="Re-download posts that already exist on disk")
    args = ap.parse_args(argv)

    cookie = args.cookie
    if args.cookie_file:
        with open(args.cookie_file, encoding="utf-8") as f:
            cookie = f.read().strip()

    totals = {"new": 0, "skipped": 0, "locked": 0, "failed": 0, "images": 0}
    for pub in args.publications:
        base = normalize_base_url(pub)
        try:
            stats = download_publication(
                base, args.out, cookie, args.format,
                args.images, args.delay, args.force)
        except Exception as e:
            print("   ERROR: could not download {}: {}".format(base, e))
            totals["failed"] += 1
            continue
        for k in totals:
            totals[k] += stats.get(k, 0)

    print("\nAll done: {new} new posts, {skipped} already saved, "
          "{locked} locked, {failed} failed, {images} images.".format(**totals))
    if totals["locked"]:
        print("Locked posts are paywalled. Pass your subscriber session cookie "
              "with --cookie or --cookie-file (see tools/README.md) and re-run; "
              "already-saved posts are skipped automatically.")
    return 1 if totals["failed"] and not totals["new"] else 0


if __name__ == "__main__":
    sys.exit(main())
