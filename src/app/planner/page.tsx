import FeatureStub from "@/components/FeatureStub";
import { CHAPTER_SPREAD } from "@/lib/nav/chapterReturn";

export default function PlannerPage() {
  return <FeatureStub title="Web Planner" eyebrow="CANON EVENTS • SHARED CALENDAR" description="A calendar pinned with dates, notes, reminders, and tiny future adventures." table="calendar_events" spread={CHAPTER_SPREAD.planner} />;
}
