const modulePath = /^\/_app\/immutable\/chunks\/[A-Za-z0-9_-]{1,64}\.js$/;
const exportName = /^[A-Za-z_$][A-Za-z0-9_$]{0,31}$/;
const reservedExports = new Set(['__proto__', 'prototype', 'constructor']);

export function parseMaxProfile(value) {
  if (value?.schema !== 1 || typeof value.revision !== 'string' ||
      !/^[A-Za-z0-9._-]{1,48}$/.test(value.revision) ||
      !Array.isArray(value.models) || value.models.length < 1 || value.models.length > 8) return null;

  const models = [];
  for (const model of value.models) {
    if (typeof model?.module !== 'string' || !modulePath.test(model.module)) return null;
    const names = [model.chat, model.router, model.viewer];
    if (!names.every(name => typeof name === 'string' && exportName.test(name) && !reservedExports.has(name))) return null;
    models.push({module: model.module, chat: model.chat, router: model.router, viewer: model.viewer});
  }
  return {schema: 1, revision: value.revision, models};
}

export function cachedMaxProfile(doc) {
  if (doc?.maxCompatibility?.hubUrl !== doc?.config?.lanUrl) return null;
  return doc?.maxCompatibility?.profile || null;
}
