// DirtLink - Messaging Module

window.Messaging = {
  currentConversationId: null,
  pollTimer: null,

  async loadConversations() {
    const res = await fetch('/api/messages/conversations');
    if (!res.ok) return;
    const conversations = await res.json();
    const container = document.getElementById('conv-list-items');

    if (conversations.length === 0) {
      container.innerHTML = '<p class="empty-state">No conversations yet. Browse the map and message a pin owner to get started.</p>';
      return;
    }

    container.innerHTML = conversations.map(c => {
      const color = getPinColor(c.pin_type, c.material_type);
      const otherCompany = c.initiator_id === DirtLink.user?.id ? c.owner_company : c.initiator_company;
      return `
        <div class="conv-item ${c.id === this.currentConversationId ? 'active' : ''} ${c.unread_count > 0 ? 'unread' : ''}"
             onclick="Messaging.openConversation('${c.id}')">
          <div class="conv-item-header">
            <span class="conv-dot" style="background:${color}"></span>
            <strong>${DirtLink.escapeHtml(otherCompany)}</strong>
            ${c.unread_count > 0 ? `<span class="badge">${c.unread_count}</span>` : ''}
          </div>
          <div class="conv-item-sub">
            ${c.pin_type === 'have' ? '&#9650;' : '&#9660;'} ${MATERIALS[c.material_type]?.label || c.material_type} &mdash; ${DirtLink.escapeHtml(c.pin_title)}
          </div>
          ${c.last_message ? `<div class="conv-item-preview">${DirtLink.escapeHtml(c.last_message.substring(0, 60))}${c.last_message.length > 60 ? '...' : ''}</div>` : ''}
        </div>
      `;
    }).join('');
  },

  async openConversation(conversationId) {
    this.currentConversationId = conversationId;
    document.getElementById('thread-input').style.display = 'flex';

    // Highlight active conversation
    document.querySelectorAll('.conv-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.querySelector(`.conv-item[onclick*="${conversationId}"]`);
    if (activeEl) activeEl.classList.add('active');

    await this.loadMessages(conversationId);
    this.startPolling();
  },

  async loadMessages(conversationId) {
    const res = await fetch(`/api/messages/conversations/${conversationId}/messages`);
    if (!res.ok) return;
    const messages = await res.json();

    const threadHeader = document.getElementById('thread-header');
    const threadMessages = document.getElementById('thread-messages');

    if (messages.length === 0) {
      threadHeader.innerHTML = '<p>Start the conversation below.</p>';
    } else {
      threadHeader.innerHTML = `<p><strong>${messages.length}</strong> messages</p>`;
    }

    threadMessages.innerHTML = messages.map(m => `
      <div class="message ${m.sender_id === DirtLink.user?.id ? 'mine' : 'theirs'}">
        <div class="message-meta">
          <strong>${DirtLink.escapeHtml(m.company_name)}</strong>
          <span class="message-time">${new Date(m.created_at + 'Z').toLocaleString()}</span>
        </div>
        <div class="message-body">${DirtLink.escapeHtml(m.body)}</div>
      </div>
    `).join('');

    // Scroll to bottom
    threadMessages.scrollTop = threadMessages.scrollHeight;

    // Bind send
    const sendBtn = document.getElementById('btn-send-msg');
    sendBtn.onclick = () => this.sendMessage(conversationId);

    const input = document.getElementById('msg-input');
    input.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage(conversationId);
      }
    };

    // Refresh conversation list to update unread counts
    this.loadConversations();
  },

  async sendMessage(conversationId) {
    const input = document.getElementById('msg-input');
    const body = input.value.trim();
    if (!body) return;

    input.value = '';
    const res = await fetch(`/api/messages/conversations/${conversationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body })
    });

    if (res.ok) {
      await this.loadMessages(conversationId);
    }
  },

  startPolling() {
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.pollTimer = setInterval(() => {
      if (this.currentConversationId) {
        this.loadMessages(this.currentConversationId);
      }
    }, 5000);
  }
};
