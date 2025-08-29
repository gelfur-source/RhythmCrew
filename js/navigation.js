document.addEventListener('DOMContentLoaded', () => {
    const queueView = document.getElementById('queue-view');
    const searchView = document.getElementById('search-view');
    const searchNav = document.getElementById('search-nav');
    const queueNav = document.getElementById('queue-nav');
    const songList = document.getElementById('song-list');
    const searchStickyHeader = document.getElementById('search-sticky-header');

    function showView(viewToShow) {
        const genreFilters = document.querySelector('.genre-filters-container');
        const instrumentFilters = document.querySelector('.instrument-filters-container');
        const searchBar = document.querySelector('.search-bar');

        if (viewToShow === 'queue') {
            // Hide song list, show queue view
            songList.style.display = 'none';
            searchStickyHeader.style.display = 'block'; // Keep sticky header visible but hide components
            queueView.classList.add('active');
            searchView.classList.remove('active');
            queueNav.classList.add('active');
            searchNav.classList.remove('active');

            // Hide search and filter components on Queue tab
            if (searchBar) searchBar.style.display = 'none';
            if (genreFilters) genreFilters.style.display = 'none';
            if (instrumentFilters) instrumentFilters.style.display = 'none';
        } else if (viewToShow === 'search') {
            // Show song list and search view with all components
            songList.style.display = 'block';
            searchStickyHeader.style.display = 'block';
            searchView.classList.add('active');
            queueView.classList.remove('active');
            searchNav.classList.add('active');
            queueNav.classList.remove('active');

            // Show search and filter components on Search tab
            if (searchBar) searchBar.style.display = 'block';
            if (genreFilters) genreFilters.style.display = 'block';
            if (instrumentFilters) instrumentFilters.style.display = 'block';

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