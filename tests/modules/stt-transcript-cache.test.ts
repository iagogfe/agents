import { beforeEach, describe, expect, test } from "bun:test";
import { parseChatwootMessages } from "@/modules/chatwoot/messages";
import {
  __clearTranscriptionCache,
  recallTranscription,
  rememberTranscription,
} from "@/modules/stt/transcript-cache";

// A Chatwoot messages page carrying one voice note with NO transcribed_text in the attachment meta —
// what upstream Chatwoot returns after the write-back 404s.
const pageWithUntranscribedAudio = {
  payload: [
    {
      id: 40,
      content: "",
      message_type: 0,
      attachments: [{ id: 7, file_type: "audio", meta: null }],
    },
  ],
};

describe("transcription cache (write-back fallback)", () => {
  beforeEach(() => {
    __clearTranscriptionCache();
  });

  test("remembers and recalls a transcription by message id", () => {
    rememberTranscription(40, "quero marcar um corte pra sexta");
    expect(recallTranscription(40)).toBe("quero marcar um corte pra sexta");
    expect(recallTranscription(41)).toBeNull();
  });

  test("ignores an empty text or a non-positive message id", () => {
    rememberTranscription(40, "");
    rememberTranscription(0, "x");
    rememberTranscription(-1, "x");
    expect(recallTranscription(40)).toBeNull();
    expect(recallTranscription(0)).toBeNull();
  });

  test("the messages page falls back to the cache when the meta is missing", () => {
    rememberTranscription(40, "boa noite, queria cortar o cabelo");
    const [row] = parseChatwootMessages(pageWithUntranscribedAudio);
    expect(row?.transcribedText).toBe("boa noite, queria cortar o cabelo");
  });

  test("without a cached entry the row stays untranscribed", () => {
    const [row] = parseChatwootMessages(pageWithUntranscribedAudio);
    expect(row?.transcribedText).toBeNull();
  });

  test("the Chatwoot meta wins over the cache", () => {
    rememberTranscription(40, "valor do cache");
    const [row] = parseChatwootMessages({
      payload: [
        {
          id: 40,
          content: "",
          message_type: 0,
          attachments: [
            {
              id: 7,
              file_type: "audio",
              meta: { transcribed_text: "valor do chatwoot" },
            },
          ],
        },
      ],
    });
    expect(row?.transcribedText).toBe("valor do chatwoot");
  });
});
