/**
 * Normaliza un string: quita tildes, pasa a minúsculas, recorta espacios.
 */
function normalizeText(value = "") {
  return value
    .toString()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/**
 * Verifica si haystack contiene needle (ambos normalizados).
 */
function includesNormalized(haystack = "", needle = "") {
  return normalizeText(haystack).includes(normalizeText(needle));
}

/**
 * Verifica si un array contiene un valor (comparación normalizada).
 */
function arrayIncludesNormalized(arr = [], value = "") {
  const normalizedValue = normalizeText(value);
  return arr.some((item) => normalizeText(item) === normalizedValue);
}

/**
 * Cuenta cuántos elementos de sourceArray aparecen en targetArray (normalizado).
 */
function overlapCount(sourceArray = [], targetArray = []) {
  const source = sourceArray.map(normalizeText);
  const target = targetArray.map(normalizeText);

  let count = 0;
  for (const item of source) {
    if (target.includes(item)) count += 1;
  }
  return count;
}

module.exports = {
  normalizeText,
  includesNormalized,
  arrayIncludesNormalized,
  overlapCount
};
