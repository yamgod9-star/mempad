/* ============================================================
   MEMпад — data.js
   Схема хранения данных в localStorage + генерация сид-данных.
   Всё построено так, чтобы легко заменить localStorage на
   реальные запросы к PHP/Node backend (см. комментарии REST:).
   ============================================================ */

const STORAGE_KEYS = {
  SOUNDS: 'mempad_sounds',
  USER: 'mempad_current_user',
  USERS: 'mempad_users',
  LIKES: 'mempad_likes',           // { [soundId]: { [userId]: 1 | -1 } }
  FAVORITES: 'mempad_favorites',   // { [userId]: [soundId, ...] }
  COMMENTS: 'mempad_comments',     // { [soundId]: [comment, ...] }
  NOTIFICATIONS: 'mempad_notifications', // [notification, ...]
  SEEDED: 'mempad_seeded_v2'
};

/* ---------- Обложки-градиенты (SVG data-uri), чтобы не тянуть картинки ---------- */
const COVER_PALETTES = [
  ['#5DD62C', '#0F0F0F'], ['#337418', '#5DD62C'], ['#1b1b1b', '#5DD62C'],
  ['#2a6e18', '#0f0f0f'], ['#5DD62C', '#1a3d0d'], ['#0f0f0f', '#337418'],
  ['#3c8f22', '#101010'], ['#5DD62C', '#204d10']
];
function makeCover(seed, emoji) {
  const pal = COVER_PALETTES[seed % COVER_PALETTES.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400">
    <defs>
      <linearGradient id="g${seed}" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="${pal[0]}"/>
        <stop offset="100%" stop-color="${pal[1]}"/>
      </linearGradient>
      <filter id="blur${seed}"><feGaussianBlur stdDeviation="40"/></filter>
    </defs>
    <rect width="400" height="400" fill="#0F0F0F"/>
    <rect width="400" height="400" fill="url(#g${seed})" opacity="0.9"/>
    <circle cx="${80 + (seed*37)%240}" cy="${60 + (seed*53)%200}" r="90" fill="#5DD62C" opacity="0.25" filter="url(#blur${seed})"/>
    <circle cx="${300 - (seed*19)%180}" cy="${320 - (seed*29)%200}" r="70" fill="#0F0F0F" opacity="0.35" filter="url(#blur${seed})"/>
    <text x="50%" y="56%" font-size="140" text-anchor="middle" dominant-baseline="middle">${emoji}</text>
  </svg>`;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
}

/* ---------- Демо waveform-пики (для мгновенного рендера без декодирования аудио) ---------- */
function genPeaks(len, seedNum) {
  const peaks = [];
  let v = 0.3;
  for (let i = 0; i < len; i++) {
    v += (Math.sin((i + seedNum) * 0.4) * 0.15) + (Math.random() - 0.5) * 0.25;
    v = Math.max(0.06, Math.min(1, v));
    peaks.push(Number(v.toFixed(3)));
  }
  return peaks;
}

/* ---------- Демо-аудио: короткие сгенерированные биты (data URI, WAV) ----------
   Чтобы плеер был по-настоящему рабочим без внешних файлов, генерируем
   короткие синтетические сигналы прямо в браузере (см. utils.js -> synthAudioDataUrl). */

const SEED_AUTHORS = [
  { id: 'u_koba', name: 'kobalt.exe', tag: '1004', avatar: '🟢' },
  { id: 'u_zhu',  name: 'жужа', tag: '2291', avatar: '🐝' },
  { id: 'u_pixel',name: 'pixelnyash', tag: '0042', avatar: '👾' },
  { id: 'u_max',  name: 'МаксМем', tag: '7777', avatar: '🎧' },
  { id: 'u_null', name: 'null_pointer', tag: '0000', avatar: '💾' },
  { id: 'u_soch', name: 'сочная', tag: '1312', avatar: '🍉' },
  { id: 'u_grim', name: 'grimtone', tag: '6606', avatar: '🕹️' },
  { id: 'u_kap',  name: 'капибарыч', tag: '3033', avatar: '🦫' },
];

const SEED_SOUNDS_RAW = [
  ['Вжух момент', 'Классика для внезапных исчезновений', ['вжух','мем','переход'], '😵‍💫', 1.1],
  ['ОГО КАКОЙ ПАВОРОТ', 'Для неожиданных поворотов сюжета', ['поворот','драма','реакция'], '😱', 2.3],
  ['Кря кря разоблачение', 'Момент истины под утиную кряканье', ['разоблачение','утка','кря'], '🦆', 1.8],
  ['Грустный тромбон', 'Womp womp момент провала', ['грусть','провал','тромбон'], '🎺', 2.0],
  ['Нежданчик MLG', 'Резкий airhorn перед катастрофой', ['mlg','airhorn','катастрофа'], '📯', 1.5],
  ['Бодрый утренний вопль', 'Для звонка будильника в чат', ['утро','вопль','будильник'], '⏰', 1.2],
  ['Кот шипит угрожающе', 'Универсальная угроза', ['кот','шипение','угроза'], '🐱', 1.0],
  ['Аниме вдох удивления', 'Классический "хах?!" вдох', ['аниме','удивление','вдох'], '😳', 0.9],
  ['Deja vu глитч', 'Заедающий момент как в матрице', ['глитч','матрица','баг'], '🌀', 1.7],
  ['Барабанная дробь и тарелка', 'Ba dum tss классика', ['шутка','барабан','рофл'], '🥁', 1.4],
  ['Плач младенца из мема', 'Драма в чистом виде', ['плач','драма','мем'], '👶', 2.1],
  ['Согласие капибары', 'Спокойное одобрение', ['капибара','согласие','вайб'], '🦫', 1.6],
  ['Вой сирены тревоги', 'Внимание, внимание', ['сирена','тревога','warning'], '🚨', 2.5],
  ['Пиксельный левелап', '8-битный успех', ['пиксель','левелап','успех'], '🕹️', 1.3],
  ['Скример-смешок', 'Резкий смех из ниоткуда', ['скример','смех','страх'], '👻', 1.0],
  ['Печатная машинка спам', 'Быстрый тип-тайп для драмы в чате', ['печать','драма','чат'], '⌨️', 1.9],
  ['Вопрос "Чё?"', 'Универсальное недоумение', ['чё','вопрос','недоумение'], '🤨', 0.8],
  ['Стеклянный звон разбития', 'Момент фейла', ['фейл','стекло','разбитие'], '💥', 1.1],
  ['Гитарное соло эпик', 'Для триумфальных моментов', ['гитара','эпик','триумф'], '🎸', 2.8],
  ['Тихий плач в углу', 'Внутренняя боль в звуке', ['грусть','боль','мем'], '😭', 1.5],
  ['Пиу пиу лазеры', 'Космический бой', ['космос','лазер','пиу'], '🔫', 1.2],
  ['Жуткий орган ужаса', 'Драматичный орган на фоне', ['орган','ужас','драма'], '🎹', 3.1],
  ['Хомяк кричит', 'Мемный крик хомяка', ['хомяк','крик','мем'], '🐹', 1.0],
  ['Гонг поражения', 'Финальный аккорд провала', ['гонг','провал','финал'], '🔔', 1.4],
];

function randomBetween(min, max) { return Math.random() * (max - min) + min; }
function daysAgo(n) { return Date.now() - n * 86400000 - Math.random() * 86400000; }

function buildSeedSounds() {
  return SEED_SOUNDS_RAW.map((row, i) => {
    const [title, desc, tags, emoji, duration] = row;
    const author = SEED_AUTHORS[i % SEED_AUTHORS.length];
    const plays = Math.floor(randomBetween(120, 48000));
    const downloads = Math.floor(plays * randomBetween(0.05, 0.35));
    const likes = Math.floor(plays * randomBetween(0.02, 0.18));
    const dislikes = Math.floor(likes * randomBetween(0.02, 0.15));
    const commentsCount = Math.floor(randomBetween(0, 24));
    const createdAt = daysAgo(randomBetween(0, 45));
    return {
      id: 'snd_' + i + '_' + Math.random().toString(36).slice(2, 8),
      title, description: desc, tags,
      authorId: author.id, authorName: author.name, authorAvatar: author.avatar,
      cover: makeCover(i, emoji),
      duration,
      peaks: genPeaks(80, i * 7 + 3),
      plays, downloads, likes, dislikes, commentsCount,
      createdAt,
      emoji
    };
  });
}

const FORUM_CATEGORIES = [
  { id: 'general', name: 'Общее', icon: 'fa-comments', desc: 'Разговоры обо всём подряд' },
  { id: 'sounds', name: 'Звуки и находки', icon: 'fa-volume-high', desc: 'Делись интересными звуками' },
  { id: 'help', name: 'Помощь', icon: 'fa-circle-question', desc: 'Вопросы по сайту' },
  { id: 'ideas', name: 'Идеи и предложения', icon: 'fa-lightbulb', desc: 'Что добавить в MEMпад' },
  { id: 'offtop', name: 'Оффтоп', icon: 'fa-face-grin-squint', desc: 'Мемы и флуд' },
];

const SEED_TOPICS_RAW = [
  ['general', 'Всем привет! Кто тут новенький?', 'Залетайте, знакомимся, делимся любимыми звуками недели.'],
  ['sounds', 'Нашёл огненный вжух-звук, слушайте', 'Кинул в ленту сегодня, залетайте оценить и накидать тегов.'],
  ['help', 'Как загрузить звук без аккаунта Discord?', 'Пытаюсь загрузить, а кнопка загрузки просит войти. Это баг?'],
  ['ideas', 'Добавьте плейлисты из звуков', 'Было бы круто собирать пачки звуков для разных ситуаций.'],
  ['offtop', 'Скидываем мемы под настроение', 'Тема для флуда — постим реакции дня.'],
  ['sounds', 'Тред с грустными тромбонами', 'Собираем лучшие "womp womp" со всего сайта.'],
  ['help', 'Пропали лайки после обновления страницы', 'Погуглил — вроде всё хранится локально, но у меня сбросило счётчик.'],
  ['ideas', 'Тёмная и очень тёмная тема одновременно?', 'Сайт и так тёмный, но вдруг кто-то захочет ещё контрастнее.'],
];

function buildSeedTopics() {
  return SEED_TOPICS_RAW.map((row, i) => {
    const [cat, title, body] = row;
    const author = SEED_AUTHORS[(i * 3) % SEED_AUTHORS.length];
    return {
      id: 'top_' + i + '_' + Math.random().toString(36).slice(2, 8),
      category: cat, title, body,
      authorId: author.id, authorName: author.name, authorAvatar: author.avatar,
      createdAt: daysAgo(randomBetween(0, 30)),
      views: Math.floor(randomBetween(20, 900)),
      pinned: i === 0
    };
  });
}

function buildSeedForumComments(topics) {
  const out = {};
  topics.forEach((t, ti) => {
    const n = Math.floor(randomBetween(0, 6));
    out[t.id] = [];
    for (let i = 0; i < n; i++) {
      const author = SEED_AUTHORS[(ti + i + 1) % SEED_AUTHORS.length];
      out[t.id].push({
        id: 'fc_' + t.id + '_' + i,
        authorId: author.id, authorName: author.name, authorAvatar: author.avatar,
        text: ['Согласен на все сто!', 'Хах, ну и звук 😂', 'А можно ссылку?', 'Присоединяюсь к вопросу', 'Топовая тема, спасибо'][i % 5],
        createdAt: daysAgo(randomBetween(0, 25))
      });
    }
  });
  return out;
}

function buildSeedComments(sounds) {
  const out = {};
  sounds.forEach((s, si) => {
    const n = Math.min(s.commentsCount, 5);
    out[s.id] = [];
    for (let i = 0; i < n; i++) {
      const author = SEED_AUTHORS[(si + i + 2) % SEED_AUTHORS.length];
      out[s.id].push({
        id: 'c_' + s.id + '_' + i,
        authorId: author.id, authorName: author.name, authorAvatar: author.avatar,
        text: ['Огонь звук 🔥', 'Использую его каждый день', 'Откуда ты их берёшь??', 'Скачал сразу же', 'Это база'][i % 5],
        createdAt: daysAgo(randomBetween(0, 20))
      });
    }
  });
  return out;
}

/* ---------- Инициализация localStorage при первом запуске ---------- */
function seedDatabaseIfNeeded() {
  // Always run cleanup to remove any previously seeded/demo sounds
    // Remove any seeded/demo sounds and related fake stats, but keep user data.
    const seededAuthorIds = SEED_AUTHORS.map(a => a.id);

    // Sounds
    const existing = Storage.get(STORAGE_KEYS.SOUNDS, []);
    const nonSeeded = existing.filter(s => !seededAuthorIds.includes(s.authorId));
    if (nonSeeded.length !== existing.length) {
      Storage.set(STORAGE_KEYS.SOUNDS, nonSeeded);
    }

    // Comments: remove entries for removed seeded sounds
    const comments = Storage.get(STORAGE_KEYS.COMMENTS, {});
    let commentsChanged = false;
    Object.keys(comments).forEach(k => {
      const s = existing.find(ss => ss.id === k);
      if (s && seededAuthorIds.includes(s.authorId)) { delete comments[k]; commentsChanged = true; }
    });
    if (commentsChanged) Storage.set(STORAGE_KEYS.COMMENTS, comments);

    // Likes: remove likes associated with seeded sounds
    const likes = Storage.get(STORAGE_KEYS.LIKES, {});
    let likesChanged = false;
    Object.keys(likes).forEach(k => {
      const s = existing.find(ss => ss.id === k);
      if (s && seededAuthorIds.includes(s.authorId)) { delete likes[k]; likesChanged = true; }
    });
    if (likesChanged) Storage.set(STORAGE_KEYS.LIKES, likes);

    // Favorites: remove seeded sound ids from users' favorite lists
    const favs = Storage.get(STORAGE_KEYS.FAVORITES, {});
    let favsChanged = false;
    Object.keys(favs).forEach(uid => {
      const before = favs[uid] || [];
      const after = before.filter(sid => {
        const s = existing.find(ss => ss.id === sid);
        return !(s && seededAuthorIds.includes(s.authorId));
      });
      if (after.length !== before.length) { favs[uid] = after; favsChanged = true; }
    });
    if (favsChanged) Storage.set(STORAGE_KEYS.FAVORITES, favs);

    // Notifications: keep as-is (may be user-related)

    // Ensure base structures exist
    Storage.set(STORAGE_KEYS.SOUNDS, Storage.get(STORAGE_KEYS.SOUNDS, []));
    Storage.set(STORAGE_KEYS.LIKES, Storage.get(STORAGE_KEYS.LIKES, {}));
    Storage.set(STORAGE_KEYS.FAVORITES, Storage.get(STORAGE_KEYS.FAVORITES, {}));
    Storage.set(STORAGE_KEYS.COMMENTS, Storage.get(STORAGE_KEYS.COMMENTS, {}));
    Storage.set(STORAGE_KEYS.NOTIFICATIONS, Storage.get(STORAGE_KEYS.NOTIFICATIONS, []));

    // Mark that initial cleanup has been performed
    localStorage.setItem(STORAGE_KEYS.SEEDED, '1');

  localStorage.setItem(STORAGE_KEYS.SEEDED, '1');
}

/* ---------- Универсальная обёртка над localStorage ----------
   REST: в будущем каждый Storage.get/set можно заменить на fetch() к API. */
const Storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.error('Storage.get error', key, e);
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.error('Storage.set error', key, e);
      return false;
    }
  }
};
