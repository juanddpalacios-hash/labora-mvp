"use strict";

/**
 * cvNormalizer.js
 *
 * Toma el perfil ya extraído por aiExtractor + el texto crudo del CV
 * y lo mapea a la estructura estándar de Labora.
 *
 * No genera contenido — solo organiza lo que ya existe.
 * La redacción y optimización ocurren en cvOptimizer.js.
 */

const { normalizeText } = require("../utils/text");
const { emptyCVStructure } = require("./cvStructure");

// ═══════════════════════════════════════════════════════════════════════
// HELPERS DE PARSEO DE TEXTO CRUDO
// ═══════════════════════════════════════════════════════════════════════

/**
 * Intenta extraer el email del texto crudo del CV.
 */
function extractEmail(text) {
  const match = text.match(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);
  return match ? match[0] : "";
}

/**
 * Intenta extraer teléfono (formato chileno o internacional).
 */
function extractPhone(text) {
  const match = text.match(/(\+?56\s?9?\s?\d[\d\s-]{7,}|\+?\d{9,15})/);
  return match ? match[0].replace(/\s+/g, " ").trim() : "";
}

/**
 * Intenta extraer URL de LinkedIn.
 */
function extractLinkedIn(text) {
  const match = text.match(/linkedin\.com\/in\/[\w-]+/i);
  return match ? match[0] : "";
}

/**
 * Extrae el nombre completo. Prioriza el que viene del perfil.
 * Como fallback, busca la primera línea con 2-4 palabras capitalizadas.
 */
function extractName(text, profileName) {
  if (profileName && profileName.trim().length > 2) return profileName.trim();
  const lines = text.split("\n").map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    const words = line.split(/\s+/);
    if (words.length >= 2 && words.length <= 5 &&
        words.every(w => /^[A-ZÁÉÍÓÚÑ]/.test(w))) {
      return line;
    }
  }
  return "";
}

/**
 * Detecta líneas que parecen ser bullets de experiencia.
 * Acepta: "- ...", "• ...", líneas cortas descriptivas.
 */
function parseBulletsFromBlock(block) {
  const lines = block.split("\n").map(l => l.trim()).filter(Boolean);
  const bullets = [];
  for (const line of lines) {
    // Solo líneas con marcador explícito de bullet (evita incluir org/rol/fecha)
    if (!/^[-•·*►]/.test(line)) continue;
    const cleaned = line.replace(/^[-•·*►]\s*/, "").trim();
    if (cleaned.length >= 15 && cleaned.length <= 200) {
      bullets.push(cleaned);
    }
  }
  return bullets.slice(0, 4);
}

/**
 * Parser simple de sección de experiencia del texto crudo.
 *
 * Busca bloques tipo:
 *   Empresa / Organización
 *   Rol o cargo
 *   Fecha
 *   - bullet 1
 *   - bullet 2
 *
 * Limitación conocida: sin LLM, este parseo es frágil con formatos
 * no estándar. Se complementa con los signals del aiExtractor.
 */
function parseExperienceSection(rawText) {
  const experiences = [];
  if (!rawText) return experiences;

  // Buscar la sección de experiencia por encabezados comunes
  const sectionPattern = /\b(experiencia|experience|trabajo|laboral|empleo)\b/i;
  const lines = rawText.split("\n");
  let inSection = false;
  let currentBlock = [];
  const blocks = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inSection && currentBlock.length > 0) {
        blocks.push(currentBlock.join("\n"));
        currentBlock = [];
      }
      continue;
    }
    if (sectionPattern.test(trimmed) && trimmed.length < 40) {
      inSection = true;
      continue;
    }
    // Detectar inicio de siguiente sección principal
    if (inSection && /^(educaci[oó]n|formaci[oó]n|estudios|cursos|habilidades|skills|idiomas|intereses)/i.test(trimmed) && trimmed.length < 40) {
      break;
    }
    if (inSection) currentBlock.push(trimmed);
  }
  if (currentBlock.length > 0) blocks.push(currentBlock.join("\n"));

  // Extraer entradas de cada bloque
  for (const block of blocks) {
    const blockLines = block.split("\n").map(l => l.trim()).filter(Boolean);
    if (blockLines.length < 2) continue;

    // Buscar fecha en las primeras 3 líneas
    const datePattern = /(\d{4}|\bene\b|\bfeb\b|\bmar\b|\babr\b|\bmay\b|\bjun\b|\bjul\b|\bago\b|\bsep\b|\boct\b|\bnov\b|\bdic\b)/i;
    let dateRange = "";
    let dateLineIdx = -1;
    for (let i = 0; i < Math.min(3, blockLines.length); i++) {
      if (datePattern.test(blockLines[i])) {
        dateRange = blockLines[i];
        dateLineIdx = i;
        break;
      }
    }

    const bullets = parseBulletsFromBlock(block);

    experiences.push({
      organization:    blockLines[0] || "",
      role:            blockLines[dateLineIdx === 1 ? 0 : 1] || "",
      date_range:      dateRange,
      bullets:         bullets,
      relevance_score: 0,
    });
  }

  return experiences.slice(0, 5);
}

/**
 * Extrae sección de educación del texto crudo.
 */
function parseEducationSection(rawText) {
  const education = [];
  if (!rawText) return education;

  const sectionPattern = /\b(educaci[oó]n|formaci[oó]n|estudios|universidad|instituto)\b/i;
  const lines = rawText.split("\n");
  let inSection = false;
  let currentBlock = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (!inSection && sectionPattern.test(trimmed) && trimmed.length < 50) {
      inSection = true;
      continue;
    }
    if (inSection && /^(experiencia|cursos|habilidades|skills|idiomas|intereses)/i.test(trimmed) && trimmed.length < 40) {
      break;
    }
    if (inSection) currentBlock.push(trimmed);
  }

  // Parsear bloques de educación
  for (let i = 0; i < currentBlock.length; i += 3) {
    const institution = currentBlock[i]   || "";
    const degree      = currentBlock[i+1] || "";
    const dateRange   = currentBlock[i+2] || "";
    if (institution) {
      education.push({ institution, degree, date_range: dateRange });
    }
  }

  return education.slice(0, 3);
}

/**
 * Extrae cursos/certificaciones del texto crudo.
 */
function parseCourses(rawText) {
  if (!rawText) return [];
  const sectionPattern = /\b(cursos?|certificaciones?|capacitaci[oó]n|diplomado)\b/i;
  const lines = rawText.split("\n");
  let inSection = false;
  const courses = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (sectionPattern.test(trimmed) && trimmed.length < 50) {
      inSection = true;
      continue;
    }
    if (inSection && /^(experiencia|educaci[oó]n|habilidades|idiomas)/i.test(trimmed) && trimmed.length < 40) {
      break;
    }
    if (inSection && trimmed.length > 10) {
      courses.push(trimmed.replace(/^[-•·]\s*/, ""));
    }
  }

  return courses.slice(0, 6);
}

// ═══════════════════════════════════════════════════════════════════════
// NORMALIZADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Mapea el perfil de Labora + texto crudo del CV a la estructura estándar.
 *
 * @param {object} profile  - perfil extraído por aiExtractor + metadata
 * @param {string} rawText  - texto crudo del CV (puede ser "" si no hay CV)
 * @returns {object}        - CV en estructura estándar de Labora
 */
function normalizeCV(profile, rawText = "") {
  const cv = emptyCVStructure();

  // --- HEADER ---
  cv.header.full_name = extractName(rawText, profile.name || "");

  const degreeParts = [profile.degree || ""];
  if (profile.has_postgrad) {
    // Intenta detectar el nombre del posgrado desde el texto
    const postgradMatch = rawText.match(/(magíster|máster|MBA|diplomado)[^,.\n]{0,60}/i);
    if (postgradMatch) degreeParts.push(postgradMatch[0].trim());
  }
  cv.header.degree_line = degreeParts.filter(Boolean).join(" | ");

  const email    = extractEmail(rawText);
  const phone    = extractPhone(rawText);
  const linkedin = extractLinkedIn(rawText);
  cv.header.contact_line = [email, phone, linkedin].filter(Boolean).join(" | ");

  // --- EXPERIENCIA (desde texto crudo + señales del perfil) ---
  const parsedExp = parseExperienceSection(rawText);
  if (parsedExp.length > 0) {
    cv.experience = parsedExp;
  } else if ((profile.experience || []).length > 0) {
    // Si el parseo falla pero hay señales, crear entrada placeholder
    cv.experience = [{
      organization: "(Organización no detectada — completar)",
      role:         "(Rol no detectado — completar)",
      date_range:   "(Fecha — completar)",
      bullets:      profile.experience.map(s => s),
      relevance_score: 0,
    }];
  }

  // --- EDUCACIÓN ---
  const parsedEdu = parseEducationSection(rawText);
  if (parsedEdu.length > 0) {
    cv.education = parsedEdu;
  } else {
    // Fallback desde el perfil
    cv.education = [{
      institution: "(Universidad — completar)",
      degree:      profile.degree || "(Carrera — completar)",
      date_range:  "(Año — completar)",
    }];
    if (profile.has_postgrad) {
      cv.education.push({
        institution: "(Universidad posgrado — completar)",
        degree:      "(Posgrado — completar)",
        date_range:  "(Año — completar)",
      });
    }
  }

  // --- CURSOS ---
  cv.courses_certifications = parseCourses(rawText);

  // --- ADDITIONAL INFO ---
  cv.additional_info.softwares = (profile.tools || []).map(t => t.charAt(0).toUpperCase() + t.slice(1));
  cv.additional_info.languages = (profile.languages || []).map(l =>
    `${l.charAt(0).toUpperCase() + l.slice(1)}: (nivel por completar)`
  );

  return cv;
}

module.exports = { normalizeCV };
