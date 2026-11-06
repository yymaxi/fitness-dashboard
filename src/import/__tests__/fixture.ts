/** Hilfen für kleine, realistische Apple-Health-Exporte in Tests. */

export const rec = (type: string, source: string, start: string, end: string, value: string | number, unit = '') =>
  `<Record type="${type}" sourceName="${source}" sourceVersion="1" device="&lt;&lt;HKDevice: 0x1&gt;, name:Watch&gt;"${unit ? ` unit="${unit}"` : ''} creationDate="${end}" startDate="${start}" endDate="${end}" value="${value}"/>`;

export const sleep = (source: string, stage: string, start: string, end: string) =>
  rec('HKCategoryTypeIdentifierSleepAnalysis', source, start, end, `HKCategoryValueSleepAnalysis${stage}`);

export const steps = (source: string, start: string, end: string, n: number) =>
  rec('HKQuantityTypeIdentifierStepCount', source, start, end, n, 'count');

export const hrv = (source: string, at: string, ms: number) =>
  `<Record type="HKQuantityTypeIdentifierHeartRateVariabilitySDNN" sourceName="${source}" unit="ms" startDate="${at}" endDate="${at}" value="${ms}">
   <HeartRateVariabilityMetadataList>
    <InstantaneousBeatsPerMinute bpm="60" time="1:02:03,45 AM"/>
   </HeartRateVariabilityMetadataList>
  </Record>`;

export const wrap = (body: string) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE HealthData [
<!-- HealthKit Export Version: 13 -->
<!ELEMENT HealthData (ExportDate,Me,(Record|Correlation|Workout|ActivitySummary|ClinicalRecord)*)>
<!ATTLIST HealthData
  locale CDATA #REQUIRED
>
]>
<HealthData locale="de_DE">
 <ExportDate value="2026-11-06 08:00:00 +0100"/>
 <Me HKCharacteristicTypeIdentifierDateOfBirth=""/>
${body}
</HealthData>
`;
