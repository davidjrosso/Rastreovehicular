import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { Writable } from "node:stream";
import { spawnSync } from "node:child_process";
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  stat,
  symlink,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parse } from "dotenv";

const { integrationEnv, remoteInstallCommand, sshArguments, sendConfig } =
  await import(
    new URL("../scripts/production-secrets.mjs", import.meta.url).href
  );
const fixture = [
  "HIK_OPENAPI_URL=https://hik.example.test",
  "HIK_APP_KEY=fixture-key",
  "HIK_APP_SECRET='fixture-$secret # with spaces'",
  "HIK_CAMERA_MAPPING='{" + '"276":"camera-test"' + "}'",
  "MY_MAPS_ID=fixture-map",
  "DATABASE_URL=must-not-transfer-db",
  "BOOTSTRAP_PASSWORD=must-not-transfer-password",
  "POSTGRES_PASSWORD=must-not-transfer-postgres",
  "APP_ORIGIN=http://localhost:3001",
].join("\n");

test(
  "Compose carga las claves literales desde archivos externos",
  {
    skip:
      spawnSync("docker", ["compose", "version"], { stdio: "ignore" })
        .status !== 0,
  },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "rastreo-secrets-compose-"));
    t.after(async () => {
      assert.ok(resolve(dir).startsWith(resolve(tmpdir())));
      await rm(dir, { recursive: true, force: true });
    });
    const integrationFile = join(dir, "hikcentral.env");
    const productionFile = join(dir, "production.env");
    await writeFile(integrationFile, integrationEnv(fixture).content);
    await writeFile(
      productionFile,
      "DOMAIN=rastreo.example.test\nPOSTGRES_PASSWORD=fixture-postgres\n",
    );
    const env = { ...process.env };
    for (const key of Object.keys(env))
      if (
        /^(HIK_|MY_MAPS_)/.test(key) ||
        ["DOMAIN", "POSTGRES_PASSWORD"].includes(key)
      )
        delete env[key];
    const args = [
      "compose",
      "--env-file",
      productionFile,
      "--env-file",
      integrationFile,
      "config",
    ];
    const quiet = spawnSync("docker", [...args, "--quiet"], {
      encoding: "utf8",
      env,
    });
    assert.equal(quiet.status, 0, quiet.stderr);
    assert.equal(quiet.stdout, "");
    const result = spawnSync("docker", [...args, "--format", "json"], {
      encoding: "utf8",
      env,
    });
    assert.equal(result.status, 0, result.stderr);
    const config = JSON.parse(result.stdout);
    assert.equal(
      config.services.app.environment.HIK_APP_SECRET,
      "fixture-$secret # with spaces",
    );
    assert.equal(
      config.services.app.environment.HIK_CAMERA_MAPPING,
      '{"276":"camera-test"}',
    );
    assert.equal(config.services.app.environment.MY_MAPS_ID, "fixture-map");
  },
);

test("transferencia selecciona sólo integraciones y conserva valores literales", () => {
  const config = integrationEnv(fixture);
  assert.deepEqual(parse(config.content), {
    HIK_OPENAPI_URL: "https://hik.example.test",
    HIK_APP_KEY: "fixture-key",
    HIK_APP_SECRET: "fixture-$secret # with spaces",
    HIK_CAMERA_MAPPING: '{"276":"camera-test"}',
    MY_MAPS_ID: "fixture-map",
  });
  assert.ok(!config.content.includes("must-not-transfer"));
  assert.ok(!config.content.includes("localhost"));
});

test("transferencia rechaza configuración incompleta, TLS inseguro y escapes ambiguos", () => {
  assert.throws(() => integrationEnv("HIK_APP_KEY=test"), /HIK_OPENAPI_URL/);
  for (const url of [
    "http://hik.test",
    "https://user:pass@hik.test",
    "https://hik.test/#/portal",
  ]) {
    assert.throws(() =>
      integrationEnv(fixture.replace("https://hik.example.test", `'${url}'`)),
    );
  }
  for (const secret of ["invalid'quote", "invalid\\path", "invalid\nnewline"]) {
    assert.throws(
      () => integrationEnv(fixture + `\nHIK_APP_SECRET="${secret}"`),
      /caracteres no admitidos/,
    );
  }
});

test("SSH valida destino y envía secretos solamente por stdin", async () => {
  for (const host of [
    "-oProxyCommand=bad",
    "user@host;bad",
    "user@host bad",
    "$(bad)",
    "",
  ]) {
    assert.throws(() => sshArguments({ host }));
  }
  for (const port of [0, 65536, "22;bad"])
    assert.throws(() => sshArguments({ host: "deploy@app.test", port }));
  const content = integrationEnv(fixture).content;
  const args = sshArguments({
    host: "deploy@app.test",
    port: 2222,
    byteLength: Buffer.byteLength(content),
  });
  assert.deepEqual(args.slice(0, 5), [
    "-T",
    "-p",
    "2222",
    "--",
    "deploy@app.test",
  ]);
  assert.ok(!args.join(" ").includes("StrictHostKeyChecking"));
  assert.ok(!args.join(" ").includes("\r"));
  let received = "";
  const fakeSpawn = (
    command: string,
    actualArgs: string[],
    options: unknown,
  ) => {
    assert.equal(command, "ssh");
    assert.deepEqual(actualArgs, args);
    assert.ok(!actualArgs.join(" ").includes("fixture-key"));
    assert.deepEqual(options, {
      stdio: ["pipe", "inherit", "inherit"],
      shell: false,
    });
    const child = new EventEmitter() as EventEmitter & { stdin: Writable };
    child.stdin = new Writable({
      write(chunk, _encoding, done) {
        received += chunk.toString();
        done();
      },
      final(done) {
        done();
        queueMicrotask(() => child.emit("close", 0));
      },
    });
    return child;
  };
  await sendConfig(content, args, fakeSpawn);
  assert.equal(received, content);
  await assert.rejects(
    sendConfig(content, args, () => {
      const child = new EventEmitter() as EventEmitter & { stdin: Writable };
      child.stdin = new Writable({
        write(_chunk, _encoding, done) {
          done();
        },
      });
      queueMicrotask(() => child.emit("close", 255));
      return child;
    }),
    /transferencia no terminó/,
  );
});

test("check no imprime credenciales y Git excluye configuraciones privadas", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "rastreo-secrets-check-"));
  t.after(async () => {
    assert.ok(resolve(dir).startsWith(resolve(tmpdir())));
    await rm(dir, { recursive: true, force: true });
  });
  const envFile = join(dir, "fixture.env");
  await writeFile(envFile, fixture);
  const result = spawnSync(
    process.execPath,
    ["scripts/production-secrets.mjs", "check", "--env", envFile],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /HIK_APP_SECRET/);
  assert.ok(!result.stdout.includes("fixture-"));
  assert.ok(!result.stderr.includes("fixture-"));
  const ignored = spawnSync(
    "git",
    [
      "check-ignore",
      "--no-index",
      ".env.production",
      "secrets/test",
      ".secrets/test",
      "production.env",
      "hikcentral.env",
      "config.private.env",
    ],
    { encoding: "utf8" },
  );
  assert.equal(ignored.status, 0);
  assert.equal(ignored.stdout.trim().split(/\r?\n/).length, 6);
  const example = spawnSync(
    "git",
    ["check-ignore", "--no-index", ".env.example"],
    { encoding: "utf8" },
  );
  assert.equal(example.status, 1);
});

test(
  "instalación Linux es privada, atómica y rechaza repositorios y enlaces",
  { skip: process.platform !== "linux" },
  async (t) => {
    const dir = await mkdtemp(join(tmpdir(), "rastreo-secrets-install-"));
    t.after(() => rm(dir, { recursive: true, force: true }));
    const home = join(dir, "home");
    await mkdir(home);
    const privateDir = join(home, ".config", "rastreo");
    const target = join(privateDir, "hikcentral.env");
    const content = integrationEnv(fixture).content;
    const install = (
      replace = false,
      input = content,
      userHome = home,
      expectedBytes = Buffer.byteLength(input || content),
    ) =>
      spawnSync(
        "/bin/sh",
        ["-c", remoteInstallCommand(replace, expectedBytes)],
        {
          env: { ...process.env, HOME: userHome },
          input,
          encoding: "utf8",
        },
      );
    let result = install();
    assert.equal(result.status, 0, result.stderr);
    assert.ok(!result.stdout.includes("fixture-"));
    assert.equal(await readFile(target, "utf8"), content);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    assert.equal((await stat(privateDir)).mode & 0o777, 0o700);
    assert.notEqual(install(false, "replacement").status, 0);
    assert.equal(await readFile(target, "utf8"), content);
    assert.notEqual(install(true, "").status, 0);
    assert.equal(await readFile(target, "utf8"), content);
    assert.notEqual(
      install(true, content.slice(0, 30), home, Buffer.byteLength(content))
        .status,
      0,
    );
    assert.equal(await readFile(target, "utf8"), content);
    assert.equal(install(true, "replacement").status, 0);
    assert.equal(await readFile(target, "utf8"), "replacement");
    await rm(target);
    const outside = join(dir, "outside.env");
    await writeFile(outside, "untouched");
    await symlink(outside, target);
    assert.notEqual(install(true).status, 0);
    assert.equal(await readFile(outside, "utf8"), "untouched");

    const repoHome = join(dir, "repo-home");
    await mkdir(repoHome);
    assert.equal(spawnSync("git", ["init", "-q", repoHome]).status, 0);
    result = install(false, content, repoHome);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /repositorio/);
    await assert.rejects(
      readFile(join(repoHome, ".config", "rastreo", "hikcentral.env")),
      { code: "ENOENT" },
    );

    const linkHome = join(dir, "link-home");
    await mkdir(join(linkHome, ".config"), { recursive: true });
    await symlink(privateDir, join(linkHome, ".config", "rastreo"));
    assert.notEqual(install(true, content, linkHome).status, 0);
  },
);
