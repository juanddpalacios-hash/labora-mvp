"use strict";

/**
 * cvStructure.js
 *
 * Define el esquema estándar del CV en Labora (formato UAI adaptado),
 * los bancos de verbos por categoría de rol, y el catálogo de señales
 * de relevancia por área.
 *
 * Usado por cvNormalizer, cvOptimizer y cvDraftGenerator.
 */

// ═══════════════════════════════════════════════════════════════════════
// ESQUEMA ESTÁNDAR DEL CV
// ═══════════════════════════════════════════════════════════════════════

/**
 * Retorna un CV vacío con la estructura estándar de Labora.
 * Siempre partir desde aquí para garantizar consistencia entre flujos.
 */
function emptyCVStructure() {
  return {
    header: {
      full_name:    "",
      degree_line:  "",   // "Ingeniería Comercial | Magíster en Finanzas"
      contact_line: "",   // "email | +56 9 XXXX XXXX | linkedin.com/in/..."
    },

    professional_summary: "",   // 3-4 líneas, orientado al rol objetivo

    experience: [
      // {
      //   organization: "",
      //   date_range:   "",    // "Mar 2024 – Jul 2024"
      //   role:         "",
      //   bullets:      [],    // strings: "Elaboró reportes de..."
      //   relevance_score: 0, // interno, no se muestra al usuario
      // }
    ],

    education: [
      // {
      //   institution: "",
      //   degree:      "",
      //   date_range:  "",
      // }
    ],

    courses_certifications: [],
    // strings: "Excel Avanzado — Coursera, 2023"

    additional_info: {
      softwares:        [],   // ["Excel (avanzado)", "SAP", "Power BI"]
      languages:        [],   // ["Español: nativo", "Inglés: B1 (intermedio)"]
      extracurriculars: [],   // ["Delegado de carrera 2022-2023"]
    },
  };
}

// ═══════════════════════════════════════════════════════════════════════
// BANCOS DE VERBOS DE ACCIÓN POR ÁREA
// ═══════════════════════════════════════════════════════════════════════

const ACTION_VERBS = {
  finanzas: [
    "Elaboró", "Consolidó", "Analizó", "Modeló", "Proyectó",
    "Calculó", "Revisó", "Preparó", "Evaluó", "Gestionó",
  ],
  analitica: [
    "Procesó", "Visualizó", "Automatizó", "Extrajo", "Transformó",
    "Cruzó", "Modeló", "Diseñó", "Implementó", "Reportó",
  ],
  comercial: [
    "Identificó", "Prospectó", "Gestionó", "Coordinó", "Apoyó",
    "Monitoreó", "Analizó", "Desarrolló", "Ejecutó", "Presentó",
  ],
  operaciones: [
    "Coordinó", "Planificó", "Supervisó", "Optimizó", "Implementó",
    "Controló", "Gestionó", "Ejecutó", "Organizó", "Estandarizó",
  ],
  personas: [
    "Apoyó", "Coordinó", "Gestionó", "Realizó", "Participó",
    "Colaboró", "Facilitó", "Ejecutó", "Diseñó", "Elaboró",
  ],
  tecnologia: [
    "Desarrolló", "Implementó", "Configuró", "Automatizó", "Diseñó",
    "Integró", "Depuró", "Documentó", "Construyó", "Optimizó",
  ],
  proyectos: [
    "Coordinó", "Planificó", "Elaboró", "Ejecutó", "Monitoreó",
    "Gestionó", "Presentó", "Reportó", "Organizó", "Lideró",
  ],
  general: [
    "Elaboró", "Ejecutó", "Apoyó", "Coordinó", "Realizó",
    "Desarrolló", "Gestionó", "Participó", "Implementó", "Presentó",
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// SEÑALES DE RELEVANCIA POR ROL/ÁREA
// ═══════════════════════════════════════════════════════════════════════

// Palabras clave que hacen que una experiencia sea más relevante para un área
const RELEVANCE_SIGNALS = {
  finanzas: [
    "financiero", "finanzas", "presupuesto", "flujo de caja", "estados financieros",
    "valorización", "excel", "sap", "reportería", "análisis financiero",
    "balance", "ingreso", "costo", "margen", "rentabilidad",
  ],
  analitica: [
    "datos", "análisis", "python", "sql", "dashboard", "power bi", "tableau",
    "base de datos", "reporte", "kpi", "indicador", "visualización",
    "modelo", "estadística", "excel",
  ],
  comercial: [
    "ventas", "comercial", "cliente", "crm", "salesforce", "prospección",
    "negociación", "propuesta", "cotización", "canal", "revenue",
    "pipeline", "market", "mercado",
  ],
  operaciones: [
    "operaciones", "proceso", "logística", "cadena de suministro", "inventario",
    "coordinación", "planificación", "eficiencia", "estándar", "procedimiento",
    "sap", "erp",
  ],
  personas: [
    "recursos humanos", "rrhh", "reclutamiento", "selección", "capacitación",
    "gestión de personas", "talento", "onboarding", "evaluación de desempeño",
  ],
  tecnologia: [
    "desarrollo", "software", "programación", "python", "javascript", "sql",
    "git", "api", "base de datos", "backend", "frontend", "cloud",
  ],
  proyectos: [
    "proyecto", "gestión de proyectos", "pmo", "cronograma", "entregable",
    "stakeholder", "alcance", "riesgo", "coordinación",
  ],
};

// ═══════════════════════════════════════════════════════════════════════
// MAPEO ROL CANÓNICO → ÁREA
// ═══════════════════════════════════════════════════════════════════════

const ROLE_TO_AREA = {
  "analista financiero junior":          "finanzas",
  "analista control de gestion junior":  "finanzas",
  "analista comercial junior":           "comercial",
  "analista de marketing junior":        "comercial",
  "analista de datos junior":            "analitica",
  "analista de reporting junior":        "analitica",
  "coordinador de operaciones junior":   "operaciones",
  "asistente de proyectos junior":       "proyectos",
  "asistente de rrhh junior":            "personas",
  "analista gis junior":                 "analitica",
  "analista ambiental junior":           "analitica",
};

function getRoleArea(roleTitle) {
  const normalized = roleTitle.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").trim();
  return ROLE_TO_AREA[normalized] || "general";
}

function getActionVerbs(area) {
  return ACTION_VERBS[area] || ACTION_VERBS.general;
}

function getRelevanceSignals(area) {
  return RELEVANCE_SIGNALS[area] || [];
}

module.exports = {
  emptyCVStructure,
  ACTION_VERBS,
  RELEVANCE_SIGNALS,
  ROLE_TO_AREA,
  getRoleArea,
  getActionVerbs,
  getRelevanceSignals,
};
