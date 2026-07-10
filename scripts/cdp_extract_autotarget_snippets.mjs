const needle = process.argv[2] || "direct.yandex.ru/dna/grid/phrases";
const port = process.env.PLAYWRIGHT_CDP_PORT || "9223";

const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const target = list.find((page) => (
  page.type === "page" &&
  `${page.title || ""} ${page.url || ""}`.toLowerCase().includes(needle.toLowerCase())
));

if (!target) {
  console.log(JSON.stringify({ found: false, needle }, null, 2));
  process.exit(0);
}

await fetch(`http://127.0.0.1:${port}/json/activate/${target.id}`).catch(() => {});

const ws = new WebSocket(target.webSocketDebuggerUrl);
let seq = 0;
const pending = new Map();

ws.onmessage = (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    pending.get(message.id)(message);
    pending.delete(message.id);
  }
};

await new Promise((resolve, reject) => {
  ws.onopen = resolve;
  ws.onerror = reject;
});

function send(method, params = {}) {
  const id = ++seq;
  ws.send(JSON.stringify({ id, method, params }));
  return new Promise((resolve) => pending.set(id, resolve));
}

await send("Runtime.enable");

const expression = `(() => {
  const text = (document.body && document.body.innerText) ? document.body.innerText : "";
  const key = "--автотаргетинг";
  const snippets = [];
  let from = 0;
  while (true) {
    const idx = text.indexOf(key, from);
    if (idx === -1) break;
    const start = Math.max(0, idx - 120);
    const end = Math.min(text.length, idx + 900);
    snippets.push(text.slice(start, end));
    from = idx + key.length;
    if (snippets.length >= 20) break;
  }
  return {
    title: document.title,
    url: location.href,
    snippetCount: snippets.length,
    snippets,
  };
})()`;

const result = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
  awaitPromise: true,
});

console.log(JSON.stringify(result.result?.result?.value || { error: result }, null, 2));
ws.close();
