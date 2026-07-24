/* ============================================================
   MEMпад — player.js
   Управление воспроизведением через WaveSurfer.js.
   Для производительности WaveSurfer-инстанс создаётся только
   для звука, который реально проигрывается; остальные карточки
   показывают статичные "пики" волны, отрисованные CSS-барами.
   ============================================================ */

const Player = {
  ws: null,
  currentId: null,
  isPlaying: false,

  /* Отрисовать статичные бары формы волны (лёгкий вариант для карточек в ленте) */
  renderStaticPeaks(container, peaks) {
    const card = container.closest('.sound-card');
    const soundId = card ? card.dataset.id : '';
    const spans = peaks.map(p => `<span style="--h:${Math.max(0.08, p)}"></span>`).join('');
    container.innerHTML = `<div class="waveform-progress" data-progress="${soundId}" style="width:0%"></div>` + spans;
  },

  /* Получить URL аудио, используя кэш, загруженный файл или синтезированный запасной вариант */
  getAudioUrl(sound) {
    if (sound._audioUrl) {
      return sound._audioUrl;
    }
    if (sound.audioUrl) {
      return sound.audioUrl;
    }
    const seed = Array.from(sound.id).reduce((a, c) => a + c.charCodeAt(0), 0);
    sound._audioUrl = Utils.synthAudioDataUrl(seed, sound.duration, seed % 5);
    return sound._audioUrl;
  },

  updateTimerFor(soundId, currentSec, totalSec) {
    const els = document.querySelectorAll(`[data-timer="${soundId}"]`);
    els.forEach(el => {
      try {
        const cur = Utils.formatDuration(Math.floor(currentSec));
        const tot = Utils.formatDuration(Math.floor(totalSec));
        el.textContent = `${cur} / ${tot}`;
      } catch (e) {}
    });
    // update waveform progress bars
    try {
      const pct = (!totalSec || !isFinite(totalSec)) ? 0 : Math.max(0, Math.min(100, (currentSec / totalSec) * 100));
      document.querySelectorAll(`[data-progress="${soundId}"]`).forEach(p => { p.style.width = pct + '%'; });
    } catch (e) {}
  },

  destroyActive() {
    if (Player.ws) {
      try { Player.ws.destroy(); } catch (e) { /* noop */ }
      Player.ws = null;
    }
    // Очистка event listeners для перемотки
    if (Player._seekHandlers) {
      Player._seekHandlers.forEach(handler => {
        try {
          handler.waveformEl.removeEventListener('mousedown', handler.mouseDown);
          document.removeEventListener('mousemove', handler.mouseMove);
          document.removeEventListener('mouseup', handler.mouseUp);
        } catch (e) { /* noop */ }
      });
      Player._seekHandlers = null;
    }
    if (Player._waveformEl) {
      try {
        Player._waveformEl.removeEventListener('mousedown', Player._seekMouseDown);
        document.removeEventListener('mousemove', Player._seekMouseMove);
        document.removeEventListener('mouseup', Player._seekMouseUp);
        Player._waveformEl.removeEventListener('touchstart', Player._seekTouchStart);
        document.removeEventListener('touchmove', Player._seekTouchMove);
        document.removeEventListener('touchend', Player._seekTouchEnd);
      } catch (e) { /* noop */ }
      Player._waveformEl = null;
    }
    if (Player.currentId) {
      const prevBtns = document.querySelectorAll(`[data-play-id="${Player.currentId}"]`);
      prevBtns.forEach(b => b.classList.remove('playing'));
      const prevCards = document.querySelectorAll(`.sound-card[data-id="${Player.currentId}"]`);
      prevCards.forEach(c => {
        c.classList.remove('is-playing');
        const wf = c.querySelector('.waveform');
        const sound = Feed.getSoundById(Player.currentId);
        if (wf && sound) Player.renderStaticPeaks(wf, sound.peaks);
      });
    }
    Player.currentId = null;
    Player.isPlaying = false;
    if (Player._wsTimer) { clearInterval(Player._wsTimer); Player._wsTimer = null; }
    if (Player._fallbackAudio) {
      try { Player._fallbackAudio.pause(); } catch (e) {}
      Player._fallbackAudio = null;
    }
    // reset any visible progress bars
    try { document.querySelectorAll('.waveform-progress').forEach(p => p.style.width = '0%'); } catch (e) {}
  },

  syncUIState() {
    if (!Player.currentId || !Player.ws) return;
    
    // Обновляем все кнопки play для текущего трека
    const playBtns = document.querySelectorAll(`[data-play-id="${Player.currentId}"]`);
    playBtns.forEach(btn => {
      if (Player.isPlaying) {
        btn.classList.add('playing');
      } else {
        btn.classList.remove('playing');
      }
    });
    
    // Обновляем классы карточек
    const cards = document.querySelectorAll(`.sound-card[data-id="${Player.currentId}"]`);
    cards.forEach(card => {
      if (Player.isPlaying) {
        card.classList.add('is-playing');
      } else {
        card.classList.remove('is-playing');
      }
    });
  },

  toggle(soundId) {
    const sound = Feed.getSoundById(soundId);
    if (!sound) return;

    if (Player.currentId === soundId && Player.ws) {
      // Тот же трек — просто пауза/плей
      Player.ws.playPause();
      Player.isPlaying = !Player.isPlaying;
      Player.syncUIState();
      return;
    }

    // Если уже проигрывается другой звук, не зупиняем его при скроллировании
    // Проверяем, не переиндексировалась ли карточка (например при скроллировании)
    if (Player.currentId === soundId && Player.ws && Player.isPlaying) {
      // Звук уже проигрывается, просто возвращаемся
      return;
    }

    // Переключаемся на новый трек
    Player.destroyActive();
    Player.currentId = soundId;

    const cards = document.querySelectorAll(`.sound-card[data-id="${soundId}"]`);
    cards.forEach(card => card.classList.add('is-playing', 'wf-loading'));
    const playBtns = document.querySelectorAll(`[data-play-id="${soundId}"]`);

    if (!window.WaveSurfer) {
      // remove loading state and ensure playing classes applied
      cards.forEach(c => c.classList.remove('wf-loading'));
      cards.forEach(c => c.classList.add('is-playing'));
      Player.fallbackPlay(sound, playBtns, cards);
      return;
    }

    // Используем скрытый контейнер для WaveSurfer (не останавливается при скроллировании)
    const hiddenContainer = document.getElementById('hidden-player');
    hiddenContainer.innerHTML = '';
    
    const ws = WaveSurfer.create({
      container: hiddenContainer,
      height: 0,
      waveColor: 'rgba(93,214,44,0.35)',
      progressColor: '#5DD62C',
      cursorColor: '#F8F8F8',
      cursorWidth: 0,
      barWidth: 0,
      normalize: true,
      url: Player.getAudioUrl(sound)
    });

    Player.ws = ws;

    ws.on('ready', () => {
      cards.forEach(c => c.classList.remove('wf-loading'));
      ws.play();
      // set initial timer total
      Player.updateTimerFor(soundId, 0, sound.duration);
    });
    ws.on('play', () => {
      Player.isPlaying = true;
      playBtns.forEach(b => b.classList.add('playing'));
      Feed.registerPlay(soundId);
    });
    // audioprocess fires with current time in some WaveSurfer versions
    ws.on('audioprocess', (time) => {
      Player.updateTimerFor(soundId, time, sound.duration);
    });
    // fallback interval if audioprocess not available
    if (!ws.drawer) {
      // try polling
      Player._wsTimer = setInterval(() => {
        if (!ws || typeof ws.getCurrentTime !== 'function') return;
        const t = ws.getCurrentTime();
        Player.updateTimerFor(soundId, t, sound.duration);
      }, 250);
    }
    ws.on('pause', () => {
      Player.isPlaying = false;
      playBtns.forEach(b => b.classList.remove('playing'));
      // stop polling
      if (Player._wsTimer) { clearInterval(Player._wsTimer); Player._wsTimer = null; }
    });
    ws.on('finish', () => {
      playBtns.forEach(b => b.classList.remove('playing'));
      cards.forEach(c => c.classList.remove('is-playing'));
      Player.updateTimerFor(soundId, sound.duration, sound.duration);
      // Сброс прогресс-бара при завершении
      document.querySelectorAll(`[data-progress="${soundId}"]`).forEach(p => { p.style.width = '0%'; });
      if (Player._wsTimer) { clearInterval(Player._wsTimer); Player._wsTimer = null; }
    });
    ws.on('error', () => {
      cards.forEach(c => c.classList.remove('wf-loading'));
      Player.fallbackPlay(sound, playBtns, cards);
    });

    // Добавляем обработку клика и перетаскивания на волнах карточек
    const setupSeekHandlers = () => {
      const waveforms = document.querySelectorAll(`[data-waveform="${soundId}"]`);
      waveforms.forEach(waveformEl => {
        let isDragging = false;

        const handleSeek = (e) => {
          e.stopPropagation();
          const rect = waveformEl.getBoundingClientRect();
          const clientX = e.clientX !== undefined
            ? e.clientX
            : (e.touches && e.touches[0] ? e.touches[0].clientX : undefined);
          if (clientX === undefined) return;
          const x = clientX - rect.left;
          const progress = Math.max(0, Math.min(1, x / rect.width));
          
          if (ws && typeof ws.seekTo === 'function') {
            const wasPlaying = Player.isPlaying;
            ws.seekTo(progress);
            // Продолжаем воспроизведение после seek если оно было активным
            if (wasPlaying && typeof ws.play === 'function') {
              setTimeout(() => {
                if (ws && typeof ws.play === 'function') {
                  ws.play();
                }
              }, 0);
            }
          }
        };

        const mouseDown = (e) => { 
          isDragging = true; 
          handleSeek(e);
        };
        const mouseMove = (e) => { 
          if (isDragging) {
            handleSeek(e);
          }
        };
        const mouseUp = () => { 
          isDragging = false; 
        };

        waveformEl.addEventListener('mousedown', mouseDown);
        document.addEventListener('mousemove', mouseMove);
        document.addEventListener('mouseup', mouseUp);
        
        // Сохраняем для очистки при смене трека
        if (!Player._seekHandlers) Player._seekHandlers = [];
        Player._seekHandlers.push({ waveformEl, mouseDown, mouseMove, mouseUp });
      });
    };
    
    setupSeekHandlers();
  },

  /* Резервный вариант через <audio>, если WaveSurfer недоступен */
  fallbackPlay(sound, playBtns, cards) {
    const audio = new Audio(Player.getAudioUrl(sound));
    Player._fallbackAudio = audio;
    audio.play();
    // mark UI as playing
    playBtns.forEach(b => b.classList.add('playing'));
    cards.forEach(c => c.classList.add('is-playing'));
    Feed.registerPlay(sound.id);
    // update timers during playback
    audio.addEventListener('timeupdate', () => {
      Player.updateTimerFor(sound.id, audio.currentTime, audio.duration || sound.duration);
    });
    audio.addEventListener('loadedmetadata', () => {
      Player.updateTimerFor(sound.id, audio.currentTime, audio.duration || sound.duration);
    });
    audio.addEventListener('ended', () => {
      playBtns.forEach(b => b.classList.remove('playing'));
      cards.forEach(c => c.classList.remove('is-playing'));
      Player.updateTimerFor(sound.id, audio.duration || sound.duration, audio.duration || sound.duration);
    });
  },

  stopAll() {
    Player.destroyActive();
    if (Player._fallbackAudio) {
      Player._fallbackAudio.pause();
      Player._fallbackAudio = null;
    }
  }
};
