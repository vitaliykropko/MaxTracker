(() => {
  // src/export-report.js
  var TIME_ZONE = "Europe/Moscow";
  var monthFormat = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, year: "numeric", month: "long" });
  var dateFormat = new Intl.DateTimeFormat("ru-RU", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  var monthKeyFormat = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit" });
  var clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  var timestamp = (value) => Number.isFinite(Number(value)) && Number(value) > 0 && Number(value) <= 864e13 ? Number(value) : null;
  var timerMs = (record) => record.elapsedMs != null && Number.isFinite(Number(record.elapsedMs)) && Number(record.elapsedMs) >= 0 ? Number(record.elapsedMs) : null;
  var minutes = (record) => Math.max(5, Math.round(Number.isFinite(Number(record.minutes)) && Number(record.minutes) > 0 ? Number(record.minutes) : (timerMs(record) || 0) / 6e4));
  var duration = (ms) => {
    const seconds = Math.floor(ms / 1e3);
    return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((n) => String(n).padStart(2, "0")).join(":");
  };
  var date = (value) => timestamp(value) == null ? "\u0434\u0430\u0442\u0430 \u043D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u0430" : dateFormat.format(Number(value));
  function summary(records) {
    const known = records.filter((record) => timerMs(record) != null);
    const missing = records.length - known.length;
    const timer = known.length ? duration(known.reduce((sum, record) => sum + timerMs(record), 0)) : "\u043D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445";
    return `\u041E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0439: ${records.length} | \u041F\u043E \u0442\u0430\u0439\u043C\u0435\u0440\u0443: ${timer}${missing && known.length ? ` (\u043D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445: ${missing})` : ""} | \u0423\u0447\u0442\u0435\u043D\u043E: ${records.reduce((sum, record) => sum + minutes(record), 0)} \u043C\u0438\u043D`;
  }
  function block(label, value, fallback) {
    const lines = String(value || fallback).replace(/\r\n?/g, "\n").trim().split("\n");
    return [`    ${label}:`, ...lines.map((line) => `      ${line}`)];
  }
  function exportText(records) {
    const rows = Object.values(records).filter((record) => !record.deleted);
    if (!rows.length) return "\u041E\u0422\u0427\u0401\u0422 \u041F\u041E \u041E\u0411\u0420\u0410\u0429\u0415\u041D\u0418\u042F\u041C\r\n\r\n\u041D\u0435\u0442 \u0437\u0430\u0432\u0435\u0440\u0448\u0451\u043D\u043D\u044B\u0445 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0439.";
    const months = /* @__PURE__ */ new Map();
    for (const record of rows) {
      const time = timestamp(record.completedAt);
      const parts = time == null ? null : monthKeyFormat.formatToParts(time);
      const key = parts ? `${parts.find((p) => p.type === "year").value}-${parts.find((p) => p.type === "month").value}` : "unknown";
      if (!months.has(key)) months.set(key, { title: time == null ? "\u0411\u0435\u0437 \u0434\u0430\u0442\u044B" : monthFormat.format(time).replace(/ г\.$/, ""), records: [] });
      months.get(key).records.push(record);
    }
    const lines = [
      "\u041E\u0422\u0427\u0401\u0422 \u041F\u041E \u041E\u0411\u0420\u0410\u0429\u0415\u041D\u0418\u042F\u041C",
      "\u041C\u0435\u0441\u044F\u0446 \u2014 \u043F\u043E \u043F\u043E\u0441\u043B\u0435\u0434\u043D\u0435\u043C\u0443 \u0437\u0430\u0432\u0435\u0440\u0448\u0435\u043D\u0438\u044E \u043A\u0435\u0439\u0441\u0430. \u0414\u0430\u0442\u044B \u0438 \u0432\u0440\u0435\u043C\u044F \u2014 \u041C\u0421\u041A.",
      "\u041F\u043E \u0442\u0430\u0439\u043C\u0435\u0440\u0443 \u2014 \u0432\u0440\u0435\u043C\u044F \u0440\u0430\u0431\u043E\u0442\u044B \u0431\u0435\u0437 \u043F\u0430\u0443\u0437; \u0443\u0447\u0442\u0435\u043D\u043E \u2014 \u0441 \u043C\u0438\u043D\u0438\u043C\u0443\u043C\u043E\u043C 5 \u043C\u0438\u043D\u0443\u0442 \u043D\u0430 \u043A\u0435\u0439\u0441.",
      "",
      `\u0418\u0422\u041E\u0413\u041E: ${summary(rows)}`
    ];
    const keys = [...months.keys()].sort((a, b) => a === "unknown" ? 1 : b === "unknown" ? -1 : b.localeCompare(a));
    for (const key of keys) {
      const month = months.get(key);
      lines.push("", "=".repeat(64), month.title.toLocaleUpperCase("ru-RU"), summary(month.records), "=".repeat(64));
      const chats = /* @__PURE__ */ new Map();
      for (const record of month.records) {
        const chatKey = record.chatId != null ? `id:${record.chatId}` : `title:${clean(record.chatTitle)}`;
        if (!chats.has(chatKey)) chats.set(chatKey, { title: clean(record.chatTitle) || "\u0427\u0430\u0442 \u0431\u0435\u0437 \u043D\u0430\u0437\u0432\u0430\u043D\u0438\u044F", id: record.chatId, records: [] });
        chats.get(chatKey).records.push(record);
      }
      const sortedChats = [...chats.values()].sort((a, b) => a.title.localeCompare(b.title, "ru") || String(a.id || "").localeCompare(String(b.id || "")));
      for (const chat of sortedChats) {
        const sameName = sortedChats.filter((other) => other.title === chat.title).length > 1;
        lines.push("", `\u0427\u0410\u0422: ${chat.title}${sameName && chat.id != null ? ` [${chat.id}]` : ""}`, summary(chat.records), "-".repeat(64));
        chat.records.sort((a, b) => (timestamp(a.completedAt) || Infinity) - (timestamp(b.completedAt) || Infinity) || String(a.sessionId || "").localeCompare(String(b.sessionId || "")));
        chat.records.forEach((record, index) => {
          lines.push("", `  ${index + 1}. ${date(record.completedAt)} | ${clean(record.authorName || record.authorId) || "\u0410\u0432\u0442\u043E\u0440 \u043D\u0435 \u0443\u043A\u0430\u0437\u0430\u043D"}`);
          lines.push(...block("\u041E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u0435", record.requestText, "\u0412\u043B\u043E\u0436\u0435\u043D\u0438\u0435 \u0431\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430"));
          const replies = record.replies?.length ? record.replies : [{ text: record.replyText, completedAt: record.completedAt }];
          lines.push("    \u041E\u0442\u0432\u0435\u0442\u044B:");
          replies.forEach((reply, i) => {
            lines.push(`      ${i + 1}) ${date(reply.completedAt)}`, ...String(reply.text || "\u041E\u0442\u0432\u0435\u0442 \u0431\u0435\u0437 \u0442\u0435\u043A\u0441\u0442\u0430").replace(/\r\n?/g, "\n").trim().split("\n").map((line) => `         ${line}`));
          });
          const ms = timerMs(record);
          lines.push(`    \u041F\u043E \u0442\u0430\u0439\u043C\u0435\u0440\u0443: ${ms == null ? "\u043D\u0435\u0442 \u0434\u0430\u043D\u043D\u044B\u0445" : duration(ms)} | \u0423\u0447\u0442\u0435\u043D\u043E: ${minutes(record)} \u043C\u0438\u043D`);
        });
      }
    }
    return lines.join("\r\n");
  }

  // src/task-state.js
  var OPEN = /* @__PURE__ */ new Set(["running", "paused"]);
  var messageKey = (value) => JSON.stringify([value.chatId, value.messageId]);
  var isChatExcluded = (state, chatId) => state?.excludedChats?.includes(chatId) ?? false;
  var elapsed = (task, now = Date.now()) => Math.max(0, Math.round(
    (task.accumulatedMs || 0) + (task.status === "running" ? Math.max(0, now - task.lastResumeTime) : 0)
  ));
  var countedMinutes = (ms) => Math.max(5, Math.round(ms / 6e4));
  function validEvent(e) {
    return !!e && typeof e === "object" && ["START", "PAUSE", "RESUME", "COMPLETE", "CANCEL", "TAKEOVER", "RESET", "REOPEN", "RENAME"].includes(e.type) && ["chatId", "messageId", "eventId", "deviceId", "sessionId", "operatorName"].every((k) => typeof e[k] === "string" && e[k].length > 0 && e[k].length <= 512) && Number.isSafeInteger(e.eventAt) && e.eventAt > 0 && typeof e.expectedEventId === "string" && (!["TAKEOVER", "REOPEN"].includes(e.type) || typeof e.fromSessionId === "string" && typeof e.fromDeviceId === "string");
  }
  function reduceEvent(messages, event) {
    if (!validEvent(event)) return { accepted: false, messages, reason: "\u041D\u0435\u043A\u043E\u0440\u0440\u0435\u043A\u0442\u043D\u043E\u0435 \u0441\u043E\u0431\u044B\u0442\u0438\u0435" };
    const key = messageKey(event);
    const old = messages[key];
    if (old?.lastEventId === event.eventId) return { accepted: true, duplicate: true, messages };
    const status = old?.status || "none";
    const own = old?.ownerDeviceId === event.deviceId && old.sessionId === event.sessionId;
    const expected = event.expectedEventId === (old?.lastEventId || "");
    let next;
    let closed;
    let reset;
    const base = { chatId: event.chatId, messageId: event.messageId, lastEventId: event.eventId, updatedAt: event.eventAt };
    const close = (reason) => {
      const { reopenedFrom, ...saved } = old;
      return { ...saved, accumulatedMs: elapsed(old, event.eventAt), status: "completed", closedAt: event.eventAt, closeReason: reason, completionEventId: event.eventId };
    };
    switch (event.type) {
      case "RENAME":
        if (!own || !expected || !["running", "paused", "completed"].includes(status)) break;
        next = { ...old, ...base, operatorName: event.operatorName };
        if (old.reopenedFrom?.ownerDeviceId === event.deviceId) next.reopenedFrom = { ...old.reopenedFrom, operatorName: event.operatorName };
        break;
      case "START":
        if (status !== "none" || !expected) break;
        next = { ...base, status: "running", sessionId: event.sessionId, ownerDeviceId: event.deviceId, operatorName: event.operatorName, startedAt: event.eventAt, lastResumeTime: event.eventAt, accumulatedMs: 0 };
        break;
      case "REOPEN":
        if (status !== "completed" || !expected || event.fromSessionId !== old.sessionId || event.fromDeviceId !== old.ownerDeviceId) break;
        if (old.ownerDeviceId === event.deviceId) {
          if (event.sessionId !== old.sessionId) break;
          next = { ...old, ...base, status: "running", lastResumeTime: event.eventAt, reopenedFrom: { ...old } };
        } else {
          if (event.sessionId === old.sessionId) break;
          next = { ...base, status: "running", sessionId: event.sessionId, ownerDeviceId: event.deviceId, operatorName: event.operatorName, startedAt: event.eventAt, lastResumeTime: event.eventAt, accumulatedMs: 0, completedMessageIds: old.completedMessageIds || (old.sentMessageId ? [old.sentMessageId] : []), reopenedFrom: { ...old } };
        }
        break;
      case "TAKEOVER":
        if (!OPEN.has(status) || old.ownerDeviceId === event.deviceId || old.sessionId !== event.fromSessionId || old.ownerDeviceId !== event.fromDeviceId) break;
        closed = { ...close("transferred"), transferredTo: event.operatorName, transferId: event.eventId };
        next = { ...base, status: "running", sessionId: event.sessionId, ownerDeviceId: event.deviceId, operatorName: event.operatorName, startedAt: event.eventAt, lastResumeTime: event.eventAt, accumulatedMs: 0 };
        break;
      case "PAUSE":
        if (!own || !expected || status !== "running") break;
        next = { ...old, ...base, status: "paused", accumulatedMs: elapsed(old, event.eventAt), lastResumeTime: null };
        break;
      case "RESUME":
        if (!own || !expected || status !== "paused") break;
        next = { ...old, ...base, status: "running", lastResumeTime: event.eventAt };
        break;
      case "COMPLETE":
        if (!own || !expected || !OPEN.has(status) || typeof event.sentMessageId !== "string") break;
        if (old.sentMessageId === event.sentMessageId || old.completedMessageIds?.includes(event.sentMessageId)) break;
        closed = {
          ...close("reply"),
          replyText: typeof event.replyText === "string" ? event.replyText.slice(0, 1e5) : "",
          sentMessageId: event.sentMessageId,
          completedMessageIds: [...old.completedMessageIds || (old.sentMessageId ? [old.sentMessageId] : []), event.sentMessageId]
        };
        next = { ...closed, ...base, lastResumeTime: null };
        break;
      case "CANCEL":
        if (!own || !expected || !OPEN.has(status)) break;
        next = old.reopenedFrom ? { ...old.reopenedFrom, ...base } : { ...old, ...base, status: "none", closeReason: "cancelled", accumulatedMs: elapsed(old, event.eventAt), lastResumeTime: null };
        break;
      case "RESET":
        if (!own || !expected || status !== "completed") break;
        reset = { ...old };
        next = { ...old, ...base, status: "none", closeReason: "reset", lastResumeTime: null };
        break;
    }
    if (!next) return { accepted: false, messages, reason: "\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u0438\u043B\u0438 \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C \u0443\u0436\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0438\u0441\u044C" };
    return { accepted: true, messages: { ...messages, [key]: next }, closed, reset };
  }
  function projectMessages(committed, pending) {
    let messages = committed;
    const results = [];
    for (const event of pending) {
      const result = reduceEvent(messages, event);
      if (result.accepted) messages = result.messages;
      results.push({ event, ...result });
    }
    return { messages, results };
  }
  function localWorkRecord(closed, metadata, deviceId) {
    if (!closed || closed.ownerDeviceId !== deviceId) return null;
    const ms = closed.accumulatedMs;
    return {
      ...metadata,
      chatId: closed.chatId,
      messageId: closed.messageId,
      sessionId: closed.sessionId,
      operatorName: closed.operatorName,
      ownerDeviceId: deviceId,
      minutes: countedMinutes(ms),
      startedAt: closed.startedAt,
      completedAt: closed.closedAt,
      elapsedMs: ms,
      completionEventId: closed.completionEventId || closed.lastEventId,
      closeReason: closed.closeReason,
      replyText: closed.closeReason === "transferred" ? `\u041F\u0435\u0440\u0435\u0434\u0430\u043D\u043E ${closed.transferredTo}` : closed.replyText || "",
      transferId: closed.transferId || null,
      sentMessageId: closed.sentMessageId || null,
      ttStatus: "pending"
    };
  }
  function mergeWorkRecord(previous, record) {
    if (!previous) return { ...record, revision: 1, firstCompletedAt: record.completedAt, firstElapsedMs: record.elapsedMs, replies: [{ eventId: record.completionEventId, text: record.replyText, sentMessageId: record.sentMessageId, completedAt: record.completedAt }] };
    if (previous.completionEventId === record.completionEventId || previous.replies?.some((r) => r.eventId === record.completionEventId)) return previous;
    const replies = previous.replies || [{ eventId: previous.completionEventId || `legacy:${previous.sessionId}`, text: previous.replyText, sentMessageId: previous.sentMessageId, completedAt: previous.completedAt }];
    const nextReplies = [...replies, { eventId: record.completionEventId, text: record.replyText, sentMessageId: record.sentMessageId, completedAt: record.completedAt }];
    const knownRemote = previous.ttId != null || previous.ttStatus === "synced" || previous.ttNeedsLookup;
    return {
      ...previous,
      ...record,
      revision: (previous.revision || 0) + 1,
      firstCompletedAt: previous.firstCompletedAt || previous.completedAt,
      replies: nextReplies,
      replyText: nextReplies.map((r) => r.text).filter(Boolean).join(" | "),
      minutes: Math.max(previous.minutes || 0, countedMinutes(record.elapsedMs + (previous.attributionExtraMs || 0))),
      ttId: previous.ttId ?? null,
      ttAnchor: previous.ttAnchor || (knownRemote && previous.ttPayload ? { date: previous.ttPayload.date, start_time: previous.ttPayload.start_time } : null),
      ttPayload: previous.ttPayload,
      ttPayloadRevision: previous.ttPayloadRevision,
      ttNeedsLookup: !!previous.ttNeedsLookup || previous.ttId == null && (previous.ttStatus === "sending" || previous.ttStatus === "synced"),
      ttStatus: previous.ttId != null ? "update-pending" : "pending"
    };
  }

  // src/attribution.js
  var CLIENT_DOMAINS = [
    {
      name: "\u0424\u041A\u0414\u0414",
      chatKeywords: ["\u0444\u043A\u0434\u0434", "\u0434\u0438\u0437\u0435\u043B\u044C \u0434\u0435\u0442\u0430\u043B\u044C", "\u0434\u0438\u0437\u0435\u043B\u044C\u0434\u0435\u0442\u0430\u043B\u044C", "\u0434\u0438\u0437\u0435\u043B\u044C", "fkdd"],
      targetWindowPatterns: ["\u0444\u043A\u0434\u0434", "212.116.122.178", "\u0434\u0438\u0437\u0435\u043B\u044C"],
      alienWindowPatterns: ["192.168.10.10", "\u043A\u0441\u0441", "\u0430\u0432\u0442\u043E\u043B\u0438\u0434\u0435\u0440", "\u0430\u0432\u0442\u043E\u0440\u0438\u0442\u0435\u0442"],
      defaultConsultationMinutes: 5
    },
    {
      name: "\u041A\u0421\u0421",
      chatKeywords: ["\u043A\u0441\u0441", "\u043A\u043E\u0441\u0442\u0440\u043E\u043C\u0441\u043A\u0438\u0435 \u0441\u0435\u0442\u0438", "\u043A\u043E\u0441\u0442\u0440\u043E\u043C\u0430\u0441\u0435\u0442\u044C"],
      targetWindowPatterns: ["\u043A\u0441\u0441", "192.168.10.10", "\u043A\u043E\u0441\u0442\u0440\u043E\u043C\u0430"],
      alienWindowPatterns: ["212.116.122.178", "\u0444\u043A\u0434\u0434", "\u0430\u0432\u0442\u043E\u043B\u0438\u0434\u0435\u0440"],
      defaultConsultationMinutes: 5
    },
    {
      name: "\u0413\u041A \u041E\u043F\u0442\u0438\u043C\u0430",
      chatKeywords: ["\u043E\u043F\u0442\u0438\u043C\u0430", "\u0433\u043A \u043E\u043F\u0442\u0438\u043C\u0430", "\u043A\u0443\u0431\u0430\u043D\u044C", "optima"],
      targetWindowPatterns: ["\u043E\u043F\u0442\u0438\u043C\u0430", "\u043A\u0443\u0431\u0430\u043D\u044C", "optima", "\u0430\u043B\u044C\u0444\u0430-\u0430\u0432\u0442\u043E: \u0430\u0432\u0442\u043E\u0441\u0430\u043B\u043E\u043D"],
      alienWindowPatterns: ["\u0444\u043A\u0434\u0434", "212.116.122.178", "\u043A\u0441\u0441"],
      defaultConsultationMinutes: 5
    },
    {
      name: "\u0410\u0432\u0442\u043E\u043B\u0438\u0434\u0435\u0440",
      chatKeywords: ["\u0430\u0432\u0442\u043E\u043B\u0438\u0434\u0435\u0440", "\u043B\u0438\u0434\u0435\u0440"],
      targetWindowPatterns: ["\u0430\u0432\u0442\u043E\u043B\u0438\u0434\u0435\u0440"],
      alienWindowPatterns: ["212.116.122.178", "192.168.10.10"],
      defaultConsultationMinutes: 5
    },
    {
      name: "\u0410\u0432\u0442\u043E\u0440\u0438\u0442\u0435\u0442",
      chatKeywords: ["\u0430\u0432\u0442\u043E\u0440\u0438\u0442\u0435\u0442"],
      targetWindowPatterns: ["\u0430\u0432\u0442\u043E\u0440\u0438\u0442\u0435\u0442"],
      alienWindowPatterns: ["212.116.122.178", "192.168.10.10"],
      defaultConsultationMinutes: 5
    }
  ];
  function ttMatchClientDomain(chatTitle) {
    if (!chatTitle) return null;
    const lower = chatTitle.toLowerCase();
    for (const d of CLIENT_DOMAINS) {
      if (d.chatKeywords.some((kw) => lower.includes(kw))) {
        return d;
      }
    }
    return null;
  }
  function ttExtractAnyDeskIds(dialogText) {
    if (!dialogText) return [];
    const text = String(dialogText).replace(/[\s-]/g, "");
    const matches = text.match(/\b\d{9,10}\b/g);
    return matches ? Array.from(new Set(matches)) : [];
  }
  function ttCalculateRetrospectiveAttribution(records, chatTitle, dialogText, replyTimeMs, requestTimeMs) {
    const domain = ttMatchClientDomain(chatTitle);
    const anydeskIds = ttExtractAnyDeskIds(dialogText);
    let minBound = replyTimeMs - 120 * 60 * 1e3;
    if (requestTimeMs && requestTimeMs < replyTimeMs) {
      const reqGrace = requestTimeMs - 5 * 60 * 1e3;
      if (reqGrace > minBound) minBound = reqGrace;
    }
    const parsedRecords = [];
    for (const r of records || []) {
      if (!r.start_time || !r.end_time) continue;
      const t1 = new Date(r.start_time).getTime();
      const t2 = new Date(r.end_time).getTime();
      if (isNaN(t1) || isNaN(t2) || t2 <= t1) continue;
      parsedRecords.push({
        title: r.window_title || "",
        titleLower: (r.window_title || "").toLowerCase(),
        t1,
        t2
      });
    }
    let activeMs = 0;
    let method = "fast_consultation";
    let matchedDomain = domain ? domain.name : null;
    for (let i = parsedRecords.length - 1; i >= 0; i--) {
      const item = parsedRecords[i];
      if (item.t1 >= replyTimeMs) continue;
      if (item.t2 <= minBound) break;
      const wtLower = item.titleLower;
      if (domain && domain.alienWindowPatterns.some((ap) => wtLower.includes(ap))) {
        break;
      }
      let isHit = false;
      if (anydeskIds.length > 0 && anydeskIds.some((id) => wtLower.includes(id))) {
        isHit = true;
        method = "anydesk_session";
      }
      if (!isHit && domain && domain.targetWindowPatterns.some((tp) => wtLower.includes(tp))) {
        isHit = true;
        method = "domain_window";
      }
      if (!isHit && !domain && anydeskIds.length === 0) {
        const isGeneric1C = wtLower.includes("1\u0441:\u043F\u0440\u0435\u0434\u043F\u0440\u0438\u044F\u0442\u0438\u0435") || wtLower.includes("\u043A\u043E\u043D\u0444\u0438\u0433\u0443\u0440\u0430\u0442\u043E\u0440");
        const isMaxChat = wtLower.includes("max") || wtLower.includes("\u0447\u0430\u0442");
        if (isGeneric1C || isMaxChat) {
          isHit = true;
          method = "generic_active_window";
        }
      }
      if (isHit) {
        const segStart = Math.max(item.t1, minBound);
        const segEnd = Math.min(item.t2, replyTimeMs);
        if (segEnd > segStart) {
          activeMs += segEnd - segStart;
        }
      }
    }
    const calcMins = Math.round(activeMs / 6e4);
    let finalMinutes = 5;
    if (calcMins <= 0) {
      finalMinutes = domain ? domain.defaultConsultationMinutes : 5;
    } else {
      finalMinutes = Math.max(5, calcMins);
    }
    if (finalMinutes > 120) finalMinutes = 120;
    return {
      minutes: finalMinutes,
      activeMs,
      matchedDomain,
      method
    };
  }

  // src/timetracker-sync.js
  var WRITES = /* @__PURE__ */ new Set(["pending", "sending", "update-pending", "updating"]);
  var DELETES = /* @__PURE__ */ new Set(["delete-pending", "delete-after-send"]);
  var needsTimeTrackerSync = (record) => WRITES.has(record.ttStatus) || DELETES.has(record.ttStatus);
  var revision = (record) => record?.revision || 0;
  function timeTrackerPayload(record) {
    const firstEnd = new Date(record.firstCompletedAt || record.completedAt);
    const start = record.ttAnchor?.start_time ? new Date(record.ttAnchor.start_time) : new Date(firstEnd.getTime() - record.minutes * 6e4);
    const end = new Date(start.getTime() + record.minutes * 6e4);
    const pad = (n) => String(n).padStart(2, "0");
    const date2 = record.ttAnchor?.date || `${firstEnd.getFullYear()}-${pad(firstEnd.getMonth() + 1)}-${pad(firstEnd.getDate())}`;
    const short = (text) => String(text || "").replace(/\s+/g, " ").slice(0, 70);
    const answers = String(record.replyText || "").replace(/\s+/g, " ").trim();
    return {
      date: date2,
      task_name: `${short(record.authorName || record.authorId || "\u041A\u043B\u0438\u0435\u043D\u0442")}: ${short(record.requestText || "\u0412\u043B\u043E\u0436\u0435\u043D\u0438\u0435")} | ${record.operatorName}: ${answers}`,
      start_time: start.toISOString(),
      end_time: end.toISOString(),
      minutes: record.minutes,
      include_idle: false,
      onec_description: "\u0412\u044B\u043F\u043E\u043B\u043D\u0435\u043D\u043D\u044B\u0435 \u0440\u0430\u0431\u043E\u0442\u044B",
      onec_synced: false,
      chat_name: record.chatTitle || ""
    };
  }
  async function syncTimeTracker({ getRecords, commit, request, prepare, onChanged = () => {
  } }) {
    if (!(await request("/api/health")).ok) return false;
    let followUp = false;
    async function resolveId(snapshot2, deleting = false) {
      if (snapshot2.ttId != null) return snapshot2.ttId;
      const payload = snapshot2.ttPayload;
      if (!payload) {
        await commit((records) => {
          records[snapshot2.sessionId].ttError = "\u041D\u0435 \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B \u0434\u0430\u043D\u043D\u044B\u0435 \u0434\u043B\u044F \u043E\u0434\u043D\u043E\u0437\u043D\u0430\u0447\u043D\u043E\u0433\u043E \u043F\u043E\u0438\u0441\u043A\u0430 \u0437\u0430\u043F\u0438\u0441\u0438 TimeTracker";
        });
        return void 0;
      }
      const response = await request(`/api/tasks?date=${encodeURIComponent(payload.date)}`);
      if (!response.ok) throw Error(`TimeTracker: HTTP ${response.status}`);
      const result = await response.json();
      const matches = (result.tasks || []).filter((t) => t.task_name === payload.task_name && t.start_time === payload.start_time && t.end_time === payload.end_time);
      if (matches.length > 1) {
        await commit((records) => {
          records[snapshot2.sessionId].ttError = "\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u0434\u043D\u043E\u0437\u043D\u0430\u0447\u043D\u043E \u043D\u0430\u0439\u0442\u0438 \u0441\u043E\u0431\u0441\u0442\u0432\u0435\u043D\u043D\u0443\u044E \u0437\u0430\u043F\u0438\u0441\u044C TimeTracker";
        });
        return void 0;
      }
      const id = matches[0]?.id ?? null;
      await commit((records) => {
        const latest = records[snapshot2.sessionId];
        if (id != null) {
          latest.ttId = id;
          latest.ttAnchor ||= { date: payload.date, start_time: payload.start_time };
        }
        latest.ttNeedsLookup = false;
        if (deleting && id == null) latest.ttStatus = "deleted";
      });
      return id;
    }
    async function deleteRecord(snapshot2) {
      const id = await resolveId(snapshot2, true);
      if (id == null) return;
      const latest = getRecords()[snapshot2.sessionId];
      const date2 = latest.ttAnchor?.date || latest.ttPayload?.date;
      if (!date2) return;
      const response = await request(`/api/tasks/${encodeURIComponent(id)}?date=${encodeURIComponent(date2)}`, { method: "DELETE" });
      if (response.ok || response.status === 404) {
        await commit((records) => {
          records[snapshot2.sessionId].ttStatus = "deleted";
          delete records[snapshot2.sessionId].ttError;
        });
        onChanged();
      }
    }
    for (const sessionId of Object.keys(getRecords())) {
      let snapshot2 = structuredClone(getRecords()[sessionId]);
      if (DELETES.has(snapshot2.ttStatus)) {
        await deleteRecord(snapshot2);
        continue;
      }
      if (snapshot2.deleted || !WRITES.has(snapshot2.ttStatus)) continue;
      if (snapshot2.ttId == null && (snapshot2.ttNeedsLookup || snapshot2.ttStatus === "sending")) {
        if (await resolveId(snapshot2) === void 0) continue;
        snapshot2 = structuredClone(getRecords()[sessionId]);
        if (snapshot2.deleted) {
          if (DELETES.has(snapshot2.ttStatus)) await deleteRecord(snapshot2);
          continue;
        }
      }
      const prepared = snapshot2.ttPayload && snapshot2.ttPayloadRevision === revision(snapshot2) ? { payload: snapshot2.ttPayload, minutes: snapshot2.minutes, extraMs: snapshot2.attributionExtraMs || 0 } : await prepare(snapshot2);
      const outgoing = await commit((records) => {
        const latest = records[sessionId];
        if (latest.deleted || revision(latest) !== revision(snapshot2)) return null;
        latest.minutes = Math.max(latest.minutes, prepared.minutes);
        latest.attributionExtraMs = prepared.extraMs ?? latest.attributionExtraMs ?? 0;
        latest.ttPayload = prepared.payload;
        latest.ttPayloadRevision = revision(latest);
        latest.ttStatus = latest.ttId != null ? "updating" : "sending";
        if (latest.ttId == null) latest.ttNeedsLookup = true;
        return structuredClone(latest);
      });
      if (!outgoing) {
        followUp = true;
        continue;
      }
      const updating = outgoing.ttId != null;
      const response = await request(updating ? `/api/tasks/${encodeURIComponent(outgoing.ttId)}` : "/api/tasks", {
        method: updating ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(outgoing.ttPayload)
      });
      if (!response.ok) {
        await commit((records) => {
          const latest = records[sessionId];
          latest.ttError = `TimeTracker: HTTP ${response.status}`;
          if (!latest.deleted && revision(latest) === revision(outgoing)) latest.ttStatus = updating ? "update-pending" : "sending";
        });
        break;
      }
      const body = await response.json().catch(() => null);
      await commit((records) => {
        const latest = records[sessionId];
        latest.ttId = outgoing.ttId ?? body?.id ?? body?.task?.id ?? null;
        latest.ttAnchor ||= { date: outgoing.ttPayload.date, start_time: outgoing.ttPayload.start_time };
        latest.ttNeedsLookup = latest.ttId == null;
        delete latest.ttError;
        if (latest.deleted) latest.ttStatus = "delete-pending";
        else if (revision(latest) === revision(outgoing)) latest.ttStatus = "synced";
        else {
          latest.ttStatus = latest.ttId != null ? "update-pending" : "pending";
          followUp = true;
        }
      });
      onChanged();
      snapshot2 = getRecords()[sessionId];
      if (DELETES.has(snapshot2.ttStatus)) await deleteRecord(snapshot2);
    }
    return followUp;
  }

  // src/operator-name.js
  var normalizeOperatorName = (value) => String(value || "").trim().replace(/\s+/g, " ").slice(0, 100);
  var hasOperatorName = (value) => {
    const name = normalizeOperatorName(value);
    return !!name && !/^(оператор|operator)$/i.test(name);
  };

  // src/max-profile.js
  var modulePath = /^\/_app\/immutable\/chunks\/[A-Za-z0-9_-]{1,64}\.js$/;
  var exportName = /^[A-Za-z_$][A-Za-z0-9_$]{0,31}$/;
  var reservedExports = /* @__PURE__ */ new Set(["__proto__", "prototype", "constructor"]);
  function parseMaxProfile(value) {
    if (value?.schema !== 1 || typeof value.revision !== "string" || !/^[A-Za-z0-9._-]{1,48}$/.test(value.revision) || !Array.isArray(value.models) || value.models.length < 1 || value.models.length > 8) return null;
    const models = [];
    for (const model of value.models) {
      if (typeof model?.module !== "string" || !modulePath.test(model.module)) return null;
      const names = [model.chat, model.router, model.viewer];
      if (!names.every((name) => typeof name === "string" && exportName.test(name) && !reservedExports.has(name))) return null;
      models.push({ module: model.module, chat: model.chat, router: model.router, viewer: model.viewer });
    }
    return { schema: 1, revision: value.revision, models };
  }
  function cachedMaxProfile(doc2) {
    if (doc2?.maxCompatibility?.hubUrl !== doc2?.config?.lanUrl) return null;
    return doc2?.maxCompatibility?.profile || null;
  }

  // src/background.js
  var STORAGE = "maxtracker_v3";
  var doc;
  var durableDoc;
  var serial = Promise.resolve();
  var socket;
  var retryTimer;
  var pingTimer;
  var retryMs = 1500;
  var mismatch = false;
  var ttBusy = false;
  var ports = /* @__PURE__ */ new Set();
  var lan = { connected: false, detail: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435\u2026" };
  var loading = (async () => {
    const stored = (await chrome.storage.local.get(STORAGE))[STORAGE];
    doc = stored?.version === 3 ? stored : {
      version: 3,
      deviceId: crypto.randomUUID(),
      config: { operatorName: "\u041E\u043F\u0435\u0440\u0430\u0442\u043E\u0440", lanUrl: "ws://192.168.100.90:8766", lanEnabled: true },
      committed: {},
      pending: [],
      cursor: 0,
      metadata: {},
      records: {},
      suppressed: {},
      lastAlive: Date.now()
    };
    for (const record of Object.values(doc.records)) {
      if (!record.completionEventId) {
        const task = (doc.displayMessages || doc.committed)[messageKey(record)];
        const pending = doc.pending.find((e) => e.type === "COMPLETE" && e.sessionId === record.sessionId || e.type === "TAKEOVER" && e.fromSessionId === record.sessionId);
        record.completionEventId = pending?.eventId || (task?.sessionId === record.sessionId && task.status === "completed" ? task.lastEventId : void 0);
        if (record.elapsedMs == null && task?.sessionId === record.sessionId) record.elapsedMs = task.accumulatedMs;
      }
      record.firstCompletedAt ||= record.completedAt;
      record.firstElapsedMs ??= record.elapsedMs;
      if (record.attributionExtraMs == null && record.elapsedMs != null && record.minutes > 5) record.attributionExtraMs = Math.max(0, record.minutes * 6e4 - record.elapsedMs);
      record.revision ||= 0;
      if (record.ttPayload && record.ttPayloadRevision == null) record.ttPayloadRevision = record.revision;
      if (record.ttPayload && record.ttStatus === "synced") record.ttAnchor ||= { date: record.ttPayload.date, start_time: record.ttPayload.start_time };
    }
    durableDoc = structuredClone(doc);
    const boot = await chrome.storage.session.get("maxtracker_boot");
    if (!boot.maxtracker_boot) {
      pauseOthers(null, doc.lastAlive || Date.now());
      await chrome.storage.session.set({ maxtracker_boot: true });
    }
    await save();
  })();
  function exclusive(fn) {
    const result = serial.then(async () => {
      await loading;
      return fn();
    });
    serial = result.catch(() => {
    });
    return result;
  }
  function projection() {
    return projectMessages(doc.committed, doc.pending);
  }
  function snapshot() {
    return { version: 3, deviceId: doc.deviceId, config: doc.config, needsName: !hasOperatorName(doc.config.operatorName), messages: projection().messages, metadata: doc.metadata, records: doc.records, lan, suppressed: doc.suppressed, excludedChats: doc.excludedChats ?? [], maxProfile: cachedMaxProfile(doc) };
  }
  async function save() {
    doc.displayMessages = projectMessages(doc.committed, doc.pending).messages;
    try {
      await chrome.storage.local.set({ [STORAGE]: doc });
      durableDoc = structuredClone(doc);
    } catch {
      doc = structuredClone(durableDoc);
      throw Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u0441\u043E\u0445\u0440\u0430\u043D\u0438\u0442\u044C \u0437\u0430\u0434\u0430\u0447\u0443 \u0432 \u043F\u0430\u043C\u044F\u0442\u0438 \u0431\u0440\u0430\u0443\u0437\u0435\u0440\u0430. \u041F\u0440\u043E\u0432\u0435\u0440\u044C\u0442\u0435 \u0441\u0432\u043E\u0431\u043E\u0434\u043D\u043E\u0435 \u043C\u0435\u0441\u0442\u043E.");
    }
  }
  function broadcast() {
    const state = snapshot();
    for (const port of ports) {
      try {
        port.postMessage({ type: "STATE", state });
      } catch {
        ports.delete(port);
      }
    }
    return state;
  }
  function addEffects(result) {
    if (!result.accepted || result.duplicate) return;
    const record = localWorkRecord(result.closed, doc.metadata[messageKey(result.closed || {})] || {}, doc.deviceId);
    if (record) doc.records[record.sessionId] = mergeWorkRecord(doc.records[record.sessionId], record);
    if (result.reset?.ownerDeviceId === doc.deviceId) {
      const record2 = doc.records[result.reset.sessionId];
      if (record2) {
        record2.deleted = true;
        record2.ttStatus = record2.ttId != null || record2.ttNeedsLookup || ["synced", "updating", "update-pending"].includes(record2.ttStatus) ? "delete-pending" : record2.ttStatus === "sending" ? "delete-after-send" : "cancelled";
      }
    }
  }
  function createEvent(type, target, extra = {}) {
    const old = projection().messages[messageKey(target)];
    return {
      type,
      chatId: target.chatId,
      messageId: target.messageId,
      eventId: crypto.randomUUID(),
      eventAt: Date.now(),
      deviceId: doc.deviceId,
      operatorName: doc.config.operatorName,
      sessionId: ["START", "TAKEOVER"].includes(type) || type === "REOPEN" && old?.ownerDeviceId !== doc.deviceId ? crypto.randomUUID() : old?.sessionId || "",
      expectedEventId: old?.lastEventId || "",
      ...extra
    };
  }
  function appendEvent(event) {
    const result = reduceEvent(projection().messages, event);
    if (!result.accepted) throw Error(result.reason);
    doc.pending.push(event);
    addEffects(result);
    return result;
  }
  function pauseOthers(exceptKey, time = Date.now()) {
    for (const task of Object.values(projection().messages)) {
      if (task.ownerDeviceId === doc.deviceId && task.status === "running" && messageKey(task) !== exceptKey) {
        appendEvent(createEvent("PAUSE", task, { eventAt: Math.max(task.lastResumeTime, time) }));
      }
    }
  }
  async function command(message, sender) {
    const target = message.target;
    const action = message.action;
    if (!target || typeof target.chatId !== "string" || typeof target.messageId !== "string") throw Error("\u041D\u0435 \u043F\u043E\u043B\u0443\u0447\u0435\u043D\u044B \u0441\u0435\u0440\u0432\u0435\u0440\u043D\u044B\u0435 ID \u0441\u043E\u043E\u0431\u0449\u0435\u043D\u0438\u044F");
    if (isChatExcluded(doc, target.chatId)) return { state: snapshot() };
    const key = messageKey(target);
    let old = projection().messages[key];
    if (action === "REPLY_SELECTED") {
      if (!target.canTrack || target.isOut) return { state: broadcast() };
      if (old && OPEN.has(old.status) && old.ownerDeviceId !== doc.deviceId) return { needsTakeover: true, task: old, state: broadcast() };
      if (doc.suppressed[key] && old?.status !== "completed") return { state: broadcast(), suppressed: true };
      if (old?.status === "running") return { state: broadcast() };
      pauseOthers(key);
      doc.metadata[key] = { ...target, ownerTabId: sender.tab?.id, ownerDocumentId: sender.documentId || "" };
      if (old?.status === "completed") {
        appendEvent(createEvent("REOPEN", target, { fromSessionId: old.sessionId, fromDeviceId: old.ownerDeviceId }));
        delete doc.suppressed[key];
      } else appendEvent(createEvent(old?.status === "paused" ? "RESUME" : "START", target));
    } else if (action === "TAKEOVER") {
      if (!old || !OPEN.has(old.status) || old.ownerDeviceId === doc.deviceId) throw Error("\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044C \u0443\u0436\u0435 \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u0441\u044F");
      if (message.fromSessionId !== old.sessionId) throw Error("\u0417\u0430\u0434\u0430\u0447\u0430 \u0443\u0436\u0435 \u043F\u0435\u0440\u0435\u0434\u0430\u043D\u0430 \u0434\u0440\u0443\u0433\u043E\u043C\u0443 \u0441\u043E\u0442\u0440\u0443\u0434\u043D\u0438\u043A\u0443");
      pauseOthers(key);
      doc.metadata[key] = { ...target, ownerTabId: sender.tab?.id, ownerDocumentId: sender.documentId || "" };
      appendEvent(createEvent("TAKEOVER", target, { fromSessionId: old.sessionId, fromDeviceId: old.ownerDeviceId }));
      delete doc.suppressed[key];
    } else if (action === "PAUSE" || action === "RESUME" || action === "CANCEL" || action === "RESET") {
      if (!old || old.ownerDeviceId !== doc.deviceId) throw Error("\u0423\u043F\u0440\u0430\u0432\u043B\u0435\u043D\u0438\u0435 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044E");
      if (action === "RESUME") {
        pauseOthers(key);
        doc.metadata[key] = { ...doc.metadata[key], ownerTabId: sender.tab?.id, ownerDocumentId: sender.documentId || "" };
      }
      appendEvent(createEvent(action, target));
      if (action === "CANCEL" && message.suppressReply !== false) doc.suppressed[key] = true;
      else if (action === "CANCEL" || action === "RESET") delete doc.suppressed[key];
    } else if (action === "COMPLETE") {
      if (!old || old.ownerDeviceId !== doc.deviceId || !OPEN.has(old.status)) return { state: broadcast() };
      if (old.sentMessageId === message.sentMessageId || old.completedMessageIds?.includes(message.sentMessageId)) return { state: broadcast() };
      appendEvent(createEvent("COMPLETE", target, { sentMessageId: message.sentMessageId, replyText: message.replyText || "" }));
      doc.suppressed[key] = true;
    } else throw Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u0430\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u0430");
    await save();
    const state = broadcast();
    flushLan();
    void flushTimeTracker();
    return { state };
  }
  function flushLan() {
    if (socket?.readyState !== WebSocket.OPEN || !lan.connected) return;
    for (const event of doc.pending) {
      const { replyText, ...wireEvent } = event;
      try {
        socket.send(JSON.stringify({ type: "EVENT", event: wireEvent }));
      } catch {
        return;
      }
    }
  }
  function connectLan() {
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    if (!doc.config.lanEnabled) {
      lan = { connected: false, detail: "\u0410\u0432\u0442\u043E\u043D\u043E\u043C\u043D\u044B\u0439 \u0440\u0435\u0436\u0438\u043C" };
      broadcast();
      return;
    }
    if (socket?.readyState === WebSocket.OPEN || socket?.readyState === WebSocket.CONNECTING) return;
    mismatch = false;
    lan = { connected: false, detail: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435\u2026" };
    broadcast();
    const hubUrl = doc.config.lanUrl;
    let ws;
    try {
      ws = new WebSocket(hubUrl);
    } catch {
      lan = { connected: false, detail: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u043E. \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B." };
      broadcast();
      retryTimer = setTimeout(connectLan, Math.min(3e4, retryMs *= 2));
      return;
    }
    socket = ws;
    let lastReceived = Date.now();
    ws.onopen = () => {
      if (socket !== ws) return;
      retryMs = 1500;
      ws.send(JSON.stringify({ type: "HELLO", protocol: 3, deviceId: doc.deviceId, operatorName: doc.config.operatorName, cursor: doc.cursor, capabilities: ["max-profile-v1"] }));
      pingTimer = setInterval(() => {
        if (Date.now() - lastReceived > 45e3) {
          ws.close();
          return;
        }
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ type: "PING" }));
          } catch {
            ws.close();
          }
        }
      }, 2e4);
    };
    ws.onmessage = (event) => {
      if (socket !== ws) return;
      lastReceived = Date.now();
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      if (data.type === "SYNC_STATE") {
        mismatch = true;
        lan = { connected: false, detail: "\u0422\u0435\u043A\u0443\u0449\u0438\u0439 \u0445\u0430\u0431 \u0438\u0441\u043F\u043E\u043B\u044C\u0437\u0443\u0435\u0442 \u0441\u0442\u0430\u0440\u044B\u0439 \u043F\u0440\u043E\u0442\u043E\u043A\u043E\u043B. \u041D\u0443\u0436\u0435\u043D LAN Hub 3." };
        broadcast();
        ws.close();
        return;
      }
      if (data.type === "WELCOME" && data.protocol === 3) {
        lan = { connected: true, detail: "\u041F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u043E", peers: data.peers || [] };
        broadcast();
        flushLan();
        return;
      }
      if (data.type === "MAX_PROFILE" && lan.connected) {
        const profile = parseMaxProfile(data.profile);
        if (profile) void exclusive(async () => {
          if (socket !== ws || doc.config.lanUrl !== hubUrl || JSON.stringify(cachedMaxProfile(doc)) === JSON.stringify(profile)) return;
          doc.maxCompatibility = { hubUrl, profile };
          await save();
          broadcast();
        }).catch((error) => notify(error.message));
        return;
      }
      if (data.type === "ERROR") {
        lan = { connected: false, detail: data.error || "\u0425\u0430\u0431 \u043E\u0442\u043A\u043B\u043E\u043D\u0438\u043B \u043F\u043E\u0434\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435" };
        broadcast();
      }
      if (data.type === "BATCH" && Array.isArray(data.entries)) void exclusive(async () => {
        for (const entry of data.entries) {
          if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= doc.cursor) continue;
          if (entry.sequence !== doc.cursor + 1) {
            ws.close();
            return;
          }
          const result = reduceEvent(doc.committed, entry.event);
          if (result.accepted) {
            doc.committed = result.messages;
            addEffects(result);
          }
          const wasPending = doc.pending.some((e) => e.eventId === entry.event?.eventId);
          doc.pending = doc.pending.filter((e) => e.eventId !== entry.event?.eventId);
          if (wasPending && !result.accepted) notify("\u0421\u043E\u0441\u0442\u043E\u044F\u043D\u0438\u0435 \u043E\u0431\u0440\u0430\u0449\u0435\u043D\u0438\u044F \u0438\u0437\u043C\u0435\u043D\u0438\u043B\u043E\u0441\u044C \u0443 \u043A\u043E\u043B\u043B\u0435\u0433\u0438. \u041B\u043E\u043A\u0430\u043B\u044C\u043D\u0430\u044F \u043A\u043E\u043C\u0430\u043D\u0434\u0430 \u043D\u0435 \u043F\u0440\u0438\u043C\u0435\u043D\u0435\u043D\u0430.");
          doc.cursor = entry.sequence;
        }
        await save();
        broadcast();
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "RECEIVED", sequence: doc.cursor }));
        void flushTimeTracker();
      }).catch((error) => notify(error.message));
    };
    ws.onerror = () => {
    };
    ws.onclose = () => {
      if (socket !== ws) return;
      clearInterval(pingTimer);
      if (!mismatch) {
        lan = { connected: false, detail: "\u041D\u0435\u0442 \u0441\u0432\u044F\u0437\u0438. \u0418\u0437\u043C\u0435\u043D\u0435\u043D\u0438\u044F \u0441\u043E\u0445\u0440\u0430\u043D\u0435\u043D\u044B \u043B\u043E\u043A\u0430\u043B\u044C\u043D\u043E." };
        broadcast();
        retryTimer = setTimeout(connectLan, retryMs);
        retryMs = Math.min(3e4, retryMs * 2);
      }
    };
  }
  function notify(text) {
    for (const port of ports) {
      try {
        port.postMessage({ type: "NOTICE", text });
      } catch {
      }
    }
  }
  async function ttFetch(path, options = {}) {
    return fetch(`http://127.0.0.1:5000${path}`, { ...options, signal: AbortSignal.timeout(3e3) });
  }
  async function refreshTimeTrackerTabs() {
    try {
      const tabs = await chrome.tabs.query({ url: ["http://127.0.0.1/*", "http://localhost/*"] });
      for (const tab of tabs) {
        if (tab.id == null || !tab.url) continue;
        const url = new URL(tab.url);
        if (url.port === "5000") void chrome.tabs.reload(tab.id).catch(() => {
        });
      }
    } catch {
    }
  }
  async function flushTimeTracker() {
    await loading;
    if (ttBusy || !Object.values(doc.records).some(needsTimeTrackerSync)) return;
    ttBusy = true;
    let followUp = false;
    try {
      followUp = await syncTimeTracker({
        getRecords: () => doc.records,
        commit: (fn) => exclusive(async () => {
          const result = fn(doc.records);
          await save();
          broadcast();
          return result;
        }),
        request: ttFetch,
        onChanged: () => void refreshTimeTrackerTabs(),
        prepare: async (record) => {
          let minutes2 = record.minutes;
          let extraMs = record.attributionExtraMs || 0;
          if (!record.ttPayload && !record.ttAnchor) {
            try {
              const dataResponse = await ttFetch(`/api/data?date=${encodeURIComponent(timeTrackerPayload(record).date)}`);
              if (dataResponse.ok) {
                const data = await dataResponse.json();
                if (Array.isArray(data.records)) {
                  const attributed = ttCalculateRetrospectiveAttribution(data.records, record.chatTitle || "", `${record.requestText || ""} ${record.replyText || ""}`, record.firstCompletedAt || record.completedAt, record.startedAt);
                  extraMs = Math.max(0, Math.min(attributed.activeMs || 0, 120 * 6e4) - (record.firstElapsedMs ?? record.elapsedMs ?? 0));
                  minutes2 = Math.max(minutes2, Math.round(((record.elapsedMs || 0) + extraMs) / 6e4), attributed.minutes, 5);
                }
              }
            } catch {
            }
          }
          return { minutes: minutes2, extraMs, payload: timeTrackerPayload({ ...record, minutes: minutes2 }) };
        }
      });
    } catch {
    } finally {
      ttBusy = false;
      if (followUp) void flushTimeTracker();
    }
  }
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== "mta-max" || !port.sender?.url?.startsWith("https://web.max.ru/")) return;
    ports.add(port);
    void exclusive(async () => {
      port.postMessage({ type: "STATE", state: snapshot() });
    });
    port.onMessage.addListener((message) => {
      if (message.type === "ALIVE") void exclusive(async () => {
        doc.lastAlive = Date.now();
        await save();
      });
    });
    port.onDisconnect.addListener(() => {
      ports.delete(port);
      void exclusive(async () => {
        for (const task of Object.values(projection().messages)) {
          const meta = doc.metadata[messageKey(task)];
          if (task.ownerDeviceId === doc.deviceId && task.status === "running" && meta?.ownerTabId === port.sender.tab?.id && (!meta.ownerDocumentId || meta.ownerDocumentId === port.sender.documentId)) {
            appendEvent(createEvent("PAUSE", task));
          }
        }
        await save();
        broadcast();
        flushLan();
      });
    });
  });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    void exclusive(async () => {
      if (message.type === "GET_STATE") return { state: snapshot() };
      if (message.type === "CMD") {
        if (!sender.url?.startsWith("https://web.max.ru/")) throw Error("\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437 MAX");
        return command(message, sender);
      }
      if (message.type === "SET_CHAT_EXCLUDED") {
        if (!sender.url?.startsWith("https://web.max.ru/")) throw Error("\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437 MAX");
        const { chatId, excluded } = message;
        if (typeof chatId !== "string" || !/^-?[1-9]\d{0,19}$/.test(chatId) || typeof excluded !== "boolean") throw Error("\u041D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C \u043E\u043F\u0440\u0435\u0434\u0435\u043B\u0438\u0442\u044C \u0447\u0430\u0442");
        if (isChatExcluded(doc, chatId) === excluded) return { state: snapshot() };
        const saved = doc.excludedChats ?? [];
        doc.excludedChats = excluded ? [...saved, chatId] : saved.filter((id) => id !== chatId);
        if (excluded) {
          for (const task of Object.values(projection().messages)) {
            if (task.chatId === chatId && task.ownerDeviceId === doc.deviceId && task.status === "running") {
              appendEvent(createEvent("PAUSE", task));
            }
          }
        }
        await save();
        const state = broadcast();
        flushLan();
        return { state };
      }
      if (message.type === "DISMISS_REPLY") {
        if (!sender.url?.startsWith("https://web.max.ru/")) throw Error("\u041A\u043E\u043C\u0430\u043D\u0434\u0430 \u0434\u043E\u0441\u0442\u0443\u043F\u043D\u0430 \u0442\u043E\u043B\u044C\u043A\u043E \u0438\u0437 MAX");
        const target = message.target;
        if (typeof target?.chatId !== "string" || typeof target?.messageId !== "string") return { ok: true };
        const key = messageKey(target), task = projection().messages[key], meta = doc.metadata[key];
        if (!isChatExcluded(doc, target.chatId) && task?.ownerDeviceId === doc.deviceId && OPEN.has(task.status) && meta?.ownerTabId === sender.tab?.id && (!meta.ownerDocumentId || meta.ownerDocumentId === sender.documentId)) {
          return command({ action: "CANCEL", target, suppressReply: false }, sender);
        }
        if (doc.suppressed[key]) {
          delete doc.suppressed[key];
          await save();
        }
        return { ok: true };
      }
      if (message.type === "REPLY_CLEARED") {
        if (typeof message.key === "string") delete doc.suppressed[message.key];
        await save();
        return { ok: true };
      }
      if (message.type === "PAUSE_CONTEXT") {
        for (const task of Object.values(projection().messages)) {
          const meta = doc.metadata[messageKey(task)];
          if (task.ownerDeviceId === doc.deviceId && task.status === "running" && meta?.ownerTabId === sender.tab?.id && (!meta.ownerDocumentId || meta.ownerDocumentId === sender.documentId) && (!message.key || message.key === messageKey(task)) && (!message.chatId || message.chatId === task.chatId)) appendEvent(createEvent("PAUSE", task));
        }
        await save();
        broadcast();
        flushLan();
        return { ok: true };
      }
      if (message.type === "SAVE_CONFIG") {
        const config = message.config;
        const operatorName = normalizeOperatorName(config.operatorName);
        if (!hasOperatorName(operatorName)) throw Error("\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0441\u0432\u043E\u0451 \u0438\u043C\u044F, \u0447\u0442\u043E\u0431\u044B \u043A\u043E\u043B\u043B\u0435\u0433\u0438 \u0432\u0438\u0434\u0435\u043B\u0438 \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u044F");
        const url = new URL(config.lanUrl);
        if (!["ws:", "wss:"].includes(url.protocol) || !url.hostname) throw Error("\u0423\u043A\u0430\u0436\u0438\u0442\u0435 \u0430\u0434\u0440\u0435\u0441 ws:// \u0438\u043B\u0438 wss://");
        const previousName = doc.config.operatorName;
        doc.config = { operatorName, lanUrl: url.href, lanEnabled: !!config.lanEnabled };
        if (previousName !== operatorName) {
          for (const task of Object.values(projection().messages)) {
            if (task.ownerDeviceId === doc.deviceId && task.status !== "none") appendEvent(createEvent("RENAME", task));
          }
        }
        await save();
        mismatch = false;
        const old = socket;
        socket = null;
        old?.close();
        connectLan();
        return { state: broadcast() };
      }
      if (message.type === "EXPORT") return { text: exportText(doc.records) };
      if (message.type === "OPEN_OPTIONS") {
        await chrome.runtime.openOptionsPage();
        return { ok: true };
      }
      throw Error("\u041D\u0435\u0438\u0437\u0432\u0435\u0441\u0442\u043D\u044B\u0439 \u0437\u0430\u043F\u0440\u043E\u0441");
    }).then((result) => respond({ ok: true, ...result })).catch((error) => respond({ ok: false, error: error.message }));
    return true;
  });
  chrome.tabs.onUpdated.addListener((tabId, change) => {
    if (change.status !== "loading") return;
    void exclusive(async () => {
      for (const task of Object.values(projection().messages)) {
        if (task.ownerDeviceId === doc.deviceId && task.status === "running" && doc.metadata[messageKey(task)]?.ownerTabId === tabId) appendEvent(createEvent("PAUSE", task));
      }
      await save();
      broadcast();
      flushLan();
    });
  });
  chrome.windows.onRemoved.addListener(() => {
    void chrome.windows.getAll().then((windows) => {
      if (windows.length === 0) void exclusive(async () => {
        pauseOthers(null);
        await save();
        broadcast();
        flushLan();
      });
    });
  });
  chrome.action.onClicked.addListener(() => void chrome.runtime.openOptionsPage());
  var promptForName = () => void loading.then(() => {
    if (!hasOperatorName(doc.config.operatorName)) return chrome.runtime.openOptionsPage();
  }).catch(() => {
  });
  chrome.runtime.onInstalled.addListener(promptForName);
  chrome.runtime.onStartup.addListener(promptForName);
  chrome.alarms.create("mta-retry", { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener(() => {
    void loading.then(() => {
      if (!mismatch && socket?.readyState !== WebSocket.OPEN) connectLan();
      else flushLan();
      void flushTimeTracker();
    });
  });
  void loading.then(() => {
    connectLan();
    void flushTimeTracker();
  });
})();
