/**
 * Convert standard markdown to Slack mrkdwn format.
 *
 * Preserves fenced code blocks and inline code — conversion rules
 * are only applied outside of backtick-delimited regions.
 */
export function markdownToMrkdwn(text: string): string {
  // Split text into protected (code) and unprotected segments.
  // Protected segments are fenced code blocks (```…```) and inline code (`…`).
  const segments: Array<{ text: string; protected: boolean }> = [];
  // Match fenced code blocks first, then inline code
  const codePattern = /(```[\s\S]*?```|`[^`]+`)/g;
  let lastIndex = 0;

  for (const match of text.matchAll(codePattern)) {
    const idx = match.index!;
    if (idx > lastIndex) {
      segments.push({ text: text.slice(lastIndex, idx), protected: false });
    }
    segments.push({ text: match[0], protected: true });
    lastIndex = idx + match[0].length;
  }

  if (lastIndex < text.length) {
    segments.push({ text: text.slice(lastIndex), protected: false });
  }

  // Convert only unprotected segments
  const converted = segments.map((seg) => {
    if (seg.protected) return seg.text;
    return convertSegment(seg.text);
  });

  return converted.join("");
}

function convertSegment(text: string): string {
  let result = text;

  // Links: [text](url) → <url|text>
  result = result.replace(/\[([^\]]+)\]\(([^)]+)\)/g, "<$2|$1>");

  // Bold: **text** or __text__ → *text*
  result = result.replace(/\*\*(.+?)\*\*/g, "*$1*");
  result = result.replace(/__(.+?)__/g, "*$1*");

  // Strikethrough: ~~text~~ → ~text~
  result = result.replace(/~~(.+?)~~/g, "~$1~");

  // Headings: ^#{1,6} text → *text* (bold in mrkdwn)
  result = result.replace(/^#{1,6}\s+(.+)$/gm, "*$1*");

  return result;
}
