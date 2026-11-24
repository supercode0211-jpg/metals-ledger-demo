import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../src/app.js";
import User from "../src/models/userModel.js";
import { PASSWORD, clearDatabase, makeUser, newKey, startDatabase, stopDatabase } from "./helpers.js";

const app = createApp();

beforeAll(startDatabase);
afterAll(stopDatabase);

let holderToken: string;
let adminToken: string;

async function login(userId: string) {
  const user = await User.findById(userId).lean();
  const res = await request(app).post("/user/login").send({ email: user!.email, password: PASSWORD }).expect(200);
  return res.body.token as string;
}

beforeEach(async () => {
  await clearDatabase();
  holderToken = await login(await makeUser());
  adminToken = await login(await makeUser("admin"));
});

const asHolder = (req: request.Test) => req.set("Authorization", `Bearer ${holderToken}`);
const asAdmin = (req: request.Test) => req.set("Authorization", `Bearer ${adminToken}`);

const ask = (body: object, key = newKey()) =>
  asHolder(request(app).post("/api/requests")).set("Idempotency-Key", key).send(body);

const goldOf = async () => {
  const res = await asHolder(request(app).get("/api/holdings")).expect(200);
  return res.body.data.find((row: { metal: string }) => row.metal === "gold");
};

describe("access", () => {
  it("needs a valid token", async () => {
    await request(app).get("/api/holdings").expect(401);
    await request(app).get("/api/holdings").set("Authorization", "Bearer nope").expect(401);
  });

  it("keeps holders out of admin routes", async () => {
    const res = await asHolder(request(app).get("/api/admin/requests")).expect(403);
    expect(res.body).toMatchObject({ success: false, code: "FORBIDDEN" });
  });

  it("rejects a wrong password without saying which part was wrong", async () => {
    const res = await request(app).post("/user/login").send({ email: "nobody@test.local", password: "x" }).expect(401);
    expect(res.body.message).toBe("Invalid email or password");
  });
});

describe("input", () => {
  it("requires an Idempotency-Key", async () => {
    const res = await asHolder(request(app).post("/api/requests"))
      .send({ type: "deposit", metal: "gold", grams: "1" })
      .expect(400);
    expect(res.body.message).toMatch(/Idempotency-Key/);
  });

  it("only takes grams as exact decimal strings", async () => {
    await ask({ type: "deposit", metal: "gold", grams: 12.5 }).expect(400);
    await ask({ type: "deposit", metal: "gold", grams: "1.2345" }).expect(400);
    await ask({ type: "deposit", metal: "gold", grams: "-1" }).expect(400);
    await ask({ type: "deposit", metal: "palladium", grams: "1" }).expect(400);
    await ask({ type: "deposit", metal: "gold", grams: "1", amountMg: 5 }).expect(400);

    const zero = await ask({ type: "deposit", metal: "gold", grams: "0" }).expect(400);
    expect(zero.body.code).toBe("INVALID_AMOUNT");
  });
});

describe("holder path over HTTP", () => {
  it("deposit -> approve -> withdraw -> reject, with history and ledger", async () => {
    const deposit = await ask({ type: "deposit", metal: "gold", grams: "100" }).expect(201);
    expect(deposit.body.data).toMatchObject({ status: "pending", grams: "100.000" });

    await asAdmin(request(app).post(`/api/admin/requests/${deposit.body.data.id}/approve`)).expect(200);
    expect(await goldOf()).toMatchObject({ available: "100.000", held: "0.000", total: "100.000" });

    const key = newKey();
    const withdrawal = await ask({ type: "withdrawal", metal: "gold", grams: "40.5" }, key).expect(201);
    expect(await goldOf()).toMatchObject({ available: "59.500", held: "40.500", total: "100.000" });

    // A retry with the same key gets the same request back, nothing held twice.
    const retry = await ask({ type: "withdrawal", metal: "gold", grams: "40.5" }, key).expect(200);
    expect(retry.body).toMatchObject({ replayed: true, data: { id: withdrawal.body.data.id } });
    expect(await goldOf()).toMatchObject({ held: "40.500" });

    const queue = await asAdmin(request(app).get("/api/admin/requests")).expect(200);
    expect(queue.body.data).toHaveLength(1);
    expect(queue.body.data[0].user.email).toMatch(/@test\.local$/);

    await asAdmin(request(app).post(`/api/admin/requests/${withdrawal.body.data.id}/reject`))
      .send({ reason: "Please confirm your bank details" })
      .expect(200);
    expect(await goldOf()).toMatchObject({ available: "100.000", held: "0.000" });

    const history = await asHolder(request(app).get("/api/requests")).expect(200);
    expect(history.body.data.map((r: { status: string }) => r.status)).toEqual(["rejected", "completed"]);

    const ledger = await asHolder(request(app).get("/api/ledger")).expect(200);
    expect(ledger.body.data.map((e: { kind: string }) => e.kind)).toEqual(["release", "hold", "deposit_credit"]);

    const recon = await asAdmin(request(app).get("/api/admin/reconciliation")).expect(200);
    expect(recon.body.data).toMatchObject({ ok: true, issues: [] });
  });

  it("asks for a reason when rejecting", async () => {
    const deposit = await ask({ type: "deposit", metal: "gold", grams: "1" }).expect(201);
    await asAdmin(request(app).post(`/api/admin/requests/${deposit.body.data.id}/reject`)).send({}).expect(400);
  });

  it("answers 409 when the metal isn't there", async () => {
    const res = await ask({ type: "redemption", metal: "silver", grams: "100" }).expect(409);
    expect(res.body).toMatchObject({ success: false, code: "INSUFFICIENT_BALANCE" });
  });
});

describe("proof of reserve", () => {
  it("shows real liabilities and no made-up reserves", async () => {
    const deposit = await ask({ type: "deposit", metal: "platinum", grams: "45.2" }).expect(201);
    await asAdmin(request(app).post(`/api/admin/requests/${deposit.body.data.id}/approve`)).expect(200);

    const res = await asHolder(request(app).get("/api/proof-of-reserve")).expect(200);
    expect(res.body.data.status).toBe("awaiting_provider");
    expect(res.body.data.metals).toContainEqual({ metal: "platinum", liabilities: "45.200", reserves: null, coverage: null });
  });
});
