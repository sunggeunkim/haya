import { describe, it, expect, vi } from "vitest";
import { MediaPipeline } from "./pipeline.js";
import type { MediaAttachment } from "./pipeline.js";

describe("MediaPipeline", () => {
  const pipeline = new MediaPipeline();

  describe("process", () => {
    it("returns originalSize 0 when no buffer or url is provided", async () => {
      const attachment: MediaAttachment = {
        type: "image",
        mimeType: "image/png",
      };

      const result = await pipeline.process(attachment);

      expect(result.type).toBe("image");
      expect(result.originalSize).toBe(0);
    });

    it("processes image buffer without sharp (returns original size)", async () => {
      const buffer = Buffer.from("fake-image-data");
      const attachment: MediaAttachment = {
        type: "image",
        buffer,
        mimeType: "image/png",
      };

      const result = await pipeline.process(attachment);

      expect(result.type).toBe("image");
      expect(result.originalSize).toBe(buffer.length);
      // Without sharp installed, no thumbnail is created
      expect(result.thumbnailBuffer).toBeUndefined();
    });

    it("processes audio buffer (returns metadata only)", async () => {
      const buffer = Buffer.from("fake-audio-data");
      const attachment: MediaAttachment = {
        type: "audio",
        buffer,
        mimeType: "audio/mp3",
      };

      const result = await pipeline.process(attachment);

      expect(result.type).toBe("audio");
      expect(result.originalSize).toBe(buffer.length);
    });

    it("processes PDF buffer and extracts text from Tj operators", async () => {
      // Build a minimal PDF-like buffer with text in Tj operators
      const pdfContent = [
        "%PDF-1.4",
        "stream",
        "(Hello) Tj",
        "(World) Tj",
        "endstream",
      ].join("\n");
      const buffer = Buffer.from(pdfContent, "latin1");

      const attachment: MediaAttachment = {
        type: "pdf",
        buffer,
        mimeType: "application/pdf",
      };

      const result = await pipeline.process(attachment);

      expect(result.type).toBe("pdf");
      expect(result.originalSize).toBe(buffer.length);
      expect(result.textContent).toBe("Hello World");
    });

    it("returns undefined textContent for PDF without extractable text", async () => {
      const buffer = Buffer.from("%PDF-1.4\nsome binary data", "latin1");
      const attachment: MediaAttachment = {
        type: "pdf",
        buffer,
        mimeType: "application/pdf",
      };

      const result = await pipeline.process(attachment);

      expect(result.type).toBe("pdf");
      expect(result.textContent).toBeUndefined();
    });

    it("handles generic file type by returning size only", async () => {
      const buffer = Buffer.from("some-file-data");
      const attachment: MediaAttachment = {
        type: "file",
        buffer,
        mimeType: "application/octet-stream",
      };

      const result = await pipeline.process(attachment);

      expect(result.type).toBe("file");
      expect(result.originalSize).toBe(buffer.length);
    });

    it("fetches URL when buffer is not provided", async () => {
      const fakeData = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

      // Mock global fetch
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        arrayBuffer: () => Promise.resolve(fakeData.buffer.slice(0, fakeData.byteLength)),
      });
      vi.stubGlobal("fetch", mockFetch);

      const attachment: MediaAttachment = {
        type: "file",
        url: "https://example.com/file.dat",
        mimeType: "application/octet-stream",
      };

      const result = await pipeline.process(attachment);

      expect(mockFetch).toHaveBeenCalledWith(
        "https://example.com/file.dat",
        expect.objectContaining({ signal: expect.any(AbortSignal) }),
      );
      expect(result.originalSize).toBe(fakeData.byteLength);

      vi.unstubAllGlobals();
    });

    it("throws on fetch error for URL-based attachment", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
      });
      vi.stubGlobal("fetch", mockFetch);

      const attachment: MediaAttachment = {
        type: "file",
        url: "https://example.com/missing.dat",
        mimeType: "application/octet-stream",
      };

      await expect(pipeline.process(attachment)).rejects.toThrow(
        "Failed to fetch media: HTTP 404",
      );

      vi.unstubAllGlobals();
    });
  });
});
