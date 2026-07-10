const needle = process.argv[2] || "metrika.yandex.ru/stat/conversion_rate";
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

await send("Page.enable");
await send("Runtime.enable");

const expression = `(() => ({
  href: location.href,
  title: document.title,
  readyState: document.readyState,
  iframeCount: document.querySelectorAll("iframe").length,
  iframes: Array.from(document.querySelectorAll("iframe"))
    .slice(0, 30)
    .map((f) => ({ src: f.src || "", id: f.id || "", name: f.name || "" })),
  bodyTextLen: (document.body && document.body.innerText) ? document.body.innerText.length : 0,
  bodyTextHead: (document.body && document.body.innerText) ? document.body.innerText.slice(0, 800) : "",
  iframeText: (() => {
    const f = document.querySelector("iframe");
    if (!f) return { found: false };
    try {
      const doc = f.contentDocument;
      const t = doc && doc.body ? doc.body.innerText || "" : "";
      return {
        found: true,
        href: doc ? doc.location.href : "",
        textLen: t.length,
        textHead: t.slice(0, 12000),
      };
    } catch (e) {
      return { found: true, error: String(e) };
    }
  })()
}))()`;

const result = await send("Runtime.evaluate", {
  expression,
  returnByValue: true,
  awaitPromise: true,
});

console.log(JSON.stringify(result.result?.result?.value || { error: result }, null, 2));
ws.close();
