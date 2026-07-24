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
      return;
    }

    SupabaseAPI.storageAvailable = false;
    console.error(
      `SupabaseAPI storage bucket not found. Tried: ${bucketsToTry.filter(Boolean).join(', ')}. ` +
      'Please create a bucket or update SupabaseAPI.bucket / SUPABASE_STORAGE_BUCKET to the correct bucket name.'
    );
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
        createdAt: new Date(s.created_at).getTime(),
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

      const { data, error } = await supabaseClient.from('sounds').insert([payload]).select().single();
      if (error) throw error;

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
        createdAt: new Date(data.created_at).getTime(),
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
        createdAt: new Date(c.created_at).getTime()
      }));
    } catch (err) {
      console.error('Supabase getComments error', err);
      return [];
    }
  },

  async postComment(soundId, text) {
    try {
      const user = Auth.getUser();
      if (!user) throw new Error('Not authenticated');
      const payload = { sound_id: soundId, user_id: user.id, text };
      const { data, error } = await supabaseClient.from('comments').insert([payload]).select().single();
      if (error) throw error;
      return {
        id: data.id,
        soundId: data.sound_id,
        userId: data.user_id,
        text: data.text,
        createdAt: new Date(data.created_at).getTime()
      };
    } catch (err) {
      console.error('Supabase postComment error', err);
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
  }
};

// Storage initialization is done explicitly during app startup.
// SupabaseAPI.init();
