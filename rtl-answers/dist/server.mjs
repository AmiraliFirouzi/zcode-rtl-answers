#!/usr/bin/env node
// rtl-answers MCP stdio server.
// Renders a markdown answer written in an RTL language (Persian, Arabic, ...)
// as a right-to-left HTML fragment for ZCode's inline visualization panel.

import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import readline from "node:readline";

const SERVER_NAME = "rtl-answers";
const SERVER_VERSION = "0.1.0";

// ---------------------------------------------------------------------------
// JSON-RPC / MCP plumbing (newline-delimited JSON over stdio, zero deps)
// ---------------------------------------------------------------------------

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + "\n");
}

function reply(id, result) {
  if (id === undefined || id === null) return; // never answer notifications
  send({ jsonrpc: "2.0", id, result });
}

function replyError(id, code, message) {
  if (id === undefined || id === null) return;
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

const TOOL_SCHEMAS = {
  render_rtl: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Full answer as plain markdown; code in fenced blocks.",
      },
      title: {
        type: "string",
        description: "Short title; becomes the ASCII file name.",
      },
      dir: {
        type: "string",
        description: "Session visualization directory from the environment context.",
      },
      lang: {
        type: "string",
        enum: ["fa", "ar", "he", "ur", "ps", "ckb"],
        description: "RTL language; default fa.",
      },
    },
    required: ["text", "dir"],
  },
};

function toolDefinitions() {
  return [
    {
      name: "render_rtl",
      title: "Render RTL answer",
      description:
        "Render a markdown answer in an RTL language (Persian/Arabic/Hebrew/Urdu) as a right-to-left panel. Use for every RTL reply longer than ~3 sentences: pass the full answer as `text`, the session visualization directory as `dir`. Emit the returned ::visualize line verbatim as the last line of your final message; keep chat text to a 1-2 sentence summary.",
      inputSchema: TOOL_SCHEMAS.render_rtl,
    },
  ];
}

// ---------------------------------------------------------------------------
// Markdown -> RTL HTML
// ---------------------------------------------------------------------------

const RTL_RE =
  /[\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0750-\u077F\u08A0-\u08FF\uFB1D-\uFDFF\uFE70-\uFEFF]/g;
const LTR_RE = /[A-Za-z\u00C0-\u024F]/g;

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripInlineMarkup(s) {
  return s
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1");
}

// RTL when the block has enough RTL letters relative to Latin ones, so that a
// Latin brand name inside a Persian sentence never flips the whole paragraph.
function blockDir(text) {
  const clean = stripInlineMarkup(text);
  const rtl = (clean.match(RTL_RE) || []).length;
  const ltr = (clean.match(LTR_RE) || []).length;
  return rtl > 0 && rtl >= ltr * 0.3 ? "rtl" : "ltr";
}

function inline(s) {
  let out = escapeHtml(s);
  out = out.replace(/`([^`]+)`/g, '<code dir="ltr">$1</code>');
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(/\*([^*\s][^*]*)\*/g, "<em>$1</em>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:[^)\s]+)\)/g,
    '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
  );
  return out;
}

function dirAttr(text) {
  return blockDir(text) === "ltr" ? ' dir="ltr" style="text-align:left"' : "";
}

function renderBlock(line) {
  const h = line.match(/^(#{1,3})\s+(.*)$/);
  if (h) {
    const tag = `h${h[1].length}`;
    return `<${tag}${dirAttr(h[2])}>${inline(h[2].trim())}</${tag}>`;
  }
  if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) return "<hr>";
  return `<p${dirAttr(line)}>${inline(line.trim())}</p>`;
}

function renderList(items, ordered) {
  const tag = ordered ? "ol" : "ul";
  const lis = items.map((it) => `<li${dirAttr(it)}>${inline(it.trim())}</li>`).join("\n");
  return `<${tag}>\n${lis}\n</${tag}>`;
}

function renderQuote(lines) {
  const body = lines.join(" ");
  return `<blockquote${dirAttr(body)}><p>${inline(body.trim())}</p></blockquote>`;
}

function renderTable(header, rows) {
  const th = header.cells
    .map((c) => `<th${dirAttr(c)}>${inline(c.trim())}</th>`)
    .join("");
  const body = rows
    .map(
      (r) =>
        `<tr>${r.cells
          .map((c) => `<td${dirAttr(c)}>${inline(c.trim())}</td>`)
          .join("")}</tr>`
    )
    .join("\n");
  return `<table class="table">\n<thead><tr>${th}</tr></thead>\n<tbody>\n${body}\n</tbody>\n</table>`;
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|")) s = s.slice(0, -1);
  return s.split("|").map((c) => c.trim());
}

function isDivider(line) {
  return /^\s*\|?[\s:|-]+\|?\s*$/.test(line) && /-/.test(line) && /\|/.test(line);
}

function mdToHtml(md) {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;
  let para = [];
  const flushPara = () => {
    if (para.length) {
      out.push(renderBlock(para.join(" ")));
      para = [];
    }
  };

  while (i < lines.length) {
    const line = lines[i];

    // fenced code
    const fence = line.match(/^\s*```(\w*)\s*$/);
    if (fence) {
      flushPara();
      const code = [];
      i++;
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        code.push(lines[i]);
        i++;
      }
      i++; // closing fence
      out.push(
        `<pre><code dir="ltr" style="direction:ltr;text-align:left;display:block;">${escapeHtml(
          code.join("\n")
        )}</code></pre>`
      );
      continue;
    }

    // blank line
    if (/^\s*$/.test(line)) {
      flushPara();
      i++;
      continue;
    }

    // table (header row + divider)
    if (line.includes("|") && i + 1 < lines.length && isDivider(lines[i + 1])) {
      flushPara();
      const header = { cells: splitRow(line) };
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes("|") && !/^\s*$/.test(lines[i])) {
        rows.push({ cells: splitRow(lines[i]) });
        i++;
      }
      out.push(renderTable(header, rows));
      continue;
    }

    // blockquote
    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushPara();
      const q = [quote[1]];
      i++;
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        q.push(lines[i].replace(/^\s*>\s?/, ""));
        i++;
      }
      out.push(renderQuote(q));
      continue;
    }

    // lists
    const ul = line.match(/^\s*[-*+]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (ul || ol) {
      flushPara();
      const ordered = Boolean(ol);
      const items = [(ul || ol)[1]];
      i++;
      while (i < lines.length) {
        const cont = lines[i].match(ordered ? /^\s*\d+[.)]\s+(.*)$/ : /^\s*[-*+]\s+(.*)$/);
        if (cont) {
          items.push(cont[1]);
          i++;
        } else if (/^\s{2,}\S/.test(lines[i]) && !/^\s*$/.test(lines[i])) {
          items[items.length - 1] += " " + lines[i].trim(); // wrapped list line
          i++;
        } else break;
      }
      out.push(renderList(items, ordered));
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flushPara();
  return out.join("\n");
}

const FONT_LINK =
  '<link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Vazirmatn:wght@400;500&display=swap">';

const RTL_FONTS = {
  fa: "Vazirmatn, Tahoma, sans-serif",
  ur: "Vazirmatn, 'Noto Nastaliq Urdu', Tahoma, sans-serif",
  ps: "Vazirmatn, Tahoma, sans-serif",
  ckb: "Vazirmatn, Tahoma, sans-serif",
  ar: "Vazirmatn, 'Segoe UI', Tahoma, sans-serif",
  he: "'Segoe UI', Tahoma, Arial, sans-serif",
};

// ZCode's host validates ::visualize paths with
// /^[a-z0-9]+(?:-[a-z0-9]+)*\.html$/ — the file name must be ASCII
// lowercase-hyphenated, so Persian titles are transliterated here.
const TRANSLIT = {
  آ: "a", ا: "a", أ: "a", إ: "i", ب: "b", پ: "p", ت: "t", ث: "s", ج: "j",
  چ: "ch", ح: "h", خ: "kh", د: "d", ذ: "z", ر: "r", ز: "z", ژ: "zh", س: "s",
  ش: "sh", ص: "s", ض: "z", ط: "t", ظ: "z", ع: "a", غ: "gh", ف: "f", ق: "gh",
  ک: "k", ك: "k", گ: "g", ل: "l", م: "m", ن: "n", و: "o", ه: "h", ی: "i",
  ي: "i", ئ: "i", ء: "", ؤ: "o", ة: "h", ى: "i",
};

function slugify(title) {
  const translit = (title || "")
    .replace(/[\u064B-\u065F\u0670]/g, "") // harakat
    .replace(/\u200c/g, "-") // ZWNJ
    .replace(/[آ-ي\u067E\u0686\u0698\u06A9\u06AF\u06CC]/g, (c) => TRANSLIT[c] ?? "")
    .toLowerCase();
  const base = translit
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9-]+/g, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
  return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(base) ? base : "rtl-answer";
}

function renderFragment(text, lang) {
  const font = RTL_FONTS[lang] || RTL_FONTS.fa;
  const fontHtml = lang === "he" ? "" : FONT_LINK + "\n";
  return (
    fontHtml +
    `<div id="rtl-answer" dir="rtl" lang="${lang}" style="direction:rtl;text-align:right;font-family:${font};">\n` +
    mdToHtml(text) +
    `\n</div>\n` +
    `<style>\n` +
    `#rtl-answer pre{direction:ltr;text-align:left;}\n` +
    `#rtl-answer code{direction:ltr;unicode-bidi:embed;font-family:Consolas,Menlo,monospace;}\n` +
    `#rtl-answer a{word-break:break-all;}\n` +
    `</style>`
  );
}

// ---------------------------------------------------------------------------
// Tool: render_rtl
// ---------------------------------------------------------------------------

function uniquePath(dirPath, title) {
  const base = slugify(title);
  let p = join(dirPath, base + ".html");
  let n = 2;
  while (existsSync(p)) p = join(dirPath, `${base}-${n++}.html`);
  return p;
}

function runRenderRtl(args) {
  const text = typeof args.text === "string" ? args.text : "";
  const title = typeof args.title === "string" ? args.title : "";
  const lang = typeof args.lang === "string" && RTL_FONTS[args.lang] ? args.lang : "fa";

  if (!text.trim()) {
    return { isError: true, content: [{ type: "text", text: "Parameter `text` is empty. Pass the full markdown answer." }] };
  }
  if (!args.dir || typeof args.dir !== "string") {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Parameter `dir` is required: pass the session visualization directory from the environment context (the writable inline-fragment directory).",
        },
      ],
    };
  }

  let dirPath;
  try {
    dirPath = resolve(args.dir);
    if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) {
      mkdirSync(dirPath, { recursive: true });
    }
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Cannot use directory: ${e.message}` }],
    };
  }

  const html = renderFragment(text, lang);
  const outPath = uniquePath(dirPath, title);
  try {
    writeFileSync(outPath, html, "utf8");
  } catch (e) {
    return {
      isError: true,
      content: [{ type: "text", text: `Write failed: ${e.message}` }],
    };
  }

  const reference = `::visualize{"path":"${outPath.replace(/\\/g, "\\\\")}"}`;
  return {
    content: [
      {
        type: "text",
        text:
          "Emit this line verbatim as the last line of your final message (chat text: 1 short summary sentence only):\n" +
          reference,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Message loop
// ---------------------------------------------------------------------------

function handleMessage(msg) {
  const { id, method, params } = msg || {};
  switch (method) {
    case "initialize":
      reply(id, {
        protocolVersion: params && params.protocolVersion ? params.protocolVersion : "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      });
      break;
    case "ping":
      reply(id, {});
      break;
    case "tools/list":
      reply(id, { tools: toolDefinitions() });
      break;
    case "tools/call": {
      const name = params && params.name;
      const args = (params && params.arguments) || {};
      if (name !== "render_rtl") {
        replyError(id, -32602, `Unknown tool: ${name}`);
        break;
      }
      try {
        const result = runRenderRtl(args);
        reply(id, result);
      } catch (e) {
        reply(id, {
          isError: true,
          content: [{ type: "text", text: `Unexpected error: ${e.message}` }],
        });
      }
      break;
    }
    default:
      if (id !== undefined && id !== null && method) {
        replyError(id, -32601, `Method not found: ${method}`);
      }
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let msg;
  try {
    msg = JSON.parse(s);
  } catch {
    return;
  }
  try {
    handleMessage(msg);
  } catch (e) {
    if (msg && msg.id !== undefined && msg.id !== null) {
      replyError(msg.id, -32603, e.message);
    }
  }
});
rl.on("close", () => process.exit(0));
