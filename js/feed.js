/* ============================================================
   MEMпад — feed.js
   Лента звуков: рендер карточек, авто-рейтинг, поиск, фильтры,
   бесконечная прокрутка, лайки/избранное/скачивание/комментарии,
   загрузка/редактирование/удаление собственных звуков.
   ============================================================ */

const PAGE_SIZE = 9;
const COVER_EMOJIS = ['😵‍💫','😱','🦆','🎺','📯','⏰','🐱','😳','🌀','🥁','👶','🦫','🚨','🕹️','👻','⌨️','🤨','💥','🎸','😭','🔫','🎹','🐹','🔔','🔥','💀','🎮','🍉'];

const Feed = {
  sounds: [],
  filter: 'trending',
  query: '',
  rendered: 0,
  scoped: null,     // 'mine' | 'favs' | null — используется страницей профиля
  observer: null,
  activeSoundIdForModal: null,
  highlightedSoundId: null,
  uploadCoverIndex: 0,
  uploadFile: null,
  uploadInProgress: false,

  /* ---------- Загрузка / сохранение ---------- */
  async load() {
    // Load sounds from Supabase
    try {
      Feed.sounds = await SupabaseAPI.getSounds();
    } catch (err) {
      console.error('Error loading sounds from Supabase, falling back to localstorage', err);
      Feed.sounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
    }
  },
  persist() {
    // Persisting to Supabase is done per-operation. Keep local cache for offline fallback.
    try { Storage.set(STORAGE_KEYS.SOUNDS, Feed.sounds); } catch (e) { /* noop */ }
  },
  getSoundById(id) {
    return Feed.sounds.find(s => s.id === id);
  },

  getPlayedKey() {
    const user = Auth.getUser();
    return user && user.id ? user.id : 'anon';
  },

  hasRecordedPlay(soundId) {
    const played = Storage.get(STORAGE_KEYS.PLAYED_SOUNDS, {});
    const key = Feed.getPlayedKey();
    return Array.isArray(played[key]) && played[key].includes(soundId);
  },

  recordPlay(soundId) {
    const played = Storage.get(STORAGE_KEYS.PLAYED_SOUNDS, {});
    const key = Feed.getPlayedKey();
    played[key] = played[key] || [];
    if (!played[key].includes(soundId)) {
      played[key].push(soundId);
      Storage.set(STORAGE_KEYS.PLAYED_SOUNDS, played);
    }
  },

  favCountFor(soundId) {
    const favs = Storage.get(STORAGE_KEYS.FAVORITES, {});
    let count = 0;
    Object.values(favs).forEach(list => { if (list.includes(soundId)) count++; });
    return count;
  },
  isFavorited(soundId) {
    const user = Auth.getUser();
    if (!user) return false;
    const favs = Storage.get(STORAGE_KEYS.FAVORITES, {});
    return (favs[user.id] || []).includes(soundId);
  },
  userLikeState(soundId) {
    const user = Auth.getUser();
    if (!user) return 0;
    const likes = Storage.get(STORAGE_KEYS.LIKES, {});
    return (likes[soundId] || {})[user.id] || 0;
  },

  /* ---------- Ранжирование / фильтрация / поиск ---------- */
  getRanked() {
    let list = [...Feed.sounds];

    if (Feed.scoped === 'mine') {
      const user = Auth.getUser();
      list = list.filter(s => user && s.authorId === user.id);
    } else if (Feed.scoped === 'favs') {
      const user = Auth.getUser();
      const favs = user ? (Storage.get(STORAGE_KEYS.FAVORITES, {})[user.id] || []) : [];
      list = list.filter(s => favs.includes(s.id));
    }

    const q = Feed.query.trim().toLowerCase();
    if (q) {
      list = list.filter(s =>
        s.title.toLowerCase().includes(q) ||
        s.authorName.toLowerCase().includes(q) ||
        s.tags.some(t => t.toLowerCase().includes(q))
      );
    }

    if (!Feed.scoped) {
      if (Feed.filter === 'favorites') {
        list = list.filter(s => Feed.isFavorited(s.id));
      }
    }

    switch (Feed.filter) {
      case 'new':
        list.sort((a, b) => b.createdAt - a.createdAt);
        break;
      case 'downloads':
        list.sort((a, b) => b.downloads - a.downloads);
        break;
      case 'plays':
        list.sort((a, b) => b.plays - a.plays);
        break;
      case 'favorites':
        list.sort((a, b) => Feed.favCountFor(b.id) - Feed.favCountFor(a.id));
        break;
      default: // trending — комплексный авто-рейтинг
        list.sort((a, b) => Utils.computeScore(b, Feed.favCountFor(b.id)) - Utils.computeScore(a, Feed.favCountFor(a.id)));
    }

    return list;
  },

  /* ---------- Рендер карточки ---------- */
  cardTemplate(sound, compact = false) {
    const favActive = Feed.isFavorited(sound.id) ? 'active' : '';
    const likeState = Feed.userLikeState(sound.id);
    const user = Auth.getUser();
    const isOwner = user && user.id === sound.authorId;
    const peaksBars = sound.peaks.map(p => `<span style="--h:${Math.max(0.08, p)}"></span>`).join('');

    return `
    <article class="sound-card ${compact ? 'compact' : ''}" data-id="${sound.id}">
      <div class="sound-body">
        <div class="sound-titlerow">
          <h3 class="sound-title" title="${Utils.escapeHtml(sound.title)}">${Utils.escapeHtml(sound.title)}</h3>
          ${isOwner ? `
          <div class="sound-owner-menu">
            ${compact ? `
              <button class="icon-btn xs" data-delete="${sound.id}" title="Удалить"><i class="fa-solid fa-trash"></i></button>
            ` : `
              <button class="icon-btn xs owner-menu-btn" data-owner-menu="${sound.id}"><i class="fa-solid fa-ellipsis-vertical"></i></button>
              <div class="owner-dropdown" id="owner-dropdown-${sound.id}">
                <button data-edit="${sound.id}"><i class="fa-solid fa-pen"></i> Изменить</button>
                <button data-delete="${sound.id}" class="danger"><i class="fa-solid fa-trash"></i> Удалить</button>
              </div>
            `}
          </div>` : ''}
        </div>
        <a class="sound-author" href="#profile" data-author="${sound.authorId}">
          ${sound.authorAvatarImage ? `<img src="${sound.authorAvatarImage}" alt="avatar" class="sound-author-avatar">` : `<span>${sound.authorAvatar}</span>`} ${Utils.escapeHtml(sound.authorName)}
        </a>

        <div class="waveform" data-waveform="${sound.id}">
          <div class="waveform-progress" data-progress="${sound.id}" style="width:0%"></div>
          ${peaksBars}
        </div>

        <div class="sound-timer-row">
          <div class="sound-timer" data-timer="${sound.id}">0:00 / ${Utils.formatDuration(sound.duration)}</div>
          <button class="play-btn" data-play-id="${sound.id}" title="Слушать">
            <i class="fa-solid fa-play play-icon"></i>
            <i class="fa-solid fa-pause pause-icon"></i>
          </button>
        </div>

        <div class="sound-tags">
          ${sound.tags.slice(0, 3).map(t => `<span class="tag" data-tag="${Utils.escapeHtml(t)}">#${Utils.escapeHtml(t)}</span>`).join('')}
        </div>

        <div class="sound-stats">
          <span title="Прослушивания"><i class="fa-solid fa-headphones"></i> ${Utils.formatCompact(sound.plays)}</span>
          <span title="Скачивания"><i class="fa-solid fa-download"></i> ${Utils.formatCompact(sound.downloads)}</span>
          <span title="Лайки"><i class="fa-solid fa-heart"></i> ${Utils.formatCompact(sound.likes)}</span>
          <span title="Комментарии"><i class="fa-solid fa-comment"></i> ${Utils.formatCompact(sound.commentsCount)}</span>
        </div>

        <div class="sound-actions">
          <button class="act-btn like-btn ${likeState === 1 ? 'active' : ''}" data-like="${sound.id}" title="Нравится">
            <i class="fa-solid fa-thumbs-up"></i>
          </button>
          <button class="act-btn dislike-btn ${likeState === -1 ? 'active' : ''}" data-dislike="${sound.id}" title="Не нравится">
            <i class="fa-solid fa-thumbs-down"></i>
          </button>
          <button class="act-btn fav-btn ${favActive}" data-fav="${sound.id}" title="В избранное">
            <i class="fa-solid fa-heart"></i>
          </button>
          <button class="act-btn" data-comments="${sound.id}" title="Комментарии">
            <i class="fa-solid fa-comment"></i>
          </button>
          <button class="act-btn" data-download="${sound.id}" title="Скачать">
            <i class="fa-solid fa-download"></i>
          </button>
          <button class="act-btn" data-share="${sound.id}" title="Поделиться">
            <i class="fa-solid fa-share-nodes"></i>
          </button>
          <button class="act-btn" data-report="${sound.id}" title="Пожаловаться">
            <i class="fa-solid fa-flag"></i>
          </button>
        </div>
      </div>
    </article>`;
  },

  render(reset = true) {
    const grid = document.getElementById('feed-grid');
    const emptyState = document.getElementById('feed-empty');
    const skeletons = document.getElementById('feed-skeletons');
    if (!grid) return;

    if (reset) {
      Feed.clearHighlightedSound();
    }

    const ranked = Feed.getRanked();
    if (reset) {
      Feed.rendered = 0;
      grid.innerHTML = '';
    }

    document.getElementById('results-count') && (document.getElementById('results-count').textContent = `${ranked.length} ${Feed.pluralSounds(ranked.length)}`);

    if (!ranked.length) {
      emptyState.classList.remove('hidden');
      skeletons.innerHTML = '';
      return;
    }
    emptyState.classList.add('hidden');

    const nextSlice = ranked.slice(Feed.rendered, Feed.rendered + PAGE_SIZE);
    const frag = document.createElement('div');
    frag.innerHTML = nextSlice.map(s => Feed.cardTemplate(s)).join('');
    const newCards = Array.from(frag.children);
    newCards.forEach(c => grid.appendChild(c));

    if (window.gsap && newCards.length) {
      gsap.fromTo(newCards, { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: 0.5, stagger: 0.06, ease: 'power2.out' });
    }

    Feed.rendered += nextSlice.length;
    skeletons.innerHTML = '';

    if (Feed.highlightedSoundId) {
      Feed.highlightSound(Feed.highlightedSoundId, false);
    }
  },

  clearHighlightedSound() {
    Feed.highlightedSoundId = null;
    document.querySelectorAll('.sound-card.highlighted').forEach(card => card.classList.remove('highlighted'));
  },

  highlightSound(soundId, scroll = true) {
    Feed.clearHighlightedSound();
    if (!soundId) return;
    const card = document.querySelector(`.sound-card[data-id="${soundId}"]`);
    if (!card) return;
    card.classList.add('highlighted');
    Feed.highlightedSoundId = soundId;
    if (scroll) {
      card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    setTimeout(() => {
      if (card && card.classList.contains('highlighted')) {
        card.classList.remove('highlighted');
      }
    }, 3000);
  },

  renderHighlightedSound(soundId) {
    const grid = document.getElementById('feed-grid');
    const emptyState = document.getElementById('feed-empty');
    const skeletons = document.getElementById('feed-skeletons');
    if (!grid) return;

    const originalFilter = Feed.filter;
    const originalScoped = Feed.scoped;
    const originalQuery = Feed.query;
    Feed.filter = 'trending';
    Feed.scoped = null;
    Feed.query = '';
    const ranked = Feed.getRanked();
    Feed.filter = originalFilter;
    Feed.scoped = originalScoped;
    Feed.query = originalQuery;
    const targetIndex = ranked.findIndex(s => s.id === soundId);
    if (targetIndex === -1) {
      Feed.render(true);
      return;
    }

    const countToShow = Math.min(ranked.length, Math.max(PAGE_SIZE, targetIndex + 1));
    Feed.rendered = countToShow;
    grid.innerHTML = ranked.slice(0, countToShow).map(s => Feed.cardTemplate(s)).join('');
    document.getElementById('results-count') && (document.getElementById('results-count').textContent = `${ranked.length} ${Feed.pluralSounds(ranked.length)}`);
    emptyState.classList.add('hidden');
    skeletons.innerHTML = '';
    Feed.highlightSound(soundId);
  },

  renderCompact(containerId, list, emptyId) {
    const grid = document.getElementById(containerId);
    const empty = document.getElementById(emptyId);
    if (!grid) return;
    if (!list.length) {
      grid.innerHTML = '';
      if (empty) empty.classList.remove('hidden');
      return;
    }
    if (empty) empty.classList.add('hidden');
    grid.innerHTML = list.map(s => Feed.cardTemplate(s, true)).join('');
  },

  pluralSounds(n) {
    const mod10 = n % 10, mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return 'звук';
    if ([2, 3, 4].includes(mod10) && ![12, 13, 14].includes(mod100)) return 'звука';
    return 'звуков';
  },

  hasMore() {
    return Feed.rendered < Feed.getRanked().length;
  },

  loadMore() {
    if (Feed.scoped) return; // на профиле — без infinite scroll
    if (!Feed.hasMore()) return;
    Feed.render(false);
  },

  /* ---------- Взаимодействия ---------- */
  async registerPlay(soundId) {
    const sound = Feed.getSoundById(soundId);
    if (!sound) return;
    if (Feed.hasRecordedPlay(soundId)) return;
    Feed.recordPlay(soundId);
    sound.plays = (sound.plays || 0) + 1;
    Feed.persist();
    const statEls = document.querySelectorAll(`.sound-card[data-id="${soundId}"] .sound-stats span[title="Прослушивания"]`);
    statEls.forEach(el => el.innerHTML = `<i class="fa-solid fa-headphones"></i> ${Utils.formatCompact(sound.plays)}`);
    try {
      const updated = await SupabaseAPI.incrementSoundCounters(soundId, { plays: 1 });
      if (updated && typeof updated.plays === 'number') {
        sound.plays = updated.plays;
        Feed.persist();
        Feed.refreshCardInPlace(soundId);
      }
    } catch (err) {
      console.warn('Failed to update play count in Supabase:', err);
    }
  },

  async toggleLike(soundId, value) {
    if (!Auth.isLoggedIn()) return App.requireAuth();
    const sound = Feed.getSoundById(soundId);
    if (!sound) return;
    const user = Auth.getUser();
    const likes = Storage.get(STORAGE_KEYS.LIKES, {});
    likes[soundId] = likes[soundId] || {};
    const prev = likes[soundId][user.id] || 0;

    let deltaLikes = 0;
    let deltaDislikes = 0;
    if (prev === 1) deltaLikes -= 1;
    if (prev === -1) deltaDislikes -= 1;

    const next = prev === value ? 0 : value;
    likes[soundId][user.id] = next;
    if (next === 1) deltaLikes += 1;
    if (next === -1) deltaDislikes += 1;

    sound.likes = Math.max(0, (sound.likes || 0) + deltaLikes);
    sound.dislikes = Math.max(0, (sound.dislikes || 0) + deltaDislikes);
    Storage.set(STORAGE_KEYS.LIKES, likes);
    Feed.persist();

    try {
      const updated = await SupabaseAPI.incrementSoundCounters(soundId, { likes: deltaLikes, dislikes: deltaDislikes });
      if (updated) {
        sound.likes = updated.likes || 0;
        sound.dislikes = updated.dislikes || 0;
        Feed.persist();
      }
    } catch (err) {
      console.warn('Failed to update like/dislike counters in Supabase:', err);
    }

    if (next === 1) UI.toast('Лайк поставлен', 'like', 'fa-thumbs-up');
    Feed.refreshCardInPlace(soundId);
  },

  toggleFavorite(soundId) {
    if (!Auth.isLoggedIn()) return App.requireAuth();
    const user = Auth.getUser();
    const favs = Storage.get(STORAGE_KEYS.FAVORITES, {});
    favs[user.id] = favs[user.id] || [];
    const idx = favs[user.id].indexOf(soundId);
    if (idx >= 0) {
      favs[user.id].splice(idx, 1);
      UI.toast('Убрано из избранного', 'info', 'fa-heart-crack');
    } else {
      favs[user.id].push(soundId);
      UI.toast('Добавлено в избранное', 'success', 'fa-heart');
      const sound = Feed.getSoundById(soundId);
      if (sound && sound.authorId !== user.id) {
        UI.addNotification({ icon: 'fa-heart', text: `${user.name} добавил «${sound.title}» в избранное` });
      }
    }
    Storage.set(STORAGE_KEYS.FAVORITES, favs);
    Feed.refreshCardInPlace(soundId);
    if (window.Profile) Profile.refreshStatsOnly();
  },

  async download(soundId) {
    const sound = Feed.getSoundById(soundId);
    if (!sound) return;
    sound.downloads = (sound.downloads || 0) + 1;
    Feed.persist();
    const url = Player.getAudioUrl(sound);
    const a = document.createElement('a');
    a.href = url;
    const safeTitle = `${sound.title.replace(/[^\wа-яА-ЯёЁ\s-]/g, '')}`;
    const filename = sound._audioName ? sound._audioName : `${safeTitle}.wav`;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();

    UI.toast('Скачивание началось', 'success', 'fa-download');
    Feed.refreshCardInPlace(soundId);
    try {
      const updated = await SupabaseAPI.incrementSoundCounters(soundId, { downloads: 1 });
      if (updated && typeof updated.downloads === 'number') {
        sound.downloads = updated.downloads;
        Feed.persist();
        Feed.refreshCardInPlace(soundId);
      }
    } catch (err) {
      console.warn('Failed to update download counter in Supabase:', err);
    }
  },

  attachFileToSound(soundId) {
    const sound = Feed.getSoundById(soundId);
    if (!sound || !Feed.uploadFile) return;
    const file = Feed.uploadFile;
    try {
      const blobUrl = URL.createObjectURL(file);
      sound._audioUrl = blobUrl;
      sound._audioName = file.name;
      const fr = new FileReader();
      fr.onload = (ev) => {
        try {
          const dataUrl = ev.target.result;
          sound._audioUrl = dataUrl;
          const a = new Audio(dataUrl);
          a.addEventListener('loadedmetadata', () => {
            if (a.duration && Number.isFinite(a.duration)) {
              sound.duration = Math.round(a.duration);
            }
            Feed.persist();
            Feed.refreshCardInPlace(sound.id);
          });
          try { URL.revokeObjectURL(blobUrl); } catch (e) {}
          Feed.persist();
          Feed.refreshCardInPlace(sound.id);
        } catch (e) {}
      };
      fr.readAsDataURL(file);
    } catch (e) {}
  },

  share(soundId) {
    const sound = Feed.getSoundById(soundId);
    document.getElementById('comments-modal-head'); // no-op guard
    document.getElementById('share-link-input').value = `${location.origin}${location.pathname}#sound-${soundId}`;
    UI.openModal('share-modal-backdrop');
    document.getElementById('share-copy-btn').onclick = () => {
      const input = document.getElementById('share-link-input');
      input.select();
      if (navigator.clipboard) navigator.clipboard.writeText(input.value).catch(() => {});
      UI.toast('Ссылка скопирована', 'success', 'fa-copy');
    };
  },

  report(soundId) {
    Feed.activeSoundIdForModal = soundId;
    UI.openModal('report-modal-backdrop');
  },

  async deleteSound(soundId) {
    const sound = Feed.getSoundById(soundId);
    if (!sound) return;
    const ok = await UI.confirm({ title: 'Удалить звук?', text: `«${sound.title}» будет удалён без возможности восстановления.` });
    if (!ok) return;

    try {
      await SupabaseAPI.deleteSound(soundId);
      // revoke any objectURL we created
      try {
        if (sound && sound._audioUrl && sound._audioUrl.startsWith && sound._audioUrl.startsWith('blob:')) {
          URL.revokeObjectURL(sound._audioUrl);
        }
      } catch (e) {
        console.warn('Failed to revoke object URL:', e);
      }
      Feed.sounds = Feed.sounds.filter(s => s.id !== soundId);
      Feed.persist();
      UI.toast('Звук удалён', 'info', 'fa-trash');
      App.refreshCurrentPage();
    } catch (err) {
      console.error('Ошибка удаления звука:', err);
      UI.toast('Не удалось удалить звук', 'error', 'fa-exclamation-triangle');
    }
  },

  refreshCardInPlace(soundId) {
    const sound = Feed.getSoundById(soundId);
    if (!sound) return;
    document.querySelectorAll(`.sound-card[data-id="${soundId}"]`).forEach(card => {
      const replacement = document.createElement('div');
      replacement.innerHTML = Feed.cardTemplate(sound, card.classList.contains('compact'));
      const newCard = replacement.firstElementChild;
      card.replaceWith(newCard);
    });
  },

  /* ---------- Комментарии ---------- */
  async openComments(soundId) {
    Feed.activeSoundIdForModal = soundId;
    await Feed.renderComments(soundId);
    const commentInput = document.getElementById('comment-input');
    if (commentInput) {
      commentInput.value = '';
      commentInput.focus();
    }
    UI.openModal('comments-modal-backdrop');
  },

  async renderComments(soundId) {
    const sound = Feed.getSoundById(soundId);
    if (!sound) {
      console.error('❌ Sound not found in renderComments:', soundId);
      return;
    }

    let list = [];
    try {
      list = await SupabaseAPI.getComments(soundId);
    } catch (e) {
      console.error('Ошибка загрузки комментариев из Supabase:', e);
      const commentsMap = Storage.get(STORAGE_KEYS.COMMENTS, {});
      list = commentsMap[soundId] || [];
    }

    console.log('🔍 renderComments - soundId:', soundId, 'comments count:', list.length);

    const headEl = document.getElementById('comments-modal-head');
    if (headEl) {
      headEl.innerHTML = `
        <div><h3>${Utils.escapeHtml(sound.title)}</h3><span>${list.length} комментариев</span></div>
      `;
    }

    const container = document.getElementById('comments-list');
    if (!container) {
      console.error('❌ Container #comments-list not found');
      return;
    }
    
    if (!list.length) {
      container.innerHTML = `<p class="empty-hint">Пока нет комментариев. Будь первым!</p>`;
      return;
    }
    
    const html = list.slice().reverse().map(c => `
      <div class="comment-item">
        ${c.authorAvatarImage ? `<img src="${c.authorAvatarImage}" alt="avatar" class="comment-avatar-img">` : `<span class="comment-avatar">${c.authorAvatar}</span>`}
        <div class="comment-body">
          <div class="comment-meta"><strong>${Utils.escapeHtml(c.authorName)}</strong><span>${Utils.timeAgo(c.createdAt)}</span></div>
          <p>${Utils.escapeHtml(c.text)}</p>
        </div>
      </div>
    `).join('');
    console.log('📝 Rendering comments HTML, count:', list.length);
    container.innerHTML = html;
  },

  async postComment(text) {
    if (!Auth.isLoggedIn()) return App.requireAuth();
    const soundId = Feed.activeSoundIdForModal;
    console.log('📝 postComment called with soundId:', soundId, 'text:', text);
    if (!soundId) {
      console.error('❌ soundId is empty');
      UI.toast('Ошибка: звук не найден', 'error');
      return;
    }
    const sound = Feed.getSoundById(soundId);
    if (!sound) {
      console.error('❌ sound not found');
      UI.toast('Ошибка: звук не найден', 'error');
      return;
    }

    try {
      const created = await SupabaseAPI.postComment(soundId, text);
      // reload comments for accurate data
      const comments = await SupabaseAPI.getComments(soundId);
      // Update UI
      await Feed.renderComments(soundId);
      // Update local sound comments count from the latest data
      sound.commentsCount = comments.length;
      Feed.persist();
      Feed.refreshCardInPlace(soundId);
      UI.toast('Комментарий опубликован', 'success', 'fa-comment');
      return created;
    } catch (err) {
      console.error('Ошибка отправки комментария:', err);
      UI.toast('Ошибка при отправке комментария', 'error');
    }
  },

  /* ---------- Загрузка нового звука ---------- */
  renderCoverPicker() {
    // cover picker UI removed — covers are autogenerated when publishing
  },

  updateTagSuggestions() {
    const all = new Set();
    Feed.sounds.forEach(s => (s.tags || []).forEach(t => all.add(t)));
    const ds = document.getElementById('tag-suggestions');
    if (!ds) return;
    ds.innerHTML = Array.from(all).map(t => `<option value="${Utils.escapeHtml(t)}"></option>`).join('');
  },

  async publishSound({ title, tags }) {
    const user = Auth.getUser();
    const emoji = COVER_EMOJIS[Feed.uploadCoverIndex] || '🎵';
    const seedNum = Math.floor(Math.random() * 999);
    const file = Feed.uploadFile;
    const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean).slice(0, 8);

    // prepare cover
    const cover = makeCover(seedNum, emoji);

    try {
      let peaks = genPeaks(80, seedNum);
      let duration = 0;
      let uploadFile = null;

      if (file) {
        // compute peaks and duration using objectURL (fast)
        const blobUrl = URL.createObjectURL(file);
        try {
          const p = await Utils.analyzeAudioPeaks(blobUrl, 80);
          peaks = p;
        } catch (e) {
          console.warn('Ошибка анализа peaks:', e);
        }
        try {
          const a = new Audio(blobUrl);
          await new Promise(res => a.addEventListener('loadedmetadata', res));
          duration = Math.round(a.duration || 0);
        } catch (e) {
          console.warn('Ошибка определения длительности:', e);
        }
        uploadFile = file;
        try { URL.revokeObjectURL(blobUrl); } catch (e) {}
      }

      const created = await SupabaseAPI.createSound({ title, tags: tagArr, file: uploadFile, cover, emoji, peaks, duration });

      // Add to local cache and render
      Feed.sounds.unshift(created);
      Feed.persist();

      UI.addNotification({ icon: 'fa-cloud-arrow-up', text: `Звук «${title}» опубликован` });
      return created;
    } catch (err) {
      console.error('Ошибка публикации звука:', err);
      const message = err && err.message ? err.message : 'Ошибка загрузки звука';
      UI.toast(message, 'error');
      return null;
    }
  },

  updateSound(soundId, patch) {
    const sound = Feed.getSoundById(soundId);
    if (!sound) return;
    // Don't update description field
    const { description, ...safePatch } = patch;
    Object.assign(sound, safePatch);
    Feed.persist();
    Feed.refreshCardInPlace(soundId);
  },

  /* ---------- Инициализация ---------- */
  async init() {
    await Feed.load();
    Feed.bindFilterTabs();
    Feed.bindSearch();
    Feed.bindGridDelegation();
    Feed.bindInfiniteScroll();
    Feed.bindUploadForm();
    Feed.animateHeroStats();
  },

  bindFilterTabs() {
    document.querySelectorAll('#filter-tabs .filter-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        if (Feed.filter === 'favorites' && tab.dataset.filter !== 'favorites' && !Auth.isLoggedIn()) { /* noop */ }
        document.querySelectorAll('#filter-tabs .filter-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        Feed.filter = tab.dataset.filter;
        if (Feed.filter === 'favorites' && !Auth.isLoggedIn()) {
          UI.toast('Войди, чтобы видеть избранное', 'info', 'fa-heart');
        }
        Feed.render(true);
      });
    });
  },

  bindSearch() {
    const handler = Utils.debounce((val) => {
      Feed.query = val;
      Feed.render(true);
      document.getElementById('global-search').value = val;
      document.getElementById('global-search-mobile').value = val;
    }, 200);
    document.getElementById('global-search').addEventListener('input', (e) => handler(e.target.value));
    document.getElementById('global-search-mobile').addEventListener('input', (e) => handler(e.target.value));
    // feed-search removed from UI
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('global-search').focus();
      }
    });
  },

  bindGridDelegation() {
    document.addEventListener('click', (e) => {
      const playBtn = e.target.closest('[data-play-id]');
      if (playBtn) { Player.toggle(playBtn.dataset.playId); return; }

      const wfEl = e.target.closest('[data-waveform]');
      if (wfEl) { Player.toggle(wfEl.dataset.waveform); return; }

      const likeBtn = e.target.closest('[data-like]');
      if (likeBtn) { Feed.toggleLike(likeBtn.dataset.like, 1); return; }

      const dislikeBtn = e.target.closest('[data-dislike]');
      if (dislikeBtn) { Feed.toggleLike(dislikeBtn.dataset.dislike, -1); return; }

      const favBtn = e.target.closest('[data-fav]');
      if (favBtn) { Feed.toggleFavorite(favBtn.dataset.fav); return; }

      const commentsBtn = e.target.closest('[data-comments]');
      if (commentsBtn) { Feed.openComments(commentsBtn.dataset.comments); return; }

      const downloadBtn = e.target.closest('[data-download]');
      if (downloadBtn) { Feed.download(downloadBtn.dataset.download); return; }

      const shareBtn = e.target.closest('[data-share]');
      if (shareBtn) { Feed.share(shareBtn.dataset.share); return; }

      const reportBtn = e.target.closest('[data-report]');
      if (reportBtn) { Feed.report(reportBtn.dataset.report); return; }

      const ownerMenuBtn = e.target.closest('[data-owner-menu]');
      if (ownerMenuBtn) {
        e.stopPropagation();
        const dd = document.getElementById(`owner-dropdown-${ownerMenuBtn.dataset.ownerMenu}`);
        document.querySelectorAll('.owner-dropdown.open').forEach(o => { if (o !== dd) o.classList.remove('open'); });
       if (dd) dd.classList.toggle('open');
        return;
      }

      const editBtn = e.target.closest('[data-edit]');
      if (editBtn) { Feed.openEdit(editBtn.dataset.edit); return; }

      const deleteBtn = e.target.closest('[data-delete]');
      if (deleteBtn) { Feed.deleteSound(deleteBtn.dataset.delete); return; }

      const tagBtn = e.target.closest('[data-tag]');
      if (tagBtn && !e.target.closest('.tag-suggestion-item')) {
        Feed.query = tagBtn.dataset.tag;
        document.getElementById('global-search').value = Feed.query;
        App.navigate('feed');
        Feed.render(true);
        return;
      }

      // Hide tag suggestions panel when clicking outside
      const tagPanel = document.getElementById('tag-suggestions-panel');
      if (tagPanel && !e.target.closest('.tag-input-wrapper')) {
        tagPanel.style.display = 'none';
      }

      if (!e.target.closest('.owner-dropdown, .owner-menu-btn')) {
        document.querySelectorAll('.owner-dropdown.open').forEach(o => o.classList.remove('open'));
      }
    });

    // Синхронизируем UI при скроллировании (для поддержки воспроизведения при скроллировании)
    document.addEventListener('scroll', () => {
      if (Player.currentId && Player.isPlaying) {
        Player.syncUIState();
      }
    }, { passive: true });

    const commentForm = document.getElementById('comment-form');
    console.log('📋 Comment form element:', commentForm);
    if (commentForm) {
      commentForm.addEventListener('submit', (e) => {
        console.log('📋 Comment form submit event fired');
        e.preventDefault();
        const input = document.getElementById('comment-input');
        const text = input.value.trim();
        console.log('📋 Comment input value:', text, 'length:', text.length);
        if (!text) {
          UI.toast('Напиши комментарий', 'info', 'fa-comment');
          return;
        }
        console.log('📋 Calling Feed.postComment with:', text);
        Feed.postComment(text);
        input.value = '';
        input.focus();
      });
    } else {
      console.error('❌ Comment form not found!');
    }
    
    // Also add delegation to document level as fallback
    document.addEventListener('submit', (e) => {
      if (e.target.id === 'comment-form') {
        console.log('📋 Comment form submit (via delegation)');
        e.preventDefault();
        const input = document.getElementById('comment-input');
        const text = input.value.trim();
        console.log('📋 Comment input value:', text);
        if (text) {
          Feed.postComment(text);
          input.value = '';
          input.focus();
        }
      }
    });

    document.getElementById('report-form').addEventListener('submit', (e) => {
      e.preventDefault();
      UI.closeModal('report-modal-backdrop');
      UI.toast('Жалоба отправлена модераторам', 'success', 'fa-flag');
    });
  },

  openEdit(soundId) {
    const sound = Feed.getSoundById(soundId);
    if (!sound) return;
    document.getElementById('upload-title').value = sound.title;
    document.getElementById('upload-tags').value = sound.tags.join(', ');
    const uploadHeader = document.querySelector('#upload-form h2');
    if (uploadHeader) uploadHeader.remove();
    document.getElementById('upload-form').dataset.editing = soundId;
    document.querySelector('.upload-modal h2').innerHTML = `<i class="fa-solid fa-pen"></i> Изменить звук`;
    document.querySelector('#upload-form button[type="submit"]').innerHTML = `<i class="fa-solid fa-check"></i> Сохранить изменения`;
    UI.openModal('upload-modal-backdrop');
  },

  bindInfiniteScroll() {
    const sentinel = document.getElementById('feed-sentinel');
    Feed.observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting && document.getElementById('page-feed').classList.contains('hidden') === false) {
          Feed.loadMore();
        }
      });
    }, { rootMargin: '400px' });
    Feed.observer.observe(sentinel);
  },

  bindUploadForm() {
    const dropzone = document.getElementById('upload-dropzone');
    const fileInput = document.getElementById('upload-file-input');
    dropzone.addEventListener('click', () => fileInput.click());
    ['dragover', 'dragenter'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.add('drag'); }));
    ['dragleave', 'drop'].forEach(evt => dropzone.addEventListener(evt, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); }));
    dropzone.addEventListener('drop', (e) => {
      const file = e.dataTransfer.files[0];
      if (file) Feed.handleFileSelect(file);
    });
    fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) Feed.handleFileSelect(file);
    });

     // Tag input autocomplete
    const tagsInput = document.getElementById('upload-tags');
    const suggestionsPanel = document.getElementById('tag-suggestions-panel');

    tagsInput.addEventListener('input', (e) => {
      e.stopPropagation();
      const value = e.target.value;
      const lastCommaIdx = value.lastIndexOf(',');
      const afterLastComma = lastCommaIdx === -1 ? value : value.substring(lastCommaIdx + 1);
      const currentTag = afterLastComma.trim();

      if (!currentTag) {
        suggestionsPanel.style.display = 'none';
        return;
      }

      // Get all existing tags
      const allTags = new Set();
      Feed.sounds.forEach(s => (s.tags || []).forEach(t => allTags.add(t)));

      // Find matching tags
      const matches = Array.from(allTags)
        .filter(t => t.toLowerCase().includes(currentTag.toLowerCase()))
        .sort();

      // Create suggestion items
      const items = [];
      
      // Existing tags
      matches.forEach(tag => {
        items.push({ text: tag, isNew: false, isExisting: true });
      });

      // Add "create new" option if the tag doesn't exist exactly
      if (currentTag && !matches.includes(currentTag)) {
        items.push({ text: currentTag, isNew: true, isExisting: false });
      }

      if (items.length === 0) {
        suggestionsPanel.style.display = 'none';
        return;
      }

      suggestionsPanel.innerHTML = items.map(item => `
        <div class="tag-suggestion-item ${item.isExisting ? 'existing' : ''} ${item.isNew ? 'create-new' : ''}" data-tag="${Utils.escapeHtml(item.text)}" data-is-new="${item.isNew}">
          ${item.isNew ? '<i class="fa-solid fa-plus"></i>' : '<i class="fa-solid fa-tag"></i>'}
          ${Utils.escapeHtml(item.text)}
        </div>
      `).join('');

      suggestionsPanel.style.display = 'block';

      // Handle item selection
      suggestionsPanel.querySelectorAll('.tag-suggestion-item').forEach(item => {
        item.addEventListener('click', (evt) => {
          evt.stopPropagation();
          const selectedTag = item.dataset.tag;
          
          // Replace the current tag being typed
          let newValue;
          if (lastCommaIdx === -1) {
            newValue = selectedTag;
          } else {
            newValue = value.substring(0, lastCommaIdx + 1) + ' ' + selectedTag;
          }
          
          // Add comma for next tag
          tagsInput.value = newValue + ', ';
          suggestionsPanel.style.display = 'none';
          tagsInput.focus();
        });
      });
    });

    // Hide suggestions when clicking outside (delegate to main listener)

    document.getElementById('upload-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const submitBtn = form.querySelector('button[type="submit"]');
      if (Feed.uploadInProgress) {
        UI.toast('Загрузка уже выполняется, подожди...', 'info', 'fa-spinner');
        return;
      }
      const title = document.getElementById('upload-title').value.trim();
      const tags = document.getElementById('upload-tags').value.trim();
      if (!title || !tags) return;

      const editingId = form.dataset.editing;
      if (!editingId && !Feed.uploadFile) {
        UI.toast('Выберите аудиофайл для загрузки', 'info', 'fa-file-audio');
        return;
      }

      Feed.uploadInProgress = true;
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.dataset.originalText = submitBtn.innerHTML;
        submitBtn.innerHTML = `<i class="fa-solid fa-circle-notch fa-spin"></i> Сохраняем...`;
      }

      try {
        if (editingId) {
          Feed.updateSound(editingId, { title, tags: tags.split(',').map(t => t.trim()).filter(Boolean) });
          if (Feed.uploadFile) {
            Feed.attachFileToSound(editingId);
          }
          UI.toast('Изменения сохранены', 'success', 'fa-check');
          delete form.dataset.editing;
          document.querySelector('.upload-modal h2').innerHTML = `<i class="fa-solid fa-cloud-arrow-up"></i> Загрузить звук`;
          document.querySelector('#upload-form button[type="submit"]').innerHTML = `<i class="fa-solid fa-upload"></i> Опубликовать`;
        } else {
          const sound = await Feed.publishSound({ title, tags });
          if (sound) {
            UI.toast('Звук опубликован!', 'success', 'fa-circle-check');
            App.navigate('feed');
            Feed.filter = 'new';
            document.querySelectorAll('#filter-tabs .filter-tab').forEach(t => t.classList.toggle('active', t.dataset.filter === 'new'));
          }
        }
      } finally {
        Feed.uploadInProgress = false;
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.innerHTML = submitBtn.dataset.originalText || submitBtn.innerHTML;
          delete submitBtn.dataset.originalText;
        }
      }

      form.reset();
      Feed.uploadFile = null;
      document.getElementById('upload-dropzone-text').textContent = 'Перетащи аудиофайл сюда или нажми, чтобы выбрать';
      suggestionsPanel.style.display = 'none';
      UI.closeModal('upload-modal-backdrop');
      Feed.updateTagSuggestions();
      App.refreshCurrentPage();
    });
    // init suggestions
    Feed.updateTagSuggestions();
  },

  handleFileSelect(file) {
    Feed.uploadFile = file;
    document.getElementById('upload-dropzone-text').innerHTML = `<i class="fa-solid fa-circle-check" style="color:var(--accent)"></i> ${Utils.escapeHtml(file.name)}`;
  },

  animateHeroStats() {
    const sounds = Feed.sounds;
    const totalPlays = sounds.reduce((a, s) => a + s.plays, 0);
    const authors = new Set(sounds.map(s => s.authorId)).size;
    const targets = [sounds.length, totalPlays, authors];
    document.querySelectorAll('#hero-stats .hero-stat-num').forEach((el, i) => {
      const target = targets[i] || 0;
      if (window.gsap) {
        gsap.to({ v: 0 }, {
          v: target, duration: 1.6, ease: 'power2.out',
          onUpdate: function () { el.textContent = Utils.formatCompact(Math.floor(this.targets()[0].v)); }
        });
      } else {
        el.textContent = Utils.formatCompact(target);
      }
    });
  }
};
