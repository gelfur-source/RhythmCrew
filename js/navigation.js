document.addEventListener('DOMContentLoaded', () => {
    const queueView = document.getElementById('queue-view');
    const searchView = document.getElementById('search-view');
    const searchNav = document.getElementById('search-nav');
    const queueNav = document.getElementById('queue-nav');
    const songList = document.getElementById('song-list');
    const searchStickyHeader = document.getElementById('search-sticky-header');

    function showView(viewToShow) {
        if (viewToShow === 'queue') {
            // Hide song list, show queue view (keep sticky elements visible)
            songList.style.display = 'none';
            searchStickyHeader.style.display = 'block'; // Keep sticky header visible for consistency
            queueView.classList.add('active');
            searchView.classList.remove('active');
            queueNav.classList.add('active');
            searchNav.classList.remove('active');
        } else if (viewToShow === 'search') {
            // Show song list and search view
            songList.style.display = 'block';
            searchStickyHeader.style.display = 'block';
            searchView.classList.add('active');
            queueView.classList.remove('active');
            searchNav.classList.add('active');
            queueNav.classList.remove('active');

            // Reset pagination when switching to search view
            if (typeof currentPage !== 'undefined') {
                currentPage = 0;
                isLoadingMore = false;
                hasMoreSongs = true;
            }
        }
    }

    if (searchNav) {
        searchNav.addEventListener('click', () => showView('search'));
    }
    if (queueNav) {
        queueNav.addEventListener('click', () => showView('queue'));
    }

    // Default to search view on load
    showView('search');
});