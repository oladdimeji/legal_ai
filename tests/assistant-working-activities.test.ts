import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWorkingActivityIndex,
  buildAssistantWorkingActivities,
  visibleAssistantWorkingActivities,
} from "../src/lib/assistantWorkingActivities.js";

test("normal Assistant requests use response activity and completion labels", () => {
  assert.deepEqual(
    buildAssistantWorkingActivities({ hasAttachments: false, requestMode: "general" }),
    [
      {
        activeLabel: "Understanding your request…",
        completedLabel: "Request understood",
      },
      {
        activeLabel: "Checking the relevant context…",
        completedLabel: "Relevant context checked",
      },
      {
        activeLabel: "Preparing the response…",
        completedLabel: "Response prepared",
      },
      {
        activeLabel: "Refining the response…",
        completedLabel: "Response refined",
      },
    ]
  );
});

test("attachment requests insert document review immediately after context", () => {
  const activities = buildAssistantWorkingActivities({
    hasAttachments: true,
    requestMode: "workspace_research",
  });

  assert.deepEqual(
    activities.map(({ activeLabel, completedLabel }) => [activeLabel, completedLabel]),
    [
      ["Understanding your request…", "Request understood"],
      ["Checking the relevant context…", "Relevant context checked"],
      ["Reviewing attached documents…", "Attached documents reviewed"],
      ["Preparing the response…", "Response prepared"],
      ["Refining the response…", "Response refined"],
    ]
  );
});

test("draft requests use document wording", () => {
  const activities = buildAssistantWorkingActivities({
    hasAttachments: false,
    requestMode: "draft",
  });

  assert.deepEqual(
    activities.slice(-2),
    [
      {
        activeLabel: "Preparing the document…",
        completedLabel: "Document prepared",
      },
      {
        activeLabel: "Refining the document…",
        completedLabel: "Document refined",
      },
    ]
  );
});

test("working activity progression is forward-only and remains at the final stage", () => {
  const activityCount = 4;
  let currentIndex = 0;
  const visited: number[] = [];

  for (let step = 0; step < 20; step += 1) {
    currentIndex = advanceWorkingActivityIndex(currentIndex, activityCount);
    visited.push(currentIndex);
  }

  assert.deepEqual(visited.slice(0, 4), [1, 2, 3, 3]);
  assert.equal(visited.includes(0), false);
  assert.equal(currentIndex, activityCount - 1);
  for (let step = 0; step < 100; step += 1) {
    currentIndex = advanceWorkingActivityIndex(currentIndex, activityCount);
  }
  assert.equal(currentIndex, activityCount - 1);
});

test("visible activities contain completed rows followed by one active row", () => {
  const activities = buildAssistantWorkingActivities({
    hasAttachments: false,
    requestMode: "general",
  });
  const visible = visibleAssistantWorkingActivities(activities, 2);

  assert.deepEqual(
    visible.map(({ label, isCompleted }) => ({ label, isCompleted })),
    [
      { label: "Request understood", isCompleted: true },
      { label: "Relevant context checked", isCompleted: true },
      { label: "Preparing the response…", isCompleted: false },
    ]
  );
  assert.equal(visible.filter(({ isCompleted }) => !isCompleted).length, 1);
});
