const express = require("express");
const router = express.Router();
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

const User = require("../models/user");

const JWT_SECRET = process.env.JWT_SECRET || "secret"; // Store this in .env

// Middleware to verify token
const verifyToken = (req, res, next) => {
  const token = req.header("Authorization")?.replace("Bearer ", "");
  
  if (!token) {
    return res.status(401).json({ message: "Access denied. No token provided." });
  }
  
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(400).json({ message: "Invalid token." });
  }
};

// Signup
router.post("/signup", async (req, res) => {
  const { username, name, email, password, securityQuestion, securityAnswer } = req.body;

  try {
    // Check if username already exists
    const existingUsername = await User.findOne({ username: username.toLowerCase() });
    if (existingUsername) return res.status(400).json({ message: "Username already taken" });

    // Check if email already exists
    const existingEmail = await User.findOne({ email });
    if (existingEmail) return res.status(400).json({ message: "Email already registered" });

    // Validate username format
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return res.status(400).json({ message: "Username can only contain letters, numbers, and underscores" });
    }

    if (username.length < 3 || username.length > 30) {
      return res.status(400).json({ message: "Username must be between 3 and 30 characters" });
    }

    // Hash password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);
    const hashedAnswer = await bcrypt.hash(securityAnswer, salt);

    // Create user
    const user = new User({
        username: username.toLowerCase(),
        name,
        email,
        password: hashedPassword,
        securityQuestion,
        securityAnswer: hashedAnswer,
      });
      await user.save();

    // Generate token
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });

    res.status(201).json({ token, user: { id: user._id, username: user.username, name, email } });
  } catch (error) {
    res.status(500).json({ message: "Server error during signup" });
  }
});

// Login
router.post("/login", async (req, res) => {
  const { username, password } = req.body;

  try {
    // Find user by username
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(400).json({ message: "Invalid credentials" });

    // Compare passwords
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(400).json({ message: "Invalid credentials" });

    // Generate token
    const token = jwt.sign({ id: user._id }, JWT_SECRET, { expiresIn: "7d" });

    res.json({ token, user: { id: user._id, username: user.username, name: user.name, email: user.email } });
  } catch (error) {
    res.status(500).json({ message: "Server error during login" });
  }
});

// Get Security Question
router.get("/security-question", async (req, res) => {
  const { username } = req.query;

  try {
    const user = await User.findOne({ username: username.toLowerCase() });
    if (!user) return res.status(400).json({ message: "User not found" });

    res.status(200).json({ securityQuestion: user.securityQuestion });
  } catch (error) {
    res.status(500).json({ message: "Server error fetching security question" });
  }
});

// Get User Profile
router.get("/me", verifyToken, async (req, res) => {
  try {
    const user = await User.findById(req.user.id).select("-password -securityAnswer");
    if (!user) return res.status(404).json({ message: "User not found" });
    
    res.status(200).json({ user });
  } catch (error) {
    res.status(500).json({ message: "Server error fetching user profile" });
  }
});

// Forgot Password
router.post("/forgot-password", async (req, res) => {
    const { username, securityAnswer, newPassword } = req.body;
  
    try {
      const user = await User.findOne({ username: username.toLowerCase() });
      if (!user) return res.status(400).json({ message: "User not found" });
  
      const isAnswerMatch = await bcrypt.compare(
        securityAnswer,
        user.securityAnswer
      );
      if (!isAnswerMatch)
        return res.status(400).json({ message: "Incorrect security answer" });
  
      const salt = await bcrypt.genSalt(10);
      const hashedNewPassword = await bcrypt.hash(newPassword, salt);
  
      user.password = hashedNewPassword;
      await user.save();
  
      res.status(200).json({ message: "Password updated successfully" });
    } catch (error) {
      res.status(500).json({ message: "Server error during password reset" });
    }
  });

module.exports = router;


