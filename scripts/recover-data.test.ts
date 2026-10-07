import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

// 前回の pipeline が殺された状態を一時ディレクトリの偽リポジトリで作り、recover-data.sh のあとに git pull が通ることを確かめる
const script = path.resolve(__dirname, "recover-data.sh");
let root: string;
let data: string;

const git = (cwd: string, ...args: string[]) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@example.invalid", ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

async function put(rel: string, body: string): Promise<void> {
  const file = path.join(data, rel);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, body);
}

const recover = () =>
  execFileSync("bash", [script, data], {
    encoding: "utf8",
    env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.invalid" },
  });

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "recover-"));
  git(root, "init", "-q", "--bare", "-b", "main", "origin.git");
  git(root, "clone", "-q", "origin.git", "data");
  data = path.join(root, "data");
  git(data, "checkout", "-q", "-b", "main");
  await put("index.json", "{}\n");
  await put("analysis/old.json", "{}\n");
  git(data, "add", "-A");
  git(data, "commit", "-q", "-m", "init");
  git(data, "push", "-q", "origin", "main");
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("recover-data.sh", () => {
  it("書き終えた解析結果はコミットし、他の残骸は捨てて git pull が通る", async () => {
    // 他の場所で進んだ origin
    git(root, "clone", "-q", "origin.git", "other");
    const other = path.join(root, "other");
    await writeFile(path.join(other, "remote.txt"), "x\n");
    git(other, "add", "-A");
    git(other, "commit", "-q", "-m", "remote");
    git(other, "push", "-q", "origin", "main");

    // 殺された実行の残骸
    await put("analysis/g1.json", '{"id":"g1"}\n');
    await put("analysis/g1.kif", "kif\n");
    await put("analysis/g2.json.tmp", "{bro");
    await put("analysis/index.json", "{}\n");
    await put("analysis/old.json", '{"re":1}\n');
    await put("games/new.json", "{}\n");
    await put("index.json", '{"changed":1}\n');

    expect(() => git(data, "pull", "-q", "--rebase", "origin", "main")).toThrow();
    recover();
    expect(git(data, "status", "--porcelain")).toBe("");
    git(data, "pull", "-q", "--rebase", "origin", "main");

    expect(await readFile(path.join(data, "analysis/g1.json"), "utf8")).toBe('{"id":"g1"}\n');
    expect(await readFile(path.join(data, "analysis/old.json"), "utf8")).toBe('{"re":1}\n');
    expect(existsSync(path.join(data, "analysis/g1.kif"))).toBe(true);
    expect(existsSync(path.join(data, "analysis/g2.json.tmp"))).toBe(false);
    expect(existsSync(path.join(data, "analysis/index.json"))).toBe(false);
    expect(existsSync(path.join(data, "games/new.json"))).toBe(false);
    expect(await readFile(path.join(data, "index.json"), "utf8")).toBe("{}\n");
    expect(existsSync(path.join(data, "remote.txt"))).toBe(true);
    expect(git(data, "log", "--format=%s", "-2")).toContain("前回中断した実行の解析結果");
  });

  it("残骸が無ければ何もしない", async () => {
    const before = git(data, "rev-parse", "HEAD");
    recover();
    expect(git(data, "rev-parse", "HEAD")).toBe(before);
  });

  it("rebase の途中で殺されていたら中止して main に戻す", async () => {
    git(root, "clone", "-q", "origin.git", "other");
    const other = path.join(root, "other");
    await writeFile(path.join(other, "index.json"), '{"remote":1}\n');
    git(other, "commit", "-q", "-am", "remote");
    git(other, "push", "-q", "origin", "main");
    await put("index.json", '{"local":1}\n');
    git(data, "commit", "-q", "-am", "local");
    expect(() => git(data, "pull", "-q", "--rebase", "origin", "main")).toThrow();

    recover();
    expect(git(data, "status", "--porcelain")).toBe("");
    expect(git(data, "rev-parse", "--abbrev-ref", "HEAD").trim()).toBe("main");
  });
});
