export const normalizeOperatorName = value => String(value||'').trim().replace(/\s+/g,' ').slice(0,100);
export const hasOperatorName = value => {
  const name=normalizeOperatorName(value);
  return !!name&&!/^(оператор|operator)$/i.test(name);
};
