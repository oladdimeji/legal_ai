import type { AssistantRequestMode } from "./assistantRequestRouting";

export type WorkingActivity = {
  activeLabel: string;
  completedLabel: string;
};

export type VisibleWorkingActivity = WorkingActivity & {
  isCompleted: boolean;
  label: string;
};

export function buildAssistantWorkingActivities({
  hasAttachments,
  requestMode,
}: {
  hasAttachments: boolean;
  requestMode: AssistantRequestMode;
}): WorkingActivity[] {
  const activities: WorkingActivity[] = [
    {
      activeLabel: "Understanding your request…",
      completedLabel: "Request understood",
    },
    {
      activeLabel: "Checking the relevant context…",
      completedLabel: "Relevant context checked",
    },
  ];

  if (hasAttachments) {
    activities.push({
      activeLabel: "Reviewing attached documents…",
      completedLabel: "Attached documents reviewed",
    });
  }

  if (requestMode === "draft") {
    activities.push(
      {
        activeLabel: "Preparing the document…",
        completedLabel: "Document prepared",
      },
      {
        activeLabel: "Refining the document…",
        completedLabel: "Document refined",
      }
    );
  } else {
    activities.push(
      {
        activeLabel: "Preparing the response…",
        completedLabel: "Response prepared",
      },
      {
        activeLabel: "Refining the response…",
        completedLabel: "Response refined",
      }
    );
  }

  return activities;
}

export function advanceWorkingActivityIndex(
  currentIndex: number,
  activityCount: number
): number {
  if (activityCount <= 0) return 0;
  return Math.min(currentIndex + 1, activityCount - 1);
}

export function visibleAssistantWorkingActivities(
  activities: WorkingActivity[],
  currentIndex: number
): VisibleWorkingActivity[] {
  if (activities.length === 0) return [];
  const activeIndex = Math.min(Math.max(0, currentIndex), activities.length - 1);
  return activities.slice(0, activeIndex + 1).map((activity, index) => ({
    ...activity,
    isCompleted: index < activeIndex,
    label: index < activeIndex ? activity.completedLabel : activity.activeLabel,
  }));
}
