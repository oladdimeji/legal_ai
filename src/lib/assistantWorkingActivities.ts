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
}: {
  hasAttachments: boolean;
}): WorkingActivity[] {
  const activities: WorkingActivity[] = [
    {
      activeLabel: "Understanding your request…",
      completedLabel: "Request understood",
    },
    {
      activeLabel: "Checking the conversation and current context…",
      completedLabel: "Conversation and context checked",
    },
  ];

  if (hasAttachments) {
    activities.push({
      activeLabel: "Reviewing attached research sources…",
      completedLabel: "Research sources reviewed",
    });
  }

  activities.push(
    {
      activeLabel: "Working with the relevant information…",
      completedLabel: "Relevant information reviewed",
    },
    {
      activeLabel: "Preparing the response…",
      completedLabel: "Response prepared",
    }
  );

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
