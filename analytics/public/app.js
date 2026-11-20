import { dayMs, moscowDay, projectScope, summarize as summarizeCases } from './report.js';

(() => {
    const root = document.getElementById('maxtracker-analytics');
    let departmentNames = {};
    let chatNames = {};
    let staff = [];
    let snapshot = null;
    let today = moscowDay(Date.now());
    let historyStart = null;
    let hasReceivedTimes = false;
    const unnamedChat = '@unnamed';
    const dayDate = day => new Date(day * dayMs);
    const dateKey = day => dayDate(day).toISOString().slice(0, 10);
    const storageKey = 'maxtracker.analytics.filters';
    const groupTitles = { overall: 'Сводка', chats: 'Чат', employees: 'Сотрудник', departments: 'Отдел' };
    const countTitles = {
      overall: 'Обращения по чатам',
      chats: 'Обращения по чатам',
      employees: 'Обращения по сотрудникам',
      departments: 'Обращения по отделам'
    };
    const number = new Intl.NumberFormat('ru-RU');
    const fractional = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 });
    const percent = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: 0 });
    const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
    const chartDateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', timeZone: 'UTC' });
    const yearDateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
    const yearChartFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
    const periodButtons = [...root.querySelectorAll('[data-period]')];
    const customPeriodButton = root.querySelector('[data-period="custom"]');
    const dateForm = root.querySelector('#mt-date-form');
    const dateFrom = root.querySelector('[data-date-from]');
    const dateTo = root.querySelector('[data-date-to]');
    const dateError = root.querySelector('[data-date-error]');
    const dateCoverage = root.querySelector('[data-date-coverage]');
    const groupButtons = [...root.querySelectorAll('[data-group]')];
    const departmentControl = root.querySelector('[data-department]');
    const chatControl = root.querySelector('[data-chat]');
    const metrics = Object.fromEntries([...root.querySelectorAll('[data-metric]')].map(element => [element.dataset.metric, element]));
    const tbody = root.querySelector('[data-rows]');
    const pauseList = root.querySelector('[data-pauses]');
    const volume = root.querySelector('[data-volume]');
    const counts = root.querySelector('[data-counts]');
    const speed = root.querySelector('[data-speed]');
    const selection = root.querySelector('[data-selection]');
    const source = root.querySelector('[data-source]');
    const settings = root.querySelector('#mt-settings');
    const reportContent = root.querySelector('[data-report-content]');
    const settingsButton = root.querySelector('[data-open-settings]');
    const refreshButton = root.querySelector('[data-refresh]');
    const settingsStatus = root.querySelector('[data-settings-status]');
    const saveButton = root.querySelector('[data-save-settings]');
    let loading = false;
    let state = {
      period: 'today', from: null, to: null,
      department: 'all', chat: 'all', group: 'overall', bucket: null, entity: null
    };

    const comparesChats = () => state.group === 'chats' || state.group === 'overall';

    function duration(minutes) {
      if (minutes === null) return '—';
      if (minutes < 1) return Math.round(minutes * 60) + ' с';
      const value = Math.round(minutes);
      if (value < 60) return value + ' мин';
      const remainder = value % 60;
      return Math.floor(value / 60) + ' ч' + (remainder ? ' ' + String(remainder).padStart(2, '0') + ' мин' : '');
    }

    function summarize(cohort) {
      return summarizeCases(cohort, hasReceivedTimes);
    }

    function casesInRange(items, firstDay, lastDay) {
      return items.filter(item => item.takenDay >= firstDay && item.takenDay <= lastDay);
    }

    function readRange(from, to) {
      if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return null;
      const first = Date.parse(from + 'T00:00:00Z') / dayMs;
      const last = Date.parse(to + 'T00:00:00Z') / dayMs;
      if (!Number.isInteger(first) || !Number.isInteger(last) || first > last || last > today) return null;
      return dateKey(first) === from && dateKey(last) === to ? { first, last } : null;
    }

    function reportRange() {
      if (state.period === 'month') return { first: today - dayDate(today).getUTCDate() + 1, last: today };
      if (state.period === 'custom') return readRange(state.from, state.to) ?? { first: today, last: today };
      return { first: today, last: today };
    }

    function makeBuckets(range) {
      const days = range.last - range.first + 1;
      const step = Math.ceil(days / 7);
      return Array.from({ length: Math.ceil(days / step) }, (_, index) => {
        const first = range.first + index * step;
        return { first, last: Math.min(range.last, first + step - 1) };
      });
    }

    function dateLabel(first, last, formatter = dateFormat) {
      const from = dayDate(first);
      const to = dayDate(last);
      const year = dayDate(today).getUTCFullYear();
      const sameYear = from.getUTCFullYear() === year && to.getUTCFullYear() === year;
      const display = sameYear ? formatter : formatter === chartDateFormat ? yearChartFormat : yearDateFormat;
      return display.formatRange(from, to);
    }

    function bar(value, maximum) {
      const mark = document.createElement('i');
      mark.style.setProperty('--mt-size', 100 * (value ?? 0) / maximum + '%');
      return mark;
    }

    function chartButton(className, description, pressed) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = className;
      button.setAttribute('aria-label', description);
      button.setAttribute('aria-pressed', String(pressed));
      button.title = description;
      return button;
    }

    function renderVolume(buckets, scopedCases) {
      const counts = buckets.map(({ first, last }) => summarize(casesInRange(scopedCases, first, last)));
      const largest = Math.max(...counts.map(item => item.taken));
      const step = largest > 120 ? 30 : largest > 36 ? 12 : 6;
      const maximum = Math.max(step, Math.ceil(largest / step) * step);
      root.querySelector('[data-chart-range]').textContent = dateLabel(buckets[0].first, buckets.at(-1).last, chartDateFormat);
      root.querySelector('[data-volume-axis]').replaceChildren(...[maximum, maximum * 2 / 3, maximum / 3, 0].map(value => {
        const label = document.createElement('span');
        label.textContent = value;
        return label;
      }));
      volume.style.setProperty('--mt-bucket-count', buckets.length);
      volume.replaceChildren(...buckets.map(({ first, last }, index) => {
        const { taken, closed } = counts[index];
        const key = dateKey(first);
        const selected = state.bucket === key || buckets.length === 1;
        const caption = dateLabel(first, last) + ' · взято ' + number.format(taken) + ' · закрыто ' + number.format(closed);
        const button = chartButton('mt-bucket', caption, selected);
        button.dataset.bucket = key;
        const bars = document.createElement('span');
        bars.className = 'mt-bars';
        bars.setAttribute('aria-hidden', 'true');
        bars.append(bar(taken, maximum), bar(closed, maximum));
        const label = document.createElement('span');
        label.className = 'mt-bucket-label';
        const from = dayDate(first).getUTCDate();
        label.textContent = first === last ? from : from + '–' + dayDate(last).getUTCDate();
        button.append(bars, label);
        return button;
      }));
    }

    function renderCounts(groups, selectedId) {
      const maximum = Math.max(1, groups[0]?.summary.taken ?? 0);
      counts.replaceChildren(...groups.map(group => {
        const taken = number.format(group.summary.taken);
        const description = group.name + ' · взято ' + taken + ' · закрыто ' + number.format(group.summary.closed);
        const button = chartButton('mt-count-row', description, selectedId === group.id);
        button.dataset.entity = group.id;
        const label = document.createElement('span');
        label.className = 'mt-chart-label';
        label.textContent = group.name;
        const track = document.createElement('span');
        track.className = 'mt-count-track';
        track.setAttribute('aria-hidden', 'true');
        track.append(bar(group.summary.taken, maximum));
        const value = document.createElement('span');
        value.className = 'mt-count-value';
        value.textContent = taken;
        button.append(label, track, value);
        return button;
      }));
    }

    function renderSpeed(groups, selectedId) {
      const maximum = Math.max(1, ...groups.flatMap(({ summary }) => [summary.reply, summary.completion]));
      speed.replaceChildren(...groups.map(group => {
        const { reply, completion } = group.summary;
        const replyLabel = hasReceivedTimes ? 'первый ответ' : 'до ответа после взятия';
        const description = group.name + ' · ' + replyLabel + ' ' + duration(reply) + ' · выполнение ' + duration(completion);
        const button = chartButton('mt-speed-row', description, selectedId === group.id);
        button.dataset.entity = group.id;
        const label = document.createElement('span');
        label.className = 'mt-chart-label';
        label.textContent = group.name;
        const bars = document.createElement('span');
        bars.className = 'mt-speed-bars';
        bars.setAttribute('aria-hidden', 'true');
        for (const amount of [reply, completion]) {
          const measure = document.createElement('span');
          measure.className = 'mt-speed-measure';
          const value = document.createElement('span');
          value.textContent = amount === null ? '—' : fractional.format(amount);
          measure.append(bar(amount, maximum), value);
          bars.append(measure);
        }
        button.append(label, bars);
        return button;
      }));
    }

    function rowFor(name, department, summary) {
      const row = document.createElement('tr');
      row.setAttribute('role', 'row');
      const heading = document.createElement('th');
      heading.scope = 'row';
      heading.setAttribute('role', 'rowheader');
      heading.textContent = name;
      if (department) {
        const subtitle = document.createElement('small');
        subtitle.textContent = department;
        heading.append(subtitle);
      }
      row.append(heading);
      const values = [
        ['Взято', number.format(summary.taken)],
        ['Закрыто', number.format(summary.closed)],
        ['Доля', summary.rate === null ? '—' : percent.format(summary.rate)],
        [hasReceivedTimes ? 'Первый ответ' : 'До ответа', duration(summary.reply)],
        ['Выполнение', duration(summary.completion)],
        ['По таймеру', duration(summary.timer)]
      ];
      for (const [label, value] of values) {
        const cell = document.createElement('td');
        cell.setAttribute('role', 'cell');
        cell.dataset.label = label;
        cell.textContent = value;
        row.append(cell);
      }
      return row;
    }

    function renderPauses(items) {
      const longPauses = items.filter(item => item.pause > 60).sort((first, second) => second.pause - first.pause);
      if (!longPauses.length) {
        const empty = document.createElement('li');
        empty.textContent = 'Долгих пауз нет';
        pauseList.replaceChildren(empty);
        return;
      }
      pauseList.replaceChildren(...longPauses.map(item => {
        const row = document.createElement('li');
        const name = document.createElement('strong');
        name.textContent = chatNames[item.chat] + ' · #' + item.id;
        const owner = document.createElement('small');
        owner.textContent = staff.find(person => person.id === item.open.owner)?.name ?? 'Сотрудник';
        const time = document.createElement('span');
        time.textContent = duration(item.pause);
        row.append(name, owner, time);
        return row;
      }));
    }

    function buildGroups(scope, availableChats) {
      if (comparesChats()) {
        return Object.entries(chatNames)
          .filter(([id]) => availableChats.has(id))
          .map(([id, name]) => ({ id, name }));
      }
      if (state.group === 'departments') {
        return [...new Set(scope.map(person => person.department))].map(department => {
          const owners = new Set(scope.filter(person => person.department === department).map(person => person.id));
          return { id: department, name: departmentNames[department], owners };
        });
      }
      const employees = new Map();
      for (const person of scope) {
        const id = person.custom.name
          ? 'employee:' + JSON.stringify([person.custom.name.toLocaleLowerCase('ru'), person.department])
          : person.id;
        const employee = employees.get(id) ?? {
          id, name: person.name,
          department: state.department === 'all' ? departmentNames[person.department] : null,
          owners: new Set()
        };
        employee.owners.add(person.id);
        employees.set(id, employee);
      }
      return [...employees.values()];
    }

    function render() {
      if (!snapshot) return;
      const scope = staff.filter(person => state.department === 'all' || person.department === state.department);
      const scopeIds = new Set(scope.map(person => person.id));
      const departmentCases = projectScope(snapshot.appeals, scopeIds);
      const availableChats = new Set(departmentCases.map(item => item.chat));
      if (state.chat !== 'all' && !availableChats.has(state.chat)) state.chat = 'all';
      const scopedCases = state.chat === 'all' ? departmentCases : departmentCases.filter(item => item.chat === state.chat);
      const range = reportRange();
      const buckets = makeBuckets(range);
      const bucket = buckets.length === 1 ? null : buckets.find(item => dateKey(item.first) === state.bucket);
      if (!bucket) state.bucket = null;
      const first = bucket?.first ?? range.first;
      const last = bucket?.last ?? range.last;
      const compareByChat = comparesChats();
      const scopedAppeals = state.chat === 'all' ? snapshot.appeals : snapshot.appeals.filter(item => item.chat === state.chat);
      const groups = buildGroups(scope, availableChats);
      for (const group of groups) {
        group.cases = compareByChat
          ? departmentCases.filter(item => item.chat === group.id)
          : projectScope(scopedAppeals, group.owners);
        group.summary = summarize(casesInRange(group.cases, first, last));
      }
      const selected = compareByChat ? null : groups.find(item => item.id === state.entity);
      if (!selected) state.entity = null;
      const visibleCases = selected?.cases ?? scopedCases;
      const open = visibleCases.filter(item => item.open).map(item => ({
        ...item,
        pause: item.open.pausedAt === null ? null : Math.max(0, (snapshot.fetchedAt - item.open.pausedAt) / 60000)
      }));
      const paused = open.filter(item => item.pause !== null).length;
      const summary = selected?.summary ?? summarize(casesInRange(visibleCases, first, last));

      metrics.rate.textContent = summary.rate === null ? '—' : percent.format(summary.rate);
      metrics.count.textContent = number.format(summary.closed) + ' из ' + number.format(summary.taken) + ' взятых';
      metrics.reply.textContent = duration(summary.reply);
      metrics.completion.textContent = duration(summary.completion);
      metrics.open.textContent = number.format(open.length);
      metrics.running.textContent = number.format(open.length - paused) + ' в работе';
      metrics.paused.textContent = number.format(paused) + ' на паузе';
      root.querySelector('[data-rate-bar]').style.width = (summary.rate ?? 0) * 100 + '%';

      root.querySelector('[data-group-column]').textContent = groupTitles[state.group];
      root.querySelector('[data-reply-label]').textContent = hasReceivedTimes ? 'Первый ответ · среднее' : 'До ответа · среднее';
      root.querySelector('[data-reply-description]').textContent = hasReceivedTimes
        ? 'От сообщения · известные даты'
        : 'С момента взятия в работу';
      for (const field of ['data-reply-legend', 'data-reply-column']) {
        root.querySelector('[' + field + ']').textContent = hasReceivedTimes ? 'Первый ответ' : 'До ответа';
      }
      let tableGroups = selected ? [selected] : groups;
      if (state.group === 'overall') tableGroups = [{ name: 'Итого', summary }];
      if (state.group === 'chats' && state.chat !== 'all') tableGroups = groups.filter(group => group.id === state.chat);
      tbody.replaceChildren(...tableGroups.map(group => rowFor(group.name, group.department, group.summary)));
      const filters = [bucket && dateLabel(first, last), chatNames[state.chat], selected?.name].filter(Boolean);
      selection.hidden = !filters.length;
      root.querySelector('[data-selection-label]').textContent = filters.join(' · ');
      const active = root.ownerDocument.activeElement;
      const bucketFocus = volume.contains(active) ? active.dataset.bucket : null;
      const activeChart = [counts, speed].find(chart => chart.contains(active));
      const entityFocus = activeChart ? active.dataset.entity : null;
      const marked = comparesChats() ? state.chat : state.entity;
      const ranked = [...groups].sort((first, second) => second.summary.taken - first.summary.taken);
      renderVolume(buckets, visibleCases);
      root.querySelector('#mt-count-title').textContent = countTitles[state.group];
      const coverage = historyStart !== null && first < historyStart
        ? ' · журнал с ' + chartDateFormat.format(dayDate(historyStart))
        : '';
      root.querySelector('[data-count-range]').textContent = dateLabel(first, last, chartDateFormat) + coverage;
      renderCounts(ranked, marked);
      root.querySelector('#mt-speed-title').textContent = comparesChats() ? 'Скорость по чатам' : 'Скорость обработки';
      renderSpeed(ranked, marked);
      if (bucketFocus !== null) volume.querySelector('[data-bucket="' + bucketFocus + '"]')?.focus({ preventScroll: true });
      if (entityFocus !== null) activeChart.querySelector('[data-entity="' + CSS.escape(entityFocus) + '"]')?.focus({ preventScroll: true });
      renderPauses(open);
      for (const button of periodButtons) button.setAttribute('aria-pressed', String(button.dataset.period === state.period));
      for (const button of groupButtons) button.setAttribute('aria-pressed', String(button.dataset.group === state.group));
      departmentControl.value = state.department;
      for (const option of chatControl.options) option.disabled = option.value !== 'all' && !availableChats.has(option.value);
      chatControl.value = state.chat;
    }

    function updateDateCoverage() {
      const draft = readRange(dateFrom.value, dateTo.value);
      dateCoverage.hidden = !draft || historyStart === null || draft.first >= historyStart;
      if (!dateCoverage.hidden) dateCoverage.textContent = 'Журнал доступен с ' + yearDateFormat.format(dayDate(historyStart));
    }

    function positionDateForm() {
      const anchor = customPeriodButton.getBoundingClientRect();
      const panel = root.getBoundingClientRect();
      const viewport = root.ownerDocument.documentElement;
      const margin = 8;
      const leftEdge = Math.max(margin, panel.left + margin);
      const rightEdge = Math.min(viewport.clientWidth - margin, panel.right - margin);
      const width = Math.min(320, rightEdge - leftEdge);
      dateForm.style.width = width + 'px';
      dateForm.style.left = Math.max(leftEdge, Math.min(anchor.right - width, rightEdge - width)) + 'px';
      const height = dateForm.offsetHeight;
      const bottomEdge = Math.min(viewport.clientHeight - margin, panel.bottom - margin);
      const below = anchor.bottom + margin;
      const above = anchor.top - margin - height;
      const top = below + height > bottomEdge && above >= margin ? above : Math.max(margin, Math.min(below, bottomEdge - height));
      dateForm.style.top = top + 'px';
    }

    function restore(saved) {
      if (!saved) return;
      const previousPeriod = String(saved.period);
      const legacyModes = { 1: 'today', 7: 'custom', 30: 'month' };
      const migratedMode = Object.hasOwn(legacyModes, previousPeriod) ? legacyModes[previousPeriod] : previousPeriod;
      const period = ['today', 'month', 'custom'].includes(migratedMode) ? migratedMode : state.period;
      const restoredRange = readRange(saved.from, saved.to)
        ?? (previousPeriod === '7' ? { first: today - 6, last: today } : null);
      const restoredBucket = previousPeriod === '7' && Number.isInteger(saved.bucket) && saved.bucket >= today - 6 && saved.bucket <= today
        ? dateKey(saved.bucket) : typeof saved.bucket === 'string' ? saved.bucket : null;
      state = {
        period,
        from: restoredRange ? dateKey(restoredRange.first) : null,
        to: restoredRange ? dateKey(restoredRange.last) : null,
        department: saved.department === 'all' || Object.hasOwn(departmentNames, saved.department) ? saved.department : state.department,
        chat: Object.hasOwn(chatNames, saved.chat) ? saved.chat : 'all',
        group: Object.hasOwn(groupTitles, saved.group) ? saved.group : state.group,
        bucket: restoredBucket,
        entity: typeof saved.entity === 'string' ? saved.entity : null
      };
      render();
    }

    function select(change) {
      state = { ...state, ...change };
      render();
      localStorage.setItem(storageKey, JSON.stringify(state));
    }

    function populateCatalog(data) {
      const names = new Map();
      staff = data.people.map(person => {
        const id = person.department ? 'department:' + person.department : 'unassigned';
        names.set(id, person.department || 'Без отдела');
        return { ...person, department: id };
      }).sort((first, second) => first.name.localeCompare(second.name, 'ru'));
      departmentNames = Object.fromEntries(names);
      chatNames = Object.fromEntries(data.chats.filter(chat => chat.name).map(chat => [chat.id, chat.name]));
      if (data.chats.some(chat => !chat.name)) chatNames[unnamedChat] = 'Чаты без названия';
      for (const [control, values, allLabel] of [
        [departmentControl, departmentNames, 'Все отделы'],
        [chatControl, chatNames, 'Все чаты']
      ]) {
        const choices = Object.entries(values).sort((first, second) => first[1].localeCompare(second[1], 'ru'));
        control.replaceChildren(new Option(allLabel, 'all'), ...choices.map(([id, name]) => new Option(name, id)));
      }
      if (!Object.hasOwn(departmentNames, state.department)) state.department = 'all';
    }

    async function loadReport() {
      if (loading) return;
      loading = true;
      refreshButton.disabled = true;
      try {
        const response = await fetch('/api/report');
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.missing ? 'Журнал LAN-хаба не найден: ' + data.databasePath : data.error);
        }
        const firstLoad = !snapshot;
        const unnamed = new Set(data.chats.filter(chat => !chat.name).map(chat => chat.id));
        snapshot = {
          ...data,
          appeals: data.appeals.map(appeal => unnamed.has(appeal.chat) ? { ...appeal, chat: unnamedChat } : appeal)
        };
        today = moscowDay(data.fetchedAt);
        dateFrom.max = dateKey(today);
        dateTo.max = dateKey(today);
        historyStart = data.earliestEventAt === null ? null : moscowDay(data.earliestEventAt);
        hasReceivedTimes = data.appeals.some(item => item.receivedAt !== null && item.firstReply);
        populateCatalog(data);
        if (firstLoad) {
          try {
            restore(JSON.parse(localStorage.getItem(storageKey)));
          } catch {
            // A saved filter is optional.
          }
        }
        reportContent.hidden = false;
        render();
        const time = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Moscow' });
        const chatStatus = unnamed.size ? ' · без названия: ' + number.format(unnamed.size) : '';
        source.textContent = 'LAN-хаб · ' + number.format(data.events) + ' событий · обновлено в ' + time.format(data.fetchedAt) + ' МСК' + chatStatus;
      } catch (error) {
        source.textContent = error.message || 'Не удалось обновить данные MaxTracker.';
      } finally {
        loading = false;
        refreshButton.disabled = false;
        settingsButton.disabled = !snapshot;
      }
    }

    function settingField(labelText, value, placeholder) {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'text';
      input.maxLength = 100;
      input.value = value;
      if (placeholder) input.placeholder = placeholder;
      label.append(labelText, input);
      return label;
    }

    function settingRow(id, label, ...fields) {
      const row = document.createElement('div');
      row.className = 'mt-settings-row';
      row.dataset.id = id;
      const heading = document.createElement('span');
      heading.className = 'mt-settings-id';
      heading.textContent = label;
      row.append(heading, ...fields);
      return row;
    }

    settingsButton.addEventListener('click', () => {
      if (!snapshot) return;
      settingsStatus.textContent = '';
      settings.querySelector('[data-staff-settings]').replaceChildren(...staff.map(person => settingRow(
        person.id, person.name,
        settingField('Имя в отчёте', person.custom.name ?? '', person.original),
        settingField('Отдел', person.custom.department ?? '', 'Без отдела')
      )));
      settings.querySelector('[data-chat-settings]').replaceChildren(...snapshot.chats.map(chat => settingRow(
        chat.id, chat.name || 'Чат ' + chat.id, settingField('Название в отчёте', chat.name, 'Введите название')
      )));
      settings.showModal();
    });
    root.querySelector('[data-close-settings]').addEventListener('click', () => settings.close());
    saveButton.addEventListener('click', async () => {
      saveButton.disabled = true;
      settingsStatus.textContent = 'Сохраняю…';
      try {
        const rows = selector => [...settings.querySelectorAll(selector + ' .mt-settings-row')];
        const people = rows('[data-staff-settings]').map(row => {
          const [name, department] = row.querySelectorAll('input');
          return { id: row.dataset.id, name: name.value, department: department.value };
        });
        const chats = rows('[data-chat-settings]').map(row => ({ id: row.dataset.id, name: row.querySelector('input').value }));
        const response = await fetch('/api/settings', {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ people, chats })
        });
        if (!response.ok) throw new Error((await response.json()).error);
        settings.close();
        await loadReport();
      } catch (error) {
        settingsStatus.textContent = error.message || 'Не удалось сохранить настройки.';
      } finally {
        saveButton.disabled = false;
      }
    });
    refreshButton.addEventListener('click', loadReport);

    for (const button of periodButtons) {
      if (button === customPeriodButton) continue;
      button.addEventListener('click', () => {
        if (dateForm.matches(':popover-open')) dateForm.hidePopover();
        select({ period: button.dataset.period, bucket: null });
      });
    }
    dateForm.addEventListener('beforetoggle', event => {
      const opening = event.newState === 'open';
      customPeriodButton.setAttribute('aria-expanded', String(opening));
      if (!opening) return;
      const range = readRange(state.from, state.to) ?? reportRange();
      dateFrom.value = dateKey(range.first);
      dateTo.value = dateKey(range.last);
      dateError.hidden = true;
      updateDateCoverage();
      positionDateForm();
    });
    dateForm.addEventListener('toggle', event => {
      if (event.newState !== 'open') return;
      positionDateForm();
      dateFrom.focus({ preventScroll: true });
    });
    root.querySelector('[data-date-apply]').addEventListener('click', () => {
      if (!readRange(dateFrom.value, dateTo.value)) {
        dateError.textContent = 'Укажите даты по порядку, до сегодняшнего дня включительно.';
        dateError.hidden = false;
        positionDateForm();
        dateTo.focus({ preventScroll: true });
        return;
      }
      select({ period: 'custom', from: dateFrom.value, to: dateTo.value, bucket: null });
      dateForm.hidePopover();
    });
    dateForm.addEventListener('input', () => {
      dateError.hidden = true;
      updateDateCoverage();
      positionDateForm();
    });
    const repositionOpenDates = () => {
      if (dateForm.matches(':popover-open')) positionDateForm();
    };
    window.addEventListener('resize', repositionOpenDates);
    window.addEventListener('scroll', repositionOpenDates, { passive: true });
    for (const button of groupButtons) button.addEventListener('click', () => select({ group: button.dataset.group, entity: null }));
    departmentControl.addEventListener('change', () => select({ department: departmentControl.value, entity: null }));
    chatControl.addEventListener('change', () => select({ chat: chatControl.value, entity: null }));
    volume.addEventListener('click', event => {
      const button = event.target.closest('[data-bucket]');
      if (!button) return;
      const bucket = button.dataset.bucket;
      if (volume.children.length > 1) select({ bucket: state.bucket === bucket ? null : bucket });
    });
    for (const chart of [counts, speed]) {
      chart.addEventListener('click', event => {
        const button = event.target.closest('[data-entity]');
        if (!button) return;
        const entity = button.dataset.entity;
        if (comparesChats()) {
          select({ chat: state.chat === entity ? 'all' : entity, entity: null });
          return;
        }
        select({ entity: state.entity === entity ? null : entity });
      });
    }
    root.querySelector('[data-reset]').addEventListener('click', () => {
      select({ bucket: null, entity: null, chat: 'all' });
      root.querySelector('[data-period][aria-pressed="true"]').focus({ preventScroll: true });
    });
    settingsButton.disabled = true;
    void loadReport();
    window.setInterval(() => {
      if (!document.hidden && !settings.open && !dateForm.matches(':popover-open')) void loadReport();
    }, 30000);
  })();
