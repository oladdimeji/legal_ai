import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceWorkingActivityIndex,
  buildAssistantWorkingActivities,
  visibleAssistantWorkingActivities,
} from "../src/lib/assistantWorkingActivities.js";

test("Assistant requests use neutral activity and completion labels", () => {
  assert.deepEqual(
    buildAssistantWorkingActivities({ hasAttachments: false }),
    [
      {
        activeLabel: "Understanding your request…",
        completedLabel: "Request understood",
      },
      {
        activeLabel: "Checking the conversation and current context…",
        completedLabel: "Conversation and context checked",
      },
      {
        activeLabel: "Working with the relevant information…",
        completedLabel: "Relevant information reviewed",
      },
      {
        activeLabel: "Preparing the response…",
        completedLabel: "Response prepared",
      },
    ]
  );
});

test("attachment requests insert document review immediately after context", () => {
  const activities = buildAssistantWorkingActivities({
    hasAttachments: true,
  });

  assert.deepEqual(
    activities.map(({ activeLabel, completedLabel }) => [activeLabel, completedLabel]),
    [
      ["Understanding your request…", "Request understood"],
      ["Checking the conversation and current context…", "Conversation and context checked"],
      ["Reviewing attached research sources…", "Research sources reviewed"],
      ["Working with the relevant information…", "Relevant information reviewed"],
      ["Preparing the response…", "Response prepared"],
    ]
  );
});

test("working activities do not predict document creation or web research", () => {
  const labels = buildAssistantWorkingActivities({ hasAttachments: false })
    .flatMap((activity) => [activity.activeLabel, activity.completedLabel])
    .join(" ");
  assert.doesNotMatch(labels, /document|draft|web|search/i);
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
  });
  const visible = visibleAssistantWorkingActivities(activities, 2);

  assert.deepEqual(
    visible.map(({ label, isCompleted }) => ({ label, isCompleted })),
    [
      { label: "Request understood", isCompleted: true },
      { label: "Conversation and context checked", isCompleted: true },
      { label: "Working with the relevant information…", isCompleted: false },
    ]
  );
  assert.equal(visible.filter(({ isCompleted }) => !isCompleted).length, 1);
});
