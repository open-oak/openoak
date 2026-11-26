import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { Editor } from "@tiptap/core";
import { generateHTML } from "@tiptap/html/server";

import {
  createNoteContentExtensions,
  createNoteEditorExtensions,
  noteBodyToEditorContent,
} from "../lib/note-markdown.ts";
import { storedNoteBodyToMarkdown } from "../lib/note-markdown-server.ts";
import { plainTextFromNoteBody, statisticTextFromNoteBody } from "../lib/notes-view.ts";

const globalStyles = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

test("editor caret follows the readable foreground color in every theme", () => {
  assert.match(
    globalStyles,
    /\.notes-editor-content\s*\{\s*caret-color:\s*var\(--foreground\);/,
  );
});

test("text selection follows a visible foreground-derived color in every theme", () => {
  assert.match(
    globalStyles,
    /\.notes-root ::selection\s*\{\s*background:\s*color-mix\(in oklab, var\(--foreground\) 24%, transparent\);/,
  );
});

test("plain stored notes are loaded as markdown", () => {
  assert.deepEqual(noteBodyToEditorContent("one\n<script>"), {
    content: "one\n<script>",
    contentType: "markdown",
  });
});

test("markdown round-trips every toolbar-supported format", () => {
  const source = [
    "## Plan",
    "",
    "**bold** *italic* <u>underlined</u> [link](https://example.com)",
    "",
    "- one",
    "- two",
    "",
    "1. first",
    "2. second",
    "",
    "- [ ] open",
    "  - [x] nested",
    "- [x] done",
    "",
    "```ts",
    "const ready = true",
    "```",
  ].join("\n");
  const editor = new Editor({
    extensions: createNoteEditorExtensions(),
    content: source,
    contentType: "markdown",
  });

  assert.equal(editor.getMarkdown(), source);
  editor.destroy();
});

test("legacy rich text converts lazily to markdown", () => {
  const extensions = createNoteContentExtensions();
  const markdown = "**Plan**\n\n- [ ] Review";
  const editor = new Editor({
    extensions: createNoteEditorExtensions(),
    content: markdown,
    contentType: "markdown",
  });
  const legacy = `<!--open-outline-rich-text-->${generateHTML(editor.getJSON(), extensions)}`;
  editor.destroy();

  assert.equal(storedNoteBodyToMarkdown(legacy), markdown);
  assert.equal(plainTextFromNoteBody(legacy), "Plan\n☐ Review");
  assert.equal(statisticTextFromNoteBody(legacy), "Plan\nReview");
});

test("markdown is reduced to readable text for excerpts and statistics", () => {
  const body = "## Plan\n\n- [ ] Review\n\n**Bold** and <u>underlined</u>";
  assert.equal(plainTextFromNoteBody(body), "Plan\n☐ Review\nBold and underlined");
  assert.equal(statisticTextFromNoteBody(body), "Plan\nReview\nBold and underlined");
});
