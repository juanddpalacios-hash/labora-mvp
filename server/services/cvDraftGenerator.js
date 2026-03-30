"use strict";

/**
 * cvDraftGenerator.js
 *
 * Caso B — usuario SIN CV.
 * Toma respuestas simples del usuario (nombre, carrera, experiencias,
 * herramientas, idiomas) + rol objetivo y construye un CV borrador completo
 * usando la misma estructura estándar de Labora.
 *
 * Flujo:
 *   userInputs → buildProfileFromInputs() → normalizedCV
 *   normalizedCV + profile + targetRole → optimizeCV() → resultado final
 *
 * FUTURE: LLM — reemplazar buildProfileFromInputs con llamada a Claude:
 *   const cv = await callClaude(buildGeneratePrompt(userInputs, targetRole));
 */

const { emptyCVStructure } = require("./cvStructure");
const { optimizeCV }       = require("./cvOptimizer");

// ═══════════════════════════════════════════════════════════════════════
// SCHEMA DE INPUTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Inputs esperados del usuario (todos opcionales excepto degree y targetRole):
 *
 * {
 *   full_name:    string   — "María González"
 *   email:        string   — "maria@gmail.com"
 *   phone:        string   — "+56 9 1234 5678"
 *   linkedin:     string   — "linkedin.com/in/mariagonzalez"
 *   degree:       string   — "Ingeniería Comercial"
 *   has_postgrad: boolean  — false
 *   postgrad:     string   — "Magíster en Finanzas" (si has_postgrad)
 *   academic_status: string — "titulado" | "egresado" | "cursando"
 *   graduation_year: string — "2024"
 *   institution:  string   — "Universidad de Chile"
 *
 *   experiences: [          — array de experiencias simples
 *     {
 *       organization: string  — "BCI"
 *       role:         string  — "Analista Financiero (práctica)"
 *       date_range:   string  — "Mar 2024 – Jul 2024"
 *       what_did:     string  — descripción libre de lo que hizo
 *     }
 *   ]
 *
 *   tools:     string[]   — ["Excel", "Power BI", "SAP"]
 *   languages: string[]   — ["Inglés B1", "Español nativo"]
 *   courses:   string[]   — ["Excel Avanzado — Coursera, 2023"]
 *
 *   targetRole: string    — "Analista Financiero Junior"
 * }
 */

// ═══════════════════════════════════════════════════════════════════════
// PARSER DE DESCRIPCIÓN LIBRE → BULLETS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Convierte la descripción libre de una experiencia en bullets.
 * Separa por puntos, comas o saltos de línea.
 */
function parseWhatDidIntoBullets(whatDid) {
  if (!whatDid || typeof whatDid !== "string") return [];

  // Intentar separar por newlines primero
  let parts = whatDid.split(/\n+/).map(s => s.trim()).filter(s => s.length >= 15);

  // Si no hay newlines útiles, separar por punto o punto y coma
  if (parts.length <= 1) {
    parts = whatDid
      .split(/[.;]+/)
      .map(s => s.trim())
      .filter(s => s.length >= 15);
  }

  // Limpiar prefijos comunes de lista
  return parts
    .map(s => s.replace(/^[-•·*►\d.]\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 4);
}

// ═══════════════════════════════════════════════════════════════════════
// CONSTRUCCIÓN DE LA ESTRUCTURA ESTÁNDAR DESDE INPUTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * Construye un CV en estructura estándar a partir de los inputs del usuario.
 * No genera contenido nuevo — solo organiza lo que el usuario entregó.
 */
function buildCVFromInputs(userInputs) {
  const cv = emptyCVStructure();

  // --- HEADER ---
  cv.header.full_name = (userInputs.full_name || "").trim();

  const degreeParts = [userInputs.degree || ""];
  if (userInputs.has_postgrad && userInputs.postgrad) {
    degreeParts.push(userInputs.postgrad.trim());
  }
  cv.header.degree_line = degreeParts.filter(Boolean).join(" | ");

  const contactParts = [
    userInputs.email    || "",
    userInputs.phone    || "",
    userInputs.linkedin || "",
  ].filter(Boolean);
  cv.header.contact_line = contactParts.join(" | ");

  // --- EXPERIENCIA ---
  if (Array.isArray(userInputs.experiences) && userInputs.experiences.length > 0) {
    cv.experience = userInputs.experiences.map(exp => ({
      organization:    (exp.organization || "(Organización — completar)").trim(),
      role:            (exp.role         || "(Rol — completar)").trim(),
      date_range:      (exp.date_range   || "(Fecha — completar)").trim(),
      bullets:         parseWhatDidIntoBullets(exp.what_did || ""),
      relevance_score: 0,
    }));
  }

  // --- EDUCACIÓN ---
  const eduEntry = {
    institution: (userInputs.institution || "(Universidad — completar)").trim(),
    degree:      (userInputs.degree       || "(Carrera — completar)").trim(),
    date_range:  userInputs.graduation_year || "(Año — completar)",
  };

  // Agregar estado académico al degree si no está titulado
  if (userInputs.academic_status === "cursando") {
    eduEntry.date_range = `En curso (${eduEntry.date_range})`;
  } else if (userInputs.academic_status === "egresado") {
    eduEntry.date_range = `Egresado ${eduEntry.date_range}`;
  }

  cv.education = [eduEntry];

  if (userInputs.has_postgrad && userInputs.postgrad) {
    cv.education.push({
      institution: "(Universidad posgrado — completar)",
      degree:      userInputs.postgrad.trim(),
      date_range:  "(Año — completar)",
    });
  }

  // --- CURSOS ---
  if (Array.isArray(userInputs.courses)) {
    cv.courses_certifications = userInputs.courses.filter(Boolean).slice(0, 6);
  }

  // --- ADDITIONAL INFO ---
  if (Array.isArray(userInputs.tools)) {
    cv.additional_info.softwares = userInputs.tools
      .filter(Boolean)
      .map(t => t.charAt(0).toUpperCase() + t.slice(1));
  }

  if (Array.isArray(userInputs.languages)) {
    cv.additional_info.languages = userInputs.languages
      .filter(Boolean)
      .map(l => {
        // Si ya tiene formato "Idioma: nivel", mantener
        if (l.includes(":")) return l;
        // Si tiene nivel inline (ej: "Inglés B1"), reformatear
        const levelMatch = l.match(/^(.+?)\s+(A1|A2|B1|B2|C1|C2|nativo|básico|intermedio|avanzado)/i);
        if (levelMatch) {
          return `${levelMatch[1].trim()}: ${levelMatch[2]}`;
        }
        return `${l}: (nivel por completar)`;
      });
  }

  return cv;
}

/**
 * Construye el perfil mínimo esperado por optimizeCV() a partir de los inputs.
 * Este perfil emula lo que devolvería aiExtractor.
 */
function buildProfileFromInputs(userInputs) {
  return {
    name:             userInputs.full_name || "",
    degree:           userInputs.degree    || "",
    has_postgrad:     userInputs.has_postgrad || false,
    tools:            userInputs.tools     || [],
    languages:        (userInputs.languages || []).map(l => l.split(":")[0].trim()),
    specialization:   [],   // sin CV no hay señales de especialización
    experience:       (userInputs.experiences || []).map(e => e.role || ""),
    areas_of_interest: [],
  };
}

// ═══════════════════════════════════════════════════════════════════════
// GENERADOR PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════

/**
 * Genera un CV borrador completo desde inputs simples del usuario.
 *
 * @param {object} userInputs  - Respuestas del formulario (ver schema arriba)
 * @param {string} targetRole  - Rol objetivo: "Analista Financiero Junior"
 * @returns {object}           - { cv, improvements_made, missing_information }
 *
 * FUTURE: LLM — reemplazar con:
 *   const result = await callClaude(buildGeneratePrompt(userInputs, targetRole));
 */
function generateCVDraft(userInputs, targetRole) {
  // 1. Construir CV estructurado desde inputs del usuario
  const normalizedCV = buildCVFromInputs(userInputs);

  // 2. Construir perfil mínimo para el optimizador
  const profile = buildProfileFromInputs(userInputs);

  // 3. Optimizar: resumen, reescritura de bullets, priorización
  const result = optimizeCV(normalizedCV, profile, targetRole);

  // 4. Agregar contexto específico de generación
  result.generated_from = "user_inputs";
  result.missing_information = [
    ...result.missing_information,
    ...buildGenerationGaps(userInputs),
  ];

  return result;
}

/**
 * Identifica campos importantes que el usuario no proporcionó.
 */
function buildGenerationGaps(userInputs) {
  const gaps = [];

  if (!userInputs.full_name)   gaps.push("Falta nombre completo.");
  if (!userInputs.email)       gaps.push("Falta email de contacto.");
  if (!userInputs.institution) gaps.push("Falta nombre de la universidad.");
  if (!userInputs.graduation_year) gaps.push("Falta año de graduación o egreso.");
  if (!(userInputs.experiences || []).length) {
    gaps.push("No se ingresaron experiencias. Considera agregar prácticas, ayudantías o proyectos.");
  }
  if (!(userInputs.tools || []).length) {
    gaps.push("No se ingresaron herramientas o software. Esto es clave para roles técnicos.");
  }

  return gaps;
}

module.exports = {
  generateCVDraft,
  buildCVFromInputs,
  buildProfileFromInputs,
};
