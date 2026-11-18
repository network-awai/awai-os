import assert from "node:assert/strict";
import { test } from "node:test";
import { createApprovalClient } from "../client.js";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const WALLET = "0x4a62316623ad457f02cdc5d997ded67a383ec569";
const SIG = `0x${"ab".repeat(65)}`;
const LAUNCH = { assignmentId: "assignment-isic6399-20261118-a1b2c3", businessId: "cloud-itonami-isic-6399", creditLimitMicros: 10000, walletAddress: WALLET };
const client = (answer, seen = []) => createApprovalClient({ uuid: () => ID, invoke: async (cmd, { request }) => { seen.push([cmd, request]); return answer(request); } });

test("asks only through awai_key_approval with the typed request", async () => {
  const seen = [];
  assert.equal(await client((r) => ({ schema: "awai.approval.result.v1", requestId: r.requestId, walletAddress: WALLET }), seen).botWalletAddress(), WALLET);
  assert.deepEqual(seen, [["awai_key_approval", { schema: "awai.approval.request.v1", requestId: ID, walletId: "default", kind: "itonami.bot-wallet.address" }]]);
  const signed = await client((r) => ({ schema: "awai.approval.result.v1", requestId: r.requestId, walletAddress: WALLET, walletSignature: SIG })).signBotLaunch(LAUNCH);
  assert.deepEqual(signed, { wallet_address: WALLET, wallet_signature: SIG });
});

test("refuses bad input before asking, and answers that do not match", async () => {
  const never = client(() => assert.fail("must not ask"));
  for (const bad of [{ ...LAUNCH, creditLimitMicros: 999 }, { ...LAUNCH, walletAddress: WALLET.toUpperCase() }, { ...LAUNCH, assignmentId: "x\nAction: y" }]) {
    await assert.rejects(never.signBotLaunch(bad), /invalid-launch/);
  }
  await assert.rejects(never.botWalletAddress("../x"), /invalid-wallet-id/);
  await assert.rejects(client((r) => ({ schema: "awai.approval.result.v1", requestId: "other", walletAddress: WALLET })).botWalletAddress(), /invalid-approval-result/);
  await assert.rejects(client((r) => ({ schema: "awai.approval.result.v1", requestId: r.requestId, walletAddress: `0x${"1".repeat(40)}`, walletSignature: SIG })).signBotLaunch(LAUNCH), /invalid-approval-result/);
  await assert.rejects(createApprovalClient({ invoke: undefined }).botWalletAddress(), /key-approval-unavailable/);
});

test("a refusal from the Awai app is passed on, not replaced by another signer", async () => {
  await assert.rejects(client(() => { throw new Error("denied"); }).signBotLaunch(LAUNCH), /denied/);
});
