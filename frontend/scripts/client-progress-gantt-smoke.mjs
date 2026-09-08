import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const appUrl = process.env.APP_URL || "https://pocket-mkt.github.io/#tasks/client-progress";
const chromePath = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const account = process.env.SMOKE_ACCOUNT || "";
const accessCode = process.env.SMOKE_ACCESS_CODE || "";
const port = Number(process.env.CDP_PORT || 9343);
const timeoutMs = Number(process.env.SMOKE_READY_TIMEOUT || 30_000);
const profileDir = await mkdtemp(path.join(tmpdir(), "pocket-client-progress-"));

if (!account || !accessCode) throw new Error("SMOKE_ACCOUNT and SMOKE_ACCESS_CODE are required");

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profileDir}`,
  "--window-size=1440,1000",
  "about:blank",
], { stdio: "ignore", windowsHide: true });

const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function waitForDebugger() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) return;
    } catch {}
    await delay(100);
  }
  throw new Error("Chrome debugging endpoint did not start");
}

function createClient(socketUrl) {
  const socket = new WebSocket(socketUrl);
  const pending = new Map();
  const events = [];
  let counter = 0;
  const opened = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
      return;
    }
    events.push(message);
  });
  return {
    events,
    async send(method, params = {}) {
      await opened;
      const id = ++counter;
      const response = new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
      socket.send(JSON.stringify({ id, method, params }));
      return response;
    },
    close: () => socket.close(),
  };
}

async function evaluate(client, expression) {
  const result = await client.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Evaluation failed");
  return result.result.value;
}

async function waitFor(client, expression) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(client, expression)) return true;
    await delay(120);
  }
  return false;
}

try {
  await waitForDebugger();
  const response = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(appUrl)}`, { method: "PUT" });
  const target = await response.json();
  const client = createClient(target.webSocketDebuggerUrl);
  await client.send("Runtime.enable");
  await client.send("Page.enable");
  await client.send("Log.enable");

  if (!await waitFor(client, "Boolean(document.querySelector('.login-shell, .progress-brief, .state-panel'))")) {
    throw new Error("Login or progress page did not render");
  }

  if (await evaluate(client, "Boolean(document.querySelector('.login-shell'))")) {
    const fillLogin = `(() => {
      const inputs = document.querySelectorAll('.login-card input');
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      setValue.call(inputs[0], ${JSON.stringify(account)});
      inputs[0].dispatchEvent(new Event('input', { bubbles: true }));
      setValue.call(inputs[1], ${JSON.stringify(accessCode)});
      inputs[1].dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('.login-card form')?.requestSubmit();
    })()`;
    await evaluate(client, fillLogin);
  }

  if (!await waitFor(client, "Boolean(document.querySelector('.progress-brief .pb-schedule .reference-gantt'))")) {
    const diagnostic = await evaluate(client, `({
      hash: location.hash,
      title: document.title,
      text: document.body.innerText.slice(0, 1200),
      loginError: document.querySelector('.login-error')?.textContent || '',
      loading: document.querySelector('.state-panel.is-loading')?.textContent || ''
    })`);
    throw new Error(`Client Gantt did not render: ${JSON.stringify(diagnostic)}`);
  }

  const result = await evaluate(client, `(() => {
    const gantt = document.querySelector('.progress-brief .pb-schedule .reference-gantt');
    return {
      hash: location.hash,
      heading: document.querySelector('.pb-heading h1')?.textContent.trim() || '',
      customerPage: Boolean(document.querySelector('.client-progress-view')),
      internalPanels: Boolean(document.querySelector('.pb-priority-grid, .pb-meeting-panel, .project-issue-panel')),
      ganttGroups: gantt.querySelectorAll('.g-grow').length,
      ganttTaskRows: gantt.querySelectorAll('.g-row').length,
      ganttScheduledCells: gantt.querySelectorAll('.g-c[data-gantt-task-id]').length,
      ganttBars: gantt.querySelectorAll('.g-bar, .g-c.on').length,
      visibleHeight: gantt.getBoundingClientRect().height,
      readOnly: !document.querySelector('.pb-schedule .g-action, .pb-schedule .task-schedule-edit, .pb-schedule .task-delete-button'),
    };
  })()`);
  if (!result.heading || !result.customerPage || result.internalPanels) throw new Error('Customer projection missing or internal panels exposed');
  if (result.ganttTaskRows < 1 || result.ganttScheduledCells < 1 || result.ganttBars < 1 || result.visibleHeight < 100) {
    throw new Error(`Client Gantt is empty or hidden: ${JSON.stringify(result)}`);
  }
  if (!result.readOnly) throw new Error("Client Gantt exposed write controls");

  const seriousEvents = client.events.filter(event =>
    event.method === "Runtime.exceptionThrown" ||
    (event.method === "Log.entryAdded" && ["error", "warning"].includes(event.params?.entry?.level)),
  );
  if (seriousEvents.length) throw new Error(`Browser console errors: ${JSON.stringify(seriousEvents.slice(-5))}`);

  client.close();
  console.log(JSON.stringify(result));
} finally {
  chrome.kill();
}
