// Smoke test for the ASCII-slug fix: every returned path basename must match
// ZCode's validation regex /^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.
const { spawnSync } = require("node:child_process");
const { rmSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const here = __dirname;
const out = join(here, "test-out");
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const call = (args) =>
  JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: "render_rtl", arguments: args } });

const dir = out.replace(/\\/g, "/");
const input = [
  call({ text: "تست یک\nمتن فارسی با `code` و **بولد**.", title: "راهنمای گیت", dir, lang: "fa" }),
  call({ text: "تست دو — همان عنوان", title: "راهنمای گیت", dir, lang: "fa" }),
  call({ text: "تست سه", title: "پرسش و پاسخ؟! #۱", dir, lang: "fa" }),
  call({ text: "تست چهار", title: "مدیریت شاخه‌ها در Git", dir, lang: "fa" }),
  call({ text: "تست پنج", title: "", dir, lang: "fa" }),
].join("\n");

const res = spawnSync("node", [join(here, "..", "dist", "server.mjs")], { input, encoding: "utf8" });
if (res.status !== 0 || !res.stdout.trim()) {
  console.log("SERVER FAILED, status:", res.status);
  console.log("stderr:", res.stderr?.slice(0, 500));
  console.log("stdout:", res.stdout?.slice(0, 500));
  process.exit(1);
}
let fails = 0;
const names = [];
for (const line of res.stdout.trim().split("\n")) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  const text = msg.result?.content?.[0]?.text ?? "";
  const m = text.match(/::visualize\{"path":"((?:[^"\\]|\\\\.)*)"\}/);
  if (!m) { console.log("FAIL  no reference in response"); fails++; continue; }
  const name = m[1].replace(/\\\\/g, "\\").split(/[/\\]/).pop();
  const ok = /^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/.test(name);
  names.push(name);
  if (!ok) fails++;
  console.log((ok ? "PASS" : "FAIL") + "  " + name);
}
console.log(fails === 0 && names.length === 5 ? "ALL PASS" : "FAILURES: " + fails);
rmSync(out, { recursive: true, force: true });
