/* ============================================================
   MEMпад — supabase-api.js
   Небольшая обёртка над Supabase для операций: sounds, comments,
   profiles, storage uploads.

   Storage bucket name can be overridden in browser by setting
   window.SUPABASE_STORAGE_BUCKET before this script loads.
   ============================================================ */

const SupabaseAPI = {
  bucket: window.SUPABASE_STORAGE_BUCKET || 'audios',
  bucketCandidates: [window.SUPABASE_STORAGE_BUCKET, 'audios', 'audio', 'sounds', 'uploads', 'public', 'media', 'storage'].filter(Boolean),
  storageAvailable: null,
  tableCache: {},

  normalizeStoragePath(filename) {
    const safeName = String(filename)
      .trim()
      .replace(/\\/g, '_')
      .replace(/\//g, '_')
      .replace(/\s+/g, '_')
      .replace(/[^\w.-]+/g, '')
      .replace(/^\.+/, '')
      .slice(0, 120);
    return `${Date.now()}_${safeName || 'audio'}`;
  },

  async probeBucket(bucket) {
    try {
      const { data, error } = await supabaseClient.storage.from(bucket).list('', { limit: 1 });
      if (!error) {
        return true;
      }
      const status = error && error.status ? error.status : null;
      const message = error && error.message ? String(error.message).toLowerCase() : '';
      if (status === 404 || status === 400 || /bucket not found/.test(message)) {
        return false;
      }
      // 401/403 can mean bucket exists but list access is restricted.
      if ([401, 403].includes(status)) {
        return true;
      }
      console.warn('SupabaseAPI probeBucket ambiguous response for', bucket, status, message);
      return false;
    } catch (err) {
      console.warn('SupabaseAPI bucket probe unexpected error for', bucket, err);
      return false;
    }
  },

  parseTimestamp(value) {
    if (!value && value !== 0) return null;
    if (typeof value === 'number') return value;
    if (value instanceof Date) return value.getTime();
    const str = String(value).trim();
    if (!str) return null;
    // Supabase may return UTC timestamps without a timezone marker.
    // If the string is ISO-like but lacks a timezone, treat it as UTC.
    const noTimezone = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(str);
    const normalized = noTimezone ? `${str}Z` : str;
    const parsed = Date.parse(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  },

  async probeTable(tableName) {
    if (SupabaseAPI.tableCache[tableName] !== undefined) {
      return SupabaseAPI.tableCache[tableName];
    }

    try {
      const { error } = await supabaseClient.from(tableName).select('id').limit(1);
      if (error) {
        const message = String(error.message || '').toLowerCase();
        if (error.status === 404 || /relation.*\b"?\b.*\b/i.test(message) || /could not find the table/.test(message)) {
          SupabaseAPI.tableCache[tableName] = false;
          return false;
        }
        if ([401, 403].includes(error.status)) {
          SupabaseAPI.tableCache[tableName] = false;
          return false;
        }
        console.warn('SupabaseAPI probeTable unexpected error for', tableName, error);
        SupabaseAPI.tableCache[tableName] = false;
        return false;
      }
      SupabaseAPI.tableCache[tableName] = true;
      return true;
    } catch (err) {
      console.warn('SupabaseAPI probeTable failed for', tableName, err);
      SupabaseAPI.tableCache[tableName] = false;
      return false;
    }
  },

  async isTableAvailable(tableName) {
    return await SupabaseAPI.probeTable(tableName);
  },

  async getProfilesByIds(ids) {
    if (!ids || !ids.length) return [];
    const { data, error } = await supabaseClient.from('profiles').select('*').in('id', ids);
    if (error) {
      console.error('Supabase getProfilesByIds error', error);
      return [];
    }
    return data;
  },

  getLocalComments(soundId) {
    const commentsMap = Storage.get(STORAGE_KEYS.COMMENTS, {});
    return Array.isArray(commentsMap[soundId]) ? commentsMap[soundId] : [];
  },

  saveLocalComments(soundId, comments) {
    const commentsMap = Storage.get(STORAGE_KEYS.COMMENTS, {});
    commentsMap[soundId] = Array.isArray(comments) ? comments : [];
    Storage.set(STORAGE_KEYS.COMMENTS, commentsMap);
    return commentsMap[soundId];
  },

  getLocalReports() {
    return Storage.get(STORAGE_KEYS.REPORTS, []);
  },

  saveLocalReports(reports) {
    Storage.set(STORAGE_KEYS.REPORTS, Array.isArray(reports) ? reports : []);
    return Storage.get(STORAGE_KEYS.REPORTS, []);
  },

  async addLocalReport(report) {
    const reports = SupabaseAPI.getLocalReports();
    const newReport = { ...report, id: report.id || Utils.uid('report'), created_at: report.created_at || new Date().toISOString() };
    reports.unshift(newReport);
    SupabaseAPI.saveLocalReports(reports);
    return newReport;
  },

  deleteLocalReport(reportId) {
    const reports = SupabaseAPI.getLocalReports().filter(r => r.id !== reportId);
    SupabaseAPI.saveLocalReports(reports);
    return true;
  },

  async init() {
    const bucketsToTry = Array.from(new Set([SupabaseAPI.bucket, ...SupabaseAPI.bucketCandidates]));
    let foundBucket = null;
    for (const bucket of bucketsToTry) {
      if (!bucket) continue;
      try {
        const exists = await SupabaseAPI.probeBucket(bucket);
        if (exists) {
          foundBucket = bucket;
          break;
        }
        console.log('SupabaseAPI bucket probe did not find bucket:', bucket);
      } catch (err) {
        console.warn('SupabaseAPI bucket probe error for', bucket, err);
      }
    }

    if (foundBucket) {
      SupabaseAPI.bucket = foundBucket;
      SupabaseAPI.storageAvailable = true;
      console.log('✅ SupabaseAPI ready (bucket:', foundBucket + ')');
    } else {
      SupabaseAPI.storageAvailable = false;
      console.error(
        `SupabaseAPI storage bucket not found. Tried: ${bucketsToTry.filter(Boolean).join(', ')}. ` +
        'Please create a bucket or update SupabaseAPI.bucket / SUPABASE_STORAGE_BUCKET to the correct bucket name.'
      );
    }

    await Promise.all(['sounds', 'comments', 'reports', 'admin_users'].map((table) => SupabaseAPI.probeTable(table)));
  },

  async getSounds() {
    try {
      const { data, error } = await supabaseClient.from('sounds').select('*').order('created_at', { ascending: false });
      if (error) throw error;

      const userIds = Array.from(new Set((data || []).map(d => d.user_id)));
      const profiles = await SupabaseAPI.getProfilesByIds(userIds);
      const profilesMap = {};
      profiles.forEach(p => profilesMap[p.id] = p);

      // Map to app format
      const sounds = (data || []).map(s => ({
        id: s.id,
        title: s.title,
        tags: Array.isArray(s.tags) ? s.tags : (typeof s.tags === 'string' ? s.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
        authorId: s.user_id,
        authorName: (profilesMap[s.user_id] && profilesMap[s.user_id].username) || 'Unknown',
        authorAvatar: (profilesMap[s.user_id] && profilesMap[s.user_id].avatar_emoji) || '🟢',
        authorAvatarImage: (profilesMap[s.user_id] && profilesMap[s.user_id].avatar_image) || null,
        cover: s.cover,
        duration: s.duration || 0,
        peaks: s.peaks || [],
        plays: s.plays || 0,
        downloads: s.downloads || 0,
        likes: s.likes || 0,
        dislikes: s.dislikes || 0,
        commentsCount: s.comments_count || 0,
        createdAt: SupabaseAPI.parseTimestamp(s.created_at) || Date.now(),
        audioUrl: s.audio_url,
        emoji: s.emoji || ''
      }));

      return sounds;
    } catch (err) {
      console.error('Supabase getSounds error', err);
      return [];
    }
  },

  async fileToDataUrl(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = (err) => reject(err || new Error('Не удалось прочитать аудиофайл.'));
      reader.readAsDataURL(file);
    });
  },
 
  async uploadAudioFile(file, publicPath) {
    if (SupabaseAPI.storageAvailable === null) {
      await SupabaseAPI.init();
    }
 
    const path = publicPath || SupabaseAPI.normalizeStoragePath(file.name);
 
    if (SupabaseAPI.storageAvailable !== false) {
      try {
        const { data, error } = await supabaseClient.storage.from(SupabaseAPI.bucket).upload(path, file, { cacheControl: '3600', upsert: false });
        if (error) {
          const errMessage = error && error.message ? String(error.message).toLowerCase() : '';
          if (error.status === 400 || error.status === 404 || /bucket not found/.test(errMessage)) {
            SupabaseAPI.storageAvailable = false;
            console.warn(`Supabase storage unavailable for bucket "${SupabaseAPI.bucket}": ${error.message || error}`);
          } else if (error.status === 403 || error.status === 401 || /permission denied/.test(errMessage) || /access denied/.test(errMessage)) {
            SupabaseAPI.storageAvailable = false;
            console.warn(`Insufficient Supabase storage permissions for bucket "${SupabaseAPI.bucket}": ${error.message || error}`);
          } else {
            throw error;
          }
        } else {
          const { data: urlData, error: urlError } = supabaseClient.storage.from(SupabaseAPI.bucket).getPublicUrl(path);
          if (!urlError && urlData && urlData.publicUrl) {
            return urlData.publicUrl;
          }
          const detail = urlError && urlError.message ? String(urlError.message) : 'Unable to get public URL for uploaded audio.';
          if (typeof supabaseClient.storage.from(SupabaseAPI.bucket).createSignedUrl === 'function') {
            const { data: signedData, error: signedError } = await supabaseClient.storage.from(SupabaseAPI.bucket).createSignedUrl(path, 60);
            if (!signedError && signedData && signedData.signedUrl) {
              return signedData.signedUrl;
            }
            const signedDetail = signedError && signedError.message ? String(signedError.message) : 'Unable to create signed URL.';
            throw new Error(`Uploaded audio, but failed to get public URL: ${detail}. Signed URL fallback failed: ${signedDetail}`);
          }
          throw new Error(`Uploaded audio, but failed to get public URL: ${detail}`);
        }
      } catch (err) {
        if (SupabaseAPI.storageAvailable === false) {
          console.warn('Falling back to embedded audio data URL because Supabase storage is unavailable.', err);
        } else {
          console.error('Supabase uploadAudioFile error', err);
          throw err;
        }
      }
    }
 
    if (!file) {
      throw new Error('Аудиофайл не передан для загрузки.');
    }
 
    return await SupabaseAPI.fileToDataUrl(file);
  },

  async createSound({ title, tags = [], file, cover, emoji, peaks = [], duration = 0 }) {
    try {
      const user = Auth.getUser();
      if (!user) throw new Error('Not authenticated');
      if (user.isBlocked) {
        const reason = user.blockedUntil ? `до ${new Date(user.blockedUntil).toLocaleString()}` : 'навсегда';
        throw new Error(`Публикация запрещена ${reason}`);
      }
 
      const normalizedTags = Array.isArray(tags) ? tags : (typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : []);
 
      let audioUrl = null;
      if (file) {
        // Upload file to storage
        audioUrl = await SupabaseAPI.uploadAudioFile(file);
      }
 
      const payload = {
        user_id: user.id,
        title,
        tags: normalizedTags,
        audio_url: audioUrl,
        peaks,
        duration: duration || 0,
        cover,
        emoji
      };

      const soundsAvailable = await SupabaseAPI.isTableAvailable('sounds');
      if (!soundsAvailable) {
        const localSound = {
          id: Utils.uid('snd'),
          title,
          tags: normalizedTags,
          authorId: user.id,
          authorName: user.name,
          authorAvatar: user.avatar || '🟢',
          authorAvatarImage: user.avatarImage || null,
          cover,
          duration: duration || 0,
          peaks,
          plays: 0,
          downloads: 0,
          likes: 0,
          dislikes: 0,
          commentsCount: 0,
          createdAt: Date.now(),
          audioUrl,
          emoji: emoji || '',
          user_id: user.id
        };
        const localSounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
        localSounds.unshift(localSound);
        Storage.set(STORAGE_KEYS.SOUNDS, localSounds);
        return localSound;
      }

      const { data, error } = await supabaseClient.from('sounds').insert([payload]).select().single();
      if (error) {
        const message = String(error.message || '').toLowerCase();
        if (error.status === 404 || /relation.*sounds/i.test(message) || /could not find the table/.test(message)) {
          const localSound = {
            id: Utils.uid('snd'),
            title,
            tags: normalizedTags,
            authorId: user.id,
            authorName: user.name,
            authorAvatar: user.avatar || '🟢',
            authorAvatarImage: user.avatarImage || null,
            cover,
            duration: duration || 0,
            peaks,
            plays: 0,
            downloads: 0,
            likes: 0,
            dislikes: 0,
            commentsCount: 0,
            createdAt: Date.now(),
            audioUrl,
            emoji: emoji || '',
            user_id: user.id
          };
          const localSounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
          localSounds.unshift(localSound);
          Storage.set(STORAGE_KEYS.SOUNDS, localSounds);
          return localSound;
        }
        throw error;
      }

      // Combine with profile info
      const profile = await SupabaseAPI.getProfilesByIds([user.id]);
      const p = profile && profile[0];

      return {
        id: data.id,
        title: data.title,
        tags: data.tags || [],
        authorId: data.user_id,
        authorName: (p && p.username) || user.name,
        authorAvatar: (p && p.avatar_emoji) || user.avatar || '🟢',
        authorAvatarImage: (p && p.avatar_image) || null,
        cover: data.cover,
        duration: data.duration || 0,
        peaks: data.peaks || [],
        plays: data.plays || 0,
        downloads: data.downloads || 0,
        likes: data.likes || 0,
        dislikes: data.dislikes || 0,
        commentsCount: data.comments_count || 0,
        createdAt: SupabaseAPI.parseTimestamp(data.created_at) || Date.now(),
        audioUrl: data.audio_url,
        emoji: data.emoji || ''
      };
    } catch (err) {
      console.error('Supabase createSound error', err);
      throw err;
    }
  },

  async getComments(soundId) {
    try {
      const commentsAvailable = await SupabaseAPI.isTableAvailable('comments');
      if (!commentsAvailable) {
        return SupabaseAPI.getLocalComments(soundId).map(c => ({
          ...c,
          createdAt: SupabaseAPI.parseTimestamp(c.createdAt || c.created_at) || Date.now(),
          authorName: c.authorName || 'Unknown',
          authorAvatar: c.authorAvatar || '🟢',
          authorAvatarImage: c.authorAvatarImage || null
        }));
      }

      const { data, error } = await supabaseClient.from('comments').select('*').eq('sound_id', soundId).order('created_at', { ascending: true });
      if (error) throw error;
      // fetch user profiles for comments
      const userIds = Array.from(new Set((data || []).map(c => c.user_id)));
      const profiles = await SupabaseAPI.getProfilesByIds(userIds);
      const profilesMap = {};
      profiles.forEach(p => profilesMap[p.id] = p);

      return (data || []).map(c => ({
        id: c.id,
        authorId: c.user_id,
        authorName: (profilesMap[c.user_id] && profilesMap[c.user_id].username) || 'Unknown',
        authorAvatar: (profilesMap[c.user_id] && profilesMap[c.user_id].avatar_emoji) || '🟢',
        authorAvatarImage: (profilesMap[c.user_id] && profilesMap[c.user_id].avatar_image) || null,
        text: c.text,
        createdAt: SupabaseAPI.parseTimestamp(c.created_at) || Date.now()
      }));
    } catch (err) {
      console.error('Supabase getComments error', err);
      return SupabaseAPI.getLocalComments(soundId).map(c => ({
        ...c,
        createdAt: SupabaseAPI.parseTimestamp(c.createdAt || c.created_at) || Date.now(),
        authorName: c.authorName || 'Unknown',
        authorAvatar: c.authorAvatar || '🟢',
        authorAvatarImage: c.authorAvatarImage || null
      }));
    }
  },

  async postComment(soundId, text) {
    try {
      const user = Auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const payload = { sound_id: soundId, user_id: user.id, text };
      const commentsAvailable = await SupabaseAPI.isTableAvailable('comments');
      if (!commentsAvailable) {
        const created = {
          id: Utils.uid('c'),
          soundId,
          userId: user.id,
          authorName: user.name,
          authorAvatar: user.avatar || '🟢',
          authorAvatarImage: user.avatarImage || null,
          text,
          createdAt: Date.now()
        };
        const comments = SupabaseAPI.getLocalComments(soundId);
        comments.push(created);
        SupabaseAPI.saveLocalComments(soundId, comments);
        return created;
      }

      const { data, error } = await supabaseClient.from('comments').insert([payload]).select().single();
      if (error) {
        const message = String(error.message || '').toLowerCase();
        if (error.status === 404 || /relation.*comments/i.test(message) || /could not find the table/.test(message)) {
          const created = {
            id: Utils.uid('c'),
            soundId,
            userId: user.id,
            authorName: user.name,
            authorAvatar: user.avatar || '🟢',
            authorAvatarImage: user.avatarImage || null,
            text,
            createdAt: Date.now()
          };
          const comments = SupabaseAPI.getLocalComments(soundId);
          comments.push(created);
          SupabaseAPI.saveLocalComments(soundId, comments);
          return created;
        }
        throw error;
      }
      try {
        await SupabaseAPI.incrementSoundCounters(soundId, { comments_count: 1 });
      } catch (counterErr) {
        console.warn('Failed to update comment count after posting comment:', counterErr);
      }
      return {
        id: data.id,
        soundId: data.sound_id,
        userId: data.user_id,
        text: data.text,
        createdAt: SupabaseAPI.parseTimestamp(data.created_at) || Date.now()
      };
    } catch (err) {
      console.error('Supabase postComment error', err);
      throw err;
    }
  },
 
  async incrementSoundCounters(soundId, deltas = {}) {
    if (!soundId || !deltas || !Object.keys(deltas).length) return null;
    try {
      const { data: current, error: fetchError } = await supabaseClient.from('sounds')
        .select('plays,downloads,likes,dislikes,comments_count')
        .eq('id', soundId)
        .single();
      if (fetchError) throw fetchError;
      const payload = {};
      Object.entries(deltas).forEach(([field, delta]) => {
        const intDelta = Number(delta) || 0;
        if (intDelta) {
          payload[field] = (current[field] || 0) + intDelta;
        }
      });
      if (!Object.keys(payload).length) return current;
      const { data: updated, error: updateError } = await supabaseClient.from('sounds').update(payload).eq('id', soundId).select().single();
      if (updateError) throw updateError;
      return updated;
    } catch (err) {
      console.error('Supabase incrementSoundCounters error', err);
      throw err;
    }
  },
 
  async getProfile(userId) {
    try {
      const { data, error } = await supabaseClient.from('profiles').select('*').eq('id', userId).single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Supabase getProfile error', err);
      return null;
    }
  },
 
  extractStoragePath(url) {
    if (!url) return null;
    try {
      const parsed = new URL(url);
      const parts = parsed.pathname.split('/').filter(Boolean);
      const publicIdx = parts.indexOf('public');
      if (publicIdx >= 0 && parts.length > publicIdx + 2) {
        const bucket = parts[publicIdx + 1];
        const path = parts.slice(publicIdx + 2).join('/');
        return { bucket, path };
      }
    } catch (err) {
      return null;
    }
    return null;
  },
 
  async deleteSound(soundId) {
    try {
      const user = Auth.getUser();
      if (!user) throw new Error('Необходимо войти в аккаунт');
 
      const { data: sound, error: fetchError } = await supabaseClient.from('sounds').select('id,user_id,audio_url').eq('id', soundId).single();
      if (fetchError) throw fetchError;
      if (!sound) throw new Error('Звук не найден');
      if (sound.user_id !== user.id) throw new Error('Только владелец может удалить звук');
 
      const audioUrl = sound.audio_url;
      if (audioUrl && SupabaseAPI.storageAvailable !== false) {
        const storageInfo = SupabaseAPI.extractStoragePath(audioUrl);
        if (storageInfo && storageInfo.path) {
          const { error: removeError } = await supabaseClient.storage.from(storageInfo.bucket).remove([storageInfo.path]);
          if (removeError) console.warn('Supabase storage file remove failed:', removeError);
        }
      }
 
      const { error: deleteError } = await supabaseClient.from('sounds').delete().eq('id', soundId).eq('user_id', user.id);
      if (deleteError) throw deleteError;
      return true;
    } catch (err) {
      console.error('Supabase deleteSound error', err);
      throw err;
    }
  },
 
  async updateProfile(userId, updates) {
    try {
      const { data, error } = await supabaseClient.from('profiles').update(updates).eq('id', userId).select().single();
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Supabase updateProfile error', err);
      throw err;
    }
  },

  async getAdminUser(login) {
    try {
      const { data, error } = await supabaseClient.from('admin_users').select('*').eq('login', login).maybeSingle();
      if (error) {
        if (error.status === 404 || /relation.*admin_users/i.test(error.message || '')) return null;
        throw error;
      }
      return data;
    } catch (err) {
      console.warn('Supabase getAdminUser fallback', err.message || err);
      return null;
    }
  },

  async postReport(soundId, reason = 'unspecified') {
    try {
      const user = Auth.getUser();
      const payload = {
        sound_id: soundId,
        user_id: user ? user.id : null,
        reason,
        created_at: new Date().toISOString()
      };
      const reportsAvailable = await SupabaseAPI.isTableAvailable('reports');
      if (!reportsAvailable) {
        const report = await SupabaseAPI.addLocalReport({
          ...payload,
          authorName: user ? user.name : 'Аноним',
          soundTitle: null
        });
        return report;
      }

      const { data, error } = await supabaseClient.from('reports').insert([payload]).select().single();
      if (error) {
        const message = String(error.message || '').toLowerCase();
        if (error.status === 404 || /relation.*reports/i.test(message) || /could not find the table/.test(message)) {
          const report = await SupabaseAPI.addLocalReport({
            ...payload,
            authorName: user ? user.name : 'Аноним',
            soundTitle: null
          });
          return report;
        }
        throw error;
      }
      return data;
    } catch (err) {
      console.warn('Supabase postReport error', err.message || err);
      return null;
    }
  },

  async deleteComplaint(reportId) {
    try {
      const reportsAvailable = await SupabaseAPI.isTableAvailable('reports');
      if (!reportsAvailable) {
        return SupabaseAPI.deleteLocalReport(reportId);
      }
      const { error } = await supabaseClient.from('reports').delete().eq('id', reportId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Supabase deleteComplaint error', err);
      throw err;
    }
  },

  async getComplaints() {
    try {
      const reportsAvailable = await SupabaseAPI.isTableAvailable('reports');
      if (!reportsAvailable) {
        const localReports = SupabaseAPI.getLocalReports();
        const userIds = Array.from(new Set(localReports.filter(r => r.user_id).map(r => r.user_id)));
        const soundIds = Array.from(new Set(localReports.filter(r => r.sound_id).map(r => r.sound_id)));
        const [profiles, sounds] = await Promise.all([
          userIds.length ? SupabaseAPI.getProfilesByIds(userIds) : [],
          soundIds.length ? SupabaseAPI.getSoundsByIds(soundIds) : []
        ]);
        const profilesMap = Object.fromEntries(profiles.map(p => [p.id, p]));
        const soundsMap = Object.fromEntries(sounds.map(s => [s.id, s]));
        return localReports.map(r => ({
          id: r.id,
          soundId: r.sound_id,
          reason: r.reason,
          message: r.message || '',
          authorId: r.user_id,
          authorName: (profilesMap[r.user_id] && profilesMap[r.user_id].username) || r.authorName || 'Аноним',
          soundTitle: (soundsMap[r.sound_id] && soundsMap[r.sound_id].title) || r.soundTitle || 'Не найден',
          createdAt: SupabaseAPI.parseTimestamp(r.created_at || r.createdAt) || Date.now()
        }));
      }

      const { data, error } = await supabaseClient.from('reports').select('*').order('created_at', { ascending: false });
      if (error) {
        if (error.status === 404 || /relation.*reports/i.test(error.message || '')) return [];
        throw error;
      }
      const userIds = Array.from(new Set(data.filter(r => r.user_id).map(r => r.user_id)));
      const soundIds = Array.from(new Set(data.filter(r => r.sound_id).map(r => r.sound_id)));
      const [profiles, sounds] = await Promise.all([
        userIds.length ? SupabaseAPI.getProfilesByIds(userIds) : [],
        soundIds.length ? SupabaseAPI.getSoundsByIds(soundIds) : []
      ]);
      const profilesMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      const soundsMap = Object.fromEntries(sounds.map(s => [s.id, s]));
      return data.map(r => ({
        id: r.id,
        soundId: r.sound_id,
        reason: r.reason,
        message: r.message || '',
        authorId: r.user_id,
        authorName: (profilesMap[r.user_id] && profilesMap[r.user_id].username) || 'Аноним',
        soundTitle: (soundsMap[r.sound_id] && soundsMap[r.sound_id].title) || 'Не найден',
        createdAt: SupabaseAPI.parseTimestamp(r.created_at) || Date.now()
      }));
    } catch (err) {
      console.error('Supabase getComplaints error', err);
      return [];
    }
  },

  async getSoundsByIds(ids) {
    if (!ids || !ids.length) return [];
    try {
      const soundsAvailable = await SupabaseAPI.isTableAvailable('sounds');
      if (!soundsAvailable) {
        const localSounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
        return localSounds.filter(s => ids.includes(s.id));
      }
      const { data, error } = await supabaseClient.from('sounds').select('*').in('id', ids);
      if (error) throw error;
      return data;
    } catch (err) {
      console.error('Supabase getSoundsByIds error', err);
      const localSounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
      return localSounds.filter(s => ids.includes(s.id));
    }
  },

  async getAllComments() {
    try {
      const commentsAvailable = await SupabaseAPI.isTableAvailable('comments');
      if (!commentsAvailable) {
        const commentsMap = Storage.get(STORAGE_KEYS.COMMENTS, {});
        const rows = Object.entries(commentsMap).flatMap(([soundId, comments]) => (
          Array.isArray(comments) ? comments.map(comment => ({ ...comment, sound_id: soundId })) : []
        ));
        const sounds = await SupabaseAPI.getSoundsByIds(rows.map(c => c.sound_id));
        const soundsMap = Object.fromEntries(sounds.map(s => [s.id, s]));
        return rows.map(c => ({
          id: c.id,
          text: c.text,
          soundId: c.sound_id,
          soundTitle: (soundsMap[c.sound_id] && soundsMap[c.sound_id].title) || 'Не найден',
          authorId: c.userId || c.user_id,
          authorName: c.authorName || 'Unknown',
          createdAt: SupabaseAPI.parseTimestamp(c.createdAt || c.created_at) || Date.now()
        }));
      }

      const { data, error } = await supabaseClient.from('comments').select('*').order('created_at', { ascending: false });
      if (error) {
        if (error.status === 404 || /relation.*comments/i.test(error.message || '')) return [];
        throw error;
      }
      const userIds = Array.from(new Set(data.map(c => c.user_id)));
      const soundIds = Array.from(new Set(data.map(c => c.sound_id)));
      const [profiles, sounds] = await Promise.all([
        userIds.length ? SupabaseAPI.getProfilesByIds(userIds) : [],
        soundIds.length ? SupabaseAPI.getSoundsByIds(soundIds) : []
      ]);
      const profilesMap = Object.fromEntries(profiles.map(p => [p.id, p]));
      const soundsMap = Object.fromEntries(sounds.map(s => [s.id, s]));
      return data.map(c => ({
        id: c.id,
        text: c.text,
        soundId: c.sound_id,
        soundTitle: (soundsMap[c.sound_id] && soundsMap[c.sound_id].title) || 'Не найден',
        authorId: c.user_id,
        authorName: (profilesMap[c.user_id] && profilesMap[c.user_id].username) || 'Unknown',
        createdAt: SupabaseAPI.parseTimestamp(c.created_at) || Date.now()
      }));
    } catch (err) {
      console.error('Supabase getAllComments error', err);
      const commentsMap = Storage.get(STORAGE_KEYS.COMMENTS, {});
      const rows = Object.entries(commentsMap).flatMap(([soundId, comments]) => (
        Array.isArray(comments) ? comments.map(comment => ({ ...comment, sound_id: soundId })) : []
      ));
      const sounds = await SupabaseAPI.getSoundsByIds(rows.map(c => c.sound_id));
      const soundsMap = Object.fromEntries(sounds.map(s => [s.id, s]));
      return rows.map(c => ({
        id: c.id,
        text: c.text,
        soundId: c.sound_id,
        soundTitle: (soundsMap[c.sound_id] && soundsMap[c.sound_id].title) || 'Не найден',
        authorId: c.userId || c.user_id,
        authorName: c.authorName || 'Unknown',
        createdAt: SupabaseAPI.parseTimestamp(c.createdAt || c.created_at) || Date.now()
      }));
    }
  },

  async deleteComment(commentId) {
    try {
      const commentsAvailable = await SupabaseAPI.isTableAvailable('comments');
      if (!commentsAvailable) {
        const commentsMap = Storage.get(STORAGE_KEYS.COMMENTS, {});
        Object.keys(commentsMap).forEach((soundId) => {
          commentsMap[soundId] = commentsMap[soundId].filter(c => c.id !== commentId);
        });
        Storage.set(STORAGE_KEYS.COMMENTS, commentsMap);
        return true;
      }

      const { error } = await supabaseClient.from('comments').delete().eq('id', commentId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Supabase deleteComment error', err);
      throw err;
    }
  },

  async updateSound(soundId, patch) {
    try {
      const soundsAvailable = await SupabaseAPI.isTableAvailable('sounds');
      if (!soundsAvailable) {
        const localSounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
        const updatedSounds = localSounds.map((sound) => {
          if (sound.id === soundId) {
            return { ...sound, ...patch };
          }
          return sound;
        });
        Storage.set(STORAGE_KEYS.SOUNDS, updatedSounds);
        return updatedSounds.find(s => s.id === soundId) || null;
      }

      const { data, error } = await supabaseClient.from('sounds').update(patch).eq('id', soundId).select().single();
      if (error) {
        const message = String(error.message || '').toLowerCase();
        if (error.status === 404 || /relation.*sounds/i.test(message) || /could not find the table/.test(message)) {
          const localSounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
          const updatedSounds = localSounds.map((sound) => {
            if (sound.id === soundId) {
              return { ...sound, ...patch };
            }
            return sound;
          });
          Storage.set(STORAGE_KEYS.SOUNDS, updatedSounds);
          return updatedSounds.find(s => s.id === soundId) || null;
        }
        throw error;
      }
      return data;
    } catch (err) {
      console.error('Supabase updateSound error', err);
      throw err;
    }
  },

  async deleteSoundAsAdmin(soundId) {
    try {
      const soundsAvailable = await SupabaseAPI.isTableAvailable('sounds');
      if (!soundsAvailable) {
        const localSounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
        const filteredSounds = localSounds.filter((sound) => sound.id !== soundId);
        Storage.set(STORAGE_KEYS.SOUNDS, filteredSounds);
        return true;
      }

      const { data: sound, error: fetchError } = await supabaseClient.from('sounds').select('id,audio_url').eq('id', soundId).single();
      if (fetchError) throw fetchError;
      if (!sound) throw new Error('Звук не найден');
      const audioUrl = sound.audio_url;
      if (audioUrl && SupabaseAPI.storageAvailable !== false) {
        const storageInfo = SupabaseAPI.extractStoragePath(audioUrl);
        if (storageInfo && storageInfo.path) {
          const { error: removeError } = await supabaseClient.storage.from(storageInfo.bucket).remove([storageInfo.path]);
          if (removeError) console.warn('Supabase storage file remove failed:', removeError);
        }
      }
      const { error } = await supabaseClient.from('sounds').delete().eq('id', soundId);
      if (error) {
        const message = String(error.message || '').toLowerCase();
        if (error.status === 404 || /relation.*sounds/i.test(message) || /could not find the table/.test(message)) {
          const localSounds = Storage.get(STORAGE_KEYS.SOUNDS, []);
          const filteredSounds = localSounds.filter((sound) => sound.id !== soundId);
          Storage.set(STORAGE_KEYS.SOUNDS, filteredSounds);
          return true;
        }
        throw error;
      }
      return true;
    } catch (err) {
      console.error('Supabase deleteSoundAsAdmin error', err);
      throw err;
    }
  },

  async getAllUsers() {
    try {
      const { data, error } = await supabaseClient.from('profiles').select('*').order('created_at', { ascending: false });
      if (error) throw error;
      return data.map(u => ({
        ...u,
        blockedUntil: SupabaseAPI.parseTimestamp(u.blocked_until)
      }));
    } catch (err) {
      console.error('Supabase getAllUsers error', err);
      return [];
    }
  },

  async deleteUser(userId) {
    try {
      const { error } = await supabaseClient.from('profiles').delete().eq('id', userId);
      if (error) throw error;
      return true;
    } catch (err) {
      console.error('Supabase deleteUser error', err);
      throw err;
    }
  }
};

// Storage initialization is done explicitly during app startup.
// SupabaseAPI.init();
