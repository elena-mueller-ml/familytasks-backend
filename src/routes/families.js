import { Router } from "express";
import { authenticate, requireParent } from "../middleware/auth.js";
import prisma from "../lib/prisma.js";
const router = Router();

router.get("/me", authenticate, async (req, res) => {
  try {
    const family = await prisma.family.findUnique({
      where:{ id:req.user.familyId },
      include:{ members:{ select:{ id:true,name:true,role:true,totalStars:true,weeklyStars:true,avatarColor:true } } }
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

export default router;
