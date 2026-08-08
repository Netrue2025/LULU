const encoder = new TextEncoder();
const LULU_BASE_URL = process.env.LULU_API_BASE_URL ?? "http://127.0.0.1:8000";

export const dynamic = "force-dynamic";

export async function GET() {
  const stream = new ReadableStream({
    start(controller) {
      const push = async () => {
        const health = await getHealthSnapshot();
        const status = health?.status === "online" ? "online" : "offline";
        const event = {
          id: `evt-${Date.now()}`,
          timestamp: new Date().toISOString(),
          type: status === "online" ? "heartbeat" : "error",
          description:
            status === "online"
              ? "LULU health check completed"
              : "LULU server is not reachable"
        };

        controller.enqueue(encoder.encode(`event: lulu\n`));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        controller.close();
      };

      void push();
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}

async function getHealthSnapshot() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(`${LULU_BASE_URL}/health`, {
      cache: "no-store",
      signal: controller.signal
    });
    return { status: response.ok ? "online" : "offline" };
  } catch {
    return { status: "offline" };
  } finally {
    clearTimeout(timeout);
  }
}
