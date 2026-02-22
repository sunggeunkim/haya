import { createLogger } from "../infra/logger.js";

const log = createLogger("media-pipeline");

export interface MediaAttachment {
  type: "image" | "audio" | "pdf" | "file";
  url?: string;
  buffer?: Buffer;
  mimeType: string;
  filename?: string;
}

export interface ProcessedMedia {
  type: MediaAttachment["type"];
  textContent?: string;
  thumbnailBuffer?: Buffer;
  originalSize: number;
  processedSize?: number;
}

/**
 * Process media attachments, extracting text and creating thumbnails.
 * All media processors are optional peer dependencies.
 */
export class MediaPipeline {
  /**
   * Process a media attachment. Returns extracted text or processed media.
   */
  async process(attachment: MediaAttachment): Promise<ProcessedMedia> {
    const buffer =
      attachment.buffer ??
      (attachment.url ? await this.fetchUrl(attachment.url) : null);
    if (!buffer) {
      return { type: attachment.type, originalSize: 0 };
    }

    switch (attachment.type) {
      case "image":
        return this.processImage(buffer);
      case "audio":
        return this.processAudio(buffer);
      case "pdf":
        return this.processPdf(buffer);
      default:
        return { type: attachment.type, originalSize: buffer.length };
    }
  }

  private async processImage(buffer: Buffer): Promise<ProcessedMedia> {
    try {
      // Try to use sharp for image resizing (optional peer dep)
      const sharp = await import("sharp").catch(() => null);
      if (sharp) {
        const resized = await sharp
          .default(buffer)
          .resize(800, 800, { fit: "inside", withoutEnlargement: true })
          .toBuffer();
        return {
          type: "image",
          thumbnailBuffer: resized,
          originalSize: buffer.length,
          processedSize: resized.length,
        };
      }
    } catch {
      log.debug("sharp not available, skipping image processing");
    }
    return { type: "image", originalSize: buffer.length };
  }

  private async processAudio(buffer: Buffer): Promise<ProcessedMedia> {
    // Audio transcription via Whisper API would require API key
    log.debug("Audio transcription not yet implemented");
    return { type: "audio", originalSize: buffer.length };
  }

  private async processPdf(buffer: Buffer): Promise<ProcessedMedia> {
    const text = this.extractPdfText(buffer);
    return {
      type: "pdf",
      textContent: text || undefined,
      originalSize: buffer.length,
    };
  }

  /**
   * Basic PDF text extraction -- finds text between stream/endstream markers.
   * For production use, consider pdf-parse as optional dependency.
   */
  private extractPdfText(buffer: Buffer): string {
    const content = buffer.toString("latin1");
    const textParts: string[] = [];

    // Simple extraction of text objects from PDF streams
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    while ((match = streamRegex.exec(content)) !== null) {
      const stream = match[1]!;
      // Extract text between parentheses in Tj operators
      const textRegex = /\(([^)]*)\)\s*Tj/g;
      let textMatch: RegExpExecArray | null;
      while ((textMatch = textRegex.exec(stream)) !== null) {
        textParts.push(textMatch[1]!);
      }
    }

    return textParts.join(" ").trim();
  }

  private async fetchUrl(url: string): Promise<Buffer> {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Failed to fetch media: HTTP ${response.status}`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }
}
