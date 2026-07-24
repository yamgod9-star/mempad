/* ============================================================
   MEMпад — admin.js
   Админ-панель: авторизация, просмотр жалоб, управление звуками,
   комментариями и пользователями.
   ============================================================ */

const ADMIN_SESSION_KEY = 'mempad_admin_session';
const ADMIN_FALLBACK_CREDENTIALS = {
  login: 'iliqiwwjkjk',
  password: 'askdksdkQWE!@22pwppwo',
  name: 'Администратор'
};

const Admin = {
  session: null,
  activeTab: 'complaints',

  init() {
    Admin.loadSession();
    Admin.bind();
    Admin.renderNavLink();
    if (location.hash.replace('#', '') === 'admin') {
      Admin.renderPage();
    }
  },

  loadSession() {
    const stored = Storage.get(ADMIN_SESSION_KEY, null);
    if (stored && stored.login) {
      Admin.session = stored;
    }
  },

  isLoggedIn() {
    return !!Admin.session && !!Admin.session.login;
  },

  async login(login, password) {
    const trimmedLogin = String(login || '').trim();
    const trimmedPassword = String(password || '');
    if (!trimmedLogin || !trimmedPassword) {
      throw new Error('Введите логин и пароль');
    }

    let admin = await SupabaseAPI.getAdminUser(trimmedLogin);
    if (!admin) {
      if (trimmedLogin === ADMIN_FALLBACK_CREDENTIALS.login && trimmedPassword === ADMIN_FALLBACK_CREDENTIALS.password) {
        admin = ADMIN_FALLBACK_CREDENTIALS;
      } else {
        throw new Error('Неверный логин или пароль');
      }
    }

    const isValidPassword = admin.password === trimmedPassword ||
      (admin.password_hash && await Admin.hashPassword(trimmedPassword) === admin.password_hash);

    if (!isValidPassword) {
      throw new Error('Неверный логин или пароль');
    }

    Admin.session = {
      id: admin.id || 'fallback-admin',
      login: admin.login || trimmedLogin,
      name: admin.name || ADMIN_FALLBACK_CREDENTIALS.name
    };
    Storage.set(ADMIN_SESSION_KEY, Admin.session);
    Admin.renderNavLink();
    return true;
  },

  logout() {
    Admin.session = null;
    Storage.set(ADMIN_SESSION_KEY, null);
    Admin.renderNavLink();
    Admin.showLogin();
  },

  async hashPassword(password) {
    const encoder = new TextEncoder();
    const data = encoder.encode(password);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  },

  bind() {
    const loginForm = document.getElementById('admin-login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const loginInput = document.getElementById('admin-login');
        const passwordInput = document.getElementById('admin-password');
        const login = loginInput.value.trim();
        const password = passwordInput.value;

        try {
          await Admin.login(login, password);
          loginInput.value = '';
          passwordInput.value = '';
          UI.toast('Вход выполнен', 'success', 'fa-check');
          App.navigate('admin');
          Admin.renderPage();
        } catch (err) {
          UI.toast(err.message || 'Ошибка входа', 'error', 'fa-exclamation-triangle');
        }
      });
    }

    const logoutBtn = document.getElementById('admin-logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        Admin.logout();
        App.navigate('admin');
        UI.toast('Вы вышли из админки', 'info', 'fa-right-from-bracket');
      });
    }

    const tabs = document.getElementById('admin-tabs');
    if (tabs) {
      tabs.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-admin-tab]');
        if (!btn) return;
        Admin.switchTab(btn.dataset.adminTab);
      });
    }

    document.addEventListener('click', async (e) => {
      const action = e.target.closest('[data-admin-action]');
      if (!action) return;
      const type = action.dataset.adminAction;
      const entityId = action.dataset.id;
      if (!type || !entityId) return;
      await Admin.handleAction(type, entityId);
    });
  },

  renderNavLink() {
    const link = document.getElementById('admin-nav-link');
    if (!link) return;
    link.classList.toggle('hidden', !Admin.isLoggedIn());
  },

  renderPage() {
    const page = document.getElementById('page-admin');
    if (!page) return;
    if (Admin.isLoggedIn()) {
      Admin.showDashboard();
      Admin.loadActiveTab();
    } else {
      Admin.showLogin();
    }
  },

  showLogin() {
    const loginCard = document.getElementById('admin-login-card');
    if (loginCard) loginCard.classList.remove('hidden');
    const dashboard = document.getElementById('admin-dashboard');
    if (dashboard) dashboard.classList.add('hidden');
  },

  showDashboard() {
    const loginCard = document.getElementById('admin-login-card');
    if (loginCard) loginCard.classList.add('hidden');
    const dashboard = document.getElementById('admin-dashboard');
    if (dashboard) dashboard.classList.remove('hidden');
  },

  switchTab(tab) {
    if (!tab || Admin.activeTab === tab) return;
    Admin.activeTab = tab;
    document.querySelectorAll('.admin-tab').forEach(btn => btn.classList.toggle('active', btn.dataset.adminTab === tab));
    document.querySelectorAll('.admin-panel').forEach(panel => panel.classList.add('hidden'));
    const activePanel = document.getElementById(`admin-panel-${tab}`);
    if (activePanel) activePanel.classList.remove('hidden');
    Admin.loadActiveTab();
  },

  async loadActiveTab() {
    switch (Admin.activeTab) {
      case 'complaints': return Admin.renderComplaints();
      case 'sounds': return Admin.renderSounds();
      case 'comments': return Admin.renderComments();
      case 'users': return Admin.renderUsers();
      default: return Admin.renderComplaints();
    }
  },

  async renderComplaints() {
    const container = document.getElementById('admin-panel-complaints');
    if (!container) return;
    container.innerHTML = '<p class="admin-empty">Загрузка жалоб...</p>';

    const reports = await SupabaseAPI.getComplaints();
    if (!reports.length) {
      container.innerHTML = '<p class="admin-empty">Пока нет жалоб.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Звук</th>
            <th>Причина</th>
            <th>Автор жалобы</th>
            <th>Дата</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${reports.map(r => `
            <tr>
              <td>
                <span class="admin-entity-title">${Utils.escapeHtml(r.soundTitle)}</span>
                <span class="admin-entity-meta">ID: ${Utils.escapeHtml(r.soundId)}</span>
              </td>
              <td>${Utils.escapeHtml(r.reason || 'Не указано')}</td>
              <td>${Utils.escapeHtml(r.authorName)}</td>
              <td>${Utils.timeAgo(r.createdAt)}</td>
              <td>
                <div class="admin-actions">
                  <button class="btn btn-secondary" data-admin-action="delete-complaint" data-id="${Utils.escapeHtml(r.id)}">Удалить жалобу</button>
                  <button class="btn btn-danger" data-admin-action="delete-sound" data-id="${Utils.escapeHtml(r.soundId)}">Удалить звук</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  async renderSounds() {
    const container = document.getElementById('admin-panel-sounds');
    if (!container) return;
    container.innerHTML = '<p class="admin-empty">Загрузка звуков...</p>';

    const sounds = await SupabaseAPI.getSounds();
    if (!sounds.length) {
      container.innerHTML = '<p class="admin-empty">Звуков не найдено.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Название</th>
            <th>Автор</th>
            <th>Прослушиваний</th>
            <th>Загрузок</th>
            <th>Комментариев</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${sounds.map(s => `
            <tr>
              <td>
                <span class="admin-entity-title">${Utils.escapeHtml(s.title)}</span>
                <span class="admin-entity-meta">ID: ${Utils.escapeHtml(s.id)}</span>
              </td>
              <td>${Utils.escapeHtml(s.authorName)}</td>
              <td>${Utils.formatCompact(s.plays || 0)}</td>
              <td>${Utils.formatCompact(s.downloads || 0)}</td>
              <td>${Utils.formatCompact(s.commentsCount || 0)}</td>
              <td>
                <div class="admin-actions">
                  <button class="btn btn-secondary" data-admin-action="edit-sound" data-id="${Utils.escapeHtml(s.id)}">Редактировать</button>
                  <button class="btn btn-danger" data-admin-action="delete-sound" data-id="${Utils.escapeHtml(s.id)}">Удалить</button>
                </div>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  async renderComments() {
    const container = document.getElementById('admin-panel-comments');
    if (!container) return;
    container.innerHTML = '<p class="admin-empty">Загрузка комментариев...</p>';

    const comments = await SupabaseAPI.getAllComments();
    if (!comments.length) {
      container.innerHTML = '<p class="admin-empty">Комментарии не найдены.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Комментарий</th>
            <th>Автор</th>
            <th>Звук</th>
            <th>Дата</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${comments.map(c => `
            <tr>
              <td>${Utils.escapeHtml(c.text)}</td>
              <td>${Utils.escapeHtml(c.authorName)}</td>
              <td>${Utils.escapeHtml(c.soundTitle)}</td>
              <td>${Utils.timeAgo(c.createdAt)}</td>
              <td>
                <button class="btn btn-danger" data-admin-action="delete-comment" data-id="${Utils.escapeHtml(c.id)}">Удалить</button>
              </td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    `;
  },

  async renderUsers() {
    const container = document.getElementById('admin-panel-users');
    if (!container) return;
    container.innerHTML = '<p class="admin-empty">Загрузка пользователей...</p>';

    const users = await SupabaseAPI.getAllUsers();
    if (!users.length) {
      container.innerHTML = '<p class="admin-empty">Пользователи не найдены.</p>';
      return;
    }

    container.innerHTML = `
      <table class="admin-table">
        <thead>
          <tr>
            <th>Пользователь</th>
            <th>Статус</th>
            <th>Действия</th>
          </tr>
        </thead>
        <tbody>
          ${users.map(u => {
            const blockedUntil = u.blockedUntil ? new Date(u.blockedUntil) : null;
            const isBlocked = u.is_blocked || (blockedUntil && blockedUntil > Date.now());
            const statusLabel = isBlocked ? `Заблокирован ${blockedUntil ? `до ${blockedUntil.toLocaleString()}` : 'навсегда'}` : 'Активен';
            return `
              <tr>
                <td>
                  <span class="admin-entity-title">${Utils.escapeHtml(u.username || u.id)}</span>
                  <span class="admin-entity-meta">ID: ${Utils.escapeHtml(u.id)}</span>
                </td>
                <td>${Utils.escapeHtml(statusLabel)}</td>
                <td>
                  <div class="admin-actions">
                    ${!isBlocked ? `<button class="btn btn-secondary" data-admin-action="ban-1h" data-id="${Utils.escapeHtml(u.id)}">Бан 1ч</button>
                    <button class="btn btn-secondary" data-admin-action="ban-24h" data-id="${Utils.escapeHtml(u.id)}">Бан 24ч</button>
                    <button class="btn btn-secondary" data-admin-action="ban-forever" data-id="${Utils.escapeHtml(u.id)}">Бан навсегда</button>` : `<button class="btn btn-secondary" data-admin-action="unban" data-id="${Utils.escapeHtml(u.id)}">Разблокировать</button>`}
                    <button class="btn btn-danger" data-admin-action="delete-user" data-id="${Utils.escapeHtml(u.id)}">Удалить</button>
                  </div>
                </td>
              </tr>
            `;
          }).join('')}
        </tbody>
      </table>
    `;
  },

  async handleAction(type, entityId) {
    try {
      switch (type) {
        case 'delete-complaint':
          await Admin.deleteComplaint(entityId);
          return Admin.renderComplaints();
        case 'delete-sound':
          await Admin.deleteSound(entityId);
          return Admin.renderSounds();
        case 'edit-sound':
          return Admin.editSound(entityId);
        case 'delete-comment':
          await Admin.deleteComment(entityId);
          return Admin.renderComments();
        case 'ban-1h':
          await Admin.blockUser(entityId, 60);
          return Admin.renderUsers();
        case 'ban-24h':
          await Admin.blockUser(entityId, 1440);
          return Admin.renderUsers();
        case 'ban-forever':
          await Admin.blockUser(entityId, null);
          return Admin.renderUsers();
        case 'unban':
          await Admin.blockUser(entityId, 'unban');
          return Admin.renderUsers();
        case 'delete-user':
          await Admin.deleteUser(entityId);
          return Admin.renderUsers();
        default:
          return;
      }
    } catch (err) {
      UI.toast(err.message || 'Ошибка админ-действия', 'error', 'fa-exclamation-triangle');
    }
  },

  async deleteComplaint(reportId) {
    try {
      const { error } = await supabaseClient.from('reports').delete().eq('id', reportId);
      if (error) throw error;
      UI.toast('Жалоба удалена', 'success', 'fa-check');
    } catch (err) {
      console.error('Supabase deleteComplaint error', err);
      UI.toast('Не удалось удалить жалобу', 'error', 'fa-exclamation-triangle');
    }
  },

  async deleteSound(soundId) {
    const ok = await UI.confirm({ title: 'Удалить звук?', text: 'Эта операция удалит звук навсегда.', okLabel: 'Удалить' });
    if (!ok) return;
    await SupabaseAPI.deleteSoundAsAdmin(soundId);
    Feed.sounds = Feed.sounds.filter(s => s.id !== soundId);
    Feed.persist();
    UI.toast('Звук удалён', 'info', 'fa-trash');
  },

  async editSound(soundId) {
    const sound = Feed.getSoundById(soundId) || { title: '', tags: [] };
    const title = prompt('Новое название звука', sound.title || '');
    if (title === null) return;
    const tags = prompt('Новые теги через запятую', (sound.tags || []).join(', '));
    if (tags === null) return;
    const patch = { title: title.trim(), tags: tags.split(',').map(t => t.trim()).filter(Boolean) };
    await SupabaseAPI.updateSound(soundId, patch);
    if (sound) {
      sound.title = patch.title;
      sound.tags = patch.tags;
      Feed.persist();
    }
    UI.toast('Звук обновлён', 'success', 'fa-check');
    Admin.renderSounds();
  },

  async deleteComment(commentId) {
    const ok = await UI.confirm({ title: 'Удалить комментарий?', text: 'Комментарий будет удалён навсегда.', okLabel: 'Удалить' });
    if (!ok) return;
    await SupabaseAPI.deleteComment(commentId);
    UI.toast('Комментарий удалён', 'info', 'fa-trash');
  },

  async blockUser(userId, durationMinutes) {
    const user = await SupabaseAPI.getProfile(userId);
    if (!user) throw new Error('Пользователь не найден');
    let updates = {};
    if (durationMinutes === 'unban') {
      updates = { is_blocked: false, blocked_until: null };
    } else {
      const until = durationMinutes ? new Date(Date.now() + durationMinutes * 60000).toISOString() : null;
      updates = { is_blocked: true, blocked_until: until };
    }
    try {
      await SupabaseAPI.updateProfile(userId, updates);
      UI.toast(durationMinutes === 'unban' ? 'Пользователь разблокирован' : 'Пользователь заблокирован', 'success', 'fa-check');
    } catch (err) {
      UI.toast('Не удалось сохранить статус блокировки', 'error', 'fa-exclamation-triangle');
    }
  },

  async deleteUser(userId) {
    const ok = await UI.confirm({ title: 'Удалить профиль?', text: 'Профиль и все данные пользователя будут удалены.', okLabel: 'Удалить' });
    if (!ok) return;
    await SupabaseAPI.deleteUser(userId);
    UI.toast('Пользователь удалён', 'info', 'fa-trash');
  }
};
