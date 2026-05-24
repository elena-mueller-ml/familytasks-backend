import { Router } from "express";
import { authenticate, requireParent } from "../middleware/auth.js";
import prisma from "../lib/prisma.js";
const router = Router();

router.get("/", authenticate, async (req, res) => {
  try {
    const rewards = await prisma.reward.findMany({ where:{ familyId:req.user.familyId }, include:{ redemptions:true } });
    res.json(rewards);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.post("/", authenticate, requireParent, async (req, res) => {
  try {
    const { name,icon,starsRequired,forUserId } = req.body;
    const reward = await prisma.reward.create({ data:{ familyId:req.user.familyId, name, icon:icon||"🎁", starsRequired, forUserId } });
    res.json(reward);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.post("/:id/redeem", authenticate, async (req, res) => {
  try {
    const reward = await prisma.reward.findUnique({ where:{ id:req.params.id } });
    if (!reward) return res.status(404).json({ error:"Nicht gefunden" });
    const user = await prisma.user.findUnique({ where:{ id:req.user.id } });
    if ((user?.totalStars||0) < reward.starsRequired) return res.status(400).json({ error:"Nicht genug Sterne" });
    const redemption = await prisma.rewardRedemption.create({ data:{ rewardId:reward.id, userId:req.user.id } });
    await prisma.user.update({ where:{ id:req.user.id }, data:{ totalStars:{ decrement:reward.starsRequired } } });
    await prisma.starsLog.create({ data:{ userId:req.user.id, delta:-reward.starsRequired, reason:"reward_redeemed", referenceId:reward.id } });
    res.json(redemption);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.patch("/redemptions/:id/confirm", authenticate, requireParent, async (req, res) => {
  try {
    const r = await prisma.rewardRedemption.update({ where:{ id:req.params.id }, data:{ confirmedByParent:true, confirmedAt:new Date() } });
    res.json(r);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.get("/stars/:userId", authenticate, async (req, res) => {
  try {
    const logs = await prisma.starsLog.findMany({ where:{ userId:req.params.userId }, orderBy:{ createdAt:"desc" }, take:50 });
    res.json(logs);
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

export default router;
