/* ============================================================
   MEMпад — utils.js
   Общие хелперы: форматирование, дебаунс, рейтинг, синтез аудио.
   ============================================================ */

const Utils = {
  uid(prefix = 'id') {
    return prefix + '_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 8);
  },

  escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  },

  formatCompact(num) {
    num = Number(num) || 0;
    if (num >= 1_000_000) return (num / 1_000_000).toFixed(num >= 10_000_000 ? 0 : 1).replace(/\.0$/, '') + 'M';
    if (num >= 1_000) return (num / 1_000).toFixed(num >= 10_000 ? 0 : 1).replace(/\.0$/, '') + 'K';
    return String(num);
  },

  formatDuration(sec) {
    sec = Math.max(0, Math.round(sec));
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  },

  timeAgo(ts) {
    const diff = Date.now() - ts;
    const min = 60000, hr = 3600000, day = 86400000, week = 7 * day, month = 30 * day;
    if (diff < min) return 'только что';
    if (diff < hr) return Math.floor(diff / min) + ' мин назад';
    if (diff < day) return Math.floor(diff / hr) + ' ч назад';
    if (diff < week) return Math.floor(diff / day) + ' дн назад';
    if (diff < month) return Math.floor(diff / week) + ' нед назад';
    return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
  },

  debounce(fn, wait = 250) {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn(...args), wait);
    };
  },

  clamp(v, min, max) { return Math.max(min, Math.min(max, v)); },

  /* ---------- Алгоритм автоматического рейтинга ----------
     Комбинирует вовлечённость (скачивания весят больше всего,
     затем лайки/комментарии/избранное, затем прослушивания)
     с затуханием по времени (свежие звуки получают буст,
     который плавно снижается по мере старения публикации). */
  computeScore(sound, favCount = 0) {
    const ageHours = Math.max(0, (Date.now() - sound.createdAt) / 3600000);
    const freshnessBoost = 140 / Math.pow(ageHours / 6 + 2, 1.35); // затухающий буст новизны
    const engagement =
      sound.downloads * 3.2 +
      sound.likes * 2.1 -
      sound.dislikes * 1.4 +
      sound.commentsCount * 2.6 +
      favCount * 2.8 +
      sound.plays * 0.35;
    return engagement + freshnessBoost;
  },

  /* ---------- Синтез коротких звуковых эффектов в WAV data URL ----------
     Позволяет плееру реально проигрывать звук без внешних файлов.
     type определяет "характер" сгенерированного мемного звука. */
  synthAudioDataUrl(seed, duration = 1.2, type = 'blip') {
    const sampleRate = 22050;
    const numSamples = Math.floor(sampleRate * duration);
    const buffer = new Float32Array(numSamples);
    let rand = mulberry32(seed);

    for (let i = 0; i < numSamples; i++) {
      const t = i / sampleRate;
      const progress = i / numSamples;
      let v = 0;
      const envelope = Math.sin(Math.PI * Math.min(1, progress * 1.6)) * (1 - progress * 0.3);

      switch (type % 5) {
        case 0: { // "вжух" — свип частоты вниз
          const freq = 1400 - progress * 1100;
          v = Math.sin(2 * Math.PI * freq * t) * envelope;
          break;
        }
        case 1: { // airhorn / сирена
          const freq = 300 + Math.sin(progress * 30) * 80;
          v = Math.sign(Math.sin(2 * Math.PI * freq * t)) * 0.6 * envelope;
          break;
        }
        case 2: { // перкуссия / дробь
          v = (rand() * 2 - 1) * Math.exp(-progress * 8) * 0.9;
          break;
        }
        case 3: { // мелодичный блип левелап
          const freq = 440 + Math.floor(progress * 6) * 90;
          v = Math.sin(2 * Math.PI * freq * t) * envelope;
          break;
        }
        default: { // низкий "гонг/тромбон"
          const freq = 180 - progress * 60;
          v = Math.sin(2 * Math.PI * freq * t) * envelope + Math.sin(2 * Math.PI * freq * 2 * t) * 0.2 * envelope;
        }
      }
      buffer[i] = Utils.clamp(v, -1, 1);
    }
    return encodeWav(buffer, sampleRate);
  },

  /* ---------- Анализ реального waveform аудио файла ----------
     Декодирует аудио и возвращает массив peaks для отрисовки */
  async analyzeAudioPeaks(audioDataUrl, numPeaks = 80) {
    if (!audioDataUrl) return genPeaks(numPeaks, 0);
    
    try {
      // Получаем Web Audio API context
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      
      // Fetch аудио как ArrayBuffer
      const response = await fetch(audioDataUrl);
      const arrayBuffer = await response.arrayBuffer();
      
      // Декодируем аудио
      const audioBuffer = await audioCtx.decodeAudioData(arrayBuffer);
      const channelData = audioBuffer.getChannelData(0);
      
      // Вычисляем peaks
      const peaks = [];
      const samplesPerPeak = Math.floor(channelData.length / numPeaks);
      
      for (let i = 0; i < numPeaks; i++) {
        let max = 0;
        const start = i * samplesPerPeak;
        const end = Math.min((i + 1) * samplesPerPeak, channelData.length);
        
        for (let j = start; j < end; j++) {
          max = Math.max(max, Math.abs(channelData[j]));
        }
        peaks.push(Math.min(1, max * 1.5)); // нормализуем с небольшим бустом
      }
      
      return peaks;
    } catch (err) {
      console.warn('Ошибка анализа waveform:', err);
      return genPeaks(numPeaks, 0);
    }
  }
};

/* Детерминированный ГПСЧ, чтобы одинаковый seed давал одинаковый звук */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function encodeWav(samples, sampleRate) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++, offset += 2) {
    const s = Utils.clamp(samples[i], -1, 1);
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }

  const blob = new Blob([view], { type: 'audio/wav' });
  return URL.createObjectURL(blob);
}
