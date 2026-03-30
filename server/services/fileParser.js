const fs = require("fs");
const path = require("path");
const pdfParse = require("pdf-parse");
const mammoth = require("mammoth");

// -------------------------------------------------------------------
// Limpieza de texto extraído
// -------------------------------------------------------------------

/**
 * Limpia el texto crudo del parser:
 * - Elimina caracteres de control y no imprimibles
 * - Colapsa espacios y líneas en blanco excesivas
 * - Normaliza guiones y comillas raras
 */
function cleanText(raw) {
  return raw
    // Caracteres de control (excepto \n y \t)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "")
    // Guiones y comillas tipográficas → ASCII
    .replace(/[–—]/g, "-")
    .replace(/[""]/g, '"')
    .replace(/['']/g, "'")
    // Más de 2 saltos de línea consecutivos → 2
    .replace(/\n{3,}/g, "\n\n")
    // Espacios múltiples en una misma línea → 1
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

/**
 * Intenta extraer el nombre del candidato de las primeras líneas del CV.
 * Busca la primera línea no vacía que parezca un nombre propio
 * (2-5 palabras, todas con mayúscula inicial, sin números).
 */
function detectNameFromText(text) {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);

  for (const line of lines.slice(0, 8)) {
    const words = line.split(/\s+/);
    if (words.length < 2 || words.length > 5) continue;
    if (/\d/.test(line)) continue;

    const allCapitalized = words.every((w) => /^[A-ZÁÉÍÓÚÜÑ][a-záéíóúüñ]+$/.test(w));
    if (allCapitalized) return line;
  }

  return null;
}

// -------------------------------------------------------------------
// Parsers por formato
// -------------------------------------------------------------------

async function parsePdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const result = await pdfParse(buffer);
  return cleanText(result.text || "");
}

async function parseDocx(filePath) {
  const result = await mammoth.extractRawText({ path: filePath });
  return cleanText(result.value || "");
}

// -------------------------------------------------------------------
// Entrada pública
// -------------------------------------------------------------------

/**
 * Detecta el tipo de archivo, parsea el contenido y limpia el texto.
 * Retorna { text, detectedName }.
 */
async function parseUploadedFile(filePath, mimeType, originalName) {
  const ext = path.extname(originalName).toLowerCase();

  let text = "";

  if (ext === ".pdf" || mimeType === "application/pdf") {
    text = await parsePdf(filePath);
  } else if (
    ext === ".docx" ||
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    text = await parseDocx(filePath);
  } else {
    throw new Error("Formato de archivo no soportado.");
  }

  const detectedName = detectNameFromText(text);
  return { text, detectedName };
}

module.exports = {
  parseUploadedFile
};
