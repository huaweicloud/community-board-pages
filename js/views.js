/* Community Board - view renderers (9-dimension governance edition). */
(function () {
  'use strict';

  const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };
  const GRADE_COLOR = { 优秀: '#1a7f37', 良好: '#1a7f37', 一般: '#9a6700', 不足: '#cf222e' };

  /* ---- dimension info + tooltip ---- */
  function dimDef(did) {
    return (Board.data.meta && Board.data.meta.governance_dims || []).find((d) => d.id === did);
  }

  function dimInfoHtml(d) {
    if (!d) return '';
    const comps = (d.components || []).map((c) => `<li><span>${esc(c.name)}</span><b>${c.points} 分</b></li>`).join('');
    return `
      <div class="tip-title">${esc(d.short)} ${esc(d.name)}（权重 ${d.weight}%）</div>
      <div class="tip-desc">${esc(d.desc || '')}</div>
      <div class="tip-sub">评分：0-100，按下列分项得分累加</div>
      <ul class="tip-comps">${comps}</ul>
      <div class="tip-note">${esc(Board.data.meta.governance_grading || '')}</div>`;
  }

  let tipEl = null;
  function ensureTip() {
    if (!tipEl) {
      tipEl = document.createElement('div');
      tipEl.className = 'tooltip';
      tipEl.style.display = 'none';
      document.body.appendChild(tipEl);
    }
    return tipEl;
  }
  function attachTip(el, html) {
    if (!el) return;
    el.addEventListener('mouseenter', (e) => {
      const t = ensureTip();
      t.innerHTML = html;
      t.style.display = 'block';
      const r = el.getBoundingClientRect();
      t.style.left = Math.min(window.innerWidth - 320, r.left) + 'px';
      t.style.top = (r.bottom + 6) + 'px';
    });
    el.addEventListener('mouseleave', () => { if (tipEl) tipEl.style.display = 'none'; });
  }

  window.renderRoute = function (route) {
    const app = document.getElementById('app');
    if (!Board.data.metrics || !Board.data.governance) {
      app.innerHTML = '<div class="empty"><div class="big">暂无数据</div>' +
        '请先运行采集脚本（<code>python fetch/github_fetch.py && python fetch/gitcode_fetch.py && python build/build_data.py</code>）。</div>';
      return;
    }
    switch (route.name) {
      case 'board': return renderBoard(app, route.platform);
      case 'repos': return renderRepos(app);
      case 'pr': return renderPr(app);
      case 'risks': return renderRisks(app);
      case 'trends': return renderTrends(app);
      default: return renderOverview(app);
    }
  };

  /* ---------------- overview (GitHub only) ---------------- */
  function overallConclusionHtml() {
    const g = Board.data.governance;
    const org = g.org_github || g.org;
    const concls = g.conclusions_github || g.conclusions;
    if (!concls) return '';
    const seen = {};
    Object.values(concls).forEach((c) => (c.facts || []).forEach((f) => {
      const key = f.label.replace('近 30 天无合并 PR', '近 30 天无合并');
      if (!seen[key] || f.missing > seen[key].missing) seen[key] = { ...f, label: key };
    }));
    const facts = Object.values(seen).sort((a, b) => b.missing - a.missing);

    const isPending = (l) => l.includes('僵尸') || l.includes('积压') || l.includes('关闭率 <') ||
      l.includes('合并率 <') || l.includes('单人维护') || l.includes('GPL') || l.includes('近 30 天') || l.includes('SLA');
    const isMissing = (l) => l.includes('无') || l.includes('未启用') || l.includes('未开启') ||
      l.includes('Topics <') || l.includes('社区文件 <') || l.includes('零 Star');

    const missing = [], pending = [];
    facts.forEach((f) => {
      if (isPending(f.label)) pending.push(f.label);
      else if (isMissing(f.label)) missing.push(f.label);
    });
    const missingArr = [...new Set(missing)].slice(0, 6);
    if (seen['无 LICENSE'] && !missingArr.includes('无 LICENSE')) missingArr.push('无 LICENSE');
    const fmt = (arr, n) => [...new Set(arr)].slice(0, n).map(esc).join('、');
    const gcls = org.total.grade === '不足' ? 'bad' : org.total.grade === '一般' ? 'warn' : 'ok';
    return `
      <div class="panel concl-overall">
        <h3>总体结论</h3>
        <p class="co-text">组织治理加权 <b>${org.total.score}</b> 分（<span class="co-grade ${gcls}">${org.total.grade}</span>）。</p>
        <p class="co-text">主要缺少：<b>${missingArr.map(esc).join('、')}</b>。</p>
        <p class="co-text">待处理：<b>${fmt(pending, 4)}</b>。</p>
      </div>`;
  }

  function renderOverview(app) {
    const g = Board.data.governance;
    const org = g.org_github || g.org;          // GitHub-only org scores
    const concls = g.conclusions_github || g.conclusions;
    const m = Board.data.metrics;
    const gm = m.by_platform.github || m.global; // GitHub-only metrics
    const ghRepos = g.repos.filter((r) => r.platform === 'github');
    const ghPRs = (Board.data.board && Board.data.board.prs || []).filter((p) => p.platform === 'github');

    const kpis = [
      { label: '加权治理分', value: org.total.score, cls: org.total.grade === '不足' ? 'danger' : (org.total.grade === '一般' ? 'warn' : 'good'), sub: org.total.grade },
      { label: '开启 Issue', value: gm.open, cls: 'accent' },
      { label: '待 Triage', value: gm.needs_triage, cls: gm.needs_triage ? 'danger' : '' },
      { label: 'SLA 违约', value: gm.sla_breach, cls: gm.sla_breach ? 'danger' : 'good' },
      { label: '仓库数', value: ghRepos.length },
      { label: '总 Stars', value: ghRepos.reduce((s, r) => s + (r.stars || 0), 0) },
      { label: '开启 PR', value: ghPRs.length },
    ];

    const dimRows = g.dims.map((d) => {
      const o = org[d.id] || { score: 0, grade: '不足' };
      const w = Math.round((o.score / 100) * 100);
      const color = GRADE_COLOR[o.grade] || '#59636e';
      return `
        <div class="dim-row">
          <span class="dim-name" data-tip-id="${d.id}">${esc(d.short)} ${esc(d.name)} <span class="dim-info">ⓘ</span></span>
          <div class="bar-track" style="background:#e8ebee">
            <div class="bar-fill" style="width:${w}%;height:100%;background:${color}"></div>
          </div>
          <span class="dim-score" style="color:${color}">${o.score}</span>
          <span class="dim-grade">${o.grade}</span>
        </div>`;
    }).join('');

    const conclRows = g.dims.map((d) => {
      const c = concls && concls[d.id];
      if (!c) return '';
      const color = GRADE_COLOR[c.grade] || '#59636e';
      const facts = (c.facts || []).map((f) =>
        `<span class="badge" style="background:var(--red-soft);color:var(--red)" title="${esc(f.label)}">${esc(f.label)} ${f.missing}/${f.known}</span>`).join('');
      return `
        <div class="concl-row">
          <span class="concl-dim">${esc(d.short)} ${esc(d.name)}</span>
          <span class="concl-score" style="color:${color}">${c.score} · ${c.grade}</span>
          <span class="concl-text">${esc(c.text)}</span>
          <span class="concl-facts">${facts}</span>
        </div>`;
    }).join('');

    const kpiCount = `P0: ${risksIn('P0')} · P1: ${risksIn('P1')} · P2: ${risksIn('P2')} · P3: ${risksIn('P3')}`;

    app.innerHTML = `
      ${overallConclusionHtml()}
      <div class="chips">${platformChip('github')}
        <span class="chip">风险: <b>${kpiCount}</b></span>
        <span class="chip">GitCode 数据见「GitCode 看板」页</span></div>
      <div class="metrics">${kpis.map(metricHtml).join('')}</div>
      <div class="two-col">
        <div class="panel">
          <h3>9 维度成熟度（0-100）<span class="dim-info-hint">悬浮 ⓘ 查看评分计算方式</span></h3>
          <div class="dim-list">${dimRows}</div>
          <div class="total-row"><span>加权总分</span><b style="color:${GRADE_COLOR[org.total.grade]}">${org.total.score} · ${org.total.grade}</b></div>
        </div>
        <div class="panel"><h3>维度雷达</h3>
          <div class="chart-wrap" style="height:340px"><canvas id="radar-chart"></canvas></div>
        </div>
      </div>
      <div class="panel"><h3>维度结论评价（GitHub）</h3>
        <div class="concl-list">${conclRows}</div>
      </div>
      <div class="two-col">
        <div class="panel"><h3>类型分布</h3>${barsOf(gm.by_type, typeLabels)}</div>
        <div class="panel"><h3>优先级分布（开启）</h3>${barsOf(gm.by_priority, priLabels)}</div>
      </div>
      ${renderAttention()}`;

    g.dims.forEach((d) => attachTip(document.querySelector(`[data-tip-id="${d.id}"]`), dimInfoHtml(d)));
    drawRadar(g);
  }

  function risksIn(prio) {
    const ghNames = new Set(Board.data.governance.repos.filter((r) => r.platform === 'github').map((r) => r.repo));
    return (Board.data.governance.risks || [])
      .filter((r) => r.prio === prio)
      .reduce((s, r) => s + (r.items || []).filter((n) => ghNames.has(n)).length, 0);
  }

  function platformChip(p) {
    const bp = Board.data.metrics.by_platform[p] || { total: 0, open: 0, closed: 0, repos_with_issues: 0 };
    const title = Board.data.meta.platforms[p] ? Board.data.meta.platforms[p].title : p;
    return `<span class="chip">${title}：<b>${bp.total}</b> Issue（开启 <b>${bp.open}</b> · ${bp.repos_with_issues} 仓库）</span>`;
  }

  function drawRadar(g) {
    const canvas = document.getElementById('radar-chart');
    if (!window.Chart || !canvas) return;
    new Chart(canvas, {
      type: 'radar',
      data: {
        labels: g.dims.map((d) => d.name),
        datasets: [{
          label: '成熟度',
          data: g.dims.map((d) => org_score(g, d.id)),
          borderColor: '#2f6fed', backgroundColor: 'rgba(47,111,237,.15)', pointRadius: 3, borderWidth: 2,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { r: { min: 0, max: 100, ticks: { stepSize: 25, backdropColor: 'transparent' } } },
        plugins: { legend: { display: false } },
      },
    });
  }

  function org_score(g, id) {
    return g.org[id] ? g.org[id].score : 0;
  }

  /* ---- industry benchmarks ---- */
  function benchDef() {
    return (Board.data.meta && Board.data.meta.benchmarks) || { dims: {} };
  }
  function benchTarget(did) {
    return (benchDef().dims && benchDef().dims[did] && benchDef().dims[did].target) || 0;
  }
  function benchOverall(g) {
    const ws = (g.dims || []).reduce((s, d) => s + (d.weight || 0), 0);
    if (!ws) return 0;
    return Math.round((g.dims || []).reduce((s, d) => s + benchTarget(d.id) * (d.weight || 0), 0) / ws);
  }
  function benchStatus(score, target) {
    const gap = Math.round((score - target) * 10) / 10;
    if (gap >= 0) return { label: '达标', cls: 'ok', gap: '+' + gap };
    if (gap >= -10) return { label: '接近', cls: 'warn', gap: String(gap) };
    return { label: '落后', cls: 'bad', gap: String(gap) };
  }
  function benchPanelHtml(g) {
    const b = benchDef();
    const note = (b.note || '').replace('（', '（');
    const projects = b.projects || [];
    const groups = [...new Set(projects.map((p) => p.group))].map((grp) => {
      const chips = projects.filter((p) => p.group === grp).map((p) =>
        `<a class="bench-proj" href="${esc(p.url)}" target="_blank" rel="noopener" title="${esc(p.note || p.name)}">${esc(p.name)}</a>`).join('');
      return `<div class="bench-proj-group"><span class="bench-proj-label">${esc(grp)}</span>${chips}</div>`;
    }).join('');
    const rows = g.dims.map((d) => {
      const orgScore = org_score(g, d.id);
      const target = benchTarget(d.id);
      const st = benchStatus(orgScore, target);
      return `
        <div class="bench-row">
          <span class="bench-dim" data-tip-id="bench-${d.id}">${esc(d.short)} ${esc(d.name)}</span>
          <div class="bench-track">
            <div class="bench-fill org" style="width:${Math.min(100, orgScore)}%"></div>
            <div class="bench-marker" style="left:${Math.min(100, target)}%"><i>标 ${target}</i></div>
          </div>
          <span class="bench-num org">${orgScore}</span>
          <span class="bench-num ref">${target}</span>
          <span class="bench-gap ${st.cls}">${st.gap}</span>
          <span class="bench-status ${st.cls}">${st.label}</span>
        </div>`;
    }).join('');
    const overall = benchOverall(g);
    const os = benchStatus(g.org.total.score, overall);
    return `
      <div class="panel bench-panel">
        <h3>行业对标 · 横向对比 <span class="dim-info-hint">${esc(note)} · 悬浮维度查看标杆口径</span></h3>
        ${groups ? `<div class="bench-projects">${groups}</div>` : ''}
        <div class="bench-list">
          <div class="bench-row bench-head">
            <span>维度</span><span>组织 vs 行业标杆</span><span>组织</span><span>标杆</span><span>差距</span><span>状态</span>
          </div>
          ${rows}
          <div class="bench-row bench-overall">
            <span class="bench-dim">总体</span>
            <div class="bench-track">
              <div class="bench-fill org" style="width:${Math.min(100, g.org.total.score)}%"></div>
              <div class="bench-marker" style="left:${Math.min(100, overall)}%"><i>标 ${overall}</i></div>
            </div>
            <span class="bench-num org">${g.org.total.score}</span>
            <span class="bench-num ref">${overall}</span>
            <span class="bench-gap ${os.cls}">${os.gap}</span>
            <span class="bench-status ${os.cls}">${os.label}</span>
          </div>
        </div>
      </div>`;
  }

  /* ---------------- repos governance matrix ---------------- */
  function renderRepos(app) {
    const g = Board.data.governance;
    const filter = { search: '', platform: '', grade: '' };

    const toolbar = `
      <div class="board-toolbar">
        <input type="text" id="rg-search" placeholder="搜索仓库">
        <select id="rg-platform">
          <option value="">全部平台</option>
          <option value="github">GitHub</option>
          <option value="gitcode">GitCode</option>
        </select>
        <select id="rg-grade">
          <option value="">全部等级</option>
          <option value="优秀">优秀</option>
          <option value="良好">良好</option>
          <option value="一般">一般</option>
          <option value="不足">不足</option>
        </select>
        <span class="spacer"></span>
        <span class="count">共 ${g.repos.length} 个仓库</span>
      </div>
      <div class="panel gov-table-wrap">
        <table class="data gov-table">
          <thead><tr>
            <th>仓库</th><th>平台</th><th>★</th><th>加权</th>
            ${g.dims.map((d) => `<th class="dim-head" data-tip-id="col-${d.id}">${esc(d.short)} <span class="dim-info">ⓘ</span></th>`).join('')}
          </tr></thead>
          <tbody id="rg-body"></tbody>
        </table>
      </div>`;

    app.innerHTML = `<div class="page-head"><h2 class="section-title">仓库治理矩阵</h2>
      <span class="sub">9 维度评分 · 颜色：绿=优秀/良好 黄=一般 红=不足 · 悬浮列头 ⓘ 查看计算方式 · 点击仓库行展开单仓结论</span></div>
      ${benchPanelHtml(g)}${toolbar}`;

    g.dims.forEach((d) => attachTip(document.querySelector(`[data-tip-id="col-${d.id}"]`), dimInfoHtml(d)));
    g.dims.forEach((d) => {
      const el = document.querySelector(`[data-tip-id="bench-${d.id}"]`);
      const note = (benchDef().dims && benchDef().dims[d.id] && benchDef().dims[d.id].note) || '';
      attachTip(el, `<div class="tip-title">${esc(d.short)} ${esc(d.name)} · 行业标杆 ${benchTarget(d.id)} 分</div>
        <div class="tip-desc">${esc(note || '')}</div>
        <div class="tip-note">${esc(benchDef().note || '')}</div>`);
    });

    const body = document.getElementById('rg-body');
    if (!body) return;
    const render = () => {
      body.innerHTML = g.repos.filter((r) => {
        if (filter.platform && r.platform !== filter.platform) return false;
        if (filter.grade && r.grade !== filter.grade) return false;
        if (filter.search && !r.repo.toLowerCase().includes(filter.search.toLowerCase())) return false;
        return true;
      }).map((r) => repoRow(g, r)).join('') || '<tr><td colspan="13" class="empty">无匹配仓库</td></tr>';
    };
    render();

    body.addEventListener('click', (e) => {
      const row = e.target.closest('tr.repo-row');
      if (!row || e.target.closest('a')) return;
      const repoName = row.dataset.repo;
      const next = row.nextElementSibling;
      if (next && next.classList.contains('repo-detail')) {
        next.remove();
        row.querySelector('.tog').textContent = '▸';
        return;
      }
      const repo = g.repos.find((r) => r.repo === repoName);
      if (!repo) return;
      const detail = document.createElement('tr');
      detail.className = 'repo-detail';
      detail.innerHTML = `<td colspan="13"><div class="repo-detail-inner">${repoDetailHtml(g, repo)}</div></td>`;
      row.after(detail);
      row.querySelector('.tog').textContent = '▾';
    });

    const bind = (id, key) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', () => { filter[key] = el.value; render(); });
    };
    bind('rg-search', 'search');
    bind('rg-platform', 'platform');
    bind('rg-grade', 'grade');
  }

  function repoRow(g, r) {
    const cells = g.dims.map((d) => {
      const dd = r.dims[d.id] || { score: 0, grade: '不足' };
      const color = GRADE_COLOR[dd.grade] || '#59636e';
      const tip = checksTip(d, dd.checks);
      return `<td style="color:${color};font-weight:600" title="${esc(d.name)} ${dd.score}分 · ${tip}">${dd.score}</td>`;
    }).join('');
    const link = r.platform === 'github' ? `https://github.com/${r.repo}` : `https://gitcode.com/${r.repo}`;
    const overall = benchOverall(g);
    const bs = benchStatus(r.total, overall);
    const mark = bs.cls === 'ok'
      ? `<span class="bench-tag ok" title="达到总体行业标杆 ${overall} 分">对标达标</span>`
      : (bs.cls === 'warn' ? `<span class="bench-tag warn" title="接近总体行业标杆 ${overall} 分（差 ${overall - r.total}）">接近</span>` : '');
    return `<tr class="repo-row" data-repo="${esc(r.repo)}">
      <td><span class="tog" style="color:var(--muted);margin-right:4px">▸</span>
        <a href="${esc(link)}" target="_blank" rel="noopener">${esc(r.repo)}</a></td>
      <td><span class="badge plat-${r.platform}">${r.platform === 'github' ? 'GH' : 'GC'}</span></td>
      <td>${r.stars || 0}</td>
      <td style="font-weight:700;color:${GRADE_COLOR[r.grade] || '#59636e'}">${r.total} ${mark}<br><small>${r.grade}</small></td>
      ${cells}</tr>`;
  }

  function repoDetailHtml(g, r) {
    const dims = g.dims.map((d) => {
      const dd = r.dims[d.id] || { score: 0, grade: '不足', conclusion: '' };
      const color = GRADE_COLOR[dd.grade] || '#59636e';
      const target = benchTarget(d.id);
      const st = benchStatus(dd.score, target);
      const checks = Object.entries(dd.checks || {}).map(([k, v]) =>
        `<span class="rd-check ${v === true ? 'ok' : v === false ? 'bad' : 'unk'}" title="${esc(k)}">${v === true ? '✅' : v === false ? '❌' : '❔'}</span>`).join('');
      return `
        <div class="rd-dim">
          <div class="rd-head">
            <span class="rd-dim-name">${esc(d.short)} ${esc(d.name)}</span>
            <span class="rd-score" style="color:${color}">${dd.score} · ${dd.grade}</span>
            <span class="rd-bench ${st.cls}" title="行业标杆 ${target} 分 · 差距 ${st.gap}">标 ${target} ${st.label}</span>
            <span class="rd-checks">${checks}</span>
          </div>
          <div class="rd-text">${esc(dd.conclusion || '')}</div>
        </div>`;
    }).join('');
    return `
      <div class="rd-repo-head">
        <b>${esc(r.repo)}</b>
        <span class="rd-meta">★ ${r.stars || 0} · 开启 Issue ${r.open_issues || 0} · 开启 PR ${r.open_prs || 0} · 加权 ${r.total}（${r.grade}）</span>
      </div>
      <div class="rd-grid">${dims}</div>
      <div class="rd-legend">✅ 达标 · ❌ 不足 · ❔ 信息未知（不计入评分） · 标=行业标杆</div>`;
  }

  function checksTip(d, checks) {
    if (!checks) return '';
    return Object.entries(checks).map(([k, v]) => `${k}=${v === true ? '✅' : v === false ? '❌' : v ?? '?'}`).join(' ');
  }

  /* ---------------- issue board (kept) ---------------- */
  function renderBoard(app, platform) {
    const meta = Board.data.meta;
    const platformTitle = meta && meta.platforms[platform] ? meta.platforms[platform].title : platform;
    const filters = Board.state.boardFilters[platform];
    const cards = (Board.data.board && Board.data.board.cards || [])
      .filter((c) => c.platform === platform);

    const assignees = [...new Set(cards.map((c) => c.assignee).filter(Boolean))].sort();
    const types = [...new Set(cards.map((c) => c.type).filter(Boolean))].sort();
    const priorities = [...new Set(cards.map((c) => c.priority).filter(Boolean))].sort();

    const cols = (meta && meta.columns || []).map((col) => {
      const inCol = cards.filter((c) => c.column === col.id);
      return colCard(col, filterCards(inCol, filters), filters.groupBy);
    }).join('');

    app.innerHTML = `
      <div class="page-head">
        <h2 class="section-title">${platformTitle}</h2>
        <span class="sub">共 ${cards.length} 条 Issue · 已开启 ${cards.filter((c) => c.state === 'open').length}</span>
      </div>
      <div class="board-toolbar">
        <input type="text" id="f-search" placeholder="搜索标题 / 编号 / 作者" value="${esc(filters.search)}">
        <select id="f-type">
          <option value="">全部类型</option>
          ${types.map((t) => `<option value="${esc(t)}" ${filters.type === t ? 'selected' : ''}>${esc(t)}</option>`).join('')}
        </select>
        <select id="f-priority">
          <option value="">全部优先级</option>
          ${priorities.map((p) => `<option value="${esc(p)}" ${filters.priority === p ? 'selected' : ''}>${esc(p)}</option>`).join('')}
        </select>
        <select id="f-assignee">
          <option value="">全部负责人</option>
          ${assignees.map((a) => `<option value="${esc(a)}" ${filters.assignee === a ? 'selected' : ''}>${esc(a)}</option>`).join('')}
        </select>
        <select id="f-group" title="将列内 Issue 分组显示（如 Backlog 细分）">
          <option value="">不分组</option>
          <option value="type" ${filters.groupBy === 'type' ? 'selected' : ''}>按类型分组</option>
          <option value="priority" ${filters.groupBy === 'priority' ? 'selected' : ''}>按优先级分组</option>
          <option value="area" ${filters.groupBy === 'area' ? 'selected' : ''}>按领域分组</option>
          <option value="age" ${filters.groupBy === 'age' ? 'selected' : ''}>按年龄分组</option>
        </select>
        <label class="check"><input type="checkbox" id="f-open" ${filters.openOnly ? 'checked' : ''}>仅开启</label>
        <label class="check"><input type="checkbox" id="f-gfi" ${filters.gfiOnly ? 'checked' : ''}>仅 Good First</label>
        <span class="spacer"></span>
        <a href="#" id="clear-filters">清空筛选</a>
      </div>
      <div class="board">${cols}</div>`;

    bindBoardFilters(platform);
  }

  function bindBoardFilters(platform) {
    const f = Board.state.boardFilters[platform];
    const bind = (id, key) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('input', () => { f[key] = el.value; window.renderRoute(Board.state.route); });
    };
    bind('f-search', 'search');
    bind('f-type', 'type');
    bind('f-priority', 'priority');
    bind('f-assignee', 'assignee');
    bind('f-group', 'groupBy');
    ['f-open', 'f-gfi'].forEach((id) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('change', () => {
        f[id === 'f-open' ? 'openOnly' : 'gfiOnly'] = el.checked;
        window.renderRoute(Board.state.route);
      });
    });
    const clear = document.getElementById('clear-filters');
    if (clear) clear.addEventListener('click', (e) => {
      e.preventDefault();
      f.search = ''; f.type = ''; f.priority = ''; f.assignee = ''; f.groupBy = ''; f.openOnly = false; f.gfiOnly = false;
      window.renderRoute(Board.state.route);
    });
  }

  function filterCards(cards, filters) {
    const q = filters.search.trim().toLowerCase();
    return cards.filter((c) => {
      if (filters.openOnly && c.state !== 'open') return false;
      if (filters.gfiOnly && !c.good_first) return false;
      if (filters.type && c.type !== filters.type) return false;
      if (filters.priority && c.priority !== filters.priority) return false;
      if (filters.assignee && c.assignee !== filters.assignee) return false;
      if (q) {
        const hay = `${c.title} ${c.number} ${c.author || ''} ${c.repo} ${c.labels.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }).sort((a, b) => {
      const pa = PRIORITY_ORDER[a.priority] ?? 4, pb = PRIORITY_ORDER[b.priority] ?? 4;
      if (pa !== pb) return pa - pb;
      if (a.sla_breach !== b.sla_breach) return a.sla_breach ? -1 : 1;
      return (a.created_at || '').localeCompare(b.created_at || '');
    });
  }

  function colCard(col, cards, groupBy) {
    const groups = groupCards(cards, groupBy);
    const body = groups.map((g) => `
      <div class="col-group">
        <div class="col-group-head"><span>${esc(g.label)}</span><span class="n">${g.cards.length}</span></div>
        ${g.cards.map(cardHtml).join('')}
      </div>`).join('') || '<div class="empty" style="padding:16px;font-size:12px">空</div>';
    return `
      <div class="board-col ${esc(col.id)}">
        <div class="col-head"><span>${esc(col.title)}</span><span class="n">${cards.length}</span></div>
        <div class="col-body">${body}</div>
      </div>`;
  }

  const GROUP_ORDER = {
    type: { bug: 0, feature: 1, question: 2, documentation: 3, other: 9 },
    priority: { critical: 0, high: 1, medium: 2, low: 3, unknown: 9 },
    area: null,
    age: { '<7 天': 0, '7-30 天': 1, '30-90 天': 2, '>90 天': 9 },
  };
  function groupKey(c, groupBy) {
    switch (groupBy) {
      case 'type': return c.type || 'other';
      case 'priority': return c.priority || 'unknown';
      case 'area': return c.area || '无领域';
      case 'age': {
        const d = c.age_days || 0;
        if (d < 7) return '<7 天';
        if (d < 30) return '7-30 天';
        if (d < 90) return '30-90 天';
        return '>90 天';
      }
    }
    return '';
  }
  function groupCards(cards, groupBy) {
    if (!groupBy || !cards.length) return cards.length ? [{ label: '', cards }] : [];
    const map = {};
    cards.forEach((c) => {
      const k = groupKey(c, groupBy);
      (map[k] = map[k] || []).push(c);
    });
    const order = GROUP_ORDER[groupBy];
    const keys = Object.keys(map);
    keys.sort((a, b) => {
      if (order) {
        const oa = order[a] ?? 9, ob = order[b] ?? 9;
        if (oa !== ob) return oa - ob;
      } else if (groupBy === 'area') {
        return a.localeCompare(b);
      }
      return map[b].length - map[a].length;
    });
    return keys.map((k) => ({ label: k, cards: map[k] }));
  }

  function cardHtml(c) {
    const type = c.type || 'other';
    const pri = c.priority || 'unknown';
    const badges = [
      `<span class="badge plat-${c.platform}">${c.platform === 'github' ? 'GH' : 'GC'}</span>`,
      `<span class="badge type-${esc(type)}">${esc(type)}</span>`,
      `<span class="badge pri-${esc(pri)}">${esc(pri)}</span>`,
    ];
    if (c.good_first) badges.push(`<span class="badge gfi">Good First</span>`);
    if (c.sla_breach) badges.push(`<span class="badge sla">SLA 超时</span>`);
    else if (c.sla_warning) badges.push(`<span class="badge sla-warning">SLA 预警</span>`);

    const cls = ['card', c.sla_breach ? 'breach' : '', c.sla_warning ? 'warning' : ''].filter(Boolean).join(' ');
    const assignee = c.assignee
      ? `<span class="assignee">👤 ${esc(c.assignee)}</span>`
      : (c.state === 'open' ? '<span class="assignee" style="color:var(--amber)">未认领</span>' : '—');
    const stateTag = c.state === 'closed' ? '已关闭' : `${Math.round(c.age_days || 0)} 天`;
    return `
      <div class="${cls}">
        <a class="card-title" href="${esc(c.url)}" target="_blank" rel="noopener">
          #${c.number} ${esc(c.title)}
        </a>
        <div class="card-meta">
          <span class="repo">${esc(c.repo)}</span>
          ${c.area ? `<span class="area">[${esc(c.area)}]</span>` : ''}
          ${badges.join('')}
        </div>
        <div class="footer-row">
          <span>${esc(c.author || 'unknown')} · ${stateTag}${c.comments ? ' · 💬' + c.comments : ''}</span>
          ${assignee}
        </div>
      </div>`;
  }

  /* ---------------- PR board ---------------- */
  function renderPr(app) {
    const prs = (Board.data.board && Board.data.board.prs || []).slice();
    const filter = { search: '', platform: '', draft: false };

    const groups = [
      { id: 'new', title: '新 PR（<7 天）', pred: (p) => (p.age_days || 0) < 7 },
      { id: 'review', title: '进行中（7-30 天）', pred: (p) => (p.age_days || 0) >= 7 && (p.age_days || 0) <= 30 },
      { id: 'backlog', title: '积压（>30 天）', pred: (p) => (p.age_days || 0) > 30 },
    ];

    const merged30 = (Board.data.governance.repos || [])
      .reduce((s, r) => s + (r.dims.d4 && r.dims.d4.checks && r.dims.d4.checks.merged_30d || 0), 0);

    const toolbar = `
      <div class="board-toolbar">
        <input type="text" id="pr-search" placeholder="搜索标题 / 编号 / 作者">
        <select id="pr-platform">
          <option value="">全部平台</option>
          <option value="github">GitHub</option>
          <option value="gitcode">GitCode</option>
        </select>
        <label class="check"><input type="checkbox" id="pr-draft">隐藏 Draft</label>
        <span class="spacer"></span>
        <span class="count">共 ${prs.length} 个开启 PR · 近30天合并 ${merged30}</span>
      </div>`;

    const cols = groups.map((g) => {
      const inCol = prs.filter((p) => g.pred(p) && matchPr(p, filter));
      return `
        <div class="board-col ${g.id === 'backlog' ? 'needs-triage' : ''}">
          <div class="col-head"><span>${esc(g.title)}</span><span class="n">${inCol.length}</span></div>
          <div class="col-body">${inCol.length ? inCol.map(prCard).join('') : '<div class="empty" style="padding:16px;font-size:12px">空</div>'}</div>
        </div>`;
    }).join('');

    app.innerHTML = `<div class="page-head"><h2 class="section-title">PR 看板</h2>
      <span class="sub">按开启时长分列，积压 PR 需优先 Review</span></div>
      ${toolbar}<div class="board">${cols}</div>`;

    const bind = (id, key, ev) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener(ev, () => { filter[key] = el.value; window.renderRoute(Board.state.route); });
    };
    bind('pr-search', 'search', 'input');
    bind('pr-platform', 'platform', 'input');
    const draft = document.getElementById('pr-draft');
    if (draft) draft.addEventListener('change', () => { filter.draft = draft.checked; window.renderRoute(Board.state.route); });
  }

  function matchPr(p, filter) {
    if (filter.platform && p.platform !== filter.platform) return false;
    if (filter.draft && p.draft) return false;
    if (filter.search) {
      const q = filter.search.toLowerCase();
      if (!(`${p.title} ${p.number} ${p.author || ''} ${p.repo}`.toLowerCase().includes(q))) return false;
    }
    return true;
  }

  function prCard(p) {
    return `
      <div class="card ${p.backlog ? 'warning' : ''}">
        <a class="card-title" href="${esc(p.url)}" target="_blank" rel="noopener">
          #${p.number} ${esc(p.title)}
        </a>
        <div class="card-meta">
          <span class="repo">${esc(p.repo)}</span>
          <span class="badge plat-${p.platform}">${p.platform === 'github' ? 'GH' : 'GC'}</span>
          ${p.draft ? '<span class="badge" style="background:#ddf4ff;color:#0969da">Draft</span>' : ''}
        </div>
        <div class="footer-row">
          <span>${esc(p.author || 'unknown')} · ${Math.round(p.age_days || 0)} 天</span>
          ${p.backlog ? '<span class="badge sla">积压</span>' : ''}
        </div>
      </div>`;
  }

  /* ---------------- risks ---------------- */
  function renderRisks(app) {
    const g = Board.data.governance;
    const prioMeta = {
      P0: { title: 'P0 止血 — 法律与安全底线', color: 'var(--red)' },
      P1: { title: 'P1 筑基 — 社区准入门槛', color: 'var(--amber)' },
      P2: { title: 'P2 规范化 — 工程质量基线', color: 'var(--accent)' },
      P3: { title: 'P3 持续运营 — 社区活力', color: 'var(--green)' },
    };

    const riskBoxes = Object.keys(prioMeta).map((p) => {
      const items = (g.risks || []).filter((r) => r.prio === p);
      if (!items.length) return '';
      return `
        <div class="panel risk-panel">
          <h3 style="color:${prioMeta[p].color}">${prioMeta[p].title}</h3>
          ${items.map((r) => `
            <div class="risk-item">
              <span class="risk-count">${r.count}</span>
              <div>
                <div class="risk-name">${esc(r.title)}</div>
                ${r.note ? `<div class="risk-note">${esc(r.note)}</div>` : ''}
                <div class="risk-tags">${r.items.slice(0, 12).map((n) => `<code>${esc(n)}</code>`).join('')}${r.items.length > 12 ? `<code>+${r.items.length - 12}…</code>` : ''}</div>
              </div>
            </div>`).join('')}
        </div>`;
    }).join('');

    const gapRows = (g.gap.rows || []).map((row) => `
      <tr><td>${esc(row.name)}</td><td>${esc(row.cur)}</td><td>${esc(row.target)}</td>
      <td><span class="badge ${row.prio === 'P0' ? 'sla' : row.prio === 'P1' ? 'sla-warning' : ''}">${row.prio}</span></td></tr>`).join('');

    app.innerHTML = `
      <div class="page-head"><h2 class="section-title">风险与执行建议</h2></div>
      ${riskBoxes || '<div class="empty"><div class="big">暂无风险项</div></div>'}
      <div class="panel"><h3>框架规范对齐（现状 vs 目标）</h3>
        <table class="data"><thead><tr><th>规范方面</th><th>当前</th><th>目标</th><th>优先级</th></tr></thead>
        <tbody>${gapRows}</tbody></table>
      </div>`;
  }

  /* ---------------- trends ---------------- */
  function renderTrends(app, trends) {
    trends = trends || Board.data.trends;
    if (!trends || !trends.days || !trends.days.length) {
      app.innerHTML = '<div class="empty"><div class="big">暂无趋势数据</div></div>';
      return;
    }
    const days = trends.days;
    const labels = days.map((d) => d.date.slice(5));
    const created = days.map((d) => d.created);
    const closed = days.map((d) => d.closed);
    const openCum = days.map((d) => d.open_cum);

    app.innerHTML = `
      <div class="page-head"><h2 class="section-title">Issue 趋势（近 ${trends.window_days} 天）</h2>
        <span class="sub">open_cum 为按当前数据回算的存量近似值</span></div>
      <div class="panel">
        <div class="chart-legend">
          <span><i style="background:var(--accent)"></i>新建</span>
          <span><i style="background:var(--green)"></i>关闭</span>
          <span><i style="background:#8250df"></i>存量(近似)</span>
        </div>
        <div class="chart-wrap"><canvas id="trend-chart"></canvas></div>
      </div>`;

    const canvas = document.getElementById('trend-chart');
    if (window.Chart && canvas) {
      new Chart(canvas, {
        data: {
          labels,
          datasets: [
            { type: 'line', label: '新建', data: created, borderColor: '#2f6fed', backgroundColor: '#2f6fed', tension: .3, pointRadius: 0, borderWidth: 2 },
            { type: 'line', label: '关闭', data: closed, borderColor: '#1a7f37', backgroundColor: '#1a7f37', tension: .3, pointRadius: 0, borderWidth: 2 },
            { type: 'line', label: '存量(近似)', data: openCum, borderColor: '#8250df', backgroundColor: 'rgba(130,80,223,.08)', fill: true, tension: .3, pointRadius: 0, borderWidth: 1.5 },
          ],
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          interaction: { mode: 'index', intersect: false },
          scales: { x: { ticks: { maxTicksLimit: 12 } } },
        },
      });
    } else if (canvas) {
      canvas.remove();
    }
  }

  /* ---------------- attention list ---------------- */
  function renderAttention() {
    const attention = (Board.data.rankings && Board.data.rankings.attention || [])
      .filter((c) => c.platform === 'github').slice(0, 6);
    if (!attention.length) return '';
    return `<div class="panel"><h3>需要关注（GitHub）</h3><div class="compact-list">
      ${attention.map(cardHtmlCompact).join('')}</div></div>`;
  }

  function cardHtmlCompact(c) {
    const cls = ['card', c.sla_breach ? 'breach' : '', c.sla_warning ? 'warning' : ''].filter(Boolean).join(' ');
    return `
      <div class="${cls}" style="margin-bottom:8px">
        <a class="card-title" href="${esc(c.url)}" target="_blank" rel="noopener">
          ${esc(c.platform === 'github' ? 'GH' : 'GC')} · ${esc(c.repo)}#${c.number} ${esc(c.title)}
        </a>
        <div class="footer-row">
          <span>${c.created_at ? fmtDate(c.created_at) : ''} · ${Math.round(c.age_days || 0)} 天</span>
          ${c.sla_breach ? '<span class="badge sla">SLA 超时</span>' : ''}
          ${c.needs_triage ? '<span class="badge" style="background:var(--red-soft);color:var(--red)">待 Triage</span>' : ''}
        </div>
      </div>`;
  }

  /* ---------------- helpers ---------------- */
  function metricHtml(m) {
    const cls = ['metric', m.cls].filter(Boolean).join(' ');
    return `<div class="${cls}"><div class="label">${m.label}</div><div class="value">${m.value}</div>` +
      (m.sub ? `<div class="sub">${m.sub}</div>` : '') + `</div>`;
  }

  const typeLabels = { bug: 'Bug', feature: '功能', question: '咨询', documentation: '文档', other: '其他' };
  const priLabels = { critical: '紧急', high: '高', medium: '中', low: '低', unknown: '未标' };

  function barsOf(dist, labels) {
    const keys = Object.keys(dist);
    const max = Math.max(1, ...keys.map((k) => dist[k] || 0));
    return keys.map((k) => {
      const v = dist[k] || 0;
      const w = Math.round((v / max) * 100);
      return `<div class="bar-row"><span class="bar-label">${labels[k] || k}</span>` +
        `<div class="bar-track"><div class="bar-fill" style="width:${w}%"></div></div>` +
        `<span class="bar-num">${v}</span></div>`;
    }).join('');
  }
})();
