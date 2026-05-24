import { Router } from "express";
import { authenticate, requireParent } from "../middleware/auth.js";
import prisma from "../lib/prisma.js";
const router = Router();

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
    const doerId = task.claimedById||task.assignedToId;
    if (doerId) {
      const doer = await prisma.user.findUnique({ where:{ id:doerId } });
      if (doer?.role==="child") {
        const delta = done?task.starsReward:-task.starsReward;
        await prisma.user.update({ where:{ id:doerId }, data:{ totalStars:{ increment:delta }, weeklyStars:{ increment:delta } } });
        await prisma.starsLog.create({ data:{ userId:doerId, delta, reason:"task_completed", referenceId:task.id } });
      }
    }
    res.json({ success:true, done });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id/approve", authenticate, requireParent, async (req, res) => {
  try {
    const task = await prisma.task.update({ where:{ id:req.params.id }, data:{ status:"open", approvedAt:new Date() } });
    res.json(task);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/:id/reject", authenticate, requireParent, async (req, res) => {
  try {
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
