const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");

const { parseUploadedFile } = require("../services/fileParser");
const { extractProfileFromCV } = require("../services/aiExtractor");
const { loadRoleCatalog } = require("../services/roleCatalog");
const { matchRoles } = require("../services/roleMatcher");

const router = express.Router();

// Directorio de uploads (relativo a la raíz del proyecto)
const uploadsDir = path.join(__dirname, "..", "..", "uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configuración de multer: guarda el archivo con nombre seguro
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const safeName = `${Date.now()}-${file.originalname.replace(/\s+/g, "_")}`;
    cb(null, safeName);
  }
});

// Solo permite PDF y DOCX
const fileFilter = (_req, file, cb) => {
  const allowed = [".pdf", ".docx"];
  const ext = path.extname(file.originalname).toLowerCase();
  if (!allowed.includes(ext)) {
    return cb(new Error("Solo se permiten archivos PDF o DOCX."));
  }
  cb(null, true);
};

const upload = multer({ storage, fileFilter });

// POST /api/analyze
router.post("/", upload.single("cv"), async (req, res) => {
  try {
    // Metadatos del formulario
    const metadata = {
      name: req.body.name || "",
      degree: req.body.degree || "",
      academicStatus: req.body.academicStatus || "",
      city:   req.body.city       || "",
      region: req.body.cityRegion || "",
      desiredModality:           req.body.desiredModality ? JSON.parse(req.body.desiredModality) : [],
      areasOfInterest:           req.body.areasOfInterest ? JSON.parse(req.body.areasOfInterest) : [],
      interest_other:            req.body.interest_other || "",
      company_preferences:       req.body.company_preferences ? JSON.parse(req.body.company_preferences) : [],
      company_preferences_other: req.body.company_preferences_other || "",
      user_intent_mode:          req.body.user_intent_mode || "guided",
      avoidPreferences:          req.body.avoid_preferences ? JSON.parse(req.body.avoid_preferences) : [],
      areas_interest:            req.body.areas_interest   ? JSON.parse(req.body.areas_interest)   : [],
      task_prefs:                req.body.task_preferences      ? JSON.parse(req.body.task_preferences)      : [],
      motivation_prefs:          req.body.motivation_preferences ? JSON.parse(req.body.motivation_preferences) : [],
      interest_prefs:            req.body.interest_preferences  ? JSON.parse(req.body.interest_preferences)  : []
    };

    // Estudiante en último año → tratarlo como egresado en el scoring
    const isLastYear = req.body.isLastYear === "true";
    if (metadata.academicStatus === "estudiante" && isLastYear) {
      metadata.academicStatus = "egresado";
    }

    // has_postgrad declarado explícitamente en el formulario (sin CV)
    const formPostgrad = req.body.hasPostgrad === "true";

    let extractedProfile;
    let parsedText = "";

    if (req.file) {
      // 1. Parsear el archivo a texto plano
      const { text: cvText, detectedName } = await parseUploadedFile(
        req.file.path,
        req.file.mimetype,
        req.file.originalname
      );

      parsedText = cvText;

      if (!parsedText || parsedText.trim().length < 30) {
        return res.status(400).json({
          error: "No se pudo extraer suficiente texto del CV. Prueba con otro archivo."
        });
      }

      // Si el formulario no trae nombre pero el CV sí, usamos el del CV
      if (!metadata.name && detectedName) metadata.name = detectedName;

      // 2. Extraer perfil estructurado del texto
      extractedProfile = await extractProfileFromCV(parsedText, metadata);
      // Fusionar: la declaración del formulario refuerza lo que detectó el CV
      extractedProfile.has_postgrad = extractedProfile.has_postgrad || formPostgrad;
    } else {
      // Sin CV: perfil mínimo basado solo en los datos del formulario
      extractedProfile = {
        name:              metadata.name,
        degree:            metadata.degree,
        academic_status:   metadata.academicStatus,
        city:              metadata.city,
        region:            metadata.region,
        desired_modality:  metadata.desiredModality,
        areas_of_interest: metadata.areasOfInterest,
        preferences:       metadata.company_preferences,
        tools:             [],
        skills:            [],
        languages:         [],
        specialization:    [],
        has_postgrad:      formPostgrad,
        experience:        [],
        projects:          [],
        strengths:         [],
        summary:           "Diagnóstico basado en los datos del formulario. Sube tu CV para mejorar la precisión.",
        raw_text_length:   0
      };
    }

    // 3. Cargar catálogo de roles y hacer matching
    const roleCatalog = await loadRoleCatalog();
    const matches = matchRoles(extractedProfile, roleCatalog, metadata);

    return res.json({
      success: true,
      cvTextPreview: parsedText.slice(0, 500),
      cvRawText:     parsedText || null,
      profile: {
        ...extractedProfile,
        company_preferences:       metadata.company_preferences,
        company_preferences_other: metadata.company_preferences_other,
        interest_other:            metadata.interest_other
      },
      matches
    });
  } catch (error) {
    console.error("Analyze error:", error);
    return res.status(500).json({
      error: error.message || "Ocurrió un error analizando el CV."
    });
  }
});

module.exports = router;
