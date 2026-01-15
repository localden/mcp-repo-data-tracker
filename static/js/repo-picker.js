/**
 * Repo Picker - Dropdown for switching between repositories
 * Uses URL query parameter (?repo=owner/repo) for state management
 * Switches content without page reload when pre-rendered content exists
 */
(function() {
  'use strict';

  const REPO_PARAM = 'repo';

  // Get repo from URL query parameter
  function getSelectedRepo() {
    const params = new URLSearchParams(window.location.search);
    return params.get(REPO_PARAM);
  }

  // Get the first available repo key from the page
  function getDefaultRepo() {
    const firstContent = document.querySelector('.repo-content[data-repo]');
    return firstContent ? firstContent.dataset.repo : null;
  }

  // Show content for selected repo, hide others
  function showRepoContent(repoKey) {
    const allContent = document.querySelectorAll('.repo-content[data-repo]');
    if (allContent.length === 0) return false;

    let found = false;
    allContent.forEach(content => {
      if (content.dataset.repo === repoKey) {
        content.style.display = '';
        found = true;
      } else {
        content.style.display = 'none';
      }
    });

    return found;
  }

  // Set repo in URL and switch content (or reload if content not pre-rendered)
  function setSelectedRepo(owner, repo) {
    const repoKey = `${owner}/${repo}`;

    // Update URL without reload
    const url = new URL(window.location.href);
    url.searchParams.set(REPO_PARAM, repoKey);
    window.history.pushState({ repo: repoKey }, '', url.toString());

    // Try to show pre-rendered content
    const contentShown = showRepoContent(repoKey);

    // Update picker UI
    updatePickerUI(repoKey);

    // If content wasn't found, reload the page
    if (!contentShown) {
      window.location.reload();
    }
  }

  // Update the picker dropdown UI to reflect selection
  function updatePickerUI(repoKey) {
    const menu = document.getElementById('repo-picker-menu');
    const label = document.getElementById('repo-picker-label');
    if (!menu || !label) return;

    const items = menu.querySelectorAll('.repo-picker-item');
    items.forEach(item => {
      const itemKey = `${item.dataset.owner}/${item.dataset.repo}`;
      if (itemKey === repoKey) {
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
        label.textContent = item.dataset.name;
      } else {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
      }
    });
  }

  // Initialize the picker
  function initRepoPicker() {
    const trigger = document.getElementById('repo-picker-trigger');
    const menu = document.getElementById('repo-picker-menu');
    const label = document.getElementById('repo-picker-label');

    if (!trigger || !menu) return;

    const items = menu.querySelectorAll('.repo-picker-item');
    const selectedRepo = getSelectedRepo() || getDefaultRepo();

    // Set initial selection and show correct content
    if (selectedRepo) {
      showRepoContent(selectedRepo);
      updatePickerUI(selectedRepo);
    } else if (items.length > 0) {
      // Default to first item
      const firstItem = items[0];
      const repoKey = `${firstItem.dataset.owner}/${firstItem.dataset.repo}`;
      showRepoContent(repoKey);
      updatePickerUI(repoKey);
    }

    // Toggle menu
    trigger.addEventListener('click', function(e) {
      e.stopPropagation();
      const isOpen = menu.classList.contains('open');
      if (isOpen) {
        closeMenu();
      } else {
        openMenu();
      }
    });

    // Handle item selection
    items.forEach(item => {
      item.addEventListener('click', function() {
        const owner = this.dataset.owner;
        const repo = this.dataset.repo;
        closeMenu();
        setSelectedRepo(owner, repo);
      });
    });

    // Close on outside click
    document.addEventListener('click', function(e) {
      if (!trigger.contains(e.target) && !menu.contains(e.target)) {
        closeMenu();
      }
    });

    // Keyboard navigation
    trigger.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        trigger.click();
      } else if (e.key === 'Escape') {
        closeMenu();
      }
    });

    menu.addEventListener('keydown', function(e) {
      const focusedItem = document.activeElement;
      const itemArray = Array.from(items);
      const currentIndex = itemArray.indexOf(focusedItem);

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        const nextIndex = Math.min(currentIndex + 1, items.length - 1);
        itemArray[nextIndex].focus();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        const prevIndex = Math.max(currentIndex - 1, 0);
        itemArray[prevIndex].focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedItem.classList.contains('repo-picker-item')) {
          focusedItem.click();
        }
      } else if (e.key === 'Escape') {
        closeMenu();
        trigger.focus();
      }
    });

    // Handle browser back/forward
    window.addEventListener('popstate', function(e) {
      const repoKey = e.state?.repo || getSelectedRepo() || getDefaultRepo();
      if (repoKey) {
        showRepoContent(repoKey);
        updatePickerUI(repoKey);
      }
    });

    function openMenu() {
      menu.classList.add('open');
      trigger.setAttribute('aria-expanded', 'true');
      // Focus selected or first item
      const selected = menu.querySelector('.repo-picker-item.selected') || items[0];
      if (selected) selected.focus();
    }

    function closeMenu() {
      menu.classList.remove('open');
      trigger.setAttribute('aria-expanded', 'false');
    }
  }

  // Export for use in other scripts
  window.RepoPicker = {
    getSelectedRepo: getSelectedRepo,
    setSelectedRepo: setSelectedRepo,
    showRepoContent: showRepoContent
  };

  // Preserve repo param when clicking navigation links
  function initNavLinkPreservation() {
    const navLinks = document.querySelectorAll('.site-nav a, .site-title');
    navLinks.forEach(link => {
      link.addEventListener('click', function(e) {
        const repoParam = new URLSearchParams(window.location.search).get(REPO_PARAM);
        if (repoParam) {
          e.preventDefault();
          const url = new URL(this.href);
          url.searchParams.set(REPO_PARAM, repoParam);
          window.location.href = url.toString();
        }
      });
    });
  }

  // Initialize on DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initRepoPicker();
      initNavLinkPreservation();
    });
  } else {
    initRepoPicker();
    initNavLinkPreservation();
  }
})();
