export type MealType = 'breakfast' | 'lunch' | 'hitea' | 'dinner';

/**
 * Pick the meal a clerk is most likely working on right now, so meal-type
 * selectors open on the sensible default instead of always "breakfast".
 * Boundaries are aligned to the backend MEAL_TIMES map (attendance.py):
 * breakfast 07:00, lunch 13:00, hitea 16:30, dinner 20:00.
 */
export function defaultMealForNow(now: Date = new Date()): MealType {
  const minutes = now.getHours() * 60 + now.getMinutes();
  if (minutes < 10 * 60) return 'breakfast';      // until 10:00
  if (minutes < 15 * 60) return 'lunch';          // 10:00–15:00
  if (minutes < 18 * 60 + 30) return 'hitea';     // 15:00–18:30
  return 'dinner';                                 // 18:30 onward
}
