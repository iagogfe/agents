import { describe, expect, test } from "bun:test";
import { AIMessage } from "@langchain/core/messages";
import { lastAssistantText } from "@/graph/graph";

describe("lastAssistantText reasoning-leak guard", () => {
  test("plain reply passes through", () => {
    expect(lastAssistantText([new AIMessage("O corte é R$ 65.")])).toBe(
      "O corte é R$ 65.",
    );
  });

  test("strips a complete <think> block", () => {
    expect(
      lastAssistantText([
        new AIMessage("<think>preço é 65, ser breve</think>O corte é R$ 65."),
      ]),
    ).toBe("O corte é R$ 65.");
  });

  test("strips leaked reasoning before an orphan </think> (the OpenRouter gemini case)", () => {
    expect(
      lastAssistantText([
        new AIMessage(
          "O corte de cabelo é R$ 65, Iago.\n\nQuer marcar um horário?\n</think>O corte de cabelo é R$ 65, Iago.\n\nQuer marcar um horário?",
        ),
      ]),
    ).toBe("O corte de cabelo é R$ 65, Iago.\n\nQuer marcar um horário?");
  });

  test("array-of-blocks content is joined before stripping", () => {
    expect(
      lastAssistantText([
        new AIMessage({
          content: [
            { type: "text", text: "raciocínio</think>" },
            { type: "text", text: "resposta final" },
          ],
        }),
      ]),
    ).toBe("resposta final");
  });

  test("content that is only reasoning becomes empty (suppressed, not leaked)", () => {
    expect(
      lastAssistantText([new AIMessage("<think>só pensamento</think>")]),
    ).toBe("");
  });
});
