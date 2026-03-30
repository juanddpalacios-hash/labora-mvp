const { normalizeText } = require("../utils/text");

// -------------------------------------------------------------------
// Diccionarios de detección
// -------------------------------------------------------------------

const KNOWN_TOOLS = [
  "excel", "sql", "python", "power bi", "tableau",
  "qgis", "arcgis", "autocad", "r", "sap",
  "word", "powerpoint", "spss", "stata", "matlab",
  "github", "git", "figma", "notion", "jira",
  "google analytics", "looker", "dbt"
];

const KNOWN_SKILLS = [
  // análisis
  "analisis de datos", "analisis espacial", "visualizacion",
  "analisis financiero", "estados financieros", "flujo de caja",
  "control de gestion", "presupuesto", "valorización",
  // comercial / marketing
  "crm", "marketing digital", "redes sociales", "campanas digitales",
  "analisis comercial", "pipeline de ventas",
  // operaciones
  "gestion de proyectos", "gestion de procesos", "coordinacion",
  "indicadores operacionales", "kpis",
  // personas
  "seleccion de personal", "reclutamiento", "gestion de personas",
  // transversales
  "trabajo en equipo", "comunicacion", "liderazgo",
  "resolucion de problemas", "atencion al detalle"
];

const KNOWN_LANGUAGES = [
  "espanol", "ingles", "portugues", "frances", "aleman", "italiano"
];

// Señales de experiencia aplicada en el CV
const EXPERIENCE_RULES = [
  { phrase: "practica",      label: "Práctica profesional detectada" },
  { phrase: "intern",        label: "Experiencia tipo internship detectada" },
  { phrase: "ayudante",      label: "Ayudantía detectada" },
  { phrase: "proyecto",      label: "Proyecto académico o profesional detectado" },
  { phrase: "tesis",         label: "Trabajo de tesis detectado" },
  { phrase: "tesina",        label: "Trabajo académico detectado" },
  { phrase: "investigacion", label: "Experiencia de investigación detectada" },
  { phrase: "terreno",       label: "Experiencia en terreno detectada" },
  { phrase: "voluntariado",  label: "Voluntariado detectado" },
  { phrase: "memoria",       label: "Memoria de título detectada" }
];

// -------------------------------------------------------------------
// Detección de especialización
// Cada entrada define señales clave → etiqueta de área
// Se detectan por presencia en el texto normalizado del CV
// -------------------------------------------------------------------
const SPECIALIZATION_SIGNALS = [
  {
    keywords: [
      "finanz", "financier", "inversion", "valorizacion",
      "flujo de caja", "estados financieros", "banca", "tesoreria",
      "presupuesto", "control de gestion", "magister en finanz",
      "mencion finanz", "renta fija", "mercado de capitales"
    ],
    label: "finanzas"
  },
  {
    keywords: [
      "marketing", "publicidad", "campana publicitaria",
      "google analytics", "seo", "sem", "redes sociales",
      "marketing digital", "mencion marketing"
    ],
    label: "marketing"
  },
  {
    keywords: [
      "analisis de datos", "data science", "machine learning",
      "inteligencia artificial", "big data", "analitica avanzada",
      "magister en datos", "mencion datos", "mencion analitica"
    ],
    label: "analitica"
  },
  {
    keywords: [
      "recursos humanos", "rrhh", "gestion de personas",
      "seleccion de personal", "reclutamiento", "talento humano",
      "clima organizacional", "magister en rrhh", "mencion rrhh"
    ],
    label: "personas"
  },
  {
    keywords: [
      "logistica", "supply chain", "cadena de suministro",
      "inventario", "distribucion", "mencion logistica"
    ],
    label: "logistica"
  },
  {
    keywords: [
      "mejora de procesos", "lean", "six sigma",
      "gestion de calidad", "iso", "procesos operacionales"
    ],
    label: "operaciones"
  },
  {
    keywords: [
      "ventas", "fuerza de ventas", "comercial",
      "negociacion comercial", "crm", "mencion comercial"
    ],
    label: "comercial"
  },
  {
    keywords: [
      "geologia", "geotecnia", "mineria", "exploracion minera",
      "yacimiento", "geotecnico"
    ],
    label: "geociencias"
  },
  {
    keywords: [
      "medioambiente", "ambiental", "sustentabilidad",
      "residuos", "eia", "evaluacion ambiental", "normativa ambiental"
    ],
    label: "medioambiente"
  }
];

// -------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------

/**
 * Escapa caracteres especiales de regex.
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Comprueba si una palabra/frase aparece como token independiente en el texto.
 * - Frases multi-palabra: basta con substring (ya son suficientemente específicas).
 * - Palabras simples: exige límite de palabra ([^a-z0-9] a ambos lados)
 *   para evitar falsos positivos como "r" → "trabajar", "git" → "digital".
 */
function containsToken(normalizedText, normalizedItem) {
  if (normalizedItem.includes(" ")) {
    return normalizedText.includes(normalizedItem);
  }
  const pattern = new RegExp(
    `(^|[^a-z0-9])${escapeRegex(normalizedItem)}([^a-z0-9]|$)`
  );
  return pattern.test(normalizedText);
}

function detectItemsFromText(text, dictionary) {
  const normalized = normalizeText(text);
  return dictionary.filter((item) =>
    containsToken(normalized, normalizeText(item))
  );
}

function extractSection(text, keywords) {
  const lines      = text.split("\n");
  const normalized = lines.map(normalizeText);

  let start = -1;
  for (let i = 0; i < normalized.length; i++) {
    if (keywords.some((kw) => normalized[i].includes(normalizeText(kw)))) {
      start = i + 1;
      break;
    }
  }

  if (start === -1) return "";
  return lines.slice(start, start + 20).join(" ");
}

function detectExperienceSignals(text) {
  const normalized = normalizeText(text);
  return EXPERIENCE_RULES
    .filter((rule) => containsToken(normalized, normalizeText(rule.phrase)))
    .map((rule) => rule.label);
}

/**
 * Detecta áreas de especialización con umbral mínimo.
 *
 * Señales fuertes (magíster, mención, especialización): 1 basta.
 * Señales regulares: se necesitan al menos 2 para asignar el área.
 *
 * Retorna máximo 2 áreas ordenadas por peso descendente.
 * Principio: mejor quedarse corto que inventar.
 */
const STRONG_KW_PREFIXES = ["magister", "mencion", "especializacion"];

function detectSpecialization(text) {
  const normalized = normalizeText(text);

  const scored = SPECIALIZATION_SIGNALS.map(({ keywords, label }) => {
    let strongCount  = 0;
    let regularCount = 0;

    for (const kw of keywords) {
      const nkw = normalizeText(kw);
      if (!containsToken(normalized, nkw)) continue;
      if (STRONG_KW_PREFIXES.some((p) => nkw.startsWith(p))) {
        strongCount++;
      } else {
        regularCount++;
      }
    }

    return { label, strongCount, regularCount, weight: strongCount * 3 + regularCount };
  });

  return scored
    .filter(({ strongCount, regularCount }) => strongCount > 0 || regularCount >= 2)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 1)
    .map(({ label }) => label);
}

/**
 * Detecta si el CV menciona posgrado (magíster, MBA, diplomado).
 */
function detectPostgrad(text) {
  const normalized = normalizeText(text);
  return ["magister", "mba", "posgrado", "master of", "diplomado"].some(
    (kw) => normalized.includes(kw)
  );
}

function inferSummary(metadata, tools, skills, specialization) {
  const degree = metadata.degree || "formación no especificada";
  const status = metadata.academicStatus || "estado académico no especificado";

  let summary = `Perfil junior con formación en ${degree} (${status}).`;

  if (tools.length > 0) {
    summary += ` Maneja herramientas como ${tools.slice(0, 4).join(", ")}.`;
  }

  if (specialization.length > 0) {
    summary += ` Señales de especialización en: ${specialization.join(", ")}.`;
  } else if (skills.length > 0) {
    summary += ` Muestra señales de ${skills.slice(0, 3).join(", ")}.`;
  }

  return summary;
}

// -------------------------------------------------------------------
// Extractor principal
// -------------------------------------------------------------------

async function extractProfileFromCV(cvText, metadata = {}) {
  const tools    = detectItemsFromText(cvText, KNOWN_TOOLS);
  const skills   = detectItemsFromText(cvText, KNOWN_SKILLS);
  const languages = detectItemsFromText(cvText, KNOWN_LANGUAGES);

  // Refinar con sección de habilidades si existe
  const skillsSection = extractSection(cvText, [
    "habilidades", "skills", "herramientas", "competencias", "tools"
  ]);
  if (skillsSection) {
    detectItemsFromText(skillsSection, KNOWN_TOOLS).forEach((t) => {
      if (!tools.includes(t)) tools.push(t);
    });
    detectItemsFromText(skillsSection, KNOWN_SKILLS).forEach((s) => {
      if (!skills.includes(s)) skills.push(s);
    });
  }

  const experienceSignals = detectExperienceSignals(cvText);
  const specialization    = detectSpecialization(cvText);
  const has_postgrad      = detectPostgrad(cvText);

  const strengths = [];
  if (tools.length >= 3)                          strengths.push("Buen set inicial de herramientas");
  if (skills.includes("analisis de datos"))        strengths.push("Señales de perfil analítico");
  if (skills.includes("analisis financiero"))      strengths.push("Señales de perfil financiero");
  if (skills.includes("control de gestion"))       strengths.push("Señales de control de gestión");
  if (experienceSignals.length > 0)               strengths.push("Hay evidencia de experiencias aplicadas");
  if (languages.includes("ingles"))               strengths.push("Menciona manejo de inglés");
  if (has_postgrad)                               strengths.push("Formación de posgrado detectada");
  if (skills.includes("analisis espacial"))        strengths.push("Perfil con componente espacial/geográfico");

  return {
    name:              metadata.name || "",
    degree:            metadata.degree || "",
    academic_status:   metadata.academicStatus || "",
    city:              metadata.city   || "",
    region:            metadata.region || "",
    desired_modality:  metadata.desiredModality || "",
    areas_of_interest: metadata.areasOfInterest || [],
    preferences:       metadata.preferences     || [],
    tools,
    skills,
    languages,
    specialization,
    has_postgrad,
    experience: experienceSignals.map((signal) => ({
      title:        signal,
      organization: "",
      duration:     "",
      description:  signal
    })),
    projects:   experienceSignals.filter((s) => normalizeText(s).includes("proyecto")),
    strengths,
    summary:    inferSummary(metadata, tools, skills, specialization),
    raw_text_length: cvText.length
  };
}

module.exports = {
  extractProfileFromCV
};
