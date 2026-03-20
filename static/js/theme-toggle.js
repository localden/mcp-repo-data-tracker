/**
 * Theme Toggle - switches between light and dark daisyUI themes.
 * Preference persisted in localStorage; initial theme applied by inline
 * script in <head> to avoid FOUC.
 */
(function() {
  'use strict';

  var STORAGE_KEY = 'theme';

  function currentTheme() {
    return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    var darkIcon = document.querySelector('.theme-icon-dark');
    var lightIcon = document.querySelector('.theme-icon-light');
    if (darkIcon && lightIcon) {
      if (theme === 'dark') {
        darkIcon.classList.add('hidden');
        lightIcon.classList.remove('hidden');
      } else {
        lightIcon.classList.add('hidden');
        darkIcon.classList.remove('hidden');
      }
    }
  }

  function toggleTheme() {
    var next = currentTheme() === 'dark' ? 'light' : 'dark';
    localStorage.setItem(STORAGE_KEY, next);
    applyTheme(next);
  }

  function init() {
    applyTheme(currentTheme());
    var btn = document.getElementById('theme-toggle');
    if (btn) btn.addEventListener('click', toggleTheme);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
