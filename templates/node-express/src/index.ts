import { httpServerHandler } from "cloudflare:node";
import express from "express";

const app = express();

app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Hello from __PROJECT_NAME__!" });
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.get("/echo", (req, res) => {
  res.json({ query: req.query });
});

app.listen(3000);

export default httpServerHandler({ port: 3000 });
