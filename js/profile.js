/* ============================================================
   MEMпад — profile.js
   Страница профиля: статистика, мои звуки, избранное, настройки.
   ============================================================ */

const Profile = {
  activeTab: 'mine',

  render() {
    const guestEl = document.getElementById('profile-guest');
    const contentEl = document.getElementById('profile-content');
    const user = Auth.getUser();

    if (!user) {
      guestEl.classList.remove('hidden');
      contentEl.classList.add('hidden');
      return;
    }
    guestEl.classList.add('hidden');
    contentEl.classList.remove('hidden');

    // Avatar
    const avatarEl = document.getElementById('profile-avatar');
    if (user.avatarImage) {
      avatarEl.src = user.avatarImage;
    } else {
      avatarEl.src = Profile.avatarDataUrl(user);
    }

    document.getElementById('profile-name').textContent = user.name;
    document.getElementById('profile-tag').textContent = '#' + user.tag;
    document.getElementById('profile-bio').textContent = user.bio || 'Пока без описания… Расскажи о себе!';
    
    // Banner
    const bannerOverlay = document.getElementById('profile-banner-overlay');
    if (user.bannerImage) {
      bannerOverlay.style.backgroundImage = `url(${user.bannerImage})`;
      bannerOverlay.style.backgroundPosition = 'center 50%';
      bannerOverlay.style.backgroundSize = 'cover';
      bannerOverlay.style.backgroundRepeat = 'no-repeat';
    } else {
      bannerOverlay.style.backgroundImage = '';
      bannerOverlay.style.background = `linear-gradient(120deg, hsl(${user.bannerHue ?? 100} 70% 20%), transparent 70%)`;
    }

    Profile.refreshStatsOnly();
    Profile.renderTabContent();
  },

  avatarDataUrl(user) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200">
      <defs><linearGradient id="pg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#5DD62C"/><stop offset="100%" stop-color="#204d10"/>
      </linearGradient></defs>
      <rect width="200" height="200" rx="100" fill="url(#pg)"/>
      <text x="50%" y="56%" font-size="90" text-anchor="middle" dominant-baseline="middle">${user.avatar}</text>
    </svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  },

  refreshStatsOnly() {
    const user = Auth.getUser();
    if (!user) return;
    const mine = Feed.sounds.filter(s => s.authorId === user.id);
    const plays = mine.reduce((a, s) => a + s.plays, 0);
    const likes = mine.reduce((a, s) => a + s.likes, 0);
    document.getElementById('pstat-sounds').textContent = Utils.formatCompact(mine.length);
    document.getElementById('pstat-plays').textContent = Utils.formatCompact(plays);
    document.getElementById('pstat-likes').textContent = Utils.formatCompact(likes);
    document.getElementById('pstat-followers').textContent = Utils.formatCompact(user.followers || 0);
  },

  renderTabContent() {
    const user = Auth.getUser();
    if (!user) return;
    if (Profile.activeTab === 'mine') {
      const mine = Feed.sounds.filter(s => s.authorId === user.id).sort((a, b) => b.createdAt - a.createdAt);
      Feed.renderCompact('mine-grid', mine, 'mine-empty');
    } else if (Profile.activeTab === 'favs') {
      const favIds = Storage.get(STORAGE_KEYS.FAVORITES, {})[user.id] || [];
      const favs = Feed.sounds.filter(s => favIds.includes(s.id));
      Feed.renderCompact('favs-grid', favs, 'favs-empty');
    } else if (Profile.activeTab === 'settings') {
      document.getElementById('settings-name').value = user.name;
      document.getElementById('settings-bio').value = user.bio || '';
      
      // Avatar button
      const avatarBtn = document.getElementById('settings-avatar-input-btn');
      const avatarRemove = document.getElementById('settings-avatar-remove');
      if (user.avatarImage) {
        avatarBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Изменить аватар';
        if (avatarRemove) avatarRemove.style.display = 'block';
      } else {
        avatarBtn.innerHTML = '<i class="fa-solid fa-camera"></i> Загрузить аватар';
        if (avatarRemove) avatarRemove.style.display = 'none';
      }
      
      // Banner button
      const bannerBtn = document.getElementById('settings-banner-input-btn');
      const bannerRemove = document.getElementById('settings-banner-remove');
      if (user.bannerImage) {
        bannerBtn.innerHTML = '<i class="fa-solid fa-image"></i> Изменить баннер';
        if (bannerRemove) bannerRemove.style.display = 'block';
      } else {
        bannerBtn.innerHTML = '<i class="fa-solid fa-image"></i> Загрузить баннер';
        if (bannerRemove) bannerRemove.style.display = 'none';
      }
    }
  },

  init() {
    document.querySelectorAll('.ptab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.ptab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        Profile.activeTab = tab.dataset.ptab;
        document.querySelectorAll('.profile-panel').forEach(p => p.classList.add('hidden'));
        document.getElementById(`ppanel-${Profile.activeTab}`).classList.remove('hidden');
        Profile.renderTabContent();
      });
    });

    const editBioBtn = document.getElementById('edit-bio-btn');
    if (editBioBtn) editBioBtn.addEventListener('click', () => {
      const settingsTab = document.querySelector('[data-ptab="settings"]');
      if (settingsTab) settingsTab.click();
    });

    // Edit banner from profile head
    const editBannerBtn = document.getElementById('edit-banner-btn');
    if (editBannerBtn) editBannerBtn.addEventListener('click', () => {
      document.getElementById('settings-banner-input-btn').click();
    });

    // Edit avatar from profile head
    const editAvatarBtn = document.getElementById('edit-avatar-btn');
    if (editAvatarBtn) editAvatarBtn.addEventListener('click', () => {
      document.getElementById('settings-avatar-input-btn').click();
    });

    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) settingsForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const name = document.getElementById('settings-name').value.trim();
      const bio = document.getElementById('settings-bio').value.trim();
      if (!name) return;
      try {
        await Auth.updateUser({ name, bio });
        Auth.renderAuthSlot();
        Profile.render();
        UI.toast('Профиль обновлён', 'success', 'fa-check');
      } catch (err) {
        UI.toast('Не удалось сохранить профиль', 'error', 'fa-exclamation-triangle');
      }
    });

    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) logoutBtn.addEventListener('click', async () => {
      const ok = await UI.confirm({ title: 'Выйти из аккаунта?', text: 'Твои звуки и данные останутся сохранены локально.', okLabel: 'Выйти', danger: false });
      if (!ok) return;
      Auth.logout();
      Auth.renderAuthSlot();
      App.navigate('feed');
      UI.toast('Ты вышел из аккаунта', 'info', 'fa-right-from-bracket');
    });

    const profileLoginBtn = document.getElementById('profile-login-btn');
    if (profileLoginBtn) profileLoginBtn.addEventListener('click', () => UI.openModal('auth-modal-backdrop'));

    // Avatar upload handling
    const avatarInputBtn = document.getElementById('settings-avatar-input-btn');
    const avatarInput = document.getElementById('settings-avatar-input');
    const avatarRemove = document.getElementById('settings-avatar-remove');

    if (avatarInputBtn && avatarInput) {
      avatarInputBtn.addEventListener('click', () => avatarInput.click());
    }

    if (avatarInput) {
      avatarInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result;
          try {
            await Auth.updateUser({ avatarImage: dataUrl });
            Auth.renderAuthSlot();
            Profile.render();
            if (avatarRemove) avatarRemove.style.display = 'block';
            UI.toast('Аватар обновлён', 'success', 'fa-camera');
          } catch (err) {
            UI.toast('Не удалось обновить аватар', 'error', 'fa-exclamation-triangle');
          }
        };
        reader.readAsDataURL(f);
      });
    }

    if (avatarRemove) {
      avatarRemove.addEventListener('click', async () => {
        try {
          await Auth.updateUser({ avatarImage: null });
          Auth.renderAuthSlot();
          Profile.render();
          if (avatarInput) avatarInput.value = '';
          if (avatarRemove) avatarRemove.style.display = 'none';
          UI.toast('Аватар удалён', 'info', 'fa-trash');
        } catch (err) {
          UI.toast('Не удалось удалить аватар', 'error', 'fa-exclamation-triangle');
        }
      });
    }

    // Banner upload handling
    const bannerInputBtn = document.getElementById('settings-banner-input-btn');
    const bannerInput = document.getElementById('settings-banner-input');
    const bannerRemove = document.getElementById('settings-banner-remove');

    if (bannerInputBtn && bannerInput) {
      bannerInputBtn.addEventListener('click', () => bannerInput.click());
    }

    if (bannerInput) {
      bannerInput.addEventListener('change', (e) => {
        const f = e.target.files && e.target.files[0];
        if (!f) return;
        const reader = new FileReader();
        reader.onload = async () => {
          const dataUrl = reader.result;
          try {
            await Auth.updateUser({ bannerImage: dataUrl });
            Auth.renderAuthSlot();
            Profile.render();
            if (bannerRemove) bannerRemove.style.display = 'block';
            UI.toast('Баннер загружен', 'success', 'fa-image');
          } catch (err) {
            UI.toast('Не удалось обновить баннер', 'error', 'fa-exclamation-triangle');
          }
        };
        reader.readAsDataURL(f);
      });
    }

    if (bannerRemove) {
      bannerRemove.addEventListener('click', async () => {
        try {
          await Auth.updateUser({ bannerImage: null });
          Auth.renderAuthSlot();
          Profile.render();
          if (bannerInput) bannerInput.value = '';
          if (bannerRemove) bannerRemove.style.display = 'none';
          UI.toast('Баннер удалён', 'info', 'fa-trash');
        } catch (err) {
          UI.toast('Не удалось удалить баннер', 'error', 'fa-exclamation-triangle');
        }
      });
    }
  }
};
