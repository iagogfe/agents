import { describe, expect, test } from "bun:test";
import {
  ChatwootApiError,
  createChatwootClient,
} from "@/modules/chatwoot/client";

interface Captured {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

function stub(status = 200, payload: unknown = {}) {
  const calls: Captured[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

const passthroughSafe = async (u: string) => new URL(u);
const baseConfig = {
  baseUrl: "https://chat.example.com",
  accountId: 5,
  adminToken: "ADMIN_TOK",
  botToken: "BOT_TOK",
};

describe("ChatwootClient", () => {
  test("createChatwootClient rejects an SSRF baseUrl", async () => {
    await expect(
      createChatwootClient({
        ...baseConfig,
        baseUrl: "https://169.254.169.254",
      }),
      // real SSRF guard (no assertSafe override)
    ).rejects.toThrow();
  });

  test("sendMessage uses the bot token and the right URL/body", async () => {
    const { fetchImpl, calls } = stub(200, { id: 1 });
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client.sendMessage(42, "olá");
    expect(calls[0]?.url).toBe(
      "https://chat.example.com/api/v1/accounts/5/conversations/42/messages",
    );
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.headers["api-access-token"]).toBe("BOT_TOK");
    expect(calls[0]?.body).toMatchObject({
      content: "olá",
      private: false,
      message_type: "outgoing",
    });
  });

  test("sendPrivateNote sets private:true", async () => {
    const { fetchImpl, calls } = stub();
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client.sendPrivateNote(42, "resumo para o humano");
    expect(calls[0]?.body).toMatchObject({ private: true });
  });

  test("handoff/assign and toggleStatus use the bot token", async () => {
    const { fetchImpl, calls } = stub();
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client.assignToAgent(42, 99);
    await client.toggleStatus(42, "open");
    expect(calls[0]?.url).toContain("/conversations/42/assignments");
    expect(calls[0]?.body).toMatchObject({ assignee_id: 99 });
    expect(calls[1]?.url).toContain("/conversations/42/toggle_status");
    expect(calls[1]?.headers["api-access-token"]).toBe("BOT_TOK");
  });

  test("asAdmin routes assign/unassign/toggleStatus through the admin token", async () => {
    const { fetchImpl, calls } = stub();
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    // Operator-initiated actions must be attributed to the instance admin, not the persona bot.
    await client.assignToAgent(42, 99, { asAdmin: true });
    await client.unassignConversation(42, { asAdmin: true });
    await client.toggleStatus(42, "pending", { asAdmin: true });
    expect(calls[0]?.headers["api-access-token"]).toBe("ADMIN_TOK");
    expect(calls[1]?.headers["api-access-token"]).toBe("ADMIN_TOK");
    expect(calls[2]?.headers["api-access-token"]).toBe("ADMIN_TOK");
  });

  test("unassignConversation posts assignee_id 0 with the bot token", async () => {
    const { fetchImpl, calls } = stub();
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client.unassignConversation(42);
    expect(calls[0]?.url).toContain("/conversations/42/assignments");
    expect(calls[0]?.body).toMatchObject({ assignee_id: 0 });
    expect(calls[0]?.headers["api-access-token"]).toBe("BOT_TOK");
  });

  test("toggleTyping uses the bot token (toggle_typing_status is bot-accessible)", async () => {
    const { fetchImpl, calls } = stub();
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client.toggleTyping(42, true);
    expect(calls[0]?.url).toContain("/conversations/42/toggle_typing_status");
    expect(calls[0]?.body).toMatchObject({ typing_status: "on" });
    expect(calls[0]?.headers["api-access-token"]).toBe("BOT_TOK");
  });

  test("read methods use the admin token", async () => {
    const { fetchImpl, calls } = stub(200, { id: 42 });
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client.getConversation(42);
    expect(calls[0]?.headers["api-access-token"]).toBe("ADMIN_TOK");
    expect(calls[0]?.method).toBe("GET");
  });

  test("Kanban driver uses the admin token and wraps the Rails root keys", async () => {
    const { fetchImpl, calls } = stub(200, {});
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client.createKanbanBoard({ name: "Funil" });
    await client.createKanbanStep(3, { name: "Lead" });
    await client.setBoardInboxes(3, [7, 8]);
    await client.setBoardAgents(3, [1]);
    await client.moveKanbanTask(99, 5, 100);

    expect(calls[0]?.url).toBe(
      "https://chat.example.com/api/v1/accounts/5/kanban/boards",
    );
    expect(calls[0]?.headers["api-access-token"]).toBe("ADMIN_TOK");
    expect(calls[0]?.body).toMatchObject({ board: { name: "Funil" } });
    expect(calls[1]?.url).toContain("/kanban/boards/3/steps");
    expect(calls[1]?.body).toMatchObject({ step: { name: "Lead" } });
    expect(calls[2]?.url).toContain("/kanban/boards/3/update_inboxes");
    expect(calls[2]?.body).toMatchObject({ inbox_ids: [7, 8] });
    expect(calls[3]?.body).toMatchObject({ agent_ids: [1] });
    expect(calls[4]?.url).toContain("/kanban/tasks/99/move");
    expect(calls[4]?.body).toMatchObject({
      board_step_id: 5,
      insert_before_task_id: 100,
    });
  });

  test("updateKanbanTask PATCHes only the provided fields (camel→snake) with the admin token", async () => {
    const { fetchImpl, calls } = stub(200, {});
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client.updateKanbanTask(99, {
      title: "Maria Souza",
      priority: "high",
      dueDate: "2026-06-20",
    });
    expect(calls[0]?.method).toBe("PATCH");
    expect(calls[0]?.url).toContain("/kanban/tasks/99");
    expect(calls[0]?.headers["api-access-token"]).toBe("ADMIN_TOK");
    expect(calls[0]?.body).toEqual({
      task: { title: "Maria Souza", priority: "high", due_date: "2026-06-20" },
    });
  });

  test("listLabels returns the payload titles (admin token)", async () => {
    const { fetchImpl, calls } = stub(200, {
      payload: [{ title: "lead" }, { title: "vip" }, { id: 3 }],
    });
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    expect(await client.listLabels()).toEqual(["lead", "vip"]);
    expect(calls[0]?.url).toContain("/api/v1/accounts/5/labels");
    expect(calls[0]?.headers["api-access-token"]).toBe("ADMIN_TOK");
  });

  test("listCustomAttributeDefinitions maps the fork shape", async () => {
    const { fetchImpl } = stub(200, [
      {
        attribute_key: "plano",
        attribute_display_name: "Plano",
        attribute_model: "contact_attribute",
        attribute_display_type: "list",
        attribute_values: ["Free", "Pro"],
      },
      { attribute_display_name: "no key" },
    ]);
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    const defs = await client.listCustomAttributeDefinitions();
    expect(defs).toEqual([
      {
        key: "plano",
        displayName: "Plano",
        model: "contact_attribute",
        displayType: "list",
        values: ["Free", "Pro"],
      },
    ]);
  });

  test("kanbanTaskIdForConversation reads the embedded kanban_task object's id", async () => {
    const withCard = await createChatwootClient(baseConfig, {
      fetchImpl: stub(200, { id: 1, kanban_task: { id: 11 } }).fetchImpl,
      assertSafe: passthroughSafe,
    });
    expect(await withCard.kanbanTaskIdForConversation(7)).toBe(11);
    const noCard = await createChatwootClient(baseConfig, {
      fetchImpl: stub(200, { id: 1, kanban_task: null }).fetchImpl,
      assertSafe: passthroughSafe,
    });
    expect(await noCard.kanbanTaskIdForConversation(7)).toBeNull();
  });

  test("kanbanTaskForConversation returns the embedded card object, or null", async () => {
    const withCard = await createChatwootClient(baseConfig, {
      fetchImpl: stub(200, {
        id: 1,
        kanban_task: { id: 11, board_id: 2, title: "Card" },
      }).fetchImpl,
      assertSafe: passthroughSafe,
    });
    expect(await withCard.kanbanTaskForConversation(7)).toMatchObject({
      id: 11,
      board_id: 2,
      title: "Card",
    });
    const noCard = await createChatwootClient(baseConfig, {
      fetchImpl: stub(200, { id: 1 }).fetchImpl,
      assertSafe: passthroughSafe,
    });
    expect(await noCard.kanbanTaskForConversation(7)).toBeNull();
  });

  test("listMessageTemplates maps approved templates, drops non-approved", async () => {
    const { fetchImpl, calls } = stub(200, {
      message_templates: [
        {
          name: "reengajamento",
          category: "MARKETING",
          language: "pt_BR",
          status: "approved",
        },
        {
          name: "rejeitado",
          category: "UTILITY",
          language: "pt_BR",
          status: "rejected",
        },
        { category: "UTILITY" },
      ],
    });
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    expect(await client.listMessageTemplates(8)).toEqual([
      { name: "reengajamento", category: "MARKETING", language: "pt_BR" },
    ]);
    expect(calls[0]?.url).toContain("/inboxes/8");
  });

  test("downloadAttachment retries while the media is not written yet (404)", async () => {
    // Chatwoot fires the webhook before Sidekiq writes the WhatsApp media to storage: the first
    // GETs 404 and a later one serves the file. Two 404s then a 200 ⇒ three calls, bytes returned.
    const statuses = [404, 404, 200];
    let call = 0;
    const fetchImpl = (async () => {
      const status = statuses[call++] ?? 200;
      return {
        ok: status === 200,
        status,
        arrayBuffer: async () => new ArrayBuffer(3),
        headers: { get: () => "audio/ogg" },
      } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    const out = await client.downloadAttachment(
      "https://chat.example.com/rails/active_storage/blobs/redirect/x/File.ogg",
    );
    expect(call).toBe(3);
    expect(out.bytes.byteLength).toBe(3);
    expect(out.contentType).toBe("audio/ogg");
  });

  // Walks the whole 1s+2s+4s backoff, so it needs more than the 5s default budget.
  test("downloadAttachment gives up after the retry budget on a persistent 404", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      return { ok: false, status: 404 } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    const err = await client
      .downloadAttachment("https://chat.example.com/x/File.ogg")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ChatwootApiError);
    expect((err as ChatwootApiError).status).toBe(404);
    expect(call).toBe(4); // first attempt + 3 retries
  }, 15_000);

  test("downloadAttachment does NOT retry a non-404 failure", async () => {
    let call = 0;
    const fetchImpl = (async () => {
      call++;
      return { ok: false, status: 403 } as unknown as Response;
    }) as unknown as typeof fetch;
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    await client
      .downloadAttachment("https://chat.example.com/x/File.ogg")
      .catch(() => {});
    expect(call).toBe(1);
  });

  test("throws ChatwootApiError (without body) on non-2xx", async () => {
    const { fetchImpl } = stub(403, { error: "nope" });
    const client = await createChatwootClient(baseConfig, {
      fetchImpl,
      assertSafe: passthroughSafe,
    });
    const err = await client.sendMessage(42, "x").catch((e) => e);
    expect(err).toBeInstanceOf(ChatwootApiError);
    expect((err as ChatwootApiError).status).toBe(403);
    expect((err as ChatwootApiError).message).not.toContain("nope");
  });
});
