import { Router } from "express";
import { authenticate, requireParent } from "../middleware/auth.js";
import prisma from "../lib/prisma.js";
const router = Router();

const MEMBER_SELECT = {
  id:true, name:true, role:true,
  totalStars:true, weeklyStars:true, avatarColor:true,
  currentStreak:true, lastStreakDate:true, streakFreezes:true,
};

router.get("/me", authenticate, async (req, res) => {
  try {
    const family = await prisma.family.findUnique({
      where: { id: req.user.familyId },
      include: { members: { select: MEMBER_SELECT } }
    });
    if (!family) return res.status(404).json({ error:"Familie nicht gefunden" });
    res.json(family);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.delete("/members/:userId", authenticate, requireParent, async (req, res) => {
  try {
    const { userId } = req.params;
    if (userId === req.user.id) return res.status(400).json({ error:"Du kannst dich nicht selbst entfernen" });
    const member = await prisma.user.findUnique({ where:{ id:userId } });
    if (!member || member.familyId !== req.user.familyId)
      return res.status(404).json({ error:"Mitglied nicht gefunden" });
    await prisma.user.delete({ where:{ id:userId } });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/reward-mode", authenticate, requireParent, async (req, res) => {
  try {
    const { mode } = req.body;
    if (!["praemien","liga"].includes(mode)) return res.status(400).json({ error:"Ungültiger Modus" });
    const f = await prisma.family.update({ where:{ id:req.user.familyId }, data:{ rewardMode:mode } });
    res.json({ rewardMode:f.rewardMode });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

// Feste Doppelstern-Wochentage setzen (0=Mo, 1=Di, …, 6=So)
router.patch("/double-star-days", authenticate, requireParent, async (req, res) => {
  try {
    const { days } = req.body;
    if (!Array.isArray(days) || days.length > 1) return res.status(400).json({ error:"Maximal ein Doppelstern-Tag pro Woche erlaubt" });
    const f = await prisma.family.update({
      where: { id: req.user.familyId },
      data: { doubleStarDays: JSON.stringify(days) }
    });
    res.json({ doubleStarDays: JSON.parse(f.doubleStarDays) });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

// Manuellen Doppelstern-Boost für heute an/aus
router.patch("/double-star-toggle", authenticate, requireParent, async (req, res) => {
  try {
    const today = new Date().toISOString().split("T")[0];
    const family = await prisma.family.findUnique({ where:{ id:req.user.familyId } });
    const isActiveToday = family.doubleStarActive && family.doubleStarActiveDate === today;
    const f = await prisma.family.update({
      where: { id: req.user.familyId },
      data: { doubleStarActive: !isActiveToday, doubleStarActiveDate: isActiveToday ? "" : today }
    });
    res.json({ doubleStarActive: f.doubleStarActive, doubleStarActiveDate: f.doubleStarActiveDate });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

// Streak-Schutz (Eis) an ein Kind schenken
router.patch("/members/:userId/streak-freeze", authenticate, requireParent, async (req, res) => {
  try {
    const { userId } = req.params;
    const member = await prisma.user.findUnique({ where:{ id:userId } });
    if (!member || member.familyId !== req.user.familyId)
      return res.status(404).json({ error:"Mitglied nicht gefunden" });
    if (!member.isChild && member.role !== "child")
      return res.status(400).json({ error:"Nur für Kinder" });
    const updated = await prisma.user.update({
      where:{ id:userId },
      data:{ streakFreezes: { increment:1 } }
    });
    res.json({ streakFreezes: updated.streakFreezes });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

export default router;
