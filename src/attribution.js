  const CLIENT_DOMAINS = [

    {

      name: 'ФКДД',

      chatKeywords: ['фкдд', 'дизель деталь', 'дизельдеталь', 'дизель', 'fkdd'],

      targetWindowPatterns: ['фкдд', '212.116.122.178', 'дизель'],

      alienWindowPatterns: ['192.168.10.10', 'ксс', 'автолидер', 'авторитет'],

      defaultConsultationMinutes: 5,

    },

    {

      name: 'КСС',

      chatKeywords: ['ксс', 'костромские сети', 'костромасеть'],

      targetWindowPatterns: ['ксс', '192.168.10.10', 'кострома'],

      alienWindowPatterns: ['212.116.122.178', 'фкдд', 'автолидер'],

      defaultConsultationMinutes: 5,

    },

    {

      name: 'ГК Оптима',

      chatKeywords: ['оптима', 'гк оптима', 'кубань', 'optima'],

      targetWindowPatterns: ['оптима', 'кубань', 'optima', 'альфа-авто: автосалон'],

      alienWindowPatterns: ['фкдд', '212.116.122.178', 'ксс'],

      defaultConsultationMinutes: 5,

    },

    {

      name: 'Автолидер',

      chatKeywords: ['автолидер', 'лидер'],

      targetWindowPatterns: ['автолидер'],

      alienWindowPatterns: ['212.116.122.178', '192.168.10.10'],

      defaultConsultationMinutes: 5,

    },

    {

      name: 'Авторитет',

      chatKeywords: ['авторитет'],

      targetWindowPatterns: ['авторитет'],

      alienWindowPatterns: ['212.116.122.178', '192.168.10.10'],

      defaultConsultationMinutes: 5,

    },

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

    const text = String(dialogText).replace(/[\s-]/g, '');

    const matches = text.match(/\b\d{9,10}\b/g);

    return matches ? Array.from(new Set(matches)) : [];

  }



  function ttCalculateRetrospectiveAttribution(records, chatTitle, dialogText, replyTimeMs, requestTimeMs) {

    const domain = ttMatchClientDomain(chatTitle);

    const anydeskIds = ttExtractAnyDeskIds(dialogText);



    let minBound = replyTimeMs - (120 * 60 * 1000);

    if (requestTimeMs && requestTimeMs < replyTimeMs) {

      const reqGrace = requestTimeMs - (5 * 60 * 1000);

      if (reqGrace > minBound) minBound = reqGrace;

    }



    const parsedRecords = [];

    for (const r of (records || [])) {

      if (!r.start_time || !r.end_time) continue;

      const t1 = (new Date(r.start_time)).getTime();

      const t2 = (new Date(r.end_time)).getTime();

      if (isNaN(t1) || isNaN(t2) || t2 <= t1) continue;

      parsedRecords.push({

        title: r.window_title || '',

        titleLower: (r.window_title || '').toLowerCase(),

        t1,

        t2,

      });

    }



    let activeMs = 0;

    let method = 'fast_consultation';

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

        method = 'anydesk_session';

      }



      if (!isHit && domain && domain.targetWindowPatterns.some((tp) => wtLower.includes(tp))) {

        isHit = true;

        method = 'domain_window';

      }



      if (!isHit && !domain && anydeskIds.length === 0) {

        const isGeneric1C = wtLower.includes('1с:предприятие') || wtLower.includes('конфигуратор');

        const isMaxChat = wtLower.includes('max') || wtLower.includes('чат');

        if (isGeneric1C || isMaxChat) {

          isHit = true;

          method = 'generic_active_window';

        }

      }



      if (isHit) {

        const segStart = Math.max(item.t1, minBound);

        const segEnd = Math.min(item.t2, replyTimeMs);

        if (segEnd > segStart) {

          activeMs += (segEnd - segStart);

        }

      }

    }



    const calcMins = Math.round(activeMs / 60000);

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

      method,

    };

  }




export {ttCalculateRetrospectiveAttribution as attributeMinutes};
