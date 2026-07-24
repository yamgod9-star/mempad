/* ============================================================
   MEMпад — forum.js
   Форум: категории, темы, обсуждения и комментарии.
   ============================================================ */

const Forum = {
  activeCategory: 'all',
  activeTopicId: null,

  loadTopics() { return Storage.get(STORAGE_KEYS.FORUM_TOPICS, []); },
  saveTopics(list) { Storage.set(STORAGE_KEYS.FORUM_TOPICS, list); },
  loadComments() { return Storage.get(STORAGE_KEYS.FORUM_COMMENTS, {}); },
  saveComments(map) { Storage.set(STORAGE_KEYS.FORUM_COMMENTS, map); },

  renderCategories() {
    const container = document.getElementById('forum-categories');
    const topics = Forum.loadTopics();
    const countAll = topics.length;
    container.innerHTML = `
      <button class="forum-cat ${Forum.activeCategory === 'all' ? 'active' : ''}" data-cat="all">
        <i class="fa-solid fa-layer-group"></i> Все темы <span>${countAll}</span>
      </button>
      ${FORUM_CATEGORIES.map(c => {
        const count = topics.filter(t => t.category === c.id).length;
        return `<button class="forum-cat ${Forum.activeCategory === c.id ? 'active' : ''}" data-cat="${c.id}">
          <i class="fa-solid ${c.icon}"></i> ${c.name} <span>${count}</span>
        </button>`;
      }).join('')}
    `;
    container.querySelectorAll('.forum-cat').forEach(btn => {
      btn.addEventListener('click', () => {
        Forum.activeCategory = btn.dataset.cat;
        Forum.renderCategories();
        Forum.renderTopics();
      });
    });
  },

  renderTopics() {
    const listEl = document.getElementById('forum-topics');
    let topics = Forum.loadTopics();
    if (Forum.activeCategory !== 'all') topics = topics.filter(t => t.category === Forum.activeCategory);
    topics = [...topics].sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));

    if (!topics.length) {
      listEl.innerHTML = `<div class="feed-empty"><i class="fa-solid fa-comment-slash"></i><h3>Тем пока нет</h3><p>Стань первым, кто откроет обсуждение в этой категории.</p></div>`;
      return;
    }

    const commentsMap = Forum.loadComments();
    listEl.innerHTML = topics.map(t => {
      const cat = FORUM_CATEGORIES.find(c => c.id === t.category);
      const cCount = (commentsMap[t.id] || []).length;
      return `
      <article class="topic-row" data-topic="${t.id}">
        <span class="topic-avatar">${t.authorAvatar}</span>
        <div class="topic-main">
          <div class="topic-title-row">
            ${t.pinned ? '<i class="fa-solid fa-thumbtack pin-ico" title="Закреплено"></i>' : ''}
            <h3>${Utils.escapeHtml(t.title)}</h3>
          </div>
          <p class="topic-excerpt">${Utils.escapeHtml(t.body.slice(0, 120))}${t.body.length > 120 ? '…' : ''}</p>
          <div class="topic-meta">
            <span class="cat-chip"><i class="fa-solid ${cat?.icon || 'fa-comments'}"></i> ${cat?.name || 'Общее'}</span>
            <span>${Utils.escapeHtml(t.authorName)}</span>
            <span>${Utils.timeAgo(t.createdAt)}</span>
          </div>
        </div>
        <div class="topic-stats">
          <span><i class="fa-solid fa-comment"></i> ${cCount}</span>
          <span><i class="fa-solid fa-eye"></i> ${Utils.formatCompact(t.views)}</span>
        </div>
      </article>`;
    }).join('');

    listEl.querySelectorAll('.topic-row').forEach(row => {
      row.addEventListener('click', () => Forum.openTopic(row.dataset.topic));
    });
  },

  openTopic(topicId) {
    const topics = Forum.loadTopics();
    const topic = topics.find(t => t.id === topicId);
    if (!topic) return;
    topic.views += 1;
    Forum.saveTopics(topics);

    Forum.activeTopicId = topicId;
    document.getElementById('forum-main').parentElement.querySelector('.forum-layout')?.classList.add('hidden');
    document.querySelector('.forum-layout').classList.add('hidden');
    document.querySelector('.forum-head').classList.add('hidden');
    document.getElementById('forum-thread').classList.remove('hidden');

    const cat = FORUM_CATEGORIES.find(c => c.id === topic.category);
    document.getElementById('thread-header').innerHTML = `
      <div class="thread-header-top">
        <span class="cat-chip"><i class="fa-solid ${cat?.icon || 'fa-comments'}"></i> ${cat?.name || 'Общее'}</span>
        <span class="thread-views"><i class="fa-solid fa-eye"></i> ${Utils.formatCompact(topic.views)} просмотров</span>
      </div>
      <h2>${Utils.escapeHtml(topic.title)}</h2>
      <div class="thread-author"><span>${topic.authorAvatar}</span> ${Utils.escapeHtml(topic.authorName)} · ${Utils.timeAgo(topic.createdAt)}</div>
      <p class="thread-body">${Utils.escapeHtml(topic.body)}</p>
    `;

    Forum.renderThreadComments(topicId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  closeThread() {
    document.querySelector('.forum-layout').classList.remove('hidden');
    document.querySelector('.forum-head').classList.remove('hidden');
    document.getElementById('forum-thread').classList.add('hidden');
    Forum.activeTopicId = null;
    Forum.renderCategories();
    Forum.renderTopics();
  },

  renderThreadComments(topicId) {
    const commentsMap = Forum.loadComments();
    const list = commentsMap[topicId] || [];
    const container = document.getElementById('thread-comments');
    if (!list.length) {
      container.innerHTML = `<p class="empty-hint">Комментариев пока нет. Начни обсуждение!</p>`;
      return;
    }
    container.innerHTML = list.map(c => `
      <div class="comment-item">
        <span class="comment-avatar">${c.authorAvatar}</span>
        <div class="comment-body">
          <div class="comment-meta"><strong>${Utils.escapeHtml(c.authorName)}</strong><span>${Utils.timeAgo(c.createdAt)}</span></div>
          <p>${Utils.escapeHtml(c.text)}</p>
        </div>
      </div>
    `).join('');
  },

  postReply(text) {
    if (!Auth.isLoggedIn()) return App.requireAuth();
    const user = Auth.getUser();
    const commentsMap = Forum.loadComments();
    commentsMap[Forum.activeTopicId] = commentsMap[Forum.activeTopicId] || [];
    commentsMap[Forum.activeTopicId].push({
      id: Utils.uid('fc'), authorId: user.id, authorName: user.name, authorAvatar: user.avatar,
      text, createdAt: Date.now()
    });
    Forum.saveComments(commentsMap);
    Forum.renderThreadComments(Forum.activeTopicId);
    UI.toast('Комментарий добавлен', 'success', 'fa-comment');
  },

  createTopic({ category, title, body }) {
    if (!Auth.isLoggedIn()) return App.requireAuth();
    const user = Auth.getUser();
    const topics = Forum.loadTopics();
    const topic = {
      id: Utils.uid('top'), category, title, body,
      authorId: user.id, authorName: user.name, authorAvatar: user.avatar,
      createdAt: Date.now(), views: 0, pinned: false
    };
    topics.unshift(topic);
    Forum.saveTopics(topics);
    UI.addNotification({ icon: 'fa-comments', text: `Новая тема на форуме: «${title}»` });
    Forum.renderCategories();
    Forum.renderTopics();
    return topic;
  },

  init() {
    Forum.renderCategories();
    Forum.renderTopics();

    document.getElementById('thread-back').addEventListener('click', Forum.closeThread);

    document.getElementById('thread-reply-form').addEventListener('submit', (e) => {
      e.preventDefault();
      const input = document.getElementById('thread-reply-text');
      const text = input.value.trim();
      if (!text) return;
      Forum.postReply(text);
      input.value = '';
    });

    document.getElementById('new-topic-btn').addEventListener('click', () => {
      if (!Auth.isLoggedIn()) return App.requireAuth();
      Forum.openNewTopicPrompt();
    });
  },

  openNewTopicPrompt() {
    // Простое встроенное мини-модальное окно на базе confirm-модалки было бы ограниченным,
    // поэтому используем отдельную быструю форму через prompt-подобный UI в шапке.
    const backdrop = document.getElementById('upload-modal-backdrop'); // reuse styling via dedicated modal below
    Forum.showNewTopicModal();
  },

  showNewTopicModal() {
    let modal = document.getElementById('new-topic-modal-backdrop');
    if (!modal) {
      modal = document.createElement('div');
      modal.className = 'modal-backdrop hidden';
      modal.id = 'new-topic-modal-backdrop';
      modal.innerHTML = `
        <div class="modal upload-modal" role="dialog" aria-modal="true">
          <button class="modal-close" data-close="new-topic-modal-backdrop"><i class="fa-solid fa-xmark"></i></button>
          <h2><i class="fa-solid fa-plus"></i> Новая тема</h2>
          <form id="new-topic-form">
            <label>Категория
              <select id="new-topic-category">
                ${FORUM_CATEGORIES.map(c => `<option value="${c.id}">${c.name}</option>`).join('')}
              </select>
            </label>
            <label>Заголовок
              <input type="text" id="new-topic-title" maxlength="80" required placeholder="О чём тема?">
            </label>
            <label>Текст темы
              <textarea id="new-topic-body" rows="4" maxlength="600" required placeholder="Опиши подробнее…"></textarea>
            </label>
            <button type="submit" class="btn btn-primary btn-lg"><i class="fa-solid fa-paper-plane"></i> Опубликовать тему</button>
          </form>
        </div>`;
      document.body.appendChild(modal);
      modal.querySelector('.modal-close').addEventListener('click', () => UI.closeModal('new-topic-modal-backdrop'));
      modal.addEventListener('click', (e) => { if (e.target === modal) UI.closeModal('new-topic-modal-backdrop'); });
      modal.querySelector('#new-topic-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const category = document.getElementById('new-topic-category').value;
        const title = document.getElementById('new-topic-title').value.trim();
        const body = document.getElementById('new-topic-body').value.trim();
        if (!title || !body) return;
        Forum.createTopic({ category, title, body });
        UI.closeModal('new-topic-modal-backdrop');
        e.target.reset();
        UI.toast('Тема опубликована', 'success', 'fa-check');
      });
    }
    UI.openModal('new-topic-modal-backdrop');
  }
};
