import { describe, it, expect } from "vitest";
import { markdownToMrkdwn } from "./markdown-to-mrkdwn.js";

describe("markdownToMrkdwn", () => {
  it("converts markdown links to Slack links", () => {
    expect(markdownToMrkdwn("[Google](https://google.com)")).toBe(
      "<https://google.com|Google>",
    );
  });

  it("converts multiple links in one line", () => {
    const input = "Check [A](https://a.com) and [B](https://b.com)";
    expect(markdownToMrkdwn(input)).toBe(
      "Check <https://a.com|A> and <https://b.com|B>",
    );
  });

  it("converts bold **text** to *text*", () => {
    expect(markdownToMrkdwn("this is **bold** text")).toBe(
      "this is *bold* text",
    );
  });

  it("converts bold __text__ to *text*", () => {
    expect(markdownToMrkdwn("this is __bold__ text")).toBe(
      "this is *bold* text",
    );
  });

  it("converts strikethrough ~~text~~ to ~text~", () => {
    expect(markdownToMrkdwn("this is ~~deleted~~ text")).toBe(
      "this is ~deleted~ text",
    );
  });

  it("converts headings to bold", () => {
    expect(markdownToMrkdwn("# Heading 1")).toBe("*Heading 1*");
    expect(markdownToMrkdwn("## Heading 2")).toBe("*Heading 2*");
    expect(markdownToMrkdwn("### Heading 3")).toBe("*Heading 3*");
    expect(markdownToMrkdwn("###### Heading 6")).toBe("*Heading 6*");
  });

  it("converts multiline headings", () => {
    const input = "# Title\nSome text\n## Subtitle";
    expect(markdownToMrkdwn(input)).toBe("*Title*\nSome text\n*Subtitle*");
  });

  it("preserves block quotes", () => {
    expect(markdownToMrkdwn("> quoted text")).toBe("> quoted text");
  });

  it("preserves inline code", () => {
    expect(markdownToMrkdwn("use `**bold**` for bold")).toBe(
      "use `**bold**` for bold",
    );
  });

  it("preserves fenced code blocks", () => {
    const input = "before\n```\n[link](url)\n**bold**\n```\nafter";
    expect(markdownToMrkdwn(input)).toBe(
      "before\n```\n[link](url)\n**bold**\n```\nafter",
    );
  });

  it("preserves code blocks with language tag", () => {
    const input = "```js\nconst x = **y**;\n```";
    expect(markdownToMrkdwn(input)).toBe("```js\nconst x = **y**;\n```");
  });

  it("handles mixed content correctly", () => {
    const input = [
      "# Search Results",
      "",
      "Here are the results:",
      "",
      "1. [Example](https://example.com) - **great** site",
      "2. ~~old result~~ replaced",
      "",
      "```",
      "[not a link](url)",
      "```",
    ].join("\n");

    const expected = [
      "*Search Results*",
      "",
      "Here are the results:",
      "",
      "1. <https://example.com|Example> - *great* site",
      "2. ~old result~ replaced",
      "",
      "```",
      "[not a link](url)",
      "```",
    ].join("\n");

    expect(markdownToMrkdwn(input)).toBe(expected);
  });

  it("returns plain text unchanged", () => {
    expect(markdownToMrkdwn("hello world")).toBe("hello world");
  });

  it("handles empty string", () => {
    expect(markdownToMrkdwn("")).toBe("");
  });
});
