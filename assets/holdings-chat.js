/* Van Schalkwyk Holdings' own assistant. It is intentionally loaded on the Holdings homepage only. */
(() => {
  if (document.querySelector('[data-vsh-assistant]')) return;
  const root = document.createElement('div');
  root.className = 'vsh-chat';
  root.dataset.vshAssistant = '';
  root.innerHTML = `
    <button type="button" class="vsh-launcher" aria-label="Chat with Vian, the Van Schalkwyk Holdings guide" aria-expanded="false">
      <span class="vsh-launcher-mark" aria-hidden="true">V</span>
      <span class="vsh-launcher-copy"><strong>Ask Vian</strong><small>Our family business guide</small></span>
      <span aria-hidden="true">✦</span>
    </button>
    <section class="vsh-chat-panel" aria-label="Chat with Vian" hidden>
      <header class="vsh-chat-header">
        <span class="vsh-chat-avatar" aria-hidden="true">V</span>
        <span class="vsh-chat-heading"><strong>Vian</strong><small>Van Schalkwyk Holdings · AI Guide</small></span>
        <div class="vsh-chat-controls">
          <button type="button" class="vsh-chat-icon-btn vsh-chat-reset" aria-label="Start a new conversation" title="New conversation">↻</button>
          <button type="button" class="vsh-chat-icon-btn vsh-chat-close" aria-label="Close chat">×</button>
        </div>
      </header>
      <div class="vsh-chat-intro">
        <div class="vsh-chat-kicker">Different passions. One family.</div>
        <h2>Hi! I'm <span>Vian.</span></h2>
        <p>Your guide to Granny's, Clever Cubs Learning, Nuvetriq, PurEss and Cricut. Ask me anything about our family of businesses!</p>
      </div>
      <div class="vsh-chat-chips" aria-label="Suggested questions">
        <button class="vsh-chat-chip" type="button" data-vsh-prompt="Which Van Schalkwyk Holdings business can help me?">Find a business</button>
        <button class="vsh-chat-chip" type="button" data-vsh-prompt="What CAPS-aligned learning resources does Clever Cubs offer?">Clever Cubs</button>
        <button class="vsh-chat-chip" type="button" data-vsh-prompt="What sweet treats can I order from Granny's?">Granny's treats</button>
        <button class="vsh-chat-chip" type="button" data-vsh-prompt="What digital services does Nuvetriq offer?">Nuvetriq</button>
      </div>
      <div class="vsh-chat-messages" role="log" aria-live="polite" aria-relevant="additions"></div>
      <form class="vsh-chat-form">
        <textarea class="vsh-chat-input" rows="1" maxlength="1500" aria-label="Your message" placeholder="Ask me a question…" required></textarea>
        <button class="vsh-chat-send" type="submit" aria-label="Send message">➤</button>
      </form>
      <p class="vsh-chat-note">I'm an AI guide and may make mistakes. Please confirm prices and availability with each business. Don't share passwords, banking details or sensitive information.</p>
    </section>`;
  document.body.appendChild(root);

  const launcher = root.querySelector('.vsh-launcher');
  const panel = root.querySelector('.vsh-chat-panel');
  const closeButton = root.querySelector('.vsh-chat-close');
  const resetButton = root.querySelector('.vsh-chat-reset');
  const intro = root.querySelector('.vsh-chat-intro');
  const chips = root.querySelector('.vsh-chat-chips');
  const messages = root.querySelector('.vsh-chat-messages');
  const form = root.querySelector('.vsh-chat-form');
  const input = root.querySelector('.vsh-chat-input');
  const send = root.querySelector('.vsh-chat-send');
  let history = [];
  let busy = false;

  function setOpen(open) {
    panel.hidden = !open;
    launcher.hidden = open;
    launcher.setAttribute('aria-expanded', String(open));
    if (open) input.focus(); else launcher.focus();
  }

  function linkify(container, message) {
    // Safely create text nodes and links; never inject the model's response as HTML.
    const expression = /(https:\/\/[^\s<>]+|\/(?:grannys-little-bakery|clever-cubs-learning|puress|cricut|index)\.html(?:#[\w-]+)?)/g;
    let start = 0;
    for (const match of message.matchAll(expression)) {
      container.append(document.createTextNode(message.slice(start, match.index)));
      let url = match[0];
      const suffix = url.match(/[.,;!?)]*$/)?.[0] || '';
      url = url.slice(0, url.length - suffix.length);
      const link = document.createElement('a');
      link.href = url;
      link.textContent = url;
      if (url.startsWith('https://')) {
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
      }
      container.append(link, document.createTextNode(suffix));
      start = match.index + match[0].length;
    }
    container.append(document.createTextNode(message.slice(start)));
  }

  function addMessage(role, message) {
    const bubble = document.createElement('div');
    bubble.className = 'vsh-chat-message';
    bubble.dataset.role = role;
    if (role === 'assistant') linkify(bubble, message);
    else bubble.textContent = message;
    messages.appendChild(bubble);
    messages.scrollTop = messages.scrollHeight;
    return bubble;
  }

  function resetConversation() {
    if (busy) return;
    history = [];
    messages.replaceChildren();
    intro.hidden = false;
    chips.hidden = false;
    input.value = '';
    input.focus();
  }

  async function ask(question) {
    const message = String(question || '').trim();
    if (!message || busy) return;
    busy = true;
    send.disabled = true;
    input.disabled = true;
    intro.hidden = true;
    chips.hidden = true;
    addMessage('user', message);
    input.value = '';
    const typing = document.createElement('div');
    typing.className = 'vsh-chat-typing';
    typing.textContent = 'Vian is thinking…';
    messages.appendChild(typing);
    messages.scrollTop = messages.scrollHeight;
    try {
      const response = await fetch('/api/holdings-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history: history.slice(-10) })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || typeof data.reply !== 'string') {
        throw new Error(data.error || 'The assistant is unavailable right now.');
      }
      history.push({ role: 'user', content: message }, { role: 'assistant', content: data.reply });
      history = history.slice(-10);
      addMessage('assistant', data.reply);
    } catch (error) {
      addMessage('error', error.message || 'Sorry, something went wrong. Please try again.');
    } finally {
      typing.remove();
      busy = false;
      send.disabled = false;
      input.disabled = false;
      input.focus();
    }
  }

  launcher.addEventListener('click', () => setOpen(true));
  closeButton.addEventListener('click', () => setOpen(false));
  resetButton.addEventListener('click', resetConversation);
  chips.addEventListener('click', event => {
    const button = event.target.closest('[data-vsh-prompt]');
    if (button) ask(button.dataset.vshPrompt);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    ask(input.value);
  });
  input.addEventListener('keydown', event => {
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      ask(input.value);
    }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !panel.hidden) setOpen(false);
  });
})();