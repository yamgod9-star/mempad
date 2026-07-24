/* ============================================================
   MEMпад — ui.js
   Тосты, модальные окна, уведомления, подтверждения.
   ============================================================ */

const UI = {

  /* ---------- Toasts ---------- */
  toast(message, type = 'info', icon = null) {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast toast-${type}`;
    const icons = { info: 'fa-circle-info', success: 'fa-circle-check', error: 'fa-triangle-exclamation', like: 'fa-heart' };
    el.innerHTML = `<i class="fa-solid ${icon || icons[type] || icons.info}"></i><span>${Utils.escapeHtml(message)}</span>`;
    container.appendChild(el);

    if (window.gsap) {
      gsap.fromTo(el, { x: 60, opacity: 0 }, { x: 0, opacity: 1, duration: 0.4, ease: 'back.out(1.7)' });
    }
    setTimeout(() => {
      if (window.gsap) {
        gsap.to(el, { x: 60, opacity: 0, duration: 0.3, onComplete: () => el.remove() });
      } else {
        el.remove();
      }
    }, 3200);
  },

  /* ---------- Modals ---------- */
  openModal(id) {
    const backdrop = document.getElementById(id);
    if (!backdrop) return;
    backdrop.classList.remove('hidden');
    document.body.classList.add('modal-open');
    const modal = backdrop.querySelector('.modal');
    if (window.gsap && modal) {
      gsap.fromTo(backdrop, { opacity: 0 }, { opacity: 1, duration: 0.25 });
      gsap.fromTo(modal, { y: 24, scale: 0.96, opacity: 0 }, { y: 0, scale: 1, opacity: 1, duration: 0.35, ease: 'power3.out' });
    }
  },

  closeModal(id) {
    const backdrop = document.getElementById(id);
    if (!backdrop) return;
    const modal = backdrop.querySelector('.modal');
    const finish = () => backdrop.classList.add('hidden');
    if (window.gsap && modal) {
      gsap.to(modal, { y: 12, scale: 0.97, opacity: 0, duration: 0.2, ease: 'power2.in' });
      gsap.to(backdrop, { opacity: 0, duration: 0.2, onComplete: finish });
    } else {
      finish();
    }
    document.body.classList.remove('modal-open');
  },

  initModals() {
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => UI.closeModal(btn.dataset.close));
    });
    document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) UI.closeModal(backdrop.id);
      });
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        document.querySelectorAll('.modal-backdrop:not(.hidden)').forEach(b => UI.closeModal(b.id));
      }
    });
  },

  /* ---------- Confirm dialog ---------- */
  confirm({ title = 'Ты уверен?', text = '', okLabel = 'Удалить', danger = true } = {}) {
    return new Promise((resolve) => {
      document.getElementById('confirm-title').textContent = title;
      document.getElementById('confirm-text').textContent = text;
      const okBtn = document.getElementById('confirm-ok');
      okBtn.textContent = okLabel;
      okBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';

      const cleanup = () => {
        okBtn.removeEventListener('click', onOk);
        cancelBtn.removeEventListener('click', onCancel);
      };
      const onOk = () => { cleanup(); UI.closeModal('confirm-modal-backdrop'); resolve(true); };
      const onCancel = () => { cleanup(); UI.closeModal('confirm-modal-backdrop'); resolve(false); };

      const cancelBtn = document.getElementById('confirm-cancel');
      okBtn.addEventListener('click', onOk);
      cancelBtn.addEventListener('click', onCancel);
      UI.openModal('confirm-modal-backdrop');
    });
  },

  /* ---------- Notifications panel ---------- */
  addNotification({ icon = 'fa-bell', text, meta = '' }) {
    const list = Storage.get(STORAGE_KEYS.NOTIFICATIONS, []);
    list.unshift({ id: Utils.uid('n'), icon, text, meta, createdAt: Date.now(), read: false });
    Storage.set(STORAGE_KEYS.NOTIFICATIONS, list.slice(0, 40));
    UI.renderNotifications();
  },

  renderNotifications() {
    const list = Storage.get(STORAGE_KEYS.NOTIFICATIONS, []);
    const container = document.getElementById('notif-list');
    const dot = document.getElementById('notif-dot');
    const unread = list.filter(n => !n.read).length;
    dot.classList.toggle('show', unread > 0);

    if (!list.length) {
      container.innerHTML = `<div class="notif-empty">Пока нет уведомлений</div>`;
      return;
    }
    container.innerHTML = list.map(n => `
      <div class="notif-item ${n.read ? '' : 'unread'}">
        <i class="fa-solid ${n.icon}"></i>
        <div class="notif-item-text">
          <p>${Utils.escapeHtml(n.text)}</p>
          <span>${Utils.timeAgo(n.createdAt)}${n.meta ? ' · ' + Utils.escapeHtml(n.meta) : ''}</span>
        </div>
      </div>
    `).join('');
  },

  initNotifications() {
    const btn = document.getElementById('notif-btn');
    const panel = document.getElementById('notif-panel');
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      panel.classList.toggle('open');
      if (panel.classList.contains('open')) {
        const list = Storage.get(STORAGE_KEYS.NOTIFICATIONS, []).map(n => ({ ...n, read: true }));
        Storage.set(STORAGE_KEYS.NOTIFICATIONS, list);
        setTimeout(UI.renderNotifications, 400);
      }
    });
    document.addEventListener('click', () => panel.classList.remove('open'));
    document.getElementById('clear-notifs').addEventListener('click', (e) => {
      e.stopPropagation();
      Storage.set(STORAGE_KEYS.NOTIFICATIONS, []);
      UI.renderNotifications();
    });
    UI.renderNotifications();
  },

  /* ---------- Mobile menu ---------- */
  initMobileMenu() {
    const burger = document.getElementById('burger-btn');
    const menu = document.getElementById('mobile-menu');
    if (burger && menu) {
      burger.addEventListener('click', () => menu.classList.toggle('open'));
      menu.querySelectorAll('a').forEach(a => a.addEventListener('click', () => menu.classList.remove('open')));
    }
    const mobileUpload = document.getElementById('mobile-upload-btn');
    if (mobileUpload) mobileUpload.addEventListener('click', () => {
      if (menu) menu.classList.remove('open');
      App.requireAuth(() => UI.openModal('upload-modal-backdrop'));
    });
  },

  /* ---------- Skeleton cards ---------- */
  renderSkeletons(container, count = 6) {
    container.innerHTML = Array.from({ length: count }).map(() => `
      <div class="skeleton-card">
        <div class="sk sk-cover"></div>
        <div class="sk sk-line w70"></div>
        <div class="sk sk-line w40"></div>
        <div class="sk sk-line w90"></div>
      </div>
    `).join('');
  }
};
