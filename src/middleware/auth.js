import jwt from "jsonwebtoken";
export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return res.status(401).json({ error:"Nicht autorisiert" });
  try {
    req.user = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    next();
  } catch { res.status(401).json({ error:"Ungültiger Token" }); }
}
export function requireParent(req, res, next) {
  if (req.user?.role !== "parent") return res.status(403).json({ error:"Nur für Eltern" });
  next();
}
