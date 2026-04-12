const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { get, run } = require('../database/init');
const { queueNotification, scheduleFlush } = require('../services/notifications');

const router = express.Router();

// Inbound email webhook (works with SendGrid Inbound Parse, Mailgun, or Postmark)
// The email provider POSTs parsed email data here when someone replies to
// reply+{conversationId}@dirtlink.ca
router.post('/email', express.urlencoded({ extended: true }), express.json(), (req, res) => {
  // Extract fields — field names vary by provider, handle common ones
  const to = req.body.to || req.body.To || req.body.envelope?.to?.[0] || '';
  const from = req.body.from || req.body.From || req.body.sender || '';
  const text = req.body.text || req.body['stripped-text'] || req.body.TextBody || '';

  if (!to || !text.trim()) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Parse conversation ID from reply+{conversationId}@dirtlink.ca
  const replyMatch = to.match(/reply\+([a-f0-9-]{36})/i);
  if (!replyMatch) {
    console.log('[inbound] Could not extract conversation ID from:', to);
    return res.status(200).json({ status: 'ignored', reason: 'no conversation ID in address' });
  }

  const conversationId = replyMatch[1];

  // Find the conversation
  const conversation = get('SELECT * FROM conversations WHERE id = ?', [conversationId]);
  if (!conversation) {
    console.log('[inbound] Conversation not found:', conversationId);
    return res.status(200).json({ status: 'ignored', reason: 'conversation not found' });
  }

  // Match sender email to a user in the conversation
  const emailMatch = from.match(/[\w.+-]+@[\w.-]+/);
  if (!emailMatch) {
    return res.status(200).json({ status: 'ignored', reason: 'could not parse sender email' });
  }
  const senderEmail = emailMatch[0].toLowerCase();

  const sender = get('SELECT * FROM users WHERE LOWER(email) = ?', [senderEmail]);
  if (!sender) {
    console.log('[inbound] No user found for email:', senderEmail);
    return res.status(200).json({ status: 'ignored', reason: 'sender not recognized' });
  }

  // Verify sender is a participant in this conversation
  if (sender.id !== conversation.initiator_id && sender.id !== conversation.owner_id) {
    console.log('[inbound] User not a participant in conversation:', sender.id);
    return res.status(200).json({ status: 'ignored', reason: 'sender not in conversation' });
  }

  // Strip email reply artifacts (quoted text, signatures)
  const cleanBody = stripEmailReply(text);
  if (!cleanBody.trim()) {
    return res.status(200).json({ status: 'ignored', reason: 'empty after stripping' });
  }

  // Insert the message
  const msgId = uuidv4();
  run(
    'INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?, ?, ?, ?)',
    [msgId, conversationId, sender.id, cleanBody.trim()]
  );

  // Notify the other participant
  const recipientId = sender.id === conversation.initiator_id
    ? conversation.owner_id
    : conversation.initiator_id;

  const pin = get('SELECT address, title FROM pins WHERE id = ?', [conversation.pin_id]);

  queueNotification({
    recipientId,
    conversationId,
    messageId: msgId,
    senderName: sender.company_name || sender.contact_name,
    pinAddress: pin?.address || pin?.title,
    messageBody: cleanBody.trim()
  });
  scheduleFlush(recipientId);

  console.log(`[inbound] Email reply posted to conversation ${conversationId} by ${senderEmail}`);
  res.status(200).json({ status: 'ok', message_id: msgId });
});

// Strip common email reply patterns
function stripEmailReply(text) {
  const lines = text.split('\n');
  const cleaned = [];

  for (const line of lines) {
    // Stop at common reply markers
    if (/^On .+ wrote:$/i.test(line.trim())) break;
    if (/^>/.test(line.trim())) continue; // quoted lines
    if (/^-{3,}/.test(line.trim())) break; // separator
    if (/^_{3,}/.test(line.trim())) break;
    if (/Sent from my/i.test(line.trim())) break;
    if (/^From:/.test(line.trim())) break;
    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

module.exports = router;
