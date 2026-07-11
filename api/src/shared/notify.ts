// Outbound notification hook (spec nice-to-have). Fire-and-forget POST to a
// configured webhook (e.g. a Slack/Teams incoming webhook or an internal relay)
// when a new access request needs admin attention. Never throws into the request
// path; a missing/unreachable webhook is a no-op.
export interface NotifyEvent {
  event: string;
  text: string;
  meta?: Record<string, unknown>;
}

export async function notify(
  webhookUrl: string | undefined, ev: NotifyEvent, fetchImpl: typeof fetch = fetch,
): Promise<void> {
  if (!webhookUrl) return;
  try {
    await fetchImpl(webhookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      // "text" is the field Slack/Teams incoming webhooks render; meta is extra context.
      body: JSON.stringify({ text: ev.text, event: ev.event, ...ev.meta }),
    });
  } catch {
    /* best-effort */
  }
}
