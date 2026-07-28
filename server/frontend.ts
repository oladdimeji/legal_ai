import express, { type Express } from "express";
import path from "node:path";

export function registerProductionFrontend(app: Express, distPath: string): void {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}
