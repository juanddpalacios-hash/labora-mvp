"use strict";

/**
 * cvOptimizer.js
 *
 * Toma un CV en estructura estándar + un rol objetivo y produce
 * una versión optimizada: resumen reescrito, bullets mejorados,
 * experiencias priorizadas, gaps identificados.
 *
 * Motor actual: heurístico (sin LLM).
 *
 * Punto de integración LLM: las funciones rewriteSummary() y
 * rewriteBullets() tienen comentarios FUTURE: LLM que indican
 * exactamente dónde reemplazar la lógica con llamadas a Claude API.
 * Los prompts maestros están exportados al final del archivo.
 */

const { normalizeText } = require("../utils/text");
const {
  getRoleArea,
  getActionVerbs,
  getRelevanceSignals,
  ACTION_VERBS,
} = require("./cvStructure");

// ═══════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════

function capitalize(str) {
  if (!str) return "";
  return str.charAt(0).toUpperCase() + str.slice(1);
}

/**
 * Calcula cuán relevante es un bloque de texto para un área dada.
 */
function scoreRelevance(text, signals) {
  const normalized = normalizeText(text);
  let score = 0;
  for (const signal of signals) {
    if (normalized.includes(normalizeText(signal))) score++;
  }
  return score;
}

/**
 * Limpia un bullet eliminando prefijos comunes y texto vacío.
 */
function cleanBullet(bullet) {
  return bullet
    .replace(/^[-•·*►]\s*/, "")
    .replace(/^(soy|fui|era|estuve|participé en)\s+/i, "")
    // Eliminar verbos en primera persona pasado (-ar: -é, -er/-ir: -í)
    // ej: "procesé", "generé", "elaboré", "escribí", "dirigí"
    .replace(/^[A-Za-záéíóúñÁÉÍÓÚÑ]+[eé]\s+/i, "")
    .replace(/^[A-Za-záéíóúñÁÉÍÓÚÑ]+[ií]\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Set plano de todos los verbos de acción (todas las áreas) para detección amplia
const ALL_ACTION_VERBS = [
  ...new Set(Object.values(ACTION_VERBS).flat()),
];

/**
 * Verifica si un bullet ya empieza con cualquier verbo de acción conocido.
 * Usa el set global para no descartar verbos válidos de otras áreas.
 */
function startsWithActionVerb(bullet) {
  const normalized = normalizeText(bullet);
  return ALL_ACTION_VERBS.some(v => normalized.startsWith(normalizeText(v)));
}

// ═══════════════════════════════════════════════════════════════════════
// RESUMEN PROFESIONAL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Genera un resumen profesional orientado al rol objetivo.
 *
 * Estructura UAI:
 * 1. Identidad formativa (carrera + posgrado)
 * 2. Experiencia relevante (qué hiciste)
 * 3. Herramientas/fortalezas clave
 * 4. Objetivo alineado al rol
 *
 * FUTURE: LLM — reemplazar esta función con llamada a Claude:
 *   const summary = await callClaude(buildSummaryPrompt(profile, targetRole, cv));
 */
function generateSummary(profile, targetRole, cv) {
  const area = getRoleArea(targetRole);

  // Identidad formativa
  const degreePart = profile.degree || "formación universitaria";
  const postgradPart = profile.has_postgrad ? ", con estudios de posgrado," : "";

  // Experiencia real detectada
  const hasExp = cv.experience.length > 0 &&
    cv.experience[0].organization !== "(Organización no detectada — completar)";

  const expPart = hasExp
    ? `con experiencia práctica en ${cv.experience[0].organization}`
    : "en proceso de formación profesional";

  // Herramientas clave
  const tools = (profile.tools || []).slice(0, 3).join(", ");
  const toolsPart = tools ? `Manejo de ${tools}.` : "";

  // Especialización detectada
  const spec = (profile.specialization || []).join(", ");
  const specPart = spec ? `con orientación a ${spec}` : "";

  // Objetivo
  const objectivePart = `orientado/a a desempeñarse como ${targetRole}`;

  const parts = [
    `Profesional de ${degreePart}${postgradPart} ${expPart}${specPart ? ", " + specPart : ""}.`,
    toolsPart,
    `${objectivePart}.`,
  ].filter(Boolean);

  return parts.join(" ");
}

// ═══════════════════════════════════════════════════════════════════════
// REESCRITURA DE BULLETS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Mejora los bullets de una experiencia:
 * - Añade verbo de acción si falta
 * - Limpia prefijos vacíos
 * - Limita a 4 bullets máximo
 *
 * FUTURE: LLM — reemplazar con:
 *   const improved = await callClaude(buildBulletPrompt(bullets, area, expContext));
 */
function rewriteBullets(bullets, area) {
  const verbs     = getActionVerbs(area);
  const improved  = [];
  let verbIndex   = 0;

  for (const raw of bullets.slice(0, 4)) {
    const cleaned = cleanBullet(raw);
    if (!cleaned || cleaned.length < 15) continue;

    // Si ya empieza con verbo de acción, mantenerlo
    if (startsWithActionVerb(cleaned)) {
      improved.push(capitalize(cleaned));
    } else {
      // Prefixar con siguiente verbo rotando
      const verb = verbs[verbIndex % verbs.length];
      verbIndex++;
      // Lowercase el inicio del contenido para unir limpiamente
      const content = cleaned.charAt(0).toLowerCase() + cleaned.slice(1);
      improved.push(`${verb} ${content}`);
    }
  }

  return improved;
}

// ═══════════════════════════════════════════════════════════════════════
// PRIORIZACIÓN DE EXPERIENCIAS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Ordena las experiencias por relevancia para el rol objetivo.
 * Las más relevantes van primero.
 */
function prioritizeExperiences(experiences, area) {
  const signals = getRelevanceSignals(area);

  const scored = experiences.map(exp => {
    const textToScore = [
      exp.organization,
      exp.role,
      ...(exp.bullets || []),
    ].join(" ");

    return {
      ...exp,
      relevance_score: scoreRelevance(textToScore, signals),
    };
  });

  return scored.sort((a, b) => b.relevance_score - a.relevance_score);
}

// ═══════════════════════════════════════════════════════════════════════
// OPTIMIZACIÓN DE HERRAMIENTAS Y LENGUAJES
// ═══════════════════════════════════════════════════════════════════════

/**
 * Prioriza herramientas relevantes para el rol objetivo.
 * Las relevantes primero, luego el resto.
 */
function prioritizeSoftwares(softwares, area) {
  const signals = getRelevanceSignals(area);
  const relevant   = softwares.filter(s => signals.some(sig => normalizeText(s).includes(normalizeText(sig))));
  const others     = softwares.filter(s => !relevant.includes(s));
  return [...relevant, ...others];
}

// ═══════════════════════════════════════════════════════════════════════
// TRACKING DE MEJORAS Y GAPS
// ═══════════════════════════════════════════════════════════════════════

function buildImprovementsList(original, optimized, area) {
  const improvements = [];

  if (optimized.professional_summary && !original.professional_summary) {
    improvements.push("Se generó un resumen profesional orientado al rol objetivo.");
  } else if (optimized.professional_summary !== original.professional_summary) {
    improvements.push("Se reescribió el resumen profesional con foco en el rol objetivo.");
  }

  const originalBulletsCount = (original.experience || []).reduce((s, e) => s + (e.bullets || []).length, 0);
  const newBulletsCount      = (optimized.experience || []).reduce((s, e) => s + (e.bullets || []).length, 0);
  if (newBulletsCount > 0) {
    improvements.push("Se reescribieron los bullets de experiencia con verbos de acción.");
  }

  if ((optimized.experience || []).length > 1) {
    improvements.push(`Se priorizaron las experiencias más relevantes para el área de ${area}.`);
  }

  const relevantTools = (optimized.additional_info?.softwares || []).slice(0, 2);
  if (relevantTools.length > 0) {
    improvements.push(`Se destacaron las herramientas clave para el rol: ${relevantTools.join(", ")}.`);
  }

  return improvements;
}

function buildMissingInfoList(cv) {
  const missing = [];

  if (!cv.header.full_name) missing.push("Falta nombre completo.");
  if (!cv.header.contact_line) missing.push("Faltan datos de contacto (email, teléfono).");
  if (!cv.header.contact_line.includes("linkedin")) missing.push("Se recomienda agregar LinkedIn.");

  const incompleteExp = (cv.experience || []).filter(e =>
    e.organization.includes("(") || e.role.includes("(") || e.date_range.includes("(")
  );
  if (incompleteExp.length > 0) {
    missing.push(`${incompleteExp.length} entrada(s) de experiencia requieren completar datos.`);
  }

  if ((cv.experience || []).every(e => (e.bullets || []).length === 0)) {
    missing.push("Faltan bullets de experiencia. Describe 2-3 funciones por cargo.");
  }

  const incompleteEdu = (cv.education || []).filter(e => e.institution.includes("("));
  if (incompleteEdu.length > 0) {
    missing.push(`${incompleteEdu.length} entrada(s) de educación requieren completar datos.`);
  }

  if ((cv.additional_info?.languages || []).some(l => l.includes("por completar"))) {
    missing.push("Faltan niveles de idioma (ej: inglés B1 intermedio).");
  }

  return missing;
}

// ═══════════════════════════════════════════════════════════════════════
// OPTIMIZADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Toma un CV normalizado + rol objetivo y retorna la versión optimizada.
 *
 * @param {object} normalizedCV   - CV en estructura estándar (de cvNormalizer)
 * @param {object} profile        - perfil de Labora (de aiExtractor)
 * @param {string} targetRole     - ej: "Analista Financiero Junior"
 * @returns {object}              - { cv, improvements_made, missing_information }
 */
function optimizeCV(normalizedCV, profile, targetRole) {
  const area = getRoleArea(targetRole);
  const original = JSON.parse(JSON.stringify(normalizedCV)); // copia para diff

  // 1. Resumen profesional
  normalizedCV.professional_summary = generateSummary(profile, targetRole, normalizedCV);

  // 2. Priorizar y reescribir experiencias
  normalizedCV.experience = prioritizeExperiences(normalizedCV.experience, area)
    .map(exp => ({
      ...exp,
      bullets: rewriteBullets(exp.bullets, area),
    }));

  // 3. Priorizar herramientas
  normalizedCV.additional_info.softwares = prioritizeSoftwares(
    normalizedCV.additional_info.softwares,
    area
  );

  // 4. Tracking
  const improvements_made    = buildImprovementsList(original, normalizedCV, area);
  const missing_information  = buildMissingInfoList(normalizedCV);

  return {
    cv:                 normalizedCV,
    improvements_made,
    missing_information,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// PROMPTS MAESTROS PARA LLM (listos para enchufar Claude API)
// ═══════════════════════════════════════════════════════════════════════

/**
 * Prompt maestro para OPTIMIZAR un CV existente con Claude.
 *
 * Uso futuro:
 *   const response = await anthropic.messages.create({
 *     model: "claude-opus-4-6",
 *     max_tokens: 2000,
 *     messages: [{ role: "user", content: buildOptimizePrompt(cv, profile, targetRole) }]
 *   });
 */
function buildOptimizePrompt(cv, profile, targetRole) {
  return `Eres un experto en CVs para el mercado laboral chileno, especializado en perfiles junior.

ROL OBJETIVO: ${targetRole}

PERFIL DEL USUARIO:
- Carrera: ${profile.degree}
- Especialización detectada: ${(profile.specialization || []).join(", ") || "ninguna"}
- Herramientas: ${(profile.tools || []).join(", ") || "no especificadas"}
- Experiencia detectada: ${(profile.experience || []).join(", ") || "ninguna"}

CV ACTUAL (estructura JSON):
${JSON.stringify(cv, null, 2)}

INSTRUCCIONES:
1. Reescribe el resumen profesional (máx. 4 líneas) orientado al rol objetivo.
   - Menciona carrera, experiencia real, herramientas clave y objetivo.
   - Sin frases vacías como "soy proactivo" sin evidencia.

2. Reescribe los bullets de experiencia:
   - Usa verbos de acción en pasado (Elaboró, Analizó, Coordinó, etc.)
   - Prioriza logros medibles si existen en el original.
   - Máximo 4 bullets por experiencia.
   - No inventes funciones que no estén en el original.

3. Prioriza las experiencias más relevantes para "${targetRole}".

4. No inventes datos. Si falta información, déjala como "(completar)".

5. Escribe en español profesional, claro y sin jerga.

SALIDA: Devuelve JSON con la misma estructura del CV actual, con los campos mejorados.
Incluye también:
- "improvements_made": array de strings explicando qué mejoró
- "missing_information": array de strings con lo que falta

Responde SOLO con JSON válido, sin texto adicional.`;
}

/**
 * Prompt maestro para GENERAR un CV desde cero con Claude.
 */
function buildGeneratePrompt(userInputs, targetRole) {
  return `Eres un experto en CVs para el mercado laboral chileno, especializado en perfiles junior.

ROL OBJETIVO: ${targetRole}

INFORMACIÓN DEL USUARIO:
${JSON.stringify(userInputs, null, 2)}

INSTRUCCIONES:
1. Genera un CV completo y profesional en formato JSON con esta estructura:
   { header, professional_summary, experience, education, courses_certifications, additional_info }

2. Resumen profesional (máx. 4 líneas):
   - Menciona carrera, experiencia (aunque sea informal), herramientas y objetivo.
   - Honesto, sin exagerar. Si tiene poca experiencia, énfasis en formación y potencial.

3. Experiencias:
   - Usa verbos de acción en pasado.
   - Incluye práctica, ayudantía, proyectos, voluntariados, emprendimientos si existen.
   - 2-3 bullets por experiencia.
   - No inventes información.

4. Si falta información para algún campo, usa "(completar)" como placeholder.

5. Escribe en español profesional, claro y directo.
   - Máximo una plana de contenido.
   - Sin frases vacías ni relleno.

SALIDA: JSON válido con el CV completo + "improvements_made" + "missing_information".
Responde SOLO con JSON, sin texto adicional.`;
}

module.exports = {
  optimizeCV,
  generateSummary,
  rewriteBullets,
  prioritizeExperiences,
  buildOptimizePrompt,
  buildGeneratePrompt,
};
