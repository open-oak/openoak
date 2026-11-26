import type { JSONContent, MarkdownParseHelpers, MarkdownToken } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import Underline from "@tiptap/extension-underline";
import { Markdown, MarkdownManager } from "@tiptap/markdown";

export const RICH_TEXT_PREFIX = "<!--open-outline-rich-text-->";

const MarkdownUnderline = Underline.extend({
  renderMarkdown(node, helpers) {
    return `<u>${helpers.renderChildren(node)}</u>`;
  },
  markdownTokenizer: {
    name: "underline",
    level: "inline",
    start(source) {
      return source.toLowerCase().indexOf("<u>");
    },
    tokenize(source, _tokens, lexer) {
      const match = /^<u>([\s\S]+?)<\/u>/i.exec(source);
      if (!match) return undefined;

      return {
        type: "underline",
        raw: match[0],
        text: match[1],
        tokens: lexer.inlineTokens(match[1]),
      };
    },
  },
  parseMarkdown(token: MarkdownToken, helpers: MarkdownParseHelpers) {
    return helpers.applyMark("underline", helpers.parseInline(token.tokens || []));
  },
});

export function createNoteContentExtensions() {
  return [
    StarterKit.configure({
      link: { openOnClick: false },
      underline: false,
    }),
    MarkdownUnderline,
    TaskList,
    TaskItem.configure({ nested: true }),
  ];
}

export function createNoteEditorExtensions() {
  return [
    ...createNoteContentExtensions(),
    Markdown.configure({
      indentation: { style: "space", size: 2 },
      markedOptions: { gfm: true, breaks: false },
    }),
  ];
}

export function noteBodyToEditorContent(body: string): {
  content: string;
  contentType: "html" | "markdown";
} {
  if (body.startsWith(RICH_TEXT_PREFIX)) {
    return { content: body.slice(RICH_TEXT_PREFIX.length), contentType: "html" };
  }
  return { content: body, contentType: "markdown" };
}

function decodeHtmlEntities(value: string) {
  return value
    .replaceAll("&nbsp;", " ")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&#39;", "'");
}

function plainTextFromLegacyHtml(html: string) {
  return decodeHtmlEntities(
    html
      .replace(/<li\b[^>]*data-checked="true"[^>]*>/gi, "☑ ")
      .replace(/<li\b[^>]*data-checked="false"[^>]*>/gi, "☐ ")
      .replace(/<br\s*\/?\s*>/gi, "\n")
      .replace(/<\/\s*(p|div|h[1-6]|blockquote|li)\s*>/gi, "\n")
      .replace(/<[^>]+>/g, "")
      .replace(/\n{2,}/g, "\n")
      .trimEnd(),
  );
}

function renderPlainText(node: JSONContent): string {
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";

  const children = (node.content || []).map(renderPlainText).join("");
  if (node.type === "taskItem") {
    return `${node.attrs?.checked ? "☑" : "☐"} ${children.trim()}\n`;
  }

  if (["paragraph", "heading", "blockquote", "listItem", "codeBlock"].includes(node.type || "")) {
    return `${children}\n`;
  }

  return children;
}

export function plainTextFromMarkdown(markdown: string) {
  if (!markdown) return "";
  const manager = new MarkdownManager({
    extensions: createNoteContentExtensions(),
    markedOptions: { gfm: true, breaks: false },
  });
  return renderPlainText(manager.parse(markdown))
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trimEnd();
}

export function plainTextFromStoredNoteBody(body: string) {
  if (body.startsWith(RICH_TEXT_PREFIX)) {
    return plainTextFromLegacyHtml(body.slice(RICH_TEXT_PREFIX.length));
  }
  return plainTextFromMarkdown(body);
}
