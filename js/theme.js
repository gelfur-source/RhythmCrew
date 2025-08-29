document.addEventListener('DOMContentLoaded', () => {
    // Cache DOM elements once for better performance
    const themeToggle = document.getElementById('theme-toggle');
    const themeToggleQueue = document.getElementById('theme-toggle-queue');
    const body = document.body;

    // Cache icon elements and store references to avoid repeated DOM queries
    const iconElements = [];
    if (themeToggle) {
        const icon = themeToggle.querySelector('i');
        if (icon) iconElements.push(icon);
    }
    if (themeToggleQueue) {
        const icon = themeToggleQueue.querySelector('i');
        if (icon) iconElements.push(icon);
    }

    // Optimized icon update function - batch updates and defer feather.replace()
    function updateIcons(isDarkMode) {
        const iconType = isDarkMode ? 'sun' : 'moon';

        // Batch DOM updates for better performance
        iconElements.forEach(icon => {
            icon.setAttribute('data-feather', iconType);
        });

        // Defer feather.replace() to avoid multiple calls - use requestAnimationFrame for better performance
        if (window.featherReplaceTimeout) {
            clearTimeout(window.featherReplaceTimeout);
        }
        window.featherReplaceTimeout = setTimeout(() => {
            feather.replace();
            window.featherReplaceTimeout = null;
        }, 16); // ~60fps
    }

    // Optimized theme toggle function with reduced transitions
    function toggleTheme() {
        // Temporarily disable transitions for instant toggle
        body.style.transition = 'none';

        const isDarkMode = body.classList.toggle('dark-mode');
        localStorage.setItem('dark-mode', isDarkMode);
        updateIcons(isDarkMode);

        // Re-enable transitions after a brief delay
        requestAnimationFrame(() => {
            body.style.transition = '';
        });
    }

    // Optimized initialization with reduced DOM operations
    function initializeTheme() {
        const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        const savedTheme = localStorage.getItem('dark-mode');
        const shouldUseDark = savedTheme === 'true' || (savedTheme === null && prefersDark);

        if (shouldUseDark) {
            body.classList.add('dark-mode');
        }

        updateIcons(shouldUseDark);

        // Add event listeners only if elements exist
        if (themeToggle) {
            themeToggle.addEventListener('click', toggleTheme);
        }
        if (themeToggleQueue) {
            themeToggleQueue.addEventListener('click', toggleTheme);
        }
    }

    // Initialize theme with optimized performance
    initializeTheme();
});