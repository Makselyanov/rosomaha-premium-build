const campaignId = String(process.argv[2] || "708505950");
const needle = process.argv[3] || "direct.yandex.ru";
const port = process.env.PLAYWRIGHT_CDP_PORT || "9223";

async function main() {
  const listResponse = await fetch(`http://127.0.0.1:${port}/json/list`);
  const list = await listResponse.json();
  const target = list.find((page) => (
    page.type === "page" &&
    `${page.title || ""} ${page.url || ""}`.toLowerCase().includes(needle.toLowerCase())
  ));

  if (!target) {
    console.log(JSON.stringify({ found: false, needle, campaignId }, null, 2));
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
    const key = ${JSON.stringify(campaignId)};
    const snippets = [];
    let from = 0;
    while (true) {
      const idx = text.indexOf(key, from);
      if (idx === -1) break;
      const start = Math.max(0, idx - 250);
      const end = Math.min(text.length, idx + 1250);
      snippets.push(text.slice(start, end));
      from = idx + key.length;
      if (snippets.length >= 10) break;
    }
    return {
      title: document.title,
      url: location.href,
      campaignId: key,
      snippetCount: snippets.length,
      snippets,
      bodyTextLen: text.length,
      bodyTextHead: text.slice(0, 600),
    };
  })()`;

  const result = await send("Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  });

  console.log(JSON.stringify(result.result?.result?.value || { error: result }, null, 2));
  ws.close();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
