(() => {
  'use strict';
  // Strip the one-use connection fragment before the rest of the document loads.
  let fragment = window.location.hash;
  window.history.replaceState(null, '', window.location.pathname + window.location.search);
  let ticket = '';
  let api = '';
  const roomParams = new URLSearchParams(window.location.search);
  const roomCode = roomParams.get('room') || '';
  const validRoomPath = [...roomParams.keys()].length === 1 && /^[a-f0-9]{24}$/.test(roomCode);

  document.addEventListener('DOMContentLoaded', () => {
    const $ = (id) => document.getElementById(id);
    let token = '';
    let state = null;
    let category = '';
    let busy = false;
    let uncertain = false;
    let expiresAt = 0;
    let expiryTimer;
    let requestEpoch = 0;
    let approvalTimer;
    let approvalToken = '';
    let approvalExpires = 0;
    const featureButtons = new Map();
    const node = (tag, className, text) => {
      const element = document.createElement(tag);
      if (className) element.className = className;
      if (text !== undefined) element.textContent = text;
      return element;
    };
    function showNotice(text, type = '') {
      $('notice-text').textContent = text;
      $('notice').className = `notice ${type}`.trim();
    }
    function showAuth(message) {
      clearTimeout(expiryTimer);
      clearTimeout(approvalTimer);
      approvalToken = '';
      requestEpoch += 1;
      token = '';
      ticket = '';
      state = null;
      expiresAt = 0;
      busy = false;
      uncertain = false;
      featureButtons.clear();
      $('features').replaceChildren();
      $('room-name').textContent = '';
      $('password').value = '';
      $('manager').hidden = true;
      $('logout').hidden = true;
      $('auth').hidden = false;
      $('login-form').hidden = true;
      $('approval').hidden = true;
      $('approval-command').value = '';
      $('auth-description').textContent = message;
      $('auth-title').setAttribute('tabindex', '-1');
      $('auth-title').focus();
    }
    function expire() {
      showAuth('접속이 만료되었거나 관리자 권한을 확인할 수 없습니다. 카카오톡에서 /기능을 입력해 다시 접속해 주세요.');
    }
    function validateState(data) {
      if (!data || !data.room || typeof data.room.name !== 'string' || !['string', 'number'].includes(typeof data.room.id) || !Array.isArray(data.features) || data.features.length > 1000 || !['string', 'number'].includes(typeof data.revision)) throw new Error('invalid-state');
      const keys = new Set();
      for (const feature of data.features) {
        if (!feature || typeof feature.key !== 'string' || keys.has(feature.key) || typeof feature.label !== 'string' || typeof feature.enabled !== 'boolean' || typeof feature.category !== 'string' || typeof feature.description !== 'string') throw new Error('invalid-state');
        keys.add(feature.key);
      }
      if (state && String(state.room.id) !== String(data.room.id)) throw new Error('invalid-room');
      if (!Array.isArray(data.limits) || data.limits.length > 5) throw new Error('invalid-limits');
      const limitKeys = new Set();
      for (const limit of data.limits) {
        const legacy = limit && typeof limit.max_bet === 'string' && /^[0-9]{16,4300}$/.test(limit.max_bet);
        if (!limit || !['odd_even', 'slot', 'fishing', 'updown', 'minesweeper'].includes(limit.key) || limitKeys.has(limit.key) || typeof limit.label !== 'string' || !Number.isSafeInteger(limit.min_bet) || limit.min_bet < 0 || !Number.isSafeInteger(limit.hard_max) || limit.hard_max < limit.min_bet || (!legacy && (!Number.isSafeInteger(limit.max_bet) || limit.max_bet < 0 || (limit.max_bet !== 0 && (limit.max_bet < limit.min_bet || limit.max_bet > limit.hard_max))))) throw new Error('invalid-limits');
        limitKeys.add(limit.key);
      }
      if (data.slot_odds !== undefined && (!Array.isArray(data.slot_odds) || data.slot_odds.length !== 6 || data.slot_odds.some((value) => !Number.isInteger(value) || value < 0 || value > 100) || data.slot_odds.reduce((a, b) => a + b, 0) !== 100)) throw new Error('invalid-odds');
      return {room: {id: data.room.id, name: data.room.name}, slot_odds: data.slot_odds ? [...data.slot_odds] : null, limits: data.limits.map((limit) => ({...limit})), features: data.features.map(({key, label, enabled, category: group, description}) => ({key, label, enabled, category: group || '기타', description})), revision: data.revision};
    }
    async function request(path, method = 'GET', body, bearer = token) {
      if (!api) throw new Error('unverified-connection');
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const headers = {Accept: 'application/json'};
        if (bearer) headers.Authorization = `Bearer ${bearer}`;
        if (body !== undefined) headers['Content-Type'] = 'application/json';
        const response = await fetch(`${api}${path}`, {method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal});
        if (!response.ok) { const error = new Error('api-error'); error.status = response.status; throw error; }
        if (response.status === 204) return null;
        const data = await response.json();
        if (response.status === 202) return {...data, pending: true};
        return data;
      } finally { clearTimeout(timeout); }
    }
    function lock(value) {
      busy = value;
      $('refresh').disabled = value;
      $('features').setAttribute('aria-busy', String(value));
      for (const control of featureButtons.values()) control.disabled = value || uncertain;
      for (const control of $('features').querySelectorAll('.limit-control')) control.disabled = value || uncertain;
    }
    function renderCategories() {
      const groups = new Map();
      for (const feature of state.features) groups.set(feature.category, (groups.get(feature.category) || 0) + 1);
      if (category && !groups.has(category)) category = '';
      const entries = [['', state.features.length], ...groups];
      const controls = entries.map(([name, count]) => {
        const button = node('button', 'category-button');
        button.type = 'button';
        button.setAttribute('aria-current', String(category === name));
        button.append(node('span', '', name || '전체 기능'), node('span', 'category-count', String(count)));
        button.addEventListener('click', () => { category = name; renderCategories(); renderFeatures(); const current = [...$('categories').children].find((item) => item.getAttribute('aria-current') === 'true'); current?.focus({preventScroll: true}); });
        return button;
      });
      $('categories').replaceChildren(...controls);
    }
    function renderFeatures(focusKey) {
      featureButtons.clear();
      const query = $('search').value.trim().toLocaleLowerCase('ko');
      const filter = $('state-filter').value;
      const visible = state.features.filter((feature) => (!category || feature.category === category) && (!query || `${feature.label} ${feature.description}`.toLocaleLowerCase('ko').includes(query)) && (filter === 'all' || feature.enabled === (filter === 'on')));
      $('list-title').textContent = category || '전체 기능';
      $('total-count').textContent = String(state.features.length);
      $('enabled-count').textContent = String(state.features.filter((feature) => feature.enabled).length);
      const rows = visible.map((feature, index) => {
        const row = node('article', 'feature-row');
        const copy = node('div', 'feature-copy');
        const title = node('div', 'feature-title');
        const heading = node('h3', '', feature.label);
        heading.id = `feature-title-${index}`;
        title.append(heading, node('span', 'feature-category', feature.category));
        copy.append(title);
        const description = node('p', '', feature.description);
        description.id = `feature-description-${index}`;
        if (feature.description) copy.append(description);
        const label = node('label', 'switch-wrap');
        const switchState = node('span', 'switch-label', feature.enabled ? '켜짐' : '꺼짐');
        const control = node('input', 'toggle');
        control.type = 'checkbox';
        control.setAttribute('role', 'switch');
        control.setAttribute('aria-labelledby', heading.id);
        if (feature.description) control.setAttribute('aria-describedby', description.id);
        control.checked = feature.enabled;
        control.disabled = busy || uncertain;
        control.addEventListener('change', () => { const desired = control.checked; control.checked = feature.enabled; saveFeature(feature, desired); });
        label.append(switchState, control);
        row.append(copy, label);
        featureButtons.set(feature.key, control);
        return row;
      });
      const groups = new Map();
      visible.forEach((feature, index) => {
        if (!groups.has(feature.category)) {
          const group = node('section', 'card feature-group');
          if (/방|관리/.test(feature.category)) group.classList.add('group-mint');
          else if (/활동|출석/.test(feature.category)) group.classList.add('group-lavender');
          else if (/게임/.test(feature.category)) group.classList.add('group-peach');
          else group.classList.add('group-sky');
          const body = node('div', 'card-body');
          body.append(node('h3', 'card-title group-title', feature.category));
          group.append(body);
          groups.set(feature.category, {group, body});
        }
        groups.get(feature.category).body.append(rows[index]);
      });
      const gameCategory = state.features.find((feature) => feature.key === 'game')?.category || '게임';
      if (state.limits.length && (!category || category === gameCategory) && filter === 'all') {
        const matching = state.limits.filter((limit) => !query || `${limit.label} 최대 배팅 한도`.toLocaleLowerCase('ko').includes(query));
        if (matching.length) {
          const group = node('section', 'card feature-group');
          group.classList.add('group-limits');
          const body = node('div', 'card-body');
          body.append(node('h3', 'card-title group-title', '게임별 배팅 한도'));
          matching.forEach((limit, index) => { const row = node('article', 'limit-row'); row.append(makeLimitForm(limit, 1000 + index)); body.append(row); });
          group.append(body);
          groups.set('__limits', {group, body});
        }
      }
      const ordered = [];
      for (const [name, entry] of groups) {
        if (name === '__limits') continue;
        ordered.push(entry.group);
        if (name === gameCategory && groups.has('__limits')) ordered.push(groups.get('__limits').group);
      }
      if (groups.has('__limits') && !groups.has(gameCategory)) ordered.unshift(groups.get('__limits').group);
      if (state.slot_odds && (!category || category === gameCategory) && filter === 'all' && (!query || '슬롯 확률 출현 그림'.includes(query))) {
        const group = node('section', 'card feature-group group-limits');
        const body = node('div', 'card-body');
        body.append(node('h3', 'card-title group-title', '슬롯 출현 확률'), makeOddsForm());
        group.append(body);
        ordered.push(group);
      }
      $('features').replaceChildren(...ordered);
      $('empty').hidden = ordered.length !== 0;
      if (!state.features.length) { $('empty').querySelector('h3').textContent = '관리할 수 있는 기능이 없습니다'; $('empty').querySelector('p').textContent = '방에 제공되는 기능이 있는지 봇 운영자에게 확인해 주세요.'; }
      if (focusKey) featureButtons.get(focusKey)?.focus({preventScroll: true});
    }
    function makeOddsForm() {
      const form = node('form', 'odds-form');
      const hint = node('p', 'limit-hint', '각 칸의 그림 출현율입니다. 0~100% 정수로 입력하고 합계를 100%로 맞춰 주세요. 배당은 유지됩니다.');
      hint.id = 'slot-odds-hint';
      const fields = node('div', 'odds-fields');
      const inputs = ['🍒 체리', '🍋 레몬', '🔔 벨', '⭐ 별', '💎 보석', '7️⃣ 세븐'].map((symbol, index) => {
        const field = node('div', 'odds-field');
        const label = node('label', 'field-label', `${symbol} (%)`);
        const input = node('input', 'input limit-control');
        input.id = `slot-odds-${index}`; label.htmlFor = input.id;
        input.type = 'number'; input.inputMode = 'numeric'; input.min = '0'; input.max = '100'; input.step = '1'; input.required = true;
        input.value = String(state.slot_odds[index]); input.disabled = busy || uncertain;
        input.setAttribute('aria-describedby', hint.id);
        field.append(label, input); fields.append(field);
        return input;
      });
      const total = node('p', 'limit-hint'); total.setAttribute('aria-live', 'polite');
      const updateTotal = () => {
        inputs.forEach((input) => input.setCustomValidity(''));
        const sum = inputs.reduce((value, input) => value + Number(input.value), 0);
        total.textContent = `합계 ${sum}%${sum === 100 ? '' : ' · 100%로 맞춰 주세요.'}`;
        return sum;
      };
      inputs.forEach((input) => input.addEventListener('input', updateTotal));
      const actions = node('div', 'odds-actions');
      const save = node('button', 'btn btn-outline limit-control', '확률 저장'); save.type = 'submit'; save.disabled = busy || uncertain;
      const reset = node('button', 'btn btn-ghost limit-control', '기본값 채우기'); reset.type = 'button'; reset.disabled = busy || uncertain;
      reset.addEventListener('click', () => { [30, 24, 18, 14, 9, 5].forEach((value, index) => { inputs[index].value = String(value); }); updateTotal(); inputs[0].focus(); });
      actions.append(save, reset);
      form.append(hint, fields, total, actions); updateTotal();
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const sum = updateTotal();
        if (sum !== 100) inputs[0].setCustomValidity('여섯 확률의 합계를 100%로 맞춰 주세요.');
        if (form.reportValidity()) saveOdds(inputs.map((input) => Number(input.value)));
      });
      return form;
    }
    async function saveOdds(weights) {
      if (busy || uncertain || !token) return;
      const epoch = requestEpoch;
      lock(true); showNotice('슬롯 확률을 저장하고 있습니다…', 'pending');
      try {
        const data = await request('/api/slot-odds', 'PATCH', {weights, revision: state.revision});
        if (epoch !== requestEpoch) return;
        applyState(data); showNotice('슬롯 확률을 저장했습니다. 이 방의 다음 슬롯부터 적용됩니다.');
      } catch (error) {
        if (epoch !== requestEpoch) return;
        if ([401, 403].includes(error.status)) { expire(); return; }
        if (error.status === 409) { lock(false); await refresh(true); return; }
        uncertain = true; showNotice('저장 결과를 확인할 수 없습니다. 새로고침으로 실제 확률을 확인한 후 다시 저장해 주세요.', 'error');
      } finally { if (epoch === requestEpoch) { lock(false); $('slot-odds-0')?.focus({preventScroll: true}); } }
    }
    function makeLimitForm(limit, index) {
      const form = node('form', 'limit-form');
      const label = node('label', 'field-label', `${limit.label} 최대 배팅`);
      const input = node('input', 'input limit-control');
      input.id = `limit-${index}`;
      label.htmlFor = input.id;
      const legacy = typeof limit.max_bet === 'string';
      input.type = legacy ? 'text' : 'number'; input.inputMode = 'numeric'; input.min = '0'; input.max = String(limit.hard_max); input.step = '1'; input.required = true;
      input.value = String(limit.max_bet);
      input.disabled = busy || uncertain;
      const hint = node('p', 'limit-hint', legacy ? '기존 한도가 웹 입력 범위를 초과합니다. 새 금액을 입력하면 변경됩니다.' : `최소 ${limit.min_bet.toLocaleString('ko-KR')}P · 0은 방 한도 해제${limit.key === 'fishing' ? ' · 기본 최대 1,000,000P' : ''}`);
      hint.id = `${input.id}-hint`; input.setAttribute('aria-describedby', hint.id);
      const action = node('div', 'limit-actions');
      const save = node('button', 'btn btn-outline limit-control', '한도 저장');
      save.type = 'submit'; save.disabled = busy || uncertain;
      action.append(input, save);
      form.append(label, action, hint);
      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const amount = Number(input.value);
        input.setCustomValidity(Number.isSafeInteger(amount) && amount >= 0 && amount <= limit.hard_max && (amount === 0 || amount >= limit.min_bet) ? '' : `0 또는 ${limit.min_bet}~${limit.hard_max} 범위의 정수를 입력해 주세요.`);
        if (input.reportValidity()) saveLimit(limit, amount);
      });
      input.addEventListener('input', () => input.setCustomValidity(''));
      return form;
    }
    function applyState(data, focusKey) {
      state = validateState(data);
      uncertain = false;
      $('room-name').textContent = state.room.name || '연결된 카카오톡 방';
      $('room-name').title = $('room-name').textContent;
      requestAnimationFrame(fitRoomName);
      renderCategories();
      renderFeatures(focusKey);
    }
    function fitRoomName() {
      const heading = $('room-name');
      heading.style.fontSize = '';
      let size = parseFloat(getComputedStyle(heading).fontSize);
      while (heading.scrollWidth > heading.clientWidth && size > 18) { size -= 1; heading.style.fontSize = `${size}px`; }
    }
    window.addEventListener('resize', fitRoomName);
    async function saveLimit(limit, max_bet) {
      if (busy || uncertain || !token) return;
      const epoch = requestEpoch;
      lock(true);
      showNotice(`${limit.label} 한도를 저장하고 있습니다…`, 'pending');
      try {
        const data = await request('/api/limits', 'PATCH', {key: limit.key, max_bet, revision: state.revision});
        if (epoch !== requestEpoch) return;
        applyState(data);
        showNotice(`${limit.label} 최대 배팅 한도를 저장했습니다.`);
      } catch (error) {
        if (epoch !== requestEpoch) return;
        if ([401, 403].includes(error.status)) { expire(); return; }
        if (error.status === 409) { lock(false); await refresh(true); return; }
        uncertain = true;
        showNotice('저장 결과를 확인할 수 없습니다. 새로고침으로 실제 한도를 확인한 후 다시 저장해 주세요.', 'error');
      } finally { if (epoch === requestEpoch) lock(false); }
    }
    async function refresh(afterConflict = false, focusKey) {
      if (busy || !token) return;
      const epoch = requestEpoch;
      lock(true);
      showNotice('저장된 설정을 확인하고 있습니다…', 'pending');
      try {
        const data = await request('/api/features');
        if (epoch !== requestEpoch) return;
        applyState(data, focusKey);
        showNotice(afterConflict ? '다른 관리자가 먼저 변경했습니다. 최신 설정을 불러왔으니 확인 후 다시 변경해 주세요.' : '최신 설정을 불러왔습니다.', afterConflict ? 'pending' : '');
      } catch (error) {
        if (epoch !== requestEpoch) return;
        if ([401, 403].includes(error.status)) { expire(); return; }
        uncertain = true;
        showNotice('설정을 확인할 수 없습니다. 연결 상태를 확인하고 새로고침해 주세요.', 'error');
      } finally { if (epoch === requestEpoch) { lock(false); if (focusKey) featureButtons.get(focusKey)?.focus({preventScroll: true}); } }
    }
    async function saveFeature(feature, enabled) {
      if (busy || uncertain || !token) return;
      const epoch = requestEpoch;
      lock(true);
      showNotice(`${feature.label} 설정을 저장하고 있습니다…`, 'pending');
      try {
        const data = await request('/api/features', 'PATCH', {key: feature.key, enabled, revision: state.revision});
        if (epoch !== requestEpoch) return;
        applyState(data);
        showNotice(`${feature.label} · ${enabled ? '켜짐' : '꺼짐'}으로 저장했습니다.`);
      } catch (error) {
        if (epoch !== requestEpoch) return;
        if ([401, 403].includes(error.status)) { expire(); return; }
        if (error.status === 409) { lock(false); await refresh(true, feature.key); return; }
        uncertain = true;
        showNotice('저장 결과를 확인할 수 없습니다. 새로고침으로 실제 설정을 확인해 주세요.', 'error');
      } finally {
        if (epoch === requestEpoch) { lock(false); featureButtons.get(feature.key)?.focus({preventScroll: true}); }
      }
    }
    function enterRoom(data) {
      if (!data || typeof data.token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.token) || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 1800) throw new Error('invalid-session');
      applyState(data);
      token = data.token;
      ticket = '';
      expiresAt = Date.now() + data.expires_in * 1000;
      expiryTimer = setTimeout(expire, data.expires_in * 1000);
      $('auth').hidden = true;
      $('manager').hidden = false;
      $('logout').hidden = false;
      requestAnimationFrame(fitRoomName);
      showNotice('이 방의 설정을 불러왔습니다. 토글을 누르면 바로 반영됩니다.');
      $('page-title').setAttribute('tabindex', '-1');
      $('page-title').focus();
    }
    $('login-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      if (busy || !ticket || !api) return;
      clearTimeout(approvalTimer);
      approvalToken = '';
      busy = true;
      const epoch = requestEpoch;
      $('login-button').disabled = true;
      $('login-button').textContent = '안전하게 연결하고 있습니다…';
      $('auth-error').textContent = '';
      $('password').removeAttribute('aria-invalid');
      let password = $('password').value;
      $('password').value = '';
      try {
        const data = await request('/api/login', 'POST', {ticket, password, room: roomCode}, '');
        if (epoch !== requestEpoch) return;
        if (!data.pending) { enterRoom(data); return; }
        if (!data.pending || data.approval_required !== true || typeof data.request_token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(data.request_token) || !/^\d{8}$/.test(data.approval_code) || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 180) throw new Error('invalid-approval');
        approvalToken = data.request_token;
        approvalExpires = Date.now() + data.expires_in * 1000;
        ticket = '';
        $('login-form').hidden = true;
        $('approval').hidden = false;
        $('approval-command').value = `/기능 인증 ${data.approval_code}`;
        $('approval-status').textContent = '승인을 기다리고 있습니다. 3분 안에 입력해 주세요.';
        $('approval-title').focus();
        approvalTimer = setTimeout(() => pollApproval(epoch), 2000);
      } catch (error) {
        if (epoch !== requestEpoch) return;
        if (error.status === 403 || error.status === 410) { showAuth('사용할 수 없는 접속 링크입니다. 카카오톡에서 /기능을 입력해 새 링크로 접속해 주세요.'); return; }
        $('auth-error').textContent = error.status === 401 ? '비밀번호를 확인해 주세요. 링크가 만료되었다면 /기능에서 새 링크를 받아 주세요.' : error.status === 429 ? '접속 시도가 많습니다. 잠시 기다린 뒤 /기능에서 새 링크를 받아 다시 시도해 주세요.' : '연결할 수 없습니다. 잠시 후 다시 시도하거나 /기능으로 새 링크를 받아 주세요.';
        if (error.status === 401) $('password').setAttribute('aria-invalid', 'true');
        $('password').focus();
      } finally {
        password = '';
        if (epoch === requestEpoch) { busy = false; $('login-button').disabled = false; $('login-button').textContent = '방 관리 시작하기 →'; renderFeaturesIfConnected(); }
      }
    });
    async function pollApproval(epoch) {
      if (epoch !== requestEpoch || !approvalToken) return;
      if (Date.now() >= approvalExpires) { showAuth('승인 시간이 만료되었습니다. 카카오톡에서 /기능을 입력해 다시 접속해 주세요.'); return; }
      try {
        const data = await request('/api/approval', 'POST', {request_token: approvalToken}, '');
        if (epoch !== requestEpoch || !approvalToken) return;
        if (Date.now() >= approvalExpires) { showAuth('승인 시간이 만료되었습니다. 카카오톡에서 /기능을 입력해 다시 접속해 주세요.'); return; }
        if (data.pending) {
          approvalTimer = setTimeout(() => pollApproval(epoch), 2000);
          return;
        }
        if (!data || typeof data.token !== 'string' || !data.token || !Number.isFinite(data.expires_in) || data.expires_in <= 0 || data.expires_in > 1800) throw new Error('invalid-session');
        applyState(data);
        token = data.token;
        approvalToken = '';
        $('approval-command').value = '';
        expiresAt = Date.now() + data.expires_in * 1000;
        expiryTimer = setTimeout(expire, data.expires_in * 1000);
        $('auth').hidden = true;
        $('manager').hidden = false;
        $('logout').hidden = false;
        requestAnimationFrame(fitRoomName);
        showNotice('저장된 설정을 불러왔습니다.');
        $('page-title').setAttribute('tabindex', '-1');
        $('page-title').focus();
      } catch (error) {
        if (epoch !== requestEpoch || !approvalToken) return;
        if ([401, 403, 410].includes(error.status)) { showAuth('승인이 만료되었거나 권한이 변경되었습니다. 카카오톡에서 /기능을 입력해 다시 접속해 주세요.'); return; }
        $('approval-status').textContent = '승인 상태를 확인할 수 없습니다. 연결을 확인해 주세요. 남은 시간 동안 다시 확인합니다.';
        approvalTimer = setTimeout(() => pollApproval(epoch), 2000);
      }
    }
    $('copy-approval').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('approval-command').value); $('copy-approval').textContent = '복사했습니다'; }
      catch { $('approval-command').focus(); $('approval-command').select(); $('approval-status').textContent = '명령어를 선택했습니다. 직접 복사해 카카오톡에 입력해 주세요.'; }
    });
    function renderFeaturesIfConnected() { if (state && token) renderFeatures(); }
    $('show-password').addEventListener('click', () => {
      const visible = $('password').type === 'password';
      $('password').type = visible ? 'text' : 'password';
      $('show-password').textContent = visible ? '숨김' : '표시';
      $('show-password').setAttribute('aria-pressed', String(visible));
    });
    $('search').addEventListener('input', () => { if (state) renderFeatures(); });
    $('state-filter').addEventListener('change', () => { if (state) renderFeatures(); });
    $('clear-filters').addEventListener('click', () => { category = ''; $('search').value = ''; $('state-filter').value = 'all'; if (state) { renderCategories(); renderFeatures(); } $('search').focus(); });
    $('refresh').addEventListener('click', () => refresh());
    $('logout').addEventListener('click', async () => {
      if (!token) return;
      const bearer = token;
      const logoutRequest = request('/api/logout', 'POST', {}, bearer);
      showAuth('연결을 종료했습니다. 다시 관리하려면 카카오톡에서 /기능을 입력해 주세요.');
      try { await logoutRequest; } catch { $('auth-description').textContent = '이 브라우저의 연결을 종료했습니다. 서버에 연결되지 않아 세션은 유효 시간 후 만료됩니다. 다시 관리하려면 /기능을 입력해 주세요.'; }
    });
    document.addEventListener('visibilitychange', () => { if (token && Date.now() >= expiresAt) expire(); });
    window.addEventListener('pagehide', () => { requestEpoch += 1; clearTimeout(approvalTimer); clearTimeout(expiryTimer); token = ''; ticket = ''; approvalToken = ''; fragment = ''; $('password').value = ''; $('approval-command').value = ''; });
    window.addEventListener('pageshow', (event) => { if (event.persisted) showAuth('카카오톡에서 /기능을 입력해 새 링크로 접속해 주세요.'); });
    (async () => {
      const epoch = requestEpoch;
      if (!fragment) return;
      if (!validRoomPath) { showAuth('방 전용 주소가 필요합니다. 해당 채팅방에서 /기능을 입력해 새 링크로 접속해 주세요.'); fragment = ''; return; }
      $('auth-description').textContent = '접속 링크의 서명을 확인하고 있습니다…';
      try {
        const keyURL = new URL('assets/trust-key.json', window.location.href);
        if (keyURL.origin !== window.location.origin) throw new Error('invalid-key-origin');
        const response = await fetch(keyURL, {credentials: 'omit', cache: 'no-store', redirect: 'error', referrerPolicy: 'no-referrer'});
        if (!response.ok) throw new Error('missing-trust-key');
        const connection = await window.IRISConnection.verifyConnection(fragment, await response.json());
        if (epoch !== requestEpoch) return;
        api = connection.api; ticket = connection.ticket;
        $('login-form').hidden = false;
        $('auth-description').textContent = '관리자 비밀번호를 입력하면 이 방의 설정이 바로 열립니다.';
      } catch {
        if (epoch === requestEpoch) showAuth('접속 링크의 서명을 확인할 수 없습니다. 카카오톡에서 /기능을 입력해 새 링크로 접속해 주세요.');
      } finally { fragment = ''; }
    })();
  });
})();
