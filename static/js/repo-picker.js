/**
 * Repo Picker - Dropdown for switching between repositories
 * Uses URL query parameter (?repo=owner/repo) for state management
 * Switches content without page reload when pre-rendered content exists
 * Works with DaisyUI dropdown component
 */
(function() {
  'use strict';

  const REPO_PARAM = 'repo';
  const ALL_REPOS_KEY = '__all__';

  // Get repo from URL query parameter
  function getSelectedRepo() {
    const params = new URLSearchParams(window.location.search);
    return params.get(REPO_PARAM);
  }

  // Get the default repo key. Prefers the all-repos summary if present on the page,
  // otherwise falls back to the first per-repo content block.
  function getDefaultRepo() {
    if (document.querySelector(`.repo-content[data-repo="${ALL_REPOS_KEY}"]`)) {
      return ALL_REPOS_KEY;
    }
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
    const isAll = !owner && !repo;
    const repoKey = isAll ? ALL_REPOS_KEY : `${owner}/${repo}`;

    // Update URL without reload
    const url = new URL(window.location.href);
    if (isAll) {
      url.searchParams.delete(REPO_PARAM);
    } else {
      url.searchParams.set(REPO_PARAM, repoKey);
    }
    window.history.pushState({ repo: repoKey }, '', url.toString());

    // Try to show pre-rendered content
    const contentShown = showRepoContent(repoKey);

    // Update picker UI
    updatePickerUI(repoKey);

    // If content wasn't found, navigate appropriately
    if (!contentShown) {
      if (isAll) {
        // All-repos summary only exists on home page
        const homeLink = document.querySelector('.navbar-start a[href]');
        window.location.href = homeLink ? homeLink.href : '/';
      } else {
        window.location.reload();
      }
    }
  }

  // Update the picker dropdown UI to reflect selection
  function updatePickerUI(repoKey) {
    const menu = document.getElementById('repo-picker-menu');
    const label = document.getElementById('repo-picker-label');
    if (!menu || !label) return;

    const items = menu.querySelectorAll('.repo-picker-item');
    items.forEach(item => {
      const owner = item.dataset.owner;
      const repo = item.dataset.repo;
      const itemKey = (!owner && !repo) ? ALL_REPOS_KEY : `${owner}/${repo}`;
      const anchor = item.querySelector('a');
      if (itemKey === repoKey) {
        item.classList.add('selected');
        item.setAttribute('aria-selected', 'true');
        if (anchor) anchor.classList.add('active');
        label.textContent = item.dataset.name;
      } else {
        item.classList.remove('selected');
        item.setAttribute('aria-selected', 'false');
        if (anchor) anchor.classList.remove('active');
      }
    });

    // Show/hide SEPs nav link based on selected repo
    updateSEPsNavVisibility(repoKey);
  }

  // Show SEPs nav link only for modelcontextprotocol/modelcontextprotocol
  function updateSEPsNavVisibility(repoKey) {
    const sepsLink = document.getElementById('seps-nav-link');
    if (sepsLink) {
      if (repoKey === 'modelcontextprotocol/modelcontextprotocol') {
        sepsLink.style.display = '';
      } else {
        sepsLink.style.display = 'none';
      }
    }
  }

  // Close DaisyUI dropdown by blurring the active element
  function closeDropdown() {
    document.activeElement?.blur();
  }

  // Initialize the picker
  function initRepoPicker() {
    const dropdown = document.getElementById('repo-picker');
    const menu = document.getElementById('repo-picker-menu');

    if (!dropdown || !menu) return;

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

    // Handle item selection
    items.forEach(item => {
      const anchor = item.querySelector('a');
      if (anchor) {
        anchor.addEventListener('click', function(e) {
          e.preventDefault();
          const owner = item.dataset.owner;
          const repo = item.dataset.repo;
          closeDropdown();
          setSelectedRepo(owner, repo);
        });
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
  }

  // Export for use in other scripts
  window.RepoPicker = {
    getSelectedRepo: getSelectedRepo,
    setSelectedRepo: setSelectedRepo,
    showRepoContent: showRepoContent
  };

  // Preserve repo param when clicking navigation links
  function initNavLinkPreservation() {
    const navLinks = document.querySelectorAll('nav a[href]');
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
