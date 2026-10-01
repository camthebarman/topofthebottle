import { expect, test, type Browser, type Page } from "@playwright/test";
import { expectNoHorizontalScroll, expectSaved, shot, signInSeeded } from "./helpers";

// Flows not covered by the main journey, run against the seeded demo organization.
async function signedIn(browser: Browser, email: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: test.info().project.use.viewport, baseURL: test.info().project.use.baseURL });
  const p = await ctx.newPage();
  p.on("dialog", (d) => void d.accept());
  await signInSeeded(p, email);
  return p;
}

const tag = () => Math.random().toString(36).slice(2, 7);

test("bar book: managers-only notes are hidden from staff; tasks carry forward until resolved", async ({ browser }) => {
  const manager = await signedIn(browser, "manager@demo.test");
  const staff = await signedIn(browser, "bartender@demo.test");
  const t = tag();

  await manager.goto("/barbook");
  await manager.getByText("Write an entry").click();
  await manager.getByLabel("Title").fill(`Staffing note ${t}`);
  await manager.getByLabel("Details").fill("Discuss rota changes privately.");
  await manager.getByLabel("Who can see it").selectOption("managers");
  await manager.getByRole("button", { name: "Post" }).click();
  await manager.waitForURL(/barbook\/[0-9a-f-]{36}\?saved=1/);
  const privateUrl = manager.url().replace(/\?.*$/, "");
  await expect(manager.getByText("managers only", { exact: true }).first()).toBeVisible();

  await staff.goto("/barbook");
  await expect(staff.getByText(`Staffing note ${t}`)).toHaveCount(0);
  await staff.goto(privateUrl);
  await expect(staff.getByText("Discuss rota changes privately.")).toHaveCount(0);

  await manager.goto("/barbook");
  await manager.getByText("Write an entry").click();
  await manager.getByLabel("Title").fill(`Fix ice machine ${t}`);
  await manager.getByLabel("Category").selectOption("equipment");
  await manager.getByLabel("This is a task to follow up").check();
  await manager.getByLabel("Assign to").selectOption({ label: "Bea Bartender" });
  await manager.getByRole("button", { name: "Post" }).click();
  await manager.waitForURL(/barbook\/[0-9a-f-]{36}\?saved=1/);
  const taskUrl = manager.url().replace(/\?.*$/, "");

  await staff.goto("/barbook");
  await expect(staff.getByRole("link", { name: `Fix ice machine ${t}` })).toBeVisible();
  await expectNoHorizontalScroll(staff);
  await staff.goto(taskUrl);
  await staff.getByLabel("Resolution (optional)").fill("Called the technician; fixed.");
  await staff.getByRole("button", { name: "Mark resolved" }).click();
  await expectSaved(staff, "Resolved");
  await staff.reload();
  await expect(staff.getByText("resolved").first()).toBeVisible();
});

test("schedule: overlapping assignments block publishing", async ({ browser }) => {
  const manager = await signedIn(browser, "manager@demo.test");
  const name = `Olive ${tag()}`;
  await manager.goto("/schedule");
  await manager.getByLabel("Name", { exact: true }).fill(name);
  await manager.getByRole("button", { name: "Add staff" }).click();
  await expectSaved(manager, /Staff added/);
  await manager.reload();
  for (const [start, end] of [["16:00", "22:00"], ["20:00", "23:30"]]) {
    await manager.getByLabel("Who").selectOption({ label: name });
    await manager.getByLabel("Start").fill(start);
    await manager.getByLabel("End").fill(end);
    await manager.getByRole("button", { name: "Add shift" }).click();
    await expectSaved(manager, /Shift added|Saved|added/);
    await manager.reload();
  }
  await expect(manager.getByText(/overlapping assignment\(s\) must be fixed first/)).toBeVisible();
  await expectNoHorizontalScroll(manager);
});

test("event: stock is only moved by explicit send and return; prep sheet prints", async ({ browser }) => {
  const owner = await signedIn(browser, "owner@demo.test");
  await owner.goto("/events");
  await owner.getByText("Plan a new event").click();
  await owner.getByLabel("Event name").fill(`Garden party ${tag()}`);
  await owner.getByLabel("Guests", { exact: true }).fill("40");
  await owner.getByLabel("Hours", { exact: true }).fill("2");
  await owner.getByLabel("Cocktails %").fill("100");
  await owner.getByLabel("Beer %").fill("0");
  await owner.getByLabel("Wine %").fill("0");
  await owner.getByLabel("Non-alcoholic %").fill("0");
  await owner.getByRole("button", { name: "Create event" }).click();
  await owner.waitForURL(/events\/[0-9a-f-]{36}\?saved=1/);
  const eventUrl = owner.url().replace(/\?.*$/, "");
  await owner.getByLabel("Recipe").selectOption({ label: "Negroni" });
  await owner.getByRole("button", { name: "Add", exact: true }).click();
  await expectSaved(owner, /Saved/);
  await owner.reload();

  const form = owner.locator("form").filter({ has: owner.getByLabel("Direction") });
  await form.getByLabel("Direction").selectOption("dispatch");
  await form.getByLabel("Product").selectOption({ label: "Campari" });
  await form.getByLabel("Quantity").fill("2");
  await form.getByLabel("Unit").selectOption("container");
  await form.getByRole("button", { name: "Record" }).click();
  await expectSaved(owner, "Sent to event");
  await form.getByLabel("Direction").selectOption("return");
  await form.getByLabel("Product").selectOption({ label: "Campari" });
  await form.getByLabel("Quantity").fill("1");
  await form.getByLabel("Unit").selectOption("container");
  await form.getByRole("button", { name: "Record" }).click();
  await expectSaved(owner, "Returned to stock");
  await expectNoHorizontalScroll(owner);

  await owner.goto(`${eventUrl}/sheet`);
  await expect(owner.getByText("Negroni").first()).toBeVisible();
  await expect(owner.getByText("Campari").first()).toBeVisible();
  await expectNoHorizontalScroll(owner);
  await shot(owner, "16-event-sheet");
});
