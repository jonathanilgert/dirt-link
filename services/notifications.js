const nodemailer = require('nodemailer');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../database/init');

// ── Twilio (lazy-loaded so app starts even without credentials) ──
let twilioClient = null;
function getTwilio() {
  if (twilioClient) return twilioClient;
  if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
    const twilio = require('twilio');
    twilioClient = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  }
  return twilioClient;
}

// ── Nodemailer transport ──
let transporter = null;
function getTransporter() {
  if (transporter) return transporter;
  if (process.env.SMTP_HOST) {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      }
    });
  }
  return transporter;
}

const FROM_EMAIL = process.env.FROM_EMAIL || 'messages@dirtlink.ca';
const APP_URL = process.env.APP_URL || 'http://localhost:3000';

// Batching window: if multiple messages arrive for the same recipient
// within this many ms, batch into a single notification
const BATCH_WINDOW_MS = 60_000; // 1 minute

// ── Queue a notification (called when a message is sent) ──
function queueNotification({ recipientId, conversationId, messageId, senderName, pinAddress, messageBody }) {
  const id = uuidv4();
  run(
    `INSERT INTO notification_queue (id, recipient_id, conversation_id, message_id, sender_name, pin_address, message_body)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, recipientId, conversationId, messageId, senderName, pinAddress || 'a DirtLink site', messageBody]
  );
  return id;
}

// ── Flush pending notifications for a recipient ──
// Called on a short delay after queueing, so rapid-fire messages get batched
async function flushNotifications(recipientId) {
  const pending = all(
    `SELECT * FROM notification_queue WHERE recipient_id = ? AND sent_at IS NULL ORDER BY created_at ASC`,
    [recipientId]
  );
  if (pending.length === 0) return;

  const recipient = get(
    `SELECT id, email, phone, contact_name, company_name, email_notifications, sms_notifications, unsubscribe_token FROM users WHERE id = ?`,
    [recipientId]
  );
  if (!recipient) return;

  // Ensure unsubscribe token exists
  let unsubToken = recipient.unsubscribe_token;
  if (!unsubToken) {
    unsubToken = uuidv4();
    run(`UPDATE users SET unsubscribe_token = ? WHERE id = ?`, [unsubToken, recipientId]);
  }

  // Group by conversation
  const byConversation = {};
  for (const n of pending) {
    if (!byConversation[n.conversation_id]) byConversation[n.conversation_id] = [];
    byConversation[n.conversation_id].push(n);
  }

  // Send email notification
  if (recipient.email_notifications && recipient.email) {
    await sendEmailNotification(recipient, byConversation, unsubToken);
  }

  // Send SMS notification
  if (recipient.sms_notifications && recipient.phone) {
    await sendSmsNotification(recipient, byConversation);
  }

  // Mark all as sent
  const ids = pending.map(n => n.id);
  const placeholders = ids.map(() => '?').join(',');
  run(
    `UPDATE notification_queue SET sent_at = datetime('now') WHERE id IN (${placeholders})`,
    ids
  );
}

// ── Email notification ──
async function sendEmailNotification(recipient, byConversation, unsubToken) {
  const transport = getTransporter();
  if (!transport) {
    console.log('[notifications] SMTP not configured — skipping email notification');
    return;
  }

  const conversationIds = Object.keys(byConversation);

  // Single conversation → specific reply-to; multiple → generic
  const isSingle = conversationIds.length === 1;
  const firstConvId = conversationIds[0];
  const firstMessages = byConversation[firstConvId];
  const senderName = firstMessages[0].sender_name;

  let subject, htmlBody;
  const unsubUrl = `${APP_URL}/unsubscribe/${unsubToken}`;
  const messagesUrl = `${APP_URL}/#messages`;

  if (isSingle) {
    const pinAddress = firstMessages[0].pin_address || 'a DirtLink site';
    subject = `New message from ${senderName} about ${pinAddress}`;

    const messageHtml = firstMessages.map(m =>
      `<div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin:8px 0;">
        <p style="margin:0;color:#374151;">${escapeHtml(m.message_body)}</p>
      </div>`
    ).join('');

    htmlBody = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#F59E0B;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h1 style="margin:0;font-size:20px;color:#fff;">Dirt<strong>Link</strong></h1>
        </div>
        <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
          <p style="margin:0 0 8px;color:#6b7280;">New message from <strong>${escapeHtml(senderName)}</strong> about <strong>${escapeHtml(pinAddress)}</strong>:</p>
          ${messageHtml}
          <div style="margin-top:24px;">
            <a href="${messagesUrl}" style="display:inline-block;background:#F59E0B;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View on DirtLink</a>
          </div>
          <p style="margin-top:16px;color:#9ca3af;font-size:13px;">
            You can reply directly to this email and your response will be posted to the conversation.
          </p>
        </div>
        <div style="padding:16px 24px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">
            <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe from email notifications</a>
          </p>
        </div>
      </div>
    `;
  } else {
    // Batched: multiple conversations
    const totalMsgs = Object.values(byConversation).reduce((sum, msgs) => sum + msgs.length, 0);
    subject = `${totalMsgs} new DirtLink messages`;

    const summaryHtml = conversationIds.map(cid => {
      const msgs = byConversation[cid];
      return `<div style="background:#f8f9fa;border-radius:8px;padding:12px 16px;margin:8px 0;">
        <p style="margin:0 0 4px;"><strong>${escapeHtml(msgs[0].sender_name)}</strong> about <strong>${escapeHtml(msgs[0].pin_address || 'a DirtLink site')}</strong></p>
        <p style="margin:0;color:#6b7280;">${msgs.length} message${msgs.length > 1 ? 's' : ''}</p>
      </div>`;
    }).join('');

    htmlBody = `
      <div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;">
        <div style="background:#F59E0B;padding:16px 24px;border-radius:8px 8px 0 0;">
          <h1 style="margin:0;font-size:20px;color:#fff;">Dirt<strong>Link</strong></h1>
        </div>
        <div style="padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px;">
          <p style="margin:0 0 16px;color:#6b7280;">You have ${totalMsgs} new messages:</p>
          ${summaryHtml}
          <div style="margin-top:24px;">
            <a href="${messagesUrl}" style="display:inline-block;background:#F59E0B;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;">View on DirtLink</a>
          </div>
        </div>
        <div style="padding:16px 24px;text-align:center;">
          <p style="margin:0;color:#9ca3af;font-size:12px;">
            <a href="${unsubUrl}" style="color:#9ca3af;">Unsubscribe from email notifications</a>
          </p>
        </div>
      </div>
    `;
  }

  const replyTo = isSingle
    ? `reply+${firstConvId}@${FROM_EMAIL.split('@')[1] || 'dirtlink.ca'}`
    : FROM_EMAIL;

  try {
    await transport.sendMail({
      from: `DirtLink <${FROM_EMAIL}>`,
      to: recipient.email,
      replyTo,
      subject,
      html: htmlBody
    });
    console.log(`[notifications] Email sent to ${recipient.email}`);
  } catch (err) {
    console.error(`[notifications] Email failed for ${recipient.email}:`, err.message);
  }
}

// ── SMS notification (brief, no message content) ──
async function sendSmsNotification(recipient, byConversation) {
  const client = getTwilio();
  if (!client || !process.env.TWILIO_PHONE_NUMBER) {
    console.log('[notifications] Twilio not configured — skipping SMS');
    return;
  }

  const conversationIds = Object.keys(byConversation);
  const firstMessages = byConversation[conversationIds[0]];
  const senderName = firstMessages[0].sender_name;
  const totalMsgs = Object.values(byConversation).reduce((sum, msgs) => sum + msgs.length, 0);

  let body;
  if (conversationIds.length === 1) {
    const pinAddress = firstMessages[0].pin_address || 'a DirtLink site';
    body = `New DirtLink message from ${senderName} about ${pinAddress}. Check your email or visit ${APP_URL}/#messages`;
  } else {
    body = `You have ${totalMsgs} new DirtLink messages. Check your email or visit ${APP_URL}/#messages`;
  }

  try {
    await client.messages.create({
      body,
      from: process.env.TWILIO_PHONE_NUMBER,
      to: recipient.phone
    });
    console.log(`[notifications] SMS sent to ${recipient.phone}`);
  } catch (err) {
    console.error(`[notifications] SMS failed for ${recipient.phone}:`, err.message);
  }
}

// ── Schedule a batched flush ──
// Keeps a map of pending timers so we only flush once per batch window
const pendingFlushes = new Map();

function scheduleFlush(recipientId) {
  if (pendingFlushes.has(recipientId)) return; // already scheduled
  const timer = setTimeout(async () => {
    pendingFlushes.delete(recipientId);
    try {
      await flushNotifications(recipientId);
    } catch (err) {
      console.error('[notifications] Flush error:', err.message);
    }
  }, BATCH_WINDOW_MS);
  pendingFlushes.set(recipientId, timer);
}

// HTML-escape for email bodies
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

module.exports = { queueNotification, scheduleFlush, flushNotifications };
