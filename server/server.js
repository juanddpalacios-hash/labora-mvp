const path = require("path");
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");

dotenv.config();

const analyzeRouter = require("./routes/analyze");
const cvRouter      = require("./routes/cv");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Sirve el frontend estático desde /public
app.use(express.static(path.join(__dirname, "..", "public")));

app.use("/api/analyze", analyzeRouter);
app.use("/api/cv",      cvRouter);

app.get("/health", (_req, res) => {
  res.json({ ok: true, message: "Labora MVP running" });
});

app.listen(PORT, () => {
  console.log(`Labora MVP running on http://localhost:${PORT}`);
});
