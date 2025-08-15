const mongoose = require("mongoose");

const JobSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    company: {
      type: String,
      required: true,
      trim: true,
    },
    role: {
      type: String,
      required: true,
      trim: true,
    },
    pay: {
      type: String,
      trim: true,
    },
    dateApplied: {
      type: Date,
      required: true,
    },
    interviewDate: {
      type: Date,
    },
    jobType: {
      type: String,
      enum: ["Internship", "Full-Time", "IT + FT", "IT + PBC"],
    },
    status: {
      type: String,
      enum: ["applied", "interview", "offered", "rejected"],
      default: "applied",
    },
    mode: {
      type: String,
      enum: ["on-campus", "off-campus"],
      default: "on-campus",
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Job", JobSchema);
