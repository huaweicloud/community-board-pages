/* Community Board - app shell: data loader + hash router. */
(function () {
  'use strict';

  const DATA_FILES = {
    board: 'data/board.json',
    metrics: 'data/metrics.json',
    trends: 'data/trends.json',
    rankings: 'data/rankings.json',
    governance: 'data/governance.json',
    meta: 'data/meta.json',
  };

  window.Board = {
    data: {},
    state: {
      route: { name: 'overview', platform: 'github' },
      boardFilters: {
        github: { search: '', type: '', priority: '', assignee: '', groupBy: '', openOnly: false, gfiOnly: false },
        gitcode: { search: '', type: '', priority: '', assignee: '', groupBy: '', openOnly: false, gfiOnly: false },
      },
    },
    loadAll: loadAll,
    go: go,
    reload: reload,
  };

  async function loadAll() {
    const jobs = Object.entries(DATA_FILES).map(async ([key, path]) => {
      try {
        const resp = await fetch(path, { cache: 'no-store' });
        if (!resp.ok) throw new Error('HTTP ' + resp.status);
        Board.data[key] = await resp.json();
      } catch (e) {
        Board.data[key] = null;
        console.warn('failed to load ' + path, e);
      }
    });
    await Promise.all(jobs);
  }

  function parseRoute() {
    const hash = location.hash.replace(/^#\/?/, '');
    const parts = hash.split('/').filter(Boolean);
    const name = parts[0] || 'overview';
    if (name === 'board') {
      const platform = (parts[1] === 'gitcode') ? 'gitcode' : 'github';
      return { name: 'board', platform };
    }
    return { name, platform: null };
  }
  async function go() {
    Board.state.route = parseRoute();
    document.querySelectorAll('.nav a[data-route]').forEach((a) => {
      const onRoute = a.dataset.route === Board.state.route.name;
      const onPlat = !a.dataset.platform || a.dataset.platform === Board.state.route.platform;
      a.classList.toggle('active', onRoute && onPlat);
    });
    if (Board.data.meta && Board.data.meta.generated_at) {
      const el = document.getElementById('updated-at');
      if (el) el.textContent = '更新于 ' + fmtDate(Board.data.meta.generated_at);
    }
    window.renderRoute(Board.state.route);
  }

  function reload() {
    loadAll().then(go);
  }

  window.addEventListener('hashchange', go);

  // kick off
  (async function init() {
    await loadAll();
    // ensure views.js (window.renderRoute) has registered before routing
    const t0 = Date.now();
    while (typeof window.renderRoute !== 'function') {
      if (Date.now() - t0 > 5000) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    await go();
  })();

  // shared small helpers used by views too
  window.fmtDate = function (iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
  };
  window.fmtDateTime = function (iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };
  window.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    }[c]));
  };
})();
