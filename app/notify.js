// @ts-check

/**
 * Automatic notifications for task events.
 *
 * Listens to store events and — when configured in config.js — sends an
 * email per event via FormSubmit (or POSTs JSON to a custom webhook,
 * EMAIL_NOTIFICATIONS) and/or posts a message to a Slack channel via an
 * Incoming Webhook (SLACK_NOTIFICATIONS). Delivery is strictly
 * fire-and-forget: a failed or blocked send can never interfere with
 * task state, scoring or the shot animation.
 */

import { EMAIL_NOTIFICATIONS, SLACK_NOTIFICATIONS, PLAYERS } from './config.js';
import { store } from './store.js';
import { formatDateTime, formatDuration } from './dom.js';

/** @type {Record<string, 'completed' | 'created' | 'deleted'>} */
const EVENT_KINDS = {
  'task-completed': 'completed',
  'task-created': 'created',
  'task-deleted': 'deleted',
};

export function initNotifications() {
  store.subscribe((event) => {
    const kind = EVENT_KINDS[event.type];
    if (!kind || !event.task) return;
    // With shared storage every open device sees every change; only the
    // device that performed the action sends notifications, so nobody
    // gets duplicates.
    if (event.origin === 'remote') return;

    const email = EMAIL_NOTIFICATIONS;
    if (email.notifyOn[kind] && (email.webhookUrl || email.recipients.length > 0)) {
      send(kind, event.task).catch((err) => {
        console.warn('[notify] email notification failed:', err);
      });
    }

    const slack = SLACK_NOTIFICATIONS;
    if (slack.notifyOn[kind] && slack.webhookUrl) {
      sendSlack(kind, event.task).catch((err) => {
        console.warn('[notify] Slack notification failed:', err);
      });
    }
  });
}

/**
 * Post to a Slack Incoming Webhook. Sent as text/plain with no custom
 * headers (mode no-cors) so the browser can deliver it cross-origin;
 * Slack parses the JSON body regardless of content type.
 * @param {'completed' | 'created' | 'deleted'} kind
 * @param {import('./store.js').Task} task
 */
async function sendSlack(kind, task) {
  const scores = store.scores();
  const scoreline = PLAYERS.map((p) => `${p.initials} ${scores[p.initials] ?? 0}`).join(' · ');
  const ref = `#${task.ticketNumber}`;

  let text;
  if (kind === 'completed') {
    const time = task.timeSpentMinutes ? ` ⏱ ${formatDuration(task.timeSpentMinutes)}` : '';
    text =
      `🏀 *${ref} completed by ${task.completedBy}* — ${task.title}${time}\n` +
      `Scoreboard: ${scoreline} · team total ${store.teamTotal()}`;
  } else if (kind === 'created') {
    text = `🆕 *${ref} created* — ${task.title} (${task.status})`;
  } else {
    text = `🗑 *${ref} deleted* — ${task.title}`;
  }

  await fetch(SLACK_NOTIFICATIONS.webhookUrl, {
    method: 'POST',
    mode: 'no-cors',
    body: JSON.stringify({ text }),
  });
}

/**
 * @param {'completed' | 'created' | 'deleted'} kind
 * @param {import('./store.js').Task} task
 */
async function send(kind, task) {
  const scores = store.scores();
  const scoreline = PLAYERS.map((p) => `${p.initials} ${scores[p.initials] ?? 0}`).join(' · ');

  const subjectByKind = {
    completed: `🏀 Task #${task.ticketNumber} completed by ${task.completedBy} — ${task.title}`,
    created: `🆕 Task #${task.ticketNumber} created — ${task.title}`,
    deleted: `🗑 Task #${task.ticketNumber} deleted — ${task.title}`,
  };

  const lines = [
    `Ticket: #${task.ticketNumber}`,
    `Title: ${task.title}`,
    task.notes ? `Notes: ${task.notes}` : null,
    `Status: ${task.status}`,
    kind === 'completed' && task.completedBy ? `Completed by: ${task.completedBy}` : null,
    kind === 'completed' && task.completedAt ? `Completed at: ${formatDateTime(task.completedAt)}` : null,
    kind === 'completed' && task.timeSpentMinutes ? `Time spent: ${formatDuration(task.timeSpentMinutes)}` : null,
    kind === 'completed' && task.shotId ? `Shot: ${task.shotId} — MADE` : null,
    '',
    `Scoreboard: ${scoreline} (team total ${store.teamTotal()})`,
    '',
    `Sent automatically by the AACTIVATED RX Task Scoreboard (${location.href})`,
  ].filter((l) => l !== null);
  const message = lines.join('\n');

  const cfg = EMAIL_NOTIFICATIONS;
  if (cfg.webhookUrl) {
    await fetch(cfg.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        event: kind,
        subject: subjectByKind[kind],
        message,
        task,
        scores,
        teamTotal: store.teamTotal(),
        at: new Date().toISOString(),
      }),
    });
    return;
  }

  // FormSubmit AJAX endpoint: one call per recipient. The first ever call
  // makes FormSubmit email that recipient an activation link.
  const results = await Promise.allSettled(
    cfg.recipients.map((recipient) =>
      fetch(`https://formsubmit.co/ajax/${encodeURIComponent(recipient)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          _subject: subjectByKind[kind],
          _template: 'box',
          _captcha: 'false',
          message,
        }),
      }),
    ),
  );
  const failed = results.filter((r) => r.status === 'rejected').length;
  if (failed > 0) throw new Error(`${failed}/${results.length} notification request(s) failed`);
}
