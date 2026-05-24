import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import prisma from "../lib/prisma.js";
const router = Router();

function makeToken(user) {
  return jwt.sign({ id:user.id, familyId:user.familyId, role:user.role, name:user.name }, process.env.JWT_SECRET, { expiresIn:"30d" });
}
function makeInviteCode() {
  const words = ["MUELLER","WEBER","SCHMIDT","BRAUN","KLEIN","BAUER","FISCHER"];
  return `${words[Math.floor(Math.random()*words.length)]}-${Math.floor(1000+Math.random()*9000)}`;
}

router.post("/create-family", async (req, res) => {
  try {
    const { familyName, parentName, pin } = req.body;
    if (!familyName||!parentName||!pin) return res.status(400).json({ error:"familyName, parentName und pin erforderlich" });
    const pinHash = await bcrypt.hash(pin, 10);
    const family  = await prisma.family.create({
      data: { name:familyName, inviteCode:makeInviteCode(), members:{ create:{ name:parentName, role:"parent", pin:pinHash } } },
      include:{ members:true }
    });
    const parent = family.members[0];
    res.json({ token:makeToken(parent), user:{ id:parent.id, name:parent.name, role:parent.role, familyId:family.id }, family:{ id:family.id, name:family.name, inviteCode:family.inviteCode } });
  } catch(e) { console.error(e); res.status(500).json({ error:"Serverfehler" }); }
});

router.post("/join-family", async (req, res) => {
  try {
    const { inviteCode, childName, pin } = req.body;
    if (!inviteCode||!childName||!pin) return res.status(400).json({ error:"inviteCode, childName und pin erforderlich" });
    const family = await prisma.family.findUnique({ where:{ inviteCode } });
    if (!family) return res.status(404).json({ error:"Familie nicht gefunden. Code prüfen!" });
    const pinHash = await bcrypt.hash(pin, 10);
    const child   = await prisma.user.create({ data:{ familyId:family.id, name:childName, role:"child", pin:pinHash } });
    res.json({ token:makeToken(child), user:{ id:child.id, name:child.name, role:child.role, familyId:family.id }, family:{ id:family.id, name:family.name } });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.get("/family/:inviteCode/members", async (req, res) => {
  try {
    const family = await prisma.family.findUnique({
      where: { inviteCode: req.params.inviteCode.toUpperCase() },
      include: { members: { select: { id:true, name:true, role:true } } },
    });
    if (!family) return res.status(404).json({ error:"Familie nicht gefunden. Code prüfen!" });
    res.json({ familyName: family.name, members: family.members });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

router.post("/login", async (req, res) => {
  try {
    const { userId, pin } = req.body;
    if (!userId||!pin) return res.status(400).json({ error:"userId und pin erforderlich" });
    const user = await prisma.user.findUnique({ where:{ id:userId } });
    if (!user) return res.status(404).json({ error:"Nutzer nicht gefunden" });
    if (!await bcrypt.compare(pin, user.pin||"")) return res.status(401).json({ error:"Falscher PIN" });
    res.json({ token:makeToken(user), user:{ id:user.id, name:user.name, role:user.role, familyId:user.familyId } });
  } catch(e) { res.status(500).json({ error:"Serverfehler" }); }
});

export default router;
