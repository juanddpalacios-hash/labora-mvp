const fs = require("fs/promises");
const path = require("path");

/**
 * Carga el catálogo de roles junior desde el archivo JSON.
 */
async function loadRoleCatalog() {
  const filePath = path.join(__dirname, "..", "..", "data", "junior_roles.json");
  const raw = await fs.readFile(filePath, "utf-8");
  return JSON.parse(raw);
}

module.exports = {
  loadRoleCatalog
};
