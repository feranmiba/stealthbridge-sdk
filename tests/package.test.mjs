import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { build as bundle } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = path.join(root, "tests", "fixtures");
const artifacts = path.join(root, "artifacts");
const expectedPackageFiles = [
  "README.md",
  "dist/amount.d.ts",
  "dist/amount.js",
  "dist/client.d.ts",
  "dist/client.js",
  "dist/index.d.ts",
  "dist/index.js",
  "dist/manifest.d.ts",
  "dist/manifest.js",
  "dist/types.d.ts",
  "dist/types.js",
  "package.json"
];
const budgets = {
  packedBytes: 28_000,
  unpackedBytes: 68_000,
  fullBrowserBytes: 9_000,
  treeShakenBrowserBytes: 1_600,
  nextClientSdkChunksBytes: 25_000
};
const forbiddenModulePattern = /^(?:node:|fs(?:\/|$)|crypto(?:\/|$)|path(?:\/|$)|child_process(?:\/|$)|worker_threads(?:\/|$)|net(?:\/|$)|tls(?:\/|$))/;
const secretMaterialPattern = /\b(?:privateKey|secretKey|mnemonic|seedPhrase|recoveryPhrase|walletSecret)\b/i;

let workspace;
let packed;
let tarball;
let nextConsumer;
let nextBuildOutput;
let nextInstallMilliseconds;
let nextBuildMilliseconds;

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      CI: "1",
      NEXT_TELEMETRY_DISABLED: "1",
      NO_COLOR: "1"
    }
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed (${result.status})\n${result.stdout}\n${result.stderr}`
    );
  }
  return result.stdout.trim();
}

async function installFixture(name) {
  const destination = path.join(workspace, name);
  await cp(path.join(fixtures, name), destination, { recursive: true });
  run("npm", [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
    "--no-package-lock",
    "--no-save",
    tarball
  ], destination);
  return destination;
}

async function installNextFixture() {
  const destination = path.join(workspace, "next-app");
  await cp(path.join(fixtures, "next-app"), destination, { recursive: true });
  const vendor = path.join(destination, "vendor");
  await mkdir(vendor, { recursive: true });
  await cp(tarball, path.join(vendor, "stealthbridge-sdk.tgz"));
  const lockPath = path.join(destination, "package-lock.json");
  const lock = JSON.parse(await readFile(lockPath, "utf8"));
  if (lock.packages && lock.packages["node_modules/@stealthbridge/sdk"]) {
    lock.packages["node_modules/@stealthbridge/sdk"].integrity = packed.integrity;
  }
  if (lock.dependencies && lock.dependencies["@stealthbridge/sdk"]) {
    lock.dependencies["@stealthbridge/sdk"].integrity = packed.integrity;
  }
  await writeFile(lockPath, JSON.stringify(lock, null, 2));
  const startedAt = performance.now();
  run("npm", ["ci", "--no-audit", "--no-fund"], destination);
  nextInstallMilliseconds = Math.round(performance.now() - startedAt);
  return destination;
}

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const entryPath = path.join(directory, entry.name);
    return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
  }));
  return nested.flat();
}

async function browserBuild(entryPoint) {
  const result = await bundle({
    entryPoints: [entryPoint],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: ["es2022"],
    treeShaking: true,
    minify: true,
    metafile: true,
    write: false,
    logLevel: "silent"
  });
  assert.equal(result.outputFiles.length, 1);
  const output = result.outputFiles[0];
  return { bytes: output.contents.byteLength, text: output.text, metafile: result.metafile };
}

function assertBrowserSafe(result) {
  const imports = Object.values(result.metafile.inputs).flatMap((input) => input.imports);
  assert.equal(
    imports.some(({ path: importPath }) => forbiddenModulePattern.test(importPath)),
    false,
    "browser bundle must not reference Node.js built-ins"
  );
  assert.doesNotMatch(result.text, secretMaterialPattern);
  assert.doesNotMatch(result.text, /\b(?:process|Buffer|require)\b/);
}

before(async () => {
  assert.ok(Number.parseInt(process.versions.node, 10) >= 22, "package checks require Node.js 22+");
  workspace = await mkdtemp(path.join(tmpdir(), "stealthbridge-package-consumers-"));
  await mkdir(artifacts, { recursive: true });
  const packOutput = run("npm", ["pack", "--json", "--ignore-scripts", "--pack-destination", artifacts]);
  [packed] = JSON.parse(packOutput);
  tarball = path.join(artifacts, packed.filename);
});

after(async () => {
  if (workspace) await rm(workspace, { recursive: true, force: true });
});

describe("published package contract", { concurrency: false }, () => {
  test("emits the public ESM entry point and declarations", async () => {
    const packageJson = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
    assert.deepEqual(packageJson.exports, {
      ".": {
        types: "./dist/index.d.ts",
        import: "./dist/index.js",
        default: "./dist/index.js"
      }
    });
    assert.equal(packageJson.type, "module");
    assert.equal(packageJson.sideEffects, false);
    assert.equal(packageJson.engines.node, ">=22");

    for (const emittedFile of expectedPackageFiles.filter((name) => name.startsWith("dist/"))) {
      const contents = await readFile(path.join(root, emittedFile), "utf8");
      assert.ok(contents.length > 0, `${emittedFile} must be non-empty`);
    }
    assert.match(await readFile(path.join(root, "dist/index.js"), "utf8"), /\.\/client\.js/);
    assert.match(await readFile(path.join(root, "dist/index.d.ts"), "utf8"), /\.\/types\.js/);
  });

  test("packs only intended files with verifiable integrity and size budgets", async (context) => {
    assert.deepEqual(packed.files.map(({ path: filePath }) => filePath).sort(), expectedPackageFiles);
    const archive = await readFile(tarball);
    const sha256 = createHash("sha256").update(archive).digest("hex");
    const independentSha256 = Buffer.from(
      await webcrypto.subtle.digest("SHA-256", archive)
    ).toString("hex");
    const integrity = `sha512-${createHash("sha512").update(archive).digest("base64")}`;
    const shasum = createHash("sha1").update(archive).digest("hex");
    assert.equal(packed.integrity, integrity);
    assert.equal(packed.shasum, shasum);
    assert.equal(sha256, independentSha256);
    assert.ok(packed.size <= budgets.packedBytes, `${packed.size} exceeds ${budgets.packedBytes}`);
    assert.ok(
      packed.unpackedSize <= budgets.unpackedBytes,
      `${packed.unpackedSize} exceeds ${budgets.unpackedBytes}`
    );
    context.diagnostic(`tarball ${packed.filename}: ${packed.size} B packed, ${packed.unpackedSize} B unpacked`);
    context.diagnostic(`tarball SHA-256: ${sha256}`);
  });

  test("installs the tarball and resolves the public API in Node.js ESM", async (context) => {
    const consumer = await installFixture("node-esm");
    const output = run(process.execPath, ["index.mjs"], consumer);
    assert.match(output, /all read-only methods/);
    context.diagnostic(`runtime ${process.version}: ${output}`);
  });

  test("resolves every public declaration in an isolated TypeScript consumer", async () => {
    const consumer = await installFixture("typescript");
    run(process.execPath, [path.join(root, "node_modules", "typescript", "bin", "tsc"), "-p", "tsconfig.json"], consumer);
  });

  test("creates a browser-safe bundle from the installed tarball", async (context) => {
    const consumer = await installFixture("browser");
    const result = await browserBuild(path.join(consumer, "full.mjs"));
    assertBrowserSafe(result);
    assert.ok(
      result.bytes <= budgets.fullBrowserBytes,
      `${result.bytes} exceeds ${budgets.fullBrowserBytes}`
    );
    context.diagnostic(`full minified browser ESM bundle: ${result.bytes} B`);
  });

  test("tree-shakes unused client code with a reproducible size ceiling", async (context) => {
    const consumer = path.join(workspace, "browser");
    const full = await browserBuild(path.join(consumer, "full.mjs"));
    const shaken = await browserBuild(path.join(consumer, "tree-shaken.mjs"));
    assertBrowserSafe(shaken);
    assert.ok(
      shaken.bytes <= budgets.treeShakenBrowserBytes,
      `${shaken.bytes} exceeds ${budgets.treeShakenBrowserBytes}`
    );
    assert.ok(shaken.bytes < full.bytes / 2, `${shaken.bytes} is not less than half of ${full.bytes}`);
    assert.doesNotMatch(shaken.text, /StealthBridgeClient|\/v1\/|\/health/);
    context.diagnostic(`ApiError-only bundle: ${shaken.bytes} B (${full.bytes} B full)`);
  });

  test("builds an isolated Next.js App Router consumer from the tarball", async (context) => {
    nextConsumer = await installNextFixture();
    const resolution = run(process.execPath, ["verify-install.mjs"], nextConsumer);
    assert.match(resolution, /node_modules.*@stealthbridge.*sdk.*dist.*index\.js/);

    const startedAt = performance.now();
    nextBuildOutput = run("npm", ["run", "build"], nextConsumer);
    nextBuildMilliseconds = Math.round(performance.now() - startedAt);
    assert.match(nextBuildOutput, /Creating an optimized production build|Compiled successfully/);
    assert.match(nextBuildOutput, /\s\/\s/);
    assert.ok((await readFile(path.join(nextConsumer, ".next", "BUILD_ID"), "utf8")).trim());
    context.diagnostic(resolution);
    context.diagnostic(
      `Next.js fixture: npm ci ${nextInstallMilliseconds} ms, production build ${nextBuildMilliseconds} ms`
    );
  });

  test("compiles SDK imports in a Next.js Server Component", async () => {
    const serverFiles = await listFiles(path.join(nextConsumer, ".next", "server"));
    const serverOutput = await Promise.all(
      serverFiles.map(async (filePath) => [filePath, await readFile(filePath, "utf8")])
    );
    assert.ok(
      serverOutput.some(([, contents]) => contents.includes("server-import-ok")),
      "built server output must contain the Server Component SDK marker"
    );
  });

  test("keeps the SDK import browser-safe in a Next.js Client Component", async (context) => {
    const staticFiles = (await listFiles(path.join(nextConsumer, ".next", "static", "chunks")))
      .filter((filePath) => filePath.endsWith(".js"));
    const chunks = await Promise.all(staticFiles.map(async (filePath) => ({
      filePath,
      contents: await readFile(filePath, "utf8"),
      size: (await stat(filePath)).size
    })));
    const sdkChunks = chunks.filter(({ contents }) =>
      contents.includes("client-import-ok") || contents.includes("StealthBridge API returned HTTP")
    );
    assert.ok(
      sdkChunks.some(({ contents }) => contents.includes("client-import-ok")),
      "built client chunks must contain the Client Component SDK marker"
    );
    assert.ok(
      sdkChunks.some(({ contents }) => contents.includes("StealthBridge API returned HTTP")),
      "built client chunks must include the SDK runtime imported through the package entry"
    );

    const combined = sdkChunks.map(({ contents }) => contents).join("\n");
    const combinedBytes = sdkChunks.reduce((total, { size }) => total + size, 0);
    assert.doesNotMatch(
      combined,
      /(?:node:(?:fs|crypto|path|child_process|worker_threads|net|tls)|(?:require|import)\(["'](?:fs|crypto|path|child_process|worker_threads|net|tls)["']\))/
    );
    assert.doesNotMatch(combined, secretMaterialPattern);
    assert.ok(
      combinedBytes <= budgets.nextClientSdkChunksBytes,
      `${combinedBytes} exceeds ${budgets.nextClientSdkChunksBytes}`
    );
    context.diagnostic(
      `Next.js SDK client chunks: ${sdkChunks.length} file(s), ${combinedBytes} B combined`
    );
  });
});
