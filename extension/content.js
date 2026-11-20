(() => {
  // src/export-report.js
  var TIME_ZONE = "Europe/Moscow";
  var monthFormat = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, year: "numeric", month: "long" });
  var dateFormat = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  var monthKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" });

  // src/task-state.js
  var OPEN = /* @__PURE__ */ new Set(["running", "paused"]);
  var messageKey = (value) => JSON.stringify([value.chatId, value.messageId]);
  var isChatExcluded = (state2, chatId) => state2?.excludedChats?.includes(chatId) ?? false;
  var elapsed = (task, now = Date.now()) => Math.max(0, Math.round(
    (task.accumulatedMs || 0) + (task.status === "running" ? Math.max(0, now - task.lastResumeTime) : 0)
  ));

  // src/max-chat-route.js
  function maxChatIdFromPath(pathname) {
    return /^\/(-?[1-9]\d{0,19})(?:\/|$)/.exec(pathname)?.[1] ?? null;
  }

  // src/max-profile.js
  function cachedMaxProfile(doc) {
    if (doc?.maxCompatibility?.hubUrl !== doc?.config?.lanUrl) return null;
    return doc?.maxCompatibility?.profile || null;
  }

  // src/personal-stats.js
  var calendar = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Moscow",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  });
  var moscowDate = (now = Date.now()) => calendar.format(now);
  var timestamp = (value) => Number.isSafeInteger(value) && value > 0 && value <= 864e13;
  var timer = (value) => Number.isFinite(value) && value >= 0;
  var named = (value) => typeof value === "string" ? value.trim() : "";
  function emptySummary() {
    return {
      taken: 0,
      closed: 0,
      running: 0,
      paused: 0,
      timerTotal: 0,
      timerCount: 0,
      closeTotal: 0,
      replyTotal: 0,
      replyCount: 0,
      arrivalTotal: 0,
      arrivalCount: 0
    };
  }
  function summaryResult(value) {
    return {
      taken: value.taken,
      closed: value.closed,
      rate: value.taken ? value.closed / value.taken : null,
      running: value.running,
      paused: value.paused,
      timerMs: value.timerCount ? value.timerTotal : null,
      completionMs: value.closed ? value.closeTotal / value.closed : null,
      replyMs: value.arrivalCount ? value.arrivalTotal / value.arrivalCount : value.replyCount ? value.replyTotal / value.replyCount : null,
      replyCount: value.replyCount,
      arrivalCount: value.arrivalCount
    };
  }
  function ownAppeals(state2, now, frozen) {
    const appeals = /* @__PURE__ */ new Map();
    if (!state2?.deviceId) return appeals;
    const messages = state2.messages || {};
    const remember = (value) => {
      const key = messageKey(value);
      if (!appeals.has(key)) appeals.set(key, {
        chatId: value.chatId,
        title: "",
        startedAt: Infinity,
        requestTime: null,
        firstReply: null,
        lastReply: null,
        sessions: /* @__PURE__ */ new Map(),
        current: messages[key]
      });
      const appeal = appeals.get(key);
      const metadata = state2.metadata?.[key];
      appeal.title ||= named(metadata?.chatTitle) || named(value.chatTitle);
      if (timestamp(value.startedAt) && value.startedAt <= now) {
        appeal.startedAt = Math.min(appeal.startedAt, value.startedAt);
      }
      for (const candidate of [metadata?.requestTime, value.requestTime]) {
        if (timestamp(candidate) && candidate <= appeal.startedAt) {
          appeal.requestTime = Math.min(appeal.requestTime ?? candidate, candidate);
        }
      }
      return appeal;
    };
    const addReply = (appeal, time) => {
      if (!timestamp(time) || time > now) return;
      appeal.firstReply = Math.min(appeal.firstReply ?? time, time);
      appeal.lastReply = Math.max(appeal.lastReply ?? time, time);
    };
    for (const record of Object.values(state2.records || {})) {
      if (record.deleted || record.ownerDeviceId !== state2.deviceId) continue;
      const appeal = remember(record);
      if (timer(record.elapsedMs)) appeal.sessions.set(record.sessionId, record.elapsedMs);
      const replies = (record.replies || []).filter((reply2) => reply2.sentMessageId && reply2.eventId !== record.transferId);
      for (const reply2 of replies) addReply(appeal, reply2.completedAt);
      if (record.closeReason === "reply") addReply(appeal, record.completedAt);
    }
    for (const task of Object.values(messages)) {
      if (task.ownerDeviceId !== state2.deviceId || !OPEN.has(task.status) && task.status !== "completed") continue;
      const appeal = remember(task);
      if (timer(task.accumulatedMs)) {
        const worked = !frozen && task.status === "running" && timestamp(task.lastResumeTime) ? elapsed(task, now) : task.accumulatedMs;
        appeal.sessions.set(task.sessionId, worked);
      }
      if (task.status === "completed") addReply(appeal, task.closedAt);
    }
    return appeals;
  }
  function personalStats(state2, range, now = Date.now(), frozen = false) {
    const total = emptySummary();
    const chats = /* @__PURE__ */ new Map();
    const appeals = ownAppeals(state2, now, frozen);
    const chatTitles = /* @__PURE__ */ new Map();
    for (const appeal of appeals.values()) {
      if (appeal.title && !chatTitles.has(appeal.chatId)) chatTitles.set(appeal.chatId, appeal.title);
    }
    for (const appeal of appeals.values()) {
      const { current, startedAt, requestTime, firstReply, lastReply } = appeal;
      if (current?.status === "none" && current.closeReason === "reset") continue;
      const isOwn = current?.ownerDeviceId === state2.deviceId;
      const live = isOwn && !isChatExcluded(state2, appeal.chatId);
      const running = live && current.status === "running" && !frozen;
      const paused = live && (current.status === "paused" || current.status === "running" && frozen);
      const day = timestamp(startedAt) ? moscowDate(startedAt) : "";
      const inPeriod = !!day && day >= range.from && day <= range.to;
      if (!inPeriod && !running && !paused) continue;
      let chat = chats.get(appeal.chatId);
      if (!chat) {
        chat = emptySummary();
        chats.set(appeal.chatId, chat);
      }
      const closedAt = current ? isOwn && current.status === "completed" ? current.closedAt : null : lastReply;
      const worked = [...appeal.sessions.values()];
      for (const result of [total, chat]) {
        result.running += Number(running);
        result.paused += Number(paused);
        if (!inPeriod) continue;
        result.taken++;
        if (timestamp(closedAt) && closedAt >= startedAt && closedAt <= now) {
          result.closed++;
          result.closeTotal += closedAt - startedAt;
        }
        if (timestamp(firstReply) && firstReply >= startedAt) {
          result.replyTotal += firstReply - startedAt;
          result.replyCount++;
          if (timestamp(requestTime) && requestTime <= startedAt) {
            result.arrivalTotal += firstReply - requestTime;
            result.arrivalCount++;
          }
        }
        for (const duration2 of worked) result.timerTotal += duration2;
        if (worked.length) result.timerCount++;
      }
    }
    return {
      total: summaryResult(total),
      chats: [...chats].map(([id, summary]) => ({ id, title: chatTitles.get(id) || "\u0427\u0430\u0442 \u0431\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F", ...summaryResult(summary) })).sort((first, second) => second.taken - first.taken || first.title.localeCompare(second.title, "ru"))
    };
  }

  // src/personal-stats-widget.js
  var percent = new Intl.NumberFormat("ru-RU", { style: "percent", maximumFractionDigits: 0 });
  var dates = new Intl.DateTimeFormat("ru-RU", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC"
  });
  var utcDate = (day) => /* @__PURE__ */ new Date(day + "T00:00:00Z");
  function duration(ms) {
    if (ms === null) return "\u2014";
    const seconds = Math.round(ms / 1e3);
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor(seconds / 60) % 60;
    if (hours) return hours + " \u0447 " + minutes + " \u043C\u0438\u043D";
    if (minutes) return minutes + " \u043C\u0438\u043D" + (seconds % 60 ? " " + seconds % 60 + " \u0441" : "");
    return seconds + " \u0441";
  }
  function mountPersonalStats(shadow2, { canOpen, onOpen }) {
    const popover2 = document.createElement("div");
    popover2.className = "personal-wrap";
    popover2.hidden = true;
    popover2.innerHTML = `
      <section class="personal-panel" aria-labelledby="mta-personal-title">
        <header class="personal-header">
          <strong id="mta-personal-title">\u041C\u043E\u044F \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430</strong>
          <span data-stat-operator></span>
        </header>
        <div class="personal-period" role="group" aria-label="\u041F\u0435\u0440\u0438\u043E\u0434 \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0438">
          <button type="button" data-period="today" aria-pressed="true">\u0421\u0435\u0433\u043E\u0434\u043D\u044F</button>
          <button type="button" data-period="month" aria-pressed="false">\u042D\u0442\u043E\u0442 \u043C\u0435\u0441\u044F\u0446</button>
          <button type="button" data-period="custom" aria-pressed="false" aria-controls="mta-stat-dates">\u041F\u0435\u0440\u0438\u043E\u0434</button>
        </div>
        <div class="personal-dates" id="mta-stat-dates" role="group" aria-label="\u041F\u0440\u043E\u0438\u0437\u0432\u043E\u043B\u044C\u043D\u044B\u0439 \u043F\u0435\u0440\u0438\u043E\u0434" hidden>
          <label>\u0421 <input type="date" data-date-from required></label>
          <label>\u041F\u043E <input type="date" data-date-to required></label>
          <button type="button" data-apply-dates>\u041F\u0440\u0438\u043C\u0435\u043D\u0438\u0442\u044C</button>
          <small data-date-error role="alert" hidden>\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0434\u0430\u0442\u044B \u043F\u043E \u043F\u043E\u0440\u044F\u0434\u043A\u0443, \u0434\u043E \u0441\u0435\u0433\u043E\u0434\u043D\u044F\u0448\u043D\u0435\u0433\u043E \u0434\u043D\u044F \u0432\u043A\u043B\u044E\u0447\u0438\u0442\u0435\u043B\u044C\u043D\u043E.</small>
        </div>
        <p class="personal-period-note" data-stat-range></p>
        <dl class="personal-totals">
          <div><dt>\u0412\u0437\u044F\u0442\u043E</dt><dd data-stat="taken"></dd></div>
          <div><dt>\u0417\u0430\u043A\u0440\u044B\u0442\u043E</dt><dd data-stat="closed"></dd></div>
          <div><dt>\u0414\u043E\u043B\u044F \u0437\u0430\u043A\u0440\u044B\u0442\u044B\u0445</dt><dd data-stat="rate"></dd></div>
        </dl>
        <dl class="personal-metrics">
          <div><dt data-stat-reply-label></dt><dd data-stat="reply"></dd></div>
          <div><dt>\u0412\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u0438\u0435 \xB7 \u0441\u0440\u0435\u0434\u043D\u0435\u0435</dt><dd data-stat="completion"></dd></div>
          <div><dt>\u041F\u043E \u0442\u0430\u0439\u043C\u0435\u0440\u0443</dt><dd data-stat="timer"></dd></div>
        </dl>
        <div class="personal-open"><span>\u041E\u0442\u043A\u0440\u044B\u0442\u043E \u0441\u0435\u0439\u0447\u0430\u0441</span><strong data-stat="open"></strong></div>
        <details class="personal-chats">
          <summary><span data-stat-chat>\u041F\u043E \u0447\u0430\u0442\u0430\u043C</span></summary>
          <div class="personal-chat-columns" aria-hidden="true"><span></span><span>\u0412\u0437\u044F\u0442\u043E</span><span>\u0417\u0430\u043A\u0440\u044B\u0442\u043E</span></div>
          <div class="personal-chat-rows" role="group" aria-label="\u0424\u0438\u043B\u044C\u0442\u0440 \u043F\u043E \u0447\u0430\u0442\u0430\u043C"></div>
        </details>
      </section>
  `;
    shadow2.append(popover2);
    const trigger = document.createElement("button");
    trigger.type = "button";
    trigger.setAttribute("data-maxtracker-ui", "");
    trigger.setAttribute("data-maxtracker-personal", "");
    trigger.setAttribute("aria-label", "\u041C\u043E\u044F \u0441\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430");
    trigger.setAttribute("aria-expanded", "false");
    trigger.innerHTML = `<span aria-hidden="true"><svg width="24" height="24" viewBox="0 0 24 24" style="display:block" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 19.5h16M7 15.5v-4m5 4v-8m5 8v-11"/></svg></span><span>\u0421\u0442\u0430\u0442\u0438\u0441\u0442\u0438\u043A\u0430</span>`;
    const [triggerIcon, triggerCaption] = trigger.children;
    const periodButtons = [...popover2.querySelectorAll("[data-period]")];
    const editor = popover2.querySelector(".personal-dates");
    const from = editor.querySelector("[data-date-from]");
    const to = editor.querySelector("[data-date-to]");
    const dateError = editor.querySelector("[data-date-error]");
    const chatRows = popover2.querySelector(".personal-chat-rows");
    const values = Object.fromEntries([...popover2.querySelectorAll("[data-stat]")].map((el) => [el.dataset.stat, el]));
    const replyLabel = popover2.querySelector("[data-stat-reply-label]");
    const chatLabel = popover2.querySelector("[data-stat-chat]");
    const rangeLabel = popover2.querySelector("[data-stat-range]");
    const operator = popover2.querySelector("[data-stat-operator]");
    let settingsButton;
    let state2;
    let frozen = true;
    let mode = "today";
    let custom;
    let selectedChat = null;
    let signature = "";
    let pinned2 = false;
    let hovering2 = false;
    let closeTimer2;
    function mount2() {
      if (!state2?.deviceId) return;
      if (settingsButton?.isConnected && trigger.nextElementSibling === settingsButton) return;
      const settings = [...document.querySelectorAll("nav .settings > button")].find(
        (button) => /^(?:Настройки|Настройка|Settings)$/i.test(button.querySelector(":scope > .title")?.textContent.trim() || "")
      );
      const icon2 = settings?.querySelector(":scope > .icon");
      const caption = settings?.querySelector(":scope > .title");
      if (!icon2 || !caption) {
        trigger.remove();
        close();
        return;
      }
      settingsButton = settings;
      trigger.className = settings.className;
      trigger.classList.toggle("button--active", !popover2.hidden);
      triggerIcon.className = icon2.className;
      triggerCaption.className = caption.className;
      const gap = getComputedStyle(settings.parentElement.parentElement).rowGap;
      trigger.style.marginBottom = gap === "normal" ? "8px" : gap;
      settings.before(trigger);
      positionPopover();
    }
    function positionPopover() {
      if (popover2.hidden || !trigger.isConnected) return;
      const anchor = trigger.getBoundingClientRect();
      if (!anchor.width || !anchor.height) {
        close();
        return;
      }
      const edge = 8;
      const right = innerWidth - anchor.right - 2 * edge;
      const left = anchor.left - 2 * edge;
      const side = Math.max(right, left);
      const beside = side >= 216;
      const width = Math.min(324, beside ? side : innerWidth - 2 * edge);
      popover2.style.width = width + "px";
      const height = popover2.offsetHeight;
      const x = beside ? right >= left ? anchor.right + edge : anchor.left - width - edge : Math.max(edge, Math.min(anchor.left, innerWidth - width - edge));
      const y = beside ? anchor.top : anchor.top - height >= edge ? anchor.top - height - edge : anchor.bottom + edge;
      popover2.style.left = x + "px";
      popover2.style.top = Math.max(edge, Math.min(y, innerHeight - height - edge)) + "px";
    }
    function rangeFor(today) {
      if (mode === "custom") return custom;
      return { from: mode === "month" ? today.slice(0, 8) + "01" : today, to: today };
    }
    function chatButton(title, stats, id) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "personal-chat-row";
      button.setAttribute("aria-pressed", String(id === selectedChat));
      button.setAttribute("aria-label", title + ", \u0432\u0437\u044F\u0442\u043E " + stats.taken + ", \u0437\u0430\u043A\u0440\u044B\u0442\u043E " + stats.closed);
      for (const value of [title, stats.taken, stats.closed]) {
        const span = document.createElement("span");
        span.textContent = value;
        button.append(span);
      }
      button.onclick = () => {
        selectedChat = id;
        render2();
      };
      return button;
    }
    function renderChats(report) {
      const next = JSON.stringify([
        selectedChat,
        report.total.taken,
        report.total.closed,
        report.chats.map(({ id, title, taken, closed }) => [id, title, taken, closed])
      ]);
      if (next === signature) return;
      signature = next;
      const focused = chatRows.contains(shadow2.activeElement);
      const buttons = [
        chatButton("\u0412\u0441\u0435 \u0447\u0430\u0442\u044B", report.total, null),
        ...report.chats.map((chat) => chatButton(chat.title, chat, chat.id))
      ];
      chatRows.replaceChildren(...buttons);
      if (focused) chatRows.querySelector('[aria-pressed="true"]')?.focus({ preventScroll: true });
    }
    function render2() {
      if (popover2.hidden || !state2) return;
      const now = Date.now();
      const today = moscowDate(now);
      const range = rangeFor(today);
      const report = personalStats(state2, range, now, frozen);
      const selected = report.chats.find((chat) => chat.id === selectedChat);
      if (!selected) selectedChat = null;
      const stats = selected ?? report.total;
      const text = {
        taken: stats.taken,
        closed: stats.closed,
        rate: stats.rate === null ? "\u2014" : percent.format(stats.rate),
        reply: duration(stats.replyMs),
        completion: duration(stats.completionMs),
        timer: duration(stats.timerMs),
        open: stats.running + " \u0432 \u0440\u0430\u0431\u043E\u0442\u0435 \xB7 " + stats.paused + " \u043D\u0430 \u043F\u0430\u0443\u0437\u0435"
      };
      for (const [key, value] of Object.entries(text)) {
        if (values[key].textContent !== String(value)) values[key].textContent = value;
      }
      replyLabel.textContent = stats.arrivalCount ? "\u041F\u0435\u0440\u0432\u044B\u0439 \u043E\u0442\u0432\u0435\u0442 \xB7 \u0441\u0440\u0435\u0434\u043D\u0435\u0435" : "\u041E\u0442 \u0432\u0437\u044F\u0442\u0438\u044F \u0434\u043E \u043E\u0442\u0432\u0435\u0442\u0430";
      replyLabel.title = stats.arrivalCount ? "\u041E\u0442 \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F \u0434\u043E \u043C\u043E\u0435\u0433\u043E \u043E\u0442\u0432\u0435\u0442\u0430. \u0418\u0437\u0432\u0435\u0441\u0442\u043D\u043E \u0432\u0440\u0435\u043C\u044F \u043F\u043E\u0441\u0442\u0443\u043F\u043B\u0435\u043D\u0438\u044F \u0434\u043B\u044F " + stats.arrivalCount + " \u0438\u0437 " + stats.replyCount + " \u043E\u0442\u0432\u0435\u0442\u043E\u0432." : "\u0421\u0440\u0435\u0434\u043D\u0435\u0435 \u0432\u0440\u0435\u043C\u044F \u043E\u0442 \u0432\u0437\u044F\u0442\u0438\u044F \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u0434\u043E \u043C\u043E\u0435\u0433\u043E \u043E\u0442\u0432\u0435\u0442\u0430.";
      rangeLabel.title = "\u0412\u0437\u044F\u0442\u043E, \u0437\u0430\u043A\u0440\u044B\u0442\u043E \u0438 \u0432\u0440\u0435\u043C\u044F \u0441\u0447\u0438\u0442\u0430\u044E\u0442\u0441\u044F \u0434\u043B\u044F \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0439, \u0432\u0437\u044F\u0442\u044B\u0445 \u0432 \u0440\u0430\u0431\u043E\u0442\u0443 \u0437\u0430 \u044D\u0442\u043E\u0442 \u043F\u0435\u0440\u0438\u043E\u0434.";
      rangeLabel.textContent = dates.formatRange(utcDate(range.from), utcDate(range.to)) + " \xB7 \u041C\u0421\u041A";
      from.max = to.max = today;
      operator.textContent = state2.config?.operatorName || "";
      chatLabel.textContent = selected ? "\u0427\u0430\u0442 \xB7 " + selected.title : "\u041F\u043E \u0447\u0430\u0442\u0430\u043C";
      for (const button of periodButtons) button.setAttribute("aria-pressed", String(button.dataset.period === mode));
      renderChats(report);
    }
    function setOpen(open) {
      clearTimeout(closeTimer2);
      const show = open && trigger.isConnected && canOpen();
      if (show && popover2.hidden) onOpen();
      popover2.hidden = !show;
      trigger.setAttribute("aria-expanded", String(show));
      trigger.setAttribute("aria-pressed", String(show && pinned2));
      trigger.classList.toggle("button--active", show);
      if (show) {
        render2();
        positionPopover();
      }
    }
    function close() {
      pinned2 = false;
      setOpen(false);
    }
    function dismissIfUnused() {
      clearTimeout(closeTimer2);
      closeTimer2 = setTimeout(() => {
        if (!pinned2 && !hovering2 && document.activeElement !== trigger && !popover2.matches(":focus-within")) setOpen(false);
      }, 180);
    }
    for (const button of periodButtons) {
      button.addEventListener("click", () => {
        if (button.dataset.period === "custom") {
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
        render2();
      });
    }
    editor.querySelector("[data-apply-dates]").onclick = () => {
      const valid = from.validity.valid && to.validity.valid && from.value <= to.value && to.value <= moscowDate();
      dateError.hidden = !!valid;
      if (!valid) return;
      custom = { from: from.value, to: to.value };
      mode = "custom";
      editor.hidden = true;
      periodButtons.find((button) => button.dataset.period === "custom").focus({ preventScroll: true });
      render2();
    };
    editor.addEventListener("input", () => {
      dateError.hidden = true;
    });
    for (const surface of [trigger, popover2]) {
      surface.addEventListener("pointerenter", (event) => {
        if (event.pointerType !== "touch") {
          hovering2 = true;
          setOpen(true);
        }
      });
      surface.addEventListener("pointerleave", () => {
        hovering2 = false;
        dismissIfUnused();
      });
      surface.addEventListener("focusout", dismissIfUnused);
    }
    trigger.onclick = () => {
      pinned2 = !pinned2;
      setOpen(pinned2);
    };
    document.addEventListener("pointerdown", (event) => {
      const path = event.composedPath();
      if (!popover2.hidden && !path.includes(trigger) && !path.includes(popover2)) close();
    }, true);
    document.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || popover2.hidden) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (popover2.matches(":focus-within")) trigger.focus({ preventScroll: true });
      close();
    }, true);
    new ResizeObserver(positionPopover).observe(popover2);
    window.addEventListener("resize", positionPopover);
    window.addEventListener("scroll", positionPopover, { capture: true, passive: true });
    return {
      close,
      mount: mount2,
      update(nextState, isFrozen) {
        state2 = nextState;
        frozen = isFrozen;
        render2();
      },
      tick: render2
    };
  }

  // src/widget.css
  var widget_default = ':host {\n  all: initial;\n  --mta-default-surface: #fff;\n  --mta-default-secondary: #f5f7fa;\n  --mta-default-text: #060708;\n  --mta-default-muted: #6f737a;\n  --mta-surface: var(--background-primary, var(--mta-default-surface));\n  --mta-secondary: var(--background-secondary, var(--mta-default-secondary));\n  --mta-text: var(--text-primary, var(--mta-default-text));\n  --mta-muted: var(--text-secondary, var(--mta-default-muted));\n  --mta-accent: var(--button-primary, #007aff);\n  --mta-line: color-mix(in srgb, var(--mta-text) 8%, transparent);\n  position: fixed;\n  right: max(20px, env(safe-area-inset-right));\n  bottom: max(20px, env(safe-area-inset-bottom));\n  z-index: 2147483000;\n  display: flex;\n  flex-direction: column;\n  align-items: flex-end;\n  width: 44px;\n  max-height: calc(100dvh - 40px);\n  pointer-events: none;\n  color: var(--mta-text);\n  font: 13px/1.4 var(--font, -apple-system, BlinkMacSystemFont, "Roboto", system-ui, sans-serif);\n  text-align: left;\n}\n* { box-sizing: border-box; }\nbutton { font: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; }\nbutton:disabled { cursor: wait; opacity: .45; }\nbutton:focus-visible { outline: 2px solid var(--mta-accent); outline-offset: 3px; }\nsvg { display: block; width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; flex-shrink: 0; }\n.dock { position: relative; width: 44px; height: 44px; flex-shrink: 0; pointer-events: auto; }\n.launcher { display: grid; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; color: #fff; background: var(--mta-accent); box-shadow: 0 3px 12px color-mix(in srgb, var(--mta-accent) 24%, transparent); font-size: 18px; font-weight: 600; font-variant-numeric: tabular-nums; }\n.launcher:hover { filter: brightness(1.06); }\n.launcher[aria-pressed="true"] { box-shadow: 0 0 0 3px color-mix(in srgb, var(--mta-accent) 20%, transparent); }\n.panel-wrap { position: absolute; right: 0; bottom: 100%; width: min(300px, calc(100vw - 40px)); padding-bottom: 8px; }\n.panel, .dialog, .notice { background: var(--mta-surface); border: 1px solid var(--mta-line); border-radius: 20px; box-shadow: 0 8px 30px #00000014, 0 2px 6px #00000008; }\n.panel { display: flex; flex-direction: column; max-height: min(400px, calc(100dvh - 100px)); overflow: hidden; }\n.bar { display: flex; align-items: center; gap: 8px; padding: 8px 12px 5px 14px; flex-shrink: 0; }\n.bar strong { font-size: 13px; font-weight: 600; }\n.gear, .icon { display: grid; place-items: center; padding: 0; border: 0; border-radius: 50%; width: 26px; height: 26px; flex-shrink: 0; background: transparent; color: var(--mta-muted); }\n.gear { margin-left: auto; width: 28px; height: 28px; }\n.gear svg { width: 17px; height: 17px; }\n.gear:hover, .cancel:hover { background: color-mix(in srgb, var(--mta-text) 7%, transparent); color: var(--mta-text); }\n.tasks { display: flex; flex-direction: column; gap: 4px; padding: 0 6px 6px; overflow: auto; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--mta-line) transparent; min-height: 0; }\n.task { display: flex; align-items: center; gap: 8px; padding: 9px 8px; border-radius: 14px; background: var(--mta-secondary); flex-shrink: 0; }\n.task[data-status="running"] { background: color-mix(in srgb, var(--mta-accent) 7%, var(--mta-surface)); }\n.label { flex: 1; min-width: 0; border: 0; background: transparent; color: inherit; text-align: left; padding: 0; border-radius: 4px; }\n.task-heading { display: flex; align-items: baseline; gap: 8px; }\n.title { flex: 1; min-width: 0; color: var(--mta-muted); font-size: 11px; line-height: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }\n.time { flex-shrink: 0; min-width: 5ch; text-align: right; color: var(--mta-muted); font-size: 11px; line-height: 15px; font-weight: 500; font-variant-numeric: tabular-nums; }\n.task[data-status="running"] .time { color: var(--mta-accent); font-weight: 600; }\n.preview { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; color: var(--mta-text); font-size: 13px; line-height: 17px; margin-top: 2px; }\n.label:hover .preview { color: var(--mta-accent); }\n.controls { display: flex; gap: 2px; flex-shrink: 0; }\n.cancel svg { width: 16px; height: 16px; }\n.toggle { color: var(--mta-accent); background: color-mix(in srgb, var(--mta-accent) 10%, transparent); }\n.task[data-status="running"] .toggle { color: #fff; background: var(--mta-accent); }\n.toggle:hover { filter: brightness(.94); }\n.overlays { width: min(300px, calc(100vw - 40px)); }\n.dialogs:empty { display: none; }\n.dialog { pointer-events: auto; padding: 16px; margin-bottom: 8px; }\n.dialog-icon { display: grid; place-items: center; width: 32px; height: 32px; border-radius: 11px; color: var(--mta-accent); background: color-mix(in srgb, var(--mta-accent) 10%, transparent); margin-bottom: 10px; }\n.dialog strong { display: block; font-size: 14px; font-weight: 600; line-height: 20px; }\n.dialog p { margin: 7px 0 14px; color: var(--mta-muted); font-size: 12px; line-height: 17px; }\n.buttons { display: flex; gap: 8px; }\n.buttons button { flex: 1; border: 0; border-radius: 18px; padding: 9px 10px; background: var(--mta-secondary); color: var(--mta-text); font-weight: 600; font-size: 12px; }\n.buttons button:hover { filter: brightness(.96); }\n.buttons .primary { background: var(--mta-accent); color: #fff; }\n.notice { pointer-events: auto; padding: 12px 14px; margin-bottom: 8px; font-size: 12px; line-height: 17px; border-radius: 16px; }\n.personal-wrap { position: fixed; pointer-events: auto; }\n.personal-panel {\n  max-height: min(540px, calc(100dvh - 16px)); overflow: auto; overscroll-behavior: contain;\n  padding: 13px; border: 1px solid var(--mta-line); border-radius: 18px;\n  background: var(--mta-surface); box-shadow: 0 8px 30px #00000020;\n}\n@media (prefers-reduced-motion: no-preference) {\n  .personal-panel { animation: personal-panel-enter 160ms ease-out; }\n  @keyframes personal-panel-enter {\n    from { opacity: 0; transform: scale(.985); }\n    to { opacity: 1; transform: scale(1); }\n  }\n}\n.personal-header { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }\n.personal-header strong { font-size: 14px; font-weight: 650; }\n.personal-header span { max-width: 48%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: var(--mta-muted); }\n.personal-period {\n  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 3px;\n  padding: 3px; margin-top: 10px; border-radius: 9px; background: var(--mta-secondary);\n}\n.personal-period button, .personal-dates button {\n  border: 0; border-radius: 6px; padding: 5px 3px;\n  background: transparent; color: var(--mta-muted); font-size: 12px;\n}\n.personal-period button[aria-pressed="true"], .personal-dates button {\n  background: color-mix(in srgb, var(--mta-accent) 12%, var(--mta-surface)); color: var(--mta-accent); font-weight: 600;\n}\n.personal-dates { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 5px 8px; margin-top: 8px; }\n.personal-dates label { display: grid; gap: 2px; color: var(--mta-muted); font-size: 11px; }\n.personal-dates input {\n  min-width: 0; width: 100%; border: 1px solid var(--mta-line); border-radius: 6px;\n  padding: 4px; background: var(--mta-secondary); color: var(--mta-text); font: inherit; font-size: 12px;\n}\n.personal-dates :is(button, small) { grid-column: 1 / -1; }\n.personal-dates button { justify-self: end; padding-inline: 10px; }\n.personal-dates small { color: var(--mta-muted); }\n.personal-period-note { margin: 6px 0 8px; color: var(--mta-muted); font-size: 11px; }\n.personal-panel dl, .personal-panel dd { margin: 0; }\n.personal-totals {\n  display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 4px;\n}\n.personal-totals div { padding: 6px; border-radius: 8px; background: var(--mta-secondary); }\n.personal-totals dt { color: var(--mta-muted); font-size: 11px; }\n.personal-totals dd { font-size: 17px; font-weight: 650; font-variant-numeric: tabular-nums; }\n.personal-totals dd[data-stat="rate"] { color: var(--mta-accent); }\n.personal-panel .personal-metrics { margin-top: 7px; }\n.personal-metrics div, .personal-open {\n  display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 0 8px;\n  padding: 5px 1px; border-bottom: 1px solid var(--mta-line);\n}\n.personal-metrics dd, .personal-open strong { font-weight: 600; font-variant-numeric: tabular-nums; }\n.personal-open { color: var(--mta-muted); font-size: 11px; }\n.personal-chats { margin-top: 7px; }\n.personal-chats summary { cursor: pointer; font-weight: 600; overflow-wrap: anywhere; }\n.personal-chats summary::marker { color: var(--mta-accent); }\n.personal-chat-columns, .personal-chat-row {\n  display: grid; grid-template-columns: minmax(0, 1fr) 4ch 7ch; gap: 7px; align-items: center;\n  width: 100%; padding: 4px 5px; text-align: right; font-variant-numeric: tabular-nums;\n}\n.personal-chat-columns { margin-top: 3px; color: var(--mta-muted); font-size: 10px; }\n.personal-chat-rows { max-height: 140px; overflow: auto; scrollbar-width: thin; }\n.personal-chat-row { border: 0; border-radius: 6px; background: transparent; color: var(--mta-text); font-size: 11px; }\n.personal-chat-row span:first-child { text-align: left; overflow-wrap: anywhere; }\n.personal-chat-row:hover { background: var(--mta-secondary); }\n.personal-chat-row[aria-pressed="true"] { color: var(--mta-accent); background: color-mix(in srgb, var(--mta-accent) 10%, transparent); }\n[hidden] { display: none !important; }\n@media (prefers-color-scheme: dark) { :host { --mta-default-surface: #17181c; --mta-default-secondary: #25262d; --mta-default-text: #fff; --mta-default-muted: #fffc; } }\n@media (max-width: 480px) { :host { right: max(12px, env(safe-area-inset-right)); bottom: max(12px, env(safe-area-inset-bottom)); max-height: calc(100dvh - 24px); } .panel-wrap, .overlays { width: min(300px, calc(100vw - 24px)); } .panel { max-height: min(400px, calc(100dvh - 88px)); } }\n';

  // src/content.js
  var icons = {
    flag: '<path d="M5 21V4m0 1c5-5 9 5 14 0v10c-5 5-9-5-14 0" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
    settings: '<path d="m10 3-.6 2.2-1.8 1L5.4 6 3.5 9.3 5 11v2l-1.5 1.7L5.4 18l2.2-.2 1.8 1L10 21h4l.6-2.2 1.8-1 2.2.2 1.9-3.3L19 13v-2l1.5-1.7L18.6 6l-2.2.2-1.8-1L14 3Z"/><circle cx="12" cy="12" r="3"/>',
    pause: '<path d="M9 6v12M15 6v12" stroke-width="2.8"/>',
    play: '<path d="m9 6 9 6-9 6Z" fill="currentColor" stroke="none"/>',
    close: '<path d="m7 7 10 10M17 7 7 17"/>',
    transfer: '<path d="M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4"/>'
  };
  function icon(name) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${icons[name]}</svg>`;
  }
  var BRIDGE = "__MAXTRACKER_V3__";
  var STORAGE = "maxtracker_v3";
  var pendingActions = /* @__PURE__ */ new Map();
  var state;
  var bindings = [];
  var currentChatId = null;
  var openedChat = null;
  var reply = null;
  var previousReplyKey = null;
  var lastGesture = 0;
  var gestureTarget = null;
  var gestureVersion = 0;
  var confirmedGesture = 0;
  var lastStartedGesture = 0;
  var replyChoicePending = false;
  var dialogOpen = false;
  var openingTarget = false;
  var startup = true;
  var sentMaxProfile;
  var panelSignature = "";
  var reconnectTimer;
  var port;
  var noticeTimer;
  var closeTimer;
  var pinned = false;
  var hovering = false;
  var bubbleUi = /* @__PURE__ */ new WeakMap();
  var decoratedBubbles = /* @__PURE__ */ new Set();
  var edgeMotion = matchMedia("(prefers-reduced-motion: no-preference)");
  var chatInfoCards = /* @__PURE__ */ new WeakMap();
  var savingChatExclusions = /* @__PURE__ */ new Set();
  var switchChatId;
  var pausing = /* @__PURE__ */ new Set();
  var host = document.createElement("div");
  host.id = "maxtracker-v3";
  host.setAttribute("data-maxtracker-ui", "");
  host.dataset.maxtrackerVersion = chrome.runtime.getManifest().version;
  var shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>${widget_default}</style><div class="overlays"><div class="dialogs"></div><div class="notice" hidden role="status"></div></div><div class="dock" hidden><div class="panel-wrap" id="mta-task-list" hidden><section class="panel" aria-label="\u041C\u043E\u0438 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u044F"><header class="bar"><strong>\u041E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u044F</strong><button class="gear" title="\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438" aria-label="\u041D\u0430\u0441\u0442\u0440\u043E\u0439\u043A\u0438 MaxTracker">${icon("settings")}</button></header><div class="tasks"></div></section></div><button class="launcher" aria-label="\u041C\u043E\u0438 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u044F" aria-haspopup="true" aria-expanded="false" aria-controls="mta-task-list"><span class="count"></span></button></div>`;
  function mount() {
    if (!host.isConnected && document.documentElement) document.documentElement.append(host);
  }
  mount();
  new MutationObserver(mount).observe(document, { childList: true });
  var tasksEl = shadow.querySelector(".tasks");
  var dock = shadow.querySelector(".dock");
  var popover = shadow.querySelector(".panel-wrap");
  var launcher = shadow.querySelector(".launcher");
  var personal = mountPersonalStats(shadow, {
    canOpen: () => !dialogOpen,
    onOpen: () => {
      pinned = false;
      setExpanded(false);
    }
  });
  var chatExclusion = node("button", null, "mta-chat-exclusion");
  chatExclusion.type = "button";
  chatExclusion.setAttribute("role", "menuitemcheckbox");
  chatExclusion.setAttribute("data-maxtracker-ui", "");
  chatExclusion.innerHTML = `${icon("flag")}<span>\u0418\u0441\u043A\u043B\u044E\u0447\u0438\u0442\u044C \u0447\u0430\u0442</span><span class="mta-chat-exclusion-track" aria-hidden="true"></span>`;
  var [exclusionIcon, exclusionTitle] = chatExclusion.children;
  chatExclusion.onclick = async () => {
    const chatId = switchChatId;
    if (!chatId || savingChatExclusions.has(chatId)) return;
    const excluded = !isChatExcluded(state, chatId);
    savingChatExclusions.add(chatId);
    chatExclusion.disabled = true;
    try {
      await action("CHECK_OPEN_CHAT", { chatId });
      await send({ type: "SET_CHAT_EXCLUDED", chatId, excluded });
    } catch (error) {
      notice(error.message);
    } finally {
      savingChatExclusions.delete(chatId);
      renderChatExclusion();
    }
  };
  var normalizedTitle = (title) => title.normalize().trim().replace(/\s+/g, " ");
  function chatIdForInfoMenu(title, card, menu) {
    const pathChatId = maxChatIdFromPath(location.pathname);
    if (pathChatId && openedChat?.chatId && openedChat.chatId !== pathChatId) return null;
    if (openedChat?.canTrack && typeof openedChat.chatTitle === "string" && normalizedTitle(openedChat.chatTitle) === title) {
      return openedChat.chatId;
    }
    if (!pathChatId) return null;
    const hasGroupControls = [...menu.querySelectorAll('[role="menuitem"]')].some(
      (item) => /^(?:выйти из чата|покинуть чат|выйти из канала|покинуть канал|отписаться|leave chat|leave group|leave channel|unsubscribe)$/i.test((item.getAttribute("aria-label") ?? item.textContent).trim())
    ) || [...card.closest(".layout-inner").querySelectorAll('[role="tab"]')].some(
      (tab) => /^(?:участники|подписчики|members|subscribers)$/i.test(tab.textContent.trim())
    );
    if (!hasGroupControls) return null;
    const profileButtons = [...document.querySelectorAll('button[aria-label^="\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u043F\u0440\u043E\u0444\u0438\u043B\u044C "], button[aria-label^="Open profile "]')].filter((button) => button.getClientRects().length);
    const headerTitle = profileButtons.length === 1 && profileButtons[0].getAttribute("aria-label").replace(/^(?:Открыть профиль|Open profile)\s+/i, "");
    return headerTitle && normalizedTitle(headerTitle) === title ? pathChatId : null;
  }
  function renderChatExclusion() {
    const matches = [];
    for (const trigger of document.querySelectorAll('.layout-inner .actions button[aria-expanded="true"]:has(use[href="#icon_dots_horizontal"])')) {
      const card = trigger.closest(".layout-inner > .wrapper");
      const title2 = card?.querySelector(":scope > header .titleWrapper h2 .name");
      const popupId = trigger.getAttribute("aria-controls");
      const menu = popupId && document.getElementById(popupId)?.querySelector('[role="menu"]');
      if (!title2 || !menu) continue;
      let text = title2.textContent;
      if (title2.querySelector("img[alt]")) {
        const copy = title2.cloneNode(true);
        for (const image of copy.querySelectorAll("img[alt]")) image.replaceWith(image.alt);
        text = copy.textContent;
      }
      const titleText2 = normalizedTitle(text);
      if (!titleText2) continue;
      const chatId2 = chatIdForInfoMenu(titleText2, card, menu);
      const known = chatInfoCards.get(title2);
      if (!chatId2 || known?.title === titleText2 && known.chatId !== chatId2) continue;
      const items = [...menu.querySelectorAll('button[role="menuitem"]:not([aria-haspopup]):not(.actionsMenuItem--danger)')];
      const native2 = items.find((item) => /^(?:найти|поиск|find|search)$/i.test(item.getAttribute("aria-label") ?? item.textContent.trim())) ?? items[0];
      if (native2?.getClientRects().length) matches.push({ title: title2, titleText: titleText2, chatId: chatId2, native: native2 });
    }
    if (matches.length !== 1) {
      switchChatId = void 0;
      chatExclusion.remove();
      return;
    }
    const { title, titleText, chatId, native } = matches[0];
    switchChatId = chatId;
    chatInfoCards.set(title, { title: titleText, chatId });
    chatExclusion.setAttribute("aria-checked", String(isChatExcluded(state, switchChatId)));
    chatExclusion.disabled = startup || savingChatExclusions.has(switchChatId);
    if (native.nextElementSibling !== chatExclusion) {
      chatExclusion.className = `${native.className} mta-chat-exclusion`;
      exclusionTitle.className = native.querySelector(":scope > .title")?.className ?? "";
      const nativeIcon = native.querySelector(":scope > svg");
      for (const dimension of ["width", "height"]) exclusionIcon.setAttribute(dimension, nativeIcon?.getAttribute(dimension) ?? "20");
      native.after(chatExclusion);
    }
  }
  function setExpanded(open) {
    clearTimeout(closeTimer);
    open = !!open && !dock.hidden && !dialogOpen;
    if (open) personal.close();
    popover.hidden = !open;
    launcher.setAttribute("aria-expanded", String(open));
    launcher.setAttribute("aria-pressed", String(open && pinned));
    if (open) updateTimers();
  }
  function closeIfUnused() {
    clearTimeout(closeTimer);
    closeTimer = setTimeout(() => {
      if (!pinned && !hovering && !dock.matches(":focus-within")) setExpanded(false);
    }, 180);
  }
  dock.addEventListener("pointerenter", (event) => {
    if (event.pointerType !== "touch") {
      hovering = true;
      setExpanded(true);
    }
  });
  dock.addEventListener("pointerleave", () => {
    hovering = false;
    closeIfUnused();
  });
  dock.addEventListener("focusin", () => setExpanded(true));
  dock.addEventListener("focusout", closeIfUnused);
  launcher.onclick = () => {
    pinned = !pinned;
    setExpanded(pinned);
  };
  document.addEventListener("pointerdown", (event) => {
    if (!event.composedPath().includes(host)) {
      pinned = false;
      setExpanded(false);
    }
  }, true);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !popover.hidden) {
      event.preventDefault();
      event.stopImmediatePropagation();
      pinned = false;
      launcher.focus({ preventScroll: true });
      setExpanded(false);
    }
  }, true);
  function node(tag, text, className) {
    const el = document.createElement(tag);
    if (text != null) el.textContent = text;
    if (className) el.className = className;
    return el;
  }
  function formatTime(ms) {
    const seconds = Math.floor(ms / 1e3);
    return `${Math.floor(seconds / 3600) > 0 ? `${Math.floor(seconds / 3600)}:` : ""}${String(Math.floor(seconds / 60) % 60).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
  }
  function notice(text) {
    const box = shadow.querySelector(".notice");
    box.textContent = text;
    box.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => {
      box.hidden = true;
    }, 6500);
  }
  async function send(message) {
    const result = await chrome.runtime.sendMessage(message);
    if (!result?.ok) throw Error(result?.error || "\u0424\u043E\u043D\u043E\u0432\u044B\u0439 \u043F\u0440\u043E\u0446\u0435\u0441\u0441 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D");
    if (result.state) {
      state = result.state;
      startup = false;
      render();
    }
    return result;
  }
  function action(action2, data = {}) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer2 = setTimeout(() => {
        pendingActions.delete(requestId);
        reject(Error("MAX \u043D\u0435 \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u043B \u043F\u0435\u0440\u0435\u0445\u043E\u0434 \u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044E"));
      }, 1e4);
      pendingActions.set(requestId, { resolve, reject, timer: timer2 });
      window.postMessage({ source: BRIDGE, version: 3, type: "ACTION", requestId, action: action2, ...data }, location.origin);
    });
  }
  function command(actionName, target, extra = {}) {
    return send({ type: "CMD", action: actionName, target, ...extra });
  }
  function meta(task) {
    return state?.metadata?.[messageKey(task)] || bindings.find((b) => messageKey(b) === messageKey(task)) || task;
  }
  async function pauseTask(task) {
    const key = messageKey(task);
    if (pausing.has(key)) return;
    pausing.add(key);
    render();
    try {
      await command("PAUSE", task);
      await action("CLEAR_REPLY", { target: task });
    } catch (error) {
      notice(error.message);
    } finally {
      pausing.delete(key);
      render();
    }
  }
  async function cancelTask(task) {
    const matches = reply && messageKey(reply) === messageKey(task);
    await command("CANCEL", task, { suppressReply: !!matches });
    if (reply && messageKey(reply) === messageKey(task)) await action("CLEAR_REPLY", { target: task });
  }
  async function openTask(task, resume) {
    if (isChatExcluded(state, task.chatId)) return;
    openingTarget = true;
    try {
      const active = Object.values(state.messages).find((t) => t.ownerDeviceId === state.deviceId && t.status === "running" && messageKey(t) !== messageKey(task));
      if (active) await command("PAUSE", active);
      const target = { ...task, ...meta(task) };
      await action("OPEN_TARGET", { target, resume });
      if (resume) await command("RESUME", target);
    } catch (error) {
      notice(error.message);
    } finally {
      openingTarget = false;
    }
  }
  function render() {
    if (!state) return;
    if ((gestureTarget || replyChoicePending) && isChatExcluded(state, gestureTarget?.chatId ?? currentChatId)) forgetReplyGesture();
    const choice = shadow.querySelector(".dialogs .dialog");
    if (choice && isChatExcluded(state, choice.dataset.chatId)) {
      choice.remove();
      dialogOpen = false;
    }
    const maxProfile = state.maxProfile ?? null;
    const serializedProfile = JSON.stringify(maxProfile);
    if (serializedProfile !== sentMaxProfile) {
      sentMaxProfile = serializedProfile;
      window.postMessage({ source: BRIDGE, version: 3, type: "MAX_PROFILE", profile: maxProfile }, location.origin);
    }
    const mine = Object.values(state.messages || {}).filter((t) => t.ownerDeviceId === state.deviceId && OPEN.has(t.status) && !isChatExcluded(state, t.chatId)).sort((a, b) => Number(b.status === "running") - Number(a.status === "running") || b.updatedAt - a.updatedAt);
    const signature = JSON.stringify([startup, [...pausing], mine.map((t) => [t.lastEventId, meta(t).requestText, meta(t).chatTitle])]);
    dock.hidden = mine.length === 0;
    if (dock.hidden) {
      pinned = false;
      setExpanded(false);
    }
    shadow.querySelector(".count").textContent = String(mine.length);
    const running = mine.filter((t) => t.status === "running" && !startup).length;
    launcher.title = `\u041E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0439: ${mine.length} \xB7 \u0432 \u0440\u0430\u0431\u043E\u0442\u0435: ${running} \xB7 \u043D\u0430 \u043F\u0430\u0443\u0437\u0435: ${mine.length - running}`;
    launcher.setAttribute("aria-label", launcher.title);
    if (signature !== panelSignature) {
      panelSignature = signature;
      tasksEl.replaceChildren();
      for (const task of mine) {
        const metadata = meta(task);
        const row = node("div", null, "task");
        row.dataset.status = startup ? "paused" : task.status;
        const label = node("button", null, "label");
        label.type = "button";
        label.title = "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0447\u0430\u0442 \u0438 \u043F\u0435\u0440\u0435\u0439\u0442\u0438 \u043A \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044E";
        const heading = node("div", null, "task-heading");
        const timer2 = node("span", null, "time");
        timer2.dataset.session = task.sessionId;
        heading.append(node("div", metadata.chatTitle || "\u0427\u0430\u0442", "title"), timer2);
        label.append(heading, node("div", metadata.requestText || "\u0412\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0431\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430", "preview"));
        label.onclick = () => void openTask(task, false);
        const toggle = node("button", null, "icon toggle");
        toggle.innerHTML = icon(task.status === "running" && !startup ? "pause" : "play");
        toggle.type = "button";
        toggle.title = task.status === "running" ? "\u041F\u0430\u0443\u0437\u0430" : "\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u0435 \u0438 \u043F\u0440\u043E\u0434\u043E\u043B\u0436\u0438\u0442\u044C";
        toggle.setAttribute("aria-label", toggle.title);
        toggle.disabled = startup || pausing.has(messageKey(task));
        toggle.onclick = () => task.status === "running" ? void pauseTask(task) : void openTask(task, true);
        const cancel = node("button", null, "icon cancel");
        cancel.innerHTML = icon("close");
        cancel.type = "button";
        cancel.title = "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0437\u0430\u0434\u0430\u0447\u0443 \u0431\u0435\u0437 \u0437\u0430\u043F\u0438\u0441\u0438 \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u043E\u0439 \u0440\u0430\u0431\u043E\u0442\u044B";
        cancel.setAttribute("aria-label", cancel.title);
        cancel.disabled = startup;
        cancel.onclick = () => void cancelTask(task).catch((e) => notice(e.message));
        const controls = node("div", null, "controls");
        controls.append(toggle, cancel);
        row.append(label, controls);
        tasksEl.append(row);
      }
    }
    personal.update(state, startup);
    updateTimers();
    renderFrames();
  }
  function updateTimers() {
    if (!state || popover.hidden) return;
    const sessions = new Map(Object.values(state.messages || {}).map((task) => [task.sessionId, task]));
    for (const timer2 of tasksEl.querySelectorAll("[data-session]")) {
      const task = sessions.get(timer2.dataset.session);
      if (!task) continue;
      const text = formatTime(elapsed(startup ? { ...task, status: "paused" } : task));
      if (timer2.textContent !== text) {
        timer2.textContent = text;
        timer2.setAttribute("aria-label", `\u0412\u0440\u0435\u043C\u044F \u0440\u0430\u0431\u043E\u0442\u044B: ${text}`);
      }
    }
  }
  function finishEdgeStatusTransition(edge) {
    const previous = edge.querySelector(":scope > .mta-message-edge-previous");
    if (!previous) return false;
    previous.remove();
    edge.getAnimations().find((animation) => animation.id === "mta-edge-status")?.cancel();
    return true;
  }
  function setEdgeStatus(edge, color, paused) {
    const { color: previousColor, paused: previousPaused } = edge.dataset;
    if (previousColor === color && previousPaused === paused) return;
    edge.dataset.color = color;
    edge.dataset.paused = paused;
    if (finishEdgeStatusTransition(edge) || !previousColor || !edgeMotion.matches || edge.hasAttribute("data-leaving")) return;
    const previous = node("span", null, "mta-message-edge-previous");
    previous.dataset.color = previousColor;
    previous.dataset.paused = previousPaused;
    edge.append(previous);
    const transition = edge.animate([
      { "--mta-edge-reveal": "0%" },
      { "--mta-edge-reveal": "118%" }
    ], { id: "mta-edge-status", duration: 280, easing: "cubic-bezier(.22, .65, .32, 1)", fill: "both" });
    void transition.finished.then(() => {
      previous.remove();
      transition.cancel();
    }, () => previous.remove());
  }
  function renderFrames() {
    personal.mount();
    renderChatExclusion();
    if (!state) return;
    const seen = /* @__PURE__ */ new Set();
    for (const binding of bindings) {
      const row = document.querySelector(`[data-maxtracker-locator="${binding.locator}"]`);
      const bubble = row?.querySelector(".messageWrapper .bubble");
      if (!bubble) continue;
      seen.add(bubble);
      if (isChatExcluded(state, binding.chatId)) {
        clearBubble(bubble);
        continue;
      }
      const task = state.messages[messageKey(binding)];
      if (!task || task.status === "none") {
        clearBubble(bubble, binding.locator);
        continue;
      }
      decoratedBubbles.add(bubble);
      const own = task.ownerDeviceId === state.deviceId;
      bubble.classList.add("mta-bubble-status");
      bubble.dataset.mtaColor = task.status === "completed" ? own ? "green" : "cyan" : own ? "yellow" : "purple";
      bubble.dataset.mtaPaused = String(task.status !== "completed" && (startup || task.status === "paused"));
      let edge = bubble.querySelector(":scope > .mta-message-edge");
      if (edge?.dataset.locator !== binding.locator) {
        edge?.remove();
        edge = node("span", null, "mta-message-edge");
        edge.dataset.locator = binding.locator;
        edge.setAttribute("aria-hidden", "true");
        edge.setAttribute("data-maxtracker-ui", "");
        bubble.append(edge);
      }
      setEdgeStatus(edge, bubble.dataset.mtaColor, bubble.dataset.mtaPaused);
      edge.removeAttribute("data-leaving");
      const anchor = bubble.closest(".message") || bubble;
      renderOwnerLabel(bubble, row, task, anchor);
      renderMessageActions(row, task, own);
    }
    for (const bubble of /* @__PURE__ */ new Set([...decoratedBubbles, ...document.querySelectorAll(".mta-bubble-status")])) if (!seen.has(bubble)) clearBubble(bubble);
    for (const avatar of document.querySelectorAll(".mta-avatar-status")) {
      avatar.classList.remove("mta-avatar-status");
      delete avatar.dataset.mtaColor;
      delete avatar.dataset.mtaPaused;
      avatar.querySelector(":scope > .mta-avatar-reset")?.remove();
    }
    for (const wrapper of document.querySelectorAll(".mta-frame")) {
      wrapper.classList.remove("mta-frame");
      delete wrapper.dataset.mtaColor;
      delete wrapper.dataset.mtaPaused;
      wrapper.querySelector(":scope > .mta-message-status")?.remove();
    }
  }
  function renderMessageActions(row, task, own) {
    const eligible = own && !startup && ["running", "paused", "completed"].includes(task.status);
    for (const stale of row.querySelectorAll(".mta-message-action")) if (!eligible || !stale.closest(".messageControls .buttons")) stale.remove();
    if (!eligible) return;
    for (const buttons of row.querySelectorAll(".messageControls .wrapper .buttons")) {
      let actionRow = buttons.querySelector(":scope > .mta-message-action");
      if (!actionRow) {
        const nativeRow = [...buttons.querySelectorAll(":scope > .row")].find((el) => !el.classList.contains("mta-message-action") && el.querySelector("button"));
        const nativeButton = nativeRow?.querySelector("button");
        if (!nativeButton) continue;
        actionRow = nativeRow.cloneNode(false);
        actionRow.removeAttribute("id");
        actionRow.classList.add("mta-message-action");
        actionRow.setAttribute("data-maxtracker-ui", "");
        const button2 = nativeButton.cloneNode(false);
        button2.type = "button";
        for (const name of ["id", "aria-haspopup", "aria-controls", "aria-expanded", "aria-describedby"]) button2.removeAttribute(name);
        button2.innerHTML = '<svg aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none"><path d="m6 6 12 12M18 6 6 18" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>';
        button2.onclick = async (event) => {
          event.preventDefault();
          event.stopPropagation();
          const binding = bindings.find((b) => b.locator === row.dataset.maxtrackerLocator);
          if (!binding || messageKey(binding) !== actionRow.dataset.mtaTarget) return;
          const current = state?.messages[messageKey(binding)];
          if (!current || current.ownerDeviceId !== state.deviceId || !["running", "paused", "completed"].includes(current.status)) return;
          button2.disabled = true;
          try {
            if (current.status === "completed") await command("RESET", current);
            else await cancelTask(current);
          } catch (error) {
            notice(error.message);
          } finally {
            if (button2.isConnected) button2.disabled = false;
          }
        };
        actionRow.append(button2);
        buttons.append(actionRow);
      }
      actionRow.dataset.mtaTarget = messageKey(task);
      const button = actionRow.querySelector("button");
      const title = task.status === "completed" ? "\u0421\u043D\u044F\u0442\u044C \u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E \u0438 \u0443\u0434\u0430\u043B\u0438\u0442\u044C \u0441\u0432\u043E\u044E \u0437\u0430\u043F\u0438\u0441\u044C TimeTracker" : "\u041E\u0442\u043C\u0435\u043D\u0438\u0442\u044C \u0440\u0430\u0431\u043E\u0442\u0443";
      if (button.title !== title) {
        button.title = title;
        button.setAttribute("aria-label", title);
      }
    }
  }
  function renderOwnerLabel(bubble, row, task, anchor) {
    let ui = bubbleUi.get(bubble);
    if (!ui) {
      ui = { anchor, row };
      bubbleUi.set(bubble, ui);
    } else ui.row = row;
    const nativeMeta = [...bubble.querySelectorAll(".meta--text,.meta--bubbled-inside")].find((meta2) => meta2.closest(".bubble") === bubble && meta2.parentElement?.classList.contains("meta"));
    let target = nativeMeta;
    if (!target) {
      target = bubble.querySelector(":scope > .mta-owner-fallback");
      if (!target) {
        target = node("div", null, "mta-owner-fallback");
        target.setAttribute("data-maxtracker-ui", "");
        bubble.append(target);
      }
    }
    let label = ui.label;
    if (!label) {
      label = node("span", null, "mta-owner-label");
      label.setAttribute("data-maxtracker-ui", "");
      label.append(node("span", null, "mta-owner-name"), node("span", null, "mta-owner-state"));
      ui.label = label;
    }
    const placementChanged = label.parentElement !== target;
    if (placementChanged) {
      ui.meta?.classList.remove("mta-owner-host");
      target.prepend(label);
      ui.meta = target;
      if (nativeMeta) target.classList.add("mta-owner-host");
      for (const fallback of bubble.querySelectorAll(":scope > .mta-owner-fallback")) if (fallback !== target) fallback.remove();
    }
    const name = task.operatorName || "\u0423\u0447\u0430\u0441\u0442\u043D\u0438\u043A";
    const status = task.status === "completed" ? "\u0432\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043E" : task.status === "paused" || startup ? "\u043F\u0430\u0443\u0437\u0430" : "\u0432 \u0440\u0430\u0431\u043E\u0442\u0435";
    if (label.querySelector(".mta-owner-name").textContent !== name) label.querySelector(".mta-owner-name").textContent = name;
    if (label.querySelector(".mta-owner-state").textContent !== ` \xB7 ${status}`) label.querySelector(".mta-owner-state").textContent = ` \xB7 ${status}`;
    label.setAttribute("aria-label", `${name} \xB7 ${status}`);
    if (placementChanged) {
      ui.resizeObserver?.disconnect();
      ui.resizeObserver = new ResizeObserver(() => sizeOwnerLabel(bubble, row));
      const wrapper = row.querySelector(".messageWrapper");
      if (wrapper) ui.resizeObserver.observe(wrapper);
      ui.resizeObserver.observe(target);
      sizeOwnerLabel(bubble, row);
    }
  }
  function sizeOwnerLabel(bubble, row) {
    const ui = bubbleUi.get(bubble);
    if (!ui?.label?.isConnected) return;
    const wrapper = row.querySelector(".messageWrapper");
    if (!wrapper) return;
    const avatar = wrapper.querySelector(":scope > .authorAvatar");
    const avatarWidth = avatar ? avatar.getBoundingClientRect().width + (parseFloat(getComputedStyle(avatar).marginRight) || 0) : 0;
    const others = [...ui.meta.children].filter((el) => el !== ui.label);
    const timeWidth = others.reduce((sum, el) => sum + el.getBoundingClientRect().width, 0);
    const gap = parseFloat(getComputedStyle(ui.meta).columnGap) || 4;
    const max = Math.max(0, Math.min(180, Math.floor(wrapper.clientWidth - avatarWidth - timeWidth - 32 - gap * others.length)));
    if (ui.label.style.maxWidth !== `${max}px`) ui.label.style.maxWidth = `${max}px`;
  }
  function clearBubble(bubble, locator) {
    bubble.classList.remove("mta-bubble-status");
    delete bubble.dataset.mtaColor;
    delete bubble.dataset.mtaPaused;
    const saved = bubbleUi.get(bubble);
    if (saved) {
      saved.resizeObserver?.disconnect();
      saved.meta?.classList.remove("mta-owner-host");
      saved.label?.remove();
      bubbleUi.delete(bubble);
    }
    for (const label of bubble.querySelectorAll(".mta-owner-label")) label.remove();
    bubble.querySelector(":scope > .mta-owner-fallback")?.remove();
    for (const action2 of saved?.row?.querySelectorAll(".mta-message-action") || []) action2.remove();
    const anchor = saved?.anchor || bubble.closest(".message") || bubble;
    anchor.querySelector(":scope > .mta-message-reset")?.remove();
    anchor.classList.remove("mta-message-anchor");
    const edge = bubble.querySelector(":scope > .mta-message-edge");
    if (edge && locator && edge.dataset.locator === locator && bubble.isConnected) {
      if (edge.hasAttribute("data-leaving")) return;
      finishEdgeStatusTransition(edge);
      edge.setAttribute("data-leaving", "");
      const transition = edge.getAnimations().find((animation) => animation.transitionProperty === "clip-path");
      if (transition) {
        const removeLeavingEdge = () => {
          if (edge.parentElement === bubble && edge.hasAttribute("data-leaving")) {
            edge.remove();
            decoratedBubbles.delete(bubble);
          }
        };
        void transition.finished.then(removeLeavingEdge, removeLeavingEdge);
        return;
      }
    }
    edge?.remove();
    decoratedBubbles.delete(bubble);
  }
  async function offerTakeover(target, task) {
    if (dialogOpen || isChatExcluded(state, target.chatId)) return;
    dialogOpen = true;
    personal.close();
    pinned = false;
    setExpanded(false);
    const box = node("section", null, "dialog");
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "true");
    box.dataset.taskKey = messageKey(target);
    box.dataset.chatId = target.chatId;
    const symbol = node("div", null, "dialog-icon");
    symbol.innerHTML = icon("transfer");
    box.append(symbol);
    box.append(node("strong", `\u0423\u0436\u0435 \u0432 \u0440\u0430\u0431\u043E\u0442\u0435 \u0443 ${task.operatorName}`), node("p", "\u0417\u0430\u0431\u0440\u0430\u0442\u044C \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u0441\u0435\u0431\u0435? \u0423 \u043A\u043E\u043B\u043B\u0435\u0433\u0438 \u0437\u0430\u0432\u0435\u0440\u0448\u0438\u0442\u0441\u044F \u0435\u0433\u043E \u0440\u0430\u0431\u043E\u0442\u0430, \u0443 \u0432\u0430\u0441 \u043D\u0430\u0447\u043D\u0435\u0442\u0441\u044F \u043D\u043E\u0432\u044B\u0439 \u0442\u0430\u0439\u043C\u0435\u0440."));
    const buttons = node("div", null, "buttons");
    const decline = node("button", "\u041E\u0442\u043A\u0430\u0437\u0430\u0442\u044C\u0441\u044F");
    const take = node("button", "\u0417\u0430\u0431\u0440\u0430\u0442\u044C \u0441\u0435\u0431\u0435", "primary");
    decline.onclick = async () => {
      try {
        await action("CLEAR_REPLY", { target });
      } catch (e) {
        notice(e.message);
      }
      box.remove();
      dialogOpen = false;
      void maybeStart();
    };
    take.onclick = async () => {
      take.disabled = true;
      try {
        const confirmed = await action("RESOLVE_REPLY", { expected: { chatId: target.chatId, messageId: target.messageId } });
        if (!confirmed.reply || messageKey(confirmed.reply) !== messageKey(target)) throw Error("\u0426\u0435\u043B\u044C \u043E\u0442\u0432\u0435\u0442\u0430 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0430\u0441\u044C. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0432\u044B\u0431\u043E\u0440 \xAB\u041E\u0442\u0432\u0435\u0442\u0438\u0442\u044C\xBB.");
        await command("TAKEOVER", target, { fromSessionId: task.sessionId });
        box.remove();
        dialogOpen = false;
      } catch (e) {
        notice(e.message);
        take.disabled = false;
      }
    };
    buttons.append(decline, take);
    box.append(buttons);
    shadow.querySelector(".dialogs").append(box);
    take.focus();
  }
  async function maybeStart() {
    if (!reply || openingTarget || dialogOpen || confirmedGesture !== gestureVersion || Date.now() - lastGesture > 3e3 || lastStartedGesture === gestureVersion) return;
    if (isChatExcluded(state, reply.chatId)) return;
    if (gestureTarget && messageKey(gestureTarget) !== messageKey(reply)) return;
    lastStartedGesture = gestureVersion;
    const version = gestureVersion;
    try {
      const result = await command("REPLY_SELECTED", reply);
      if (result.needsTakeover) await offerTakeover(reply, result.task);
    } catch (e) {
      notice(e.message);
    } finally {
      if (gestureVersion === version) replyChoicePending = false;
    }
  }
  function forgetReplyGesture() {
    ++gestureVersion;
    replyChoicePending = false;
    lastGesture = 0;
    gestureTarget = null;
  }
  function gesture(event) {
    if (openingTarget || isChatExcluded(state, currentChatId)) return;
    if (event.composedPath().includes(host)) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target) return;
    if (target.closest("[data-maxtracker-ui]")) return;
    if (target.closest(".authorAvatar")) return;
    const control = target.closest('button,[role="menuitem"]');
    const isReply = control && (/^(ответить|reply)$/i.test(control.textContent.trim()) || /ответить|reply/i.test(`${control.getAttribute("aria-label") || ""} ${control.title || ""}`) || control.querySelector('use[href*="reply"]'));
    if (!isReply) return;
    const row = target.closest("[data-maxtracker-locator]");
    gestureTarget = row ? bindings.find((b) => b.locator === row.dataset.maxtrackerLocator) : null;
    const expected = gestureTarget ? { chatId: gestureTarget.chatId, messageId: gestureTarget.messageId } : void 0;
    lastGesture = Date.now();
    const version = ++gestureVersion;
    replyChoicePending = true;
    setTimeout(async () => {
      try {
        if (gestureVersion !== version) return;
        const result = await action("RESOLVE_REPLY", { expected });
        if (gestureVersion !== version) return;
        if (!result.reply) {
          replyChoicePending = false;
          notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043F\u043E\u0434\u0442\u0432\u0435\u0440\u0434\u0438\u0442\u044C \u0441\u0435\u0440\u0432\u0435\u0440\u043D\u0443\u044E \u0446\u0435\u043B\u044C \u043E\u0442\u0432\u0435\u0442\u0430. \u041F\u043E\u0432\u0442\u043E\u0440\u0438\u0442\u0435 \u0432\u044B\u0431\u043E\u0440 \xAB\u041E\u0442\u0432\u0435\u0442\u0438\u0442\u044C\xBB.");
          return;
        }
        if (isChatExcluded(state, result.reply.chatId)) {
          forgetReplyGesture();
          return;
        }
        confirmedGesture = version;
        gestureTarget = result.reply;
        reply = result.reply;
        await maybeStart();
      } catch (e) {
        if (gestureVersion === version) {
          replyChoicePending = false;
          notice(e.message);
        }
      }
    }, 0);
  }
  document.addEventListener("click", gesture, true);
  function needsChoice() {
    const target = reply || (Date.now() - lastGesture < 3e3 ? gestureTarget : null);
    if (isChatExcluded(state, currentChatId) || isChatExcluded(state, target?.chatId)) return false;
    const task = target && state?.messages?.[messageKey(target)];
    return replyChoicePending || dialogOpen || task && OPEN.has(task.status) && task.ownerDeviceId !== state.deviceId;
  }
  function preventUnchosenReply(event) {
    if (!needsChoice()) return;
    const target = event.target instanceof Element ? event.target : null;
    if (!target?.closest('[data-testid="composer"]')) return;
    const button = target.closest("button");
    const isSend = button && (button.getAttribute("type") === "submit" || /отправить|send/i.test(`${button.getAttribute("aria-label") || ""} ${button.title || ""} ${button.textContent || ""}`) || button.querySelector('use[href*="send"]'));
    if (event.type === "submit" || event.type === "keydown" && event.key === "Enter" && !event.shiftKey || event.type === "click" && isSend) {
      event.preventDefault();
      event.stopImmediatePropagation();
      notice(replyChoicePending ? "\u041F\u043E\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u044E \u0441\u0435\u0440\u0432\u0435\u0440\u043D\u0443\u044E \u0446\u0435\u043B\u044C \u043E\u0442\u0432\u0435\u0442\u0430\u2026" : "\u0421\u043D\u0430\u0447\u0430\u043B\u0430 \u0432\u044B\u0431\u0435\u0440\u0438\u0442\u0435: \u0437\u0430\u0431\u0440\u0430\u0442\u044C \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435 \u0438\u043B\u0438 \u043E\u0442\u043A\u0430\u0437\u0430\u0442\u044C\u0441\u044F.");
    }
  }
  document.addEventListener("keydown", preventUnchosenReply, true);
  document.addEventListener("submit", preventUnchosenReply, true);
  document.addEventListener("click", preventUnchosenReply, true);
  window.addEventListener("message", (event) => {
    if (event.source !== window || event.origin !== location.origin || event.data?.source !== BRIDGE || event.data.version !== 3) return;
    const data = event.data;
    if (data.type === "VIEW") {
      const changedChat = currentChatId !== null && currentChatId !== data.chatId;
      const nextReply = data.reply ? messageKey(data.reply) : null;
      const dismissed = data.dismissedReply;
      let dismissedKey = null;
      if (typeof dismissed?.chatId === "string" && typeof dismissed.messageId === "string") {
        dismissedKey = messageKey(dismissed);
        if (!gestureTarget || messageKey(gestureTarget) === dismissedKey) forgetReplyGesture();
        const choice = shadow.querySelector(".dialogs .dialog");
        if (choice?.dataset.taskKey === dismissedKey) {
          choice.remove();
          dialogOpen = false;
        }
        void send({ type: "DISMISS_REPLY", target: dismissed }).catch((e) => notice(e.message));
      }
      if (previousReplyKey && previousReplyKey !== nextReply && previousReplyKey !== dismissedKey) {
        void send({ type: "REPLY_CLEARED", key: previousReplyKey }).catch(() => {
        });
        if (!openingTarget) void send({ type: "PAUSE_CONTEXT", key: previousReplyKey }).catch(() => {
        });
      }
      if (changedChat && !openingTarget) void send({ type: "PAUSE_CONTEXT", chatId: currentChatId }).catch(() => {
      });
      currentChatId = data.chatId;
      openedChat = data.openedChat;
      bindings = Array.isArray(data.bindings) ? data.bindings : [];
      reply = data.reply;
      previousReplyKey = nextReply;
      if (data.replyId && !reply && Date.now() - lastGesture < 3e3) notice("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0442\u043E\u0447\u043D\u043E \u043F\u043E\u043B\u0443\u0447\u0438\u0442\u044C \u0441\u0435\u0440\u0432\u0435\u0440\u043D\u0443\u044E \u0446\u0435\u043B\u044C \u043E\u0442\u0432\u0435\u0442\u0430");
      render();
      void maybeStart();
    }
    if (data.type === "SENT_REPLY" && !isChatExcluded(state, data.chatId)) void command("COMPLETE", { chatId: data.chatId, messageId: data.messageId }, { sentMessageId: data.sentMessageId, replyText: data.replyText }).catch((e) => notice(e.message));
    if (data.type === "ACTION_RESULT") {
      const pending = pendingActions.get(data.requestId);
      if (pending) {
        clearTimeout(pending.timer);
        pendingActions.delete(data.requestId);
        data.ok ? pending.resolve(data) : pending.reject(Error(data.error));
      }
    }
    if (data.type === "DIAGNOSTIC" && !data.ok && Date.now() - lastGesture < 3e3) notice(data.detail);
  });
  function connect() {
    try {
      port = chrome.runtime.connect({ name: "mta-max" });
      port.onMessage.addListener((message) => {
        if (message.type === "STATE") {
          state = message.state;
          startup = false;
          render();
        }
        if (message.type === "NOTICE") notice(message.text);
      });
      port.onDisconnect.addListener(() => {
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 1500);
      });
    } catch {
      reconnectTimer = setTimeout(connect, 1500);
    }
  }
  shadow.querySelector(".gear").onclick = () => void send({ type: "OPEN_OPTIONS" }).catch((e) => notice(e.message));
  chrome.storage.local.get(STORAGE).then((saved) => {
    if (!startup) return;
    const doc = saved[STORAGE];
    if (!doc) return;
    state = { ...doc, maxProfile: cachedMaxProfile(doc), messages: projectCached(doc), lan: { connected: false, detail: "\u0412\u043E\u0441\u0441\u0442\u0430\u043D\u043E\u0432\u043B\u0435\u043D\u043E \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E" } };
    render();
  });
  function projectCached(doc) {
    return doc.displayMessages || doc.committed || {};
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[STORAGE]?.newValue && !state) void send({ type: "GET_STATE" }).catch(() => {
    });
  });
  connect();
  setInterval(() => {
    try {
      port?.postMessage({ type: "ALIVE" });
    } catch {
    }
  }, 5e3);
  setInterval(() => {
    updateTimers();
    personal.tick();
  }, 1e3);
  var framesQueued = false;
  new MutationObserver((mutations) => {
    if (framesQueued || !mutations.some((m) => {
      if (m.type === "attributes") return m.target.matches('.layout-inner .actions button:has(use[href="#icon_dots_horizontal"])');
      return !(m.target instanceof Element ? m.target : m.target.parentElement)?.closest("[data-maxtracker-ui],.mta-message-status");
    })) return;
    framesQueued = true;
    requestAnimationFrame(() => {
      framesQueued = false;
      renderFrames();
    });
  }).observe(document, { childList: true, subtree: true, attributeFilter: ["aria-controls", "aria-expanded"] });
  window.addEventListener("pagehide", () => {
    void chrome.runtime.sendMessage({ type: "PAUSE_CONTEXT" }).catch(() => {
    });
  });
  window.postMessage({ source: BRIDGE, version: 3, type: "READY" }, location.origin);
})();
