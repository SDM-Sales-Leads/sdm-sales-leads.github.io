// Website knowledge base loader: chunks.json (crawl.py) -> SQL files that insert the new batch and then switch the old one off.
// Each passage gets word stems + topics from Lara's own matcher (lara_match.analyse), so questions and website text are read
// the same way. Run through scripts/site-kb/run.sh.
import { readFileSync, writeFileSync } from "node:fs";
import { analyse } from "../../supabase/functions/api/lara_match.ts";

const work = process.argv[2];
const rows: any[] = JSON.parse(readFileSync(`${work}/chunks.json`, "utf8"));
const batch = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
const q = (s: string | null) => (s == null ? "null" : `$q$${String(s).replace(/\$q\$/g, "")}$q$`);
const arr = (a: string[]) => `array[${a.map((x) => q(x)).join(",")}]::text[]`;
const out: string[] = [];
for (const r of rows) {
  const a = analyse(`${r.path}\n${r.body}`);
  const t = analyse(r.path);                                 // the heading path says what the passage is about: its topics count too
  const concepts = [...new Set([...a.concepts, ...t.concepts])];
  const words = [...a.words].filter((w) => w.length >= 2).slice(0, 400);
  const hwords = [...t.words].filter((w) => w.length >= 2);
  out.push(`(${q(r.lang)},${q(r.branch)},${q(r.park)},${q(r.page)},${q(r.url)},${q(r.section)},${q(r.path)},${q(r.body)},${arr(words)},${arr(concepts)},${arr(hwords)},${r.pub_date ? q(r.pub_date) + "::date" : "null"},${r.ord},${q(batch)})`);
}
const head = "insert into public.lara_site (lang,branch,park,page,url,section,path,body,terms,concepts,hterms,pub_date,ord,batch) values\n";
let n = 0;
for (let i = 0; i < out.length; i += 150) writeFileSync(`${work}/load_${n++}.sql`, head + out.slice(i, i + 150).join(",\n") + ";");
writeFileSync(`${work}/load_done.sql`, `update public.lara_site set active = false where batch <> ${q(batch)} and active;\nselect batch, lang, count(*) from public.lara_site where active group by 1,2;`);
console.log(`batch ${batch}: ${out.length} passages in ${n} files`);
