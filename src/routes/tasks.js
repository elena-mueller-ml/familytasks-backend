import { Router } from "express";
import { authenticate, requireParent } from "../middleware/auth.js";
import prisma from "../lib/prisma.js";
const router = Router();

function getISOWeekYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function isDoubleStarDay(family, today) {
  if (family.doubleStarActive && family.doubleStarActiveDate === today) return true;
  const days = JSON.parse(family.doubleStarDays || "[]");
  const jsDay = new Date().getDay();
  const appDay = jsDay === 0 ? 6 : jsDay - 1;
  return days.includes(appDay);
}

function daysBetween(dateStr1, dateStr2) {
  if (!dateStr1 || !dateStr2) return Infinity;
  const d1 = new Date(dateStr1);
  const d2 = new Date(dateStr2);
  return Math.round((d2 - d1) / (1000 * 60 * 60 * 24));
}

router.get("/", authenticate, async (req, res) => {
  try {
    const tasks = await prisma.task.findMany({
      where:{ familyId:req.user.familyId },
      include:{ assignedTo:{ select:{ id:true,name:true } }, createdBy:{ select:{ id:true,name:true } } },
      orderBy:{ createdAt:"desc" }
    });
    res.json(tasks);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.post("/", authenticate, async (req, res) => {
  try {
    const { title,category,starsReward,assignedToId,recurrenceType,recurrenceDays,recurrenceDay,isChildSuggestion } = req.body;
    const task = await prisma.task.create({ data:{
      familyId:req.user.familyId, title, category:category||"wohnen",
      starsReward:starsReward||2, assignedToId:assignedToId||null,
      createdById:req.user.id, status:isChildSuggestion?"pending_approval":"open",
      isChildSuggestion:!!isChildSuggestion, recurrenceType:recurrenceType||"once",
      recurrenceDays:recurrenceDays?JSON.stringify(recurrenceDays):null, recurrenceDay:recurrenceDay||null,
    }});
    res.json(task);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id/complete", authenticate, async (req, res) => {
  try {
    const task = await prisma.task.findUnique({ where:{ id:req.params.id } });
    if (!task||task.familyId!==req.user.familyId) return res.status(404).json({ error:"Nicht gefunden" });
    const today = new Date().toISOString().split("T")[0];
    const done  = task.status !== "done";
    await prisma.task.update({ where:{ id:task.id }, data:{ status:done?"done":"open", lastDoneDate:done?today:null } });

    const doerId = task.claimedById || task.assignedToId;
    let doubleBonus = false;
    let streakInfo = null;

    if (doerId) {
      const doer = await prisma.user.findUnique({ where:{ id:doerId } });
      if (doer?.role === "child") {
        const family = await prisma.family.findUnique({ where:{ id:task.familyId } });

        doubleBonus = done && isDoubleStarDay(family, today);
        const baseStars = task.starsReward;
        const effectiveStars = doubleBonus ? baseStars * 2 : baseStars;
        const delta = done ? effectiveStars : -baseStars;

        const currentWeekYear = getISOWeekYear(new Date());
        const weeklyReset = doer.weekYear !== currentWeekYear;

        let newStreak = doer.currentStreak;
        let newLastStreakDate = doer.lastStreakDate;
        let usedFreeze = false;

        if (done) {
          if (doer.lastStreakDate === today) {
            // already completed something today — streak unchanged
          } else {
            const days = daysBetween(doer.lastStreakDate, today);
            if (days === 1) {
              newStreak = doer.currentStreak + 1;
            } else if (days === 2 && doer.streakFreezes > 0) {
              newStreak = doer.currentStreak + 1;
              usedFreeze = true;
            } else {
              newStreak = 1;
            }
            newLastStreakDate = today;
          }
        }

        streakInfo = { streak: newStreak, usedFreeze, streakFreezes: doer.streakFreezes - (usedFreeze ? 1 : 0) };

        const newTotal   = Math.max(0, (doer.totalStars   || 0) + delta);
        const newWeekly  = weeklyReset && done  ? effectiveStars
                         : weeklyReset && !done ? 0
                         : Math.max(0, (doer.weeklyStars || 0) + delta);

        await prisma.user.update({
          where: { id: doerId },
          data: {
            totalStars:    newTotal,
            weeklyStars:   newWeekly,
            weekYear:      currentWeekYear,
            currentStreak: newStreak,
            lastStreakDate: newLastStreakDate,
            ...(usedFreeze ? { streakFreezes: { decrement: 1 } } : {}),
          }
        });

        await prisma.starsLog.create({
          data: {
            userId: doerId, delta,
            reason: doubleBonus ? "task_completed_double" : "task_completed",
            referenceId: task.id, weekYear: currentWeekYear,
          }
        });
      }
    }
    res.json({ success:true, done, doubleBonus, streakInfo });
  } catch(e) { console.error(e); res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id/approve", authenticate, requireParent, async (req, res) => {
  try {
    const { starsReward } = req.body;
    const data = { status:"open", approvedAt:new Date() };
    if (starsReward) data.starsReward = parseInt(starsReward);
    const task = await prisma.task.update({ where:{ id:req.params.id }, data });
    res.json(task);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id/reject", authenticate, requireParent, async (req, res) => {
  try {
    await prisma.task.delete({ where:{ id:req.params.id } });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id/unclaim", authenticate, async (req, res) => {
  try {
    const task = await prisma.task.findUnique({ where:{ id:req.params.id } });
    if (!task||task.familyId!==req.user.familyId) return res.status(404).json({ error:"Nicht gefunden" });
    if (task.claimedById !== req.user.id) return res.status(403).json({ error:"Nicht deine Aufgabe" });
    await prisma.task.update({ where:{ id:req.params.id }, data:{ claimedById:null, status:"open" } });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id/favorite", authenticate, async (req, res) => {
  try {
    const task = await prisma.task.findUnique({ where:{ id:req.params.id } });
    if (!task||task.familyId!==req.user.familyId) return res.status(404).json({ error:"Nicht gefunden" });
    await prisma.task.update({ where:{ id:req.params.id }, data:{ isFavorite:!task.isFavorite } });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id", authenticate, requireParent, async (req, res) => {
  try {
    const { title, category, starsReward, assignedToId, recurrenceType, recurrenceDays, recurrenceDay } = req.body;
    const task = await prisma.task.findUnique({ where:{ id:req.params.id } });
    if (!task||task.familyId!==req.user.familyId) return res.status(404).json({ error:"Nicht gefunden" });
    const updated = await prisma.task.update({ where:{ id:req.params.id }, data:{
      ...(title!==undefined && { title }),
      ...(category!==undefined && { category }),
      ...(starsReward!==undefined && { starsReward:parseInt(starsReward) }),
      ...(assignedToId!==undefined && { assignedToId:assignedToId||null }),
      ...(recurrenceType!==undefined && { recurrenceType }),
      ...(recurrenceDays!==undefined && { recurrenceDays:JSON.stringify(recurrenceDays) }),
      ...(recurrenceDay!==undefined && { recurrenceDay }),
    }});
    res.json(updated);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.delete("/:id", authenticate, requireParent, async (req, res) => {
  try {
    const task = await prisma.task.findUnique({ where:{ id:req.params.id } });
    if (!task||task.familyId!==req.user.familyId) return res.status(404).json({ error:"Nicht gefunden" });
    await prisma.task.delete({ where:{ id:req.params.id } });
    res.json({ success:true });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id/claim", authenticate, async (req, res) => {
  try {
    const task = await prisma.task.findUnique({ where:{ id:req.params.id } });
    if (!task||task.status!=="open"||task.assignedToId!==null) return res.status(400).json({ error:"Nicht verfügbar" });
    const updated = await prisma.task.update({ where:{ id:req.params.id }, data:{ claimedById:req.user.id, status:"claimed" } });
    res.json(updated);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

export default router;
