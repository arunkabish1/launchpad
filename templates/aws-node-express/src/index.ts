import express from "express";
import serverless from "@vendia/serverless-express";

const app = express();
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({ message: "Hello from Express on AWS Lambda!" });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

export const handler = serverless({ app });
