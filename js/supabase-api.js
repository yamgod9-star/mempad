/* ============================================================
   MEMпад — supabase-api.js
   Небольшая обёртка над Supabase для операций: sounds, comments,
   profiles, storage uploads.

   Storage bucket name can be overridden in browser by setting
   window.SUPABASE_STORAGE_BUCKET before this script loads.
   ============================================================ */

const SupabaseAPI = {
  bucket: window.SUPABASE_STORAGE_BUCKET || 'audios',
  bucketCandidates: [window.SUPABASE_STORAGE_BUCKET, 'audios', 'audio', 'sounds', 'uploads', 'public'].filter(Boolean),

  async probeBucket(bucket) {
    try {
      const probePath = 'mempad_bucket_probe.txt';
      const { data, error } = await supabaseClient.storage.from(bucket).download(probePath);
      if (!error) {
        return true;
      }
      const status = error?.status;
      const message = (error?.message || '').toLowerCase();
      if (status === 400 || /bucket not found/.test(message)) {
        return false;
      }
      // 403/404/401 indicate bucket exists but access or file doesn't.
      if ([401, 403, 404].includes(status)) {
        return true;
      }
      return true;
    } catch (err) {
      console.warn('SupabaseAPI bucket probe unexpected error for', bucket, err);
      return false;
    }
  },

  async init() {
    const bucketsToTry = Array.from(new Set([SupabaseAPI.bucket, ...SupabaseAPI.bucketCandidates]));
    for (const bucket of bucketsToTry) {
      if (!bucket) continue;
      try {
        const exists = await SupabaseAPI.probeBucket(bucket);
        if (exists) {
          SupabaseAPI.bucket = bucket;
          console.log('✅ SupabaseAPI ready (bucket:', bucket + ')');
          return;
        }
      } catch (err) {
        console.warn('SupabaseAPI bucket probe error for', bucket, err);
      }
    }

    console.error(
      'SupabaseAPI storage bucket not found. Please create a storage bucket named "audios" or update SupabaseAPI.bucket / SUPABASE_STORAGE_BUCKET to the correct bucket name.'
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
        tags: s.tags || [],
        authorId: s.user_id,
        authorName: profilesMap[s.user_id]?.username || 'Unknown',
        authorAvatar: profilesMap[s.user_id]?.avatar_emoji || '🟢',
        authorAvatarImage: profilesMap[s.user_id]?.avatar_image || null,
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

  async uploadAudioFile(file, publicPath) {
    try {
      const path = publicPath || `${Date.now()}_${file.name}`;
      const { data, error } = await supabaseClient.storage.from(SupabaseAPI.bucket).upload(path, file, { cacheControl: '3600', upsert: false });
      if (error) {
        const errMessage = (error?.message || '').toLowerCase();
        if (error.status === 400 || /bucket not found/.test(errMessage)) {
          throw new Error(`Supabase storage bucket "${SupabaseAPI.bucket}" not found. Create the bucket in Supabase dashboard or update SUPABASE_STORAGE_BUCKET.`);
        }
        if (error.status === 403 || error.status === 401) {
          throw new Error(`Insufficient permissions to upload audio to bucket "${SupabaseAPI.bucket}". Check your Supabase storage policies and API key.`);
        }
        throw error;
      }
      const { data: urlData } = supabaseClient.storage.from(SupabaseAPI.bucket).getPublicUrl(path);
      return urlData.publicUrl;
    } catch (err) {
      console.error('Supabase uploadAudioFile error', err);
      throw err;
    }
  },

  async createSound({ title, tags = [], file, cover, emoji, peaks = [], duration = 0 }) {
    try {
      const user = Auth.getUser();
      if (!user) throw new Error('Not authenticated');

      let audioUrl = null;
      if (file) {
        // Upload file to storage
        audioUrl = await SupabaseAPI.uploadAudioFile(file);
      }

      const payload = {
        user_id: user.id,
        title,
        tags,
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
        authorName: p?.username || user.name,
        authorAvatar: p?.avatar_emoji || user.avatar || '🟢',
        authorAvatarImage: p?.avatar_image || null,
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
        authorName: profilesMap[c.user_id]?.username || 'Unknown',
        authorAvatar: profilesMap[c.user_id]?.avatar_emoji || '🟢',
        authorAvatarImage: profilesMap[c.user_id]?.avatar_image || null,
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

// Initialize automatically
SupabaseAPI.init();
