/* ============================================================
   MEMпад — app.js
   Роутинг между страницами, фоновая анимация, точка входа.
   ============================================================ */

const App = {
  currentRoute: 'feed',

  navigate(route) {
    if (!['feed', 'profile'].includes(route)) route = 'feed';
    App.currentRoute = route;
    location.hash = route;

    document.querySelectorAll('.page').forEach(p => p.classList.add('hidden'));
    const pageEl = document.getElementById(`page-${route}`);
    pageEl.classList.remove('hidden');

    document.querySelectorAll('.nav-link').forEach(l => l.classList.toggle('active', l.dataset.route === route));

    if (window.gsap) {
      gsap.fromTo(pageEl, { opacity: 0, y: 16 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out' });
    }

    Player.stopAll();
    window.scrollTo({ top: 0, behavior: 'auto' });

    if (route === 'profile') Profile.render();
    if (route === 'feed') Feed.render(true);
  },

  refreshCurrentPage() {
    if (App.currentRoute === 'feed') Feed.render(true);
    if (App.currentRoute === 'profile') Profile.render();
  },

  requireAuth(then) {
    if (Auth.isLoggedIn()) {
      if (then) then();
      return true;
    }
    UI.toast('Сначала войди через Discord', 'info', 'fa-lock');
    UI.openModal('auth-modal-backdrop');
    if (then) {
      const btn = document.getElementById('discord-login-btn');
      const handler = () => { setTimeout(then, 950); btn.removeEventListener('click', handler); };
      btn.addEventListener('click', handler);
    }
    return false;
  },

  bindNav() {
    document.querySelectorAll('[data-route]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        App.navigate(el.dataset.route);
      });
    });
    window.addEventListener('hashchange', () => {
      const route = location.hash.replace('#', '') || 'feed';
      App.navigate(route);
    });
  },

  bindHeroButtons() {
    document.getElementById('hero-upload').addEventListener('click', () => App.requireAuth(() => {
      UI.openModal('upload-modal-backdrop');
    }));
    document.getElementById('hero-explore').addEventListener('click', () => {
      document.getElementById('feed-controls').scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    document.getElementById('upload-btn').addEventListener('click', () => App.requireAuth(() => {
      UI.openModal('upload-modal-backdrop');
    }));
  },

  bindAuthorLinks() {
    document.addEventListener('click', (e) => {
      const authorLink = e.target.closest('[data-author]');
      if (authorLink) {
        e.preventDefault();
        const user = Auth.getUser();
        if (user && user.id === authorLink.dataset.author) {
          App.navigate('profile');
        } else {
          UI.toast('Просмотр чужих профилей скоро появится', 'info', 'fa-user');
        }
      }
    });
  },

  /* ---------- Живой анимированный фон: зелёные светящиеся сферы ---------- */
  initOrbCanvas() {
    const canvas = document.getElementById('orb-canvas');
    const ctx = canvas.getContext('2d');
    let orbs = [];
    let w, h, dpr;

    function resize() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = canvas.clientWidth = window.innerWidth;
      h = canvas.clientHeight = Math.min(window.innerHeight, 900);
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function initOrbs() {
      const count = window.innerWidth < 700 ? 5 : 9;
      orbs = Array.from({ length: count }).map(() => ({
        x: Math.random() * w,
        y: Math.random() * h,
        r: 60 + Math.random() * 140,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        alpha: 0.06 + Math.random() * 0.1
      }));
    }

    function tick() {
      ctx.clearRect(0, 0, w, h);
      orbs.forEach(o => {
        o.x += o.vx; o.y += o.vy;
        if (o.x < -o.r) o.x = w + o.r; if (o.x > w + o.r) o.x = -o.r;
        if (o.y < -o.r) o.y = h + o.r; if (o.y > h + o.r) o.y = -o.r;
        const grad = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
        grad.addColorStop(0, `rgba(93,214,44,${o.alpha})`);
        grad.addColorStop(1, 'rgba(93,214,44,0)');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2);
        ctx.fill();
      });
      requestAnimationFrame(tick);
    }

    resize();
    initOrbs();
    tick();
    window.addEventListener('resize', Utils.debounce(() => { resize(); initOrbs(); }, 200));
  },

  /* ---------- Эквалайзер-бары в hero (декоративные) ---------- */
  initHeroEq() {
    const eq = document.getElementById('hero-eq');
    const bars = 40;
    eq.innerHTML = Array.from({ length: bars }).map(() => `<span></span>`).join('');
    if (window.gsap) {
      eq.querySelectorAll('span').forEach((bar, i) => {
        gsap.to(bar, {
          scaleY: () => 0.15 + Math.random() * 0.9,
          duration: () => 0.5 + Math.random() * 0.6,
          repeat: -1, yoyo: true, ease: 'sine.inOut', delay: i * 0.02
        });
      });
    }
  },

  /* ---------- Плавная анимация появления при загрузке ---------- */
  playIntroAnimation() {
    if (!window.gsap) return;
    const tl = gsap.timeline();
    tl.from('.nav', { y: -60, opacity: 0, duration: 0.6, ease: 'power3.out' })
      .from('.hero-eyebrow', { y: 20, opacity: 0, duration: 0.5 }, '-=0.2')
      .from('.hero-title', { y: 30, opacity: 0, duration: 0.7, ease: 'power3.out' }, '-=0.3')
      .from('.hero-subtitle', { y: 20, opacity: 0, duration: 0.5 }, '-=0.4')
      .from('.hero-actions .btn', { y: 20, opacity: 0, duration: 0.5, stagger: 0.1 }, '-=0.3')
      .from('.hero-stat', { y: 16, opacity: 0, duration: 0.5, stagger: 0.1 }, '-=0.3');
  },

  async init() {
    seedDatabaseIfNeeded();

    UI.initModals();
    UI.initNotifications();
    UI.initMobileMenu();

    await Auth.init();
    await SupabaseAPI.init();
    if (SupabaseAPI.storageAvailable === false) {
      console.warn('Supabase storage unavailable, falling back to embedded audio storage.');
    }

    await Feed.init();
    Profile.init();

    App.bindNav();
    App.bindHeroButtons();
    App.bindAuthorLinks();
    App.initOrbCanvas();
    App.initHeroEq();

    const initialRoute = location.hash.replace('#', '') || 'feed';
    App.navigate(initialRoute.startsWith('sound-') ? 'feed' : initialRoute);

    Feed.render(true);
    requestAnimationFrame(App.playIntroAnimation);
  }
};

document.addEventListener('DOMContentLoaded', App.init);
