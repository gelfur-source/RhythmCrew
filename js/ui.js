// js/ui.js
import * as state from './state.js';

// --- DOM Element References ---
export const elements = {
    songList: {
        container: document.getElementById("songListContainer"),
        table: document.getElementById("songTable"),
        tableBody: document.querySelector("#songTable tbody"),
        tableHead: document.querySelector("#songTable thead"),
        searchBox: document.getElementById("searchBox"),
        sortButtons: document.getElementById("mainSortButtons"),
        genreFilterContainer: document.getElementById("genreFilterContainer"),
        songCount: document.getElementById("songCount"),
        unhideBtn: document.getElementById("unhideBtn"),
        addFavoritesBtn: document.getElementById("addFavoritesBtn")
    },
    upNext: {
        list: document.getElementById("upNextList"),
        timeSortButtons: document.getElementById("upNextTimeSortButtons"),
        favSortButton: document.getElementById("upNextFavoriteSortButton")?.querySelector('button'), // FIX: Added optional chaining
        songCount: document.getElementById("songCountUpNext"),
        clearFavs: document.getElementById("clearFavoritesBtn"),
        clearRandom: document.getElementById("clearRandomBtn"),
        clearAll: document.getElementById("clearAllBtn")
    },
    global: {
        toast: document.getElementById("toast"),
        backToTopBtn: document.getElementById("backToTopBtn"),
        tooltip: document.getElementById("songTooltip")
    },
    modals: {
        avatar: document.getElementById('avatarModal'),
        avatarGrid: document.getElementById('avatarGrid'),
        clearUser: document.getElementById('clearUserModal'),
        clearUserGrid: document.getElementById('clearUserGrid'),
    },
    debug: {
        panel: document.getElementById('debugPanel'),
        log: document.getElementById('debugLog'),
        copyButton: document.getElementById('copyDebugLog')
    }
};

/**
 * Renders placeholder skeletons before the main content has loaded.
 */
export function renderSkeletons() {
    const skeletonCardHTML = `
        <div class="skeleton-card">
            <div>
                <div class="skeleton skeleton-title"></div>
                <div class="skeleton skeleton-artist"></div>
            </div>
            <div class="actions-group skeleton-actions">
                <div class="skeleton"></div>
                <div class="skeleton"></div>
            </div>
        </div>
    `;
    const skeletonRowHTML = `
        <tr>
            <td><div class="actions-group skeleton-actions"><div class="skeleton"></div><div class="skeleton"></div></div></td>
            <td><div class="skeleton skeleton-artist" style="height:16px"></div></td>
            <td><div class="skeleton skeleton-title" style="height:16px"></div></td>
        </tr>
    `;
    
    const cardSkeletons = Array(10).fill(skeletonCardHTML).join('');
    const rowSkeletons = Array(10).fill(skeletonRowHTML).join('');
    
    elements.songList.container.innerHTML = cardSkeletons;
    elements.songList.tableBody.innerHTML = rowSkeletons;
}


// --- Rendering Functions ---
function updateSortIndicators() {
    const header = elements.songList.tableHead;
    if (!header) return;

    header.querySelectorAll('[data-sort-primary]').forEach(btn => {
        btn.classList.remove('active', 'sort-asc', 'sort-desc');
        if (btn.dataset.sortPrimary === state.mainListSort.primary.field) {
            btn.classList.add('active', `sort-${state.mainListSort.primary.direction}`);
        }
    });
    header.querySelectorAll('th[data-sort-field]').forEach(th => {
        th.classList.remove('sort-asc', 'sort-desc');
        if (th.dataset.sortField === state.mainListSort.secondary.field) {
            th.classList.add(`sort-${state.mainListSort.secondary.direction}`);
        }
    });
}

export function renderSongList() {
    const requestedSongs = new Map(state.currentRequests.map(s => [s.Name, s]));
    const hideIconSVG = `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width: 1em; height: 1em; vertical-align: middle;"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.526 13.526 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>`;

    const createCardHTML = song => {
        const isRequested = requestedSongs.has(song.Name);
        const isFavorited = state.favorites.has(song.Name);
        const canHide = !isRequested && !isFavorited;
        const requestedSong = requestedSongs.get(song.Name);
        const canUnrequest = isRequested && (requestedSong.isRandom || requestedSong.userAvatar === state.userAvatar);

        const hideButtonHTML = (artist, songName) => canHide ?
            `<button class="hide-btn" data-artist-name="${artist || ''}" data-song-name-hide="${songName || ''}" title="Hide ${artist || songName}">${hideIconSVG}</button>` : '';

        return `<div class="song-card ${isRequested ? 'is-in-queue' : ''}" data-song-name="${song.Name}">
            <div class="song-info">
                <span class="title">${song.Name} ${hideButtonHTML(null, song.Name)}</span>
                <span class="artist">${song.Artist} ${hideButtonHTML(song.Artist, null)}</span>
            </div>
            <div class="actions-group">
                <button class="favorite-btn ${isFavorited ? 'favorited' : ''}" title="Favorite">☆</button>
                <button class="request-btn ${isRequested ? 'requested' : ''}" title="Request" ${isRequested && !canUnrequest ? 'disabled' : ''}>${isRequested ? '×' : '+'}</button>
            </div></div>`;
    };

    const createTableRowHTML = song => {
        const isRequested = requestedSongs.has(song.Name);
        const isFavorited = state.favorites.has(song.Name);
        const canHide = !isRequested && !isFavorited;
        const requestedSong = requestedSongs.get(song.Name);
        const canUnrequest = isRequested && (requestedSong.isRandom || requestedSong.userAvatar === state.userAvatar);

        const hideButtonHTML = (artist, songName) => canHide ?
            `<button class="hide-btn" data-artist-name="${artist || ''}" data-song-name-hide="${songName || ''}" title="Hide ${artist || songName}">${hideIconSVG}</button>` : '';

        return `<tr class="${isRequested ? 'is-in-queue' : ''}" data-song-name="${song.Name}">
            <td class="actions-group">
                <button class="favorite-btn ${isFavorited ? 'favorited' : ''}" title="Favorite">☆</button>
                <button class="request-btn ${isRequested ? 'requested' : ''}" title="Request" ${isRequested && !canUnrequest ? 'disabled' : ''}>${isRequested ? '×' : '+'}</button>
            </td>
            <td>${song.Artist} ${hideButtonHTML(song.Artist, null)}</td>
            <td>${song.Name} ${hideButtonHTML(null, song.Name)}</td></tr>`;
    };
    elements.songList.container.innerHTML = state.displayedSongs.map(createCardHTML).join('');
    elements.songList.tableBody.innerHTML = state.displayedSongs.map(createTableRowHTML).join('');
    updateSortIndicators();
    updateVisibleSongCount();
}

export function renderRequests() {
    const sorted = [...state.currentRequests].sort((a, b) => {
        if (state.upNextFavoritesTop) {
            const aIsFav = state.favorites.has(a.Name);
            const bIsFav = state.favorites.has(b.Name);
            if (aIsFav && !bIsFav) return -1;
            if (!aIsFav && bIsFav) return 1;
        }
        const dateA = new Date(a.timestamp);
        const dateB = new Date(b.timestamp);
        return state.upNextTimeSort === 'least-recent' ? dateA - dateB : dateB - dateA;
    });

    elements.upNext.list.innerHTML = sorted.length === 0 ? '<li>Queue is empty.</li>' : sorted.map((req, index) => {
        const isNowPlaying = index === 0;
        const isFavorited = state.favorites.has(req.Name);
        const canUnrequest = req.isRandom || req.userAvatar === state.userAvatar || state.isAdmin;
        return `
            <li data-song-name="${req.Name}" class="${isNowPlaying ? 'now-playing' : ''}">
                <div class="queue-item-main">
                    ${isNowPlaying ? '<span class="now-playing-tag">▶ Now Playing</span>' : `<span class="queue-number">${index + 1}.</span>`}
                    <div class="queue-info">
                        <span class="request-avatar">${req.userAvatar || '👤'}</span><strong>${req.Name}</strong> by ${req.Artist}
                    </div>
                </div>
                <div class="actions-group">
                    <div class="admin-only admin-queue-actions">
                        <button class="admin-action-top" title="Move to Top">▲</button>
                        <button class="admin-action-remove" title="Force Remove">✖</button>
                    </div>
                    <button class="favorite-btn ${isFavorited ? 'favorited' : ''}" title="Favorite">☆</button>
                    <div class="queue-tags">
                        ${req.isRandom ? '<span class="tag random-tag">Random</span>' : ''}
                    </div>
                    <button class="unrequest-btn" title="Remove from queue" ${!canUnrequest ? 'disabled' : ''}>×</button>
                </div>
                ${isNowPlaying ? '<div class="progress-bar-container"><div class="progress-bar"></div></div>' : ''}
            </li>`;
    }).join('');
}

export function updateButtonCounts() {
    const formatCount = (baseText, count) => `${baseText} ${count > 0 ? `(${count})` : ''}`.trim();
    elements.songList.unhideBtn.textContent = formatCount('Unhide', state.hiddenSongs.size);
    elements.songList.addFavoritesBtn.textContent = formatCount('Request Favorites', state.favorites.size);
    elements.upNext.clearAll.textContent = formatCount('Clear All', state.currentRequests.length);
    const randomCount = state.currentRequests.filter(r => r.isRandom).length;
    elements.upNext.clearRandom.textContent = formatCount('Clear Random', randomCount);
    const favInQueueCount = state.currentRequests.filter(r => state.favorites.has(r.Name)).length;
    elements.upNext.clearFavs.textContent = formatCount('Clear Favorites', favInQueueCount);
    elements.upNext.songCount.textContent = `${state.currentRequests.length} songs requested`;
}

export function updateVisibleSongCount() {
    const count = state.displayedSongs.length;
    const total = state.allSongs.length;
    elements.songList.songCount.textContent = `${count} of ${total} songs shown`;
}

export function renderGenreFilters() {
    const html = state.genreFilterData.map(genre => `
        <div class="filter-btn-group-wrapper">
            <div class="filter-btn-group">
                <button class="filter-btn ${state.activeGenres.has(genre.name) ? 'active' : ''}" data-genre="${genre.name}">
                    ${genre.name} (${genre.count})
                </button>
                ${genre.subGenres.length > 0 ? `
                    <button class="sub-genre-toggle" data-parent-genre="${genre.name}">▾</button>
                ` : ''}
            </div>
            ${genre.subGenres.length > 0 ? `
                <div class="sub-genre-container" id="sub-genres-${genre.name.replace(/\s+/g, '-')}">
                    ${genre.subGenres.map(sub => `
                        <button class="sub-filter-btn ${state.activeGenres.has(sub.name) ? 'active' : ''}" data-genre="${sub.name}">
                            ${sub.name} (${sub.count})
                        </button>
                    `).join('')}
                </div>
            ` : ''}
        </div>
    `).join('');
    elements.songList.genreFilterContainer.innerHTML = html;
}

// --- Modal UI Functions ---
export function showAvatarModal() {
    const activeAvatars = new Set(state.currentRequests.map(r => r.userAvatar));
    const availableAvatars = state.avatars.filter(a => !activeAvatars.has(a) || a === state.userAvatar);
    elements.modals.avatarGrid.innerHTML = availableAvatars.map(a => `<div class="avatar-option">${a}</div>`).join('');
    elements.modals.avatar.style.display = 'flex';
}
export function hideAvatarModal() {
    elements.modals.avatar.style.display = 'none';
}
export function showClearUserModal() {
    const activeUsers = [...new Set(state.currentRequests.filter(r => !r.isRandom && r.userAvatar).map(r => r.userAvatar))];
    if(activeUsers.length === 0) {
        showToast("No user-requested songs in the queue to clear.");
        return;
    }
    elements.modals.clearUserGrid.innerHTML = activeUsers.map(a => `<div class="avatar-option">${a}</div>`).join('');
    elements.modals.clearUser.style.display = 'flex';
}
export function hideClearUserModal() {
    elements.modals.clearUser.style.display = 'none';
}

// --- UI Feedback & Utilities ---
export function showToast(message) {
    elements.global.toast.textContent = message;
    elements.global.toast.className = "toast show";
    setTimeout(() => elements.global.toast.className = elements.global.toast.className.replace("show", ""), 2500);
}

export function openTab(evt) {
    const tabName = evt.currentTarget.dataset.tab;
    document.querySelectorAll('.tab-content, .tab-button').forEach(el => el.classList.remove('active'));
    document.querySelector(`.tab-button[data-tab="${tabName}"]`).classList.add('active');
    document.getElementById(tabName).classList.add('active');
    localStorage.setItem('lastActiveTab', tabName);
}

// --- Tooltip Management ---
let tooltipTimer;

function updateTooltipPos(e) {
    const x = e.touches ? e.touches[0].pageX : e.pageX;
    const y = e.touches ? e.touches[0].pageY : e.pageY;
    elements.global.tooltip.style.left = `${x + 15}px`;
    elements.global.tooltip.style.top = `${y + 15}px`;
}

export function showSongTooltip(song, e) {
    if (!song) return;
    elements.global.tooltip.innerHTML = `<strong>Title:</strong> ${song.Name}<br><strong>Artist:</strong> ${song.Artist}<br><strong>Album:</strong> ${song.Album||'N/A'}<br><strong>Year:</strong> ${song.Year||'N/A'}<br><strong>Genre:</strong> ${song.subGenre||'N/A'}`;
    elements.global.tooltip.style.display = 'block';
    updateTooltipPos(e);
}

export function hideSongTooltip() {
    clearTimeout(tooltipTimer);
    elements.global.tooltip.style.display = 'none';
}

export function startTooltipTimer(song, event) {
    tooltipTimer = setTimeout(() => showSongTooltip(song, event), 300);
}

export function trackTooltipPosition(event) {
    if (elements.global.tooltip.style.display === 'block') {
        updateTooltipPos(event);
    }
}

// --- Debug Panel ---
export function logToDebugPanel(level, ...args) {
    if (!state.isAdmin) return;
    const logEntry = document.createElement('div');
    const timestamp = new Date().toLocaleTimeString();
    const message = args.map(arg => typeof arg === 'object' ? JSON.stringify(arg) : arg).join(' ');
    
    logEntry.textContent = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
    elements.debug.log.appendChild(logEntry);
    elements.debug.log.scrollTop = elements.debug.log.scrollHeight;
}