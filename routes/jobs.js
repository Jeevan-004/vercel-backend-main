const express = require("express");
const router = express.Router();
const Job = require("../models/jobs");
const auth = require("../middleware/auth");

// Get all jobs for a user
router.get("/", auth, async (req, res) => {
  try {
    const jobs = await Job.find({ user: req.user.id }).sort({ dateApplied: -1 });
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get jobs by status for a user
router.get("/status/:status", auth, async (req, res) => {
  try {
    const { status } = req.params;
    const jobs = await Job.find({ 
      user: req.user.id,
      status 
    }).sort({ dateApplied: -1 });
    res.json(jobs);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Get analytics data for a user
router.get("/analytics", auth, async (req, res) => {
  try {
    const { period } = req.query;
    const userId = req.user.id;

    // Calculate date range based on period
    const now = new Date();
    let startDate;
    switch (period) {
      case "last30days":
        startDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
        break;
      case "last90days":
        startDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
        break;
      default: // all time
        startDate = new Date(0);
    }

    // Get all jobs within the date range
    const jobs = await Job.find({
      user: userId,
      dateApplied: { $gte: startDate }
    });

    // Calculate status distribution
    const statusCounts = {
      applied: 0,
      interview: 0,
      offered: 0,
      rejected: 0
    };
    jobs.forEach(job => {
      statusCounts[job.status]++;
    });

    // Calculate applications over time
    const timeData = [];
    const currentDate = new Date(startDate);
    const endDate = new Date();
    
    while (currentDate <= endDate) {
      const dateStr = currentDate.toISOString().split('T')[0];
      const count = jobs.filter(job => {
        const jobDate = new Date(job.dateApplied).toISOString().split('T')[0];
        return jobDate === dateStr;
      }).length;
      
      if (count > 0) { // Only include dates with applications
        timeData.push({ date: dateStr, count });
      }
      
      currentDate.setDate(currentDate.getDate() + 1);
    }

    // Calculate role distribution
    const roleData = {};
    jobs.forEach(job => {
      if (!roleData[job.role]) {
        roleData[job.role] = { applied: 0, interview: 0, offered: 0 };
      }
      roleData[job.role].applied++;
      if (job.status === 'interview') roleData[job.role].interview++;
      if (job.status === 'offered') roleData[job.role].offered++;
    });

    // Calculate summary statistics
    const totalApplications = jobs.length;
    const interviewRate = totalApplications > 0 
      ? (statusCounts.interview / totalApplications * 100).toFixed(1)
      : 0;
    const offerRate = totalApplications > 0
      ? (statusCounts.offered / totalApplications * 100).toFixed(1)
      : 0;

    // Calculate average response time (time between application and status change)
    let totalResponseTime = 0;
    let responseCount = 0;
    jobs.forEach(job => {
      if (job.status !== 'applied' && job.dateApplied) {
        const appliedDate = new Date(job.dateApplied);
        const statusChangeDate = new Date(job.updatedAt);
        const daysDiff = Math.ceil((statusChangeDate - appliedDate) / (1000 * 60 * 60 * 24));
        if (daysDiff > 0) {
          totalResponseTime += daysDiff;
          responseCount++;
        }
      }
    });
    const avgResponseTime = responseCount > 0 
      ? Math.round(totalResponseTime / responseCount)
      : 0;

    res.json({
      summary: {
        totalApplications,
        interviewRate: `${interviewRate}%`,
        offerRate: `${offerRate}%`,
        avgResponseTime: `${avgResponseTime} days`
      },
      statusDistribution: Object.entries(statusCounts).map(([name, value]) => ({
        name: name.charAt(0).toUpperCase() + name.slice(1),
        value,
        color: name === 'applied' ? '#3B82F6' : 
               name === 'interview' ? '#F59E0B' :
               name === 'offered' ? '#10B981' : '#EF4444'
      })),
      timeData,
      roleData: Object.entries(roleData).map(([name, data]) => ({
        name,
        ...data
      }))
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ message: "Server error while fetching analytics", error: error.message });
  }
});

// Add a new job
router.post("/", auth, async (req, res) => {
  try {
    const { company, role, pay, dateApplied, interviewDate, jobType, status, mode, notes } = req.body;
    
    const job = new Job({
      user: req.user.id,
      company,
      role,
      pay,
      dateApplied,
      interviewDate,
      jobType,
      status,
      mode,
      notes
    });

    await job.save();
    res.status(201).json(job);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Update a job
router.put("/:id", auth, async (req, res) => {
  try {
    const { company, role, pay, dateApplied, interviewDate, jobType, status, mode, notes } = req.body;
    
    let job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Make sure user owns the job
    if (job.user.toString() !== req.user.id) {
      return res.status(401).json({ message: "Not authorized" });
    }

    job = await Job.findByIdAndUpdate(
      req.params.id,
      { company, role, pay, dateApplied, interviewDate, jobType, status, mode, notes },
      { new: true }
    );

    res.json(job);
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

// Delete a job
router.delete("/:id", auth, async (req, res) => {
  try {
    const job = await Job.findById(req.params.id);
    if (!job) {
      return res.status(404).json({ message: "Job not found" });
    }

    // Make sure user owns the job
    if (job.user.toString() !== req.user.id) {
      return res.status(401).json({ message: "Not authorized" });
    }

    await job.deleteOne();
    res.json({ message: "Job removed" });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router; 