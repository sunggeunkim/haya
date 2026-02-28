import type { BuiltinTool } from "./builtin-tools.js";

const REQUEST_TIMEOUT_MS = 10_000;
const BIBLE_TOPIC_API_URL = "https://biblebytopic.com/api";

// ---------------------------------------------------------------------------
// Response interfaces
// ---------------------------------------------------------------------------

interface TopicEntry {
  topicid: string;
  topicname: string;
  topickeywords: string;
}

interface TopicsResponse {
  response_code: number;
  topics: TopicEntry[];
}

interface TopicVerse {
  fullpassage: string;
  book: number;
  bookname: string;
  chapter: number;
  startingverse: number;
  endingverse: number;
  singleverse: string;
  upvotes: number;
  "text-kjv"?: string;
  "text-web"?: string;
  "text-ulb"?: string;
  "text-net"?: string;
}

interface TopicVersesResponse {
  response_code: number;
  topicid: number;
  topic: string;
  keywords: string;
  verses: TopicVerse[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/** Creates Bible-by-topic tools (biblebytopic.com, no API key needed). */
export function createBibleTopicTools(): BuiltinTool[] {
  return [
    // ----- bible_topics_list -----
    {
      name: "bible_topics_list",
      description:
        "List all available Bible topics from BibleByTopic.com. " +
        "Returns topic names with IDs and keywords. Use the topic ID with bible_topic_verses to get verses.",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          search: {
            type: "string",
            description:
              "Optional keyword to filter topics (case-insensitive match on name or keywords)",
          },
        },
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const url = `${BIBLE_TOPIC_API_URL}/gettopics`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `BibleByTopic API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as TopicsResponse;

        if (!data.topics || data.topics.length === 0) {
          return "No topics available.";
        }

        let topics = data.topics;
        const search = args.search as string | undefined;
        if (search) {
          const lower = search.toLowerCase();
          topics = topics.filter(
            (t) =>
              t.topicname.toLowerCase().includes(lower) ||
              t.topickeywords.toLowerCase().includes(lower),
          );
        }

        if (topics.length === 0) {
          return `No topics found matching "${search}".`;
        }

        const lines: string[] = [
          `Bible Topics (${topics.length} found):`,
          "",
        ];

        for (const topic of topics) {
          const keywords = topic.topickeywords
            ? ` — ${topic.topickeywords}`
            : "";
          lines.push(`${topic.topicid}. ${topic.topicname}${keywords}`);
        }

        return lines.join("\n");
      },
    },

    // ----- bible_topic_verses -----
    {
      name: "bible_topic_verses",
      description:
        "Get Bible verses for a specific topic from BibleByTopic.com. " +
        "Provide a topic ID (from bible_topics_list) to retrieve relevant verses in multiple translations (KJV, WEB, ULB).",
      defaultPolicy: "allow",
      parameters: {
        type: "object",
        properties: {
          topic_id: {
            type: "number",
            description:
              "Topic ID from the bible_topics_list tool",
          },
          translation: {
            type: "string",
            description:
              'Preferred translation to display: "kjv", "web", "ulb", or "net" (default: "kjv")',
          },
          max_results: {
            type: "number",
            description:
              "Maximum number of verses to return (default: 10, max: 30)",
          },
        },
        required: ["topic_id"],
      },
      async execute(args: Record<string, unknown>): Promise<string> {
        const topicId = args.topic_id as number | undefined;
        if (topicId == null) {
          throw new Error("The 'topic_id' parameter is required.");
        }

        const url = `${BIBLE_TOPIC_API_URL}/getversesfortopic/${topicId}`;

        const response = await fetch(url, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });

        if (!response.ok) {
          throw new Error(
            `BibleByTopic API HTTP ${response.status}: ${response.statusText}`,
          );
        }

        const data = (await response.json()) as TopicVersesResponse;

        if (!data.verses || data.verses.length === 0) {
          return `No verses found for topic ID ${topicId}.`;
        }

        const translation = ((args.translation as string) ?? "kjv").toLowerCase();
        const rawMax = (args.max_results as number) ?? 10;
        const maxResults = Math.min(Math.max(1, rawMax), 30);
        const textKey = `text-${translation}` as keyof TopicVerse;

        const lines: string[] = [
          `Topic: ${data.topic}`,
          ...(data.keywords ? [`Keywords: ${data.keywords}`] : []),
          `Showing ${Math.min(maxResults, data.verses.length)} of ${data.verses.length} verses (${translation.toUpperCase()}):`,
          "",
        ];

        const verses = data.verses.slice(0, maxResults);
        for (let i = 0; i < verses.length; i++) {
          const v = verses[i];
          const text =
            (v[textKey] as string | undefined) ??
            v["text-kjv"] ??
            "(text not available)";
          const cleanText = text.replace(/<\/?[^>]+(>|$)/g, "").trim();
          lines.push(`${i + 1}. ${v.fullpassage}`);
          lines.push(`   ${cleanText}`);
          lines.push("");
        }

        return lines.join("\n").trimEnd();
      },
    },
  ];
}
