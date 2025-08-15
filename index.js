require("dotenv").config();
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const pdfParse = require("pdf-parse");
const fs = require("fs");
const path = require("path");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const authRoutes = require("./routes/auth");
const jobRoutes = require("./routes/jobs");

const app = express();
const PORT = process.env.PORT || 5000;
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

// Middleware
app.use(cors({ origin: "*", credentials: true }));
app.use(express.json());
app.use(cookieParser());

// MongoDB Connection
mongoose.connect(process.env.MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("✅ MongoDB connected"))
.catch(err => console.error("❌ MongoDB connection error:", err));

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/jobs", jobRoutes);

// Load Skills List
let skillsList = [];
try {
  skillsList = require("./skills.json");
} catch (err) {
  console.warn("⚠️ skills.json not found. Resume-JD match may not work.");
}

// Static HTML Serve (optional)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// File Upload Config
const upload = multer({
  dest: "uploads/",
  fileFilter: (req, file, cb) => {
    if (file.mimetype === "application/pdf") cb(null, true);
    else cb(new Error("Only PDF files are allowed"));
  },
});

// Static Resume Checks
const actionVerbs = ["developed", "led", "created", "implemented", "designed", "built", "managed", "initiated", "launched"];
const keywords = ["Python", "JavaScript", "React", "Node", "Machine Learning", "AWS", "SQL", "Git"];

function analyzeResume(text) {
  const feedback = [];

  if (text.toLowerCase().includes("summary")) feedback.push("✅ Summary section found");
  else feedback.push("⚠️ No summary section found");

  if (text.toLowerCase().includes("education")) feedback.push("✅ Education section found");
  else feedback.push("⚠️ Education section not found");

  if (text.toLowerCase().includes("experience")) feedback.push("✅ Experience section found");
  else feedback.push("⚠️ Experience section not found");

  if (text.toLowerCase().includes("skills")) feedback.push("✅ Skills section found");
  else feedback.push("⚠️ Skills section not found");

  const actionVerbCount = actionVerbs.reduce((count, verb) => {
    const regex = new RegExp(`\\b${verb}\\b`, "gi");
    return count + (text.match(regex) || []).length;
  }, 0);
  feedback.push(`✅ ${actionVerbCount} action verbs found`);

  const presentKeywords = keywords.filter(k => text.toLowerCase().includes(k.toLowerCase()));
  feedback.push(`✅ Found technical keywords: ${presentKeywords.join(", ") || "None"}`);

  return feedback;
}

// Gemini Resume Feedback
async function getGeminiFeedback(text) {
  try {
    const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });
    const trimmed = text.length > 10000 ? text.slice(0, 10000) : text;

    const prompt = `
You are a professional resume review assistant. Analyze the following resume text and provide detailed, professional feedback in a structured JSON format with the following keys:

1. overall_impression: A quick summary of how the resume comes across at first glance (e.g. professional, clear, cluttered, too generic, etc.) and whether it's aligned with the target role/industry
2. strengths: What's working well (e.g. strong formatting, impactful achievements, relevant skills, good clarity) and any standout sections (e.g. a great summary, clean design, strong quantification of impact)
3. areas_for_improvement: High-level issues that might be hurting the resume's effectiveness, including layout problems, poor keyword optimization, vague language, lack of metrics, etc.
4. section_feedback: Section-by-section feedback on each part of the resume (e.g. summary, work experience, education, skills)
5. suggestions: Formatting or design tweaks, tools (e.g. ATS resume scanner, resume builders), tips on tailoring for specific jobs/industries, and resources for improvement (e.g. action verb lists, job description alignment)
6. ats_readability: Information about whether the resume is likely to pass through applicant tracking systems (ATS) and if it's skimmable and engaging for a recruiter in 6-10 seconds

Return ONLY valid JSON in this exact format:
{
  "overall_impression": "summary here",
  "strengths": ["strength1", "strength2"],
  "areas_for_improvement": ["improvement1", "improvement2"],
  "section_feedback": ["feedback1", "feedback2"],
  "suggestions": ["suggestion1", "suggestion2"],
  "ats_readability": "ats and readability assessment here"
}

Resume Text:
"""
${trimmed}
"""`;

    const result = await model.generateContent(prompt);
    return (await result.response).text();
  } catch (err) {
    console.error("❌ Gemini error:", err);
    return "❌ Gemini AI failed to generate feedback.";
  }
}

// Resume Feedback API
app.post("/api/resume-feedback", upload.single("resume"), async (req, res) => {
  if (!req.file) return res.status(400).json({ feedback: "No file uploaded or invalid type" });

  const filePath = req.file.path;

  try {
    const data = await pdfParse(fs.readFileSync(filePath));
    const text = data.text;

    if (!text.trim()) throw new Error("Empty resume content");

    const staticFeedback = analyzeResume(text);
    const geminiFeedback = await getGeminiFeedback(text);

    // Try to parse Gemini feedback as JSON
    let parsedGeminiFeedback;
    try {
      // Extract JSON from potential markdown code block
      const jsonString = geminiFeedback
        .replace(/```json\n?/, '')
        .replace(/\n?```/, '');
      parsedGeminiFeedback = JSON.parse(jsonString);
    } catch (parseError) {
      // If parsing fails, use the raw feedback
      parsedGeminiFeedback = {
        overall_impression: geminiFeedback,
        strengths: [],
        areas_for_improvement: [],
        section_feedback: [],
        suggestions: [],
        ats_readability: "Unable to assess ATS compatibility and readability."
      };
    }

    res.json({ 
      feedback: parsedGeminiFeedback,
      staticFeedback: staticFeedback
    });
  } catch (err) {
    console.error("❌ Resume analysis failed:", err);
    res.status(500).json({ feedback: "Error analyzing resume" });
  } finally {
    fs.unlink(filePath, () => {});
  }
});

// Resume-JD Match API
app.post("/api/match", upload.fields([{ name: "resume" }, { name: "jd" }]), async (req, res) => {
  try {
    if (!req.files?.resume || !req.files?.jd)
      return res.status(400).json({ error: "Both resume and JD files are required." });

    const resumePath = req.files.resume[0].path;
    const jdPath = req.files.jd[0].path;

    const resumeText = (await pdfParse(fs.readFileSync(resumePath))).text;
    const jdText = (await pdfParse(fs.readFileSync(jdPath))).text;

    // Use AI to extract skills from both documents
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    
    // Extract skills from JD
    const jdSkillsPrompt = `Extract a list of technical skills, programming languages, frameworks, required in this job description (dont include qualifications). Return ONLY a JSON array of strings.

Job Description:
"""
${jdText}
"""`;
    
    const jdSkillsResult = await model.generateContent(jdSkillsPrompt);
    const jdSkillsText = jdSkillsResult.response?.text() || "[]";
    
    // Extract skills from Resume
    const resumeSkillsPrompt = `Extract a list of technical skills, programming languages, frameworks mentioned in this resume. Return ONLY a JSON array of strings.

Resume:
"""
${resumeText}
"""`;
    
    const resumeSkillsResult = await model.generateContent(resumeSkillsPrompt);
    const resumeSkillsText = resumeSkillsResult.response?.text() || "[]";
    
    // Parse the JSON arrays
    let jdSkills = [];
    let resumeSkills = [];
    
    try {
      // Extract JSON from potential markdown code block
      const jdSkillsJson = jdSkillsText
        .replace(/```json\n?/, '')
        .replace(/\n?```/, '');
      jdSkills = JSON.parse(jdSkillsJson);
    } catch (err) {
      console.error("Error parsing JD skills:", err);
      jdSkills = [];
    }
    
    try {
      // Extract JSON from potential markdown code block
      const resumeSkillsJson = resumeSkillsText
        .replace(/```json\n?/, '')
        .replace(/\n?```/, '');
      resumeSkills = JSON.parse(resumeSkillsJson);
    } catch (err) {
      console.error("Error parsing resume skills:", err);
      resumeSkills = [];
    }
    
    // Convert to lowercase for comparison
    const resumeSkillsLower = resumeSkills.map(skill => skill.toLowerCase());
    const jdSkillsLower = jdSkills.map(skill => skill.toLowerCase());
    
    // Find matched and missing skills
    const matchedSkills = jdSkills.filter(skill => 
      resumeSkillsLower.includes(skill.toLowerCase())
    );
    
    const missingSkills = jdSkills.filter(skill => 
      !resumeSkillsLower.includes(skill.toLowerCase())
    );
    
    const total = jdSkills.length;
    const matchScore = total ? `${Math.round((matchedSkills.length / total) * 100)}%` : "0%";

    const promptParts = [
      `You are a job application assistant. Given the job description and resume below, analyze how well the resume matches the job. Return the response in the following JSON format and use bold words where ever needed for better readability:\n\n{\n  "match_score": "A percentage indicating how well the resume matches the job description",\n  "strengths": [\n    "List of strengths based on the resume and JD"\n  ],\n  "weaknesses": [\n    "List of weak or missing elements in the resume"\n  ],\n  "suggestions": [\n    "Suggestions to improve the resume that matches the Job description"\n  ],\n  "overall_analysis": "A brief summary paragraph about the overall match"\n}`,
      '\n\nJob Description:\n"""\n',
      jdText.slice(0, 8000),
      '\n"""\n\nResume:\n"""\n',
      resumeText.slice(0, 8000),
      '\n"""',
    ];

    const result = await model.generateContent(promptParts);
    const feedback = result.response?.text() || "";

    res.json({ matchScore, matchedSkills, missingSkills, jdSkills, feedback });
  } catch (err) {
    console.error("❌ JD match failed:", err);
    res.status(500).json({ error: "Matching failed" });
  } finally {
    if (req.files?.resume?.[0]?.path) {
      fs.unlink(req.files.resume[0].path, () => {});
    }
    if (req.files?.jd?.[0]?.path) {
      fs.unlink(req.files.jd[0].path, () => {});
    }
  }
});



// Start Server
app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
