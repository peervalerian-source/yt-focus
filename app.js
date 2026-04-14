// YT Focus - YouTube without Shorts
(function () {
  'use strict';

  // ---- State ----
  const state = {
    apiKey: localStorage.getItem('yt_focus_api_key') || '',
    region: localStorage.getItem('yt_focus_region') || 'DE',
    minDuration: parseInt(localStorage.getItem('yt_focus_min_duration') || '60', 10),
    resultsPerPage: parseInt(localStorage.getItem('yt_focus_results') || '25', 10),
    nextPageToken: '',
    currentQuery: '',
    currentCategory: 'trending',
    isLoading: false,
  };

  // YouTube category IDs
  const CATEGORY_MAP = {
    trending: null,
    music: '10',
    gaming: '20',
    news: '25',
    science: '28',
    sports: '17',
    education: '27',
  };

  // ---- DOM refs ----
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  const setupScreen = $('#setup-screen');
  const mainApp = $('#main-app');
  const apiKeyInput = $('#api-key-input');
  const saveKeyBtn = $('#save-key-btn');
  const setupError = $('#setup-error');
  const searchToggle = $('#search-toggle');
  const searchBar = $('#search-bar');
  const searchInput = $('#search-input');
  const searchForm = $('#search-form');
  const searchClose = $('#search-close');
  const videoList = $('#video-list');
  const loading = $('#loading');
  const loadMoreContainer = $('#load-more-container');
  const loadMoreBtn = $('#load-more-btn');
  const emptyState = $('#empty-state');
  const playerOverlay = $('#player-overlay');
  const playerClose = $('#player-close');
  const playerTitle = $('#player-title');
  const playerChannel = $('#player-channel');
  const playerViews = $('#player-views');
  const playerDate = $('#player-date');
  const playerDescription = $('#player-description');
  const settingsBtn = $('#settings-btn');
  const settingsOverlay = $('#settings-overlay');
  const settingsClose = $('#settings-close');
  const minDurationSelect = $('#min-duration-select');
  const regionSelect = $('#region-select');
  const changeKeyBtn = $('#change-key-btn');
  const resultsPerPage = $('#results-per-page');
  const logoBtn = $('#logo-btn');
  const categoryChips = $$('.chip');

  // ---- YouTube API ----
  const API_BASE = 'https://www.googleapis.com/youtube/v3';

  async function apiGet(endpoint, params) {
    const url = new URL(`${API_BASE}/${endpoint}`);
    if (!params.key) params.key = state.apiKey;
    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') {
        url.searchParams.set(k, v);
      }
    });
    const res = await fetch(url);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Error ${res.status}`);
    }
    return res.json();
  }

  // ---- Shorts Detection ----
  function parseDuration(iso) {
    // PT1H2M3S -> seconds
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const h = parseInt(match[1] || 0, 10);
    const m = parseInt(match[2] || 0, 10);
    const s = parseInt(match[3] || 0, 10);
    return h * 3600 + m * 60 + s;
  }

  function isShort(video) {
    // Check duration
    const duration = parseDuration(video.contentDetails?.duration || '');
    if (state.minDuration > 0 && duration > 0 && duration < state.minDuration) {
      return true;
    }

    // Check title/tags for #Shorts
    const title = (video.snippet?.title || '').toLowerCase();
    const description = (video.snippet?.description || '').toLowerCase();
    const tags = (video.snippet?.tags || []).map((t) => t.toLowerCase());

    if (title.includes('#shorts') || title.includes('#short')) return true;
    if (description.includes('#shorts') && description.indexOf('#shorts') < 100) return true;
    if (tags.includes('shorts') || tags.includes('#shorts')) return true;

    // Check aspect ratio hint from thumbnails — shorts are vertical
    // If the video has no duration info but is tagged, we already caught it

    return false;
  }

  function formatDuration(iso) {
    const total = parseDuration(iso);
    if (total === 0) return '';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) {
      return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    }
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatViews(count) {
    const n = parseInt(count, 10);
    if (isNaN(n)) return '';
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} Mio. Aufrufe`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace('.0', '')}K Aufrufe`;
    return `${n} Aufrufe`;
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Heute';
    if (days === 1) return 'Gestern';
    if (days < 7) return `vor ${days} Tagen`;
    if (days < 30) return `vor ${Math.floor(days / 7)} Wochen`;
    if (days < 365) return `vor ${Math.floor(days / 30)} Monaten`;
    return `vor ${Math.floor(days / 365)} Jahren`;
  }

  // ---- Fetching Videos ----
  async function fetchTrending(pageToken) {
    const categoryId = CATEGORY_MAP[state.currentCategory];
    const params = {
      part: 'snippet,contentDetails,statistics',
      chart: 'mostPopular',
      regionCode: state.region,
      maxResults: state.resultsPerPage,
    };
    if (categoryId) params.videoCategoryId = categoryId;
    if (pageToken) params.pageToken = pageToken;

    const data = await apiGet('videos', params);
    state.nextPageToken = data.nextPageToken || '';
    return data.items || [];
  }

  async function fetchSearch(query, pageToken) {
    const searchData = await apiGet('search', {
      part: 'snippet',
      q: query,
      type: 'video',
      regionCode: state.region,
      maxResults: state.resultsPerPage,
      pageToken: pageToken || '',
      safeSearch: 'moderate',
    });

    state.nextPageToken = searchData.nextPageToken || '';
    const videoIds = searchData.items.map((i) => i.id.videoId).filter(Boolean);
    if (videoIds.length === 0) return [];

    const detailData = await apiGet('videos', {
      part: 'snippet,contentDetails,statistics',
      id: videoIds.join(','),
    });

    return detailData.items || [];
  }

  async function loadVideos(append) {
    if (state.isLoading) return;
    state.isLoading = true;

    if (!append) {
      videoList.innerHTML = showSkeletons();
      emptyState.classList.add('hidden');
      loadMoreContainer.classList.add('hidden');
    }

    loading.classList.toggle('hidden', !append);

    try {
      let videos;
      if (state.currentQuery) {
        videos = await fetchSearch(state.currentQuery, append ? state.nextPageToken : '');
      } else {
        videos = await fetchTrending(append ? state.nextPageToken : '');
      }

      // Filter out shorts
      const filtered = videos.filter((v) => !isShort(v));

      if (!append) {
        videoList.innerHTML = '';
      }

      if (filtered.length === 0 && !append && videoList.children.length === 0) {
        emptyState.classList.remove('hidden');
      } else {
        filtered.forEach((v) => videoList.appendChild(createVideoCard(v)));
      }

      loadMoreContainer.classList.toggle('hidden', !state.nextPageToken);
    } catch (err) {
      if (!append) videoList.innerHTML = '';
      emptyState.classList.remove('hidden');
      emptyState.querySelector('p').textContent = `Fehler: ${err.message}`;
    } finally {
      state.isLoading = false;
      loading.classList.add('hidden');
    }
  }

  function showSkeletons() {
    let html = '';
    for (let i = 0; i < 5; i++) {
      html += `
        <div class="skeleton-card">
          <div class="skeleton-thumb"></div>
          <div class="skeleton-info">
            <div class="skeleton-avatar"></div>
            <div class="skeleton-lines">
              <div class="skeleton-line"></div>
              <div class="skeleton-line"></div>
            </div>
          </div>
        </div>`;
    }
    return html;
  }

  // ---- Video Card ----
  function createVideoCard(video) {
    const el = document.createElement('div');
    el.className = 'video-card';
    el.dataset.videoId = video.id;

    const thumb =
      video.snippet.thumbnails.maxres?.url ||
      video.snippet.thumbnails.high?.url ||
      video.snippet.thumbnails.medium?.url ||
      video.snippet.thumbnails.default?.url;

    const duration = formatDuration(video.contentDetails?.duration || '');
    const views = formatViews(video.statistics?.viewCount);
    const date = formatDate(video.snippet.publishedAt);

    el.innerHTML = `
      <div class="video-thumb-container">
        <img class="video-thumb" src="${thumb}" alt="" loading="lazy">
        ${duration ? `<span class="video-duration">${duration}</span>` : ''}
      </div>
      <div class="video-info">
        <div class="channel-avatar"></div>
        <div class="video-details">
          <div class="video-title">${escapeHtml(video.snippet.title)}</div>
          <div class="video-meta">
            <span>${escapeHtml(video.snippet.channelTitle)}</span>
            ${views ? `<span>${views}</span>` : ''}
            <span>${date}</span>
          </div>
        </div>
      </div>
    `;

    // Load channel thumbnail
    loadChannelAvatar(video.snippet.channelId, el.querySelector('.channel-avatar'));

    el.addEventListener('click', () => openPlayer(video));
    return el;
  }

  const channelAvatarCache = {};

  async function loadChannelAvatar(channelId, imgContainer) {
    try {
      if (channelAvatarCache[channelId]) {
        imgContainer.innerHTML = `<img src="${channelAvatarCache[channelId]}" alt="">`;
        return;
      }
      const data = await apiGet('channels', {
        part: 'snippet',
        id: channelId,
      });
      const url = data.items?.[0]?.snippet?.thumbnails?.default?.url;
      if (url) {
        channelAvatarCache[channelId] = url;
        imgContainer.innerHTML = `<img src="${url}" alt="">`;
      }
    } catch {
      // silently fail
    }
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Player ----
  let currentPlayer = null;

  function openPlayer(video) {
    playerOverlay.classList.remove('hidden');
    playerTitle.textContent = video.snippet.title;
    playerChannel.textContent = video.snippet.channelTitle;
    playerViews.textContent = formatViews(video.statistics?.viewCount);
    playerDate.textContent = formatDate(video.snippet.publishedAt);
    playerDescription.textContent = video.snippet.description || '';

    // Embed via iframe
    const container = $('#player-container');
    container.innerHTML = `
      <iframe
        id="youtube-player"
        src="https://www.youtube-nocookie.com/embed/${video.id}?autoplay=1&playsinline=1&rel=0"
        frameborder="0"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
        style="width:100%;height:100%;">
      </iframe>
    `;

    document.body.style.overflow = 'hidden';
  }

  function closePlayer() {
    playerOverlay.classList.add('hidden');
    const container = $('#player-container');
    container.innerHTML = '<div id="youtube-player"></div>';
    document.body.style.overflow = '';
  }

  // ---- Event Listeners ----
  // Setup
  saveKeyBtn.addEventListener('click', async () => {
    const key = apiKeyInput.value.trim();
    if (!key) {
      setupError.textContent = 'Bitte API Key eingeben.';
      return;
    }
    setupError.textContent = 'Wird geprüft...';
    try {
      await apiGet('videos', { part: 'snippet', chart: 'mostPopular', maxResults: 1, key });
      state.apiKey = key;
      localStorage.setItem('yt_focus_api_key', key);
      showMainApp();
    } catch (err) {
      setupError.textContent = `Ungültiger Key: ${err.message}`;
    }
  });

  // Search
  searchToggle.addEventListener('click', () => {
    searchBar.classList.toggle('hidden');
    if (!searchBar.classList.contains('hidden')) {
      searchInput.focus();
    }
  });

  searchClose.addEventListener('click', () => {
    searchBar.classList.add('hidden');
    searchInput.value = '';
    if (state.currentQuery) {
      state.currentQuery = '';
      state.nextPageToken = '';
      loadVideos(false);
    }
  });

  searchForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = searchInput.value.trim();
    if (!q) return;
    state.currentQuery = q;
    state.nextPageToken = '';

    // Deactivate category chips
    categoryChips.forEach((c) => c.classList.remove('active'));

    loadVideos(false);
    searchInput.blur();
  });

  // Categories
  categoryChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      categoryChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentCategory = chip.dataset.category;
      state.currentQuery = '';
      state.nextPageToken = '';
      searchInput.value = '';
      searchBar.classList.add('hidden');
      loadVideos(false);
    });
  });

  // Load more
  loadMoreBtn.addEventListener('click', () => loadVideos(true));

  // Player
  playerClose.addEventListener('click', closePlayer);

  // Logo -> Home
  logoBtn.addEventListener('click', () => {
    closePlayer();
    state.currentQuery = '';
    state.nextPageToken = '';
    searchInput.value = '';
    searchBar.classList.add('hidden');
    categoryChips.forEach((c) => c.classList.remove('active'));
    categoryChips[0].classList.add('active');
    state.currentCategory = 'trending';
    loadVideos(false);
  });

  // Settings
  settingsBtn.addEventListener('click', () => {
    settingsOverlay.classList.remove('hidden');
    minDurationSelect.value = String(state.minDuration);
    regionSelect.value = state.region;
    resultsPerPage.value = String(state.resultsPerPage);
  });

  settingsClose.addEventListener('click', () => {
    settingsOverlay.classList.add('hidden');
  });

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) {
      settingsOverlay.classList.add('hidden');
    }
  });

  minDurationSelect.addEventListener('change', () => {
    state.minDuration = parseInt(minDurationSelect.value, 10);
    localStorage.setItem('yt_focus_min_duration', String(state.minDuration));
  });

  regionSelect.addEventListener('change', () => {
    state.region = regionSelect.value;
    localStorage.setItem('yt_focus_region', state.region);
    loadVideos(false);
  });

  resultsPerPage.addEventListener('change', () => {
    state.resultsPerPage = parseInt(resultsPerPage.value, 10);
    localStorage.setItem('yt_focus_results', String(state.resultsPerPage));
  });

  changeKeyBtn.addEventListener('click', () => {
    settingsOverlay.classList.add('hidden');
    localStorage.removeItem('yt_focus_api_key');
    state.apiKey = '';
    mainApp.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    apiKeyInput.value = '';
    setupError.textContent = '';
  });

  // Infinite scroll
  const feed = $('#video-feed');
  feed.addEventListener('scroll', () => {
    if (state.isLoading || !state.nextPageToken) return;
    const threshold = 500;
    if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < threshold) {
      loadVideos(true);
    }
  });

  // ---- Init ----
  function showMainApp() {
    setupScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    loadVideos(false);
  }

  if (state.apiKey) {
    showMainApp();
  }
})();
