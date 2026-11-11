/* VISR repo scope: html[data-scope] drives which .repo-content is visible (CSS in head.html). */
(function () {
  'use strict';
  var PARAM = 'repo', ALL = '__all__', root = document.documentElement;
  function esc(s) { return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/["\\]/g, '\\$&'); }
  function has(key) { return !!document.querySelector('.repo-content[data-repo="' + esc(key) + '"]'); }
  function anyBlocks() { return !!document.querySelector('.repo-content[data-repo]'); }
  function defaultKey() {
    var d = document.querySelector('.repo-content[data-default]') || document.querySelector('.repo-content[data-repo]');
    return d ? d.getAttribute('data-repo') : null;
  }
  function getSelectedRepo() { try { return new URLSearchParams(location.search).get(PARAM); } catch (e) { return null; } }
  function syncPicker(key) {
    document.querySelectorAll('#repo-picker-menu .repo-picker-item').forEach(function (li) {
      var k = li.dataset.owner && li.dataset.repo ? li.dataset.owner + '/' + li.dataset.repo : ALL;
      li.setAttribute('aria-selected', String(k === key));
    });
  }
  function syncNav(key) {
    document.querySelectorAll('.v-nav a[data-nav]').forEach(function (a) {
      var u = new URL(a.getAttribute('data-base'), location.href);
      if (key && key !== ALL) u.searchParams.set(PARAM, key);
      a.setAttribute('href', u.pathname + u.search);
    });
  }
  function apply(key, notify) {
    root.setAttribute('data-scope', key);
    syncPicker(key); syncNav(key);
    if (notify) document.dispatchEvent(new CustomEvent('visr:repochange', { detail: { repo: key } }));
  }
  function setSelectedRepo(owner, repo) {
    var key = (!owner && !repo) ? ALL : owner + '/' + repo;
    if (anyBlocks() && !has(key)) {                    // not pre-rendered on this page
      var brand = document.querySelector('.v-brand');
      var u = new URL(key === ALL ? (brand ? brand.href : '/') : location.href);
      if (key !== ALL) u.searchParams.set(PARAM, key);
      location.href = u.toString();
      return;
    }
    var url = new URL(location.href);
    if (key === ALL) url.searchParams.delete(PARAM); else url.searchParams.set(PARAM, key);
    history.pushState({ repo: key }, '', url.toString());
    apply(key, true);
    window.scrollTo(0, 0);
  }
  document.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target.closest('#repo-picker-menu a[href], a[data-repo-switch]');
    if (!a) return;
    var li = a.closest('.repo-picker-item'), key;
    if (li) key = li.dataset.owner && li.dataset.repo ? li.dataset.owner + '/' + li.dataset.repo : ALL;
    else { try { key = new URL(a.href).searchParams.get(PARAM); } catch (err) { key = null; } }
    if (!key) return;
    e.preventDefault();
    if (document.activeElement) document.activeElement.blur();   // closes the daisy dropdown
    var parts = key === ALL ? ['', ''] : key.split('/');
    setSelectedRepo(parts[0], parts[1]);
  });
  window.addEventListener('popstate', function (e) {
    var key = (e.state && e.state.repo) || getSelectedRepo() || defaultKey();
    if (key) apply(key, true);
  });
  function init() {
    var key = root.getAttribute('data-scope') || getSelectedRepo() || defaultKey();
    if (anyBlocks() && !has(key)) key = defaultKey();
    if (key) apply(key, false);
  }
  window.RepoPicker = { getSelectedRepo: getSelectedRepo, setSelectedRepo: setSelectedRepo, showRepoContent: function (k) { apply(k, true); } };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
