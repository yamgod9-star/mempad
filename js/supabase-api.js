/* ============================================================
   MEMпад — supabase-api.js
   Небольшая обёртка над Supabase для операций: sounds, comments,
   profiles, storage uploads.
   ============================================================ */

const SupabaseAPI = {
  bucket: 'audios',
  bucketCandidates: ['audios', 'audio', 'sounds', 'uploads', 'public'],

  async init() {
    // Try to detect a valid storage bucket from common names.
    const bucketsToTry = Array.from(new Set([SupabaseAPI.bucket, ...SupabaseAPI.bucketCandidates]));
    for (const bucket of bucketsToTry) {
      try {
        const { data, error } = await supabaseClient.storage.from(bucket).list('', { limit: 1 });
        if (!error) {
          SupabaseAPI.bucket = bucket;
          console.log('✅ SupabaseAPI ready (bucket:', bucket + ')');
          return;
        }
        const message = error?.message || '';
        if (!/not found/i.test(message) && !/bucket/i.test(message)) {
          console.warn('SupabaseAPI bucket probe warning for', bucket, error);
        }
      } catch (err) {
        console.warn('SupabaseAPI bucket probe error for', bucket, err);
      }
    }

    console.warn('SupabaseAPI storage bucket not found in existing candidates. Attempting to create bucket:', SupabaseAPI.bucket);
    if (typeof supabaseClient.storage.createBucket === 'function') {
      try {
        const { data, error } = await supabaseClient.storage.createBucket(SupabaseAPI.bucket, { public: true });
        if (!error) {
          console.log('✅ SupabaseAPI created bucket:', SupabaseAPI.bucket);
          return;
        }
        console.error('SupabaseAPI failed to create bucket:', SupabaseAPI.bucket, error);
      } catch (err) {
        console.error('SupabaseAPI createBucket error:', err);
      }
    } else {
      console.error('Supabase client does not support storage.createBucket(). Please create the bucket manually in Supabase dashboard.');
    }

    console.error(
      'SupabaseAPI storage bucket not found. Please create a storage bucket named "audios" or update SupabaseAPI.bucket to the correct bucket name in js/supabase-api.js.'
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
      if (error) throw error;
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
