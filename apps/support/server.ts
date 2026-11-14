/**
 * Custom server: Next.js for HTTP plus a WebSocket endpoint at /media-stream
 * for Twilio Media Streams. Next's own route handlers cannot hold a WebSocket
 * open, which is why this exists.
 *
 *   dev:  npm run dev     (tsx server.ts, Next in dev mode)
 *   prod: npm run build && npm start
 */
import { createServer } from "node:http";
import next from "next";
import { WebSocketServer } from "ws";
import { CallBridge } from "./src/lib/realtime/bridge";

const dev = process.env.NODE_ENV !== "production";
const port = Number(process.env.PORT ?? 3000);

async function main() {
  const app = next({ dev });
  await app.prepare();
  const handle = app.getRequestHandler();
  const nextUpgrade = app.getUpgradeHandler();

  const wss = new WebSocketServer({ noServer: true });
  wss.on("connection", (socket) => {
    new CallBridge(socket);
  });

  const server = createServer((req, res) => {
    handle(req, res);
  });

  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname === "/media-stream") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      // Next's HMR socket in dev.
      nextUpgrade(req, socket, head);
    }
  });

  server.listen(port, () => {
    console.log(`> listening on http://localhost:${port} (${dev ? "dev" : "prod"})`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
