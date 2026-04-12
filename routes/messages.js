const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { all, get, run } = require('../database/init');
const { requireAuth } = require('../middleware/auth');
const { queueNotification, scheduleFlush } = require('../services/notifications');

const router = express.Router();

// Start or get conversation about a pin
router.post('/conversations', requireAuth, (req, res) => {
  const { pin_id } = req.body;
  if (!pin_id) return res.status(400).json({ error: 'pin_id is required' });

  const pin = get('SELECT * FROM pins WHERE id = ?', [pin_id]);
  if (!pin) return res.status(404).json({ error: 'Pin not found' });

  if (pin.user_id === req.session.userId) {
    return res.status(400).json({ error: 'You cannot start a conversation on your own pin' });
  }

  // Check for existing conversation
  let conversation = get(
    `SELECT * FROM conversations WHERE pin_id = ? AND initiator_id = ?`,
    [pin_id, req.session.userId]
  );

  if (!conversation) {
    const id = uuidv4();
    run(
      `INSERT INTO conversations (id, pin_id, initiator_id, owner_id) VALUES (?, ?, ?, ?)`,
      [id, pin_id, req.session.userId, pin.user_id]
    );
    conversation = get('SELECT * FROM conversations WHERE id = ?', [id]);
  }

  // Get messages
  const messages = all(
    `SELECT m.*, u.company_name, u.contact_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? ORDER BY m.created_at ASC`,
    [conversation.id]
  );

  const otherUser = get('SELECT id, company_name, contact_name FROM users WHERE id = ?', [pin.user_id]);

  res.json({ conversation, messages, pin, other_user: otherUser });
});

// Get all my conversations
router.get('/conversations', requireAuth, (req, res) => {
  const conversations = all(
    `SELECT c.*,
      p.title as pin_title, p.pin_type, p.material_type,
      init_u.company_name as initiator_company,
      own_u.company_name as owner_company,
      (SELECT COUNT(*) FROM messages m WHERE m.conversation_id = c.id AND m.is_read = 0 AND m.sender_id != ?) as unread_count,
      (SELECT m.body FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message,
      (SELECT m.created_at FROM messages m WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1) as last_message_at
    FROM conversations c
    JOIN pins p ON c.pin_id = p.id
    JOIN users init_u ON c.initiator_id = init_u.id
    JOIN users own_u ON c.owner_id = own_u.id
    WHERE c.initiator_id = ? OR c.owner_id = ?
    ORDER BY last_message_at DESC`,
    [req.session.userId, req.session.userId, req.session.userId]
  );

  res.json(conversations);
});

// Send a message
router.post('/conversations/:conversationId/messages', requireAuth, (req, res) => {
  const { conversationId } = req.params;
  const { body } = req.body;

  if (!body || !body.trim()) return res.status(400).json({ error: 'Message body is required' });

  const conversation = get(
    `SELECT * FROM conversations WHERE id = ? AND (initiator_id = ? OR owner_id = ?)`,
    [conversationId, req.session.userId, req.session.userId]
  );

  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  const id = uuidv4();
  run(
    `INSERT INTO messages (id, conversation_id, sender_id, body) VALUES (?, ?, ?, ?)`,
    [id, conversationId, req.session.userId, body.trim()]
  );

  const message = get(
    `SELECT m.*, u.company_name, u.contact_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.id = ?`,
    [id]
  );

  // Notify the other participant (email + SMS)
  const recipientId = conversation.initiator_id === req.session.userId
    ? conversation.owner_id
    : conversation.initiator_id;

  const pin = get('SELECT address, title FROM pins WHERE id = ?', [conversation.pin_id]);
  const sender = get('SELECT company_name, contact_name FROM users WHERE id = ?', [req.session.userId]);

  queueNotification({
    recipientId,
    conversationId,
    messageId: id,
    senderName: sender?.company_name || sender?.contact_name || 'Someone',
    pinAddress: pin?.address || pin?.title,
    messageBody: body.trim()
  });
  scheduleFlush(recipientId);

  res.status(201).json(message);
});

// Get messages for a conversation
router.get('/conversations/:conversationId/messages', requireAuth, (req, res) => {
  const { conversationId } = req.params;

  const conversation = get(
    `SELECT * FROM conversations WHERE id = ? AND (initiator_id = ? OR owner_id = ?)`,
    [conversationId, req.session.userId, req.session.userId]
  );

  if (!conversation) return res.status(404).json({ error: 'Conversation not found' });

  // Mark messages as read
  run(
    `UPDATE messages SET is_read = 1 WHERE conversation_id = ? AND sender_id != ?`,
    [conversationId, req.session.userId]
  );

  const messages = all(
    `SELECT m.*, u.company_name, u.contact_name FROM messages m JOIN users u ON m.sender_id = u.id WHERE m.conversation_id = ? ORDER BY m.created_at ASC`,
    [conversationId]
  );

  res.json(messages);
});

// Get unread message count
router.get('/unread-count', requireAuth, (req, res) => {
  const result = get(
    `SELECT COUNT(*) as count FROM messages m JOIN conversations c ON m.conversation_id = c.id WHERE m.is_read = 0 AND m.sender_id != ? AND (c.initiator_id = ? OR c.owner_id = ?)`,
    [req.session.userId, req.session.userId, req.session.userId]
  );

  res.json({ count: result ? result.count : 0 });
});

module.exports = router;
