// Herramienta de desarrollo para inspeccionar la app en vivo por el protocolo
// de DevTools. Requiere la app abierta con:
//   pnpm exec electron-vite dev --watch --remoteDebuggingPort 9333
// Uso:
//   node scripts/dev-cdp.mjs archivo.js            evalúa el JS en la página (devuelve JSON)
//   node scripts/dev-cdp.mjs --shot salida.png [x,y,ancho,alto]   captura
//   node scripts/dev-cdp.mjs --click x,y           clic real (--rclick: derecho)
//   node scripts/dev-cdp.mjs --dblclick x,y        doble clic real
//   node scripts/dev-cdp.mjs --move x,y archivo.js mueve el ratón y evalúa
//   TARGET=accounts.google.com node scripts/dev-cdp.mjs ...   otra ventana
import { readFileSync, writeFileSync } from 'node:fs';

const targets = await (await fetch('http://127.0.0.1:9333/json')).json();
const wanted = process.env.TARGET || 'music.youtube.com';
const page = targets.find((t) => t.type === 'page' && t.url.includes(wanted));
if (!page) {
  console.log(JSON.stringify(targets.map((t) => [t.type, t.url]), null, 1));
  process.exit(1);
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r));
let id = 0;
const send = (method, params) =>
  new Promise((resolve) => {
    const myId = ++id;
    const onMsg = (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id === myId) {
        ws.removeEventListener('message', onMsg);
        resolve(msg);
      }
    };
    ws.addEventListener('message', onMsg);
    ws.send(JSON.stringify({ id: myId, method, params }));
  });

const args = process.argv.slice(2);
if (args[0] === '--shot') {
  const params = { format: 'png' };
  if (args[2]) {
    const [x, y, width, height] = args[2].split(',').map(Number);
    params.clip = { x, y, width, height, scale: 1 };
  }
  const res = await send('Page.captureScreenshot', params);
  writeFileSync(args[1], Buffer.from(res.result.data, 'base64'));
  console.log('ok');
} else if (args[0] === '--dblclick') {
  const [x, y] = args[1].split(',').map(Number);
  for (const clickCount of [1, 2])
    for (const type of ['mousePressed', 'mouseReleased'])
      await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount });
  console.log('dblclicked');
} else if (args[0] === '--click' || args[0] === '--rclick') {
  const [x, y] = args[1].split(',').map(Number);
  const button = args[0] === '--rclick' ? 'right' : 'left';
  for (const type of ['mouseMoved', 'mousePressed', 'mouseReleased'])
    await send('Input.dispatchMouseEvent', { type, x, y, button, clickCount: 1 });
  console.log('clicked');
} else {
  if (args[0] === '--move') {
    const [x, y] = args[1].split(',').map(Number);
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: x - 5, y });
    await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
    await new Promise((r) => setTimeout(r, 400));
    args.splice(0, 2);
  }
  const code = readFileSync(args[0], 'utf8');
  const res = await send('Runtime.evaluate', {
    expression: code,
    returnByValue: true,
    awaitPromise: true,
  });
  if (res.result?.exceptionDetails)
    console.log('EXCEPTION', res.result.exceptionDetails.exception?.description ?? JSON.stringify(res.result.exceptionDetails));
  else console.log(JSON.stringify(res.result?.result?.value ?? res.result, null, 1));
}
ws.close();
