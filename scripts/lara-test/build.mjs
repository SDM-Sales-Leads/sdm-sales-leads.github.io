import { build } from "esbuild";
await build({ entryPoints: [process.argv[2]], bundle: true, format: "esm", platform: "node", target: "es2022", outfile: process.argv[3],
  banner: { js: 'globalThis.Deno={env:{get:(k)=>k==="SUPABASE_URL"?"http://stub.local":undefined}};' },
  plugins: [{ name: "npm", setup(b) { b.onResolve({ filter: /^npm:/ }, () => ({ path: process.argv[4] })); } }], logLevel: "error" });
