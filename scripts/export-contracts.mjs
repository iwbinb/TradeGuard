import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
mkdirSync("shared/generated", { recursive: true });
for (const name of ["TradeGuardAccount", "TradeGuardFactory"]) {
  const artifact = JSON.parse(
    readFileSync(`.artifacts/contracts/${name}.sol/${name}.json`, "utf8"),
  );
  writeFileSync(
    `shared/generated/${name}.ts`,
    `// Generated from the Solidity compiler artifact. Do not edit.\nexport const ${name}Abi = ${JSON.stringify(artifact.abi)} as const;\n`,
  );
}
