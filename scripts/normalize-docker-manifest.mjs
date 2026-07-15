import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const directory = process.argv[2];
if (!directory) {
  throw new Error("usage: node normalize-docker-manifest.mjs <manifest-directory>");
}

const packagePath = path.join(directory, "package.json");
const lockPath = path.join(directory, "package-lock.json");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const packageLock = JSON.parse(await readFile(lockPath, "utf8"));

if (!packageJson.name || packageLock.name !== packageJson.name || packageLock.lockfileVersion !== 3) {
  throw new Error(`invalid npm manifest pair: ${directory}`);
}

const cacheVersion = "0.0.0-docker-cache";
packageJson.version = cacheVersion;
packageLock.version = cacheVersion;
if (packageLock.packages?.[""]) {
  packageLock.packages[""].version = cacheVersion;
}

await writeFile(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`);
await writeFile(lockPath, `${JSON.stringify(packageLock, null, 2)}\n`);
console.log(`normalized ${packageJson.name} manifest for Docker dependency caching`);
