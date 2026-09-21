import { V5SerialConnection } from "../src/index.ts";
import { createBunAdapter } from "../src/adapters/bun.ts";

const adapter = createBunAdapter({ path: "/dev/ttyACM0" });
const conn = new V5SerialConnection(adapter);
if ((await conn.open(0, true)) !== true) throw new Error("open failed");

async function tap(x: number, y: number) {
  await conn.mockTouch(x, y, true);
  await new Promise((r) => setTimeout(r, 80));
  await conn.mockTouch(x, y, false);
}

await tap(70, 95);
await new Promise((r) => setTimeout(r, 200));
await conn.close();
console.log("tapped run");
