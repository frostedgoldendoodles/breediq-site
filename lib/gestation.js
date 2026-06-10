// BreedIQ — canine gestation constants & helpers
// Single source of truth so every entry path (manual litter creation, the
// assistant's create_litter, and the onboarding/import extractor) computes
// the same due date for the same breeding.
//
// Average canine gestation is ~63 days from the breeding date, but BreedIQ
// uses 61 deliberately for a conservative ("be ready early") due date —
// whelping a couple days before the estimate is far better than after. This
// value was already in use across the litters API and assistant; the
// onboarding extractor was the lone outlier at 63, producing a 2-day
// discrepancy for the same breeding depending on how it was entered.
export const GESTATION_DAYS = 61;

const DAY_MS = 24 * 60 * 60 * 1000;

// Given a breed date (Date or YYYY-MM-DD string), return the YYYY-MM-DD due
// date GESTATION_DAYS later. Returns null for falsy/invalid input.
export function computeDueDate(breedDate) {
    if (!breedDate) return null;
    const bd = (breedDate instanceof Date) ? new Date(breedDate.getTime()) : new Date(breedDate);
    if (isNaN(bd.getTime())) return null;
    return new Date(bd.getTime() + GESTATION_DAYS * DAY_MS).toISOString().split('T')[0];
}

// Gestation progress fields for an active (bred, not yet whelped) litter.
export function gestationProgress(breedDate, today = new Date()) {
    if (!breedDate) return null;
    const bd = (breedDate instanceof Date) ? breedDate : new Date(breedDate);
    if (isNaN(bd.getTime())) return null;
    const day = Math.floor((today - bd) / DAY_MS);
    return {
        computed_gestation_day: day,
        days_remaining: Math.max(0, GESTATION_DAYS - day),
        gestation_progress: Math.min(Math.round((day / GESTATION_DAYS) * 100), 100)
    };
}
