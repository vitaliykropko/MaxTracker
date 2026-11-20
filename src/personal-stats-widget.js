import { moscowDate, personalStats } from './personal-stats.js';

const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });
const dates = new Intl.DateTimeFormat('ru-RU', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});
const utcDate = day => new Date(day + 'T00:00:00Z');

function duration(ms) {
  if (ms === null) return '—';
  const seconds = Math.round(ms / 1000);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  if (hours) return hours + ' ч ' + minutes + ' мин';
  if (minutes) return minutes + ' мин' + (seconds % 60 ? ' ' + seconds % 60 + ' с' : '');
  return seconds + ' с';
}

export function mountPersonalStats(shadow, { canOpen, onOpen }) {
  const popover = document.createElement('div');
  popover.className = 'personal-wrap';
  popover.hidden = true;
  popover.innerHTML = `
      <section class="personal-panel" aria-labelledby="mta-personal-title">
        <header class="personal-header">
          <strong id="mta-personal-title">Моя статистика</strong>
          <span data-stat-operator></span>
        </header>
        <div class="personal-period" role="group" aria-label="Период статистики">
          <button type="button" data-period="today" aria-pressed="true">Сегодня</button>
          <button type="button" data-period="month" aria-pressed="false">Этот месяц</button>
          <button type="button" data-period="custom" aria-pressed="false" aria-controls="mta-stat-dates">Период</button>
        </div>
        <div class="personal-dates" id="mta-stat-dates" role="group" aria-label="Произвольный период" hidden>
          <label>С <input type="date" data-date-from required></label>
          <label>По <input type="date" data-date-to required></label>
          <button type="button" data-apply-dates>Применить</button>
          <small data-date-error role="alert" hidden>Укажите даты по порядку, до сегодняшнего дня включительно.</small>
        </div>
        <p class="personal-period-note" data-stat-range></p>
        <dl class="personal-totals">
          <div><dt>Взято</dt><dd data-stat="taken"></dd></div>
          <div><dt>Закрыто</dt><dd data-stat="closed"></dd></div>
          <div><dt>Доля закрытых</dt><dd data-stat="rate"></dd></div>
        </dl>
        <dl class="personal-metrics">
          <div><dt data-stat-reply-label></dt><dd data-stat="reply"></dd></div>
          <div><dt>Выполнение · среднее</dt><dd data-stat="completion"></dd></div>
          <div><dt>По таймеру</dt><dd data-stat="timer"></dd></div>
        </dl>
        <div class="personal-open"><span>Открыто сейчас</span><strong data-stat="open"></strong></div>
        <details class="personal-chats">
          <summary><span data-stat-chat>По чатам</span></summary>
          <div class="personal-chat-columns" aria-hidden="true"><span></span><span>Взято</span><span>Закрыто</span></div>
          <div class="personal-chat-rows" role="group" aria-label="Фильтр по чатам"></div>
        </details>
      </section>
  `;
  shadow.append(popover);

  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.setAttribute('data-maxtracker-ui', '');
  trigger.setAttribute('data-maxtracker-personal', '');
  trigger.setAttribute('aria-label', 'Моя статистика');
  trigger.setAttribute('aria-expanded', 'false');
  trigger.innerHTML = `<span aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" style="display:block" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5h16M7 15.5v-4m5 4v-8m5 8v-11"/></svg></span><span>Статистика</span>`;
  const [triggerIcon, triggerCaption] = trigger.children;
  const periodButtons = [...popover.querySelectorAll('[data-period]')];
  const editor = popover.querySelector('.personal-dates');
  const from = editor.querySelector('[data-date-from]');
  const to = editor.querySelector('[data-date-to]');
  const dateError = editor.querySelector('[data-date-error]');
  const chatRows = popover.querySelector('.personal-chat-rows');
  const values = Object.fromEntries([...popover.querySelectorAll('[data-stat]')].map(el => [el.dataset.stat, el]));
  const replyLabel = popover.querySelector('[data-stat-reply-label]');
  const chatLabel = popover.querySelector('[data-stat-chat]');
  const rangeLabel = popover.querySelector('[data-stat-range]');
  const operator = popover.querySelector('[data-stat-operator]');
  let settingsButton;
  let state;
  let frozen = true;
  let mode = 'today';
  let custom;
  let selectedChat = null;
  let signature = '';
  let pinned = false;
  let hovering = false;
  let closeTimer;

  function mount() {
    if (!state?.deviceId) return;
    if (settingsButton?.isConnected && trigger.nextElementSibling === settingsButton) return;
    const settings = [...document.querySelectorAll('nav .settings > button')].find(button =>
      /^(?:Настройки|Настройка|Settings)$/i.test(button.querySelector(':scope > .title')?.textContent.trim() || '')
    );
    const icon = settings?.querySelector(':scope > .icon');
    const caption = settings?.querySelector(':scope > .title');
    if (!icon || !caption) {
      trigger.remove();
      close();
      return;
    }
    settingsButton = settings;
    trigger.className = settings.className;
    trigger.classList.toggle('button--active', !popover.hidden);
    triggerIcon.className = icon.className;
    triggerCaption.className = caption.className;
    const gap = getComputedStyle(settings.parentElement.parentElement).rowGap;
    trigger.style.marginBottom = gap === 'normal' ? '8px' : gap;
    settings.before(trigger);
    positionPopover();
  }

  function positionPopover() {
    if (popover.hidden || !trigger.isConnected) return;
    const anchor = trigger.getBoundingClientRect();
    if (!anchor.width || !anchor.height) { close(); return; }
    const edge = 8;
    const right = innerWidth - anchor.right - 2 * edge;
    const left = anchor.left - 2 * edge;
    const side = Math.max(right, left);
    const beside = side >= 216;
    const width = Math.min(324, beside ? side : innerWidth - 2 * edge);
    popover.style.width = width + 'px';
    const height = popover.offsetHeight;
    const x = beside
      ? (right >= left ? anchor.right + edge : anchor.left - width - edge)
      : Math.max(edge, Math.min(anchor.left, innerWidth - width - edge));
    const y = beside ? anchor.top : (anchor.top - height >= edge ? anchor.top - height - edge : anchor.bottom + edge);
    popover.style.left = x + 'px';
    popover.style.top = Math.max(edge, Math.min(y, innerHeight - height - edge)) + 'px';
  }

  function rangeFor(today) {
    if (mode === 'custom') return custom;
    return { from: mode === 'month' ? today.slice(0, 8) + '01' : today, to: today };
  }

  function chatButton(title, stats, id) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'personal-chat-row';
    button.setAttribute('aria-pressed', String(id === selectedChat));
    button.setAttribute('aria-label', title + ', взято ' + stats.taken + ', закрыто ' + stats.closed);
    for (const value of [title, stats.taken, stats.closed]) {
      const span = document.createElement('span');
      span.textContent = value;
      button.append(span);
    }
    button.onclick = () => {
      selectedChat = id;
      render();
    };
    return button;
  }

  function renderChats(report) {
    const next = JSON.stringify([
      selectedChat, report.total.taken, report.total.closed,
      report.chats.map(({ id, title, taken, closed }) => [id, title, taken, closed])
    ]);
    if (next === signature) return;
    signature = next;
    const focused = chatRows.contains(shadow.activeElement);
    const buttons = [
      chatButton('Все чаты', report.total, null),
      ...report.chats.map(chat => chatButton(chat.title, chat, chat.id))
    ];
    chatRows.replaceChildren(...buttons);
    if (focused) chatRows.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
  }

  function render() {
    if (popover.hidden || !state) return;
    const now = Date.now();
    const today = moscowDate(now);
    const range = rangeFor(today);
    const report = personalStats(state, range, now, frozen);
    const selected = report.chats.find(chat => chat.id === selectedChat);
    if (!selected) selectedChat = null;
    const stats = selected ?? report.total;
    const text = {
      taken: stats.taken, closed: stats.closed,
      rate: stats.rate === null ? '—' : percent.format(stats.rate),
      reply: duration(stats.replyMs), completion: duration(stats.completionMs),
      timer: duration(stats.timerMs),
      open: stats.running + ' в работе · ' + stats.paused + ' на паузе'
    };
    for (const [key, value] of Object.entries(text)) {
      if (values[key].textContent !== String(value)) values[key].textContent = value;
    }
    replyLabel.textContent = stats.arrivalCount ? 'Первый ответ · среднее' : 'От взятия до ответа';
    replyLabel.title = stats.arrivalCount
      ? 'От поступления сообщения до моего ответа. Известно время поступления для ' + stats.arrivalCount + ' из ' + stats.replyCount + ' ответов.'
      : 'Среднее время от взятия обращения до моего ответа.';
    rangeLabel.title = 'Взято, закрыто и время считаются для обращений, взятых в работу за этот период.';
    rangeLabel.textContent = dates.formatRange(utcDate(range.from), utcDate(range.to)) + ' · МСК';
    from.max = to.max = today;
    operator.textContent = state.config?.operatorName || '';
    chatLabel.textContent = selected ? 'Чат · ' + selected.title : 'По чатам';
    for (const button of periodButtons) button.setAttribute('aria-pressed', String(button.dataset.period === mode));
    renderChats(report);
  }

  function setOpen(open) {
    clearTimeout(closeTimer);
    const show = open && trigger.isConnected && canOpen();
    if (show && popover.hidden) onOpen();
    popover.hidden = !show;
    trigger.setAttribute('aria-expanded', String(show));
    trigger.setAttribute('aria-pressed', String(show && pinned));
    trigger.classList.toggle('button--active', show);
    if (show) {
      render();
      positionPopover();
    }
  }
  function close() {
    pinned = false;
    setOpen(false);
  }
  function dismissIfUnused() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!pinned && !hovering && document.activeElement !== trigger && !popover.matches(':focus-within')) setOpen(false);
    }, 180);
  }

  for (const button of periodButtons) {
    button.addEventListener('click', () => {
      if (button.dataset.period === 'custom') {
        editor.hidden = !editor.hidden;
        if (!editor.hidden) {
          const range = custom ?? rangeFor(moscowDate());
          from.value = range.from;
          to.value = range.to;
          dateError.hidden = true;
        }
        return;
      }
      mode = button.dataset.period;
      editor.hidden = true;
      render();
    });
  }
  editor.querySelector('[data-apply-dates]').onclick = () => {
    const valid = from.validity.valid && to.validity.valid && from.value <= to.value && to.value <= moscowDate();
    dateError.hidden = !!valid;
    if (!valid) return;
    custom = { from: from.value, to: to.value };
    mode = 'custom';
    editor.hidden = true;
    periodButtons.find(button => button.dataset.period === 'custom').focus({ preventScroll: true });
    render();
  };
  editor.addEventListener('input', () => { dateError.hidden = true; });

  for (const surface of [trigger, popover]) {
    surface.addEventListener('pointerenter', event => {
      if (event.pointerType !== 'touch') {
        hovering = true;
        setOpen(true);
      }
    });
    surface.addEventListener('pointerleave', () => {
      hovering = false;
      dismissIfUnused();
    });
    surface.addEventListener('focusout', dismissIfUnused);
  }
  trigger.onclick = () => {
    pinned = !pinned;
    setOpen(pinned);
  };
  document.addEventListener('pointerdown', event => {
    const path = event.composedPath();
    if (!popover.hidden && !path.includes(trigger) && !path.includes(popover)) close();
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || popover.hidden) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (popover.matches(':focus-within')) trigger.focus({ preventScroll: true });
    close();
  }, true);
  new ResizeObserver(positionPopover).observe(popover);
  window.addEventListener('resize', positionPopover);
  window.addEventListener('scroll', positionPopover, { capture: true, passive: true });

  return {
    close,
    mount,
    update(nextState, isFrozen) {
      state = nextState;
      frozen = isFrozen;
      render();
    },
    tick: render
  };
}
