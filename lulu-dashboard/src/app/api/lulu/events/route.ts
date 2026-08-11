import { LULU_API_BASE_URL } from "@/lib/lulu-api";

const encoder = new TextEncoder();

export const dynamic = "force-dynamic";

export async function GET() {
  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const push = async () => {
        const health = await getHealthSnapshot();
        if (closed) return;
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
        closed = true;
        controller.close();
      };

      void push();
    },
    cancel() {
      closed = true;
      // The browser may close the request before the health check returns.
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
  const timeout = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(`${LULU_API_BASE_URL}/health`, {
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
