import { test } from "node:test";
import assert from "node:assert/strict";
import { KeychainTimeout } from "./keychain.ts";
import {
  MINTED_SERVICE,
  READ_TIMEOUT_MS,
  type KeychainRunner,
  deleteMintedToken,
  readMintedToken,
  writeMintedToken,
} from "./mintedToken.ts";

type Options = { timeout: number; killSignal: "SIGKILL" } | undefined;

type Recorder = KeychainRunner & { calls: string[][]; options: Options[]; inputs: string[] };

/** A fake `security`: `run` answers with `stdout` (or fails), `interactive` records its input. */
function recorder(stdout = "", fail = false): Recorder {
  const calls: string[][] = [];
  const options: Options[] = [];
  const inputs: string[] = [];
  return {
    calls,
    options,
    inputs,
    async run(file, args, given) {
      calls.push([file, ...args]);
      options.push(given);
      if (fail) throw new Error("exit 44");
      return { stdout };
    },
    async interactive(input) {
      inputs.push(input);
    },
  };
}

/** A fake Keychain that stores what `security -i` adds and returns it on read. */
function keychain(options: { store?: boolean; failInteractive?: boolean } = {}): Recorder {
  const items = new Map<string, string>();
  const base = recorder();
  return {
    ...base,
    async run(file, args, given) {
      base.calls.push([file, ...args]);
      base.options.push(given);
      const login = args[args.indexOf("-a") + 1]!;
      const value = items.get(login);
      if (value === undefined) throw new Error("exit 44");
      return { stdout: `${value}\n` };
    },
    async interactive(input) {
      base.inputs.push(input);
      if (options.failInteractive) throw new Error(`security exited 1: ${input}`);
      if (options.store === false) return;
      const match = /-a "([^"]*)" -w "([^"]*)"/.exec(input);
      if (match) items.set(match[1]!, match[2]!);
    },
  };
}

test("a stored token is read back without its trailing newline", async () => {
  const deps = recorder("sk-ant-oat01-example\n");
  assert.equal(await readMintedToken("alice@example.com", deps), "sk-ant-oat01-example");
  assert.deepEqual(deps.calls[0], [
    "security",
    "find-generic-password",
    "-s",
    MINTED_SERVICE,
    "-a",
    "alice@example.com",
    "-w",
  ]);
});

test("the service is the plugin's own, never Claude Code's", () => {
  assert.equal(MINTED_SERVICE, "paseo-claude-accounts");
});

test("a missing item reads as null rather than throwing", async () => {
  assert.equal(await readMintedToken("nobody@example.com", recorder("", true)), null);
});

test("an empty item reads as null", async () => {
  assert.equal(await readMintedToken("alice@example.com", recorder("\n")), null);
});

test("the read is bounded and killed with SIGKILL", async () => {
  const deps = recorder("sk-ant-oat01-example\n");
  await readMintedToken("alice@example.com", deps);
  assert.deepEqual(deps.options[0], { timeout: READ_TIMEOUT_MS, killSignal: "SIGKILL" });
});

test("a read killed by its own timeout is named, not folded into the absent case", async () => {
  const stuck: KeychainRunner = {
    async run() {
      const error = new Error("Command failed: security find-generic-password") as Error & {
        killed: boolean;
      };
      error.killed = true;
      throw error;
    },
    async interactive() {},
  };
  await assert.rejects(readMintedToken("alice@example.com", stuck), KeychainTimeout);
});

test("writing sends one quoted add-generic-password line through security -i", async () => {
  const deps = keychain();
  await writeMintedToken("alice@example.com", "sk-ant-oat01-new", deps);
  assert.deepEqual(deps.inputs, [
    `add-generic-password -U -s "${MINTED_SERVICE}" -a "alice@example.com" -w "sk-ant-oat01-new"\n`,
  ]);
  // The token never appears in a process argument list.
  assert.equal(deps.calls.flat().includes("sk-ant-oat01-new"), false);
});

test("quotes and backslashes in a value are escaped", async () => {
  const deps = keychain({ store: false });
  await writeMintedToken('a"b\\c', "sk-ant-oat01-x", deps).catch(() => {});
  assert.match(deps.inputs[0]!, /-a "a\\"b\\\\c" /);
});

test("a write is verified by reading it back", async () => {
  const deps = keychain();
  await writeMintedToken("alice@example.com", "sk-ant-oat01-new", deps);
  assert.deepEqual(deps.calls.at(-1), [
    "security",
    "find-generic-password",
    "-s",
    MINTED_SERVICE,
    "-a",
    "alice@example.com",
    "-w",
  ]);
  assert.equal(await readMintedToken("alice@example.com", deps), "sk-ant-oat01-new");
});

test("a write that did not stick throws without the token in the error", async () => {
  // `security -i` exits 0 even when the command inside it fails.
  const token = "sk-ant-oat01-secret";
  const deps = keychain({ store: false });
  const error = await writeMintedToken("alice@example.com", token, deps).then(
    () => null,
    (caught: unknown) => caught as Error,
  );
  assert.ok(error, "writeMintedToken should throw");
  assert.match(error.message, /alice@example\.com/);
  assert.equal(String(error).includes(token), false);
  assert.equal(JSON.stringify(error).includes(token), false);
});

test("a read-back with a different token is a failed write", async () => {
  const deps: KeychainRunner = {
    async run() {
      return { stdout: "sk-ant-oat01-older\n" };
    },
    async interactive() {},
  };
  await assert.rejects(writeMintedToken("alice@example.com", "sk-ant-oat01-new", deps), (error: Error) => {
    assert.equal(error.message.includes("sk-ant-oat01-new"), false);
    return true;
  });
});

test("a security -i failure re-throws scrubbed: the token never reaches the error", async () => {
  const token = "sk-ant-oat01-secret";
  const deps = keychain({ failInteractive: true });
  const error = await writeMintedToken("alice@example.com", token, deps).then(
    () => null,
    (caught: unknown) => caught as Error,
  );
  assert.ok(error);
  assert.equal(String(error).includes(token), false);
  assert.equal(String(error).includes("add-generic-password"), false);
  assert.equal(error.cause, undefined);
});

test("deleting a token that is not there is not an error", async () => {
  await deleteMintedToken("nobody@example.com", recorder("", true));
});

test("deleting names the plugin's service and the login", async () => {
  const deps = recorder();
  await deleteMintedToken("alice@example.com", deps);
  assert.deepEqual(deps.calls[0], [
    "security",
    "delete-generic-password",
    "-s",
    MINTED_SERVICE,
    "-a",
    "alice@example.com",
  ]);
});
