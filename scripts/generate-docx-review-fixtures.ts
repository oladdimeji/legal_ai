import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { Packer } from "docx";
import { markdownToDocxDocument } from "../server/docxMarkdown.js";

const sourceDirectory = path.resolve("tests/fixtures/docx");
const outputDirectory = path.resolve("tmp/docx-review");
await mkdir(outputDirectory, { recursive: true });

const fixtureNames = (await readdir(sourceDirectory)).filter((name) => name.endsWith(".md")).sort();
for (const fixtureName of fixtureNames) {
  const markdown = await readFile(path.join(sourceDirectory, fixtureName), "utf8");
  const title = fixtureName.replace(/\.md$/, "").replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  const outputPath = path.join(outputDirectory, fixtureName.replace(/\.md$/, ".docx"));
  const buffer = await Packer.toBuffer(markdownToDocxDocument(title, markdown));
  await writeFile(outputPath, buffer);
  console.log(outputPath);
}

