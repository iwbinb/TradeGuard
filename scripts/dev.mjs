import { spawn } from "node:child_process";
const args = process.argv.slice(2);
const children = [
  spawn(
    process.execPath,
    [
      "node_modules/wrangler/bin/wrangler.js",
      "dev",
      "--local",
      "--port",
      "8787",
    ],
    { stdio: "inherit" },
  ),
  spawn(process.execPath, ["node_modules/vite/bin/vite.js", ...args], {
    stdio: "inherit",
  }),
];
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill("SIGTERM");
}
for (const child of children)
  child.on("exit", (code) => {
    if (!stopping) {
      stop();
      process.exitCode = code ?? 1;
    }
  });
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
