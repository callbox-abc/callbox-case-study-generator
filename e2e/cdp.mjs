// A minimal Chrome DevTools Protocol client (Node 22+ has WebSocket and fetch built in), so the
// end-to-end test needs no browser-automation dependency: it drives the Chrome already installed.

export async function connect(cdpPort) {
  const targets = await (await fetch(`http://127.0.0.1:${cdpPort}/json/list`)).json();
  const page = targets.find((t) => t.type === "page");
  if (!page) throw new Error("Chrome has no page target.");
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener("open", resolve, { once: true });
    ws.addEventListener("error", () => reject(new Error("Could not connect to Chrome.")), { once: true });
  });

  let id = 0;
  const pending = new Map();
  const listeners = new Map();
  ws.addEventListener("message", (e) => {
    const m = JSON.parse(e.data);
    if (m.id) {
      pending.get(m.id)?.(m);
      pending.delete(m.id);
    } else {
      for (const fn of listeners.get(m.method) || []) fn(m.params);
    }
  });

  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const i = ++id;
      pending.set(i, resolve);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  const on = (method, fn) => listeners.set(method, [...(listeners.get(method) || []), fn]);
  // Runs JavaScript in the page and returns its (JSON-able) value.
  const evaluate = async (expression) => {
    const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const ex = r.result?.exceptionDetails;
    if (ex) throw new Error(`Page script failed: ${ex.exception?.description || ex.text}\n${expression.slice(0, 200)}`);
    return r.result?.result?.value;
  };

  return { send, on, evaluate, close: () => ws.close() };
}
