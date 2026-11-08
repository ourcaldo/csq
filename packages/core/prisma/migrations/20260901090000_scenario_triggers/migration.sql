/*
  Widen ScenarioTriggerType with the scheduler-driven triggers:
  ON_SCHEDULE (time-of-day, optionally tag-targeted) and ON_NO_REPLY
  (customer silent after our outbound). Additive only — existing rows keep
  their current values.
*/
ALTER TYPE "ScenarioTriggerType" ADD VALUE 'ON_SCHEDULE';
ALTER TYPE "ScenarioTriggerType" ADD VALUE 'ON_NO_REPLY';
