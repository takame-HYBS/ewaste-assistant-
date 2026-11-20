// Gold test set: 34 realistic scenarios written BY HAND, independent of the synthetic data generator.
//
// The reference labels are the developer's best judgement of what a sensible technician would advise. They are a
// first draft: have each group member (or your instructor) label these cases independently, then compare. Edit
// `label` below wherever the group disagrees, and run `npm run ml:evaluate` to re-score the model.
//
// Some cases are deliberately borderline, so no model should expect 100%.
const c = (desc, category, ageYears, condition, answers, label) => ({ desc, category, ageYears, condition, answers, label, source: 'gold' });

export const GOLD = [
  c('Phone, 1.5 yrs, works, still needed', 'phone', 1.5, 'working', { powers_on: 'yes', still_needed: 'yes', software_supported: 'yes', battery_health: 'ok' }, 'reuse'),
  c('Phone, 2.5 yrs, works, still needed, battery fine', 'phone', 2.5, 'working', { powers_on: 'yes', still_needed: 'yes', software_supported: 'yes', battery_health: 'ok' }, 'reuse'),
  c('Laptop, 1 yr, only cosmetic scratches, still needed', 'laptop', 1, 'minor_issues', { powers_on: 'yes', cosmetic_only: 'yes', still_needed: 'yes', software_supported: 'yes' }, 'reuse'),
  c('Tablet, 2 yrs, dents only, still needed', 'tablet', 2, 'minor_issues', { powers_on: 'yes', cosmetic_only: 'yes', still_needed: 'yes', software_supported: 'yes' }, 'reuse'),
  c('Tablet, 8 yrs, works, no more updates, still needed', 'tablet', 8, 'working', { powers_on: 'yes', still_needed: 'yes', software_supported: 'no' }, 'reuse'),
  c('Tablet, 3 yrs, cracked screen but works, quote 9000 (costly)', 'tablet', 3, 'minor_issues', { powers_on: 'yes', screen_damage: 'cracked', still_needed: 'yes', repair_quote: 9000, software_supported: 'yes' }, 'reuse'),

  c('Laptop, 3 yrs, works, replaced it, gets updates', 'laptop', 3, 'working', { powers_on: 'yes', still_needed: 'no', software_supported: 'yes' }, 'donate'),
  c('Laptop, 5 yrs, works, no longer needed, gets updates', 'laptop', 5, 'working', { powers_on: 'yes', still_needed: 'no', software_supported: 'yes' }, 'donate'),
  c('Phone, 3 yrs, works, not needed, gets updates', 'phone', 3, 'working', { powers_on: 'yes', still_needed: 'no', software_supported: 'yes', battery_health: 'ok' }, 'donate'),
  c('Small peripheral, 1 yr, works, not needed', 'peripheral', 1, 'working', { powers_on: 'yes', still_needed: 'no' }, 'donate'),

  c('Phone, 2 yrs, cracked screen but works, quote 3000', 'phone', 2, 'minor_issues', { powers_on: 'yes', screen_damage: 'cracked', repair_quote: 3000, still_needed: 'yes', software_supported: 'yes' }, 'repair'),
  c('Laptop, 4 yrs, will not boot, quote 7000', 'laptop', 4, 'major_issues', { powers_on: 'no', repair_quote: 7000, still_needed: 'yes', software_supported: 'yes' }, 'repair'),
  c('Phone, 3 yrs, works but battery drains, still needed', 'phone', 3, 'working', { powers_on: 'yes', battery_health: 'poor', still_needed: 'yes', software_supported: 'yes' }, 'repair'),
  c('Keyboard, 1 yr, some keys stick, quote 300', 'peripheral', 1, 'minor_issues', { powers_on: 'yes', repair_quote: 300, still_needed: 'yes' }, 'repair'),
  c('Laptop, 2 yrs, not working, screen fine, quote 6000', 'laptop', 2, 'not_working', { powers_on: 'no', screen_damage: 'none', repair_quote: 6000, still_needed: 'yes', software_supported: 'yes' }, 'repair'),
  c('Phone, 1 yr, dead screen, quote 3500', 'phone', 1, 'not_working', { powers_on: 'yes', screen_damage: 'dead', repair_quote: 3500, still_needed: 'yes', software_supported: 'yes' }, 'repair'),
  c('Laptop, 6 yrs, major issues, still powers on, supported', 'laptop', 6, 'major_issues', { powers_on: 'yes', still_needed: 'yes', software_supported: 'yes' }, 'repair'),
  c('Laptop, 5 yrs, loose hinge, quote 1200, still needed', 'laptop', 5, 'minor_issues', { powers_on: 'yes', repair_quote: 1200, still_needed: 'yes', software_supported: 'yes' }, 'repair'),
  c('Phone, 4 yrs, major issues, powers on sometimes', 'phone', 4, 'major_issues', { powers_on: 'sometimes', screen_damage: 'none', still_needed: 'yes', software_supported: 'yes' }, 'repair'),

  c('Laptop, 7 yrs, not working, screen fine, quote 15000', 'laptop', 7, 'not_working', { powers_on: 'no', screen_damage: 'none', repair_quote: 15000, still_needed: 'no', software_supported: 'no' }, 'parts_recovery'),
  c('Tablet, 4 yrs, not working, quote 14000', 'tablet', 4, 'not_working', { powers_on: 'no', screen_damage: 'none', repair_quote: 14000, still_needed: 'no', software_supported: 'yes' }, 'parts_recovery'),
  c('Phone, 4.5 yrs, cracked screen, quote 3500, not needed', 'phone', 4.5, 'major_issues', { powers_on: 'yes', screen_damage: 'cracked', repair_quote: 3500, still_needed: 'no', software_supported: 'yes' }, 'parts_recovery'),

  c('Laptop, 9 yrs, dead, liquid damage', 'laptop', 9, 'not_working', { powers_on: 'no', water_damage: 'yes', still_needed: 'no', software_supported: 'no' }, 'recycle'),
  c('Phone, 5 yrs, dead screen, quote 9000', 'phone', 5, 'major_issues', { powers_on: 'yes', screen_damage: 'dead', repair_quote: 9000, still_needed: 'no', software_supported: 'no' }, 'recycle'),
  c('Mouse, 3 yrs, not working', 'peripheral', 3, 'not_working', { powers_on: 'no', still_needed: 'no' }, 'recycle'),
  c('Phone, 2 yrs, works, battery is swollen', 'phone', 2, 'working', { powers_on: 'yes', battery_swollen: 'yes', still_needed: 'yes', software_supported: 'yes' }, 'recycle'),
  c('Tablet, 2 yrs, works, battery is swollen', 'tablet', 2, 'working', { powers_on: 'yes', battery_swollen: 'yes', still_needed: 'yes', software_supported: 'yes' }, 'recycle'),
  c('Tablet, 6 yrs, not working, no updates', 'tablet', 6, 'not_working', { powers_on: 'no', still_needed: 'no', software_supported: 'no' }, 'recycle'),
  c('Phone, 6 yrs, works, no updates, not needed', 'phone', 6, 'working', { powers_on: 'yes', still_needed: 'no', software_supported: 'no', battery_health: 'poor' }, 'recycle'),
  c('Laptop, 10 yrs, minor issues, unsupported, not needed', 'laptop', 10, 'minor_issues', { powers_on: 'yes', still_needed: 'no', software_supported: 'no' }, 'recycle'),
  c('Phone, 3.5 yrs, dead after water damage', 'phone', 3.5, 'not_working', { powers_on: 'no', water_damage: 'yes', still_needed: 'no', software_supported: 'yes' }, 'recycle'),
  c('Speaker, 4 yrs, not working', 'peripheral', 4, 'not_working', { powers_on: 'no', still_needed: 'no' }, 'recycle'),
  c('Laptop, 12 yrs, not working', 'laptop', 12, 'not_working', { powers_on: 'no', still_needed: 'no', software_supported: 'no' }, 'recycle'),
  c('Phone, 7 yrs, not working, no updates', 'phone', 7, 'not_working', { powers_on: 'no', still_needed: 'no', software_supported: 'no' }, 'recycle'),
];
