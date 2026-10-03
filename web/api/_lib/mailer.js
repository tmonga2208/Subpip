// Email through Resend's HTTP API (resend.com). Returns null when not
// configured, so callers can degrade instead of crashing.
import crypto from 'node:crypto';

const ENDPOINT = 'https://api.resend.com/emails';
// A hung request must not outlive the function
const TIMEOUT_MS = 10000;
// Resend takes only a few requests a second: one more try after a pause
const RETRY_AFTER_MS = 1000;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// from: an address on a domain verified in Resend, with or without a name
export function createMailer({ apiKey, from, replyTo, fetch = globalThis.fetch, wait = pause, timeoutMs = TIMEOUT_MS }) {
  if (!apiKey || !from) return null;
  const sender = from.includes('<') ? from : `SubPIP <${from}>`;

  async function post(body) {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
    const reply = await response.json().catch(() => ({}));
    if (response.ok) return { id: reply.id };
    const error = new Error(`Resend ${response.status}${reply.name ? ` ${reply.name}` : ''}${reply.message ? `: ${reply.message}` : ''}`);
    error.code = reply.name;
    throw error;
  }

  return {
    async send({ to, subject, text, html }) {
      const body = {
        from: sender,
        to: [to],
        ...(replyTo ? { reply_to: replyTo } : {}),
        subject,
        text,
        ...(html ? { html } : {}),
        // Gmail folds messages with the same subject into one thread and hides
        // what repeats; a reference of its own keeps each message whole
        headers: { 'X-Entity-Ref-ID': crypto.randomUUID() }
      };
      try {
        return await post(body);
      } catch (error) {
        if (error.code !== 'rate_limit_exceeded') throw error;
        await wait(RETRY_AFTER_MS);
        return post(body);
      }
    }
  };
}
