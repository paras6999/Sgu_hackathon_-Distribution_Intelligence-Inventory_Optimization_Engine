/** The repo-root .env is read explicitly (Bun only loads the .env of its own working directory). */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDotEnv } from "../src/env";

const keys = ["T_PLAIN", "T_QUOTED", "T_SINGLE", "T_COMMENT", "T_KEEP", "T_EQ"];
afterEach(() => keys.forEach((k) => delete process.env[k]));

test("parses KEY=VALUE, quotes and comments, and never overrides an existing variable", () => {
  const f = join(mkdtempSync(join(tmpdir(), "env-")), ".env");
  writeFileSync(f, ['# a comment', 'T_PLAIN=abc', 'T_QUOTED="with spaces"', "T_SINGLE='x y'", 'T_COMMENT=value # trailing', 'T_KEEP=file', 'T_EQ=a=b=c', '', 'not a pair'].join("\r\n"));
  process.env.T_KEEP = "shell";
  expect(loadDotEnv(f)).toBe(5);
  expect(process.env).toMatchObject({ T_PLAIN: "abc", T_QUOTED: "with spaces", T_SINGLE: "x y", T_COMMENT: "value", T_KEEP: "shell", T_EQ: "a=b=c" });
});

test("a missing file is fine", () => { expect(loadDotEnv(join(tmpdir(), "nope", ".env"))).toBe(0); });
