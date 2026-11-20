#!/usr/bin/env python3
"""Give every website passage its meaning vector (gemini-embedding-001, 768 numbers), at the free tier's speed.
The Google key is read from the server safe (Supabase Vault) and never printed. 20 passages per call, one call every 16 s
(~75 a minute); on "too many requests" it waits 65 s and goes on. Usage: python3 -I scripts/site-kb/embed.py"""
import json, os, time, urllib.request, urllib.error

TOKEN = open(os.path.expanduser("~/.sdm-supabase-token")).read().strip()
def sql(q):
    req = urllib.request.Request("https://api.supabase.com/v1/projects/iyubegbevtjcvtuubpaq/database/query", data=json.dumps({"query": q}).encode(),
                                 headers={"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json", "User-Agent": "sdm-site-kb"})
    with urllib.request.urlopen(req, timeout=60) as r: return json.loads(r.read())
KEY = sql("select decrypted_secret s from vault.decrypted_secrets where name='sdm_lara_ai_key'")[0]["s"].strip()
URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents"
def embed(rows):
    body = {"requests": [{"model": "models/gemini-embedding-001", "content": {"parts": [{"text": r["body"][:6000]}]}, "taskType": "RETRIEVAL_DOCUMENT",
                          "title": r["path"][:300], "outputDimensionality": 768} for r in rows]}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"x-goog-api-key": KEY, "Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as r: return [e["values"] for e in json.loads(r.read())["embeddings"]]
done = 0
while True:
    rows = sql("select id, path, body from lara_site where active and embedding is null order by id limit 20")
    if not rows: break
    try: vecs = embed(rows)
    except urllib.error.HTTPError as e:
        if e.code == 429: print("free limit reached, waiting 65 s", flush=True); time.sleep(65); continue
        raise SystemExit(f"Google refused: {e.code}")
    vals = ",".join(f"({r['id']}, '[{','.join(f'{x:.6f}' for x in v)}]')" for r, v in zip(rows, vecs))
    sql(f"update lara_site s set embedding = v.e::extensions.vector, emb_at = now() from (values {vals}) as v(id, e) where s.id = v.id")
    done += len(rows)
    left = sql("select count(*) n from lara_site where active and embedding is null")[0]["n"]
    print(f"{done} done, {left} left", flush=True)
    if left: time.sleep(16)
print("all passages have a meaning vector")
