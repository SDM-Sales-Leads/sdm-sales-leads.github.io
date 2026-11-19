#!/usr/bin/env python3
"""Website knowledge base for Lara (no AI): crawls elsewedydevelopment.com (English + /ar/), keeps only the page content
(<main>, no header/footer/forms), and splits every page into a tree: branch > page > heading > sub-heading > passage.
Output: <out>/chunks.json (one row per passage, ~700 chars) for load.ts. Usage: python3 -I crawl.py <workdir>"""
import json, re, sys, os, time, html as H, urllib.request
from html.parser import HTMLParser
W = sys.argv[1] if len(sys.argv) > 1 else "site-kb-work"; os.makedirs(f"{W}/en", exist_ok=True); os.makedirs(f"{W}/ar", exist_ok=True)
UA = {"User-Agent": "Mozilla/5.0 (Macintosh) SDM-KB-crawler"}
BASE = "https://elsewedydevelopment.com"
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u, headers=UA), timeout=60) as r: return r.read().decode("utf-8", "ignore")
docs = []
for kind in ("pages", "posts"):
    p = 1
    while True:
        try: rows = json.loads(get(f"{BASE}/wp-json/wp/v2/{kind}?per_page=100&page={p}&_fields=id,link,title,date"))
        except Exception: break
        if not rows: break
        docs += [{"id": x["id"], "type": kind[:-1], "url": x["link"], "title": H.unescape(x["title"]["rendered"]), "date": x["date"]} for x in rows]; p += 1
SKIP = re.compile(r"thank-you|home-test|qr-code|privacy|ramadan-iftar|/news/$|/case-studies/$")
docs = [d for d in docs if not SKIP.search(d["url"])]
for d in docs:
    for lang in ("en", "ar"):
        f = f"{W}/{lang}/{d['id']}.html"
        if os.path.exists(f) and os.path.getsize(f) > 0: continue
        u = d["url"] if lang == "en" else d["url"].replace(f"{BASE}/", f"{BASE}/ar/", 1)
        try: open(f, "w").write(get(u))
        except Exception as e: print("skip", u, e)
        time.sleep(0.5)

class P(HTMLParser):
    BLOCK = ("p", "li", "br", "div", "tr", "td", "section")
    HIDE = ("script", "style", "noscript", "svg", "form", "select", "button", "nav")
    def __init__(s): super().__init__(convert_charrefs=True); s.out = []; s.skip = 0; s.h = None; s.buf = ""; s.inmain = 0
    def handle_starttag(s, t, a):
        a = dict(a)
        if t == "main" and a.get("id") == "lqd-site-content": s.inmain = 1
        if t in s.HIDE: s.skip += 1
        if t in ("h1", "h2", "h3", "h4", "h5", "h6"): s.flush(); s.h = int(t[1])
        if t in s.BLOCK: s.flush()
        if t == "li": s.buf += "• "
    def handle_endtag(s, t):
        if t == "main": s.flush(); s.inmain = 0
        if t in s.HIDE: s.skip = max(0, s.skip - 1)
        if t in ("h1", "h2", "h3", "h4", "h5", "h6") + s.BLOCK: s.flush()
    def handle_data(s, d):
        if s.inmain and not s.skip: s.buf += d
    def flush(s):
        t = re.sub(r"\s+", " ", s.buf.replace("\xa0", " ")).strip(); s.buf = ""
        if t and not re.fullmatch(r"[•\W\d]{0,3}", t): s.out.append((s.h or 0, t))
        s.h = None
PARK = [(r"industria-october", "Industria October"), (r"industria-new-sadat", "Industria New Sadat"), (r"industria-sadat", "Industria Sadat"), (r"borg-el-arab", "Industria Borg El Arab"),
        (r"sokhna-360|sokhna360", "Sokhna 360"), (r"industria-sokhna", "Industria Sokhna"), (r"industria-east", "Industria East"), (r"industria-west", "Industria West"),
        (r"industria-asher", "Industria Asher"), (r"al-oula", "Al Oula"), (r"elsewedy-industrial-city-eic|tanzania", "Elsewedy Industrial City (EIC)"), (r"october-dry-port", "October Dry Port")]
def branch(u, typ):
    if typ == "post": return "News"
    if "/opportunities/" in u or re.search(r"/industria-(east|west)/", u): return "Parks"
    if re.search(r"service-plans|technical-support|admin-buildings|start-in-industria|plan-your-visit|online-assistance|required-documents", u): return "Services & procedures"
    if re.search(r"about-sdm|contact-us", u): return "Company"
    if "case-stud" in u: return "Case studies"
    if re.search(r"why-invest|look-at-egypt|egypt-industrial-growth|tanzanian", u): return "Investing in Egypt"
    return "Other"
JUNK = re.compile(r"^(name|job title|company|country|email address|contact email|phone|inquiry|send|submit|get direction|احصل على الاتجاه|read more|اقرأ المزيد|learn more|virtual tour)\*?$", re.I)
def passages(body, n=700):
    """sentences grouped into passages of ~n chars (a long section becomes several rows; search returns only the one that matches)"""
    parts = re.split(r"(?<=[.!?؟؛])\s+|\s+(?=• )", body); out = []; cur = ""
    for s in parts:
        if cur and len(cur) + len(s) > n: out.append(cur.strip()); cur = ""
        cur += " " + s
    if cur.strip(): out.append(cur.strip())
    return out
rows = []
for d in docs:
    park = next((n for r, n in PARK if re.search(r, d["url"])), None)
    for lang in ("en", "ar"):
        try: s = open(f"{W}/{lang}/{d['id']}.html", encoding="utf-8", errors="ignore").read()
        except FileNotFoundError: continue
        p = P(); p.feed(s); p.flush()
        m = re.search(r"<title>(.*?)</title>", s, re.S); title = H.unescape(m.group(1)).split(" - ")[0].strip() if m else d["title"]
        url = d["url"] if lang == "en" else d["url"].replace(f"{BASE}/", f"{BASE}/ar/", 1)
        secs = []; cur = {"h": title, "lvl": 1, "txt": []}; seen = set()
        for lv, t in p.out:
            if JUNK.match(t) or t in seen: continue
            seen.add(t)
            if lv and len(t) < 140:
                if cur["txt"] or cur["h"] != title: secs.append(cur)
                cur = {"h": t, "lvl": lv, "txt": []}
            else: cur["txt"].append(t)
        secs.append(cur)
        stack = []
        for sc in secs:
            while stack and stack[-1]["lvl"] >= sc["lvl"]: stack.pop()
            sc["path"] = [x["h"] for x in stack]; stack.append(sc)
        for i, sc in enumerate(secs):
            body = " ".join(sc["txt"]).strip()
            if len(body) < 40: continue
            for j, ps in enumerate(passages(body)):
                rows.append({"lang": lang, "branch": branch(d["url"], d["type"]), "park": park, "page": title, "url": url, "section": sc["h"],
                             "path": " › ".join([title] + sc["path"] + ([sc["h"]] if sc["h"] != title else [])), "body": ps, "pub_date": d["date"][:10] if d["type"] == "post" else None, "ord": i * 100 + j})
json.dump(rows, open(f"{W}/chunks.json", "w"), ensure_ascii=False)
print(len(docs), "pages,", len(rows), "passages ->", f"{W}/chunks.json")
