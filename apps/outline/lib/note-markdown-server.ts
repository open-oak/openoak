import { generateJSON } from "@tiptap/html/server";
import { MarkdownManager } from "@tiptap/markdown";
import {
  RICH_TEXT_PREFIX,
  createNoteContentExtensions,
} from "./note-markdown.ts";

export function storedNoteBodyToMarkdown(body: string) {
  if (!body.startsWith(RICH_TEXT_PREFIX)) return body;

  const extensions = createNoteContentExtensions();
  const document = generateJSON(body.slice(RICH_TEXT_PREFIX.length), extensions);
  const manager = new MarkdownManager({
    extensions,
    markedOptions: { gfm: true, breaks: false },
  });
  return manager.serialize(document);
}
