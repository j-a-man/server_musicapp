// ── State ──────────────────────────────────────────────────────────────────
const state = {
  songs: [],
  playlists: [],
  queue: [], // context queue
  queueIndex: -1,
  userQueue: [], // explicit user queue
  activeSong: null, // the explicitly currently playing song
  isPlaying: false,
  isShuffled: false,
  isRepeating: false,
  currentView: 'home',
  prevView: 'home',
  pendingAddSongId: null,
  currentPlaylistId: null,
  currentPlaylistName: null,
};

// ── Audio ───────────────────────────────────────────────────────────────────
const audio = new Audio();
audio.preload = 'metadata';

// ── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const views = {
  home: $('view-home'),
  library: $('view-library'),
  search: $('view-search'),
  nowplaying: $('view-nowplaying'),
};

// ── Greeting ─────────────────────────────────────────────────────────────────
function setGreeting() {
  const h = new Date().getHours();
  const g = h < 12 ? 'Good morning, Jaylin' : h < 18 ? 'Good afternoon, Jaylin' : 'Good evening, Jaylin';
  $('home-greeting').textContent = g;
}

// ── Navigation ──────────────────────────────────────────────────────────────
function showView(name) {
  if (name === 'nowplaying') {
    state.prevView = state.currentView;
  }
  state.currentView = name;

  Object.values(views).forEach(v => v.classList.remove('active'));
  if (views[name]) views[name].classList.add('active');

  document.querySelectorAll('.nav-btn').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.view === name);
  });

  if (name === 'home') {
    loadRecommendations();
  }
  if (name === 'search') {
    showBrowseView();
  }
}

// Nav buttons
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.dataset.view === 'library') {
      // Re-render current library context without resetting playlist
      renderLibrary();
    }
    showView(btn.dataset.view);
  });
});

// Library back button → all songs (exit playlist) or home
$('btn-library-back').addEventListener('click', async () => {
  if (state.currentPlaylistId) {
    await loadLibrary(); // resets playlist context, shows all songs
  } else {
    showView('home');
  }
});

$('btn-back-from-player').addEventListener('click', () => {
  showView(state.prevView || 'home');
});

$('btn-open-nowplaying').addEventListener('click', () => showView('nowplaying'));

// ── Library ─────────────────────────────────────────────────────────────────
async function loadLibrary() {
  state.currentPlaylistId = null;
  state.currentPlaylistName = null;
  try {
    const res = await fetch('/api/library');
    const data = await res.json();
    state.songs = data.songs || [];

    // Sync downloadedUrls set
    downloadedUrls.clear();
    state.songs.forEach(s => {
      if (s.youtube_url) downloadedUrls.add(s.youtube_url);
    });

    renderLibrary();
  } catch (e) {
    console.error('Failed to load library', e);
  }
}

function renderLibrary() {
  const list = $('library-list');
  const empty = $('library-empty');
  const ctxLabel = $('library-context-label');
  const title = $('library-title');
  const backBtn = $('btn-library-back');

  // Update header based on context
  if (state.currentPlaylistId && state.currentPlaylistName) {
    title.textContent = state.currentPlaylistName;
    ctxLabel.textContent = 'Playlist';
    $('song-count').textContent = `${state.songs.length} songs`;
    backBtn.style.opacity = '1';
    backBtn.style.pointerEvents = 'auto';
  } else {
    title.textContent = 'Library';
    ctxLabel.textContent = 'All Songs';
    $('song-count').textContent = state.songs.length ? `${state.songs.length} songs` : '';
    backBtn.style.opacity = '0';
    backBtn.style.pointerEvents = 'none';
  }

  if (!state.songs.length) {
    list.innerHTML = '';
    empty.classList.remove('hidden');
    return;
  }
  empty.classList.add('hidden');
  list.innerHTML = state.songs.map((s, i) => songItemHTML(s, i)).join('');

  list.querySelectorAll('.song-item').forEach((el, i) => {
    el.addEventListener('click', e => {
      if (e.target.closest('.song-menu-btn')) return;
      playFromLibrary(i);
    });
    el.querySelector('.song-menu-btn').addEventListener('click', e => {
      e.stopPropagation();
      openContextMenu(e, state.songs[i]);
    });
  });
  highlightCurrentSong();
}

function songItemHTML(song, i) {
  const dur = formatDuration(song.duration);
  const thumb = song.thumbnail
    ? `<img src="${escHtml(song.thumbnail)}" alt="" onerror="this.style.display='none'" />`
    : '♪';
  const delay = Math.min(i * 30, 400);
  return `
    <div class="song-item fade-in-item" data-id="${song.id}" style="animation-delay:${delay}ms">
      <div class="song-thumb">${thumb}</div>
      <div class="song-info">
        <div class="song-title">${escHtml(song.title)}</div>
        <div class="song-artist">${escHtml(song.artist || '—')}</div>
      </div>
      <span class="song-duration">${dur}</span>
      <button class="song-menu-btn" title="More options">
        <svg viewBox="0 0 24 24" fill="currentColor"><circle cx="12" cy="5" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="12" cy="19" r="1.5"/></svg>
      </button>
    </div>`;
}

function highlightCurrentSong() {
  const current = currentSong();
  document.querySelectorAll('.song-item').forEach(el => {
    el.classList.toggle('playing', current && Number(el.dataset.id) === current.id);
  });
}

// ── Context Menu ─────────────────────────────────────────────────────────────
let activeMenu = null;
function openContextMenu(e, song) {
  closeContextMenu();
  const menu = document.createElement('div');
  menu.className = 'ctx-menu';
  menu.innerHTML = `
    <div class="ctx-item" data-action="play">
      <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg> Play
    </div>
    <div class="ctx-item" data-action="add-queue">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> Add to Queue
    </div>
    <div class="ctx-item" data-action="add-playlist">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Add to Playlist
    </div>
    <div class="ctx-item danger" data-action="delete">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg> Delete
    </div>`;

  const rect = e.currentTarget.getBoundingClientRect();
  menu.style.top = `${Math.min(rect.bottom + 4, window.innerHeight - 200)}px`;
  menu.style.right = `${window.innerWidth - rect.right}px`;
  document.body.appendChild(menu);
  activeMenu = menu;

  menu.addEventListener('click', async ev => {
    const action = ev.target.closest('.ctx-item')?.dataset.action;
    if (!action) return;
    closeContextMenu();
    if (action === 'play') {
      const idx = state.songs.findIndex(s => s.id === song.id);
      if (idx >= 0) playFromLibrary(idx);
    } else if (action === 'add-queue') {
      addToQueue(song);
    } else if (action === 'add-playlist') {
      openAddToPlaylist(song.id);
    } else if (action === 'delete') {
      await deleteSong(song.id);
    }
  });

  setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 10);
}

function closeContextMenu() {
  if (activeMenu) { activeMenu.remove(); activeMenu = null; }
}

// ── Delete Song ──────────────────────────────────────────────────────────────
async function deleteSong(songId) {
  try {
    await fetch(`/api/library/${songId}`, { method: 'DELETE' });
    if (currentSong()?.id === songId) {
      audio.pause();
      state.queue = [];
      state.queueIndex = -1;
      updateMiniPlayer();
      updateNowPlayingUI();
    }
    // Reload correct context
    if (state.currentPlaylistId) {
      const res = await fetch(`/api/playlists/${state.currentPlaylistId}`);
      const data = await res.json();
      state.songs = data.songs || [];
    } else {
      await loadLibrary();
    }
    renderLibrary();
    toast('Song deleted');
  } catch (e) {
    toast('Failed to delete song');
  }
}

// ── Playlists Panel ──────────────────────────────────────────────────────────
async function loadPlaylists() {
  const res = await fetch('/api/playlists');
  const data = await res.json();
  state.playlists = data.playlists || [];
  renderPlaylists();
}

function renderPlaylists() {
  const list = $('playlists-list');
  if (!state.playlists.length) {
    list.innerHTML = '<div class="empty-state"><p style="padding:20px 0">No playlists yet</p></div>';
    return;
  }

  list.innerHTML = state.playlists.map(p => `
    <div class="playlist-item" data-id="${p.id}">
      <div class="playlist-info">
        <div class="playlist-name">${escHtml(p.name)}</div>
      </div>
      <button class="playlist-del-btn" data-id="${p.id}" title="Delete playlist">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>`).join('');

  list.querySelectorAll('.playlist-item').forEach(item => {
    item.addEventListener('click', async (e) => {
      if (e.target.closest('.playlist-del-btn')) return;
      const id = item.dataset.id;
      try {
        const res = await fetch(`/api/playlists/${id}`);
        if (!res.ok) throw new Error('Server error');
        const data = await res.json();
        state.songs = data.songs || [];
        state.currentPlaylistId = id;
        state.currentPlaylistName = data.name || 'Playlist';
        renderLibrary();
        closePlaylists();
        showView('library');
        toast(`Loaded ${state.currentPlaylistName}`);
      } catch (err) {
        console.error('Playlist Load Error:', err);
        toast('Failed to load playlist');
      }
    });
  });

  list.querySelectorAll('.playlist-del-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (!confirm('Delete this playlist?')) return;
      await fetch(`/api/playlists/${btn.dataset.id}`, { method: 'DELETE' });
      // If we were viewing the deleted playlist, go back to all songs
      if (state.currentPlaylistId === btn.dataset.id) {
        await loadLibrary();
      }
      await loadPlaylists();
    });
  });
}

$('btn-open-playlists').addEventListener('click', () => {
  loadPlaylists();
  $('panel-playlists').classList.remove('hidden');
  $('panel-overlay').classList.remove('hidden');
});
$('btn-close-playlists').addEventListener('click', closePlaylists);
$('panel-overlay').addEventListener('click', () => { closePlaylists(); closeQueue(); });

function closePlaylists() {
  $('panel-playlists').classList.add('hidden');
  if ($('panel-queue') && $('panel-queue').classList.contains('hidden')) {
    $('panel-overlay').classList.add('hidden');
  }
}

// ── Queue Panel ──────────────────────────────────────────────────────────────
$('btn-open-queue').addEventListener('click', (e) => {
  e.stopPropagation();
  renderQueue();
  $('panel-queue').classList.remove('hidden');
  $('panel-overlay').classList.remove('hidden');
});
$('btn-close-queue').addEventListener('click', (e) => { e.stopPropagation(); closeQueue(); });

function closeQueue() {
  $('panel-queue').classList.add('hidden');
  if ($('panel-playlists').classList.contains('hidden')) {
    $('panel-overlay').classList.add('hidden');
  }
}

function renderQueue() {
  const container = $('queue-list');
  if (!container) return;

  let html = '';

  // 1. Now Playing
  if (state.activeSong) {
    html += `<div class="queue-section-title">Now Playing</div>`;
    html += `<div id="np-item-container">${queueItemHTML(state.activeSong, -1, true)}</div>`;
  }

  // 2. Explicit User Queue
  if (state.userQueue.length > 0) {
    html += `<div class="queue-section-title">Next In Queue</div>`;
    html += `<div id="user-queue-items">`;
    html += state.userQueue.map((s, i) => queueItemHTML(s, i, false, true)).join('');
    html += `</div>`;
  }

  // 3. Upcoming Context Queue
  let upcoming = [];
  if (state.queue.length > 0) {
    html += `<div class="queue-section-title">Next Up</div>`;
    if (state.isShuffled) {
      upcoming = state.queue.filter(s => s.id !== state.activeSong?.id).slice(0, 50);
    } else {
      let nextIdx = (state.queueIndex + 1) % state.queue.length;
      if (state.queueIndex !== -1) {
        upcoming = state.queue.slice(nextIdx).concat(state.queue.slice(0, state.queueIndex));
        upcoming = upcoming.slice(0, 50);
      }
    }
    if (upcoming.length) {
      html += `<div id="context-queue-items">`;
      html += upcoming.map((s, i) => queueItemHTML(s, i, false, false)).join('');
      html += `</div>`;
    } else {
      html += '<div style="padding:10px 16px;color:var(--text-muted);font-size:13px">End of queue</div>';
    }
  }

  if (!html) {
    html = '<div class="empty-state"><p style="padding:20px 0">Queue is empty</p></div>';
  }
  container.innerHTML = html;

  // Initialize Sortable for User Queue
  const userList = $('user-queue-items');
  if (userList && typeof Sortable !== 'undefined') {
    new Sortable(userList, {
      animation: 150,
      handle: '.queue-drag-handle',
      onEnd: (evt) => {
        const item = state.userQueue.splice(evt.oldIndex, 1)[0];
        state.userQueue.splice(evt.newIndex, 0, item);
        renderQueue();
      }
    });
  }

  // Initialize Sortable for Context Queue
  const contextList = $('context-queue-items');
  if (contextList && typeof Sortable !== 'undefined') {
    new Sortable(contextList, {
      animation: 150,
      handle: '.queue-drag-handle',
      onEnd: (evt) => {
        const item = upcoming.splice(evt.oldIndex, 1)[0];
        upcoming.splice(evt.newIndex, 0, item);

        if (!state.isShuffled) {
          let nextIdx = (state.queueIndex + 1) % state.queue.length;
          let newFullQueue = [...state.queue];
          for (let i = 0; i < upcoming.length; i++) {
            let targetIdx = (nextIdx + i) % state.queue.length;
            newFullQueue[targetIdx] = upcoming[i];
          }
          state.queue = newFullQueue;
        } else {
          state.queue = [state.activeSong, ...upcoming];
          state.queueIndex = 0;
        }
        renderQueue();
      }
    });
  }

  container.querySelectorAll('.queue-del-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset.idx);
      state.userQueue.splice(idx, 1);
      renderQueue();
    });
  });
}

function queueItemHTML(song, idx, isPlaying = false, isUserQueue = false) {
  const thumb = song.thumbnail
    ? `<img src="${escHtml(song.thumbnail)}" alt="" onerror="this.style.display='none'" />`
    : '♪';
  const removeBtn = isUserQueue
    ? `<div class="queue-del-btn" data-idx="${idx}" title="Remove"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></div>`
    : '';
  const dragHandle = `<div class="queue-drag-handle"><svg viewBox="0 0 24 24" fill="currentColor"><circle cx="9" cy="5" r="1"/><circle cx="9" cy="12" r="1"/><circle cx="9" cy="19" r="1"/><circle cx="15" cy="5" r="1"/><circle cx="15" cy="12" r="1"/><circle cx="15" cy="19" r="1"/></svg></div>`;

  return `
    <div class="queue-item ${isPlaying ? 'playing' : ''}">
      ${!isPlaying ? dragHandle : '<div style="width:24px"></div>'}
      <div class="queue-thumb">${thumb}</div>
      <div class="queue-info">
        <div class="queue-title">${escHtml(song.title)}</div>
        <div class="queue-artist">${escHtml(song.artist || '—')}</div>
      </div>
      ${removeBtn}
    </div>
  `;
}

$('btn-new-playlist').addEventListener('click', async () => {
  const name = prompt('Playlist name:');
  if (!name?.trim()) return;
  await fetch('/api/playlists', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: name.trim() }) });
  await loadPlaylists();
});

// ── Add to Playlist Modal ──────────────────────────────────────────────────
async function openAddToPlaylist(songId) {
  state.pendingAddSongId = songId;
  await loadPlaylists();
  const opts = $('modal-playlist-options');
  if (!state.playlists.length) {
    opts.innerHTML = '<div class="modal-option" style="color:var(--text-muted)">No playlists — create one first</div>';
  } else {
    opts.innerHTML = state.playlists.map(p =>
      `<div class="modal-option" data-playlist-id="${p.id}">${escHtml(p.name)}</div>`
    ).join('');
    opts.querySelectorAll('.modal-option').forEach(el => {
      el.addEventListener('click', async () => {
        await fetch(`/api/playlists/${el.dataset.playlistId}/songs/${state.pendingAddSongId}`, { method: 'POST' });
        $('modal-add-playlist').classList.add('hidden');
        toast('Added to playlist');
      });
    });
  }
  $('modal-add-playlist').classList.remove('hidden');
}
$('btn-modal-cancel').addEventListener('click', () => $('modal-add-playlist').classList.add('hidden'));

// ── Recommendations ──────────────────────────────────────────────────────────
let recsLoaded = false;

async function loadRecommendations() {
  if (recsLoaded) return;
  $('home-loading').classList.remove('hidden');
  $('section-for-you').style.opacity = '0';
  $('section-trending').style.opacity = '0';

  // Render Artist Radio and Your Music row immediately from library
  renderYourMusicRow();
  renderArtistRadioCards();

  try {
    const res = await fetch('/api/recommendations');
    const data = await res.json();

    $('for-you-label').textContent = data.forYouLabel || 'Based on your taste';
    renderRecRow('rec-for-you', data.forYou || []);
    renderRecRow('rec-trending', data.trending || []);

    if (data.discoveryRows?.length) {
      renderDiscoveryRows(data.discoveryRows);
    }
    if (data.suggestedPlaylists?.length) {
      renderSuggestedPlaylists(data.suggestedPlaylists);
    }

    $('section-for-you').style.transition = 'opacity 0.4s ease';
    $('section-trending').style.transition = 'opacity 0.4s ease 0.1s';
    $('section-for-you').style.opacity = '1';
    $('section-trending').style.opacity = '1';

    recsLoaded = true;
  } catch (e) {
    console.error('Failed to load recommendations', e);
  } finally {
    $('home-loading').classList.add('hidden');
  }
}

function renderSuggestedPlaylists(playlists) {
  const container = $('rec-playlists');
  const section = $('section-playlists');
  if (!container) return;
  section.classList.remove('hidden');
  container.innerHTML = playlists.map(p => {
    const thumb = p.thumbnail
      ? `<img src="${escHtml(p.thumbnail)}" alt="" onerror="this.style.display='none'" />`
      : `<span class="rec-art-fallback">💿</span>`;
    return `
      <div class="rec-card playlist-rec-card" data-query="${escHtml(p.title)}">
        <div class="rec-card-art">
          ${thumb}
          <div class="rec-card-play">
            <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          </div>
        </div>
        <div class="rec-card-info">
          <div class="rec-card-title">${escHtml(p.title)}</div>
          <div class="rec-card-channel">Playlist</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.playlist-rec-card').forEach(card => {
    card.addEventListener('click', () => {
      $('search-input').value = card.dataset.query;
      doSearch();
      showView('search');
    });
  });
}

function renderArtistRadioCards() {
  const container = $('rec-artist-radio');
  const section = $('section-artist-radio');
  if (!container) return;

  const artists = [...new Set(
    state.songs.filter(s => s.filename !== 'pending' && s.artist).map(s => s.artist)
  )].slice(0, 10);

  if (!artists.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');

  container.innerHTML = artists.map(artist => {
    // Find a thumbnail from any song by this artist
    const thumb = state.songs.find(s => s.artist === artist && s.thumbnail)?.thumbnail;
    const imgEl = thumb
      ? `<img src="${escHtml(thumb)}" alt="" onerror="this.style.display='none'" />`
      : `<span class="rec-art-fallback">♪</span>`;
    return `
      <div class="radio-card" data-artist="${escHtml(artist)}">
        <div class="radio-card-art">
          ${imgEl}
          <div class="radio-card-overlay">
            <div class="radio-play-icon">
              <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
            </div>
          </div>
        </div>
        <div class="radio-card-label">${escHtml(artist)}</div>
        <div class="radio-card-sub">Radio</div>
      </div>`;
  }).join('');

  container.querySelectorAll('.radio-card').forEach(card => {
    card.addEventListener('click', () => startArtistRadio(card.dataset.artist));
  });
}

function renderDiscoveryRows(discoveryRows) {
  const container = $('section-discovery-rows');
  if (!container) return;

  container.innerHTML = discoveryRows.map((row, ri) => `
    <div class="rec-section" style="opacity:0;transition:opacity 0.4s ease ${0.1 + ri * 0.08}s" id="discovery-row-${ri}">
      <div class="rec-section-header">
        <div class="rec-section-title">${escHtml(row.label)}</div>
        <div class="rec-section-sub discovery-row-radio" data-artist="${escHtml(row.artist)}" style="cursor:pointer">
          Start Radio →
        </div>
      </div>
      <div class="rec-scroll" id="rec-discovery-${ri}"></div>
    </div>`).join('');

  // Render each row's songs
  discoveryRows.forEach((row, ri) => {
    renderRecRow(`rec-discovery-${ri}`, row.songs);
    // Fade in
    requestAnimationFrame(() => {
      const el = $(`discovery-row-${ri}`);
      if (el) el.style.opacity = '1';
    });
  });

  // Wire up 'Start Radio' links
  container.querySelectorAll('.discovery-row-radio').forEach(btn => {
    btn.addEventListener('click', () => startArtistRadio(btn.dataset.artist));
  });
}

async function startArtistRadio(artist) {
  toast(`Starting ${artist} Radio…`);
  try {
    const res = await fetch(`/api/radio/${encodeURIComponent(artist)}`);
    const data = await res.json();
    const songs = data.songs || [];
    if (!songs.length) { toast('No songs found for this radio'); return; }

    // Add all radio results as a downloadable queue suggestion shown in search results
    // For Option B: load them into a temporary "radio session" that queues downloads
    state.radioQueue = songs;
    state.radioArtist = artist;
    showRadioModal(artist, songs);
  } catch (e) {
    console.error('Radio failed', e);
    toast('Failed to load radio');
  }
}

function showRadioModal(artist, songs) {
  const container = $('search-results');
  $('search-empty').classList.add('hidden');
  $('search-input').value = `${artist} Radio`;
  showView('search');

  // Build banner + proper result-item rows (same layout as regular search)
  let html = `
    <div class="radio-header-banner">
      <div class="radio-banner-left">
        <div class="radio-banner-icon">📻</div>
        <div>
          <div class="radio-banner-title">${escHtml(artist)} Radio</div>
          <div class="radio-banner-sub">${songs.length} songs</div>
        </div>
      </div>
      <div class="radio-banner-actions">
        <button class="btn-download-all" id="btn-dl-all-radio">Download All</button>
        <button class="btn-play-all-radio" id="btn-play-all-radio">Play All</button>
      </div>
    </div>`;

  html += songs.map((r, i) => {
    const dur = formatDuration(r.duration);
    const videoId = (r.url || '').match(/[?&]v=([^&]+)/)?.[1] || '';
    const thumbSrc = r.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');
    const thumb = thumbSrc
      ? `<img src="${escHtml(thumbSrc)}" alt="" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${videoId}/mqdefault.jpg'" />`
      : '♫';
    const alreadyDone = r.is_downloaded || downloadedUrls.has(r.url);
    return `
      <div class="result-item fade-in-item" style="animation-delay:${i * 35}ms"
           data-url="${escHtml(r.url || '')}">
        <div class="result-thumb">${thumb}</div>
        <div class="result-info">
          <div class="result-title">${escHtml(r.title)}</div>
          <div class="result-channel">${escHtml(r.channel || '—')}</div>
          <div class="result-duration">${dur}</div>
        </div>
        <div class="result-actions">
          ${alreadyDone && r.song_id
        ? `<button class="result-play-btn" data-song-id="${r.song_id}" title="Play Now">
                 <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
               </button>`
        : ''
      }
          <button class="btn-download ${alreadyDone ? 'done' : ''}"
            data-url="${escHtml(r.url || '')}"
            data-title="${escHtml(r.title)}"
            data-artist="${escHtml(r.channel || '')}"
            data-thumb="${escHtml(thumbSrc)}"
            data-duration="${r.duration || 0}"
            title="${alreadyDone ? 'Downloaded' : 'Download'}">
            ${alreadyDone
        ? `<svg viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`}
          </button>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = html;

  container.querySelectorAll('.result-play-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const resultItem = btn.closest('.result-item');
      playFromSearch(parseInt(btn.dataset.songId), resultItem ? resultItem.dataset.url : null);
    });
  });

  const dlAllBtn = $('btn-dl-all-radio');
  if (dlAllBtn) {
    dlAllBtn.addEventListener('click', () => downloadAll(songs, dlAllBtn));
  }

  const playAllBtn = $('btn-play-all-radio');
  if (playAllBtn) {
    playAllBtn.addEventListener('click', () => playAllDownloaded(songs));
  }

  container.querySelectorAll('.btn-download:not(.done)').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (btn.classList.contains('downloading') || btn.classList.contains('done')) return;
      await startDownload(btn);
    });
  });
}


function renderYourMusicRow() {
  const container = $('rec-your-music');
  const section = $('section-your-music');
  if (!container) return;
  const songs = state.songs.filter(s => s.filename !== 'pending').slice(0, 12);
  if (!songs.length) {
    section.classList.add('hidden');
    return;
  }
  section.classList.remove('hidden');
  container.innerHTML = songs.map(s => {
    const thumb = s.thumbnail
      ? `<img src="${escHtml(s.thumbnail)}" alt="" onerror="this.style.display='none'" />`
      : `<span class="rec-art-fallback">\u266a</span>`;
    return `
      <div class="rec-card your-music-card" data-song-id="${s.id}">
        <div class="rec-card-art">${thumb}</div>
        <div class="rec-card-info">
          <div class="rec-card-title">${escHtml(s.title)}</div>
          <div class="rec-card-channel">${escHtml(s.artist || '\u2014')}</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.your-music-card').forEach((card, i) => {
    card.addEventListener('click', () => {
      // Play from library context at this song
      state.queue = [...state.songs];
      state.queueIndex = i;
      playCurrent();
      showView('nowplaying');
    });
  });
}

function renderRecRow(containerId, results) {
  const container = $(containerId);
  if (!results.length) {
    container.innerHTML = '<p class="rec-empty">Nothing found</p>';
    return;
  }
  container.innerHTML = results.map(r => {
    const dur = formatDuration(r.duration);
    // Use thumbnail or fall back to YouTube standard thumbnail URL from video ID
    const videoId = (r.url || '').match(/[?&]v=([^&]+)/)?.[1] || '';
    const thumbSrc = r.thumbnail || (videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : '');
    const thumb = thumbSrc
      ? `<img src="${escHtml(thumbSrc)}" alt="" onerror="this.onerror=null;this.src='https://i.ytimg.com/vi/${videoId}/mqdefault.jpg'" />`
      : `<span class="rec-art-fallback">\u266a</span>`;
    const alreadyDone = r.is_downloaded || downloadedUrls.has(r.url);
    return `
      <div class="rec-card" ${alreadyDone ? 'style="cursor:pointer"' : ''} data-song-id="${r.song_id || ''}" data-url="${escHtml(r.url || '')}">
        <div class="rec-card-art">
          ${thumb || '<span class="rec-art-fallback">♪</span>'}
          <button class="rec-dl-btn ${alreadyDone ? 'done' : ''}"
            data-url="${escHtml(r.url)}"
            data-title="${escHtml(r.title)}"
            data-artist="${escHtml(r.channel || '')}"
            data-thumb="${escHtml(r.thumbnail || '')}"
            data-duration="${r.duration || 0}"
            title="Download">
            ${alreadyDone
        ? `<svg viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
      }
          </button>
        </div>
        <div class="rec-card-info">
          <div class="rec-card-title">${escHtml(r.title)}</div>
          <div class="rec-card-channel">${escHtml(r.channel || '')} · ${dur}</div>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.rec-dl-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (btn.classList.contains('downloading') || btn.classList.contains('done')) return;
      await startDownload(btn);
    });
  });

  // Make downloaded cards clickable to play radio
  container.querySelectorAll('.rec-card').forEach(card => {
    card.addEventListener('click', () => {
      const btn = card.querySelector('.rec-dl-btn');
      if (btn && btn.classList.contains('done')) {
        playFromSearch(parseInt(card.dataset.songId), card.dataset.url);
      }
    });
  });
}

// ── Search ───────────────────────────────────────────────────────────────────
$('search-btn').addEventListener('click', doSearch);
$('search-input').addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });

async function doSearch() {
  const q = $('search-input').value.trim();
  if (!q) {
    showBrowseView();
    return;
  }
  $('search-browse').classList.add('hidden');
  $('search-results').innerHTML = '<div class="empty-state"><div class="empty-icon" style="animation:pulse 1s infinite">⏳</div><p>Searching…</p></div>';
  $('search-empty').classList.add('hidden');
  try {
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    renderSearchResults(data.results || []);
  } catch (e) {
    $('search-results').innerHTML = '<div class="empty-state"><p>Search failed. Is the server running?</p></div>';
  }
}

function showBrowseView() {
  if ($('search-input').value.trim()) return;
  $('search-results').innerHTML = '';
  $('search-browse').classList.remove('hidden');
  $('search-empty').classList.add('hidden');

  const genres = [
    { label: 'For You', color: '#1e3a8a', query: 'recommended for you mix' },
    { label: 'Chill', color: '#14532d', query: 'chill lofi beats' },
    { label: 'Pop', color: '#701a75', query: 'top pop hits 2024' },
    { label: 'Hip-Hop', color: '#7c2d12', query: 'hip hop rap mix' },
    { label: 'R&B', color: '#4c1d95', query: 'modern r&b soul' },
    { label: 'Focus', color: '#064e3b', query: 'deep focus study music' },
    { label: 'Workout', color: '#831843', query: 'energetic workout mix' },
    { label: 'Sleep', color: '#172554', query: 'calm sleep ambient' },
  ];

  $('browse-grid').innerHTML = genres.map(g => `
    <div class="browse-tile" style="background-color:${g.color}" data-query="${escHtml(g.query)}">
      <div class="browse-tile-label">${escHtml(g.label)}</div>
    </div>
  `).join('');

  $('browse-grid').querySelectorAll('.browse-tile').forEach(tile => {
    tile.addEventListener('click', () => {
      $('search-input').value = tile.dataset.query;
      doSearch();
    });
  });
}

const downloadedUrls = new Set();

function renderSearchResults(results) {
  const container = $('search-results');
  if (!results.length) {
    container.innerHTML = '<div class="empty-state"><p>No results found</p></div>';
    return;
  }
  container.innerHTML = results.map((r, i) => {
    const dur = formatDuration(r.duration);
    const thumb = r.thumbnail ? `<img src="${escHtml(r.thumbnail)}" alt="" onerror="this.style.display='none'" />` : '♫';
    const alreadyDone = r.is_downloaded || downloadedUrls.has(r.url);
    const delay = Math.min(i * 35, 500);
    return `
      <div class="result-item fade-in-item" ${alreadyDone ? 'style="cursor:pointer; animation-delay:' + delay + 'ms"' : 'style="animation-delay:' + delay + 'ms"'} data-url="${escHtml(r.url)}">
        <div class="result-thumb">${thumb}</div>
        <div class="result-info">
          <div class="result-title">${escHtml(r.title)}</div>
          <div class="result-channel">${escHtml(r.channel || '')}</div>
          <div class="result-duration">${dur}</div>
        </div>
        <div class="result-actions">
          ${alreadyDone && r.song_id
        ? `<button class="result-play-btn" data-song-id="${r.song_id}" title="Play Now">
                 <svg viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
               </button>`
        : ''
      }
          <button class="btn-download ${alreadyDone ? 'done' : ''}" data-url="${escHtml(r.url)}" data-title="${escHtml(r.title)}" data-artist="${escHtml(r.channel || '')}" data-thumb="${escHtml(r.thumbnail || '')}" data-duration="${r.duration || 0}" title="${alreadyDone ? 'Downloaded' : 'Download'}">
            ${alreadyDone
        ? `<svg viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>`
        : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`
      }
          </button>
        </div>
      </div>`;
  }).join('');

  container.querySelectorAll('.result-play-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const resultItem = btn.closest('.result-item');
      playFromSearch(parseInt(btn.dataset.songId), resultItem ? resultItem.dataset.url : null);
    });
  });

  container.querySelectorAll('.btn-download').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      if (btn.classList.contains('downloading') || btn.classList.contains('done')) return;
      await startDownload(btn);
    });
  });

  // Make downloaded result items clickable to play radio
  container.querySelectorAll('.result-item').forEach(item => {
    item.addEventListener('click', () => {
      const btn = item.querySelector('.btn-download');
      if (btn && btn.classList.contains('done')) {
        const songIdBtn = item.querySelector('.result-play-btn');
        const songId = songIdBtn ? parseInt(songIdBtn.dataset.songId) : null;
        playFromSearch(songId, item.dataset.url);
      }
    });
  });
}

async function startDownload(btn) {
  const { url, title, artist, thumb, duration } = btn.dataset;
  btn.classList.add('downloading');
  btn.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/></svg>`;

  try {
    const res = await fetch('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url, title, artist, thumbnail: thumb, duration: parseInt(duration) || 0 }),
    });
    const data = await res.json();
    pollDownloadStatus(data.song_id, btn, url);
  } catch (e) {
    btn.classList.remove('downloading');
    toast('Download failed');
  }
}

async function downloadAll(songs, btn) {
  if (btn.classList.contains('loading')) return;
  btn.classList.add('loading');
  btn.textContent = 'Processing…';

  let count = 0;
  for (const s of songs) {
    if (s.is_downloaded || downloadedUrls.has(s.url)) continue;

    // Simulate a click on the download button for this song if visible
    const rowBtn = document.querySelector(`.btn-download[data-url="${s.url}"]`);
    if (rowBtn) {
      await startDownload(rowBtn);
      count++;
      // Small delay between starts to avoid overwhelming the server
      await new Promise(r => setTimeout(r, 800));
    }
  }

  btn.textContent = count > 0 ? `Started ${count} downloads` : 'All up to date';
  setTimeout(() => {
    btn.classList.remove('loading');
    btn.textContent = 'Download All';
  }, 3000);
}

function playAllDownloaded(songs) {
  // Find all songs from the radio list that exist in our local library
  const librarySongs = songs.map(s => {
    return state.songs.find(libSong => libSong.youtube_url === s.url || libSong.id === s.song_id);
  }).filter(Boolean); // removes any that aren't downloaded yet

  if (!librarySongs.length) {
    toast('No songs downloaded yet — download some first!');
    return;
  }

  state.queue = librarySongs;
  state.queueIndex = 0;
  state.activeSong = state.queue[0];
  playCurrent();
  showView('nowplaying');
  toast(`Playing ${librarySongs.length} downloaded songs from radio`);
}

function playFromSearch(songId, songUrl = null) {
  // Find the song in state.songs (library)
  let targetSong = null;
  if (songId && !isNaN(songId)) {
    targetSong = state.songs.find(s => s.id === songId);
  }
  if (!targetSong && songUrl) {
    targetSong = state.songs.find(s => s.youtube_url === songUrl);
  }

  if (targetSong) {
    // 1. Same artist songs
    let sameArtist = state.songs.filter(s => s.id !== targetSong.id && s.artist === targetSong.artist);
    sameArtist = sameArtist.sort(() => Math.random() - 0.5);

    // 2. Random other songs
    let otherSongs = state.songs.filter(s => s.id !== targetSong.id && s.artist !== targetSong.artist);
    otherSongs = otherSongs.sort(() => Math.random() - 0.5);

    // Construct queue: target song + up to 10 same artist + up to 15 random others
    let radioQueue = [targetSong];
    radioQueue = radioQueue.concat(sameArtist.slice(0, 10));
    radioQueue = radioQueue.concat(otherSongs.slice(0, 15));

    state.queue = radioQueue;
    state.queueIndex = 0;
    state.activeSong = state.queue[0];
    playCurrent();
    showView('nowplaying');
    toast(`Playing similar songs to ${targetSong.title}`);
  } else {
    toast("Please wait for the song to finish downloading.");
  }
}

function pollDownloadStatus(songId, btn, url) {
  const interval = setInterval(async () => {
    try {
      const res = await fetch(`/api/download/status/${songId}`);
      const data = await res.json();
      if (data.status === 'done') {
        clearInterval(interval);
        btn.classList.remove('downloading');
        btn.classList.add('done');
        btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><polyline points="20 6 9 17 4 12"/></svg>`;
        downloadedUrls.add(url);
        toast('Download complete!');
        // Refresh library in background to get the new song_id
        await loadLibrary();
        // Re-render current results if still on search/radio
        if (state.currentView === 'search') {
          // Small hack: if we are in radio/search, the items now have songIds
          // but we don't want to wipe the whole UI. 
          // In a real app we'd update just that row.
        }
      } else if (data.status.startsWith('error')) {
        clearInterval(interval);
        btn.classList.remove('downloading');
        toast('Download failed');
      }
    } catch (e) {
      clearInterval(interval);
    }
  }, 2000);
}

// ── Playback ─────────────────────────────────────────────────────────────────
function currentSong() {
  return state.activeSong || null;
}

function playFromLibrary(index) {
  state.queue = [...state.songs];
  state.queueIndex = index;
  state.activeSong = state.queue[index];
  playCurrent();
}

function playCurrent() {
  const song = currentSong();
  if (!song) return;
  audio.src = `/api/stream/${song.id}`;
  audio.load();
  audio.play().catch(console.error);
  state.isPlaying = true;
  updateNowPlayingUI();
  updateMiniPlayer();
  highlightCurrentSong();
  setupMediaSession();
  renderQueue();
}

function togglePlay() {
  if (!currentSong()) return;
  if (audio.paused) {
    audio.play().catch(console.error);
    state.isPlaying = true;
  } else {
    audio.pause();
    state.isPlaying = false;
  }
  updatePlayButtons();
}

function nextSong() {
  // 1. Prioritize userQueue
  if (state.userQueue.length > 0) {
    state.activeSong = state.userQueue.shift();
    playCurrent();
    return;
  }
  // 2. Fall back to context queue
  if (!state.queue.length) return;
  if (state.isShuffled) {
    state.queueIndex = Math.floor(Math.random() * state.queue.length);
  } else {
    state.queueIndex = (state.queueIndex + 1) % state.queue.length;
  }
  state.activeSong = state.queue[state.queueIndex];
  playCurrent();
}

function prevSong() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  // If we are playing from userQueue, going back just restarts the song for simplicity.
  // To be fully accurate, we'd need a history stack.
  if (state.activeSong && !state.queue.some(s => s.id === state.activeSong.id && state.queue.indexOf(s) === state.queueIndex)) {
    audio.currentTime = 0;
    return;
  }
  if (!state.queue.length) return;
  state.queueIndex = (state.queueIndex - 1 + state.queue.length) % state.queue.length;
  state.activeSong = state.queue[state.queueIndex];
  playCurrent();
}

function addToQueue(song) {
  state.userQueue.push(song);
  renderQueue();
  toast('Added to queue');
}

audio.addEventListener('ended', () => {
  if (state.isRepeating) {
    audio.currentTime = 0;
    audio.play();
  } else {
    nextSong();
  }
});

audio.addEventListener('timeupdate', () => {
  if (!audio.duration) return;
  const pct = (audio.currentTime / audio.duration) * 100;
  $('np-progress').value = pct;
  $('np-current').textContent = formatDuration(Math.floor(audio.currentTime));
});

audio.addEventListener('loadedmetadata', () => {
  $('np-duration').textContent = formatDuration(Math.floor(audio.duration));
});

audio.addEventListener('play', () => { state.isPlaying = true; updatePlayButtons(); });
audio.addEventListener('pause', () => { state.isPlaying = false; updatePlayButtons(); });

$('np-progress').addEventListener('input', e => {
  if (audio.duration) audio.currentTime = (e.target.value / 100) * audio.duration;
});

// ── Controls ─────────────────────────────────────────────────────────────────
$('btn-play-np').addEventListener('click', togglePlay);
$('btn-play-mini').addEventListener('click', e => { e.stopPropagation(); togglePlay(); });
$('btn-next').addEventListener('click', nextSong);
$('btn-prev').addEventListener('click', prevSong);
$('btn-mini-next').addEventListener('click', e => { e.stopPropagation(); nextSong(); });

$('btn-shuffle').addEventListener('click', () => {
  state.isShuffled = !state.isShuffled;
  $('btn-shuffle').classList.toggle('active', state.isShuffled);
  toast(state.isShuffled ? 'Shuffle on' : 'Shuffle off');
});

$('btn-repeat').addEventListener('click', () => {
  state.isRepeating = !state.isRepeating;
  $('btn-repeat').classList.toggle('active', state.isRepeating);
  toast(state.isRepeating ? 'Repeat on' : 'Repeat off');
});

// ── UI Updates ────────────────────────────────────────────────────────────────
function updatePlayButtons() {
  const playing = state.isPlaying;
  $('icon-play-np').classList.toggle('hidden', playing);
  $('icon-pause-np').classList.toggle('hidden', !playing);
  $('icon-play-mini').classList.toggle('hidden', playing);
  $('icon-pause-mini').classList.toggle('hidden', !playing);
  if (navigator.mediaSession) {
    navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
  }
}

function updateNowPlayingUI() {
  const song = currentSong();
  if (!song) return;
  $('np-title').textContent = song.title;
  $('np-artist').textContent = song.artist || '—';
  const img = $('np-artwork-img');
  if (song.thumbnail) { img.src = song.thumbnail; img.style.display = ''; }
  else { img.src = ''; img.style.display = 'none'; }
  updatePlayButtons();
}

function updateMiniPlayer() {
  const song = currentSong();
  const mini = $('mini-player');
  if (!song) { mini.classList.add('hidden'); return; }
  mini.classList.remove('hidden');
  $('mini-title').textContent = song.title;
  $('mini-artist').textContent = song.artist || '—';
  const art = $('mini-artwork');
  if (song.thumbnail) {
    art.innerHTML = `<img src="${escHtml(song.thumbnail)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px" onerror="this.parentElement.textContent='♪'" />`;
  } else {
    art.textContent = '♪';
  }
  updatePlayButtons();
}

// ── MediaSession ──────────────────────────────────────────────────────────────
function setupMediaSession() {
  if (!('mediaSession' in navigator)) return;
  const song = currentSong();
  if (!song) return;
  navigator.mediaSession.metadata = new MediaMetadata({
    title: song.title,
    artist: song.artist || '',
    artwork: song.thumbnail ? [{ src: song.thumbnail, sizes: '512x512', type: 'image/jpeg' }] : [],
  });
  navigator.mediaSession.setActionHandler('play', () => { audio.play(); });
  navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); });
  navigator.mediaSession.setActionHandler('nexttrack', nextSong);
  navigator.mediaSession.setActionHandler('previoustrack', prevSong);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDuration(secs) {
  if (!secs || isNaN(secs)) return '—';
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function escHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function toast(msg) {
  document.querySelectorAll('.toast').forEach(t => t.remove());
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 2600);
}

// ── Service Worker ────────────────────────────────────────────────────────────
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/static/sw.js').catch(console.error);
}

// ── Init ──────────────────────────────────────────────────────────────────────
setGreeting();
loadRecommendations();
loadLibrary(); // Pre-load library in background so it's ready when user switches tabs
