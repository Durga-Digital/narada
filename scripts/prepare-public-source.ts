import { execFileSync } from "node:child_process";
import { mkdirSync, existsSync, lstatSync, copyFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

// Export only source known to Git, plus new non-ignored files. Never copies old Git objects.
const root = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const destination = resolve(root, ".local/public-source");
if (existsSync(destination))
  throw new Error(
    ".local/public-source already exists; inspect and move it before preparing a replacement",
  );
const files = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
  { cwd: root },
)
  .toString()
  .split("\0")
  .filter(Boolean);
mkdirSync(destination, { recursive: true, mode: 0o700 });
let count = 0;
for (const file of new Set(files)) {
  if (
    file.startsWith("/") ||
    file.split("/").includes("..") ||
    /^(?:\.git\/|\.local\/|node_modules\/|cdk\.out\/|narada\.deploy\.json$)/.test(
      file,
    ) ||
    (/^\.env(?:\.|$)/.test(file) && file !== ".env.example") ||
    /\.(?:pem|key)$/.test(file)
  )
    throw new Error(`Refusing private or unsafe path: ${file}`);
  const source = resolve(root, file);
  if (!existsSync(source)) continue; // staged or unstaged deletions
  if (!lstatSync(source).isFile())
    throw new Error(`Refusing non-regular source file: ${file}`);
  const target = resolve(destination, file);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(source, target);
  count++;
}
console.log(
  `Prepared ${count} source files at ${destination}. No history, remote or credentials were copied.`,
);
