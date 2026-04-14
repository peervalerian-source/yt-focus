// YT Focus - YouTube without Shorts
(function () {
  'use strict';

  // ---- State ----
  const state = {
    apiKey: localStorage.getItem('yt_focus_api_key') || '',
    accessToken: localStorage.getItem('yt_focus_access_token') || '',
    clientId: localStorage.getItem('yt_focus_client_id') || '',
    region: localStorage.getItem('yt_focus_region') || 'DE',
    minDuration: parseInt(localStorage.getItem('yt_focus_min_duration') || '60', 10),
    resultsPerPage: parseInt(localStorage.getItem('yt_focus_results') || '25', 10),
    nextPageToken: '',
    currentQuery: '',
    currentCategory: 'trending',
    isLoading: false,
    userProfile: null,
    tokenClient: null,
  };

  const SCOPES = 'https://www.googleapis.com/auth/youtube.readonly';

  // YouTube category IDs
  const CATEGORY_MAP = {
    trending: null,
    subscriptions: null,
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
  const googleSigninBtn = $('#google-signin-btn');
  const clientIdSetup = $('#client-id-setup');
  const clientIdInput = $('#client-id-input');
  const saveClientIdBtn = $('#save-client-id-btn');
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
  const profileBtn = $('#profile-btn');
  const logoutBtn = $('#logout-btn');
  const accountLabel = $('#account-label');
  let categoryChips = $$('.chip');

  // Fill in redirect URI / JS origin on setup screen
  const origin = window.location.origin;
  const redirectUri = $('#redirect-uri');
  const jsOrigin = $('#js-origin');
  if (redirectUri) redirectUri.textContent = origin;
  if (jsOrigin) jsOrigin.textContent = origin;

  // ---- YouTube API ----
  const API_BASE = 'https://www.googleapis.com/youtube/v3';

  async function apiGet(endpoint, params) {
    const url = new URL(`${API_BASE}/${endpoint}`);
    const headers = {};

    // Use OAuth token if available, otherwise API key
    if (state.accessToken) {
      headers['Authorization'] = `Bearer ${state.accessToken}`;
    } else {
      if (!params.key) params.key = state.apiKey;
    }

    Object.entries(params).forEach(([k, v]) => {
      if (v !== null && v !== undefined && v !== '') {
        url.searchParams.set(k, v);
      }
    });

    const res = await fetch(url, { headers });

    if (res.status === 401 && state.accessToken) {
      // Token expired, clear and redirect to login
      state.accessToken = '';
      localStorage.removeItem('yt_focus_access_token');
      showSetupScreen();
      throw new Error('Sitzung abgelaufen. Bitte erneut anmelden.');
    }

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `API Error ${res.status}`);
    }
    return res.json();
  }

  // ---- OAuth ----
  function initOAuth() {
    if (!state.clientId || typeof google === 'undefined') return;

    state.tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: state.clientId,
      scope: SCOPES,
      callback: handleOAuthResponse,
    });
  }

  function handleOAuthResponse(response) {
    if (response.error) {
      setupError.textContent = `Login fehlgeschlagen: ${response.error}`;
      return;
    }
    state.accessToken = response.access_token;
    localStorage.setItem('yt_focus_access_token', response.access_token);
    loadUserProfile().then(() => showMainApp());
  }

  function requestOAuthToken() {
    if (!state.tokenClient) {
      // Need client ID first
      clientIdSetup.classList.remove('hidden');
      return;
    }
    state.tokenClient.requestAccessToken();
  }

  async function loadUserProfile() {
    if (!state.accessToken) return;
    try {
      const data = await apiGet('channels', {
        part: 'snippet',
        mine: 'true',
      });
      const channel = data.items?.[0];
      if (channel) {
        state.userProfile = {
          name: channel.snippet.title,
          avatar: channel.snippet.thumbnails?.default?.url,
        };
        updateProfileUI();
      }
    } catch {
      // silently fail
    }
  }

  function updateProfileUI() {
    if (state.userProfile) {
      profileBtn.classList.remove('hidden');
      profileBtn.innerHTML = state.userProfile.avatar
        ? `<img src="${state.userProfile.avatar}" alt="">`
        : '';
      logoutBtn.classList.remove('hidden');
      changeKeyBtn.classList.add('hidden');
      accountLabel.textContent = state.userProfile.name;
    } else {
      profileBtn.classList.add('hidden');
      logoutBtn.classList.add('hidden');
      changeKeyBtn.classList.remove('hidden');
      accountLabel.textContent = 'Konto';
    }
  }

  function logout() {
    state.accessToken = '';
    state.userProfile = null;
    localStorage.removeItem('yt_focus_access_token');
    if (state.accessToken && typeof google !== 'undefined') {
      google.accounts.oauth2.revoke(state.accessToken);
    }
    updateProfileUI();
    showSetupScreen();
  }

  function showSetupScreen() {
    mainApp.classList.add('hidden');
    setupScreen.classList.remove('hidden');
    setupError.textContent = '';
  }

  // ---- Shorts Detection ----
  function parseDuration(iso) {
    const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    if (!match) return 0;
    const h = parseInt(match[1] || 0, 10);
    const m = parseInt(match[2] || 0, 10);
    const s = parseInt(match[3] || 0, 10);
    return h * 3600 + m * 60 + s;
  }

  function isShort(video) {
    const duration = parseDuration(video.contentDetails?.duration || '');
    if (state.minDuration > 0 && duration > 0 && duration < state.minDuration) return true;

    const title = (video.snippet?.title || '').toLowerCase();
    const description = (video.snippet?.description || '').toLowerCase();
    const tags = (video.snippet?.tags || []).map((t) => t.toLowerCase());

    if (title.includes('#shorts') || title.includes('#short')) return true;
    if (description.includes('#shorts') && description.indexOf('#shorts') < 100) return true;
    if (tags.includes('shorts') || tags.includes('#shorts')) return true;

    return false;
  }

  function formatDuration(iso) {
    const total = parseDuration(iso);
    if (total === 0) return '';
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function formatViews(count) {
    const n = parseInt(count, 10);
    if (isNaN(n)) return '';
    if (n >= 1e6) return `${(n / 1e6).toFixed(1).replace('.0', '')} Mio.`;
    if (n >= 1e3) return `${(n / 1e3).toFixed(1).replace('.0', '')}K`;
    return `${n}`;
  }

  function formatDate(dateStr) {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / 86400000);
    if (days === 0) return 'Heute';
    if (days === 1) return 'Gestern';
    if (days < 7) return `vor ${days} T.`;
    if (days < 30) return `vor ${Math.floor(days / 7)} W.`;
    if (days < 365) return `vor ${Math.floor(days / 30)} M.`;
    return `vor ${Math.floor(days / 365)} J.`;
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

  async function fetchSubscriptions(pageToken) {
    if (!state.accessToken) {
      throw new Error('Bitte anmelden um Abos zu sehen.');
    }

    // Get subscription channel IDs
    const subData = await apiGet('subscriptions', {
      part: 'snippet',
      mine: 'true',
      maxResults: 20,
      order: 'relevance',
      pageToken: pageToken || '',
    });

    state.nextPageToken = subData.nextPageToken || '';
    const channelIds = subData.items.map((i) => i.snippet.resourceId.channelId);
    if (channelIds.length === 0) return [];

    // Get recent uploads from these channels via search
    const searchData = await apiGet('search', {
      part: 'snippet',
      channelId: channelIds.slice(0, 5).join(','),
      type: 'video',
      order: 'date',
      maxResults: state.resultsPerPage,
      publishedAfter: new Date(Date.now() - 7 * 86400000).toISOString(),
    });

    // Actually, search only supports one channelId at a time.
    // Let's use activities instead or do multiple searches.
    // Better approach: search with no channelId filter but get videos from sub channels
    const allVideos = [];
    for (const chId of channelIds.slice(0, 10)) {
      try {
        const chSearch = await apiGet('search', {
          part: 'snippet',
          channelId: chId,
          type: 'video',
          order: 'date',
          maxResults: 3,
        });
        allVideos.push(...chSearch.items);
      } catch {
        // skip failed channels
      }
    }

    if (allVideos.length === 0) return [];

    const videoIds = allVideos.map((i) => i.id.videoId).filter(Boolean);
    const detailData = await apiGet('videos', {
      part: 'snippet,contentDetails,statistics',
      id: videoIds.join(','),
    });

    // Sort by publish date
    const items = detailData.items || [];
    items.sort((a, b) => new Date(b.snippet.publishedAt) - new Date(a.snippet.publishedAt));
    return items;
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
      } else if (state.currentCategory === 'subscriptions') {
        videos = await fetchSubscriptions(append ? state.nextPageToken : '');
      } else {
        videos = await fetchTrending(append ? state.nextPageToken : '');
      }

      const filtered = videos.filter((v) => !isShort(v));

      if (!append) videoList.innerHTML = '';

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
    for (let i = 0; i < 8; i++) {
      html += `
        <div class="skeleton-card">
          <div class="skeleton-thumb"></div>
          <div class="skeleton-info">
            <div class="skeleton-line"></div>
            <div class="skeleton-line"></div>
          </div>
        </div>`;
    }
    return html;
  }

  // ---- Video Card (compact grid) ----
  function createVideoCard(video) {
    const el = document.createElement('div');
    el.className = 'video-card';
    el.dataset.videoId = video.id;

    const thumb =
      video.snippet.thumbnails.medium?.url ||
      video.snippet.thumbnails.high?.url ||
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
        <div class="video-title">${escapeHtml(video.snippet.title)}</div>
        <div class="video-meta">
          <span>${escapeHtml(video.snippet.channelTitle)}</span>
          ${views ? `<span>${views}</span>` : ''}
          <span>${date}</span>
        </div>
      </div>
    `;

    el.addEventListener('click', () => openPlayer(video));
    return el;
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ---- Player ----
  function openPlayer(video) {
    playerOverlay.classList.remove('hidden');
    playerTitle.textContent = video.snippet.title;
    playerChannel.textContent = video.snippet.channelTitle;
    playerViews.textContent = formatViews(video.statistics?.viewCount);
    playerDate.textContent = formatDate(video.snippet.publishedAt);
    playerDescription.textContent = video.snippet.description || '';

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

  // Google Sign-In
  googleSigninBtn.addEventListener('click', () => {
    if (!state.clientId) {
      clientIdSetup.classList.remove('hidden');
      return;
    }
    initOAuth();
    requestOAuthToken();
  });

  // Save Client ID
  saveClientIdBtn.addEventListener('click', () => {
    const id = clientIdInput.value.trim();
    if (!id) {
      setupError.textContent = 'Bitte Client ID eingeben.';
      return;
    }
    state.clientId = id;
    localStorage.setItem('yt_focus_client_id', id);
    clientIdSetup.classList.add('hidden');
    initOAuth();
    requestOAuthToken();
  });

  // API Key setup
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
    if (!searchBar.classList.contains('hidden')) searchInput.focus();
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
    categoryChips.forEach((c) => c.classList.remove('active'));
    loadVideos(false);
    searchInput.blur();
  });

  // Categories
  categoryChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      const cat = chip.dataset.category;

      // Subscriptions need OAuth
      if (cat === 'subscriptions' && !state.accessToken) {
        setupError.textContent = '';
        if (!state.clientId) {
          alert('Bitte zuerst mit Google anmelden um Abos zu sehen.');
          return;
        }
        initOAuth();
        requestOAuthToken();
        return;
      }

      categoryChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.currentCategory = cat;
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
    // Activate "Trends" chip (second one if Abos is first)
    const trendChip = document.querySelector('.chip[data-category="trending"]');
    if (trendChip) trendChip.classList.add('active');
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

  settingsClose.addEventListener('click', () => settingsOverlay.classList.add('hidden'));

  settingsOverlay.addEventListener('click', (e) => {
    if (e.target === settingsOverlay) settingsOverlay.classList.add('hidden');
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
    showSetupScreen();
  });

  logoutBtn.addEventListener('click', () => {
    settingsOverlay.classList.add('hidden');
    logout();
  });

  // Profile button opens settings
  profileBtn.addEventListener('click', () => {
    settingsOverlay.classList.remove('hidden');
    minDurationSelect.value = String(state.minDuration);
    regionSelect.value = state.region;
    resultsPerPage.value = String(state.resultsPerPage);
  });

  // Infinite scroll
  const feed = $('#video-feed');
  feed.addEventListener('scroll', () => {
    if (state.isLoading || !state.nextPageToken) return;
    if (feed.scrollHeight - feed.scrollTop - feed.clientHeight < 500) {
      loadVideos(true);
    }
  });

  // ---- Init ----
  function showMainApp() {
    setupScreen.classList.add('hidden');
    mainApp.classList.remove('hidden');
    updateProfileUI();
    loadVideos(false);
  }

  // Wait for Google GIS to load before initializing OAuth
  function tryInit() {
    if (state.clientId && typeof google !== 'undefined') {
      initOAuth();
    }

    if (state.accessToken) {
      loadUserProfile().then(() => showMainApp());
    } else if (state.apiKey) {
      showMainApp();
    }
  }

  // GIS might load async
  if (typeof google !== 'undefined') {
    tryInit();
  } else {
    window.addEventListener('load', () => setTimeout(tryInit, 500));
  }
})();
