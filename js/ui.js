document.addEventListener('DOMContentLoaded', () => {
    // Collapsible "Up Next" section
    const upNextToggle = document.getElementById('up-next-toggle');
    const upNextContent = document.getElementById('up-next-content');
    const chevronIcon = upNextToggle?.querySelector('.chevron-icon');

    // Set initial state for chevron icon (expanded by default)
    if (chevronIcon && upNextContent && upNextContent.classList.contains('expanded')) {
        chevronIcon.classList.add('rotated');
    }

    if (upNextToggle && upNextContent) {
        upNextToggle.addEventListener('click', () => {
            const isCollapsed = upNextContent.classList.contains('collapsed');

            if (isCollapsed) {
                upNextContent.classList.remove('collapsed');
                upNextContent.classList.add('expanded');
                if (chevronIcon) chevronIcon.classList.add('rotated');
            } else {
                upNextContent.classList.remove('expanded');
                upNextContent.classList.add('collapsed');
                if (chevronIcon) chevronIcon.classList.remove('rotated');
            }
        });
    }

    // Debounced search functionality
    const searchInput = document.querySelector('.search-bar input');
    let searchTimeout;

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            const query = e.target.value.toLowerCase();
            filterSongs(query);
        }, 300); // 300ms delay
    });

    // Genre filter selection logic
    const genreFilters = document.querySelectorAll('.genre-filters button');
    const allFilter = document.getElementById('filter-all');

    // Set "All" as active by default
    allFilter.classList.add('active');

    genreFilters.forEach(button => {
        button.addEventListener('click', () => {
            const isAllButton = button.id === 'filter-all';

            if (isAllButton) {
                // If "All" is clicked, activate only "All" and deactivate others
                genreFilters.forEach(btn => btn.classList.remove('active'));
                button.classList.add('active');
            } else {
                // If any other filter is clicked, deactivate "All" and toggle the clicked filter
                allFilter.classList.remove('active');
                button.classList.toggle('active');

                // If no filters are active, activate "All"
                const activeFilters = document.querySelectorAll('.genre-filters button.active');
                if (activeFilters.length === 0) {
                    allFilter.classList.add('active');
                }
            }

            // Update global filter state and re-render
            const activeGenreButtons = document.querySelectorAll('.genre-filters button.active');
            currentActiveGenres = Array.from(activeGenreButtons).map(btn => btn.textContent.toLowerCase());

            // Reset pagination and re-render
            currentPage = 0;
            isLoadingMore = false;
            hasMoreSongs = true;

            renderSongs();
        });
    });
});

function filterSongs(query) {
    const activeGenreButtons = document.querySelectorAll('.genre-filters button.active');
    const activeGenres = Array.from(activeGenreButtons).map(btn => btn.textContent.toLowerCase());

    // Update global filter state
    currentSearchQuery = query.toLowerCase();
    currentActiveGenres = activeGenres;

    // Reset pagination and re-render
    currentPage = 0;
    isLoadingMore = false;
    hasMoreSongs = true;

    renderSongs();
}