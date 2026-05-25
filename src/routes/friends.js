import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import prisma from "../lib/prisma.js";

const router = Router();

const FRIEND_SELECT = {
  id: true, name: true, weeklyStars: true,
  totalStars: true, currentStreak: true, familyId: true,
};

async function getOrCreateFriendCode(userId, name) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (user?.friendCode) return user.friendCode;
  for (let i = 0; i < 10; i++) {
    const prefix = (name || "USR").toUpperCase().replace(/[^A-Z]/g, "X").slice(0, 3).padEnd(3, "X");
    const num    = Math.floor(1000 + Math.random() * 9000);
    const code   = `${prefix}-${num}`;
    const exists = await prisma.user.findFirst({ where: { friendCode: code } });
    if (!exists) {
      await prisma.user.update({ where: { id: userId }, data: { friendCode: code } });
      return code;
    }
  }
  const code = `USR-${Date.now().toString().slice(-4)}`;
  await prisma.user.update({ where: { id: userId }, data: { friendCode: code } });
  return code;
}

// Meinen Freundes-Code abrufen (oder erstellen)
router.get("/my-code", authenticate, async (req, res) => {
  try {
    const code = await getOrCreateFriendCode(req.user.id, req.user.name);
    res.json({ friendCode: code });
  } catch(e) { res.status(500).json({ error: "Serverfehler" }); }
});

// Freunde + ausstehende Anfragen
router.get("/", authenticate, async (req, res) => {
  try {
    const fs = await prisma.friendship.findMany({
      where: { OR: [{ senderId: req.user.id }, { receiverId: req.user.id }] },
      include: { sender: { select: FRIEND_SELECT }, receiver: { select: FRIEND_SELECT } },
    });

    const accepted        = fs.filter(f => f.status === "accepted")
      .map(f => ({ id: f.id, friend: f.senderId === req.user.id ? f.receiver : f.sender }));
    const pendingReceived = fs.filter(f => f.status === "pending" && f.receiverId === req.user.id)
      .map(f => ({ id: f.id, from: f.sender }));
    const pendingSent     = fs.filter(f => f.status === "pending" && f.senderId === req.user.id)
      .map(f => ({ id: f.id, to: f.receiver }));

    res.json({ accepted, pendingReceived, pendingSent });
  } catch(e) { res.status(500).json({ error: "Serverfehler" }); }
});

// Wochenrangliste (ich + Freunde)
router.get("/leaderboard", authenticate, async (req, res) => {
  try {
    const fs = await prisma.friendship.findMany({
      where: { OR: [{ senderId: req.user.id }, { receiverId: req.user.id }], status: "accepted" },
    });
    const friendIds = fs.map(f => f.senderId === req.user.id ? f.receiverId : f.senderId);
    const users = await prisma.user.findMany({
      where: { id: { in: [req.user.id, ...friendIds] } },
      select: { id: true, name: true, weeklyStars: true, currentStreak: true, totalStars: true },
    });
    users.sort((a, b) => (b.weeklyStars || 0) - (a.weeklyStars || 0));
    res.json(users.map((u, i) => ({ ...u, rank: i + 1, isMe: u.id === req.user.id })));
  } catch(e) { res.status(500).json({ error: "Serverfehler" }); }
});

// Freundschaftsanfrage senden
router.post("/request", authenticate, async (req, res) => {
  try {
    if (req.user.role !== "child") return res.status(400).json({ error: "Nur Kinder können Freunde hinzufügen" });
    const { friendCode } = req.body;
    if (!friendCode) return res.status(400).json({ error: "friendCode fehlt" });

    const target = await prisma.user.findFirst({ where: { friendCode: friendCode.trim().toUpperCase() } });
    if (!target)          return res.status(404).json({ error: "Kein Kind mit diesem Code gefunden" });
    if (target.id === req.user.id) return res.status(400).json({ error: "Das ist dein eigener Code" });
    if (target.role !== "child")   return res.status(400).json({ error: "Code gehört keinem Kind" });

    const existing = await prisma.friendship.findFirst({
      where: { OR: [
        { senderId: req.user.id, receiverId: target.id },
        { senderId: target.id,   receiverId: req.user.id },
      ]},
    });
    if (existing) return res.status(400).json({ error: "Anfrage bereits gesendet oder ihr seid schon Freunde" });

    const friendship = await prisma.friendship.create({
      data: { senderId: req.user.id, receiverId: target.id },
    });
    res.json({ success: true, friendship, targetName: target.name });
  } catch(e) { res.status(500).json({ error: "Serverfehler" }); }
});

// Anfrage annehmen
router.patch("/:id/accept", authenticate, async (req, res) => {
  try {
    const f = await prisma.friendship.findUnique({ where: { id: req.params.id } });
    if (!f || f.receiverId !== req.user.id) return res.status(403).json({ error: "Nicht berechtigt" });
    if (f.status !== "pending")             return res.status(400).json({ error: "Nicht mehr ausstehend" });
    const updated = await prisma.friendship.update({ where: { id: req.params.id }, data: { status: "accepted" } });
    res.json(updated);
  } catch(e) { res.status(500).json({ error: "Serverfehler" }); }
});

// Freundschaft entfernen/ablehnen (Kind selbst oder Elternteil)
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const f = await prisma.friendship.findUnique({
      where: { id: req.params.id },
      include: { sender: { select: { familyId: true } }, receiver: { select: { familyId: true } } },
    });
    if (!f) return res.status(404).json({ error: "Nicht gefunden" });

    const isInvolved       = f.senderId === req.user.id || f.receiverId === req.user.id;
    const isParentInvolved = req.user.role === "parent" && (
      f.sender.familyId === req.user.familyId || f.receiver.familyId === req.user.familyId
    );
    if (!isInvolved && !isParentInvolved) return res.status(403).json({ error: "Nicht berechtigt" });

    await prisma.friendship.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: "Serverfehler" }); }
});

// Eltern: Freundschaften eines Kindes einsehen
router.get("/child/:userId", authenticate, async (req, res) => {
  try {
    if (req.user.role !== "parent") return res.status(403).json({ error: "Nur für Eltern" });
    const child = await prisma.user.findUnique({ where: { id: req.params.userId } });
    if (!child || child.familyId !== req.user.familyId) return res.status(404).json({ error: "Kind nicht gefunden" });

    const fs = await prisma.friendship.findMany({
      where: { OR: [{ senderId: child.id }, { receiverId: child.id }] },
      include: { sender: { select: { id: true, name: true } }, receiver: { select: { id: true, name: true } } },
    });
    res.json(fs.map(f => ({
      id:        f.id,
      status:    f.status,
      direction: f.senderId === child.id ? "sent" : "received",
      friend:    f.senderId === child.id ? f.receiver : f.sender,
    })));
  } catch(e) { res.status(500).json({ error: "Serverfehler" }); }
});

export default router;
