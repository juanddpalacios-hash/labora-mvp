"use strict";

/**
 * jobProfileMatcher.js
 *
 * Módulo desacoplado para comparar el perfil del usuario contra ofertas laborales.
 * No modifica el diagnóstico de roles — es una capa posterior.
 *
 * API pública:
 *   normalizeJobPosting(rawJob)          → job normalizado
 *   scoreJobFit(profile, job)            → {total_score, breakdown, hard_filter_failures, ...}
 *   classifyJobAdaptability(scoreResult) → {adaptability, label, explanation}
 *   rankJobsForProfile(profile, rawJobs) → array ordenado de job results
 */

const { normalizeText, overlapCount } = require("../utils/text");

// ═══════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════

const SENIORITY_RANKS = { intern: 0, junior: 1, "semi-senior": 2, senior: 3 };

// Nivel de idioma → rango comparable (CEFR aproximado)
const LANGUAGE_LEVEL_RANK = {
  basico: 1, a1: 1, a2: 1,
  intermedio: 2, b1: 2,
  avanzado: 3, b2: 3, c1: 3,
  fluido: 4, nativo: 4, c2: 4, profesional: 4,
};

// Señales textuales para detectar nivel de idioma en una oferta
const LANGUAGE_LEVEL_SIGNALS = [
  { patterns: ["fluido", "nativo", "c2", "profesional"], rank: 4 },
  { patterns: ["avanzado", "b2", "c1"],                  rank: 3 },
  { patterns: ["intermedio", "b1"],                      rank: 2 },
  { patterns: ["basico", "a1", "a2"],                    rank: 1 },
];

// Carrera → familias de área (simplificado, cubre los casos más comunes)
const DEGREE_FAMILIES = {
  "ingenieria comercial":             ["negocios", "analitica", "finanzas"],
  "administracion de empresas":       ["negocios"],
  "contador auditor":                 ["finanzas", "negocios"],
  "economia":                         ["negocios", "analitica", "finanzas"],
  "ingenieria civil industrial":      ["ingenieria", "operaciones", "analitica"],
  "ingenieria en informatica":        ["tecnologia", "analitica"],
  "ingenieria en ciencias de datos":  ["analitica", "tecnologia"],
  "estadistica":                      ["analitica"],
  "psicologia":                       ["personas"],
  "administracion publica":           ["negocios", "personas"],
  "logistica":                        ["operaciones", "negocios"],
  "marketing":                        ["negocios", "comunicacion"],
  "sociologia":                       ["personas", "analitica"],
  "trabajo social":                   ["personas"],
  "ingenieria ambiental":             ["medioambiente", "ingenieria"],
  "geologia":                         ["geociencias"],
  "periodismo":                       ["comunicacion"],
  "diseno grafico":                   ["diseno", "comunicacion"],
  "arquitectura":                     ["diseno", "ingenieria"],
  "ingenieria civil":                 ["ingenieria"],
  "auditoria":                        ["finanzas", "negocios"],
};

// Pesos por dimensión — deben sumar 100
const WEIGHTS = {
  education:   25,
  experience:  20,
  skills:      25,
  languages:   15,
  context:     10,
  seniority:    5,
};

// Orden para ranking final
const ADAPTABILITY_ORDER = { high_fit: 0, good_fit: 1, adaptable: 2, low_fit: 3 };

// ═══════════════════════════════════════════════════════════════════════
// HELPERS INTERNOS
// ═══════════════════════════════════════════════════════════════════════

function inferSeniority(text) {
  const t = normalizeText(text);
  if (/semi[-\s]?senior|ssr/.test(t))          return "semi-senior";
  if (/\bsenior\b|\bsr\.?\b/.test(t))           return "senior";
  if (/\bjunior\b|\bjr\.?\b/.test(t))           return "junior";
  if (/\bintern\b|practica\b|trainee/.test(t))  return "intern";
  return null;
}

function inferModality(text) {
  const t = normalizeText(text);
  if (t.includes("hibrido") || t.includes("hybrid"))                        return "híbrido";
  if (t.includes("remoto") || t.includes("teletrabajo"))                    return "remoto";
  if (t.includes("presencial") || t.includes("en oficina"))                 return "presencial";
  return null;
}

function getDegFamilies(degree) {
  const key = normalizeText(degree || "");
  if (DEGREE_FAMILIES[key]) return DEGREE_FAMILIES[key];
  const match = Object.keys(DEGREE_FAMILIES).find(k => key.includes(k) || k.includes(key));
  return match ? DEGREE_FAMILIES[match] : [];
}

function familyOverlap(a, b) {
  return a.some(f => b.includes(f));
}

/**
 * Devuelve el rango del perfil para un idioma dado.
 * Usa profile.language_levels si existe, si no asume intermedio (2).
 */
function getProfileLangRank(profile, langName) {
  const key    = normalizeText(langName);
  const levels = profile.language_levels || {};
  const raw    = levels[key] || levels[langName] || null;
  if (!raw) return 2; // sin info → asume intermedio
  return LANGUAGE_LEVEL_RANK[normalizeText(raw)] ?? 2;
}

/**
 * Traduce experience_level del perfil a años estimados.
 */
function levelToYears(level) {
  if (level === "high")   return 3;
  if (level === "medium") return 1.5;
  return 0.5; // low
}

// ═══════════════════════════════════════════════════════════════════════
// 1. normalizeJobPosting
// ═══════════════════════════════════════════════════════════════════════

/**
 * Recibe un objeto de oferta crudo (puede venir de scraping, mock o API)
 * y lo convierte en estructura estándar, infiriendo campos faltantes.
 */
function normalizeJobPosting(raw) {
  const combined = `${raw.title || ""} ${raw.raw_description || raw.description || ""}`;

  return {
    title:                (raw.title    || "").trim(),
    company:              (raw.company  || "").trim(),
    location:             (raw.location || "").trim(),
    modality:             raw.modality  || inferModality(combined),
    seniority:            raw.seniority || inferSeniority(combined),
    required_degrees:     Array.isArray(raw.required_degrees)   ? raw.required_degrees   : [],
    required_skills:      Array.isArray(raw.required_skills)    ? raw.required_skills    : [],
    preferred_skills:     Array.isArray(raw.preferred_skills)   ? raw.preferred_skills   : [],
    required_languages:   Array.isArray(raw.required_languages) ? raw.required_languages : [],
    min_experience_years: raw.min_experience_years ?? null,
    hard_filters:         Array.isArray(raw.hard_filters)       ? raw.hard_filters       : [],
    raw_description:      raw.raw_description || raw.description || "",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 2. Dimensiones de scoring
// ═══════════════════════════════════════════════════════════════════════

function scoreEducation(profile, job) {
  const max = WEIGHTS.education;

  if (!job.required_degrees.length) {
    return { score: max, max, status: "ok", signals: ["Sin requisito de carrera específico"] };
  }

  const profileFamilies = getDegFamilies(profile.degree || "");
  const profileNorm     = normalizeText(profile.degree || "");
  let bestMatch = "none";

  for (const reqDeg of job.required_degrees) {
    const reqNorm     = normalizeText(reqDeg);
    const reqFamilies = getDegFamilies(reqDeg);

    if (profileNorm.includes(reqNorm) || reqNorm.includes(profileNorm)) {
      bestMatch = "exact"; break;
    }
    if (reqFamilies.length && familyOverlap(profileFamilies, reqFamilies)) {
      if (bestMatch !== "exact") bestMatch = "family";
    }
  }

  if (bestMatch === "exact") {
    return {
      score: max, max, status: "ok",
      signals: [`Carrera ${profile.degree} requerida directamente`],
    };
  }
  if (bestMatch === "family") {
    return {
      score: Math.round(max * 0.65), max, status: "partial",
      signals: ["Carrera relacionada por área de formación"],
    };
  }

  // Sin overlap
  const isHard = job.hard_filters.includes("degree_required");
  return {
    score:     isHard ? 0 : Math.round(max * 0.2),
    max,
    status:    isHard ? "hard_fail" : "low",
    signals:   ["Carrera no coincide con las requeridas"],
    hard_fail: isHard ? "required_degree_mismatch" : null,
  };
}

function scoreExperience(profile, job) {
  const max         = WEIGHTS.experience;
  const expLevel    = profile.profile_quality?.experience_level || "low";
  const profileYrs  = levelToYears(expLevel);
  const requiredYrs = job.min_experience_years;

  if (requiredYrs === null) {
    // Sin requisito explícito → evaluar por señales en CV
    const signalCount = (profile.experience || []).length;
    const base        = signalCount > 0 ? Math.round(max * 0.6 + signalCount * 2) : Math.round(max * 0.5);
    return {
      score:   Math.min(max, base),
      max,
      status:  "ok",
      signals: (profile.experience || []).slice(0, 2),
    };
  }

  const gap = requiredYrs - profileYrs;

  if (gap <= 0) {
    return {
      score: max, max, status: "ok",
      signals: [`Experiencia estimada suficiente (${profileYrs.toFixed(1)} años)`],
    };
  }
  if (gap <= 1) {
    return {
      score:   Math.round(max * 0.55),
      max,
      status:  "low",
      signals: [`Solicita ${requiredYrs} año${requiredYrs !== 1 ? "s" : ""} — perfil estimado ${profileYrs.toFixed(1)}`],
    };
  }
  // gap > 1 año → hard filter
  return {
    score:     Math.round(max * 0.15),
    max,
    status:    "hard_fail",
    signals:   [`Requiere ${requiredYrs} años, perfil estimado ${profileYrs.toFixed(1)}`],
    hard_fail: `experience_gap_${Math.round(gap)}yr`,
  };
}

function scoreSkills(profile, job) {
  const max = WEIGHTS.skills;

  const profileSkills = [
    ...(profile.tools  || []),
    ...(profile.skills || []),
  ].map(normalizeText);

  const reqTotal    = job.required_skills.length || 1;
  const prefTotal   = job.preferred_skills.length;
  const reqMatched  = job.required_skills.filter(s => profileSkills.includes(normalizeText(s)));
  const prefMatched = job.preferred_skills.filter(s => profileSkills.includes(normalizeText(s)));
  const missing     = job.required_skills.filter(s => !profileSkills.includes(normalizeText(s)));

  const reqScore  = Math.round((reqMatched.length / reqTotal) * max * 0.75);
  const prefScore = prefTotal > 0
    ? Math.round((prefMatched.length / prefTotal) * max * 0.25)
    : Math.round(max * 0.25); // sin preferidas → bonus completo

  const status = reqMatched.length >= reqTotal * 0.7 ? "ok"
               : reqMatched.length >= reqTotal * 0.4 ? "partial" : "low";

  return {
    score:   Math.min(max, reqScore + prefScore),
    max,
    status,
    signals: reqMatched.length ? [`Coincide en: ${reqMatched.slice(0, 3).join(", ")}`] : ["Sin match en skills requeridas"],
    missing: missing.slice(0, 3),
  };
}

function scoreLanguages(profile, job) {
  const max = WEIGHTS.languages;

  if (!job.required_languages.length) {
    return { score: max, max, status: "ok", signals: ["Sin requisito de idioma"] };
  }

  const profileLangs = (profile.languages || []).map(normalizeText);
  let totalScore = 0;
  const hardFails = [];
  const signals   = [];

  for (const langEntry of job.required_languages) {
    const langName = normalizeText(langEntry.language || langEntry);
    const reqRank  = langEntry.level
      ? (LANGUAGE_LEVEL_RANK[normalizeText(langEntry.level)] ?? 3)
      : 2;
    const hasLang  = profileLangs.includes(langName);
    const profRank = hasLang ? getProfileLangRank(profile, langName) : 0;
    const gap      = reqRank - profRank;
    const share    = max / job.required_languages.length;

    if (!hasLang) {
      hardFails.push(`no_${langName}`);
      signals.push(`Sin ${langEntry.language || langEntry} en perfil`);
    } else if (gap >= 2) {
      // Brecha de 2+ niveles → hard filter
      hardFails.push(`${langName}_level_gap`);
      signals.push(`${langEntry.language || langEntry}: requerido ${langEntry.level || "avanzado"}, perfil inferior`);
      totalScore += Math.round(share * 0.2);
    } else if (gap === 1) {
      signals.push(`${langEntry.language || langEntry}: brecha de un nivel`);
      totalScore += Math.round(share * 0.65);
    } else {
      signals.push(`${langEntry.language || langEntry}: nivel suficiente`);
      totalScore += Math.round(share);
    }
  }

  return {
    score:     Math.min(max, totalScore),
    max,
    status:    hardFails.length ? "hard_fail" : totalScore >= max * 0.7 ? "ok" : "partial",
    signals,
    hard_fail: hardFails.length ? hardFails[0] : null,
  };
}

function scoreContext(profile, job) {
  const max    = WEIGHTS.context;
  let   score  = 0;
  const signals = [];

  // Ubicación (5 pts)
  const jobLoc  = normalizeText(job.location);
  const userLoc = normalizeText(profile.city || "");
  if (!jobLoc || !userLoc || jobLoc.includes(userLoc) || userLoc.includes(jobLoc)) {
    score += 5;
    signals.push("Ciudad compatible");
  } else {
    signals.push(`Oferta en ${job.location}, perfil busca en ${profile.city || "sin especificar"}`);
  }

  // Modalidad (5 pts)
  const jobMod   = normalizeText(job.modality || "");
  const userMods = (profile.desired_modality || []).map(normalizeText);
  if (!jobMod || !userMods.length || userMods.includes(jobMod) || jobMod === "remoto") {
    score += 5;
    signals.push("Modalidad compatible");
  } else {
    signals.push(`Modalidad ${job.modality} no coincide con preferencia`);
  }

  return {
    score, max,
    status:  score === max ? "ok" : score >= 5 ? "partial" : "low",
    signals,
  };
}

function scoreSeniority(profile, job) {
  const max = WEIGHTS.seniority;

  if (!job.seniority) {
    return { score: max, max, status: "ok", signals: ["Seniority no especificado"] };
  }

  const expLevel = profile.profile_quality?.experience_level || "low";
  // Mapeo conservador: low/medium → junior, high → semi-senior
  const profileSeniority = expLevel === "high" ? "semi-senior" : "junior";

  const jobRank     = SENIORITY_RANKS[job.seniority]         ?? 1;
  const profileRank = SENIORITY_RANKS[profileSeniority]       ?? 1;
  const gap         = jobRank - profileRank;

  if (gap <= 0) {
    return {
      score: max, max, status: "ok",
      signals: [`Seniority ${job.seniority} compatible con perfil`],
    };
  }
  if (gap === 1) {
    return {
      score:   Math.round(max * 0.4),
      max,
      status:  "low",
      signals: [`Oferta pide ${job.seniority}, perfil más junior`],
    };
  }
  // gap >= 2 → hard filter
  return {
    score:     0,
    max,
    status:    "hard_fail",
    signals:   [`Seniority requerido: ${job.seniority} — brecha estructural`],
    hard_fail: `seniority_gap_${gap}`,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 3. scoreJobFit — orquesta las 6 dimensiones
// ═══════════════════════════════════════════════════════════════════════

/**
 * Compara un perfil de usuario con una oferta normalizada.
 *
 * El perfil esperado tiene al mínimo:
 *   degree, profile_quality, tools, skills, languages, experience,
 *   desired_modality, city, has_postgrad, language_levels (opcional)
 *
 * Mapeo desde el perfil de Labora existente:
 *   profile.degree              → grado académico
 *   profile.profile_quality     → viene de evaluateProfileQuality() en roleMatcher
 *   profile.tools               → de aiExtractor
 *   profile.skills              → de aiExtractor
 *   profile.languages           → de aiExtractor (solo nombre, sin nivel)
 *   profile.language_levels     → campo extendido opcional {ingles: "B1"}
 *   profile.experience          → señales detectadas en CV
 *   profile.desired_modality    → de metadata del formulario
 *   profile.city                → de metadata del formulario
 *   profile.has_postgrad        → de aiExtractor
 */
function scoreJobFit(profile, job) {
  const education  = scoreEducation(profile, job);
  const experience = scoreExperience(profile, job);
  const skills     = scoreSkills(profile, job);
  const languages  = scoreLanguages(profile, job);
  const context    = scoreContext(profile, job);
  const seniority  = scoreSeniority(profile, job);

  const breakdown = { education, experience, skills, languages, context, seniority };

  const hard_filter_failures = Object.entries(breakdown)
    .filter(([, d]) => d.hard_fail)
    .map(([dim, d]) => ({ dimension: dim, reason: d.hard_fail }));

  const rawTotal = Object.values(breakdown).reduce((s, d) => s + d.score, 0);

  // Penalización acumulativa por hard filters
  const penalty = hard_filter_failures.length > 0
    ? Math.pow(0.72, hard_filter_failures.length)
    : 1;

  const total_score = Math.min(100, Math.round(rawTotal * penalty));

  const matched_signals = [
    ...skills.signals.filter(s => s.includes("Coincide")),
    ...languages.signals.filter(s => s.includes("suficiente")),
    ...education.signals.filter(s => !s.includes("no coincide") && !s.includes("Sin ")),
    ...seniority.signals.filter(s => s.includes("compatible")),
  ].slice(0, 5);

  const missing_signals = [
    ...(skills.missing || []),
    ...languages.signals.filter(s => s.includes("gap") || s.includes("en perfil")),
    ...experience.signals.filter(s => s.includes("Solicita") || s.includes("Requiere")),
  ].slice(0, 5);

  return {
    total_score,
    breakdown,
    hard_filter_failures,
    matched_signals,
    missing_signals,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 4. classifyJobAdaptability
// ═══════════════════════════════════════════════════════════════════════

/**
 * Clasifica el nivel de adaptabilidad de la oferta para el usuario.
 *
 * high_fit:  encaje sólido hoy, pocas o ninguna brecha
 * good_fit:  buen match con brechas menores manejables
 * adaptable: no es el mejor match hoy pero las brechas son alcanzables
 * low_fit:   brechas estructurales fuertes (seniority, idioma, años de exp)
 */
function classifyJobAdaptability(scoreResult) {
  const { total_score, hard_filter_failures } = scoreResult;

  const structural = hard_filter_failures.filter(f =>
    f.reason.startsWith("seniority_gap") ||
    f.reason.startsWith("experience_gap") ||
    f.reason === "required_degree_mismatch"
  );

  const langFails = hard_filter_failures.filter(f =>
    f.reason.includes("level_gap") || f.reason.startsWith("no_")
  );

  if (total_score >= 72 && hard_filter_failures.length === 0) {
    return {
      adaptability: "high_fit",
      label:        "Buen encaje hoy",
      explanation:  "Tu perfil cubre bien los requisitos de esta oferta. Es un buen momento para postular.",
    };
  }

  if (total_score >= 52 && structural.length === 0 && hard_filter_failures.length <= 1) {
    return {
      adaptability: "good_fit",
      label:        "Buen match con brechas menores",
      explanation:  "Hay buena alineación. Las brechas son menores y manejables con tu perfil actual.",
    };
  }

  // Fallas estructurales fuertes → low_fit independiente del score
  if (structural.length >= 2 || (structural.length >= 1 && langFails.length >= 1)) {
    return {
      adaptability: "low_fit",
      label:        "Brecha estructural importante",
      explanation:  "Hay diferencias en seniority, experiencia o idioma que requieren más desarrollo antes de postular.",
    };
  }

  if (total_score < 32) {
    return {
      adaptability: "low_fit",
      label:        "Hoy está lejos por múltiples factores",
      explanation:  "El perfil actual no cubre suficientes dimensiones de esta oferta.",
    };
  }

  return {
    adaptability: "adaptable",
    label:        "Podrías alcanzarla con esfuerzo razonable",
    explanation:  "No es el mejor match hoy, pero las brechas son aprendibles. Con práctica y refuerzo en áreas clave es una oferta realista.",
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 5. Construcción del resultado final por oferta
// ═══════════════════════════════════════════════════════════════════════

function buildNextStepHint(scoreResult, adaptResult) {
  const { breakdown, hard_filter_failures } = scoreResult;

  if (adaptResult.adaptability === "high_fit") {
    return "Postula con confianza. Tu perfil está bien posicionado para esta oferta.";
  }

  if (adaptResult.adaptability === "low_fit") {
    const dims = hard_filter_failures.map(f => f.dimension).join(", ");
    return `Cierra brechas en ${dims} antes de postular a este tipo de oferta.`;
  }

  const hints = [];
  if (breakdown.skills.missing?.length) {
    hints.push(`reforzar ${breakdown.skills.missing.slice(0, 2).join(", ")}`);
  }
  if (breakdown.languages.status === "partial" || breakdown.languages.status === "hard_fail") {
    hints.push("subir nivel de inglés");
  }
  if (breakdown.experience.status === "low") {
    hints.push("sumar experiencia práctica en el área");
  }

  return hints.length
    ? `Para acercarte: ${hints.join("; ")}.`
    : "Sigue reforzando tu perfil en las áreas con menor puntaje.";
}

function buildJobResult(normalizedJob, scoreResult, adaptResult) {
  return {
    title:               normalizedJob.title,
    company:             normalizedJob.company,
    location:            normalizedJob.location,
    modality:            normalizedJob.modality,
    total_score:         scoreResult.total_score,
    adaptability:        adaptResult.adaptability,
    adaptability_label:  adaptResult.label,
    breakdown: {
      education:  { score: scoreResult.breakdown.education.score,  max: WEIGHTS.education,  status: scoreResult.breakdown.education.status  },
      experience: { score: scoreResult.breakdown.experience.score, max: WEIGHTS.experience, status: scoreResult.breakdown.experience.status },
      skills:     { score: scoreResult.breakdown.skills.score,     max: WEIGHTS.skills,     status: scoreResult.breakdown.skills.status     },
      languages:  { score: scoreResult.breakdown.languages.score,  max: WEIGHTS.languages,  status: scoreResult.breakdown.languages.status  },
      context:    { score: scoreResult.breakdown.context.score,    max: WEIGHTS.context,    status: scoreResult.breakdown.context.status    },
      seniority:  { score: scoreResult.breakdown.seniority.score,  max: WEIGHTS.seniority,  status: scoreResult.breakdown.seniority.status  },
    },
    matched_signals:      scoreResult.matched_signals,
    missing_signals:      scoreResult.missing_signals,
    hard_filter_failures: scoreResult.hard_filter_failures,
    summary_reason:       adaptResult.explanation,
    next_step_hint:       buildNextStepHint(scoreResult, adaptResult),
  };
}

// ═══════════════════════════════════════════════════════════════════════
// 6. rankJobsForProfile — pipeline completo
// ═══════════════════════════════════════════════════════════════════════

/**
 * Toma un perfil y un array de ofertas crudas.
 * Normaliza, scorea, clasifica y ordena.
 * Orden: high_fit → good_fit → adaptable → low_fit
 * Dentro de cada grupo: total_score desc.
 */
function rankJobsForProfile(profile, rawJobs) {
  const results = rawJobs.map(rawJob => {
    const job          = normalizeJobPosting(rawJob);
    const scoreResult  = scoreJobFit(profile, job);
    const adaptResult  = classifyJobAdaptability(scoreResult);
    return buildJobResult(job, scoreResult, adaptResult);
  });

  return results.sort((a, b) => {
    const oa = ADAPTABILITY_ORDER[a.adaptability] ?? 4;
    const ob = ADAPTABILITY_ORDER[b.adaptability] ?? 4;
    if (oa !== ob) return oa - ob;
    return b.total_score - a.total_score;
  });
}

// ═══════════════════════════════════════════════════════════════════════
// MOCK DATA — 5 ofertas laborales realistas (Chile)
// ═══════════════════════════════════════════════════════════════════════

const MOCK_JOBS = [
  // 1. Muy alineada — IC, finanzas, sin requisito de inglés
  {
    title:               "Analista Financiero Junior",
    company:             "Banco Bci",
    location:            "Santiago",
    modality:            "híbrido",
    seniority:           "junior",
    required_degrees:    ["Ingeniería Comercial", "Contador Auditor", "Economía"],
    required_skills:     ["Excel", "estados financieros", "análisis financiero"],
    preferred_skills:    ["SAP", "Power BI"],
    required_languages:  [],
    min_experience_years: 0,
    raw_description:     "Buscamos analista junior para el área de finanzas corporativas. Elaboración de informes financieros y análisis de flujo de caja.",
  },

  // 2. Buena — IC, control gestión, inglés intermedio (perfil tiene B1)
  {
    title:               "Analista Control de Gestión Junior",
    company:             "Falabella",
    location:            "Santiago",
    modality:            "presencial",
    seniority:           "junior",
    required_degrees:    ["Ingeniería Comercial", "Ingeniería Civil Industrial"],
    required_skills:     ["Excel", "control de gestión", "reportería"],
    preferred_skills:    ["SAP", "Power BI", "SQL"],
    required_languages:  [{ language: "inglés", level: "intermedio" }],
    min_experience_years: 1,
    raw_description:     "Área de control de gestión busca profesional para reportería y seguimiento de KPIs. Deseable manejo de BI y SAP.",
  },

  // 3. Adaptable — área comercial, CRM que el perfil no tiene
  {
    title:               "Analista Comercial Junior",
    company:             "Entel",
    location:            "Santiago",
    modality:            "híbrido",
    seniority:           "junior",
    required_degrees:    ["Ingeniería Comercial", "Administración de Empresas"],
    required_skills:     ["Excel", "análisis comercial", "CRM"],
    preferred_skills:    ["Salesforce", "SQL"],
    required_languages:  [],
    min_experience_years: 0,
    raw_description:     "Apoyo a la gestión de clientes empresariales. Se requiere manejo de CRM y orientación a resultados.",
  },

  // 4. Low fit — inglés avanzado requerido, perfil tiene B1
  {
    title:               "Analista de Datos Junior",
    company:             "Cornershop",
    location:            "Santiago",
    modality:            "remoto",
    seniority:           "junior",
    required_degrees:    ["Ingeniería en Informática", "Ingeniería Civil Industrial", "Estadística"],
    required_skills:     ["Python", "SQL", "análisis de datos"],
    preferred_skills:    ["dbt", "Looker", "Google Analytics"],
    required_languages:  [{ language: "inglés", level: "avanzado" }],
    min_experience_years: 1,
    raw_description:     "Join our data team. Strong Python and SQL required. You will work with international teams daily. English proficiency mandatory.",
  },

  // 5. Low fit estructural — seniority senior, 7 años exp, inglés fluido
  {
    title:               "Senior FP&A Manager",
    company:             "Minera Los Pelambres",
    location:            "Santiago",
    modality:            "presencial",
    seniority:           "senior",
    required_degrees:    ["Ingeniería Comercial", "Economía"],
    required_skills:     ["Excel", "estados financieros", "valorización", "presupuesto"],
    preferred_skills:    ["SAP", "Bloomberg"],
    required_languages:  [{ language: "inglés", level: "fluido" }],
    min_experience_years: 7,
    raw_description:     "Gerente de FP&A para minera. Valorización de proyectos, modelos financieros complejos. Mínimo 7 años de experiencia. Inglés fluido excluyente.",
    hard_filters:        ["degree_required"],
  },
];

// Perfil mock para testing — IC + Magíster Finanzas + práctica + Excel/SAP + inglés B1
const MOCK_PROFILE = {
  degree:           "Ingeniería Comercial",
  academic_status:  "titulado",
  has_postgrad:     true,
  specialization:   ["finanzas"],
  tools:            ["excel", "sap"],
  skills:           ["analisis financiero", "analisis comercial", "reporteria"],
  languages:        ["ingles"],
  language_levels:  { ingles: "B1" },
  experience:       ["Práctica profesional detectada"],
  areas_of_interest: [{ value: "finanzas", weight: 3 }, { value: "analitica", weight: 2 }],
  desired_modality: ["híbrido"],
  city:             "Santiago",
  profile_quality: {
    experience_level:        "low",
    skill_level:             "medium",
    specialization_clarity:  "high",
  },
};

// ═══════════════════════════════════════════════════════════════════════
// EXPORTS
// ═══════════════════════════════════════════════════════════════════════

module.exports = {
  normalizeJobPosting,
  scoreJobFit,
  classifyJobAdaptability,
  rankJobsForProfile,
  MOCK_JOBS,
  MOCK_PROFILE,
};
