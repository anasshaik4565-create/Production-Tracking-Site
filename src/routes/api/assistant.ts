import { createFileRoute } from "@tanstack/react-router";

import { handleAssistantChat } from "@/lib/assistant/handler.server";

export const Route = createFileRoute("/api/assistant")({
  server: { handlers: { POST: ({ request }) => handleAssistantChat(request) } },
});
