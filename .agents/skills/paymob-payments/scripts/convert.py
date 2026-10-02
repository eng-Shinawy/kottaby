#!/usr/bin/env python3
"""Convert Theneo page JSONs (Paymob docs) into a markdown mirror."""
import json, os, re, sys
from bs4 import BeautifulSoup, NavigableString
import html2text

SRC = "/tmp/paymob_pages"
OUT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/paymob_pages/md"
BASE_URL = "https://developers.paymob.com/paymob-docs"

h2t = html2text.HTML2Text()
h2t.body_width = 0
h2t.ignore_images = False
h2t.ignore_emphasis = False
h2t.mark_code = False
h2t.ul_item_mark = "-"

CODE_PLACEHOLDER = "XXCODEBLOCKXX{}XX"


def extract_code_blocks(soup):
    """Replace <pre> slate code blocks with placeholders; return fenced blocks."""
    blocks = []
    for pre in soup.find_all("pre"):
        for ta in pre.find_all("textarea"):
            ta.decompose()
        code = pre.find("code")
        lang = ""
        if code and code.get("class"):
            for c in code["class"]:
                if c.startswith("language-"):
                    lang = c[len("language-"):]
                    break
        line_divs = [
            d for d in pre.find_all("div", class_="slate-code_line")
            if not (d.parent and d.parent.name == "div"
                    and "slate-code_line" in (d.parent.get("class") or []))
        ]
        lines = [d.get_text() for d in line_divs]
        text = "\n".join(lines) if lines else pre.get_text("\n")
        fenced = f"```{lang}\n{text.rstrip()}\n```"
        idx = len(blocks)
        blocks.append(fenced)
        pre.replace_with(NavigableString(f"\n\n{CODE_PLACEHOLDER.format(idx)}\n\n"))
    return blocks


def transform(soup):
    # drop invisible helpers and code-block header labels ("JSON" etc.)
    for sel in ["svg", "textarea", "style", "script"]:
        for t in soup.find_all(sel):
            t.decompose()
    for t in soup.find_all("div", class_="code-block-header"):
        t.decompose()
    # callouts -> blockquote with label
    for cw in soup.find_all("div", class_="callout-widget"):
        ctype = (cw.get("data-type") or "note").strip().capitalize()
        bq = soup.new_tag("blockquote")
        label = soup.new_tag("p")
        strong = soup.new_tag("strong")
        strong.string = f"{ctype}:"
        label.append(strong)
        bq.append(label)
        for child in list(cw.children):
            bq.append(child.extract())
        cw.replace_with(bq)
    # details/summary -> heading + content
    for det in soup.find_all("details"):
        summ = det.find("summary")
        if summ:
            h = soup.new_tag("h4")
            h.string = summ.get_text(" ", strip=True)
            summ.replace_with(h)
        det.unwrap()
    return soup


def html_to_md(html):
    if not html or not html.strip():
        return ""
    soup = BeautifulSoup(html, "html.parser")
    blocks = extract_code_blocks(soup)
    soup = transform(soup)
    md = h2t.handle(str(soup))
    # restore code fences
    for i, b in enumerate(blocks):
        md = md.replace(CODE_PLACEHOLDER.format(i), b)
    # absolute-ify internal links
    md = md.replace("](/paymob-docs", f"]({BASE_URL}")
    # collapse >2 blank lines
    md = re.sub(r"\n{3,}", "\n\n", md)
    return md.strip()


def render_param(p, depth=0):
    """Render one request/response param (recursive) as a bullet line."""
    ind = "  " * depth
    name = p.get("name") or ""
    vt = p.get("valueType") or ""
    req = " — **required**" if p.get("isRequired") else ""
    desc = (p.get("description") or "").strip().replace("\n", " ")
    desc = re.sub(r"</?(b|strong)>", "**", desc)
    desc = re.sub(r"</?(i|em)>", "_", desc)
    desc = re.sub(r"<br\s*/?>", " ", desc)
    desc = re.sub(r"</?[a-zA-Z][^>]*>", "", desc)
    val = p.get("value")
    bits = [f"{ind}- `{name}`"]
    if vt:
        bits.append(f"({vt})")
    line = " ".join(bits) + req
    if desc:
        line += f" — {desc}"
    if val not in (None, "", [], {}):
        sval = json.dumps(val, ensure_ascii=False) if not isinstance(val, str) else val
        if len(sval) > 120:
            sval = sval[:117] + "..."
        line += f" _(example: `{sval}`)_"
    out = [line]
    for child in (p.get("items") or []):
        out.append(render_param(child, depth + 1))
    for child in (p.get("complexItems") or []):
        out.append(render_param(child, depth + 1))
    return "\n".join(out)


def render_params_section(title, params):
    if not params:
        return ""
    lines = [f"### {title}", ""]
    for p in params:
        lines.append(render_param(p))
    lines.append("")
    return "\n".join(lines)


def render_api(isd):
    """Render endpoint/request/response structured data."""
    out = []
    ep = isd.get("endpoints") or {}
    method = (ep.get("method") or "").upper().strip()
    path = (ep.get("path") or "").strip()
    if path:  # method without a path is editor noise on non-API pages
        out.append(f"## Endpoint\n\n`{method} {path}`\n")
    req = isd.get("request") or {}
    if isinstance(req, dict):
        ct = req.get("contentType")
        if ct and (req.get("body") or req.get("header")):
            out.append(f"**Content-Type:** `{ct}`\n")
        out.append(render_params_section("Request headers", req.get("header")))
        out.append(render_params_section("Path parameters", req.get("path")))
        out.append(render_params_section("Query parameters", req.get("query")))
        out.append(render_params_section("Request body", req.get("body")))
        ces = req.get("codeExamples") or []
        if ces:
            out.append("### Code examples\n")
            for ce in ces:
                lang = ce.get("language") or ce.get("lang") or ""
                code = ce.get("code") or ce.get("value") or ""
                if code:
                    out.append(f"```{lang}\n{code.rstrip()}\n```\n")
    for resp in (isd.get("responses") or []):
        sc = resp.get("statusCode") or ""
        rdesc = (resp.get("description") or "").strip()
        hdr = f"### Response {sc}".rstrip()
        if rdesc:
            hdr += f" — {rdesc}"
        body = resp.get("body") or []
        lines = [hdr, ""]
        for p in body:
            lines.append(render_param(p))
        lines.append("")
        out.append("\n".join(lines))
    scs = isd.get("statusCodes") or []
    if scs:
        out.append("### Status codes\n")
        for s in scs:
            if isinstance(s, dict):
                out.append(f"- `{s.get('code','')}` — {s.get('description','')}")
            else:
                out.append(f"- {s}")
        out.append("")
    ecs = isd.get("errorCodes") or []
    if ecs:
        out.append("### Error codes\n")
        for e in ecs:
            if isinstance(e, dict):
                out.append(f"- `{e.get('code','')}` — {e.get('description','')}")
            else:
                out.append(f"- {e}")
        out.append("")
    return "\n".join(x for x in out if x)


def main():
    inv = json.load(open(f"{SRC}/inventory.json"))
    os.makedirs(OUT, exist_ok=True)
    report = {"written": 0, "empty": [], "missing_raw": [], "slug_mismatch": []}
    index_rows = []
    for page in inv:
        path, name, tab = page["path"], page["name"], page["tab"]
        crumbs = page["crumbs"]
        fn = path.replace("/", "__")
        raw_path = f"{SRC}/raw/{fn}.json"
        if not os.path.exists(raw_path):
            report["missing_raw"].append(path)
            continue
        d = json.load(open(raw_path))
        isd = (d.get("pageProps") or {}).get("initialSectionData") or {}
        expected = path.split("/")[-1]
        got = isd.get("slug") or ""
        if got != expected:
            report["slug_mismatch"].append((path, got))
        desc_md = html_to_md(isd.get("description") or "")
        api_md = render_api(isd)
        seo_desc = (isd.get("seoDescription") or "").strip()
        body_parts = []
        if desc_md:
            body_parts.append(desc_md)
        if api_md:
            body_parts.append(api_md)
        if not body_parts:
            report["empty"].append(path)
            body_parts.append("_This page is a section landing/stub with no standalone content. See its child pages._")
        title = name or expected.replace("-", " ").title()
        fm = [
            "---",
            f'title: "{title}"',
            f"url: {BASE_URL}/{path}",
            f"tab: {tab}",
            f'breadcrumbs: "{" > ".join(crumbs)}"',
            "---",
            "",
            f"# {title}",
            "",
        ]
        content = "\n".join(fm) + "\n\n".join(body_parts) + "\n"
        out_file = os.path.join(OUT, path + ".md")
        os.makedirs(os.path.dirname(out_file) or OUT, exist_ok=True)
        open(out_file, "w", encoding="utf-8").write(content)
        report["written"] += 1
        ep = isd.get("endpoints") or {}
        method = (ep.get("method") or "").upper()
        index_rows.append({
            "path": path, "title": title, "tab": tab,
            "depth": len(crumbs) - 1,
            "method": method, "endpoint": ep.get("path") or "",
            "empty": path in report["empty"],
        })
    # INDEX.md
    lines = [
        "# Paymob docs mirror — index",
        "",
        f"Mirrored from {BASE_URL} (Theneo). {report['written']} pages.",
        "Each entry links to the local markdown file. API pages show METHOD endpoint.",
        "",
    ]
    for tab_slug, tab_title in (("documentation", "Documentation tab"), ("developers", "Developers tab (API reference)")):
        lines.append(f"## {tab_title}")
        lines.append("")
        for r in index_rows:
            if r["tab"] != tab_slug:
                continue
            ind = "  " * r["depth"]
            extra = f" — `{r['method']} {r['endpoint']}`" if r["method"] or r["endpoint"] else ""
            stub = " _(stub)_" if r["empty"] else ""
            lines.append(f"{ind}- [{r['title']}]({r['path']}.md){extra}{stub}")
        lines.append("")
    open(os.path.join(OUT, "INDEX.md"), "w").write("\n".join(lines))
    print(json.dumps({k: (v if k == "written" else v) for k, v in report.items()}, indent=1, ensure_ascii=False))


if __name__ == "__main__":
    main()
