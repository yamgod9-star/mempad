/* ============================================================
   MEMпад — auth.js (Supabase версия)
   Управление пользовательской авторизацией и профилями
   ============================================================ */

const Auth = {
  user: null,

  async init() {
    console.log('🔐 Initializing Auth...');
    
    // Check current session
    try {
      const { data: { user } } = await supabaseClient.auth.getUser();
      if (user) {
        await Auth.loadProfile(user.id);
      }
    } catch (e) {
      console.warn('Auth.getUser failed', e);
    }

    // Listen for auth state changes
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
      console.log('🔐 Auth state changed:', event, session?.user?.id);
      if (session?.user) {
        await Auth.loadProfile(session.user.id);
      } else {
        Auth.user = null;
      }
      Auth.renderAuthSlot();
      if (window.Feed && window.App) App.navigate('feed');
    });

    Auth.renderAuthSlot();
    
    // Bind auth modal
    const discordBtn = document.getElementById('discord-login-btn');
    if (discordBtn) {
      discordBtn.addEventListener('click', Auth.loginWithDiscord);
    }

    const profileLoginBtn = document.getElementById('profile-login-btn');
    if (profileLoginBtn) {
      profileLoginBtn.addEventListener('click', () => UI.openModal('auth-modal-backdrop'));
    }
  },

  async loadProfile(userId) {
    try {
      const { data, error } = await supabaseClient
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        throw error;
      }

      // If profile doesn't exist, create it
      if (!data) {
        const { data: { user: authUser } } = await supabaseClient.auth.getUser();
        const newProfile = {
          id: userId,
          username: authUser?.email?.split('@')[0] || 'User',
          tag: Math.floor(Math.random() * 9999).toString().padStart(4, '0'),
          avatar_emoji: '🟢',
          avatar_image: null,
          banner_image: null,
          bio: ''
        };
        
        const { error: insertError } = await supabaseClient
          .from('profiles')
          .insert([newProfile]);
        
        if (insertError) throw insertError;
        Auth.user = newProfile;
      } else {
        Auth.user = data;
      }

      console.log('✅ Profile loaded:', Auth.user);
    } catch (err) {
      console.error('❌ Error loading profile:', err);
    }
  },

  isLoggedIn() {
    return !!Auth.user;
  },

  getUser() {
    if (!Auth.user) return null;
    
    // Map database fields to app format
    return {
      id: Auth.user.id,
      name: Auth.user.username,
      tag: Auth.user.tag,
      avatar: Auth.user.avatar_emoji,
      avatarImage: Auth.user.avatar_image,
      bio: Auth.user.bio
    };
  },

  async loginWithDiscord() {
    try {
      const btn = document.getElementById('discord-login-btn');
      if (btn) {
        btn.disabled = true;
        btn.innerHTML = `<i class=\"fa-solid fa-circle-notch fa-spin\"></i> Подключение к Discord…`;
      }

      const { data, error } = await supabaseClient.auth.signInWithOAuth({
        provider: 'discord',
        options: {
          redirectTo: 'https://yamgod9-star.github.io/mempad/'
        }
      });

      if (error) throw error;
      console.log('✅ Discord login initiated');
    } catch (err) {
      console.error('❌ Discord login error:', err.message || err);
      UI.toast(err.message || String(err), 'error');
      const btn = document.getElementById('discord-login-btn');
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = `<i class=\"fa-brands fa-discord\"></i> Продолжить с Discord`;
      }
    }
  },

  async logout() {
    try {
      const { error } = await supabaseClient.auth.signOut();
      if (error) throw error;
      Auth.user = null;
      console.log('✅ Logout successful');
      Auth.renderAuthSlot();
      UI.toast('Ты вышел из аккаунта', 'info', 'fa-right-from-bracket');
    } catch (err) {
      console.error('❌ Logout error:', err);
    }
  },

  async updateProfile(updates) {
    if (!Auth.user) return;
    
    try {
      console.log('📝 Updating profile:', updates);
      
      // Map app fields to database fields
      const dbUpdates = {};
      if (updates.name !== undefined) dbUpdates.username = updates.name;
      if (updates.avatar !== undefined) dbUpdates.avatar_emoji = updates.avatar;
      if (updates.avatarImage !== undefined) dbUpdates.avatar_image = updates.avatarImage;
      if (updates.bannerImage !== undefined) dbUpdates.banner_image = updates.bannerImage;
      if (updates.bio !== undefined) dbUpdates.bio = updates.bio;

      const { data, error } = await supabaseClient
        .from('profiles')
        .update(dbUpdates)
        .eq('id', Auth.user.id)
        .select()
        .single();

      if (error) throw error;

      // Update local user
      Object.assign(Auth.user, data);
      console.log('✅ Profile updated');
    } catch (err) {
      console.error('❌ Update profile error:', err);
      throw err;
    }
  },

  renderAuthSlot() {
    const slot = document.getElementById('auth-slot');
    if (!slot) return;

    if (!Auth.isLoggedIn()) {
      slot.innerHTML = `<button class=\"btn btn-discord\" id=\"nav-login-btn\"><i class=\"fa-brands fa-discord\"></i> <span class=\"btn-label\">Войти</span></button>`;
      const navBtn = document.getElementById('nav-login-btn');
      if (navBtn) navBtn.addEventListener('click', () => UI.openModal('auth-modal-backdrop'));
      return;
    }

    const user = Auth.getUser();
    slot.innerHTML = `
      <div class=\"user-chip\" id=\"user-chip\">\n        ${user.avatarImage 
          ? `<img src=\"${user.avatarImage}\" alt=\"avatar\" class=\"user-chip-avatar-img\">` 
          : `<span class=\"user-chip-avatar\">${user.avatar}</span>`}\n        <span class=\"user-chip-name\">${Utils.escapeHtml(user.name)}</span>\n        <i class=\"fa-solid fa-chevron-down\"></i>\n        <div class=\"user-dropdown\" id=\"user-dropdown\">\n          <a href=\"#profile\" data-route=\"profile\"><i class=\"fa-solid fa-user\"></i> Мой профиль</a>\n          <button id=\"dropdown-upload\"><i class=\"fa-solid fa-cloud-arrow-up\"></i> Загрузить звук</button>\n          <button id=\"dropdown-logout\" class=\"danger\"><i class=\"fa-solid fa-right-from-bracket\"></i> Выйти</button>\n        </div>\n      </div>\n    `;

    const chip = document.getElementById('user-chip');
    if (chip) {
      chip.addEventListener('click', (e) => {
        e.stopPropagation();
        chip.classList.toggle('open');
      });
      document.addEventListener('click', () => chip.classList.remove('open'));
    }

    const uploadBtn = document.getElementById('dropdown-upload');
    if (uploadBtn) {
      uploadBtn.addEventListener('click', () => UI.openModal('upload-modal-backdrop'));
    }

    const logoutBtn = document.getElementById('dropdown-logout');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', Auth.logout);
    }
  }
};

// Initialize when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', Auth.init);
} else {
  Auth.init();
}
