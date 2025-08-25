// js/state.js

// --- App Mode ---
export let isAdmin = false;

// --- Song Data ---
export let allSongs = [];
export let displayedSongs = [];
export let shuffledDeck = [];
export let genreFilterData = [];
export let avatars = []; // To hold the list of all possible avatars

// --- Real-time Queue ---
export let currentRequests = [];

// --- User Preferences (with localStorage persistence) ---
export const hiddenSongs = new Set(JSON.parse(localStorage.getItem('songHidden')) || []);
export const favorites = new Set(JSON.parse(localStorage.getItem('songFavorites')) || []);
export let userAvatar = '';

// --- UI State ---
export const activeGenres = new Set();
export let mainListSort = {
    primary: { field: null, direction: 'desc' },
    secondary: { field: 'Artist', direction: 'asc' }
};
export let upNextTimeSort = localStorage.getItem('upNextTimeSort') || 'least-recent';
export let upNextFavoritesTop = JSON.parse(localStorage.getItem('upNextFavoritesTop')) || false;

// --- State Modifiers ---
export function setAdmin(status) {
    isAdmin = status;
}
export function setAllSongs(songs) {
    allSongs = songs;
}
export function setDisplayedSongs(songs) {
    displayedSongs = songs;
}
export function setShuffledDeck(deck) {
    shuffledDeck = deck;
}
export function setGenreFilterData(data) {
    genreFilterData = data;
}
export function setAvatars(avatarList) {
    avatars = avatarList;
}
export function setCurrentRequests(requests) {
    currentRequests = requests;
}
export function setUserAvatar(avatar) {
    userAvatar = avatar;
}
export function setMainListSort(newSort) {
    mainListSort = { ...mainListSort, ...newSort };
}
export function setUpNextTimeSort(sort) {
    upNextTimeSort = sort;
    localStorage.setItem('upNextTimeSort', sort);
}
export function setUpNextFavoritesTop(isTop) {
    upNextFavoritesTop = isTop;
    localStorage.setItem('upNextFavoritesTop', JSON.stringify(isTop));
}

// --- Persistence Helpers ---
export function saveFavorites() {
    localStorage.setItem('songFavorites', JSON.stringify(Array.from(favorites)));
}
export function saveHiddenSongs() {
    localStorage.setItem('songHidden', JSON.stringify(Array.from(hiddenSongs)));
}